import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  const { updateMessage, isRunning } = useThread();
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  if (!actions) throw new Error("ConversationActionsProvider fehlt.");
  const source = message.content ?? "";
  const proposalStatus = message.name?.match(
    /^pflegehelfer-proposal:(pending|superseded|consumed|expired):\d+$/,
  )?.[1];
  const renderedSource =
    proposalStatus === "consumed"
      ? completedOpenUi
      : proposalStatus === "superseded" || proposalStatus === "expired"
        ? supersededOpenUi
        : source;
  const parsed = createParser(clinicalAssistantLibrary.toJSONSchema()).parse(
    renderedSource,
  );
  const renderable = Boolean(
    parsed.root &&
    parsed.meta.errors.length === 0 &&
    (!isStreaming || parsed.meta.unresolved.length === 0),
  );

  useEffect(
    () => () => {
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
    },
    [],
  );

  const stopSpeaking = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  const readAloud = async () => {
    if (speaking) {
      stopSpeaking();
      return;
    }
    const clone = bodyRef.current?.cloneNode(true) as HTMLElement | undefined;
    clone
      ?.querySelectorAll("button, [role='status'], [role='alert']")
      .forEach((node) => node.remove());
    const text = clone?.innerText.replace(/\s+/g, " ").trim().slice(0, 2400);
    if (!text) return;
    actions.onError(null);
    setSpeaking(true);
    try {
      const statusResponse = await fetch("/api/v1/ai/status", {
        headers: {
          "x-demo-user": actions.userId,
          ...assistantClientContextHeaders(),
        },
      });
      const status = (await statusResponse.json()) as {
        tts?: { mode?: string; ready?: boolean; acceptance?: string };
        message?: string;
      };
      if (!statusResponse.ok)
        throw new Error(status.message ?? "Sprachausgabe nicht verfügbar.");
      if (
        status.tts?.ready &&
        status.tts.acceptance === "accepted" &&
        status.tts.mode !== "browser-demo"
      ) {
        const response = await fetch("/api/v1/assistant/speech", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-demo-user": actions.userId,
            ...assistantClientContextHeaders(),
            "x-command-id": crypto.randomUUID(),
          },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) {
          const failure = (await response.json()) as { message?: string };
          throw new Error(failure.message ?? "Sprachausgabe fehlgeschlagen.");
        }
        const url = URL.createObjectURL(await response.blob());
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          setSpeaking(false);
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          audioRef.current = null;
          setSpeaking(false);
          actions.onError("Die Audiodatei konnte nicht abgespielt werden.");
        };
        await audio.play();
        return;
      }
      if (status.tts?.mode === "browser-demo" && "speechSynthesis" in window) {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "de-CH";
        utterance.onend = () => setSpeaking(false);
        utterance.onerror = () => {
          setSpeaking(false);
          actions.onError("Browser-Vorlesen wurde abgebrochen.");
        };
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
        return;
      }
      throw new Error("Sprachausgabe ist in diesem Modus nicht freigegeben.");
    } catch (error) {
      setSpeaking(false);
      actions.onError(
        error instanceof Error
          ? error.message
          : "Sprachausgabe fehlgeschlagen.",
      );
    }
  };

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
      updateMessage({
        ...message,
        name: message.name?.replace(
          /pflegehelfer-proposal:[^:]+:/,
          "pflegehelfer-proposal:consumed:",
        ),
        content: completedOpenUi,
      });
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
      <div className="assistant-message-content">
        <div
          ref={bodyRef}
          className="assistant-message-body"
          aria-live="polite"
        >
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
        {!isStreaming && renderable && (
          <button
            type="button"
            className="read-aloud-button"
            aria-label={speaking ? "Vorlesen stoppen" : "Antwort vorlesen"}
            aria-pressed={speaking}
            onClick={() => void readAloud()}
          >
            <span aria-hidden="true">{speaking ? "■" : "◖))"}</span>
            {speaking ? "Stoppen" : "Vorlesen"}
          </button>
        )}
      </div>
    </div>
  );
}
