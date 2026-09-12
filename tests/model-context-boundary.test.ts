import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ModelGateway,
  toStrictStructuredOutputSchema,
} from "../src/ai/model-gateway.js";
import { validateLocalAiEndpoint } from "../src/ai/local-endpoint-policy.js";
import {
  assistantProposalSchema,
  deterministicAssistantProposal,
} from "../src/ai/assistant-proposal.js";

afterEach(() => vi.unstubAllGlobals());

const syntheticContext = {
  organizationLabel: "Kronenhof Demo",
  actorRole: "registered-nurse",
  workflowStep: "document",
  activeEpisodeTitle: "Morgenpflege",
  recentPrompts: ["Mobilisation später durchführen."],
  recentConversation: [
    { role: "user" as const, text: "Mobilisation später durchführen." },
    {
      role: "assistant" as const,
      text: "Verstanden, Mobilisation bleibt offen.",
    },
  ],
  dataClass: "synthetic-demo" as const,
};

describe("authorized model context boundary", () => {
  it("emits an OpenAI strict-compatible schema without weakening domain validation", () => {
    const schema = toStrictStructuredOutputSchema(
      // The transport schema is deliberately derived from, but distinct from,
      // the authoritative domain schema.
      z.toJSONSchema(assistantProposalSchema),
    );
    const inspect = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(inspect);
        return;
      }
      if (!node || typeof node !== "object") return;
      const object = node as Record<string, unknown>;
      if (object.type === "object" && object.properties) {
        const keys = Object.keys(object.properties);
        expect(object.additionalProperties).toBe(false);
        expect(new Set(object.required as string[])).toEqual(new Set(keys));
      }
      Object.values(object).forEach(inspect);
    };
    inspect(schema);
  });
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
            JSON.stringify({ output_text: '{"intent":"care-update"}' }),
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
    expect(requestBody).toContain("Mobilisation bleibt offen");
    expect(requestBody).toContain("registered-nurse");
    expect(requestBody).not.toContain("intentToken");
    expect(requestBody).not.toContain("p-anna");
    expect(requestBody).toContain('"store":false');
    expect(requestBody).toContain('"input"');
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

  it.each([
    {
      label: "refusal",
      response: new Response(
        JSON.stringify({
          status: "completed",
          output: [{ content: [{ type: "refusal", refusal: "not allowed" }] }],
        }),
        { status: 200 },
      ),
      code: "refusal",
    },
    {
      label: "incomplete response",
      response: new Response(
        JSON.stringify({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
        }),
        { status: 200 },
      ),
      code: "incomplete",
    },
    {
      label: "rate limit",
      response: new Response("{}", { status: 429 }),
      code: "rate-limited",
    },
  ])(
    "reports $label distinctly while keeping the safe compiler available",
    async ({ response, code }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(response.clone())),
      );
      const result = await new ModelGateway({
        PFH_AI_MODE: "hosted-test",
        PFH_DEMO_MODE: "true",
        PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
        PFH_ALLOW_EXTERNAL_AI: "true",
        PFH_LLM_API_KEY: "x",
        PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      }).planCareUpdate(
        "Luca mobilisiert, fast alles gegessen, ca. 200 ml getrunken.",
        syntheticContext,
      );
      expect(result.plan).not.toBeNull();
      expect(result).toMatchObject({ degraded: true, failure: { code } });
    },
  );

  it("runs a real, non-writing synthetic model contract test", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected a serialized model request");
        const body = JSON.parse(init.body) as {
          messages: Array<{ role: string; content: string }>;
        };
        const prompt = body.messages.find(
          (message) => message.role === "user",
        )?.content;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify(
                      deterministicAssistantProposal(prompt ?? ""),
                    ),
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
    const result = await new ModelGateway({
      PFH_AI_MODE: "local-openai",
      PFH_DEMO_MODE: "true",
      PFH_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      PFH_LLM_MODEL: "local-test-model",
    }).testSynthetic();
    expect(result).toMatchObject({
      ready: true,
      mode: "local-openai",
      model: "local-test-model",
      dataBoundary: "local-network",
    });
  });
});
