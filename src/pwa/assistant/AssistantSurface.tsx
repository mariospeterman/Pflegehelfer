import { useEffect, useMemo, useRef, useState } from "react";
import { AgentInterface } from "@openuidev/react-ui";
import {
  useThread,
  useThreadList,
  type ChatStorage,
  type UserMessage,
} from "@openuidev/react-headless";
import type { Patient } from "../../core/types";
import { clinicalAssistantLibrary } from "./clinical-library";
import {
  ClinicalAssistantMessage,
  ConversationActionsProvider,
  type AssistantHandoff,
} from "../conversation/ClinicalAssistantMessage";
import {
  createConversationLlm,
  createConversationStorage,
  type VoiceSubmission,
} from "../conversation/openui-client";
import {
  ClinicalComposer,
  type MutableSubmissionChannel,
} from "../conversation/ClinicalComposer";
import type { WorkspaceDestination } from "../workspace/WorkspaceView";

export type { AssistantHandoff };

export interface ConversationOpening {
  eyebrow: string;
  title: string;
  summary: string;
  progress: string;
}

function createSubmissionChannel(): MutableSubmissionChannel {
  const pending = new Map<string, VoiceSubmission>();
  return {
    set(prompt, voice) {
      pending.clear();
      pending.set(prompt, voice);
    },
    take(prompt) {
      const voice = pending.get(prompt) ?? null;
      pending.delete(prompt);
      return voice;
    },
  };
}

function ClinicalUserMessage({ message }: { message: UserMessage }) {
  const text =
    typeof message.content === "string"
      ? message.content
      : message.content
          .filter((part) => part.type === "text")
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("\n");
  return (
    <div className="user-message openui-agent-thread-message-user">
      <span>Du</span>
      <p>{text}</p>
    </div>
  );
}

function AuthorizedThreadBootstrap() {
  const {
    threads,
    isLoadingThreads,
    selectedThreadId,
    loadThreads,
    selectThread,
  } = useThreadList();
  const requested = useRef(false);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!isLoadingThreads && !selectedThreadId && threads[0])
      selectThread(threads[0].id);
  }, [isLoadingThreads, selectThread, selectedThreadId, threads]);

  return null;
}

function AuthoritativeConversationRefresh({
  storage,
  onError,
}: {
  storage: ChatStorage;
  onError: (message: string) => void;
}) {
  const { isRunning, setMessages } = useThread();
  const { selectedThreadId } = useThreadList();
  const wasRunning = useRef(false);

  useEffect(() => {
    if (isRunning) {
      wasRunning.current = true;
      return;
    }
    if (!wasRunning.current || !selectedThreadId) return;
    wasRunning.current = false;
    let active = true;
    void storage.thread
      .getMessages(selectedThreadId)
      .then((messages) => {
        if (active) setMessages(messages);
      })
      .catch(() => {
        if (active)
          onError(
            "Der bestätigte Gesprächsstand konnte nicht neu geladen werden.",
          );
      });
    return () => {
      active = false;
    };
  }, [isRunning, onError, selectedThreadId, setMessages, storage]);

  return null;
}

