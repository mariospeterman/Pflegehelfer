import {
  Renderer,
  createParser,
  type ActionEvent,
} from "@openuidev/react-lang";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { Patient } from "../../core/types";
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
  0: { transcript: string };
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
  id: string;
  prompt: string;
  response: AssistantResponse;
  execution?: string;
}

const conversationMemory = new Map<string, ChatMessage[]>();

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
}: {
  patient: Patient | null;
  userId: string;
  online: boolean;
  onExecuted: (message: string) => Promise<void>;
  onHandoff: (handoff: AssistantHandoff) => void;
  snapshotRevision: string;
  contextProjection: ReactNode;
  conversationId: string;
}) {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    structuredClone(conversationMemory.get(conversationId) ?? []),
  );
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
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
  const lastRevision = useRef(snapshotRevision);
  const messageEnd = useRef<HTMLDivElement | null>(null);
  const reviewPanel = useRef<HTMLElement | null>(null);

  const rememberMessages = (
    update: (current: ChatMessage[]) => ChatMessage[],
  ) => {
    setMessages((current) => {
      const next = update(current);
      conversationMemory.set(conversationId, structuredClone(next));
      while (conversationMemory.size > 24)
        conversationMemory.delete(conversationMemory.keys().next().value!);
      return next;
    });
  };

  const cancelVoice = () => {
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
  };

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
    if (lastRevision.current === snapshotRevision) return;
    lastRevision.current = snapshotRevision;
    if (pendingAction) {
      setPendingAction(null);
      setError(
        "Der klinische Stand hat sich geändert. Bitte den Vorschlag neu erstellen.",
      );
    }
  }, [pendingAction, snapshotRevision]);

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
    [],
  );

  const ask = async (event?: FormEvent) => {
    event?.preventDefault();
    const submitted = prompt.trim();
    if (!online || submitted.length < 2) return;
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
        { prompt: submitted, patientId: patient?.id ?? null },
        controller.signal,
      );
      rememberMessages((current) => [
        ...current,
        { id: response.id, prompt: submitted, response },
      ]);
      setPrompt("");
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
      for (let index = 0; index < event.results.length; index += 1)
        text += event.results[index]?.[0]?.transcript ?? "";
      setPrompt(text.trim());
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
            text?: string;
            message?: string;
          };
          if (!result.ok || !body.text)
            throw new Error(body.message ?? "Transkription fehlgeschlagen.");
          setPrompt(body.text);
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
    if (!pendingAction?.response.patientContext) return;
    const token = pendingAction.event.params.intentToken;
    if (typeof token !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const result = await post<{
        handoff?: AssistantHandoff;
        bundle?: unknown;
      }>(`/api/v1/assistant/intents/${token}/execute`, userId, {
        patientId: pendingAction.response.patientContext.patientId,
        encounterId: pendingAction.response.patientContext.encounterId,
        purpose: "direct-care",
        resourceVersion: pendingAction.response.patientContext.resourceVersion,
        explicitlyConfirmed: true,
      });
      setPendingAction(null);
      const execution = result.bundle
        ? "Freigegeben: Pflegedokumentation und Blutdruck warten auf Provider-Bestätigung; Arztfrage ist gesendet; Folgeaufgabe ist neu."
        : result.handoff
          ? "Geprüft: Der strukturierte Sicherheitseditor ist für die endgültige Eingabe geöffnet."
          : "Geprüfter Entwurf erstellt.";
      rememberMessages((current) =>
        current.map((message) =>
          message.id === pendingAction.response.id
            ? { ...message, execution }
            : message,
        ),
      );
      if (result.handoff) onHandoff(result.handoff);
      await onExecuted(
        result.bundle
          ? "Pflegeeintrag, Messwert, Arztfrage und Folgeaufgabe wurden geprüft erstellt. Die Provider-Synchronisation ist sichtbar."
          : result.handoff
            ? "Der Vorschlag ist jetzt als strukturierter Entwurf im Gespräch geöffnet."
            : "Der prüfpflichtige Entwurf wurde erstellt.",
      );
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Entwurf konnte nicht angelegt werden.",
      );
    } finally {
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
      <div className="conversation-feed" aria-live="polite">
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
        {messages.map((message) => {
          const parsed = createParser(
            clinicalAssistantLibrary.toJSONSchema(),
          ).parse(message.response.openUi);
          const renderable = Boolean(
            parsed.root &&
            parsed.meta.errors.length === 0 &&
            parsed.meta.unresolved.length === 0,
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
                <div className="assistant-message-body">
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
                      isStreaming={false}
                      onAction={(event) => {
                        const action = message.response.components.find(
                          (component) =>
                            component.type === "DraftAction" &&
                            component.intentToken === event.params.intentToken,
                        );
                        setPendingAction({
                          event,
                          preview:
                            action?.preview ??
                            "Der gebundene Vorschlag konnte nicht dargestellt werden und kann deshalb nicht freigegeben werden.",
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
          <div className="assistant-thinking">
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
              Mit Freigeben bestätigst du Patientenkontext und sichtbare
              Änderungen. Rollen-, Werte-, Versions- und Providerregeln werden
              serverseitig erneut geprüft.
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
                Prüfen &amp; freigeben
              </button>
            </div>
          </section>
        )}
        <div ref={messageEnd} />
      </div>

      <div className="composer-dock">
        {messages.length > 0 && (
          <button
            className="conversation-history-control"
            onClick={() => {
              conversationMemory.delete(conversationId);
              setMessages([]);
              setPrompt("");
              setPendingAction(null);
            }}
          >
            Kontextverlauf löschen
          </button>
        )}
        <div className="quick-prompts" aria-label="Schnellzugriffe">
          {quickPrompts.map((label) => (
            <button key={label} onClick={() => setPrompt(label)}>
              {label}
            </button>
          ))}
        </div>
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
              onChange={(event) => setPrompt(event.target.value)}
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
            disabled={busy || !online || prompt.trim().length < 2}
          >
            ↑
          </button>
        </form>
        <small className="composer-meta">
          {aiStatus?.asr.message ?? "Sprachstatus wird geprüft…"} · Audio wird
          nach Transkription verworfen · keine automatische Freigabe
        </small>
      </div>
    </section>
  );
}
