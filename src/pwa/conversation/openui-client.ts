import {
  vercelAIAdapter,
  type ChatLLM,
  type ChatStorage,
  type Message,
  type Thread,
} from "@openuidev/react-headless";
import { assistantClientContextHeaders } from "../assistant-context";
import { authenticatedFetch, requestIntegrityHeaders } from "../auth";
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
  take(prompt: string, operationId: string): VoiceSubmission | null;
}

async function deterministicOperationId(envelope: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(envelope)),
  ).slice(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function requestHeaders(
  userId: string,
  write = false,
  commandId?: string,
): HeadersInit {
  return {
    "x-demo-user": userId,
    ...assistantClientContextHeaders(),
    ...(write ? { "x-command-id": commandId ?? crypto.randomUUID() } : {}),
    ...requestIntegrityHeaders(write ? "POST" : "GET"),
  };
}

async function readConversation(userId: string): Promise<ConversationResponse> {
  const response = await authenticatedFetch("/api/v1/assistant/conversation", {
    headers: requestHeaders(userId),
  });
  const body = (await response.json()) as ConversationResponse & {
    message?: string;
  };
  if (!response.ok)
    throw new Error(body.message ?? "Gespräch konnte nicht geladen werden.");
  return body;
}

function hasUnresolvedPendingTurn(body: ConversationResponse): boolean {
  return body.turns.some(
    (turn) => turn.proposalLifecycle?.status === "pending",
  );
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
        let body = await readConversation(userId);
        if (body.context.threadId !== threadId)
          throw new Error("Das Gespräch gehört nicht zum aktiven Kontext.");
        let pending: PendingReviewResponse["pending"] = null;
        if (body.context.patientId && body.context.encounterId) {
          const pendingResponse = await authenticatedFetch(
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
          // Conversation history and the short-lived review authority are
          // deliberately separate reads. Execution can commit between them:
          // the first read then says `pending` while the second correctly
          // returns no authority. Re-read the explicit lifecycle once so a
          // consumed revision renders as completed instead of as an archived
          // stale draft. If it is still pending, the safe archived response
          // remains in place and no control is reconstructed.
          if (!pending && hasUnresolvedPendingTurn(body))
            body = await readConversation(userId);
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
      const userMessage = messages.findLast((item) => item.role === "user");
      const operationEnvelope = [
        input.userId,
        input.patientId ?? "no-patient",
        input.purpose,
        userMessage?.id ?? "missing",
        prompt,
      ].join("\u001f");
      const commandId = await deterministicOperationId(operationEnvelope);
      const voice = input.submissionChannel.take(prompt, commandId);
      const response = await authenticatedFetch(
        "/api/v1/assistant/query/stream",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...requestHeaders(input.userId, true, commandId),
          },
          body: JSON.stringify({
            prompt,
            patientId: input.patientId,
            purpose: input.purpose,
            inputModality: voice?.inputModality ?? "typed",
            ...(voice ?? {}),
          }),
          signal,
        },
      );
      if (!response.ok) {
        const failure = (await response.json().catch(() => null)) as {
          error?: string;
          message?: string;
          requestId?: string;
        } | null;
        const trustedServerMessage =
          typeof failure?.error === "string" &&
          typeof failure.requestId === "string" &&
          typeof failure.message === "string"
            ? failure.message
            : null;
        throw new Error(
          trustedServerMessage ??
            "Das Gespräch konnte nicht fortgesetzt werden. Bitte aktualisiere den Arbeitskontext und versuche es erneut.",
        );
      }
      return response;
    },
  };
}
