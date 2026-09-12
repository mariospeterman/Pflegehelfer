import { z } from "zod";
import { DomainError } from "../core/types.js";
import { validateLocalAiEndpoint } from "./local-endpoint-policy.js";

export type TtsRuntimeMode =
  "disabled" | "browser-demo" | "hosted-test" | "local-openai";

export interface TtsRuntimeStatus {
  mode: TtsRuntimeMode;
  model: string;
  voice: string;
  ready: boolean;
  configured: boolean;
  acceptance: "accepted" | "ready-for-test" | "not-configured";
  dataBoundary:
    "none" | "synthetic-browser" | "synthetic-hosted" | "local-network";
  message: string;
}

export interface SpeechResult {
  audio: Uint8Array;
  contentType: "audio/mpeg";
  model: string;
  voice: string;
  audioRetained: false;
}

export class TtsGateway {
  readonly mode: TtsRuntimeMode;
  readonly model: string;
  readonly voice: string;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private verifiedAt: number | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.mode = z
      .enum(["disabled", "browser-demo", "hosted-test", "local-openai"])
      .catch("disabled")
      .parse(env.PFH_TTS_MODE);
    this.model =
      env.PFH_TTS_MODEL ??
      (this.mode === "hosted-test" ? "gpt-4o-mini-tts" : "local-tts");
    this.voice = env.PFH_TTS_VOICE ?? "coral";
    this.baseUrl =
      this.mode === "local-openai"
        ? validateLocalAiEndpoint(env.PFH_TTS_BASE_URL, env)
        : (env.PFH_TTS_BASE_URL ??
          (this.mode === "hosted-test" ? "https://api.openai.com/v1" : null));
    this.apiKey = env.PFH_TTS_API_KEY ?? env.OPENAI_API_KEY ?? null;
    if (
      this.mode === "local-openai" &&
      env.PFH_DEMO_MODE !== "true" &&
      !/^[a-f0-9]{64}$/.test(env.PFH_TTS_MODEL_DIGEST ?? "")
    )
      throw new Error(
        "Production local TTS requires an immutable PFH_TTS_MODEL_DIGEST and governed model pack.",
      );
    if (this.mode === "browser-demo" && env.PFH_DEMO_MODE !== "true")
      throw new Error("Browser TTS is restricted to the synthetic demo.");
    if (
      this.mode === "hosted-test" &&
      (env.PFH_DEMO_MODE !== "true" ||
        env.PFH_LLM_DATA_CLASSIFICATION !== "synthetic-only" ||
        env.PFH_ALLOW_EXTERNAL_AI !== "true")
    )
      throw new Error(
        "Hosted TTS requires explicit external-AI consent and synthetic demo data.",
      );
  }

  status(): TtsRuntimeStatus {
    if (this.mode === "browser-demo")
      return {
        mode: this.mode,
        model: "browser-speech-synthesis",
        voice: "browser-default",
        ready: true,
        configured: true,
        acceptance: "ready-for-test",
        dataBoundary: "synthetic-browser",
        message:
          "Nur synthetische Demo: Browser-Vorlesen ist verfügbar; die konkrete Browser-Stimme ist nicht serverseitig abgenommen.",
      };
    if (this.mode === "local-openai" || this.mode === "hosted-test") {
      const configured = Boolean(
        this.baseUrl && (this.mode === "local-openai" || this.apiKey),
      );
      return {
        mode: this.mode,
        model: this.model,
        voice: this.voice,
        ready: this.verifiedAt !== null,
        configured,
        acceptance: this.verifiedAt
          ? "accepted"
          : configured
            ? "ready-for-test"
            : "not-configured",
        dataBoundary:
          this.mode === "local-openai" ? "local-network" : "synthetic-hosted",
        message: configured
          ? this.verifiedAt
            ? "Sprachausgabe mit echtem nicht-schreibendem Synthesetest bestätigt; Audio wird nicht gespeichert."
            : "Sprachausgabe konfiguriert; echter Synthesetest steht noch aus."
          : "TTS-Endpunkt beziehungsweise API-Schlüssel fehlt.",
      };
    }
    return {
      mode: "disabled",
      model: this.model,
      voice: this.voice,
      ready: false,
      configured: false,
      acceptance: "not-configured",
      dataBoundary: "none",
      message: "Sprachausgabe deaktiviert.",
    };
  }

  async synthesize(
    input: string,
    dataClass: "synthetic-demo" | "institution-local" = "institution-local",
  ): Promise<SpeechResult> {
    if (
      !["local-openai", "hosted-test"].includes(this.mode) ||
      !this.baseUrl ||
      (this.mode === "hosted-test" && !this.apiKey)
    )
      throw new DomainError(
        "EXTERNAL_VENDOR_GATE",
        "Sprachausgabe ist für diese Umgebung nicht als Serverdienst konfiguriert.",
        503,
      );
    if (this.mode === "hosted-test" && dataClass !== "synthetic-demo")
      throw new DomainError(
        "AUTH_DENIED",
        "Externe Sprachausgabe ist nur für eindeutig synthetische Demonstrationsdaten erlaubt.",
        403,
      );
    const text = input.trim();
    if (text.length < 1 || text.length > 2400)
      throw new DomainError(
        "VALIDATION",
        "Vorlesetext muss zwischen 1 und 2400 Zeichen lang sein.",
        400,
      );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/audio/speech`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            voice: this.voice,
            input: text,
            response_format: "mp3",
          }),
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          `TTS-Endpunkt antwortet mit HTTP ${response.status}.`,
          503,
        );
      const audio = new Uint8Array(await response.arrayBuffer());
      if (audio.byteLength === 0 || audio.byteLength > 12 * 1024 * 1024)
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          "TTS-Endpunkt lieferte keine gültige Audiodatei.",
          503,
        );
      this.verifiedAt = Date.now();
      return {
        audio,
        contentType: "audio/mpeg",
        model: this.model,
        voice: this.voice,
        audioRetained: false,
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        "Sprachausgabe ist vorübergehend nicht erreichbar.",
        503,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
