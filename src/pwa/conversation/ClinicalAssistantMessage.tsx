import { createContext, useContext, useState, type ReactNode } from "react";
import {
  createParser,
  Renderer,
  type ActionEvent,
} from "@openuidev/react-lang";
import { useThread, type AssistantMessage } from "@openuidev/react-headless";
import type { Patient } from "../../core/types";
import { clinicalAssistantLibrary } from "../assistant/clinical-library";
import { assistantClientContextHeaders } from "../assistant-context";
import {
  completedOpenUi,
  supersededOpenUi,
} from "./conversation-presentations";

export interface AssistantHandoff {
  kind: "task" | "communication";
  patientId: string;
  title: string;
  reason: string;
  recipientRole?:
    | "registered-nurse"
    | "physician"
    | "pharmacy"
    | "physiotherapy"
    | "occupational-therapy";
  recipientId?: string | null;
  recipientLabel?: string;
  dueAt: string;
}

interface ConversationActions {
  userId: string;
  patient: Patient | null;
  onPatient: (patientId: string) => void;
  onHandoff: (handoff: AssistantHandoff) => void;
  onExecuted: (message: string, activePatientId?: string) => Promise<void>;
  onError: (message: string | null) => void;
}

const ActionsContext = createContext<ConversationActions | null>(null);

export function ConversationActionsProvider({
  value,
  children,
}: {
  value: ConversationActions;
  children: ReactNode;
}) {
  return (
    <ActionsContext.Provider value={value}>{children}</ActionsContext.Provider>
  );
}

async function post<T>(
  path: string,
  userId: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-demo-user": userId,
      ...assistantClientContextHeaders(),
      "x-command-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { message?: string };
  if (!response.ok)
    throw new Error(result.message ?? "Assistenzaktion fehlgeschlagen.");
  return result;
}

export function ClinicalAssistantMessage({
  message,
  isStreaming,
}: {
  message: AssistantMessage;
  isStreaming: boolean;
}) {
  const actions = useContext(ActionsContext);
  const { updateMessage, isRunning, messages } = useThread();
  const [busy, setBusy] = useState(false);
  if (!actions) throw new Error("ConversationActionsProvider fehlt.");
  const source = message.content ?? "";
  const latestDraftSource = messages.findLast(
    (item) =>
      item.role === "assistant" &&
      typeof item.content === "string" &&
      item.content.includes("DraftActionCard("),
  )?.content;
  const archived =
    source.includes("DraftActionCard(") && latestDraftSource !== source;
  const renderedSource = archived ? supersededOpenUi : source;
  const parsed = createParser(clinicalAssistantLibrary.toJSONSchema()).parse(
    renderedSource,
  );
  const renderable = Boolean(
    parsed.root &&
    parsed.meta.errors.length === 0 &&
    (!isStreaming || parsed.meta.unresolved.length === 0),
  );

  const handleAction = async (event: ActionEvent) => {
    if (busy || isRunning) return;
    if (
      String(event.type) === "SelectPatient" &&
      typeof event.params.patientId === "string"
    ) {
      actions.onPatient(event.params.patientId);
      return;
    }
    if (
      String(event.type) === "TransitionCommunication" &&
      typeof event.params.id === "string" &&
      ["acknowledge", "answer", "close"].includes(
        String(event.params.transition),
      )
    ) {
      const transition = String(event.params.transition);
      setBusy(true);
      actions.onError(null);
      try {
        await post(
          `/api/v1/communications/${encodeURIComponent(event.params.id)}/${transition}`,
          actions.userId,
          {
            ...(typeof event.params.response === "string" &&
            event.params.response.trim()
              ? { response: event.params.response.trim() }
              : {}),
            createTask: false,
          },
        );
        updateMessage({ ...message, content: completedOpenUi });
        await actions.onExecuted("Teamfrage wurde aktualisiert.");
      } catch (error) {
        actions.onError(
          error instanceof Error ? error.message : "Teamfrage fehlgeschlagen.",
        );
      } finally {
        setBusy(false);
      }
      return;
    }

    const token = event.params.intentToken;
    if (typeof token !== "string" || !actions.patient) return;
    setBusy(true);
    actions.onError(null);
    try {
      const result = await post<{
        handoff?: AssistantHandoff;
        bundle?: unknown;
        itemStates?: string[];
        workflowChanged?: boolean;
        activePatientId?: string;
      }>(`/api/v1/assistant/intents/${token}/execute`, actions.userId, {
        patientId: actions.patient.id,
        encounterId: actions.patient.encounterId,
        purpose: "direct-care",
        resourceVersion: actions.patient.source.version,
        explicitlyConfirmed: true,
        reviewedActionIds: Array.isArray(event.params.reviewedActionIds)
          ? event.params.reviewedActionIds
          : undefined,
      });
      updateMessage({ ...message, content: completedOpenUi });
      if (result.handoff) actions.onHandoff(result.handoff);
      await actions.onExecuted(
        result.itemStates?.includes("reviewed")
          ? "Der ungewöhnliche Wert wartet auf eine unabhängige Zweitfreigabe."
          : result.workflowChanged
            ? "Arbeitswechsel übernommen; die unterbrochene Arbeit bleibt erhalten."
            : "Die geprüften Angaben wurden lokal angenommen und werden nachvollziehbar synchronisiert.",
        result.workflowChanged ? result.activePatientId : undefined,
      );
    } catch (error) {
      actions.onError(
        error instanceof Error
          ? error.message
          : "Entwurf konnte nicht übernommen werden.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assistant-message clinical-openui-message openui-agent-thread-message-assistant">
      <div className="assistant-avatar" aria-hidden="true">
        P
      </div>
      <div className="assistant-message-body" aria-live="polite">
        {renderable ? (
          <Renderer
            response={renderedSource}
            library={clinicalAssistantLibrary}
            isStreaming={isStreaming}
            onAction={(event) => void handleAction(event)}
            onError={(errors) => {
              if (!isStreaming && errors.length > 0)
                actions.onError(
                  "Die Antwort enthielt eine nicht freigegebene Darstellung und wurde verworfen.",
                );
            }}
          />
        ) : isStreaming ? (
          <div className="assistant-thinking" role="status">
            Antwort wird sicher aufgebaut…
          </div>
        ) : (
          <div className="assistant-error" role="alert">
            Diese Antwort wurde wegen einer ungültigen Komponente verworfen.
          </div>
        )}
        {busy && (
          <div className="assistant-thinking" role="status">
            Änderung wird geprüft…
          </div>
        )}
      </div>
    </div>
  );
}