export function AssistantSurface({
  patient,
  userId,
  online,
  onExecuted,
  onHandoff,
  snapshotRevision,
  opening,
  launchPrompt,
  onSelectPatient,
  onBusyChange,
  externallyBusy,
  onNavigate,
}: {
  patient: Patient | null;
  userId: string;
  online: boolean;
  onExecuted: (message: string, activePatientId?: string) => Promise<void>;
  onHandoff: (handoff: AssistantHandoff) => void;
  snapshotRevision: string;
  opening: ConversationOpening;
  launchPrompt: { id: number; text: string; autoSubmit?: boolean } | null;
  onSelectPatient: (patientId: string) => void;
  onBusyChange: (busy: boolean) => void;
  externallyBusy: boolean;
  onNavigate: (destination: WorkspaceDestination) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const storage = useMemo(() => createConversationStorage(userId), [userId]);
  const submissionChannel = useMemo(() => createSubmissionChannel(), []);
  const llm = useMemo(
    () =>
      createConversationLlm({
        userId,
        patientId: patient?.id ?? null,
        purpose: "direct-care",
        submissionChannel,
      }),
    [patient?.id, submissionChannel, userId],
  );
  const scopeKey = `${userId}:${patient?.id ?? "general"}:${patient?.encounterId ?? "none"}`;

  return (
    <ConversationActionsProvider
      value={{
        userId,
        patient,
        onPatient: onSelectPatient,
        onHandoff,
        onExecuted,
        onError: setError,
      }}
    >
      <section
        id="conversation"
        className="conversation openui-conversation"
        aria-label="Pflegehelfer Gespräch"
        data-snapshot-revision={snapshotRevision.length}
      >
        <AgentInterface
          key={scopeKey}
          storage={storage}
          llm={llm}
          componentLibrary={clinicalAssistantLibrary}
          components={{
            AssistantMessage: ClinicalAssistantMessage,
            UserMessage: ClinicalUserMessage,
          }}
          agentName="Pflegehelfer"
          logoUrl="/logo-mark.svg"
          defaultPath="clinical-conversation"
          scrollVariant="always"
        >
          <AgentInterface.Route path="clinical-conversation">
            <AuthorizedThreadBootstrap />
            <AuthoritativeConversationRefresh
              storage={storage}
              onError={setError}
            />
            <AgentInterface.ScrollArea scrollVariant="always">
              <div className="conversation-feed openui-feed">
                <div className="conversation-opening">
                  <img src="/logo-mark.svg" alt="" />
                  <div>
                    <h2>{opening.title}</h2>
                    <p>{opening.summary}</p>
                    <small>{opening.progress}</small>
                  </div>
                </div>
                {patient && (
                  <div className="conversation-context-event">
                    <span aria-hidden="true">✓</span>
                    Patientenkontext bewusst gewählt · {patient.room} ·{" "}
                    {patient.displayName} · Fall {patient.mrn}
                  </div>
                )}
                <AgentInterface.Messages
                  assistantMessage={ClinicalAssistantMessage}
                  userMessage={ClinicalUserMessage}
                />
              </div>
            </AgentInterface.ScrollArea>
            <AgentInterface.Composer>
              <ClinicalComposer
                key={`${userId}:${patient?.id ?? "general"}:${patient?.encounterId ?? "none"}`}
                userId={userId}
                patient={patient}
                online={online}
                externallyBusy={externallyBusy}
                launchPrompt={launchPrompt}
                submissionChannel={submissionChannel}
                starters={
                  patient
                    ? [
                        {
                          label: "Was ist wichtig?",
                          prompt: "Was ist aktuell wichtig?",
                        },
                        {
                          label: "Letzte Werte",
                          prompt: "Zeige mir die letzten Vitalwerte.",
                        },
                        {
                          label: "Offene Arbeit",
                          prompt: "Was ist noch offen?",
                        },
                      ]
                    : [
                        {
                          label: "Übergabe",
                          action: () => onNavigate("Plans"),
                        },
                        {
                          label: "Meine Aufgaben",
                          action: () => onNavigate("Plans"),
                        },
                        {
                          label: "Teamfragen",
                          action: () => onNavigate("Team"),
                        },
                      ]
                }
                onError={setError}
                onBusy={onBusyChange}
              />
            </AgentInterface.Composer>
          </AgentInterface.Route>
        </AgentInterface>
        {error && (
          <div className="assistant-error conversation-error" role="alert">
            <span>{error}</span>
            <button
              aria-label="Fehler schliessen"
              onClick={() => setError(null)}
            >
              ×
            </button>
          </div>
        )}
      </section>
    </ConversationActionsProvider>
  );
}
