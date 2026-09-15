import { useThread } from "@openuidev/react-headless";
import { useEffect, useRef, useState } from "react";
import type { Patient } from "../../core/types";
import {
  extractCriticalEntities,
  type CriticalEntity,
} from "../../core/critical-entities";
import { assistantClientContextHeaders } from "../assistant-context";
import type { VoiceSubmission } from "./openui-client";

export interface MutableSubmissionChannel {
  set(prompt: string, voice: VoiceSubmission): void;
  take(prompt: string): VoiceSubmission | null;
}

interface VoiceReview {
  original: string;
  receiptId: string;
  entities: CriticalEntity[];
  confirmed: Set<string>;
  reviewConfirmed: boolean;
}

interface AsrAvailability {
  ready: boolean;
  message: string;
}

const entityId = (entity: CriticalEntity) =>
  `${entity.kind}:${entity.start}:${entity.end}`;

export function ClinicalComposer({
  userId,
  patient,
  online,
  externallyBusy,
  launchPrompt,
  submissionChannel,
  starters,
  onError,
  onBusy,
}: {
  userId: string;
  patient: Patient | null;
  online: boolean;
  externallyBusy: boolean;
  launchPrompt: { id: number; text: string; autoSubmit?: boolean } | null;
  submissionChannel: MutableSubmissionChannel;
  starters: Array<{ label: string; prompt: string }>;
  onError: (message: string | null) => void;
  onBusy: (busy: boolean) => void;
}) {
  const {
    processMessage,
    cancelMessage,
    isRunning,
    isLoadingMessages,
    messages,
  } = useThread();
  const draftKey = `pflegehelfer:draft:${userId}:${patient?.id ?? "general"}:${patient?.encounterId ?? "none"}`;
  const [value, setValue] = useState(
    () => sessionStorage.getItem(draftKey) ?? "",
  );
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [asr, setAsr] = useState<AsrAvailability>({
    ready: false,
    message: "Spracherkennung wird geprüft.",
  });
  const [voice, setVoice] = useState<VoiceReview | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const media = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const transcriptionAbort = useRef<AbortController | null>(null);
  const activeDraftKey = useRef(draftKey);
  const mounted = useRef(true);
  const recordingTimer = useRef<number | null>(null);
  const recordingBytes = useRef(0);
  const recordingFailure = useRef<string | null>(null);
  const seenLaunch = useRef<number | null>(null);
  activeDraftKey.current = draftKey;
  const busy =
    isRunning ||
    isLoadingMessages ||
    requestingMicrophone ||
    recording ||
    transcribing ||
    externallyBusy;
  const showStarters = !isLoadingMessages && messages.length === 0;

  useEffect(() => {
    onBusy(isRunning || requestingMicrophone || recording || transcribing);
    return () => onBusy(false);
  }, [isRunning, onBusy, recording, requestingMicrophone, transcribing]);

  useEffect(() => {
    if (value) sessionStorage.setItem(draftKey, value);
    else sessionStorage.removeItem(draftKey);
  }, [draftKey, value]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/v1/ai/status", {
      headers: {
        "x-demo-user": userId,
        ...assistantClientContextHeaders(),
      },
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json()) as {
          asr?: {
            ready?: boolean;
            acceptance?: string;
            message?: string;
          };
          message?: string;
        };
        if (!response.ok)
          throw new Error(
            body.message ?? "Spracherkennungsstatus ist nicht verfügbar.",
          );
        setAsr({
          ready: body.asr?.ready === true && body.asr.acceptance === "accepted",
          message:
            body.asr?.message ?? "Spracherkennung ist nicht freigegeben.",
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAsr({
          ready: false,
          message:
            error instanceof Error
              ? error.message
              : "Spracherkennungsstatus ist nicht verfügbar.",
        });
      });
    return () => controller.abort();
  }, [userId]);

  useEffect(() => {
    if (!launchPrompt || seenLaunch.current === launchPrompt.id) return;
    seenLaunch.current = launchPrompt.id;
    setVoice(null);
    setValue(launchPrompt.text);
    if (launchPrompt.autoSubmit)
      void processMessage({
        role: "user",
        content: [{ type: "text", text: launchPrompt.text }],
      });
    if (launchPrompt.autoSubmit) setValue("");
  }, [launchPrompt, processMessage]);

  useEffect(
    () => () => {
      mounted.current = false;
      if (recordingTimer.current !== null)
        window.clearTimeout(recordingTimer.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      transcriptionAbort.current?.abort();
      media.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  useEffect(() => {
    transcriptionAbort.current?.abort();
    transcriptionAbort.current = null;
    setTranscribing(false);
  }, [draftKey]);

  const submit = async () => {
    const prompt = value.trim();
    if (prompt.length < 2 || busy || !online) return;
    if (voice) {
      if (
        !voice.reviewConfirmed ||
        voice.confirmed.size !== voice.entities.length
      ) {
        onError(
          "Bitte Transkript und hervorgehobene kritische Angaben zuerst bestätigen.",
        );
        return;
      }
      submissionChannel.set(prompt, {
        inputModality: "voice",
        voiceTranscriptConfirmed: true,
        voiceReceiptId: voice.receiptId,
        voiceConfirmedEntityIds: [...voice.confirmed],
      });
    }
    onError(null);
    setValue("");
    setVoice(null);
    await processMessage({
      role: "user",
      content: [{ type: "text", text: prompt }],
    });
  };

  const startRecording = async () => {
    if (!asr.ready) {
      onError(asr.message);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      onError("Dieses Gerät unterstützt keine geschützte Audioaufnahme.");
      return;
    }
    const recordingDraftKey = draftKey;
    setRequestingMicrophone(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || activeDraftKey.current !== recordingDraftKey) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      media.current = stream;
      chunks.current = [];
      recordingBytes.current = 0;
      recordingFailure.current = null;
      const current = new MediaRecorder(stream);
      recorder.current = current;
      current.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        recordingBytes.current += event.data.size;
        if (recordingBytes.current > 7.5 * 1024 * 1024) {
          recordingFailure.current =
            "Die Aufnahme wurde am sicheren Grössenlimit beendet. Bitte sprich die Nachricht kürzer ein.";
          if (current.state === "recording") current.stop();
          return;
        }
        chunks.current.push(event.data);
      };
      current.onstop = async () => {
        if (recordingTimer.current !== null) {
          window.clearTimeout(recordingTimer.current);
          recordingTimer.current = null;
        }
        setRecording(false);
        const recordingError = recordingFailure.current;
        recordingFailure.current = null;
        if (
          recordingError ||
          !mounted.current ||
          activeDraftKey.current !== recordingDraftKey
        ) {
          chunks.current = [];
          media.current?.getTracks().forEach((track) => track.stop());
          media.current = null;
          recorder.current = null;
          if (recordingError && mounted.current) onError(recordingError);
          return;
        }
        onError(null);
        const transcriptionDraftKey = draftKey;
        const controller = new AbortController();
        transcriptionAbort.current?.abort();
        transcriptionAbort.current = controller;
        setTranscribing(true);
        try {
          const blob = new Blob(chunks.current, {
            type: current.mimeType || "audio/webm",
          });
          chunks.current = [];
          const form = new FormData();
          form.set("file", blob, "utterance.webm");
          const response = await fetch("/api/v1/assistant/transcribe", {
            method: "POST",
            headers: {
              "x-demo-user": userId,
              ...assistantClientContextHeaders(),
              "x-command-id": crypto.randomUUID(),
              "x-pfh-purpose": "direct-care",
            },
            body: form,
            signal: controller.signal,
          });
          const body = (await response.json()) as {
            transcription?: {
              text: string;
              criticalEntities?: CriticalEntity[];
            };
            voiceReceiptId?: string;
            message?: string;
          };
          if (!response.ok || !body.transcription?.text || !body.voiceReceiptId)
            throw new Error(body.message ?? "Transkription fehlgeschlagen.");
          if (
            controller.signal.aborted ||
            activeDraftKey.current !== transcriptionDraftKey
          )
            return;
          const text = body.transcription.text;
          setValue(text);
          setVoice({
            original: text,
            receiptId: body.voiceReceiptId,
            entities:
              body.transcription.criticalEntities ??
              extractCriticalEntities(text, null),
            confirmed: new Set(),
            reviewConfirmed: false,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          onError(
            error instanceof Error
              ? error.message
              : "Transkription fehlgeschlagen.",
          );
        } finally {
          if (transcriptionAbort.current === controller) {
            transcriptionAbort.current = null;
            setTranscribing(false);
          }
          media.current?.getTracks().forEach((track) => track.stop());
          media.current = null;
          recorder.current = null;
        }
      };
      current.start(500);
      setRecording(true);
      recordingTimer.current = window.setTimeout(() => {
        recordingFailure.current =
          "Die Aufnahme wurde nach 60 Sekunden automatisch beendet.";
        if (current.state === "recording") current.stop();
      }, 60_000);
    } catch {
      onError(
        "Mikrofonzugriff wurde nicht erteilt. Es wurde kein Audio gespeichert.",
      );
    } finally {
      if (mounted.current) setRequestingMicrophone(false);
    }
  };

  return (
    <div className="clinical-composer-wrap">
      {showStarters && (
        <div className="quick-prompts" aria-label="Gesprächsvorschläge">
          {starters.map((starter) => (
            <button
              type="button"
              key={starter.prompt}
              disabled={busy || !online}
              onClick={() => {
                setValue("");
                onError(null);
                void processMessage({
                  role: "user",
                  content: [{ type: "text", text: starter.prompt }],
                });
              }}
            >
              {starter.label}
            </button>
          ))}
        </div>
      )}
      {voice && (
        <fieldset className="voice-review">
          <legend>Sprachtranskript prüfen</legend>
          <p>
            Bearbeite den Wortlaut bei Bedarf und bestätige kritische Angaben.
          </p>
          <div className="voice-entities">
            {voice.entities.map((entity) => {
              const id = entityId(entity);
              return (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={voice.confirmed.has(id)}
                    onChange={(event) =>
                      setVoice((current) => {
                        if (!current) return null;
                        const confirmed = new Set(current.confirmed);
                        if (event.target.checked) confirmed.add(id);
                        else confirmed.delete(id);
                        return { ...current, confirmed };
                      })
                    }
                  />
                  <mark>{entity.text}</mark>
                  <small>{entity.kind}</small>
                </label>
              );
            })}
          </div>
          <label className="voice-review-confirmation">
            <input
              type="checkbox"
              checked={voice.reviewConfirmed}
              onChange={(event) =>
                setVoice((current) =>
                  current
                    ? { ...current, reviewConfirmed: event.target.checked }
                    : null,
                )
              }
            />
            Transkript und Patientenkontext geprüft
          </label>
          {value !== voice.original && (
            <small>
              Die Korrektur bleibt als geprüfte Revision nachvollziehbar.
            </small>
          )}
        </fieldset>
      )}
      <form
        className="clinical-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <button
          type="button"
          className={recording ? "voice recording" : "voice"}
          aria-label={
            recording ? "Aufnahme stoppen" : "Sprachnachricht aufnehmen"
          }
          title={asr.ready ? undefined : asr.message}
          disabled={
            isRunning ||
            requestingMicrophone ||
            transcribing ||
            externallyBusy ||
            !asr.ready ||
            !online
          }
          onClick={() => {
            if (recording) recorder.current?.stop();
            else void startRecording();
          }}
        >
          {recording ? "■" : "●"}
        </button>
        <label>
          <span className="sr-only">Nachricht an Pflegehelfer</span>
          <textarea
            aria-label="Nachricht an Pflegehelfer"
            rows={1}
            maxLength={8000}
            value={value}
            disabled={recording || transcribing || externallyBusy}
            placeholder={
              patient
                ? `${patient.displayName.split(" ")[0]}: fragen, sprechen oder dokumentieren…`
                : "Fragen, sprechen oder Arbeit organisieren…"
            }
            onChange={(event) => {
              setValue(event.target.value);
              if (voice)
                setVoice({
                  ...voice,
                  entities: extractCriticalEntities(event.target.value, null),
                  confirmed: new Set(),
                  reviewConfirmed: false,
                });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        </label>
        {isRunning ? (
          <button
            type="button"
            aria-label="Antwort abbrechen"
            onClick={cancelMessage}
          >
            ■
          </button>
        ) : (
          <button
            type="submit"
            className="send-button"
            aria-label="Nachricht senden"
            disabled={!online || busy || value.trim().length < 2}
          >
            ↑
          </button>
        )}
      </form>
      <small className="composer-meta">
        {transcribing
          ? "Sprachtranskript wird sicher verarbeitet…"
          : asr.ready
            ? "Audio wird nach der Transkription verworfen · keine automatische Freigabe"
            : `Spracheingabe nicht freigegeben · ${asr.message}`}
      </small>
    </div>
  );
}
