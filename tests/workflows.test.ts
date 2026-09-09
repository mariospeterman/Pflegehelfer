import { describe, expect, it, vi } from "vitest";
import { PflegehelferService } from "../src/core/service.js";
import {
  OpaqueIntentBroker,
  validateAssistantComponents,
} from "../src/core/assistant.js";
import { verifyAuditEntries } from "../src/core/audit.js";
import { createProductionProviderRegistry } from "../src/core/provider-integration/index.js";
import { siteConfiguration } from "../src/core/site-config.js";

describe("deterministic clinical workflows", () => {
  it("uses the human approval time, not draft time, in provider commands", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-05T08:00:00.000Z"));
      const service = new PflegehelferService();
      const draft = service.createObservationDraft("u-nurse", {
        patientId: "p-anna",
        code: "pulse",
        value: 78,
        effectiveAt: "2026-09-05T07:58:00.000Z",
      });
      expect(draft.approvedAt).toBeNull();
      vi.setSystemTime(new Date("2026-09-05T08:12:00.000Z"));
      const approved = service.approve("u-nurse", "observation", draft.id, {
        expectedVersion: draft.version,
        patientMrn: "SH-260901-001",
        patientBirthDate: "1941-03-18",
        reviewedDiff: true,
      });
      expect(approved.approvedAt).toBe("2026-09-05T08:12:00.000Z");
      const command = service.checkpoint().state.outbox.at(-1)!;
      expect(command.createdAt).toBe("2026-09-05T08:12:00.000Z");
      const resource = command.canonicalCommand.resource;
      if (!("approvedAt" in resource))
        throw new Error("Expected an approval-gated clinical resource");
      expect(resource.approvedAt).toBe("2026-09-05T08:12:00.000Z");
      expect(resource.source.recordedAt).toBe("2026-09-05T08:00:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });
  it("enforces state transitions and completion evidence", () => {
    const service = new PflegehelferService();
    const accepted = service.updateTask(
      "u-assistant",
      "t-bp-anna",
      "accept",
      {},
    );
    expect(accepted.state).toBe("accepted");
    expect(() =>
      service.updateTask("u-assistant", "t-bp-anna", "complete", {}),
    ).toThrow(/Abschlussnachweis/);
    expect(
      service.updateTask("u-assistant", "t-bp-anna", "complete", {
        evidence: "151/88 mmHg um 08:37 dokumentiert.",
      }).state,
    ).toBe("completed");
  });

  it("requires patient identifiers and explicit diff review before approval", () => {
    const service = new PflegehelferService();
    const draft = service.createObservationDraft("u-nurse", {
      patientId: "p-anna",
      code: "blood-pressure",
      value: 151,
      secondaryValue: 88,
      effectiveAt: "2026-09-05T08:37:00.000Z",
    });
    expect(() =>
      service.approve("u-nurse", "observation", draft.id, {
        expectedVersion: 1,
        patientMrn: "WRONG",
        patientBirthDate: "1941-03-18",
        reviewedDiff: true,
      }),
    ).toThrow(/Identifikatoren/);
    expect(() =>
      service.approve("u-nurse", "observation", draft.id, {
        expectedVersion: 1,
        patientMrn: "SH-260901-001",
        patientBirthDate: "1941-03-18",
        reviewedDiff: false,
      }),
    ).toThrow(/sichtbar geprüft/);
    const approved = service.approve("u-nurse", "observation", draft.id, {
      expectedVersion: 1,
      patientMrn: "SH-260901-001",
      patientBirthDate: "1941-03-18",
      reviewedDiff: true,
    });
    expect(approved.status).toBe("pending-provider");
    expect(service.snapshot("u-nurse").outbox).toHaveLength(1);
    const assistantSnapshot = service.snapshot("u-assistant");
    expect(assistantSnapshot.outbox).toEqual([]);
    expect(assistantSnapshot.syncSummary).toEqual({
      unresolved: 1,
      conflicts: 0,
    });
  });

  it("supports independent high-assurance approval", () => {
    const service = new PflegehelferService();
    const draft = service.createNoteDraft("u-nurse", {
      patientId: "p-anna",
      structuredText: "Mobilisation links mit Rollator 30 m, keine Dyspnoe.",
      approvalPolicy: "four-eyes",
    });
    const first = service.approve("u-nurse", "note", draft.id, {
      expectedVersion: 1,
      patientMrn: "SH-260901-001",
      patientBirthDate: "1941-03-18",
      reviewedDiff: true,
    });
    expect(first.status).toBe("reviewed");
    const second = service.approve("u-physician", "note", draft.id, {
      expectedVersion: 1,
      patientMrn: "SH-260901-001",
      patientBirthDate: "1941-03-18",
      reviewedDiff: true,
    });
    expect(second.status).toBe("pending-provider");
    expect(second.approvals).toEqual(["u-nurse", "u-physician"]);
  });

  it("keeps provider failure visible and recovers without duplicate commands", async () => {
    const service = new PflegehelferService();
    const draft = service.createNoteDraft("u-nurse", {
      patientId: "p-anna",
      structuredText: "Wundverband trocken und intakt; keine Rötung sichtbar.",
      approvalPolicy: "sensitive",
    });
    expect(draft.provider).toBe(
      siteConfiguration.providerRoutes.careDocumentation,
    );
    service.approve("u-nurse", "note", draft.id, {
      expectedVersion: 1,
      patientMrn: "SH-260901-001",
      patientBirthDate: "1941-03-18",
      reviewedDiff: true,
    });
    const documentationProvider =
      siteConfiguration.providerRoutes.careDocumentation;
    service.setProviderMode("u-it", documentationProvider, "down");
    expect((await service.flushOutbox("u-it"))[0]).toMatchObject({
      state: "pending",
      attempts: 1,
      errorCode: "PROVIDER_UNAVAILABLE",
    });
    expect(service.snapshot("u-nurse").notes[0]?.status).toBe(
      "pending-provider",
    );
    service.setProviderMode("u-it", documentationProvider, "normal");
    const final = (await service.flushOutbox("u-it"))[0];
    expect(final).toMatchObject({ state: "acknowledged", attempts: 2 });
    expect(service.snapshot("u-nurse").notes[0]?.status).toBe("synced");
    expect((await service.flushOutbox("u-it"))[0]?.attempts).toBe(2);
  });

  it("synchronizes patient tasks and team communications through the provider simulator", async () => {
    const service = new PflegehelferService();
    const task = service.createTask("u-nurse", {
      patientId: "p-anna",
      title: "Trinkmenge am Mittag prüfen",
      reason: "Flüssigkeitsziel der aktuellen Schicht nachverfolgen.",
      ownerRole: "care-assistant",
      priority: "routine",
      dueAt: "2026-09-05T12:30:00.000Z",
    });
    const communication = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Bitte Mobilitätsziel bei der nächsten Visite bestätigen.",
      reason: "Gemeinsame Tagesplanung im Behandlungsteam.",
      recipientRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T13:00:00.000Z",
    });

    const before = service
      .checkpoint()
      .state.outbox.filter((item) =>
        [task.id, communication.id].includes(item.aggregateId),
      );
    expect(before.map((item) => item.aggregateType).sort()).toEqual([
      "communication",
      "task",
    ]);

    const flushed = await service.flushOutbox("u-it");
    expect(
      flushed.filter((item) =>
        [task.id, communication.id].includes(item.aggregateId),
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          aggregateType: "task",
          state: "acknowledged",
        }),
        expect.objectContaining({
          aggregateType: "communication",
          state: "acknowledged",
        }),
      ]),
    );
    expect(
      service.snapshot("u-nurse").tasks.find((item) => item.id === task.id)
        ?.state,
    ).toBe("new");
    expect(
      service
        .snapshot("u-nurse")
        .communications.find((item) => item.id === communication.id)?.state,
    ).toBe("sent");
  });

  it("never silently overwrites a provider conflict", async () => {
    const service = new PflegehelferService();
    const draft = service.createObservationDraft("u-nurse", {
      patientId: "p-luca",
      code: "temperature",
      value: 37.8,
      effectiveAt: "2026-09-05T09:00:00.000Z",
    });
    service.approve("u-nurse", "observation", draft.id, {
      expectedVersion: 1,
      patientMrn: "SH-260902-004",
      patientBirthDate: "1937-11-02",
      reviewedDiff: true,
    });
    service.setProviderMode("u-it", "device-gateway", "conflict");
    const outbox = await service.flushOutbox("u-it");
    expect(outbox[0]).toMatchObject({
      state: "conflict",
      errorCode: "SIMULATED_VERSION_CONFLICT",
    });
    expect(
      service
        .snapshot("u-nurse")
        .observations.find((item) => item.id === draft.id)?.status,
    ).toBe("conflict");
    expect(() =>
      service.reconcileOutbox("u-it", outbox[0]!.id, {
        confirmedVersionComparison: false,
        expectedLocalVersion: outbox[0]!.localVersion,
        expectedLocalHash: outbox[0]!.localHash,
        expectedProviderVersion: outbox[0]!.providerVersion,
        expectedProviderHash: outbox[0]!.providerHash,
      }),
    ).toThrow(/sichtbar geprüft/);
    const clinicalConflict = service.snapshot("u-nurse").outbox[0];
    expect(clinicalConflict).toBeDefined();
    expect(clinicalConflict && "localSummary" in clinicalConflict).toBe(true);
    if (!clinicalConflict || !("localSummary" in clinicalConflict))
      throw new Error("Klinische Konfliktprojektion fehlt");
    expect(clinicalConflict.localSummary).toBe("Temperatur: 37.8 °C");
    expect(clinicalConflict.conflictSnapshot?.version).toBe("sim-v1");
    expect(clinicalConflict.conflictSnapshot?.summary).toContain(
      "synthetischer Parallelstand",
    );
    const reconciled = service.reconcileOutbox("u-nurse", outbox[0]!.id, {
      confirmedVersionComparison: true,
      expectedLocalVersion: clinicalConflict.localVersion,
      expectedLocalHash: clinicalConflict.localHash,
      expectedProviderVersion: clinicalConflict.providerVersion,
      expectedProviderHash: clinicalConflict.providerHash,
    });
    expect(reconciled).toMatchObject({
      state: "pending",
      expectedProviderVersion: "sim-v1",
      providerVersion: "sim-v1",
      localVersion: 2,
    });
    service.setProviderMode("u-it", "device-gateway", "normal");
    expect((await service.flushOutbox("u-it"))[0]).toMatchObject({
      state: "acknowledged",
      providerVersion: "sim-v2",
    });
  });

  it("does not let IT requeue a clinical-content rejection", async () => {
    const service = new PflegehelferService();
    const draft = service.createObservationDraft("u-nurse", {
      patientId: "p-luca",
      code: "temperature",
      value: 37.7,
      effectiveAt: "2026-09-05T09:30:00.000Z",
    });
    service.approve("u-nurse", "observation", draft.id, {
      expectedVersion: 1,
      patientMrn: "SH-260902-004",
      patientBirthDate: "1937-11-02",
      reviewedDiff: true,
    });
    service.setProviderMode("u-it", "device-gateway", "reject");
    const rejected = (await service.flushOutbox("u-it"))[0]!;
    expect(rejected).toMatchObject({
      state: "rejected",
      errorClassification: "clinical-content",
    });
    const comparison = {
      confirmedVersionComparison: true as const,
      expectedLocalVersion: rejected.localVersion,
      expectedLocalHash: rejected.localHash,
      expectedProviderVersion: rejected.providerVersion,
      expectedProviderHash: rejected.providerHash,
    };
    expect(() =>
      service.reconcileOutbox("u-it", rejected.id, comparison),
    ).toThrow(/berechtigte Fachperson/);
    expect(
      service.reconcileOutbox("u-nurse", rejected.id, comparison),
    ).toMatchObject({ state: "pending" });
  });

  it("completes communication, handover, rounds and mirrored bell loops", () => {
    const service = new PflegehelferService();
    expect(
      service.transitionCommunication(
        "u-physician",
        "c-dizziness-anna",
        "acknowledge",
        {},
      ).state,
    ).toBe("acknowledged");
    const answered = service.transitionCommunication(
      "u-physician",
      "c-dizziness-anna",
      "answer",
      {
        response:
          "Orthostase messen; keine Medikationsänderung in Pflegehelfer.",
        createTask: true,
      },
    );
    expect(answered.state).toBe("answered");
    expect(answered.resultingTaskId).toBeTruthy();
    expect(() =>
      service.reviewIntakeItem(
        "u-nurse",
        "i-anna-med",
        "Pflege darf den Apothekenauftrag nicht stellvertretend schliessen.",
      ),
    ).toThrow(/verantwortlichen Rolle/);
    expect(
      service.reviewIntakeItem(
        "u-pharmacy",
        "i-anna-med",
        "Austrittsverordnung telefonisch mit der Klinik bestätigt.",
      ).state,
    ).toBe("reviewed");
    expect(
      service
        .snapshot("u-pharmacy")
        .tasks.find((task) => task.id === "t-intake-anna-med")?.state,
    ).toBe("completed");
    const round = service.createRoundAction("u-physician", {
      patientId: "p-luca",
      actionKind: "therapy-followup",
      ownerRole: "physiotherapy",
      deadline: "2026-09-05T15:00:00.000Z",
      targetSystem: "pflegehelfer",
    });
    expect(round.taskId).toBeTruthy();
    expect(round.decision).toBe("Therapieeinheit nachverfolgen");
    expect(() =>
      service.createRoundAction("u-physician", {
        patientId: "p-luca",
        actionKind: "mobility-followup",
        ownerRole: "physician",
        deadline: "2026-09-05T15:00:00.000Z",
        targetSystem: "wicare",
      }),
    ).toThrow(/Vendor-Vertrag/);
    const bell = service.triggerNurseCall("u-it", "p-anna");
    expect(bell.source.provider).toBe("nurse-call");
    expect(bell.reason).toMatch(/primären Rufanlage/);
    expect(
      service.runNurseCallEscalations(
        "u-it",
        new Date(Date.parse(bell.dueAt) - 1).toISOString(),
      ),
    ).toEqual([]);
    const escalated = service.runNurseCallEscalations("u-it", bell.dueAt);
    expect(escalated).toHaveLength(1);
    expect(escalated[0]).toMatchObject({
      id: bell.id,
      state: "escalated",
      ownerRole: "registered-nurse",
      ownerId: null,
      source: { provider: "nurse-call" },
    });
    expect(
      service
        .snapshot("u-it")
        .outbox.some((item) => item.aggregateId === bell.id),
    ).toBe(false);
  });

  it("does not escalate a nurse call after a caregiver acknowledged it", () => {
    const service = new PflegehelferService();
    const bell = service.triggerNurseCall("u-it", "p-anna");
    service.updateTask("u-assistant", bell.id, "accept", {});
    service.updateTask("u-assistant", bell.id, "start", {});

    expect(service.runScheduledEscalations(bell.dueAt).nurseCalls).toEqual([]);
    expect(
      service.snapshot("u-assistant").tasks.find((task) => task.id === bell.id),
    ).toMatchObject({
      state: "in-progress",
      ownerId: "u-assistant",
    });
  });

  it("produces a valid append-only audit chain", () => {
    const service = new PflegehelferService();
    service.snapshot("u-nurse");
    service.updateTask("u-assistant", "t-bp-anna", "accept", {});
    expect(service.audit.verify()).toBe(true);
    const evidence = service.auditEvidence("u-it");
    expect(evidence.valid).toBe(true);
    expect(evidence.count).toBeGreaterThan(2);
    const tampered = service.audit.snapshot();
    tampered[0]!.detail.reason = "manipulated";
    expect(verifyAuditEntries(tampered)).toBe(false);
  });

  it("keeps local approval while provider delivery is externally gated", () => {
    const service = new PflegehelferService(
      undefined,
      createProductionProviderRegistry(),
    );
    const draft = service.createNoteDraft("u-nurse", {
      patientId: "p-luca",
      structuredText: "Mobilisation 20 m mit Rollator, links gesichert.",
    });

    service.approve("u-nurse", "note", draft.id, {
      expectedVersion: 1,
      patientMrn: "SH-260902-004",
      patientBirthDate: "1937-11-02",
      reviewedDiff: true,
    });

    const snapshot = service.snapshot("u-nurse");
    expect(snapshot.notes.find((note) => note.id === draft.id)).toMatchObject({
      status: "external-gated",
      version: 2,
      approvals: ["u-nurse"],
    });
    expect(snapshot.outbox).toEqual([
      expect.objectContaining({
        aggregateId: draft.id,
        state: "external-gated",
        errorCode: "EXTERNAL_VENDOR_GATE",
      }),
    ]);
  });

  it("requires the author to make the first sensitive approval", () => {
    const service = new PflegehelferService();
    const draft = service.createNoteDraft("u-assistant", {
      patientId: "p-anna",
      structuredText: "Transfer rechts mit Hilfestellung sicher durchgeführt.",
    });
    expect(() =>
      service.approve("u-nurse", "note", draft.id, {
        expectedVersion: 1,
        patientMrn: "SH-260901-001",
        patientBirthDate: "1941-03-18",
        reviewedDiff: true,
      }),
    ).toThrow(/erfassende Person/);
  });

  it("rejects unbounded assistant UI and uses confirmed one-use opaque intents", () => {
    expect(() =>
      validateAssistantComponents([{ type: "ExecuteMedicationOrder" }]),
    ).toThrow(/Unbekannte/);
    const service = new PflegehelferService();
    const broker = new OpaqueIntentBroker();
    const nurse = service.user("u-nurse");
    const input = {
      command: "task:draft" as const,
      patientId: "p-anna",
      encounterId: "enc-anna",
      purpose: "direct-care" as const,
      resourceVersion: 1,
      payload: { title: "Kontrolle" },
    };
    const context = {
      patientId: input.patientId,
      encounterId: input.encounterId,
      purpose: input.purpose,
      resourceVersion: input.resourceVersion,
      explicitlyConfirmed: true,
    };
    const token = broker.issue(nurse, input);
    expect(() =>
      broker.consume(token, service.user("u-physician"), context),
    ).toThrow(/Identität|Kontext/);
    expect(broker.consume(token, nurse, context)).toMatchObject({
      patientId: "p-anna",
    });
    broker.finalize(token);
    expect(() => broker.consume(token, nurse, context)).toThrow(/ungültig/);
    const confirmed = broker.issue(nurse, input);
    expect(() =>
      broker.consume(confirmed, nurse, {
        ...context,
        explicitlyConfirmed: false,
      }),
    ).toThrow(/Identität|Kontext/);

    const encounterBound = broker.issue(nurse, input);
    expect(() =>
      broker.consume(encounterBound, nurse, {
        ...context,
        encounterId: "encounter-substitution",
      }),
    ).toThrow(/Identität|Kontext|Version/);

    const changedRole = broker.issue(nurse, input);
    expect(() =>
      broker.consume(changedRole, { ...nurse, role: "physician" }, context),
    ).toThrow(/Identität|Kontext/);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-05T08:00:00.000Z"));
      const expiring = broker.issue(nurse, { ...input, ttlMs: 1000 });
      vi.setSystemTime(new Date("2026-09-05T08:00:01.001Z"));
      expect(() => broker.consume(expiring, nurse, context)).toThrow(
        /ungültig|abgelaufen/,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
