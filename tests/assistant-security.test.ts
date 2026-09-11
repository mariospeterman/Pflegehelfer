import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import {
  deterministicAssistantProposal,
  verifyModelProposalAgainstDeterministicCompiler,
} from "../src/ai/assistant-proposal.js";
import {
  AssistantService,
  type AssistantResponse,
} from "../src/core/assistant-service.js";
import {
  validateAssistantComponents,
  type IntentExecutionContext,
} from "../src/core/assistant.js";
import { PflegehelferService } from "../src/core/service.js";
import { extractCriticalEntities } from "../src/core/critical-entities.js";

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
  const reviewItems = draftAction(response).reviewItems;
  const context = {
    patientId: response.patientContext.patientId,
    encounterId: response.patientContext.encounterId,
    purpose: "direct-care",
    resourceVersion: response.patientContext.resourceVersion,
    explicitlyConfirmed: true,
    ...(reviewItems
      ? {
          reviewedActionIds: reviewItems.map((item) => item.id),
        }
      : {}),
    ...override,
  };
  if (context.reviewedActionIds === undefined) delete context.reviewedActionIds;
  return context as IntentExecutionContext;
}

describe("assistant presentation boundary", () => {
  it("marks ordinary unitless vitals for explicit voice review", () => {
    expect(
      extractCriticalEntities("Puls 82 Temperatur 37,2").filter(
        (item) => item.kind === "measurement",
      ),
    ).toHaveLength(2);
    expect(
      extractCriticalEntities(
        "Gestern um 18 Uhr Blutdruck 151 zu 88; Arzt in einer halben Stunde informieren.",
      ).filter((item) => item.kind === "time"),
    ).toHaveLength(2);
    expect(
      extractCriticalEntities(
        "Heute um 18 Uhr Blutdruck 151 zu 88; um 19:30 Uhr Puls 82.",
      ).filter((item) => item.kind === "time"),
    ).toHaveLength(2);
  });
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
  it("answers explicit negation conversationally without issuing authority", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Arzt nicht informieren, keine weitere Kontrolle.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.classification.intent).toBe("care-update");
    expect(response.components).toHaveLength(1);
    expect(response.components[0]?.type).toBe("AssistantText");
    const reply = response.components[0];
    if (reply?.type !== "AssistantText") throw new Error("expected reply");
    expect(reply.message).toContain("keine Änderung");
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

  it.each([
    ["Puls 82.", "82 /min"],
    ["SpO2 96 Prozent.", "96 %"],
  ])(
    "routes a declarative bedside measurement to one review action: %s",
    async (prompt, expected) => {
      const { assistant } = fixture();
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(response.classification.intent).toBe("care-update");
      const action = draftAction(response);
      expect(action.reviewItems).toHaveLength(1);
      expect(action.preview).toContain(expected);
      expect(action.preview).not.toContain("Letzte Vitalwerte");
    },
  );

  it("keeps a doubtful but syntactically valid value behind high-assurance review", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "SpO2 35 Prozent.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const action = draftAction(response);
    expect(action.reviewItems?.[0]?.label).toContain("Ungewöhnlicher Messwert");
    const result = assistant.executeIntent(
      "u-nurse",
      action.intentToken,
      executionContext(response),
    );
    expect(result).toMatchObject({
      bundle: [expect.objectContaining({ status: "reviewed" })],
      itemStates: ["reviewed"],
    });
    expect(result).not.toHaveProperty("episodeEvidence");
  });

  it("does not launder a doubtful measurement through mixed note evidence", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Anna mobilisiert, SpO2 35 Prozent.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const action = draftAction(response);
    expect(action.reviewItems).toHaveLength(2);
    const result = assistant.executeIntent(
      "u-nurse",
      action.intentToken,
      executionContext(response),
    );
    expect(result).toMatchObject({
      bundle: [
        expect.objectContaining({ status: "pending-provider" }),
        expect.objectContaining({ status: "reviewed" }),
      ],
      episodeEvidence: "Durchgeführt: mobilisiert",
    });
    expect(
      (result as { episodeEvidence?: string }).episodeEvidence,
    ).not.toContain("35");
  });

  it("does not bind a named patient statement to the wrong open chart", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Luca mobilisiert, fast alles gegessen, ca. 200 ml getrunken.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.components.map((component) => component.type)).toEqual([
      "AssistantText",
      "PatientPicker",
    ]);
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

  it("recognizes surname, room and MRN references to another patient", async () => {
    const { assistant } = fixture();
    for (const prompt of [
      "Demo mobilisiert.",
      "Zimmer 207 mobilisiert.",
      "Fall SH-260902-004 mobilisiert.",
    ]) {
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(
        response.components.some(
          (component) => component.type === "DraftAction",
        ),
      ).toBe(false);
      expect(response.components.map((component) => component.type)).toEqual([
        "AssistantText",
        "PatientPicker",
      ]);
    }
  });

  it("never issues authority for explicit no-write language", async () => {
    const { assistant } = fixture();
    for (const prompt of [
      "Nicht dokumentieren: Patient schlief ruhig.",
      "Keine Nachricht an den Arzt senden.",
      "Dokumentiere bitte nichts aus dem Gespräch.",
      "Schreib nichts aus dem Gespräch auf.",
      "Bitte dokumentiere auf keinen Fall etwas.",
      "Bitte auf keinen Fall dokumentieren.",
      "Bitte keinesfalls dokumentieren.",
      "Bitte keine Angaben festhalten.",
    ]) {
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(response.classification.intent).toBe("care-update");
      expect(
        response.components.some(
          (component) => component.type === "DraftAction",
        ),
      ).toBe(false);
    }
  });

  it("does not turn a historical medication report into a handoff", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Die Ärztin hat gestern die Dosis geändert.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

  it("does not infer a communication merely from a negated medication mention", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Medikament nicht geben.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.classification.intent).toBe("medication-request");
    expect(response.components.map((component) => component.type)).toEqual([
      "SafetyAlert",
      "MedicationReadOnly",
    ]);
  });

  it("turns one bedside update into a bound, reviewed clinical bundle", async () => {
    const { assistant, clinical } = fixture();
    const before = clinical.snapshot("u-nurse");
    const response = await assistant.query("u-nurse", {
      prompt:
        "Bin mit Anna fertig. Mobilisiert, Blutdruck 151 zu 88, etwas Schwindel. Arzt in 60 Minuten informieren und Kontrolle in 30 Minuten.",
      patientId: "p-anna",
      purpose: "direct-care",
    });

    expect(response.classification.intent).toBe("care-update");
    const action = draftAction(response);
    expect(action.kind).toBe("care-update");
    expect(action.preview).toContain("151/88 mmHg");
    expect(action.reviewItems).toHaveLength(4);
    expect(action.preview).toContain("Teamnachricht an Ärztlicher Dienst");
    const existingTaskStates = new Map(
      before.tasks.map((task) => [task.id, task.state]),
    );

    const result = assistant.executeIntent(
      "u-nurse",
      action.intentToken,
      executionContext(response),
    ) as { bundle: unknown[]; itemStates: string[] };
    expect(result.itemStates).toEqual([
      "pending-provider",
      "pending-provider",
      "sent",
      "new",
    ]);
    expect(result.bundle).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "pending-provider",
        }),
        expect.objectContaining({
          value: 151,
          secondaryValue: 88,
          status: "pending-provider",
        }),
        expect.objectContaining({ recipientRole: "physician", state: "sent" }),
        expect.objectContaining({
          title: "Blutdruck erneut kontrollieren",
          state: "new",
        }),
      ]),
    );
    const note = result.bundle.find(
      (item): item is { structuredText: unknown } =>
        typeof item === "object" && item !== null && "structuredText" in item,
    );
    expect(typeof note?.structuredText).toBe("string");
    const after = clinical.snapshot("u-nurse");
    expect(after.notes).toHaveLength(before.notes.length + 1);
    expect(after.observations).toHaveLength(before.observations.length + 1);
    expect(after.communications).toHaveLength(before.communications.length + 1);
    expect(after.tasks).toHaveLength(before.tasks.length + 1);
    for (const [id, state] of existingTaskStates)
      expect(after.tasks.find((task) => task.id === id)?.state).toBe(state);
    expect(after.outbox).toHaveLength(before.outbox.length + 4);
    expect(after.outbox.map((item) => item.aggregateType)).toEqual(
      expect.arrayContaining(["note", "observation", "communication", "task"]),
    );
    expect(after.notes.at(-1)?.status).toBe("pending-provider");
    expect(after.observations.at(-1)?.status).toBe("pending-provider");
  });

  it("refuses to compile medication or dose instructions from free text", () => {
    expect(
      deterministicAssistantProposal(
        "Blutdruck 151 zu 88. Marcumar sofort geben und Arzt informieren.",
      ),
    ).toBeNull();
  });

  it("routes a medication instruction to the fail-closed path even with a note prefix", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Notiz: Insulin 20 IE sofort geben.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.classification.intent).toBe("medication-request");
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
    expect(response.components[0]).toMatchObject({ type: "SafetyAlert" });
  });

  it("fails closed for generic imperative treatment language", async () => {
    const { assistant } = fixture();
    for (const prompt of [
      "Notiz: Fentanyl 5 ml geben.",
      "Notiz: Sauerstoff 4 l/min geben.",
      "Notiz: Oxycodon-Tropfen sofort verabreichen.",
      "Notiz: Wundbehandlung jetzt durchführen.",
      "Notiz: Gib Fentanyl.",
      "Anamnese: Setze Eliquis ab.",
      "Pflegebericht: Entferne den Katheter.",
      "Notiz: Wechsle jetzt den Verband.",
      "Notiz: Lege einen Katheter.",
      "Notiz: Stoppe Eliquis.",
      "Notiz: Reduziere Fentanyl.",
      "Notiz: Erhöhe Sauerstoff auf 4 l/min.",
      "Notiz: Ändere den Verband.",
      "Eliquis soll abgesetzt werden.",
      "Fentanyl 5 ml soll gegeben werden.",
      "Sauerstoff soll auf 4 l/min erhöht werden.",
      "Notiz: Sauerstoff auf 2 l/min titrieren.",
      "Notiz: Senke Sauerstoff auf 2 l/min.",
      "Notiz: Ersetze den Verband.",
      "Notiz: Katheter ziehen.",
      "Notiz: Die Wunde verbinden.",
      "Notiz: Blase spülen.",
      "Notiz: Verband erneuern.",
      "Notiz: Trachealkanüle absaugen.",
      "Notiz: Drainage leeren.",
      "Notiz: Stoma versorgen.",
      "Notiz: Bewohner umlagern.",
      "Notiz: Trachealkanüle absaugen um 08 Uhr.",
      "Notiz: Drainage leeren um 08 Uhr.",
      "Notiz: Bewohner umlagern nach dem Frühstück.",
      "Notiz: Inhalation durchführen.",
      "Notiz: Blutzucker messen.",
      "Notiz: Kompressionsstrümpfe anziehen.",
      "Notiz: Patient nüchtern lassen.",
      "Notiz: Injiziere Heparin.",
      "Notiz: Verteile die Tabletten.",
      "Notiz: Spüle die PEG-Sonde.",
      "Notiz: Fixiere den Patienten.",
      "Notiz: Sedieren Sie den Patienten.",
      "Notiz: Reanimiere den Patienten.",
      "Notiz: Gurte den Bewohner an.",
      "Notiz: Isoliere den Bewohner.",
      "Notiz: Patient fixieren.",
      "Notiz: Sedieren Sie Herrn Beispiel.",
      "Notiz: Den Patienten fixieren.",
      "Notiz: Herrn Beispiel sedieren.",
      "Notiz: Bewohnerin ans Bett fesseln.",
    ]) {
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(response.classification.intent).toBe("medication-request");
      expect(
        response.components.some(
          (component) => component.type === "DraftAction",
        ),
      ).toBe(false);
    }
  });

  it("does not mistake an explicit read request for a clinical command", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Zeige das Profil.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.classification.intent).toBe("patient-summary");
    expect(response.components).toContainEqual(
      expect.objectContaining({ type: "PatientSummary" }),
    );
  });

  it("keeps the handover read command on the read-only route", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt: "Zeige die Übergabe.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.classification.intent).toBe("handover");
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

  it.each([
    "Arzt wurde informiert.",
    "Gestern Arzt informiert.",
    "Die Ärztin ist bereits benachrichtigt.",
    "Arzt keinesfalls in 30 Minuten informieren.",
    "Arzt keineswegs informieren.",
    "Arzt informieren? Nein.",
  ])(
    "does not turn historical or negated physician wording into a send action: %s",
    async (prompt) => {
      const { assistant } = fixture();
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(
        response.components.some(
          (component) =>
            component.type === "DraftAction" &&
            component.kind === "physician-question",
        ),
      ).toBe(false);
    },
  );

  it("does not let model-only intent classification unlock a mutation", async () => {
    const model = new ModelGateway({ PFH_AI_MODE: "deterministic" });
    model.classify = () =>
      Promise.resolve({
        intent: "draft-task",
        mode: "hosted-test",
        model: "untrusted-classifier",
        degraded: false,
      });
    const assistant = new AssistantService(new PflegehelferService(), model);
    const response = await assistant.query("u-nurse", {
      prompt: "Guten Morgen.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

  it.each([
    "Erstelle keine Aufgabe.",
    "Erstelle keinesfalls eine Aufgabe.",
    "Vielleicht eine Aufgabe erstellen?",
  ])(
    "does not let a model invert a refused or uncertain task request: %s",
    async (prompt) => {
      const model = new ModelGateway({ PFH_AI_MODE: "deterministic" });
      model.classify = () =>
        Promise.resolve({
          intent: "draft-task",
          mode: "hosted-test",
          model: "untrusted-classifier",
          degraded: false,
        });
      const assistant = new AssistantService(new PflegehelferService(), model);
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(
        response.components.some(
          (component) => component.type === "DraftAction",
        ),
      ).toBe(false);
    },
  );

  it.each([
    "Vielleicht Arzt informieren.",
    "Sollte man den Arzt informieren?",
    "Arzt möglicherweise informieren.",
  ])("keeps uncertain physician wording non-executable: %s", async (prompt) => {
    const { assistant } = fixture();
    const response = await assistant.query("u-nurse", {
      prompt,
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

  it.each([
    "Notiz: Spritze Heparin.",
    "Notiz: Klemme den Katheter ab.",
    "Notiz: Sauerstoff auf 4 l/min stellen.",
    "Notiz: Öffne die Infusion.",
    "Notiz: Entlüfte die Leitung.",
  ])(
    "fails closed for terse treatment or device commands: %s",
    async (prompt) => {
      const { assistant } = fixture();
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(response.classification.intent).toBe("medication-request");
      expect(
        response.components.some(
          (component) => component.type === "DraftAction",
        ),
      ).toBe(false);
    },
  );

  it("keeps ordinary completed and descriptive nursing notes available", async () => {
    const { assistant } = fixture();
    for (const prompt of [
      "Notiz: Patientin klagt über Schmerzen 5 von 10.",
      "Notiz: Schmerzen unverändert.",
      "Notiz: Essen vollständig eingenommen.",
      "Notiz: Die Patientin konnte selbständig gehen.",
      "Notiz: Haut ohne Läsionen.",
    ]) {
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      expect(
        response.components.some(
          (component) => component.type === "DraftAction",
        ),
      ).toBe(true);
    }
  });

  it("rejects schema-valid model fields that differ from deterministic compilation", () => {
    const prompt =
      "Mobilisiert, Blutdruck 151 zu 88, Arzt informieren und Kontrolle in 30 Minuten.";
    const compiled = deterministicAssistantProposal(prompt);
    if (!compiled) throw new Error("Expected deterministic care plan");
    const invented = structuredClone(compiled);
    const task = invented.actions.find(
      (action) => action.type === "task-proposal",
    );
    if (!task || task.type !== "task-proposal")
      throw new Error("Expected compiled task");
    task.title = "Insulin 20 IE sofort geben";
    expect(() =>
      verifyModelProposalAgainstDeterministicCompiler(
        prompt,
        invented,
        compiled,
      ),
    ).toThrow("CLINICAL_PLAN_UNGROUNDED_CLINICAL_CONTENT");
  });

  it("does not let an invalid caller burn another person's reviewed token", async () => {
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
    expect(
      assistant.executeIntent("u-nurse", token, executionContext(response)),
    ).toMatchObject({ patientId: "p-anna", status: "pending-provider" });
    expect(clinical.snapshot("u-nurse").notes).toHaveLength(before + 1);
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
    ).toMatchObject({ patientId: "p-anna", status: "pending-provider" });
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
        "Bin mit Anna fertig. Blutdruck 151 zu 88, Schwindel. Arzt in 60 Minuten informieren und Kontrolle in 30 Minuten.",
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
  it("resolves an explicit named treatment-team mention without guessing", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-assistant", {
      prompt: "Frage @Samira: Kannst du die Mobilisation später übernehmen?",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.classification.intent).toBe("draft-physician-question");
    expect(draftAction(response).title).toContain("Samira Vogel");
    expect(
      assistant.executeIntent(
        "u-assistant",
        draftAction(response).intentToken,
        executionContext(response),
      ),
    ).toMatchObject({
      handoff: {
        kind: "communication",
        recipientRole: "registered-nurse",
        recipientId: "u-nurse-evening",
        recipientLabel: "Samira Vogel",
      },
    });
  });

  it("does not resolve a partial named mention", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-assistant", {
      prompt: "Frage @Sam: Kannst du später übernehmen?",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.components).toEqual([
      expect.objectContaining({ type: "SafetyAlert", severity: "warning" }),
    ]);
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

  it("does not silently choose between a named person and a role mention", async () => {
    const { assistant } = fixture();
    const response = await assistant.query("u-assistant", {
      prompt: "Frage @Samira und @Arzt: Wer kann später übernehmen?",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    expect(response.components).toEqual([
      expect.objectContaining({ type: "SafetyAlert", severity: "warning" }),
    ]);
    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });

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
