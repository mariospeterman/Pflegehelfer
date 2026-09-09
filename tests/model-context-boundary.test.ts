import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { validateLocalAiEndpoint } from "../src/ai/local-endpoint-policy.js";

afterEach(() => vi.unstubAllGlobals());

const syntheticContext = {
  organizationLabel: "Kronenhof Demo",
  actorRole: "registered-nurse",
  workflowStep: "document",
  activeEpisodeTitle: "Morgenpflege",
  recentPrompts: ["Mobilisation später durchführen."],
  dataClass: "synthetic-demo" as const,
};

describe("authorized model context boundary", () => {
  it("does not implicitly trust link-local metadata endpoints", () => {
    expect(() =>
      validateLocalAiEndpoint("http://169.254.169.254/latest", {}),
    ).toThrow("LOCAL_AI_ENDPOINT_NOT_ALLOWED");
    expect(() =>
      validateLocalAiEndpoint("http://[fe80::1]/metadata", {}),
    ).toThrow("LOCAL_AI_ENDPOINT_NOT_ALLOWED");
  });

  it("sends bounded synthetic workflow context for an ambiguous follow-up", async () => {
    let requestBody = "";
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        requestBody = typeof init?.body === "string" ? init.body : "";
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"intent":"care-update"}' } }],
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
    const result = await gateway.classify(
      "Doch erst nach dem Frühstück.",
      syntheticContext,
    );
    expect(result.intent).toBe("care-update");
    expect(requestBody).toContain("Mobilisation später durchführen");
    expect(requestBody).toContain("registered-nurse");
    expect(requestBody).not.toContain("intentToken");
    expect(requestBody).not.toContain("p-anna");
  });

  it("refuses hosted inference without synthetic runtime provenance", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const gateway = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: "x",
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
    });
    const result = await gateway.classify("Doch erst später.", {
      ...syntheticContext,
      dataClass: "institution-local",
    });
    expect(result).toMatchObject({ intent: "unknown", degraded: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
