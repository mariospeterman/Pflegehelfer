import { z } from "zod";
import { DomainError } from "../core/types.js";
import { validateLocalAiEndpoint } from "./local-endpoint-policy.js";
import {
  extractCriticalEntities,
  type CriticalEntity,
} from "../core/critical-entities.js";

export type AsrRuntimeMode =
  "disabled" | "browser-demo" | "hosted-test" | "local-openai";

export interface AsrRuntimeStatus {
  mode: AsrRuntimeMode;
  model: string;
  ready: boolean;
  configured: boolean;
  acceptance: "accepted" | "ready-for-test" | "not-configured";
  dataBoundary:
    "none" | "synthetic-browser" | "synthetic-hosted" | "local-network";
  message: string;
}

const transcriptionResponse = z
  .object({
    text: z.string().trim().min(1).max(8000),
    language: z.string().max(20).optional(),
    segments: z
      .array(z.object({ avg_logprob: z.number().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export interface TranscriptionResult {
  text: string;
  language: string;
  model: string;
  confidence: number | null;
  confidenceState: "reported" | "unknown";
  criticalEntities: CriticalEntity[];
  qualityFlags: string[];
  audioRetained: false;
}

/**
 * Isolated speech-to-text gateway. Audio is streamed to the configured local
 * endpoint and never persisted by Pflegehelfer. Browser demo speech is kept
 * separate because browser implementations may use platform cloud services.
 */
export class AsrGateway {
  readonly mode: AsrRuntimeMode;
  readonly model: string;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private verifiedAt: number | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.mode = z
      .enum(["disabled", "browser-demo", "hosted-test", "local-openai"])
      .catch("disabled")
      .parse(env.PFH_ASR_MODE);
    this.model =
      env.PFH_ASR_MODEL ??
      (this.mode === "hosted-test"
        ? "gpt-4o-transcribe"
        : "whisper-large-v3-turbo");
    this.baseUrl =
      this.mode === "local-openai"
        ? validateLocalAiEndpoint(env.PFH_ASR_BASE_URL, env)
        : (env.PFH_ASR_BASE_URL ??
          (this.mode === "hosted-test" ? "https://api.openai.com/v1" : null));
    this.apiKey = env.PFH_ASR_API_KEY ?? env.OPENAI_API_KEY ?? null;
    if (
      this.mode === "local-openai" &&
      env.PFH_DEMO_MODE !== "true" &&
      !/^[a-f0-9]{64}$/.test(env.PFH_ASR_MODEL_DIGEST ?? "")
    )
      throw new Error(
        "Production local ASR requires an immutable PFH_ASR_MODEL_DIGEST and governed model pack.",
      );
    if (this.mode === "browser-demo" && env.PFH_DEMO_MODE !== "true")
      throw new Error("Browser ASR is restricted to the synthetic demo.");
    if (
      this.mode === "hosted-test" &&
      (env.PFH_DEMO_MODE !== "true" ||
        env.PFH_LLM_DATA_CLASSIFICATION !== "synthetic-only" ||
        env.PFH_ALLOW_EXTERNAL_AI !== "true")
    )
      throw new Error(
        "Hosted ASR requires explicit external-AI consent and synthetic demo data.",
      );
  }

  status(): AsrRuntimeStatus {
    if (this.mode === "browser-demo")
      return {
        mode: this.mode,
        model: "browser-speech-recognition",
        ready: true,
        configured: true,
        acceptance: "accepted",
        dataBoundary: "synthetic-browser",
        message:
          "Nur synthetische Demo: Push-to-talk wird vom Browser transkribiert.",
      };
    if (this.mode === "local-openai")
      return {
        mode: this.mode,
        model: this.model,
        ready: this.verifiedAt !== null,
        configured: Boolean(this.baseUrl),
        acceptance: this.verifiedAt
          ? "accepted"
          : this.baseUrl
            ? "ready-for-test"
            : "not-configured",
        dataBoundary: "local-network",
        message: this.baseUrl
          ? this.verifiedAt
            ? "Lokaler ASR-Endpunkt mit echtem nicht-schreibendem Audiotest bestätigt; Audio wird nicht gespeichert."
            : "Lokaler ASR-Endpunkt konfiguriert; echter Audiotest steht noch aus."
          : "PFH_ASR_BASE_URL fehlt.",
      };
    if (this.mode === "hosted-test")
      return {
        mode: this.mode,
        model: this.model,
        ready: this.verifiedAt !== null,
        configured: Boolean(this.baseUrl && this.apiKey),
        acceptance:
          this.baseUrl && this.apiKey ? "ready-for-test" : "not-configured",
        dataBoundary: "synthetic-hosted",
        message: this.apiKey
          ? this.verifiedAt
            ? "Synthetische externe Transkription mit echtem Audiotest bestätigt; Audio wird nach der Antwort verworfen."
            : "Synthetische externe Transkription konfiguriert; echter Audiotest steht noch aus."
          : "OPENAI_API_KEY beziehungsweise PFH_ASR_API_KEY fehlt.",
      };
    return {
      mode: this.mode,
      model: this.model,
      ready: false,
      configured: false,
      acceptance: "not-configured",
      dataBoundary: "none",
      message: "Spracherkennung deaktiviert.",
    };
  }

  async transcribe(
    audio: Uint8Array,
    mimeType: string,
    dataClass: "synthetic-demo" | "institution-local" = "institution-local",
  ): Promise<TranscriptionResult> {
    let audioCopy: Uint8Array<ArrayBuffer> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (
        !["local-openai", "hosted-test"].includes(this.mode) ||
        !this.baseUrl ||
        (this.mode === "hosted-test" && !this.apiKey)
      )
        throw new DomainError(
          "EXTERNAL_VENDOR_GATE",
          "Spracherkennung ist für diese Umgebung nicht konfiguriert.",
          503,
        );
      if (this.mode === "hosted-test" && dataClass !== "synthetic-demo")
        throw new DomainError(
          "AUTH_DENIED",
          "Externe Spracherkennung ist nur für eindeutig synthetische Demonstrationsdaten erlaubt.",
          403,
        );
      if (audio.byteLength === 0 || audio.byteLength > 8 * 1024 * 1024)
        throw new DomainError(
          "VALIDATION",
          "Sprachaufnahme muss zwischen 1 Byte und 8 MiB gross sein.",
          400,
        );
      const acceptedMimeTypes = new Set([
        "audio/webm",
        "audio/wav",
        "audio/mpeg",
        "audio/mp4",
        "audio/x-m4a",
      ]);
      const normalizedMime = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
      if (!acceptedMimeTypes.has(normalizedMime))
        throw new DomainError(
          "VALIDATION",
          "Nicht unterstütztes Audioformat.",
          400,
        );
      const form = new FormData();
      audioCopy = new Uint8Array(new ArrayBuffer(audio.byteLength));
      audioCopy.set(audio);
      form.set(
        "file",
        new Blob([audioCopy.buffer], { type: normalizedMime }),
        "pflegehelfer-utterance.webm",
      );
      form.set("model", this.model);
      form.set("language", "de");
      if (this.mode === "local-openai")
        form.set("response_format", "verbose_json");
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), 60_000);
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
        {
          method: "POST",
          ...(this.apiKey
            ? { headers: { authorization: `Bearer ${this.apiKey}` } }
            : {}),
          body: form,
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          `ASR-Endpunkt antwortet mit HTTP ${response.status}.`,
          503,
        );
      const parsed = transcriptionResponse.parse(await response.json());
      this.verifiedAt = Date.now();
      const reported = parsed.segments
        ?.map((segment) => segment.avg_logprob)
        .filter((value): value is number => typeof value === "number");
      const confidence =
        reported && reported.length > 0
          ? Math.max(
              0,
              Math.min(
                1,
                reported.reduce((sum, value) => sum + Math.exp(value), 0) /
                  reported.length,
              ),
            )
          : null;
      return {
        text: parsed.text,
        language: parsed.language ?? "de-CH",
        model: this.model,
        confidence,
        confidenceState: confidence === null ? "unknown" : "reported",
        criticalEntities: extractCriticalEntities(parsed.text, confidence),
        qualityFlags: confidence === null ? ["confidence-not-reported"] : [],
        audioRetained: false,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        "Spracherkennung ist vorübergehend nicht erreichbar.",
        503,
      );
    } finally {
      if (timer) clearTimeout(timer);
      audio.fill(0);
      audioCopy?.fill(0);
    }
  }
}
