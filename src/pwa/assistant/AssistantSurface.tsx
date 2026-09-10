import {
  Renderer,
  createParser,
  type ActionEvent,
} from "@openuidev/react-lang";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Patient } from "../../core/types";
import type { WorkdayCommand, WorkdayView } from "../../core/workday";
import {
  extractCriticalEntities,
  type CriticalEntity,
} from "../../core/critical-entities";
import { clinicalAssistantLibrary } from "./clinical-library";

interface AssistantResponse {
  id: string;
  classification: {
    intent: string;
    mode: "disabled" | "deterministic" | "hosted-test" | "local-openai";
    model: string;
    degraded: boolean;
  };
  runtime: {
    route:
      | "deterministic"
      | "fast-local"
      | "hosted-test"
      | "deep-local"
      | "deep-hosted-test";
    label: string;
    degraded: boolean;
  };
  patientContext: {
    patientId: string;
    encounterId: string;
    resourceVersion: number;
    displayName: string;
    birthDate: string;
    mrn: string;
  } | null;
  components: Array<{
    type: string;
    preview?: string;
    intentToken?: string;
    sourceLabel?: string;
    reviewItems?: Array<{
      id: string;
      label: string;
      kind: "note" | "observation" | "communication" | "task" | "workflow";
    }>;
  }>;
  openUi: string;
  evidence: { resourceId: string; version: number; label: string }[];
  warnings: string[];
}

