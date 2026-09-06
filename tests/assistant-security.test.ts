import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import {
  AssistantService,
  type AssistantResponse,
} from "../src/core/assistant-service.js";
import {
  validateAssistantComponents,
  type IntentExecutionContext,
} from "../src/core/assistant.js";
import { PflegehelferService } from "../src/core/service.js";

function fixture() {
  const clinical = new PflegehelferService();
  const assistant = new AssistantService(
    clinical,
    new ModelGateway({ PFH_AI_MODE: "deterministic" }),
  );
  return { assistant, clinical };
}

function draftAction(response: AssistantResponse) {
  const component = response.components.find(
    (candidate) => candidate.type === "DraftAction",
  );
  if (!component || component.type !== "DraftAction")
    throw new Error("Expected a bounded draft action");
  return component;
}

function executionContext(
  response: AssistantResponse,
  override: Partial<IntentExecutionContext> = {},
): IntentExecutionContext {
  if (!response.patientContext)
    throw new Error("Expected a patient-bound assistant response");
  return {
    patientId: response.patientContext.patientId,
    encounterId: response.patientContext.encounterId,
    purpose: "direct-care",
    resourceVersion: response.patientContext.resourceVersion,
    explicitlyConfirmed: true,
    ...override,
  };
}

describe("assistant presentation boundary", () => {
  it("rejects unknown OpenUI components and excess executable fields", () => {
    expect(() =>
      validateAssistantComponents([
        {
          type: "ExecuteMedicationOrder",
          medication: "Torasemid",
          dose: "10 mg",
        },
      ]),
    ).toThrow();

    expect(() =>
      validateAssistantComponents([
        {
          type: "PatientSummary",
          patientId: "p-anna",
          title: "Anna Beispiel",
          summary: "Freigegebene Zusammenfassung",
          sourceLabel: "WiCare · Version 7",
          onClick: "javascript:fetch('/api/v1/medications/approve')",
        },
      ]),
    ).toThrow();

    expect(() =>
      validateAssistantComponents([
        {
          type: "SafetyAlert",
          severity: "warning",
          message: "Prüfung erforderlich",
          html: "<script>window.location='https://attacker.invalid'</script>",
        },
      ]),
    ).toThrow();
  });
});

