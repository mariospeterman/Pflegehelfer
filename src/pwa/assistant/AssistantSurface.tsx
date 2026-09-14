import { useEffect, useMemo, useRef, useState } from "react";
import { AgentInterface } from "@openuidev/react-ui";
import { useThreadList, type UserMessage } from "@openuidev/react-headless";
import type { Patient } from "../../core/types";
import type { WorkdayCommand, WorkdayView } from "../../core/workday";
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
import { WorkdayPanel } from "../conversation/WorkdayPanel";

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
  workday,
  availablePatients,
  onWorkdayAction,
  externallyBusy,
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
  workday: WorkdayView | null;
  availablePatients: Patient[];
  onWorkdayAction: (command: WorkdayCommand) => Promise<void>;
  externallyBusy: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [workdayBusy, setWorkdayBusy] = useState(false);
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
          starters={
            patient
              ? [
                  {
                    displayText: "Was ist wichtig?",
                    prompt: "Was ist aktuell wichtig?",
                  },
                  {
                    displayText: "Letzte Werte",
                    prompt: "Zeige mir die letzten Vitalwerte.",
                  },
                  {
                    displayText: "Offene Arbeit",
                    prompt: "Was ist noch offen?",
                  },
                ]
              : [
                  {
                    displayText: "Übergabe",
                    prompt: "Zeige mir die aktuelle Übergabe.",
                  },
                  {
                    displayText: "Meine Aufgaben",
                    prompt: "Was ist für mich noch offen?",
                  },
                  {
                    displayText: "Teamfragen",
                    prompt: "Welche Teamfragen sind offen?",
                  },
                ]
          }
        >
          <AgentInterface.Sidebar />
          <AgentInterface.Route path="clinical-conversation">
            <AuthorizedThreadBootstrap />
            <AgentInterface.MobileHeader
              menuButton={false}
              newChatButton={false}
              agentName={
                patient
                  ? `Pflegehelfer zu ${patient.displayName}`
                  : "Mein Assistent"
              }
            />
            <AgentInterface.ThreadHeader>
              <div className="openui-thread-label">
                <span>
                  {patient
                    ? "Privater Patient:innen-Assistenzchat"
                    : "Privater allgemeiner Assistenzchat"}
                </span>
                <small>{online ? "Verbunden" : "Offline · nur lesen"}</small>
              </div>
            </AgentInterface.ThreadHeader>
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
                {workday && (
                  <WorkdayPanel
                    workday={workday}
                    patients={availablePatients}
                    busy={workdayBusy || externallyBusy}
                    onPatient={onSelectPatient}
                    onError={setError}
                    onAction={async (command) => {
                      setWorkdayBusy(true);
                      onBusyChange(true);
                      try {
                        await onWorkdayAction(command);
                      } finally {
                        setWorkdayBusy(false);
                        onBusyChange(false);
                      }
                    }}
                  />
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
                externallyBusy={externallyBusy || workdayBusy}
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
                          prompt: "Zeige mir die aktuelle Übergabe.",
                        },
                        {
                          label: "Meine Aufgaben",
                          prompt: "Was ist für mich noch offen?",
                        },
                        {
                          label: "Teamfragen",
                          prompt: "Welche Teamfragen sind offen?",
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
