import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";

afterEach(() => vi.unstubAllGlobals());

describe("model-facing OpenUI composition boundary", () => {
  it("supplies only opaque candidates and accepts a complete allowlisted program", async () => {
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        requestBody = typeof init?.body === "string" ? init.body : "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      'root = ClinicalStack([item2, item1])\nitem1 = Candidate("candidate-1")\nitem2 = Candidate("candidate-2")',
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
    const gateway = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: "x",
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "fixture",
    });
    const result = await gateway.composeOpenUi(["SafetyAlert", "VitalTrend"]);
    expect(result).toEqual({
      order: ["candidate-2", "candidate-1"],
      composedByModel: true,
      degraded: false,
    });
    expect(requestBody).toContain("candidate-1: SafetyAlert");
    expect(requestBody).not.toContain("intentToken");
    expect(requestBody).not.toContain("p-anna");
  });

  it("rejects extra model-authored content and falls back deterministically", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      'root = ClinicalStack([item1, item2])\nitem1 = Candidate("candidate-1")\nitem2 = Candidate("candidate-2")\njavascript: steal()',
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const result = await new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: "x",
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
    }).composeOpenUi(["PatientSummary", "TaskList"]);
    expect(result).toEqual({
      order: ["candidate-1", "candidate-2"],
      composedByModel: false,
      degraded: true,
    });
  });

  it("falls back immediately when hosted-test has no key", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
    }).composeOpenUi(["AssistantText", "DraftAction"]);
    expect(result).toEqual({
      order: ["candidate-1", "candidate-2"],
      composedByModel: false,
      degraded: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
