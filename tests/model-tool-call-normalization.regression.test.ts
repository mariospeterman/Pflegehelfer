import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";

afterEach(() => vi.unstubAllGlobals());

describe("hosted tool-call normalization regression", () => {
  it("discards premature prose and citations while retaining the bounded read call", async () => {
    const testCredential = ["synthetic", "key"].join("-");
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
