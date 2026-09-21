import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ModelGateway,
  toStrictStructuredOutputSchema,
} from "../src/ai/model-gateway.js";
import { validateLocalAiEndpoint } from "../src/ai/local-endpoint-policy.js";
import { assistantProposalSchema } from "../src/ai/assistant-proposal.js";

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

  it("does not emit dynamic additional-properties schemas for agent tool input", async () => {
    let requestBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected a serialized request body.");
        requestBody = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                kind: "conversation",
                toolName: null,
                input: null,
                text: "Gern.",
                draftReferenceId: null,
                sourceReferenceIds: [],
                evidenceClaims: [],
                presentation: null,
              }),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
    await new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: "x",
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "fixture",
    }).testSynthetic();
    const schema = (
      requestBody?.text as {
        format?: { schema?: Record<string, unknown> };
      }
    )?.format?.schema;
    expect(schema).toBeDefined();
    const dynamicObjects: string[] = [];
    const inspect = (node: unknown, path = "$"): void => {
      if (Array.isArray(node)) {
        node.forEach((value, index) => inspect(value, `${path}[${index}]`));
        return;
      }
      if (!node || typeof node !== "object") return;
      const object = node as Record<string, unknown>;
      if (object.type === "object" && object.additionalProperties !== false)
        dynamicObjects.push(path);
      Object.entries(object).forEach(([key, value]) =>
        inspect(value, `${path}.${key}`),
      );
    };
    inspect(schema);
    expect(dynamicObjects).toEqual([]);
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

  it("enforces the hosted-demo hourly call ceiling before transport", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ output_text: '{"intent":"unknown"}' }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const gateway = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: "x",
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_HOSTED_AI_MAX_CALLS_PER_HOUR: "1",
    });

    await expect(
      gateway.classify("Das von gestern bitte nochmals.", syntheticContext),
    ).resolves.toMatchObject({ degraded: false });
    await expect(
      gateway.classify("Danach gleich weiter.", syntheticContext),
    ).resolves.toMatchObject({
      degraded: true,
      failure: { code: "rate-limited" },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("cancels an in-flight configured model request when the caller disconnects", async () => {
    let sawModelAbort = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const modelSignal = init?.signal;
        return new Promise<Response>((_resolve, reject) => {
          modelSignal?.addEventListener(
            "abort",
            () => {
              sawModelAbort = true;
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          );
        });
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
    const caller = new AbortController();
    const pending = gateway.classify(
      "Doch erst nach dem Frühstück.",
      syntheticContext,
      caller.signal,
    );

    caller.abort("client-disconnected");

    await expect(pending).resolves.toMatchObject({
      intent: "unknown",
      degraded: true,
      failure: { code: "timeout" },
    });
    expect(sawModelAbort).toBe(true);
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

  it("runs transport and authorized-read acceptance through the interactive agent runtime", async () => {
    const localRequestBodies: Array<Record<string, unknown>> = [];
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected a serialized model request");
        const body = JSON.parse(init.body) as Record<string, unknown>;
        localRequestBodies.push(body);
        const serialized = JSON.stringify(body);
        const referenceId = serialized.match(
          /EvidenceResult\/get_open_tasks\/[A-Za-z0-9-]+/,
        )?.[0];
        const outputs = [
          {
            kind: "conversation",
            toolName: null,
            input: null,
            text: "Gern, das freut mich.",
            draftReferenceId: null,
            sourceReferenceIds: [],
            evidenceClaims: [],
            presentation: null,
          },
          {
            kind: "tool-call",
            toolName: "get_open_tasks",
            input: {},
            text: null,
            draftReferenceId: null,
            sourceReferenceIds: [],
            evidenceClaims: [],
            presentation: null,
          },
          {
            kind: "answer",
            toolName: null,
            input: null,
            text: "Die synthetische Rückfrage ist offen.",
            draftReferenceId: null,
            sourceReferenceIds: referenceId ? [referenceId] : [],
            evidenceClaims: referenceId
              ? [
                  {
                    referenceId,
                    path: "tasks.0.patientLabel",
                    value: "Synthetische Person",
                  },
                  {
                    referenceId,
                    path: "tasks.0.title",
                    value: "Synthetische Rückfrage prüfen",
                  },
                  {
                    referenceId,
                    path: "tasks.0.state",
                    value: "accepted",
                  },
                ]
              : [],
            presentation: null,
          },
        ];
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify(outputs[call++]),
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
      fallbackUsed: false,
      probes: [
        expect.objectContaining({
          stage: "transport-smoke",
          ready: true,
          toolCalls: 0,
        }),
        expect.objectContaining({
          stage: "application-read",
          ready: true,
          toolCalls: 1,
        }),
      ],
    });
    expect(localRequestBodies[0]).toMatchObject({
      response_format: { type: "json_object" },
    });
    expect(
      (
        localRequestBodies[0] as unknown as {
          messages: Array<{ role: string; content: string }>;
        }
      ).messages.some(
        ({ role, content }) =>
          role === "system" &&
          content.includes("Return one JSON object matching this exact schema"),
      ),
    ).toBe(true);
    expect(JSON.stringify(localRequestBodies)).not.toContain(
      "assistant_proposal_v3",
    );
  });

  it("fails connected acceptance with a sanitized provider cause and no fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: "invalid_api_key",
                type: "invalid_request_error",
                message: "credential value must never escape diagnostics",
              },
            }),
            {
              status: 401,
              headers: {
                "content-type": "application/json",
                "x-request-id": "req_synthetic_123",
              },
            },
          ),
        ),
      ),
    );
    const result = await new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: ["fixture", "only"].join("-"),
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "gpt-test",
    }).testSynthetic();

    expect(result).toMatchObject({
      ready: false,
      model: "gpt-test",
      fallbackUsed: false,
      probes: [
        expect.objectContaining({
          stage: "transport-smoke",
          ready: false,
        }),
      ],
      failure: {
        stage: "provider",
        code: "authentication",
        httpStatus: 401,
        providerCode: "invalid_api_key",
        providerType: "invalid_request_error",
        requestId: "req_synthetic_123",
        fallbackUsed: false,
      },
    });
    expect(JSON.stringify(result)).not.toContain("credential value");
  });

  it("pauses new inference at the organization limit without calling the provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const result = await new ModelGateway(
      {
        PFH_AI_MODE: "hosted-test",
        PFH_DEMO_MODE: "true",
        PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
        PFH_ALLOW_EXTERNAL_AI: "true",
        PFH_LLM_API_KEY: "x",
        PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
        PFH_LLM_MODEL: "fixture",
      },
      {
        canStartNewInference: () =>
          Promise.resolve({
            allowed: false,
            reason: "organization-ai-spending-limit-reached",
          }),
        recordProviderUsage: () => Promise.resolve(),
      },
    ).testSynthetic();
    expect(result).toMatchObject({
      ready: false,
      fallbackUsed: false,
      failure: {
        stage: "request",
        code: "rate-limited",
        message: "organization-ai-spending-limit-reached",
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records idempotent provider-reported token categories after a successful response", async () => {
    const receipts: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp_synthetic_usage_1",
              output_text: JSON.stringify({
                kind: "conversation",
                toolName: null,
                input: null,
                text: "Gern.",
                draftReferenceId: null,
                sourceReferenceIds: [],
                evidenceClaims: [],
                presentation: null,
              }),
              usage: {
                input_tokens: 120,
                input_tokens_details: { cached_tokens: 20 },
                output_tokens: 12,
                total_tokens: 132,
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const gateway = new ModelGateway(
      {
        PFH_AI_MODE: "hosted-test",
        PFH_DEMO_MODE: "true",
        PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
        PFH_ALLOW_EXTERNAL_AI: "true",
        PFH_LLM_API_KEY: "x",
        PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
        PFH_LLM_MODEL: "fixture",
      },
      {
        canStartNewInference: () =>
          Promise.resolve({ allowed: true, reason: "available" }),
        recordProviderUsage: (receipt) => {
          receipts.push(receipt);
          return Promise.resolve();
        },
      },
    );
    await gateway.testSynthetic();
    expect(receipts[0]).toMatchObject({
      receiptId: "resp_synthetic_usage_1",
      source: "provider-reported",
      quantities: [
        { unit: "input-token", quantity: 100 },
        { unit: "cached-input-token", quantity: 20 },
        { unit: "output-token", quantity: 12 },
      ],
      providerOutcome: "completed",
    });
  });
});
