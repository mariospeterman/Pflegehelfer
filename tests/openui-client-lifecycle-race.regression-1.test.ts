import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConversationLlm,
  createConversationStorage,
} from "../src/pwa/conversation/openui-client.js";
import { completedOpenUi } from "../src/pwa/conversation/conversation-presentations.js";

const conversation = (status: "pending" | "consumed") => ({
  turns: [
    {
      id: "response-1",
      prompt: "Mobilisiert und Blutdruck dokumentiert.",
      response: {
        openUi:
          'root = ClinicalStack([item0])\nitem0 = ClinicalCard("neutral", "Hinweis", "Diese frühere offene Änderung ist nicht mehr ausführbar.", "Archiv")',
        components: [{ type: "SafetyAlert" }],
      },
      ...(status === "consumed"
        ? { executionStatus: "locally-accepted" as const }
        : {}),
      proposalLifecycle: { revision: 1, status },
      createdAt: "2026-09-19T10:00:00.000Z",
    },
  ],
  conversations: [
    {
      id: "thread-1",
      title: "Anna Beispiel",
      lastActivityAt: "2026-09-19T10:00:00.000Z",
      active: true,
    },
  ],
  context: {
    threadId: "thread-1",
    patientId: "p-anna",
    encounterId: "enc-anna-2026",
  },
});

describe("OpenUI proposal lifecycle read consistency", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("re-reads a pending turn when execution consumes authority between reads", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(conversation("pending")))
      .mockResolvedValueOnce(Response.json({ pending: null }))
      .mockResolvedValueOnce(Response.json(conversation("consumed")));
    vi.stubGlobal("fetch", fetchMock);

    const messages =
      await createConversationStorage("u-assistant").thread.getMessages(
        "thread-1",
      );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(messages.at(-1)).toMatchObject({
      role: "assistant",
      name: "pflegehelfer-proposal:consumed:1",
      content: completedOpenUi,
    });
  });
});

describe("OpenUI assistant request identity", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reuses the command id when the same user message is retried", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const llm = createConversationLlm({
      userId: "u-assistant",
      patientId: null,
      purpose: "care-delivery",
      submissionChannel: { take: () => null },
    });
    const messages = [
      {
        id: "client-user-message-1",
        role: "user" as const,
        content: [{ type: "text" as const, text: "Zeige meine Aufgaben." }],
      },
    ];

    await llm.send({ messages } as Parameters<typeof llm.send>[0]);
    await llm.send({ messages } as Parameters<typeof llm.send>[0]);

    const first = new Headers(fetchMock.mock.calls[0]![1]?.headers).get(
      "x-command-id",
    );
    const second = new Headers(fetchMock.mock.calls[1]![1]?.headers).get(
      "x-command-id",
    );
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(second).toBe(first);
  });

  it("surfaces the localized recovery message instead of an internal error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: "VERSION_CONFLICT",
            message: "Die Quelldaten haben sich geändert. Bitte erneut prüfen.",
            requestId: "synthetic-request-id",
          },
          { status: 409 },
        ),
      ),
    );
    const llm = createConversationLlm({
      userId: "u-assistant",
      patientId: "p-anna",
      purpose: "direct-care",
      submissionChannel: { take: () => null },
    });
    const messages = [
      {
        id: "client-user-message-stale",
        role: "user" as const,
        content: [{ type: "text" as const, text: "Was ist noch offen?" }],
      },
    ];

    await expect(
      llm.send({ messages } as Parameters<typeof llm.send>[0]),
    ).rejects.toThrow("Die Quelldaten haben sich geändert");
  });

  it("does not expose an untrusted upstream JSON error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { message: "upstream gateway implementation detail" },
            { status: 502 },
          ),
        ),
    );
    const llm = createConversationLlm({
      userId: "u-assistant",
      patientId: "p-anna",
      purpose: "direct-care",
      submissionChannel: { take: () => null },
    });
    await expect(
      llm.send({
        messages: [
          {
            id: "client-user-message-upstream",
            role: "user" as const,
            content: [{ type: "text" as const, text: "Was ist noch offen?" }],
          },
        ],
      } as Parameters<typeof llm.send>[0]),
    ).rejects.toThrow("Das Gespräch konnte nicht fortgesetzt werden");
  });
});
