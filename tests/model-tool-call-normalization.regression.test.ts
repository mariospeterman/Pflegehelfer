import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";

afterEach(() => vi.unstubAllGlobals());
const testCredential = ["synthetic", "key"].join("-");

describe("hosted tool-call normalization regression", () => {
  it("uses the provider native strict function boundary for an authorized read", async () => {
    let requestBody: Record<string, unknown> | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected a serialized request body.");
        requestBody = JSON.parse(init.body) as Record<string, unknown>;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "resp_synthetic_native_tool",
              output: [
                {
                  type: "function_call",
                  call_id: "call_synthetic",
                  name: "get_patient_summary",
                  arguments: "{}",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
    const adapter = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: testCredential,
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "gpt-5.6-mini",
    }).agentAdapter();
    await expect(
      adapter.next({
        instructions: ["Use only authorized reads."],
        skills: [],
        userRequest: "Zeige die Übersicht.",
        turns: [],
        tools: [
          {
            name: "get_patient_summary",
            version: 1,
            description: "Read the authorized patient summary.",
            effect: "read",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      kind: "tool-call",
      toolName: "get_patient_summary",
      input: {},
    });
    const body = requestBody as unknown as {
      tools: Array<{
        type: string;
        name: string;
        strict: boolean;
        parameters: Record<string, unknown>;
      }>;
      parallel_tool_calls: boolean;
    };
    expect(body.parallel_tool_calls).toBe(false);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0]?.type).toBe("function");
    expect(body.tools[0]?.name).toBe("get_patient_summary");
    expect(body.tools[0]?.strict).toBe(true);
    expect(body.tools[0]?.parameters.additionalProperties).toBe(false);
  });

  it("places one explicit cache boundary after every stable instruction", async () => {
    let requestBody: Record<string, unknown> | null = null;
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
    const adapter = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: testCredential,
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "gpt-5.6-mini",
    }).agentAdapter();
    await adapter.next({
      instructions: ["Institution stable.", "Ward stable."],
      skills: [],
      userRequest: "Hallo",
      turns: [],
      tools: [],
      signal: new AbortController().signal,
    });
    const body = requestBody as unknown as {
      prompt_cache_key?: string;
      prompt_cache_options?: { mode?: string };
      reasoning?: { effort?: string };
      max_output_tokens?: number;
      text?: { verbosity?: string };
      input: Array<{
        role: string;
        content: Array<{ prompt_cache_breakpoint?: { mode?: string } }>;
      }>;
    };
    expect(body.prompt_cache_key).toMatch(/^pfh-[a-f0-9]{40}$/);
    expect(body.prompt_cache_options).toEqual({ mode: "explicit" });
    expect(body.reasoning).toEqual({ effort: "none" });
    expect(body.max_output_tokens).toBe(1_400);
    expect(body.text?.verbosity).toBe("low");
    expect(
      body.input
        .flatMap((message) => message.content)
        .filter((content) => content.prompt_cache_breakpoint),
    ).toHaveLength(1);
    expect(body.input[2]?.content[0]?.prompt_cache_breakpoint).toEqual({
      mode: "explicit",
    });
    expect(body.input.at(-1)?.role).toBe("user");
  });

  it("discards premature prose and citations while retaining the bounded read call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              output_text: JSON.stringify({
                kind: "tool-call",
                toolName: null,
                input: null,
                text: "Ich schaue den freigegebenen Kontext nach.",
                draftReferenceId: "premature-reference",
                sourceReferenceIds: ["premature-source"],
                evidenceClaims: [
                  {
                    referenceId: "premature-source",
                    path: "patient.name",
                    value: "Nicht geprüft",
                  },
                ],
                presentation: {
                  kind: "text",
                  sourceReferenceId: null,
                  title: null,
                  collectionPath: null,
                  columns: [],
                  xPath: null,
                  yPath: null,
                  labelPath: null,
                },
              }),
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const adapter = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: testCredential,
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "fixture",
    }).agentAdapter();

    await expect(
      adapter.next({
        instructions: ["Use only authorized reads."],
        skills: [],
        userRequest: "Zeige den freigegebenen Kontext.",
        turns: [{ role: "user", content: "Zeige den freigegebenen Kontext." }],
        tools: [
          {
            name: "get_patient_summary",
            version: 1,
            description: "Read the authorized patient summary.",
            effect: "read",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      kind: "tool-call",
      toolName: "get_patient_summary",
      input: {},
    });
  });
});
