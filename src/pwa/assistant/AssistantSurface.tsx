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
  type ReactNode,
} from "react";
import type { Patient } from "../../core/types";
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
      kind: "note" | "observation" | "communication" | "task";
    }>;
  }>;
  openUi: string;
  evidence: { resourceId: string; version: number; label: string }[];
  warnings: string[];
}

interface AiStatus {
  asr: {
    mode: "disabled" | "browser-demo" | "local-openai";
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
  recipientRole?: "physician";
  dueAt: string;
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
  'item0 = SafetyNotice("info", "Dieser frühere Vorschlag wurde beim Kontextwechsel sicher geschlossen. Bitte im aktuellen Patientenkontext neu formulieren.")',
].join("\n");

function archiveExecutableMessage(
  message: ConversationMessage,
): ConversationMessage {
  if (
    message.kind === "context" ||
    !message.response.components.some(
      (component) => component.type === "DraftAction",
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
  const result = (await response.json()) as T & { message?: string };
  if (!response.ok)
    throw new Error(result.message ?? "Assistenzaktion fehlgeschlagen.");
  return result;
}

export function AssistantSurface({
  patient,
  userId,
  online,
  onExecuted,
  onHandoff,
  snapshotRevision,
  contextProjection,
  conversationId,
  onSelectPatient,
  onBusyChange,
}: {
  patient: Patient | null;
  userId: string;
  online: boolean;
  onExecuted: (message: string) => Promise<void>;
  onHandoff: (handoff: AssistantHandoff) => void;
  snapshotRevision: string;
  contextProjection: ReactNode;
  conversationId: string;
  onSelectPatient: (patientId: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [busy, setBusy] = useState(false);
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
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const mediaStream = useRef<MediaStream | null>(null);
  const audioChunks = useRef<Blob[]>([]);
  const requestAbort = useRef<AbortController | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const voiceGeneration = useRef(0);
  const contextEpoch = useRef(0);
  const lastRevision = useRef(snapshotRevision);
  const activePatientId = useRef(patient?.id ?? null);
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const reviewPanel = useRef<HTMLElement | null>(null);

  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);

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
  }, [conversationId, userId]);

  useEffect(() => {
    if (lastRevision.current === snapshotRevision) return;
    lastRevision.current = snapshotRevision;
    if (pendingAction) {
      contextEpoch.current += 1;
      requestAbort.current?.abort();
      requestAbort.current = null;
      setPendingAction(null);
      setError(
        "Der klinische Stand hat sich geändert. Bitte den Vorschlag neu erstellen.",
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
          "Patientenkontext geändert: Der offene Vorschlag wurde sicher verworfen.",
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
  }, [cancelVoice, conversationId, patient]);

  useEffect(() => {
    if (!online && pendingAction) {
      setPendingAction(null);
      setError(
        "Offline: Der noch nicht freigegebene Vorschlag wurde verworfen.",
      );
    }
  }, [online, pendingAction]);

  useEffect(() => {
    if (messages.length === 0 && !pendingAction) return;
    messageEnd.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [messages, pendingAction]);

  useEffect(() => {
    if (!pendingAction) return;
    requestAnimationFrame(() => reviewPanel.current?.focus());
  }, [pendingAction]);

  useEffect(
    () => () => {
      requestAbort.current?.abort();
      cancelVoice();
    },
    [cancelVoice],
  );

  const ask = async (event?: FormEvent) => {
    event?.preventDefault();
    const submitted = prompt.trim();
    const submittedContextEpoch = contextEpoch.current;
    if (!online || submitted.length < 2) return;
    if (
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
      const response = await post<AssistantResponse>(
        "/api/v1/assistant/query",
        userId,
        {
          prompt: submitted,
          patientId: patient?.id ?? null,
          inputModality: voiceReview?.receiptId ? "voice" : "typed",
          voiceTranscriptConfirmed: voiceReview?.confirmed ?? false,
          voiceReceiptId: voiceReview?.receiptId ?? undefined,
          voiceConfirmedEntityIds: voiceReview?.confirmedEntityIds,
        },
        controller.signal,
      );
      if (
        controller.signal.aborted ||
        submittedContextEpoch !== contextEpoch.current
      )
        return;
      const lines = response.openUi.split("\n");
      const progressiveResponse = {
        ...response,
        openUi: lines[0] ?? "",
      };
      rememberMessages((current) => [
        ...current,
        {
          kind: "turn",
          id: response.id,
          prompt: submitted,
          response: progressiveResponse,
          streaming: lines.length > 1,
        },
      ]);
      for (let index = 1; index < lines.length; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 24));
        if (
          controller.signal.aborted ||
          submittedContextEpoch !== contextEpoch.current
        )
          return;
        rememberMessages((current) =>
          current.map((message) =>
            "response" in message && message.id === response.id
              ? {
                  ...message,
                  response: {
                    ...response,
                    openUi: lines.slice(0, index + 1).join("\n"),
                  },
                  streaming: index < lines.length - 1,
                }
              : message,
          ),
        );
      }
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
    if (!patient) {
      setError("Bitte vor der lokalen Aufnahme einen Patientenkontext wählen.");
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Dieses Gerät unterstützt keine lokale Audioaufnahme.");
      return;
    }
    const generation = ++voiceGeneration.current;
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
              "x-pfh-patient-context": patient.id,
              "x-pfh-purpose": "direct-care",
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
            activePatientId.current !== patient.id
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
          voiceAbort.current = null;
          setBusy(false);
        }
      };
      setError(null);
      setRecording(true);
      recorder.start(500);
    } catch {
      if (generation === voiceGeneration.current)
        setError(
          "Mikrofonzugriff wurde nicht erteilt. Es wurde kein Audio gespeichert.",
        );
    }
  };

  const startVoice = () => {
    if (aiStatus?.asr.mode === "local-openai") void startLocalVoice();
    else if (aiStatus?.asr.mode === "browser-demo") startBrowserVoice();
    else
      setError(aiStatus?.asr.message ?? "Spracherkennung ist nicht verfügbar.");
  };

  const stopVoice = () => {
    if (mediaRecorder.current?.state === "recording")
      mediaRecorder.current.stop();
    else {
      recognition.current?.stop();
      setRecording(false);
    }
  };

  const execute = async () => {
    const patientContext = pendingAction?.response.patientContext;
    if (!pendingAction || !patientContext) return;
    const proposal = pendingAction;
    const executionContextEpoch = contextEpoch.current;
    const token = proposal.event.params.intentToken;
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
            proposal.event.params.reviewedActionIds,
          )
            ? proposal.event.params.reviewedActionIds
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
      const execution = result.bundle
        ? "Geprüft: Die ausgewählten Aktionen wurden als Entwürfe beziehungsweise geschlossene Workflow-Objekte angelegt. Klinische Entwürfe warten auf die normale Freigabe."
        : result.handoff
          ? "Geprüft: Der strukturierte Sicherheitseditor ist für die endgültige Eingabe geöffnet."
          : "Geprüfter Entwurf erstellt.";
      rememberMessages((current) =>
        current.map((message) =>
          "response" in message && message.id === proposal.response.id
            ? { ...message, execution }
            : message,
        ),
      );
      if (result.handoff) onHandoff(result.handoff);
      await onExecuted(
        result.bundle
          ? "Die einzeln ausgewählten Aktionen wurden erstellt. Notiz und Messwert bleiben bis zur normalen Freigabe Entwürfe."
          : result.handoff
            ? "Der Vorschlag ist jetzt als strukturierter Entwurf im Gespräch geöffnet."
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
    } finally {
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
        "Frage an Arzt: Bitte aktuellen Zustand beurteilen",
      ]
    : ["Übergabe", "Meine offenen Aufgaben", "Was ist heute wichtig?"];

  return (
    <section className="conversation" aria-label="Pflegehelfer Gespräch">
      <div className="conversation-feed">
        <div
          className="assistant-message context-projection-turn"
          data-genui-component="ClinicalContextProjection"
        >
          <div className="assistant-avatar" aria-hidden="true">
            P
          </div>
          <div className="assistant-message-body">
            <div className="assistant-model-status">
              Live-Kontext · deterministische Medplum-Projektion
            </div>
            {contextProjection}
          </div>
        </div>
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
              <div className="assistant-message">
                <div className="assistant-avatar" aria-hidden="true">
                  P
                </div>
                <div
                  className="assistant-message-body"
                  aria-live={index === messages.length - 1 ? "polite" : "off"}
                >
                  <div className="assistant-model-status">
                    {message.response.runtime.label}
                    {message.response.runtime.degraded
                      ? " · deterministisch abgesichert"
                      : ""}
                  </div>
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
                            "Dieser Vorschlag gehört nicht zum aktiven Patientenkontext und wurde nicht geöffnet.",
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
                        setPendingAction({
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
                                "Der gebundene Vorschlag konnte nicht dargestellt werden und kann deshalb nicht freigegeben werden."),
                          response: message.response,
                        });
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
        {busy && (
          <div className="assistant-thinking" role="status">
            Pflegekontext wird sicher ausgewertet…
          </div>
        )}
        {error && (
          <div className="assistant-error" role="alert">
            {error}
          </div>
        )}
        {pendingAction?.response.patientContext && (
          <section
            ref={reviewPanel}
            className="assistant-action-review"
            aria-label="Assistenzvorschlag prüfen"
            tabIndex={-1}
          >
            <span className="eyebrow">Verbindliche Prüfung</span>
            <h3>Noch nicht freigegeben</h3>
            <p className="identity-check">
              {pendingAction.response.patientContext.displayName} · geb.{" "}
              {pendingAction.response.patientContext.birthDate
                .split("-")
                .reverse()
                .join(".")}{" "}
              · Fall {pendingAction.response.patientContext.mrn} · Version{" "}
              {pendingAction.response.patientContext.resourceVersion}
            </p>
            <pre>{pendingAction.preview}</pre>
            <p className="safety-copy">
              Du bestätigst Patientenkontext und genau die oben sichtbaren
              Aktionen. Rollen-, Werte- und Versionsregeln werden serverseitig
              erneut geprüft. Klinische Einträge bleiben bis zur normalen
              Freigabe Entwürfe.
            </p>
            <div className="button-row">
              <button
                className="secondary"
                onClick={() => setPendingAction(null)}
              >
                Ändern / verwerfen
              </button>
              <button
                className="primary"
                disabled={busy || !online}
                onClick={() => void execute()}
              >
                Geprüfte Auswahl anlegen
              </button>
            </div>
          </section>
        )}
        <div ref={messageEnd} />
      </div>

      <div
        className={
          pendingAction ? "composer-dock review-hidden" : "composer-dock"
        }
      >
        {messages.length > 0 && (
          <button
            className="conversation-history-control"
            onClick={() => {
              void post<{ cleared: boolean }>(
                "/api/v1/assistant/conversation/clear",
                userId,
                {},
              ).catch(() =>
                setError("Der Schichtverlauf konnte nicht gelöscht werden."),
              );
              setMessages([]);
              setPrompt("");
              setVoiceReview(null);
              setPendingAction(null);
            }}
          >
            Kontextverlauf löschen
          </button>
        )}
        <div className="quick-prompts" aria-label="Schnellzugriffe">
          {quickPrompts.map((label) => (
            <button
              key={label}
              onClick={() => {
                setPrompt(label);
                setVoiceReview(null);
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
            disabled={busy || !online || !aiStatus?.asr.ready}
          >
            {recording ? "■" : "●"}
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
              disabled={busy || recording}
            />
          </label>
          <button
            className="send-button"
            aria-label="Nachricht senden"
            disabled={
              busy ||
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
          {aiStatus?.asr.message ?? "Sprachstatus wird geprüft…"} · Audio wird
          nach Transkription verworfen · jede kritische Angabe einzeln prüfen ·
          keine automatische Freigabe
        </small>
      </div>
    </section>
  );
}
