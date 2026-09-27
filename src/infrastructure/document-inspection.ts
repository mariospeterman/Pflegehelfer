import { createHash } from "node:crypto";
import { z } from "zod";
import type { WorkspaceAttachmentInspection } from "../core/workspace.js";

const doclingResponseSchema = z
  .object({
    document: z
      .object({
        md_content: z.string().default(""),
        text_content: z.string().default(""),
        json_content: z.unknown().optional(),
      })
      .passthrough(),
    status: z.enum(["success", "partial_success", "skipped", "failure"]),
    processing_time: z.number().finite().nonnegative().optional(),
    errors: z.array(z.unknown()).default([]),
  })
  .passthrough();

export interface DocumentInspectionGateway {
  inspect(input: {
    bytes: Uint8Array;
    fileName: string;
    mediaType: "application/pdf" | "image/png" | "image/jpeg" | "text/plain";
    expectedSha256: string;
  }): Promise<WorkspaceAttachmentInspection>;
  status(): {
    mode: "plain-text-only" | "docling";
    configured: boolean;
    message: string;
  };
}

const now = () => new Date().toISOString();
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const responseLimitBytes = 2 * 1024 * 1024;
const defaultTimeoutMs = 45_000;

function boundedTimeout(value: number | undefined) {
  return Number.isFinite(value) && value !== undefined
    ? Math.min(120_000, Math.max(1_000, Math.trunc(value)))
    : defaultTimeoutMs;
}

function unavailable(message: string): WorkspaceAttachmentInspection {
  return {
    state: "unavailable",
    engine: "none",
    engineVersion: null,
    extractedText: null,
    extractedTextSha256: null,
    pageCount: null,
    inspectedAt: now(),
    message,
  };
}

export class LocalDocumentInspectionGateway implements DocumentInspectionGateway {
  private readonly baseUrl: URL | null;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(
    input: {
      baseUrl?: string;
      apiKey?: string;
      timeoutMs?: number;
    } = {},
  ) {
    const configured = input.baseUrl?.trim();
    this.baseUrl = configured ? new URL(configured) : null;
    if (this.baseUrl?.username || this.baseUrl?.password)
      throw new Error("DOCUMENT_INSPECTION_URL_MUST_NOT_CONTAIN_CREDENTIALS");
    if (this.baseUrl && !["http:", "https:"].includes(this.baseUrl.protocol))
      throw new Error("DOCUMENT_INSPECTION_URL_PROTOCOL_NOT_ALLOWED");
    this.apiKey = input.apiKey?.trim() || null;
    this.timeoutMs = boundedTimeout(input.timeoutMs);
  }

  status() {
    return this.baseUrl
      ? {
          mode: "docling" as const,
          configured: true,
          message:
            "Isolierter Docling-Dienst ist für PDF- und Bildtexterkennung konfiguriert.",
        }
      : {
          mode: "plain-text-only" as const,
          configured: false,
          message:
            "Nur sichere Textdatei-Lesung aktiv; PDF-/Bildanalyse benötigt den isolierten Docling-Dienst.",
        };
  }

