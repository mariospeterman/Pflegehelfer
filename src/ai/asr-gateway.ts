import { z } from "zod";
import { DomainError } from "../core/types.js";
import { validateLocalAiEndpoint } from "./local-endpoint-policy.js";

export type AsrRuntimeMode = "disabled" | "browser-demo" | "local-openai";

export interface AsrRuntimeStatus {
  mode: AsrRuntimeMode;
  model: string;
  ready: boolean;
  dataBoundary: "none" | "synthetic-browser" | "local-network";
  message: string;
}

const transcriptionResponse = z
  .object({ text: z.string().trim().min(1).max(8000) })
  .passthrough();

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

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.mode = z
      .enum(["disabled", "browser-demo", "local-openai"])
      .catch("disabled")
      .parse(env.PFH_ASR_MODE);
    this.model = env.PFH_ASR_MODEL ?? "whisper-large-v3-turbo";
    this.baseUrl =
      this.mode === "local-openai"
        ? validateLocalAiEndpoint(env.PFH_ASR_BASE_URL, env)
        : (env.PFH_ASR_BASE_URL ?? null);
    this.apiKey = env.PFH_ASR_API_KEY ?? null;
    if (this.mode === "browser-demo" && env.PFH_DEMO_MODE !== "true")
      throw new Error("Browser ASR is restricted to the synthetic demo.");
  }

  status(): AsrRuntimeStatus {
    if (this.mode === "browser-demo")
      return {
        mode: this.mode,
        model: "browser-speech-recognition",
        ready: true,
        dataBoundary: "synthetic-browser",
        message:
          "Nur synthetische Demo: Push-to-talk wird vom Browser transkribiert.",
      };
    if (this.mode === "local-openai")
      return {
        mode: this.mode,
        model: this.model,
        ready: Boolean(this.baseUrl),
        dataBoundary: "local-network",
        message: this.baseUrl
          ? "Lokaler OpenAI-kompatibler ASR-Endpunkt konfiguriert; Audio wird nicht gespeichert."
          : "PFH_ASR_BASE_URL fehlt.",
      };
    return {
      mode: this.mode,
      model: this.model,
      ready: false,
      dataBoundary: "none",
      message: "Spracherkennung deaktiviert.",
    };
  }

  async transcribe(audio: Uint8Array, mimeType: string): Promise<string> {
    let audioCopy: Uint8Array<ArrayBuffer> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (this.mode !== "local-openai" || !this.baseUrl)
        throw new DomainError(
          "EXTERNAL_VENDOR_GATE",
          "Lokale Spracherkennung ist für diese Umgebung nicht konfiguriert.",
          503,
        );
      if (audio.byteLength === 0 || audio.byteLength > 8 * 1024 * 1024)
        throw new DomainError(
          "VALIDATION",
          "Sprachaufnahme muss zwischen 1 Byte und 8 MiB gross sein.",
          400,
        );
      const form = new FormData();
      audioCopy = new Uint8Array(new ArrayBuffer(audio.byteLength));
      audioCopy.set(audio);
      form.set(
        "file",
        new Blob([audioCopy.buffer], { type: mimeType || "audio/webm" }),
        "pflegehelfer-utterance.webm",
      );
      form.set("model", this.model);
      form.set("language", "de");
      form.set("response_format", "json");
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
        },
      );
      if (!response.ok)
        throw new DomainError(
          "PROVIDER_UNAVAILABLE",
          `Lokaler ASR-Endpunkt antwortet mit HTTP ${response.status}.`,
          503,
        );
      return transcriptionResponse.parse(await response.json()).text;
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(
        "PROVIDER_UNAVAILABLE",
        "Lokale Spracherkennung ist vorübergehend nicht erreichbar.",
        503,
      );
    } finally {
      if (timer) clearTimeout(timer);
      audio.fill(0);
      audioCopy?.fill(0);
    }
  }
}