describe("assistant action gateway", () => {
  it("turns one bedside update into a bound, reviewed clinical bundle", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse");
    const response = await assistant.query("u-nurse", {
      prompt:
        "Bin mit Anna fertig. Mobilisiert, Blutdruck 151 zu 88, etwas Schwindel. Arzt informieren und Kontrolle in 30 Minuten.",
      patientId: "p-anna",
      purpose: "direct-care",
    });

    expect(response.classification.intent).toBe("care-update");
    const action = draftAction(response);
    expect(action.kind).toBe("care-update");
    expect(action.preview).toContain("151/88 mmHg");
    expect(action.preview).toContain("pending-provider an WiCare");
    expect(action.preview).toContain("Medplum Communication: sent");
    const existingTaskStates = new Map(
      before.tasks.map((task) => [task.id, task.state]),
    );

    expect(
      assistant.executeIntent(
        "u-nurse",
        action.intentToken,
        executionContext(response),
      ),
    ).toMatchObject({
      bundle: {
        note: { status: "pending-provider" },
        observation: {
          value: 151,
          secondaryValue: 88,
          status: "pending-provider",
        },
        communication: { recipientRole: "physician", state: "sent" },
        task: { title: "Blutdruck erneut kontrollieren", state: "new" },
      },
    });
    const after = clinical.snapshot("u-nurse");
    expect(after.notes).toHaveLength(before.notes.length + 1);
    expect(after.observations).toHaveLength(before.observations.length + 1);
    expect(after.communications).toHaveLength(before.communications.length + 1);
    expect(after.tasks).toHaveLength(before.tasks.length + 1);
    for (const [id, state] of existingTaskStates)
      expect(after.tasks.find((task) => task.id === id)?.state).toBe(state);
    expect(after.outbox).toHaveLength(before.outbox.length + 2);
  });

  it("burns a token when a caller tries to steal it for another patient", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse").notes.length;
    const response = await assistant.query("u-nurse", {
      prompt:
        "Notiz: Transfer links mit Rollator und Hilfestellung durchgeführt.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const token = draftAction(response).intentToken;

    expect(() =>
      assistant.executeIntent(
        "u-nurse",
        token,
        executionContext(response, {
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
        }),
      ),
    ).toThrow(/Identität|Kontext|Version/);
    expect(() =>
      assistant.executeIntent("u-nurse", token, executionContext(response)),
    ).toThrow(/ungültig|abgelaufen/);
    expect(clinical.snapshot("u-nurse").notes).toHaveLength(before);
  });

  it("rejects purpose and resource-version mismatches without mutation", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse").notes.length;

    const purposeBound = await assistant.query("u-nurse", {
      prompt:
        "Notiz: Mobilisation im Flur über dreissig Meter sicher durchgeführt.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(() =>
      assistant.executeIntent(
        "u-nurse",
        draftAction(purposeBound).intentToken,
        executionContext(purposeBound, { purpose: "operations" }),
      ),
    ).toThrow(/Identität|Kontext|Version/);

    const versionBound = await assistant.query("u-nurse", {
      prompt: "Notiz: Verband trocken und ohne sichtbare Rötung kontrolliert.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(() =>
      assistant.executeIntent(
        "u-nurse",
        draftAction(versionBound).intentToken,
        executionContext(versionBound, {
          resourceVersion:
            (versionBound.patientContext?.resourceVersion ?? 0) + 1,
        }),
      ),
    ).toThrow(/Identität|Kontext|Version/);

    expect(clinical.snapshot("u-nurse").notes).toHaveLength(before);
  });

  it("permits one confirmed execution and rejects replay", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse").notes.length;
    const response = await assistant.query("u-nurse", {
      prompt: "Notiz: Transfer rechts mit Hilfestellung sicher durchgeführt.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const token = draftAction(response).intentToken;

    expect(
      assistant.executeIntent("u-nurse", token, executionContext(response)),
    ).toMatchObject({ patientId: "p-anna", status: "draft" });
    expect(() =>
      assistant.executeIntent("u-nurse", token, executionContext(response)),
    ).toThrow(/ungültig|abgelaufen/);
    expect(clinical.snapshot("u-nurse").notes).toHaveLength(before + 1);
  });

  it("rejects authoritative patient-version drift after issue", async () => {
    const { assistant, clinical } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Notiz: Mobilisation am Rollator sicher durchgeführt.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const checkpoint = clinical.checkpoint();
    const patient = checkpoint.state.patients.find(
      (candidate) => candidate.id === "p-anna",
    )!;
    patient.source.version += 1;
    clinical.restoreCheckpoint(checkpoint);
    expect(() =>
      assistant.executeIntent(
        "u-nurse",
        draftAction(response).intentToken,
        executionContext(response),
      ),
    ).toThrow(/Version|geändert/);
  });

  it("allows exactly one winner for concurrent intent execution", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse").notes.length;
    const response = await assistant.query("u-nurse", {
      prompt: "Notiz: Transfer mit Rollator und Hilfestellung durchgeführt.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const token = draftAction(response).intentToken;
    const attempts = await Promise.allSettled([
      Promise.resolve().then(() =>
        assistant.executeIntent("u-nurse", token, executionContext(response)),
      ),
      Promise.resolve().then(() =>
        assistant.executeIntent("u-nurse", token, executionContext(response)),
      ),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    expect(clinical.snapshot("u-nurse").notes).toHaveLength(before + 1);
  });

  it("rolls back every bundle mutation when an intermediate command fails", async () => {
    const { assistant, clinical } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt:
        "Bin mit Anna fertig. Blutdruck 151 zu 88, Schwindel. Arzt informieren und Kontrolle in 30 Minuten.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const before = clinical.checkpoint();
    const original = clinical.createCommunication.bind(clinical);
    clinical.createCommunication = () => {
      throw new Error("injected communication failure");
    };
    expect(() =>
      assistant.executeIntent(
        "u-nurse",
        draftAction(response).intentToken,
        executionContext(response),
      ),
    ).toThrow(/injected communication failure/);
    clinical.createCommunication = original;
    const after = clinical.checkpoint();
    expect(after.state.notes).toEqual(before.state.notes);
    expect(after.state.observations).toEqual(before.state.observations);
    expect(after.state.communications).toEqual(before.state.communications);
    expect(after.state.tasks).toEqual(before.state.tasks);
    expect(after.state.outbox).toEqual(before.state.outbox);
    expect(
      after.audit
        .slice(before.audit.length)
        .every((entry) =>
          ["snapshot:read", "patient:read"].includes(entry.action),
        ),
    ).toBe(true);
    expect(
      after.audit.some(
        (entry) =>
          [
            "note:draft",
            "observation:draft",
            "note:approve",
            "observation:approve",
            "communication:create",
            "task:create",
          ].includes(entry.action) &&
          !before.audit.some((prior) => prior.id === entry.id),
      ),
    ).toBe(false);
  });

  it("filters actions the active role cannot execute", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse").notes.length;
    const response = await assistant.query("u-pharmacy", {
      prompt: "Notiz: Transfer links mit Hilfestellung sicher durchgeführt.",
      patientId: "p-anna",
      purpose: "direct-care",
    });

    expect(response.components).toEqual([
      expect.objectContaining({ type: "SafetyAlert", severity: "warning" }),
    ]);
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
    expect(clinical.snapshot("u-nurse").notes).toHaveLength(before);
  });
});

describe("assistant clinical safety and privacy", () => {
  it("formats clinical task times in the explicit organization timezone", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-assistant", {
      prompt: "Meine offenen Aufgaben",
      patientId: null,
    });
    const taskList = response.components.find(
      (component) => component.type === "TaskList",
    );
    expect(taskList).toBeDefined();
    expect(taskList && "summary" in taskList ? taskList.summary : "").toContain(
      "fällig 10:45",
    );
  });

  it("refuses medication mutation and only offers a reviewable communication", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse");
    const medicationBefore = before.patients.find(
      (patient) => patient.id === "p-anna",
    )?.medicationSummary;
    const response = await assistant.query("u-nurse", {
      prompt:
        "Ändere Torasemid bei Anna von 5 mg auf 10 mg und bestätige die Verordnung.",
      patientId: "p-anna",
      purpose: "direct-care",
    });

    expect(response.classification.intent).toBe("medication-request");
    expect(response.components.map((component) => component.type)).toEqual([
      "SafetyAlert",
      "MedicationReadOnly",
      "DraftAction",
    ]);
    expect(draftAction(response)).toMatchObject({
      kind: "physician-question",
      actionLabel: "Frage prüfen und senden",
    });
    expect(
      clinical
        .snapshot("u-nurse")
        .patients.find((patient) => patient.id === "p-anna")?.medicationSummary,
    ).toEqual(medicationBefore);

    expect(
      assistant.executeIntent(
        "u-nurse",
        draftAction(response).intentToken,
        executionContext(response),
      ),
    ).toMatchObject({
      handoff: {
        kind: "communication",
        patientId: "p-anna",
        recipientRole: "physician",
      },
    });
    const after = clinical.snapshot("u-nurse");
    expect(after.communications).toHaveLength(before.communications.length);
    expect(
      after.patients.find((patient) => patient.id === "p-anna")
        ?.medicationSummary,
    ).toEqual(medicationBefore);
  });

  it("keeps prompts and clinical identifiers out of audit detail", async () => {
    const { assistant, clinical } = fixture();
    const secret = "PROMPT-SECRET-7f63d1";
    await assistant.query("u-nurse", {
      prompt: `Zeige das Profil von Anna Beispiel mit MRN SH-260901-001. ${secret}`,
      patientId: "p-anna",
      purpose: "direct-care",
    });

    const auditDetail = JSON.stringify(
      clinical.audit.snapshot().map((entry) => entry.detail),
    );
    expect(auditDetail).not.toContain(secret);
    expect(auditDetail).not.toContain("Anna Beispiel");
    expect(auditDetail).not.toContain("SH-260901-001");
    expect(auditDetail).not.toContain("Zeige das Profil");
    expect(auditDetail).toContain("patient-summary");
  });
});
