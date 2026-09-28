import { afterEach, describe, expect, it, vi } from "vitest";
import { createConversationStorage } from "../src/pwa/conversation/openui-client.js";
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
