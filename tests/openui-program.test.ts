import { createParser } from "@openuidev/react-lang";
import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { AssistantService } from "../src/core/assistant-service.js";
import { PflegehelferService } from "../src/core/service.js";
import { clinicalAssistantLibrary } from "../src/pwa/assistant/clinical-library.js";

describe("constrained OpenUI program", () => {
  it("round-trips every supported assistant result into an allowlisted root", async () => {
    const assistant = new AssistantService(
      new PflegehelferService(),
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    );
    const cases = [
      "Patientenprofil",
      "Offene Aufgaben",
      "Letzte Vitalwerte",
      "Übergabe",
      "Notiz: Mobilisation mit Rollator sicher durchgeführt.",
      "Frage an Arzt: Bitte Schwindel beurteilen.",
      "Mobilisiert, Blutdruck 151 zu 88, Arzt informieren und Kontrolle in 30 Minuten dokumentieren.",
      "Welche Richtlinie gilt bei einer Medikationsdiskrepanz?",
      "Ändere Torasemid auf 10 mg",
      "unbekannte Bedienabsicht",
    ];

    for (const prompt of cases) {
      const response = await assistant.query("u-nurse", {
        prompt,
        patientId: "p-anna",
        purpose: "direct-care",
      });
      const parsed = createParser(
        clinicalAssistantLibrary.toJSONSchema(),
      ).parse(response.openUi);
      expect(parsed.meta.errors, prompt).toEqual([]);
      expect(parsed.meta.unresolved, prompt).toEqual([]);
      expect(parsed.root?.typeName, prompt).toBe("ClinicalStack");
    }
  });

  it("fails closed for an unknown executable component", () => {
    const parsed = createParser(clinicalAssistantLibrary.toJSONSchema()).parse(
      'root = ExecuteMedicationOrder("Torasemid", "10 mg")',
    );
    expect(parsed.root).toBeNull();
    expect(parsed.meta.errors).toEqual([
      expect.objectContaining({ code: "unknown-component" }),
    ]);
  });

  it("round-trips the structured physician team inbox", async () => {
    const assistant = new AssistantService(
      new PflegehelferService(),
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    );
    const response = await assistant.query("u-physician", {
      prompt: "Zeige Team und @Fragen",
      patientId: null,
      purpose: "direct-care",
    });
    const parsed = createParser(clinicalAssistantLibrary.toJSONSchema()).parse(
      response.openUi,
    );

    expect(parsed.meta.errors).toEqual([]);
    expect(parsed.meta.unresolved).toEqual([]);
    expect(parsed.root?.typeName).toBe("ClinicalStack");
    expect(response.components).toEqual([
      expect.objectContaining({
        type: "TeamInbox",
        items: [expect.objectContaining({ response: "" })],
      }),
    ]);
  });
});
