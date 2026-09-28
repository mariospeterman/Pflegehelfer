import { describe, expect, it } from "vitest";
import { AssistantService } from "../src/core/assistant-service.js";
import { PflegehelferService } from "../src/core/service.js";

describe("human GenUI labels", () => {
  // Regression: ISSUE-GENUI-001 — the care review card exposed an internal
  // planner identifier to clinical staff.
  // Found by /qa on 2026-09-09.
  // Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-09.md
  it("keeps model and compiler identifiers out of the care review", async () => {
    const assistant = new AssistantService(new PflegehelferService());
    const response = await assistant.query("u-assistant", {
      prompt:
        "Nur Morgenpflege erledigt, Mobilisation später. Arzt nicht informieren, keine weitere Kontrolle.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const review = response.components.find(
      (component) =>
        component.type === "DraftAction" && component.kind === "care-update",
    );

    expect(review).toMatchObject({
      sourceLabel: "Aus deiner Aussage · vor Übernahme sicher geprüft",
    });
    expect(JSON.stringify(response)).not.toMatch(
      /deterministic-clinical-planner|hosted-test|local-openai/i,
    );
  });
});