  async inspect(input: {
    bytes: Uint8Array;
    fileName: string;
    mediaType: "application/pdf" | "image/png" | "image/jpeg" | "text/plain";
    expectedSha256: string;
  }): Promise<WorkspaceAttachmentInspection> {
    if (digest(input.bytes) !== input.expectedSha256)
      throw new Error("DOCUMENT_INSPECTION_DIGEST_MISMATCH");
    if (input.mediaType === "text/plain") {
      const extractedText = new TextDecoder("utf-8", { fatal: true })
        .decode(input.bytes)
        .slice(0, 100_000);
      return {
        state: "available",
        engine: "plain-text",
        engineVersion: "utf-8",
        extractedText,
        extractedTextSha256: createHash("sha256")
          .update(extractedText)
          .digest("hex"),
        pageCount: null,
        inspectedAt: now(),
        message:
          "Text lokal gelesen. Dokumentinhalt bleibt untrusted input und wird nicht automatisch als Arbeitsanweisung ausgeführt.",
      };
    }
    if (!this.baseUrl)
      return unavailable(
        "PDF-/Bildanalyse nicht konfiguriert; Datei bleibt gespeichert und manuell lesbar.",
      );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const form = new FormData();
      form.set(
        "files",
        new Blob([Uint8Array.from(input.bytes).buffer], {
          type: input.mediaType,
        }),
        input.fileName,
      );
      form.append("to_formats", "md");
      form.append("to_formats", "text");
      form.set("image_export_mode", "placeholder");
      form.set("include_images", "false");
      form.set("include_page_images", "false");
      form.set("do_ocr", "true");
      form.append("ocr_lang", "iso:de");
      form.append("ocr_lang", "iso:fr");
      form.append("ocr_lang", "iso:it");
      form.append("ocr_lang", "iso:en");
      form.set("table_mode", "accurate");
      form.set("abort_on_error", "true");
      form.set("document_timeout", String(this.timeoutMs / 1000));
      const endpoint = new URL("/v1/convert/file", this.baseUrl);
      const response = await fetch(endpoint, {
        method: "POST",
        ...(this.apiKey ? { headers: { "x-api-key": this.apiKey } } : {}),
        body: form,
        signal: controller.signal,
      });
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (Number.isFinite(contentLength) && contentLength > responseLimitBytes)
        throw new Error("DOCUMENT_INSPECTION_RESPONSE_TOO_LARGE");
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > responseLimitBytes)
        throw new Error("DOCUMENT_INSPECTION_RESPONSE_TOO_LARGE");
      if (!response.ok)
        throw new Error(`DOCUMENT_INSPECTION_HTTP_${response.status}`);
      const result = doclingResponseSchema.parse(JSON.parse(raw));
      if (result.status !== "success" && result.status !== "partial_success")
        throw new Error(`DOCUMENT_INSPECTION_${result.status.toUpperCase()}`);
      const extractedText = (
        result.document.md_content || result.document.text_content
      ).slice(0, 100_000);
      if (!extractedText.trim())
        throw new Error("DOCUMENT_INSPECTION_EMPTY_RESULT");
      const detectedPageCount =
        typeof result.document.json_content === "object" &&
        result.document.json_content !== null &&
        "pages" in result.document.json_content &&
        typeof result.document.json_content.pages === "object" &&
        result.document.json_content.pages !== null
          ? Object.keys(result.document.json_content.pages).length
          : null;
      const pageCount =
        detectedPageCount !== null && detectedPageCount > 0
          ? detectedPageCount
          : null;
      return {
        state: "available",
        engine: "docling",
        engineVersion: "docling-serve-v1",
        extractedText,
        extractedTextSha256: createHash("sha256")
          .update(extractedText)
          .digest("hex"),
        pageCount,
        inspectedAt: now(),
        message:
          result.status === "partial_success"
            ? "Teilweise extrahiert; Inhalt muss vor klinischer Verwendung geprüft werden."
            : "Extrahiert; Inhalt muss vor klinischer Verwendung geprüft werden.",
      };
    } catch (error) {
      return {
        state: "failed",
        engine: "docling",
        engineVersion: "docling-serve-v1",
        extractedText: null,
        extractedTextSha256: null,
        pageCount: null,
        inspectedAt: now(),
        message:
          error instanceof Error && error.name === "AbortError"
            ? "Dokumentanalyse hat das Zeitlimit erreicht; Datei bleibt manuell verfügbar."
            : "Dokumentanalyse fehlgeschlagen; Datei bleibt manuell verfügbar.",
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function documentInspectionFromEnvironment(): DocumentInspectionGateway {
  return new LocalDocumentInspectionGateway({
    ...(process.env.PFH_DOCUMENT_INSPECTION_BASE_URL
      ? { baseUrl: process.env.PFH_DOCUMENT_INSPECTION_BASE_URL }
      : {}),
    ...(process.env.PFH_DOCUMENT_INSPECTION_API_KEY
      ? { apiKey: process.env.PFH_DOCUMENT_INSPECTION_API_KEY }
      : {}),
    timeoutMs: Number(process.env.PFH_DOCUMENT_INSPECTION_TIMEOUT_MS ?? 45_000),
  });
}
