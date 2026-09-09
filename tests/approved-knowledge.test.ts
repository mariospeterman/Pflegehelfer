import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovedKnowledgeService } from "../src/ai/approved-knowledge.js";
import { ModelGateway } from "../src/ai/model-gateway.js";

afterEach(() => vi.unstubAllGlobals());

describe("approved local knowledge and deep-model boundary", () => {
  it("retrieves only current, role-approved documents with governance metadata", async () => {
    const service = new ApprovedKnowledgeService([], {
      PFH_DEEP_LLM_MODE: "deterministic",
    });
    expect(service.status()).toMatchObject({
      mode: "deterministic",
      documentCount: 0,
    });

    const knowledge = new ApprovedKnowledgeService(undefined, {
      PFH_DEEP_LLM_MODE: "deterministic",
    });
    const result = await knowledge.answer(
      "Welche Richtlinie gilt bei einer Medikationsdiskrepanz?",
      "registered-nurse",
      new Date("2026-09-05T12:00:00.000Z"),
    );
    expect(result.mode).toBe("deterministic-retrieval");
    expect(result.citations).toEqual([
      expect.objectContaining({
        id: "sop-medication-discrepancy",
        version: "1.0.0-demo",
      }),
    ]);
    expect(typeof result.citations[0]?.owner).toBe("string");
    expect(result.answer).toContain("keine Dosis");
  });

  it("does not expose the clinical corpus to a non-clinical role", async () => {
    const knowledge = new ApprovedKnowledgeService(undefined, {
      PFH_DEEP_LLM_MODE: "deterministic",
    });
    const result = await knowledge.answer(
      "Vorgehen nach Sturz",
      "it",
      new Date("2026-09-05T12:00:00.000Z"),
    );
    expect(result.citations).toEqual([]);
    expect(result.answer).toContain("keine passende Richtlinie");
  });

  it("rejects unsupported model citations and fails closed to extractive evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      citations: ["not-an-approved-document"],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const knowledge = new ApprovedKnowledgeService(undefined, {
      PFH_DEEP_LLM_MODE: "local-openai",
      PFH_DEEP_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      PFH_DEEP_LLM_MODEL: "test-model",
      PFH_DEMO_MODE: "true",
    });
    const result = await knowledge.answer(
      "Welche SOP gilt bei Medikationsdiskrepanz?",
      "registered-nurse",
      new Date("2026-09-05T12:00:00.000Z"),
    );
    expect(result).toMatchObject({
      mode: "deterministic-retrieval",
      degraded: true,
    });
    expect(result.answer).not.toContain("Invented answer");
    expect(result.citations[0]?.id).toBe("sop-medication-discrepancy");
  });

  it("displays only approved content for a valid model-selected citation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      citations: ["sop-medication-discrepancy"],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const knowledge = new ApprovedKnowledgeService(undefined, {
      PFH_DEEP_LLM_MODE: "local-openai",
      PFH_DEEP_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      PFH_DEMO_MODE: "true",
    });
    const result = await knowledge.answer(
      "Welche SOP gilt bei Medikationsdiskrepanz?",
      "registered-nurse",
      new Date("2026-09-05T12:00:00.000Z"),
    );
    expect(result.answer).toContain("keine Dosis");
    expect(result.answer).not.toContain("100 mg");
    expect(result).toMatchObject({ mode: "local-deep-llm", degraded: false });
  });

  it("rejects a model-authored answer field even with a valid citation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      answer: "Torasemid sofort auf 100 mg erhöhen.",
                      citations: ["sop-medication-discrepancy"],
                    }),
                  },
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );
    const result = await new ApprovedKnowledgeService(undefined, {
      PFH_DEEP_LLM_MODE: "local-openai",
      PFH_DEEP_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      PFH_DEMO_MODE: "true",
    }).answer(
      "Welche SOP gilt bei Medikationsdiskrepanz?",
      "registered-nurse",
      new Date("2026-09-05T12:00:00.000Z"),
    );
    expect(result.answer).toContain("keine Dosis");
    expect(result.answer).not.toContain("100 mg");
    expect(result).toMatchObject({
      mode: "deterministic-retrieval",
      degraded: true,
    });
  });

  it("rejects public endpoints masquerading as local AI", () => {
    expect(
      () =>
        new ModelGateway({
          PFH_AI_MODE: "local-openai",
          PFH_LLM_BASE_URL: "https://attacker.invalid/v1",
        }),
    ).toThrow(/LOCAL_AI_ENDPOINT_NOT_ALLOWED/);
    expect(
      () =>
        new ApprovedKnowledgeService(undefined, {
          PFH_DEEP_LLM_MODE: "local-openai",
          PFH_DEEP_LLM_BASE_URL: "https://attacker.invalid/v1",
        }),
    ).toThrow(/LOCAL_AI_ENDPOINT_NOT_ALLOWED/);
  });

  it("requires an immutable deep-model digest outside demo mode", () => {
    expect(
      () =>
        new ApprovedKnowledgeService(undefined, {
          PFH_DEEP_LLM_MODE: "local-openai",
          PFH_DEEP_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
          PFH_DEMO_MODE: "false",
        }),
    ).toThrow(/PFH_DEEP_LLM_MODEL_DIGEST/);
  });

  it("routes explicit policy language without requiring a model", async () => {
    await expect(
      new ModelGateway({ PFH_AI_MODE: "deterministic" }).classify(
        "Was gilt laut SOP nach einem Sturz?",
      ),
    ).resolves.toMatchObject({ intent: "knowledge-query" });
  });

  it("prefers an explicit SOP query over the medication action guard", async () => {
    await expect(
      new ModelGateway({ PFH_AI_MODE: "deterministic" }).classify(
        "Welche Richtlinie gilt bei einer Medikationsdiskrepanz?",
      ),
    ).resolves.toMatchObject({ intent: "knowledge-query" });
  });

  it("accepts only the exact local classifier contract", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"intent":"patient-summary"}' } }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const gateway = new ModelGateway({
      PFH_AI_MODE: "local-openai",
      PFH_DEMO_MODE: "true",
      PFH_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      PFH_LLM_MODEL: "local-test-model",
    });
    await expect(
      gateway.classify("Was braucht diese Person heute besonders?"),
    ).resolves.toMatchObject({
      intent: "patient-summary",
      model: "local-test-model",
      degraded: false,
    });
    const requestBody = fetchMock.mock.calls[0]?.[1]?.body;
    if (typeof requestBody !== "string")
      throw new Error("Expected a serialized model request");
    const request = JSON.parse(requestBody) as {
      max_tokens: number;
      messages: { content: string }[];
    };
    expect(request.max_tokens).toBe(40);
    expect(request.messages[0]?.content).toContain("exact shape");
  });

  it("fails closed when a classifier adds unconsumed fields", async () => {
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
                      '{"intent":"patient-summary","instruction":"write-directly"}',
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
      PFH_AI_MODE: "local-openai",
      PFH_DEMO_MODE: "true",
      PFH_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
      PFH_LLM_MODEL: "local-test-model",
    }).classify("Was braucht diese Person heute besonders?");
    expect(result).toMatchObject({ intent: "unknown", degraded: true });
  });
});
