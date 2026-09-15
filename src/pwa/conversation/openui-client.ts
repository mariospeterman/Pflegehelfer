import {
  vercelAIAdapter,
  type ChatLLM,
  type ChatStorage,
  type Message,
  type Thread,
} from "@openuidev/react-headless";
import { assistantClientContextHeaders } from "../assistant-context";
import {
  completedOpenUi,
  supersededOpenUi,
} from "./conversation-presentations";

interface ConversationResponse {
  turns: Array<{
    id: string;
    prompt: string;
    response: {
      openUi: string;
      components: Array<{ type: string; message?: string }>;
    };
    executionStatus?: "locally-accepted";
    proposalLifecycle?: {
      revision: number;
      status: "pending" | "superseded" | "consumed" | "expired";
    };
    createdAt?: string;
  }>;
  conversations: Array<{
    id: string;
    title: string;
    lastActivityAt: string;
    active: boolean;
  }>;
  context: {
    threadId: string;
    patientId: string | null;
    encounterId: string | null;
  };
}

interface PendingReviewResponse {
  pending: {
    responseId: string;
    response: ConversationResponse["turns"][number]["response"];
  } | null;
}

export interface VoiceSubmission {
  inputModality: "voice";
  voiceTranscriptConfirmed: true;
  voiceReceiptId: string;
  voiceConfirmedEntityIds: string[];
}

export interface SubmissionChannel {
  take(prompt: string): VoiceSubmission | null;
}

function requestHeaders(userId: string, write = false): HeadersInit {
  return {
    "x-demo-user": userId,
    ...assistantClientContextHeaders(),
    ...(write ? { "x-command-id": crypto.randomUUID() } : {}),
  };
}

async function readConversation(userId: string): Promise<ConversationResponse> {
  const response = await fetch("/api/v1/assistant/conversation", {
    headers: requestHeaders(userId),
  });
  const body = (await response.json()) as ConversationResponse & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(body.message ?? "Gespräch konnte nicht geladen werden.");
  return body;
}

function activeThread(body: ConversationResponse): Thread {
  const active = body.conversations.find((thread) => thread.active);
  if (!active || active.id !== body.context.threadId)
    throw new Error(
      "Der aktive Gesprächskontext ist nicht eindeutig gebunden.",
    );
  return {
    id: active.id,
    title: active.title,
    createdAt: active.lastActivityAt,
  };
}

export function createConversationStorage(userId: string): ChatStorage {
  return {
    thread: {
      async listThreads() {
        const body = await readConversation(userId);
        // Scope navigation is owned by Pflegehelfer's patient/team context
        // service. AgentInterface receives exactly the already-authorized
        // active thread; its generic thread list cannot switch patients.
        return { threads: [activeThread(body)] };
      },
      async createThread() {
        return activeThread(await readConversation(userId));
      },
      async getMessages(threadId: string): Promise<Message[]> {
        const body = await readConversation(userId);
        if (body.context.threadId !== threadId)
          throw new Error("Das Gespräch gehört nicht zum aktiven Kontext.");
        let pending: PendingReviewResponse["pending"] = null;
        if (body.context.patientId && body.context.encounterId) {
          const pendingResponse = await fetch(
            "/api/v1/assistant/pending-review",
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                ...requestHeaders(userId, true),
              },
              body: "{}",
            },
          );
          const result =
            (await pendingResponse.json()) as PendingReviewResponse & {
              message?: string;
            };
          if (!pendingResponse.ok)
            throw new Error(
              result.message ?? "Offene Prüfung konnte nicht geladen werden.",
            );
          pending = result.pending;
        }
        return body.turns.flatMap<Message>((turn) => [
          {
            role: "user",
            id: `user-${turn.id}`,
            content: [{ type: "text", text: turn.prompt }],
          },
          {
            role: "assistant",
            id: turn.id,
            ...(turn.proposalLifecycle
              ? {
                  name: `pflegehelfer-proposal:${turn.proposalLifecycle.status}:${turn.proposalLifecycle.revision}`,
                }
              : {}),
            content:
              turn.proposalLifecycle?.status === "consumed" ||
              turn.executionStatus === "locally-accepted"
                ? completedOpenUi
                : turn.proposalLifecycle?.status === "pending" &&
                    pending?.responseId === turn.id
                  ? pending.response.openUi
                  : turn.proposalLifecycle &&
                      turn.proposalLifecycle.status !== "pending"
                    ? supersededOpenUi
                    : turn.response.openUi,
          },
        ]);
      },
      async updateThread(thread: Thread) {
        const current = activeThread(await readConversation(userId));
        if (current.id !== thread.id)
          throw new Error("Gesprächskontext hat sich geändert.");
        return current;
      },
      deleteThread() {
        return Promise.reject(
          new Error(
            "Klinische Gespräche werden nach der geltenden Aufbewahrung verwaltet.",
          ),
        );
      },
    },
  };
}

function userText(message: Message | undefined): string {
  if (!message || message.role !== "user") return "";
  if (typeof message.content === "string") return message.content.trim();
  return message.content
    .filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

export function createConversationLlm(input: {
  userId: string;
  patientId: string | null;
  purpose: string;
  submissionChannel: SubmissionChannel;
}): ChatLLM {
  return {
    streamProtocol: vercelAIAdapter(),
    async send({ messages, signal }) {
      const prompt = userText(
        messages.findLast((item) => item.role === "user"),
      );
      if (prompt.length < 2)
        throw new Error("Bitte gib mindestens zwei Zeichen ein.");
      const voice = input.submissionChannel.take(prompt);
      return fetch("/api/v1/assistant/query/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...requestHeaders(input.userId, true),
        },
        body: JSON.stringify({
          prompt,
          patientId: input.patientId,
          purpose: input.purpose,
          inputModality: voice?.inputModality ?? "typed",
          ...(voice ?? {}),
        }),
        signal,
      });
    },
  };
}
