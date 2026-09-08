import { describe, expect, it } from "vitest";
import { PflegehelferService } from "../src/core/service.js";
import { nursingPatientIds } from "../src/core/site-config.js";

describe("least-privilege policy", () => {
  it("keeps HR and management outside patient records", () => {
    const service = new PflegehelferService();
    expect(service.snapshot("u-hr").patients).toEqual([]);
    expect(service.snapshot("u-hr").tasks).toEqual([]);
    expect(service.snapshot("u-manager").patients).toEqual([]);
    expect(service.snapshot("u-manager").observations).toEqual([]);
  });

  it("gives transport only its minimum task context and no clinical patient record", () => {
    const service = new PflegehelferService();
    const snapshot = service.snapshot("u-transport");
    expect(snapshot.patients).toEqual([]);
    expect(snapshot.observations).toEqual([]);
    expect(snapshot.tasks.map((task) => task.id)).toEqual(["t-transport-luca"]);
    expect(() =>
      service.updateTask("u-transport", "t-transport-luca", "accept", {
        purpose: "quality-review",
      }),
    ).toThrow(/Betriebszweck/);
    expect(
      service.updateTask("u-transport", "t-transport-luca", "accept", {}).state,
    ).toBe("accepted");
    expect(
      service.updateTask("u-transport", "t-transport-luca", "start", {}).state,
    ).toBe("in-progress");
    expect(
      service.updateTask("u-transport", "t-transport-luca", "complete", {
        evidence: "Übergabe an Radiologie bestätigt.",
      }).state,
    ).toBe("completed");
  });

  it("rejects clinical writes from non-clinical roles", () => {
    const service = new PflegehelferService();
    expect(() =>
      service.createObservationDraft("u-transport", {
        patientId: "p-luca",
        code: "temperature",
        value: 37,
        effectiveAt: "2026-09-05T08:10:00.000Z",
      }),
    ).toThrow(/nicht berechtigt/);
  });

  it("prevents cross-patient access outside the active relationship", () => {
    const service = new PflegehelferService();
    const snapshot = service.snapshot("u-assistant");
    expect(snapshot.patients.map((patient) => patient.id)).toEqual(
      nursingPatientIds,
    );
    expect(
      snapshot.patients.find((patient) => patient.id === "p-mei"),
    ).toBeUndefined();
    expect(snapshot.handovers.map((handover) => handover.id)).toEqual([
      "h-rehab2-morning",
      "h-rehab2-afternoon",
    ]);
    const incoming = snapshot.handovers.find(
      (handover) => handover.id === "h-rehab2-morning",
    );
    expect(incoming?.patientIds).toEqual(nursingPatientIds);
    expect(JSON.stringify(incoming)).not.toContain("p-mei");
    expect(JSON.stringify(incoming)).not.toContain("Mei Muster");
    expect(snapshot.handovers[0]?.patientIds).toEqual(nursingPatientIds);
    expect(JSON.stringify(snapshot)).not.toContain("Mei Muster");
  });

  it("does not expose patient work or assignments to quality review", () => {
    const service = new PflegehelferService();
    const snapshot = service.snapshot("u-quality");
    expect(snapshot.patients).toEqual([]);
    expect(snapshot.tasks).toEqual([]);
    expect(snapshot.users.every((user) => user.patientIds.length === 0)).toBe(
      true,
    );
    expect(snapshot.users.every((user) => user.wardIds.length === 0)).toBe(
      true,
    );
  });

  it("prevents one role from accepting another role's task", () => {
    const service = new PflegehelferService();
    expect(() =>
      service.updateTask("u-assistant", "t-transport-luca", "accept", {}),
    ).toThrow(/zugewiesene Rolle/);
  });

  it("prevents a coordinator from delegating another person's claimed task", () => {
    const service = new PflegehelferService();
    const task = service.createTask("u-physician", {
      patientId: "p-anna",
      title: "Ärztliche Verlaufskontrolle",
      reason: "Verantwortung bleibt beim übernehmenden Arzt",
      ownerRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    service.updateTask("u-physician", task.id, "accept", {});
    expect(() =>
      service.updateTask("u-nurse", task.id, "delegate", {
        delegateRole: "care-assistant",
      }),
    ).toThrow(/verantwortliche Person/);
  });

  it("binds an acknowledged communication to the person who claimed it", () => {
    const service = new PflegehelferService();
    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Bitte im ärztlichen Dienst übernehmen",
      reason: "Rollenkanal mit persönlicher Quittierung",
      recipientRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    service.transitionCommunication(
      "u-physician",
      message.id,
      "acknowledge",
      {},
    );
    expect(() =>
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "answer",
        { response: "Peer darf nicht unter fremder Quittierung antworten." },
      ),
    ).toThrow(/übernommen hat/);
  });

  it("prevents patient work from being routed into HR or IT boundaries", () => {
    const service = new PflegehelferService();
    expect(() =>
      service.createTask("u-nurse", {
        patientId: "p-anna",
        title: "Unsichere Zuweisung",
        reason: "Darf die klinische Grenze nicht verlassen",
        ownerRole: "hr",
        priority: "routine",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toThrow(/nichtklinische Rollen/);
    expect(() =>
      service.createCommunication("u-nurse", {
        patientId: "p-anna",
        request: "Patientendaten an HR",
        reason: "Negativtest",
        recipientRole: "hr",
        priority: "routine",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toThrow(/Behandlungsteams/);
    expect(() =>
      service.createTask("u-nurse", {
        patientId: "p-anna",
        title: "Klinischer Freitext",
        reason: "Darf nicht in Administration oder Transport gelangen",
        ownerRole: "administration",
        priority: "routine",
        dueAt: "2026-09-05T15:00:00.000Z",
      }),
    ).toThrow(/nichtklinische Rollen/);
  });

  it("requires explicit ownership for completion and recipient responses", () => {
    const service = new PflegehelferService();
    const task = service.createTask("u-physician", {
      patientId: "p-anna",
      title: "Ärztliche Rückfrage prüfen",
      reason: "Expliziter Eigentümer-Negativtest",
      ownerRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    service.updateTask("u-physician", task.id, "accept", {});
    expect(() =>
      service.updateTask("u-nurse", task.id, "complete", {
        evidence: "Nicht delegierter Abschluss",
      }),
    ).toThrow(/verantwortliche Person/);

    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Apothekerische Prüfung",
      reason: "Empfängerbindung",
      recipientRole: "pharmacy",
      recipientId: "u-pharmacy",
      priority: "routine",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    expect(() =>
      service.transitionCommunication("u-physician", message.id, "answer", {
        response: "Nicht zuständig",
      }),
    ).toThrow(/adressierte Person/);
  });

  it("binds a named mention to one identity, not merely a shared role", () => {
    const service = new PflegehelferService();
    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Bitte Schwindel beurteilen",
      reason: "Gezielte ärztliche Rückfrage",
      recipientRole: "physician",
      recipientId: "u-physician",
      priority: "elevated",
      dueAt: "2026-09-05T15:00:00.000Z",
    });
    expect(message.recipientId).toBe("u-physician");
    expect(() =>
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "acknowledge",
        {},
      ),
    ).toThrow(/adressierte Person/);
    expect(
      service.transitionCommunication(
        "u-physician",
        message.id,
        "acknowledge",
        {},
      ).acknowledgedBy,
    ).toBe("u-physician");
  });

  it("routes an overdue named mention to the explicit on-call pool", () => {
    const service = new PflegehelferService();
    const dueAt = new Date(Date.now() + 60_000).toISOString();
    const message = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Bitte zeitkritischen Verlauf beurteilen",
      reason: "Gezielte Person ist möglicherweise nicht verfügbar",
      recipientRole: "physician",
      recipientId: "u-physician",
      priority: "elevated",
      dueAt,
    });
    expect(() =>
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "acknowledge",
        {},
      ),
    ).toThrow(/adressierte Person/);

    const firstSweep = service.runScheduledEscalations(dueAt);
    expect(firstSweep.communications).toHaveLength(1);
    expect(firstSweep.communications[0]).toMatchObject({
      id: message.id,
      state: "escalated",
      recipientId: "u-physician",
      escalationRecipientRole: "physician",
    });
    expect(service.runScheduledEscalations(dueAt).communications).toEqual([]);
    expect(
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "acknowledge",
        {},
      ).acknowledgedBy,
    ).toBe("u-physician-evening");
    expect(
      service.transitionCommunication(
        "u-physician-evening",
        message.id,
        "answer",
        { response: "Bereitschaft hat übernommen." },
      ).state,
    ).toBe("answered");
    const escalationAudit = service.audit
      .snapshot()
      .find((entry) => entry.action === "communication:deadline-escalate");
    expect(escalationAudit).toMatchObject({
      actorId: "system:deadline-engine",
      actorType: "system",
      detail: {
        rule: "communication-unacknowledged-due-v1",
        escalationRoute: "on-call:physician",
      },
    });
  });

  it("honours purpose for minimum-context transport work", () => {
    const service = new PflegehelferService();
    expect(service.snapshot("u-transport", "quality-review").tasks).toEqual([]);
  });
});
