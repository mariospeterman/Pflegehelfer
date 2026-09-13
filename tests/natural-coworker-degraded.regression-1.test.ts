import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { AssistantService } from "../src/core/assistant-service.js";
import { PflegehelferService } from "../src/core/service.js";

describe("natural coworker degraded operation regression", () => {
  it("marks no-model operation honestly and preserves a basic-care report", async () => {
    const response = await new AssistantService(
      new PflegehelferService(),
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    ).query("u-assistant", {
      patientId: "p-luca",
      purpose: "direct-care",
      prompt: "Ich habe ihm beim Anziehen geholfen.",
      inputModality: "typed",
    });

    expect(response.runtime).toMatchObject({
      route: "safe-fallback",
      degraded: true,
      failure: "not-configured",
    });
    expect(response.components).toContainEqual(
      expect.objectContaining({
        type: "DraftAction",
        kind: "nursing-note",
        preview: expect.stringContaining(
          "Ich habe ihm beim Anziehen geholfen.",
        ),
      }),
    );
    expect(JSON.stringify(response.components)).not.toContain(
      "MedicationReadOnly",
    );
    expect(response.warnings.join(" ")).toContain(
      "freies Sprachverständnis ist nicht bestätigt",
    );
  });

  it("does not create a write review for an ordinary question", async () => {
    const response = await new AssistantService(
      new PflegehelferService(),
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    ).query("u-assistant", {
      patientId: "p-luca",
      purpose: "direct-care",
      prompt: "Was ist für Luca noch offen?",
      inputModality: "typed",
    });

    expect(
      response.components.some((component) => component.type === "DraftAction"),
    ).toBe(false);
  });
});