interface AiStatus {
  asr: {
    mode: "disabled" | "browser-demo" | "hosted-test" | "local-openai";
    ready: boolean;
    message: string;
  };
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string; confidence?: number };
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((event: { results: ArrayLike<SpeechRecognitionResultLike> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

const entityKey = (entity: CriticalEntity) =>
  `${entity.kind}:${entity.start}:${entity.end}`;

function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const candidate = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return (
    candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null
  );
}

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

export interface ConversationOpening {
  eyebrow: string;
  title: string;
  summary: string;
  progress: string;
}

interface ChatMessage {
  kind?: "turn";
  id: string;
  prompt: string;
  response: AssistantResponse;
  execution?: string;
  streaming?: boolean;
  archived?: boolean;
}

interface ContextMessage {
  kind: "context";
  id: string;
  label: string;
}

type ConversationMessage = ChatMessage | ContextMessage;

const archivedActionOpenUi = [
  "root = ClinicalStack([item0])",
  'item0 = SafetyNotice("info", "Die frühere offene Änderung wurde beim Kontextwechsel sicher geschlossen. Bitte im aktuellen Patientenkontext neu formulieren.")',
].join("\n");
const completedActionOpenUi = [
  "root = ClinicalStack([item0])",
  'item0 = AssistantMessage("Die bestätigte Änderung wurde sicher übernommen.")',
].join("\n");

function archiveExecutableMessage(
  message: ConversationMessage,
): ConversationMessage {
  if (
    message.kind === "context" ||
    !message.response.components.some((component) =>
      ["DraftAction", "PatientPicker"].includes(component.type),
    )
  )
    return message;
  return {
    ...message,
    archived: true,
    streaming: false,
    response: {
      ...message.response,
      components: [],
      openUi: archivedActionOpenUi,
    },
  };
}

async function post<T>(
  path: string,
  userId: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-demo-user": userId,
      "x-command-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  });
  const raw = await response.text();
  let result: T & { message?: string };
  try {
    result = JSON.parse(raw) as T & { message?: string };
  } catch {
    throw new Error("Der Dienst antwortet nicht im erwarteten Format.");
  }
  if (!response.ok)
    throw new Error(result.message ?? "Assistenzaktion fehlgeschlagen.");
  return result;
}

function WorkdayCard({
  workday,
  patients,
  busy,
  evidence,
  setEvidence,
  selectPatient,
  act,
  fail,
}: {
  workday: WorkdayView;
  patients: Patient[];
  busy: boolean;
  evidence: string;
  setEvidence: (value: string) => void;
  selectPatient: (patientId: string) => void;
  act: (command: WorkdayCommand) => Promise<void>;
  fail: (message: string) => void;
}) {
  const activeControlsRef = useRef<HTMLElement | null>(null);
  const patientFor = (patientId: string) =>
    patients.find((candidate) => candidate.id === patientId) ?? null;
  const perform = (command: WorkdayCommand, fallback: string) => {
    void act(command).catch((failure: unknown) =>
      fail(failure instanceof Error ? failure.message : fallback),
    );
  };
  const title =
    workday.stage === "handover"
      ? "Übergabe patientenweise übernehmen"
      : workday.stage === "closed"
        ? workday.handover.status === "acknowledged"
          ? "Die nächste Schicht hat die offene Verantwortung übernommen"
          : workday.outgoingTransfers.some(
                (transfer) => transfer.state === "pending",
              )
            ? "Übergabe gesendet · Übernahme noch ausstehend"
            : "Schicht sicher abgeschlossen"
        : workday.activeEpisode
          ? "Du arbeitest gerade in einem Patientenkontext"
          : workday.resumableEpisode
            ? "Unterbrochene Arbeit wartet auf Fortsetzung"
            : "Dein sicherer Arbeitsplan";
  // The demo provider emits one explicit synthetic nurse-call scenario. Do
  // not manufacture a reverse alarm after staff accepts it.
  const alarmPatient =
    workday.activeEpisode?.patientId === "p-anna"
      ? (patients.find((candidate) => candidate.id === "p-luca") ?? null)
      : null;

  useEffect(() => {
    if (!workday.activeEpisode) return;
    const frame = window.requestAnimationFrame(() =>
      activeControlsRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [workday.activeEpisode]);

  return (
    <div
      className="assistant-message workflow-opening-turn"
      data-genui-component="Workday"
    >
      <div className="assistant-avatar" aria-hidden="true">
        P
      </div>
      <div className="assistant-message-body">
        <div className="assistant-model-status">
          {workday.stage === "handover"
            ? "Schichtübernahme"
            : workday.stage === "closed"
              ? "Schicht abgeschlossen"
              : "Aktueller Arbeitstag"}
        </div>
        <article className="assistant-card workday-card">
          <header>
            <span>
              {workday.handover.acknowledgedPatientIds.length}/
              {workday.handover.patientIds.length} Patientenkontexte geprüft
            </span>
            <h2>{title}</h2>
          </header>

          {workday.stage === "handover" && (
            <div className="workday-list" aria-label="Übergabe-Roster">
              {workday.handover.patientIds.map((patientId) => {
                const listedPatient = patientFor(patientId);
                const plannedCare = workday.plan.find(
                  (item) => item.patientId === patientId,
                );
                const acknowledged =
                  workday.handover.acknowledgedPatientIds.includes(patientId);
                if (!listedPatient) return null;
                return (
                  <section className="workday-row" key={patientId}>
                    <button
                      className="workday-patient"
                      disabled={busy}
                      onClick={() => selectPatient(patientId)}
                    >
                      <strong>
                        {listedPatient.room} · {listedPatient.displayName}
                      </strong>
                      <span>
                        {plannedCare?.title ?? "Pflegeplanung prüfen"}
                      </span>
                      <small>
                        {plannedCare?.reason ?? "Keine offene Begründung"} ·
                        Risiken: {listedPatient.risks.join(", ") || "keine"} ·
                        Stand {workday.handover.shiftKey}, Version{" "}
                        {workday.handover.version}
                      </small>
                    </button>
                    <button
                      className={
                        acknowledged ? "status-button done" : "status-button"
                      }
                      disabled={busy || acknowledged}
                      aria-label={`${acknowledged ? "Übergabe geprüft" : "Gelesen und übernehmen"}: Zimmer ${listedPatient.room}, ${listedPatient.displayName}`}
                      onClick={() =>
                        perform(
                          {
                            type: "acknowledge-handover",
                            handoverId: workday.handover.id,
                            patientId,
                            version: workday.handover.version,
                          },
                          "Übergabe konnte nicht bestätigt werden.",
                        )
                      }
                    >
                      {acknowledged ? "Geprüft" : "Gelesen & übernehmen"}
                    </button>
                  </section>
                );
              })}
            </div>
          )}

          {workday.stage !== "handover" && workday.stage !== "closed" && (
            <div className="workday-list" aria-label="Patientenplan">
              {workday.plan.map((item) => {
                const listedPatient = patientFor(item.patientId);
                if (!listedPatient) return null;
                return (
                  <section className="workday-row" key={item.patientId}>
                    <button
                      className="workday-patient"
                      disabled={busy}
                      onClick={() => selectPatient(item.patientId)}
                    >
                      <strong>
                        {listedPatient.room} · {listedPatient.displayName}
                      </strong>
                      <span>{item.title}</span>
                      <small>{item.reason}</small>
                    </button>
                    {item.status === "planned" && !workday.activeEpisode && (
                      <div className="button-row compact-actions">
                        <button
                          className="status-button"
                          disabled={busy}
                          aria-label={`Arbeit beginnen: Zimmer ${listedPatient.room}, ${listedPatient.displayName}`}
                          onClick={() =>
                            perform(
                              {
                                type: "start-episode",
                                patientId: listedPatient.id,
                                encounterId: listedPatient.encounterId,
                                kind: "planned",
                                title: item.title,
                              },
                              "Arbeit konnte nicht begonnen werden.",
                            )
                          }
                        >
                          Beginnen
                        </button>
                        <button
                          className="status-button secondary"
                          disabled={busy}
                          aria-label={`Offene Verantwortung übergeben: Zimmer ${listedPatient.room}, ${listedPatient.displayName}`}
                          onClick={() =>
                            perform(
                              {
                                type: "defer-responsibility",
                                patientId: listedPatient.id,
                                encounterId: listedPatient.encounterId,
                                reason:
                                  "Im aktuellen Dienst nicht abgeschlossen; sichtbar an nächste Verantwortung übergeben.",
                                receivingActorId:
                                  workday.handover.nextResponsibleActorId,
                              },
                              "Verantwortung konnte nicht übergeben werden.",
                            )
                          }
                        >
                          Übergeben
                        </button>
                      </div>
                    )}
                    <span className={`episode-state ${item.status}`}>
                      {item.status === "planned"
                        ? "Geplant"
                        : item.status === "active"
                          ? "Aktiv"
                          : item.status === "paused"
                            ? "Unterbrochen"
                            : "Dokumentiert"}
                    </span>
                  </section>
                );
              })}
            </div>
          )}

          {workday.activeEpisode && (
            <section
              ref={activeControlsRef}
              className="episode-controls"
              aria-label="Aktive Arbeit"
            >
              <strong>{workday.activeEpisode.title}</strong>
              <span>
                {patientFor(workday.activeEpisode.patientId)?.displayName}
              </span>
              <label>
                <span>Was wurde tatsächlich durchgeführt?</span>
                <textarea
                  value={evidence}
                  rows={2}
                  maxLength={1200}
                  placeholder="Beobachtung oder Durchführung festhalten…"
                  onChange={(event) => setEvidence(event.target.value)}
                />
              </label>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    perform(
                      {
                        type: "pause-episode",
                        episodeId: workday.activeEpisode!.id,
                        reason: "interruption",
                        draftText: evidence,
                      },
                      "Unterbrechung konnte nicht gespeichert werden.",
                    )
                  }
                >
                  Unterbrechen
                </button>
                {alarmPatient && (
                  <button
                    className="secondary alarm-button"
                    disabled={busy}
                    onClick={() =>
                      perform(
                        {
                          type: "interrupt-and-start",
                          episodeId: workday.activeEpisode!.id,
                          patientId: alarmPatient.id,
                          encounterId: alarmPatient.encounterId,
                          title: `Simulierter Nurse-call · Zimmer ${alarmPatient.room}`,
                          pausedDraftText: evidence,
                        },
                        "Alarm konnte nicht übernommen werden.",
                      )
                    }
                  >
                    Simulierten Ruf {alarmPatient.room} übernehmen
                  </button>
                )}
                <button
                  className="primary"
                  disabled={busy || evidence.trim().length < 10}
                  onClick={() => {
                    void act({
                      type: "complete-episode",
                      episodeId: workday.activeEpisode!.id,
                      evidence,
                    })
                      .then(() => setEvidence(""))
                      .catch((failure: unknown) =>
                        fail(
                          failure instanceof Error
                            ? failure.message
                            : "Abschluss konnte nicht gespeichert werden.",
                        ),
                      );
                  }}
                >
                  Dokumentieren & abschliessen
                </button>
              </div>
            </section>
          )}

          {!workday.activeEpisode && workday.resumableEpisode && (
            <section className="episode-resume">
              <span>Unterbrochen</span>
              <strong>{workday.resumableEpisode.title}</strong>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  perform(
                    {
                      type: "resume-episode",
                      episodeId: workday.resumableEpisode!.id,
                    },
                    "Arbeit konnte nicht fortgesetzt werden.",
                  )
                }
              >
                Patientenkontext fortsetzen
              </button>
            </section>
          )}

          {workday.incomingTransfers.some(
            (transfer) => transfer.state === "pending",
          ) && (
            <section
              className="episode-resume"
              aria-label="Übernommene offene Verantwortung"
            >
              <span>Nächste Schicht · Eingang</span>
              {workday.incomingTransfers
                .filter((transfer) => transfer.state === "pending")
                .map((transfer) => (
                  <div key={transfer.id} className="transfer-row">
                    <strong>
                      {patientFor(transfer.patientId)?.displayName ??
                        "Patientenkontext"}
                    </strong>
                    <p>{transfer.reason}</p>
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        perform(
                          {
                            type: "acknowledge-transfer",
                            transferId: transfer.id,
                          },
                          "Übernahme konnte nicht quittiert werden.",
                        )
                      }
                    >
                      Verantwortung übernehmen
                    </button>
                  </div>
                ))}
            </section>
          )}

          {workday.stage === "closed" &&
            workday.outgoingTransfers.length > 0 && (
              <section
                className="episode-resume"
                aria-label="Ausgehende Verantwortungsübergaben"
              >
                <span>Nächste Schicht · Ausgang</span>
                {workday.outgoingTransfers.map((transfer) => (
                  <div key={transfer.id} className="transfer-row">
                    <strong>
                      {patientFor(transfer.patientId)?.displayName ??
                        "Patientenkontext"}
                    </strong>
                    <p>{transfer.reason}</p>
                    <small>
                      {transfer.state === "acknowledged"
                        ? "Übernahme bestätigt"
                        : "Wartet auf Bestätigung der nächsten Schicht"}
                    </small>
                  </div>
                ))}
              </section>
            )}

          {workday.stage !== "handover" &&
            workday.stage !== "closed" &&
            !workday.activeEpisode &&
            !workday.resumableEpisode &&
            workday.episodes.length > 0 &&
            workday.plan.every((item) =>
              ["completed", "paused"].includes(item.status),
            ) && (
              <section className="shift-close">
                <span>
                  {
                    workday.episodes.filter(
                      (episode) => episode.state === "completed",
                    ).length
                  }{" "}
                  Arbeitsepisoden dokumentiert · Anbieterabgleich ausstehend
                </span>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    perform(
                      { type: "close-shift" },
                      "Schicht konnte nicht abgeschlossen werden.",
                    )
                  }
                >
                  Übergabe vorbereiten und Schicht beenden
                </button>
              </section>
            )}
        </article>
      </div>
    </div>
  );
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
  onExecuted: (message: string) => Promise<void>;
  onHandoff: (handoff: AssistantHandoff) => void;
  snapshotRevision: string;
  opening: ConversationOpening;
  launchPrompt: { id: number; text: string } | null;
  onSelectPatient: (patientId: string) => void;
  onBusyChange: (busy: boolean) => void;
  workday: WorkdayView | null;
  availablePatients: Patient[];
  onWorkdayAction: (command: WorkdayCommand) => Promise<void>;
  externallyBusy: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [voiceReview, setVoiceReview] = useState<{
    confidence: number | null;
    entities: CriticalEntity[];
    confirmed: boolean;
    confirmedEntityIds: string[];
    receiptId: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [pendingAction, setPendingAction] = useState<{
    event: ActionEvent;
    preview: string;
    response: AssistantResponse;
  } | null>(null);
  const [episodeDrafts, setEpisodeDrafts] = useState<Record<string, string>>(
    {},
  );
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const mediaStopTimer = useRef<number | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const requestAbort = useRef<AbortController | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const voiceGeneration = useRef(0);
  const contextEpoch = useRef(0);
  const executionInFlight = useRef(false);
  const lastRevision = useRef(snapshotRevision);
  const activePatientId = useRef(patient?.id ?? null);
  const lastResponse = useRef<HTMLDivElement | null>(null);

  const interactionBusy = busy || workflowBusy || externallyBusy;

  useEffect(
    () => onBusyChange(interactionBusy),
    [interactionBusy, onBusyChange],
  );

  useEffect(() => setEpisodeDrafts({}), [userId]);

  const activeEpisodeId = workday?.activeEpisode?.id ?? null;
  const episodeEvidence = activeEpisodeId
    ? (episodeDrafts[activeEpisodeId] ??
      workday?.activeEpisode?.draftText ??
      "")
    : "";
  const setEpisodeEvidence = (value: string) => {
    if (!activeEpisodeId) return;
    setEpisodeDrafts((current) => ({ ...current, [activeEpisodeId]: value }));
  };

  useEffect(() => {
    if (!activeEpisodeId) return;
    const persisted = workday?.activeEpisode?.draftText ?? "";
    if (episodeEvidence === persisted) return;
    const timer = window.setTimeout(() => {
      void onWorkdayAction({
        type: "save-episode-draft",
        episodeId: activeEpisodeId,
        draftText: episodeEvidence,
      }).catch((failure: unknown) =>
        setError(
          failure instanceof Error
            ? failure.message
            : "Zwischenstand konnte nicht gespeichert werden.",
        ),
      );
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    activeEpisodeId,
    episodeEvidence,
    onWorkdayAction,
    workday?.activeEpisode?.draftText,
  ]);

  const rememberMessages = (
    update: (current: ConversationMessage[]) => ConversationMessage[],
  ) => {
    setMessages((current) => {
      const next = update(current);
      return next;
    });
  };

  const cancelVoice = useCallback(() => {
    voiceGeneration.current += 1;
    recognition.current?.abort();
    recognition.current = null;
    if (mediaRecorder.current) {
      mediaRecorder.current.ondataavailable = null;
      mediaRecorder.current.onstop = null;
    }
    if (mediaRecorder.current?.state === "recording")
      mediaRecorder.current.stop();
    if (mediaStopTimer.current !== null)
      window.clearTimeout(mediaStopTimer.current);
    mediaStopTimer.current = null;
    mediaRecorder.current = null;
    mediaStream.current?.getTracks().forEach((track) => track.stop());
    mediaStream.current = null;
    audioChunks.current = [];
    voiceAbort.current?.abort();
    voiceAbort.current = null;
    setRecording(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/ai/status", {
      headers: { "x-demo-user": userId },
      signal: controller.signal,
    })
      .then(async (result) => {
        if (!result.ok) throw new Error("status-unavailable");
        return (await result.json()) as AiStatus;
      })
      .then(setAiStatus)
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError"))
          setAiStatus(null);
      });
    return () => controller.abort();
  }, [userId]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/assistant/conversation", {
      headers: { "x-demo-user": userId },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("conversation-unavailable");
        return (await response.json()) as {
          turns: Array<{
            id: string;
            prompt: string;
            response: AssistantResponse;
          }>;
        };
      })
      .then(({ turns }) => {
        const restored: ConversationMessage[] = turns.map((turn) => ({
          kind: "turn",
          id: turn.id,
          prompt: turn.prompt,
          response: turn.response,
        }));
        setMessages((current) => {
          if (current.length === 0) return restored;
          const localIds = new Set(current.map((message) => message.id));
          return [
            ...restored.filter((message) => !localIds.has(message.id)),
            ...current,
          ];
        });
      })
      .catch((failure: unknown) => {
        if (!(failure instanceof DOMException && failure.name === "AbortError"))
          setError("Der kurze Schichtverlauf konnte nicht geladen werden.");
      });
    return () => controller.abort();
  }, [userId]);

  useEffect(() => {
    if (!launchPrompt) return;
    setPrompt(launchPrompt.text);
    setVoiceReview(null);
  }, [launchPrompt]);

  useEffect(() => {
    if (lastRevision.current === snapshotRevision) return;
    lastRevision.current = snapshotRevision;
    if (pendingAction) {
      contextEpoch.current += 1;
      requestAbort.current?.abort();
      requestAbort.current = null;
      setPendingAction(null);
      setError(
        "Der klinische Stand hat sich geändert. Bitte die Angaben kurz neu formulieren.",
      );
    }
  }, [pendingAction, snapshotRevision]);

  useEffect(() => {
    const nextPatientId = patient?.id ?? null;
    if (activePatientId.current === nextPatientId) return;
    contextEpoch.current += 1;
    activePatientId.current = nextPatientId;
    requestAbort.current?.abort();
    requestAbort.current = null;
    cancelVoice();
    setPrompt("");
    setVoiceReview(null);
    setBusy(false);
    setPendingAction((current) => {
      if (current)
        setError(
          "Patientenkontext geändert: Die offene Änderung wurde sicher verworfen.",
        );
      return null;
    });
    const marker: ContextMessage = {
      kind: "context",
      id: crypto.randomUUID(),
      label: patient
        ? `Patientenkontext bewusst gewählt · ${patient.room} · ${patient.displayName} · Fall ${patient.mrn}`
        : "Patientenkontext aufgehoben · keine patientenbezogenen Aktionen möglich",
    };
    setMessages((current) => {
      const next = [...current.map(archiveExecutableMessage), marker];
      return next;
    });
  }, [cancelVoice, patient]);

  useEffect(() => {
    if (!online && pendingAction) {
      setPendingAction(null);
      setError(
        "Offline: Die noch nicht freigegebene Änderung wurde verworfen.",
      );
    }
  }, [online, pendingAction]);

  useEffect(() => {
    const last = messages.at(-1);
    if (last?.kind !== "turn" && !pendingAction) return;
    lastResponse.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, [messages, pendingAction]);

  useEffect(
    () => () => {
      requestAbort.current?.abort();
      cancelVoice();
    },
    [cancelVoice],
  );

  const ask = async (event?: FormEvent, directPrompt?: string) => {
    event?.preventDefault();
    const submitted = (directPrompt ?? prompt).trim();
    const submittedContextEpoch = contextEpoch.current;
    if (!online || submitted.length < 2 || workflowBusy) return;
    if (
      !directPrompt &&
      voiceReview &&
      (!voiceReview.confirmed ||
        voiceReview.confirmedEntityIds.length !== voiceReview.entities.length)
    ) {
      setError(
        "Bitte Transkript und hervorgehobene kritische Angaben zuerst bestätigen.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    setPendingAction(null);
    try {
      requestAbort.current?.abort();
      const controller = new AbortController();
      requestAbort.current = controller;
      const streamed = await fetch("/api/v1/assistant/query/stream", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-demo-user": userId,
          "x-command-id": crypto.randomUUID(),
        },
        body: JSON.stringify({
          prompt: submitted,
          patientId: patient?.id ?? null,
          inputModality:
            !directPrompt && voiceReview?.receiptId ? "voice" : "typed",
          voiceTranscriptConfirmed:
            !directPrompt && (voiceReview?.confirmed ?? false),
          voiceReceiptId:
            !directPrompt && voiceReview?.receiptId
              ? voiceReview.receiptId
              : undefined,
          voiceConfirmedEntityIds: !directPrompt
            ? voiceReview?.confirmedEntityIds
            : undefined,
        }),
        signal: controller.signal,
      });
      if (!streamed.ok || !streamed.body) {
        const body = (await streamed.json()) as { message?: string };
        throw new Error(body.message ?? "Assistenzaktion fehlgeschlagen.");
      }
      const reader = streamed.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let partial = "";
      let activeId: string | null = null;
      let completed = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const frames = buffer.split("\n");
        buffer = frames.pop() ?? "";
        for (const raw of frames) {
          if (!raw.trim()) continue;
          const frame = JSON.parse(raw) as
            | { type: "start"; response: AssistantResponse }
            | { type: "openui"; chunk: string }
            | { type: "complete"; response: AssistantResponse };
          if (frame.type === "start") {
            activeId = frame.response.id;
            rememberMessages((current) => [
              ...current,
              {
                kind: "turn",
                id: frame.response.id,
                prompt: submitted,
                response: frame.response,
                streaming: true,
              },
            ]);
          } else if (frame.type === "openui" && activeId) {
            partial += frame.chunk;
            rememberMessages((current) =>
              current.map((message) =>
                "response" in message && message.id === activeId
                  ? {
                      ...message,
                      response: { ...message.response, openUi: partial },
                      streaming: true,
                    }
                  : message,
              ),
            );
          } else if (frame.type === "complete") {
            completed = true;
            rememberMessages((current) =>
              current.map((message) =>
                "response" in message && message.id === frame.response.id
                  ? {
                      ...message,
                      response: frame.response,
                      streaming: false,
                    }
                  : message,
              ),
            );
          }
        }
        if (done) break;
      }
      if (!completed)
        throw new Error(
          "Die Antwort wurde unterbrochen. Es wurde keine Aktion freigeschaltet.",
        );
      if (
        controller.signal.aborted ||
        submittedContextEpoch !== contextEpoch.current
      )
        return;
      setPrompt("");
      setVoiceReview(null);
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError")
        return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Assistenz nicht verfügbar.",
      );
    } finally {
      requestAbort.current = null;
      setBusy(false);
    }
  };

  const startBrowserVoice = () => {
    const Recognition = speechRecognitionConstructor();
    if (!Recognition) {
      setError(
        "Dieser Browser stellt keine Demo-Spracherkennung bereit. Bitte Text verwenden.",
      );
      return;
    }
    recognition.current?.abort();
    const instance = new Recognition();
    recognition.current = instance;
    instance.lang = "de-CH";
    instance.interimResults = true;
    instance.continuous = false;
    instance.onresult = (event) => {
      let text = "";
      let confidence: number | null = null;
      let allFinal = true;
      for (let index = 0; index < event.results.length; index += 1) {
        allFinal &&= Boolean(event.results[index]?.isFinal);
        const alternative = event.results[index]?.[0];
        text += alternative?.transcript ?? "";
        if (typeof alternative?.confidence === "number")
          confidence =
            confidence === null
              ? alternative.confidence
              : Math.min(confidence, alternative.confidence);
      }
      const transcript = text.trim();
      setPrompt(transcript);
      if (!allFinal) {
        setVoiceReview(null);
        return;
      }
      setVoiceReview({
        confidence,
        entities: extractCriticalEntities(transcript, confidence),
        confirmed: false,
        confirmedEntityIds: [],
        receiptId: null,
      });
    };
    instance.onend = () => setRecording(false);
    instance.onerror = () => {
      setRecording(false);
      setError("Spracherkennung abgebrochen. Es wurde nichts dokumentiert.");
    };
    setError(null);
    setRecording(true);
    instance.start();
  };

  const startLocalVoice = async () => {
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Dieses Gerät unterstützt keine lokale Audioaufnahme.");
      return;
    }
    const generation = ++voiceGeneration.current;
    const recordedPatientId = patient?.id ?? null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== voiceGeneration.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStream.current = stream;
      audioChunks.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunks.current.push(event.data);
      };
      recorder.onstop = async () => {
        if (generation !== voiceGeneration.current) return;
        setBusy(true);
        setRecording(false);
        try {
          const blob = new Blob(audioChunks.current, {
            type: recorder.mimeType || "audio/webm",
          });
          audioChunks.current = [];
          const form = new FormData();
          form.set("file", blob, "utterance.webm");
          const controller = new AbortController();
          voiceAbort.current = controller;
          const result = await fetch("/api/v1/assistant/transcribe", {
            method: "POST",
            headers: {
              "x-demo-user": userId,
              "x-command-id": crypto.randomUUID(),
              "x-pfh-purpose": "direct-care",
              ...(recordedPatientId
                ? { "x-pfh-patient-context": recordedPatientId }
                : {}),
            },
            body: form,
            signal: controller.signal,
          });
          const body = (await result.json()) as {
            transcription?: {
              text: string;
              confidence: number | null;
              criticalEntities: CriticalEntity[];
            };
            voiceReceiptId?: string;
            message?: string;
          };
          if (!result.ok || !body.transcription?.text || !body.voiceReceiptId)
            throw new Error(body.message ?? "Transkription fehlgeschlagen.");
          if (
            generation !== voiceGeneration.current ||
            activePatientId.current !== recordedPatientId
          )
            return;
          setPrompt(body.transcription.text);
          setVoiceReview({
            confidence: body.transcription.confidence,
            entities: body.transcription.criticalEntities,
            confirmed: false,
            confirmedEntityIds: [],
            receiptId: body.voiceReceiptId,
          });
        } catch (failure) {
          if (!(
            failure instanceof DOMException && failure.name === "AbortError"
          ))
            setError(
              failure instanceof Error
                ? failure.message
                : "Lokale Transkription fehlgeschlagen.",
            );
        } finally {
          mediaStream.current?.getTracks().forEach((track) => track.stop());
          mediaStream.current = null;
          mediaRecorder.current = null;
          if (mediaStopTimer.current !== null)
            window.clearTimeout(mediaStopTimer.current);
          mediaStopTimer.current = null;
          voiceAbort.current = null;
          setBusy(false);
        }
      };
      setError(null);
      setRecording(true);
      recorder.start(500);
      mediaStopTimer.current = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 60_000);
    } catch {
      if (generation === voiceGeneration.current)
        setError(
          "Mikrofonzugriff wurde nicht erteilt. Es wurde kein Audio gespeichert.",
        );
    }
  };

  const startVoice = () => {
    if (
      aiStatus?.asr.ready &&
      ["local-openai", "hosted-test"].includes(aiStatus.asr.mode)
    )
      void startLocalVoice();
    else if (
      aiStatus?.asr.mode === "browser-demo" ||
      (aiStatus?.asr.mode === "hosted-test" && speechRecognitionConstructor())
    )
      startBrowserVoice();
    else
      setError(aiStatus?.asr.message ?? "Spracherkennung ist nicht verfügbar.");
  };
  const browserDemoFallbackReady = Boolean(
    aiStatus?.asr.mode === "hosted-test" && speechRecognitionConstructor(),
  );
  const voiceReady = Boolean(aiStatus?.asr.ready || browserDemoFallbackReady);

  const stopVoice = () => {
    if (mediaRecorder.current?.state === "recording")
      mediaRecorder.current.stop();
    else {
      recognition.current?.stop();
      setRecording(false);
    }
  };

  const execute = async (
    selectedAction: {
      event: ActionEvent;
      preview: string;
      response: AssistantResponse;
    } | null = pendingAction,
  ) => {
    const patientContext = selectedAction?.response.patientContext;
    if (!selectedAction || !patientContext || executionInFlight.current) return;
    executionInFlight.current = true;
    const selection = selectedAction;
    const executionContextEpoch = contextEpoch.current;
    const token = selection.event.params.intentToken;
    if (typeof token !== "string") return;
    setBusy(true);
    setError(null);
    try {
      requestAbort.current?.abort();
      const controller = new AbortController();
      requestAbort.current = controller;
      const result = await post<{
        handoff?: AssistantHandoff;
        bundle?: unknown;
        itemStates?: string[];
        workflowChanged?: boolean;
      }>(
        `/api/v1/assistant/intents/${token}/execute`,
        userId,
        {
          patientId: patientContext.patientId,
          encounterId: patientContext.encounterId,
          purpose: "direct-care",
          resourceVersion: patientContext.resourceVersion,
          explicitlyConfirmed: true,
          reviewedActionIds: Array.isArray(
            selection.event.params.reviewedActionIds,
          )
            ? selection.event.params.reviewedActionIds
            : undefined,
        },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        executionContextEpoch !== contextEpoch.current
      )
        return;
      setPendingAction(null);
      const execution = result.itemStates?.includes("reviewed")
        ? "Zur unabhängigen Zweitfreigabe vorgemerkt. Der ungewöhnliche Wert ist noch nicht als gültiger Vitalwert freigegeben."
        : result.bundle
          ? "Freigegeben: Die ausgewählten Angaben wurden lokal angenommen. Die externe Quittierung bleibt sichtbar."
          : result.workflowChanged
            ? "Erledigt: Die aktuelle Arbeit ist pausiert und der spontane Zimmerbesuch wurde gestartet."
            : result.handoff
              ? "Vorbereitet: Der strukturierte Sicherheitseditor wurde zur endgültigen Prüfung geöffnet; noch nichts wurde gesendet."
              : "Geprüfter Entwurf erstellt.";
      rememberMessages((current) =>
        current.map((message) =>
          "response" in message && message.id === selection.response.id
            ? {
                ...message,
                execution,
                response: {
                  ...message.response,
                  components: [],
                  openUi: completedActionOpenUi,
                },
              }
            : message,
        ),
      );
      if (result.handoff) onHandoff(result.handoff);
      await onExecuted(
        result.itemStates?.includes("reviewed")
          ? "Der ungewöhnliche Wert wartet auf eine unabhängige Zweitfreigabe und ist noch kein gültiger Vitalwert."
          : result.bundle
            ? "Die einzeln geprüften Angaben sind lokal freigegeben und werden nachvollziehbar synchronisiert."
            : result.workflowChanged
              ? "Arbeitswechsel übernommen. Der vorherige Patient bleibt sicher zum Fortsetzen vorgemerkt."
              : result.handoff
                ? "Die Angaben sind jetzt im passenden Sicherheitseditor geöffnet."
                : "Der prüfpflichtige Entwurf wurde erstellt.",
      );
    } catch (failure) {
      if (failure instanceof DOMException && failure.name === "AbortError")
        return;
      setError(
        failure instanceof Error
          ? failure.message
          : "Entwurf konnte nicht angelegt werden.",
      );
      setPendingAction(null);
    } finally {
      executionInFlight.current = false;
      requestAbort.current = null;
      setBusy(false);
    }
  };

  const quickPrompts = patient
    ? [
        "Übergabe",
        "Was ist noch offen?",
        "Letzte Vitalwerte",
        "Patientenprofil",
        "Offene Teamfragen",
      ]
    : ["Übergabe", "Meine offenen Aufgaben", "Was ist heute wichtig?"];
  const lastTurnId = [...messages]
    .reverse()
    .find((message) => message.kind === "turn")?.id;

  const runWorkdayAction = async (command: WorkdayCommand) => {
    if (interactionBusy) return;
    setWorkflowBusy(true);
    setError(null);
    try {
      await onWorkdayAction(command);
    } finally {
      setWorkflowBusy(false);
    }
  };

  return (
    <section
      id="conversation"
      tabIndex={-1}
      className="conversation"
      aria-label="Pflegehelfer Gespräch"
    >
      <div className="conversation-feed">
        {workday ? (
          <WorkdayCard
            workday={workday}
            patients={availablePatients}
            busy={interactionBusy}
            evidence={episodeEvidence}
            setEvidence={setEpisodeEvidence}
            selectPatient={onSelectPatient}
            act={runWorkdayAction}
            fail={setError}
          />
        ) : (
          <div
            className="assistant-message workflow-opening-turn"
            data-genui-component="WorkflowOpening"
          >
            <div className="assistant-avatar" aria-hidden="true">
              P
            </div>
            <div className="assistant-message-body">
              <div className="assistant-model-status">{opening.eyebrow}</div>
              <article className="assistant-card workflow-opening-card">
                <header>
                  <span>{opening.progress}</span>
                  <h2>{opening.title}</h2>
                </header>
                <p>{opening.summary}</p>
              </article>
            </div>
          </div>
        )}
        {messages.map((message, index) => {
          if (message.kind === "context")
            return (
              <div className="conversation-context-event" key={message.id}>
                <span aria-hidden="true">✓</span>
                {message.label}
              </div>
            );
          const parsed = createParser(
            clinicalAssistantLibrary.toJSONSchema(),
          ).parse(message.response.openUi);
          const renderable = Boolean(
            parsed.root &&
            parsed.meta.errors.length === 0 &&
            (message.streaming || parsed.meta.unresolved.length === 0),
          );
          return (
            <div className="chat-turn" key={message.id}>
              <div className="user-message">
                <span>Du</span>
                <p>{message.prompt}</p>
              </div>
              <div
                className="assistant-message"
                ref={message.id === lastTurnId ? lastResponse : undefined}
              >
                <div className="assistant-avatar" aria-hidden="true">
                  P
                </div>
                <div
                  className="assistant-message-body"
                  aria-live={index === messages.length - 1 ? "polite" : "off"}
                >
                  {message.response.runtime.degraded && (
                    <div className="assistant-model-status">
                      Sichere Basisantwort · keine klinische Aktion automatisch
                      ausgeführt
                    </div>
                  )}
                  {renderable ? (
                    <Renderer
                      response={message.response.openUi}
                      library={clinicalAssistantLibrary}
                      isStreaming={Boolean(message.streaming)}
                      onAction={(event) => {
                        if (
                          message.streaming ||
                          message.archived ||
                          (message.response.patientContext &&
                            message.response.patientContext.patientId !==
                              patient?.id)
                        ) {
                          setError(
                            "Diese offene Änderung gehört nicht zum aktiven Patientenkontext und wurde nicht geöffnet.",
                          );
                          return;
                        }
                        if (
                          String(event.type) === "SelectPatient" &&
                          typeof event.params.patientId === "string"
                        ) {
                          onSelectPatient(event.params.patientId);
                          return;
                        }
                        if (
                          String(event.type) === "TransitionCommunication" &&
                          typeof event.params.id === "string" &&
                          ["acknowledge", "answer", "close"].includes(
                            String(event.params.transition),
                          )
                        ) {
                          const transition = String(event.params.transition) as
                            "acknowledge" | "answer" | "close";
                          const response =
                            typeof event.params.response === "string"
                              ? event.params.response.trim()
                              : undefined;
                          setBusy(true);
                          setError(null);
                          void post(
                            `/api/v1/communications/${encodeURIComponent(event.params.id)}/${transition}`,
                            userId,
                            {
                              ...(response ? { response } : {}),
                              createTask: false,
                            },
                          )
                            .then(async () => {
                              setMessages((current) =>
                                current.filter(
                                  (item) => item.id !== message.id,
                                ),
                              );
                              await onExecuted(
                                transition === "answer"
                                  ? "Antwort gesendet. Öffne @ Team erneut für den aktuellen Stand."
                                  : transition === "close"
                                    ? "Teamfrage geschlossen."
                                    : "Teamfrage übernommen. Öffne @ Team erneut zum Antworten.",
                              );
                            })
                            .catch((failure: unknown) =>
                              setError(
                                failure instanceof Error
                                  ? failure.message
                                  : "Teamfrage konnte nicht aktualisiert werden.",
                              ),
                            )
                            .finally(() => setBusy(false));
                          return;
                        }
                        const action = message.response.components.find(
                          (component) =>
                            component.type === "DraftAction" &&
                            component.intentToken === event.params.intentToken,
                        );
                        const reviewedIds = Array.isArray(
                          event.params.reviewedActionIds,
                        )
                          ? new Set(event.params.reviewedActionIds)
                          : null;
                        const selectedAction = {
                          event,
                          preview:
                            action?.reviewItems && reviewedIds
                              ? action.reviewItems
                                  .filter((item) => reviewedIds.has(item.id))
                                  .map(
                                    (item, index) =>
                                      `${index + 1}. ${item.label}`,
                                  )
                                  .join("\n")
                              : (action?.preview ??
                                "Die gebundene Änderung konnte nicht dargestellt werden und kann deshalb nicht freigegeben werden."),
                          response: message.response,
                        };
                        setPendingAction(selectedAction);
                        void execute(selectedAction);
                      }}
                    />
                  ) : (
                    <div className="assistant-error" role="alert">
                      Diese Antwort wurde wegen einer ungültigen Komponente
                      verworfen.
                    </div>
                  )}
                  {message.response.evidence.length > 0 && (
                    <details className="assistant-evidence">
                      <summary>
                        Quellen &amp; Versionen (
                        {message.response.evidence.length})
                      </summary>
                      {message.response.evidence.map((item) => (
                        <div key={`${item.resourceId}:${item.version}`}>
                          <code>{item.resourceId}</code> · v{item.version} ·{" "}
                          {item.label}
                        </div>
                      ))}
                    </details>
                  )}
                  {message.execution && (
                    <div className="execution-confirmation" role="status">
                      <strong>Ausgeführt</strong>
                      <span>{message.execution}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {interactionBusy && (
          <div className="assistant-thinking" role="status">
            {externallyBusy
              ? "Patientenkontext wird sicher gewechselt…"
              : workflowBusy
                ? "Arbeitstag wird sicher aktualisiert…"
                : "Pflegekontext wird sicher ausgewertet…"}
          </div>
        )}
        {error && (
          <div className="assistant-error" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="composer-dock">
        <div className="quick-prompts" aria-label="Schnellzugriffe">
          {quickPrompts.map((label) => (
            <button
              key={label}
              disabled={interactionBusy || !online}
              onClick={() => {
                setVoiceReview(null);
                void ask(undefined, label);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {voiceReview && (
          <div
            className="voice-review"
            role="group"
            aria-label="Sprachtranskript prüfen"
          >
            <div>
              <strong>Sprachtranskript prüfen</strong>
              <span>
                Unkalibriertes Modellsignal:{" "}
                {voiceReview.confidence === null
                  ? "nicht vom Modell ausgewiesen"
                  : `${Math.round(voiceReview.confidence * 100)} %`}
              </span>
            </div>
            {voiceReview.entities.length > 0 && (
              <div className="voice-entities" aria-label="Kritische Angaben">
                {voiceReview.entities.map((entity) => {
                  const id = entityKey(entity);
                  return (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={voiceReview.confirmedEntityIds.includes(id)}
                        disabled={recording}
                        onChange={(event) =>
                          setVoiceReview((current) => {
                            if (!current) return null;
                            const selected = new Set(
                              current.confirmedEntityIds,
                            );
                            if (event.target.checked) selected.add(id);
                            else selected.delete(id);
                            return {
                              ...current,
                              confirmed: false,
                              confirmedEntityIds: [...selected],
                            };
                          })
                        }
                      />
                      <mark>{entity.text}</mark>
                      <small>{entity.kind}</small>
                    </label>
                  );
                })}
              </div>
            )}
            <label>
              <input
                type="checkbox"
                checked={voiceReview.confirmed}
                disabled={
                  recording ||
                  voiceReview.confirmedEntityIds.length !==
                    voiceReview.entities.length
                }
                onChange={(event) =>
                  setVoiceReview((current) =>
                    current
                      ? { ...current, confirmed: event.target.checked }
                      : null,
                  )
                }
              />
              Transkript, Patient und kritische Angaben sind geprüft
            </label>
          </div>
        )}
        <form
          className="assistant-composer"
          onSubmit={(event) => void ask(event)}
        >
          <button
            type="button"
            className={recording ? "voice recording" : "voice"}
            aria-label={
              recording ? "Aufnahme stoppen" : "Sprachnachricht aufnehmen"
            }
            onClick={recording ? stopVoice : startVoice}
            disabled={interactionBusy || !online || !voiceReady}
          >
            {recording ? (
              <span aria-hidden="true">■</span>
            ) : (
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="20"
                height="20"
              >
                <path
                  fill="currentColor"
                  d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V21h3a1 1 0 1 1 0 2H8a1 1 0 1 1 0-2h3v-2.07A7 7 0 0 1 5 12a1 1 0 1 1 2 0 5 5 0 0 0 10 0Z"
                />
              </svg>
            )}
          </button>
          <label className="composer-input">
            <span className="sr-only">Nachricht an Pflegehelfer</span>
            <textarea
              aria-label="Nachricht an Pflegehelfer"
              value={prompt}
              maxLength={1200}
              rows={1}
              placeholder={
                patient
                  ? `${patient.displayName.split(" ")[0]}: fragen, sprechen oder dokumentieren…`
                  : "Fragen, sprechen oder Arbeit organisieren…"
              }
              onChange={(event) => {
                const value = event.target.value;
                event.currentTarget.style.height = "auto";
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 150)}px`;
                setPrompt(value);
                setVoiceReview((current) =>
                  current
                    ? {
                        ...current,
                        confirmed: false,
                        confirmedEntityIds: [],
                        receiptId: null,
                        entities: extractCriticalEntities(
                          value,
                          current.confidence,
                        ),
                      }
                    : null,
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void ask();
                }
              }}
              disabled={interactionBusy || recording}
            />
          </label>
          <button
            className="send-button"
            aria-label="Nachricht senden"
            disabled={
              interactionBusy ||
              recording ||
              !online ||
              prompt.trim().length < 2 ||
              Boolean(
                voiceReview &&
                (!voiceReview.confirmed ||
                  voiceReview.confirmedEntityIds.length !==
                    voiceReview.entities.length),
              )
            }
          >
            ↑
          </button>
        </form>
        <small className="composer-meta">
          {voiceReady
            ? browserDemoFallbackReady && !aiStatus?.asr.ready
              ? "Browser-Spracheingabe für synthetische Demo bereit"
              : "Spracheingabe bereit"
            : "Spracheingabe in dieser Demo nicht eingerichtet"}{" "}
          · Audio wird nach der Transkription verworfen · keine automatische
          Freigabe
        </small>
      </div>
    </section>
  );
}
