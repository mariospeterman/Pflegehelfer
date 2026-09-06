import { z } from "zod";
import type { Role } from "../core/types.js";
import { validateLocalAiEndpoint } from "./local-endpoint-policy.js";

export interface ApprovedKnowledgeDocument {
  id: string;
  title: string;
  version: string;
  owner: string;
  validFrom: string;
  validTo: string | null;
  allowedRoles: Role[];
  content: string;
}

export interface KnowledgeAnswer {
  answer: string;
  citations: Array<{
    id: string;
    title: string;
    version: string;
    owner: string;
  }>;
  mode: "deterministic-retrieval" | "local-deep-llm" | "hosted-test-deep-llm";
  degraded: boolean;
}

export interface KnowledgeRuntimeStatus {
  mode: "deterministic" | "local-openai" | "hosted-test";
  model: string;
  ready: boolean;
  documentCount: number;
  message: string;
}

const clinicalRoles: Role[] = [
  "care-assistant",
  "registered-nurse",
  "physician",
  "pharmacy",
  "physiotherapy",
  "occupational-therapy",
];

/** Synthetic but governance-realistic showcase corpus; no external licensed text. */
export const approvedKnowledgeDocuments: ApprovedKnowledgeDocument[] = [
  {
    id: "sop-medication-discrepancy",
    title: "Medikationsdiskrepanz sicher eskalieren",
    version: "1.0.0-demo",
    owner: "Fachverantwortung Pflege & Apotheke (synthetisch)",
    validFrom: "2026-09-01",
    validTo: null,
    allowedRoles: clinicalRoles,
    content:
      "Bei widersprüchlichen Medikationsangaben keine Dosis in Pflegehelfer ändern. Beide Quellstände sichtbar belassen, die Abweichung als geschlossene klinische Anfrage an ärztlichen Dienst oder Apotheke senden und bis zur Antwort den autoritativen Medikationsprozess verwenden. Akute Gefährdung wird ausserhalb von Pflegehelfer nach dem lokalen Notfallprozess eskaliert.",
  },
  {
    id: "sop-handover-minimum",
    title: "Strukturierte Schichtübergabe",
    version: "1.0.0-demo",
    owner: "Pflegeentwicklung Sonnenhof Demo (synthetisch)",
    validFrom: "2026-09-01",
    validTo: null,
    allowedRoles: clinicalRoles,
    content:
      "Die Übergabe enthält nur seit der letzten bestätigten Übergabe veränderte Risiken, offene Aufgaben, unbeantwortete klinische Nachrichten und relevante Verlaufspunkte. Die abgebende Person prüft und signiert; die übernehmende Person bestätigt die Übernahme. Offene Punkte bleiben als Aufgabe oder Nachricht nachvollziehbar.",
  },
  {
    id: "sop-fall-response",
    title: "Vorgehen nach beobachtetem oder vermutetem Sturz",
    version: "1.0.0-demo",
    owner: "Clinical Safety Board Sonnenhof Demo (synthetisch)",
    validFrom: "2026-09-01",
    validTo: null,
    allowedRoles: clinicalRoles,
    content:
      "Bei einem Sturz zuerst die unmittelbare Sicherheit gewährleisten und nach lokaler Kompetenzregel klinisch beurteilen lassen. Beobachtungen und Vitalwerte strukturiert erfassen, zuständige Pflegefachperson beziehungsweise ärztlichen Dienst über den geschlossenen Kommunikationsweg informieren und Folgeaufgaben mit Frist anlegen. Pflegehelfer stellt keine Diagnose und ersetzt weder Notruf noch lokale Eskalationswege.",
  },
];

const citationSelectionSchema = z
  .object({
    citations: z.array(z.string()).min(1).max(3),
  })
  .strict();

const stopwords = new Set([
  "aber",
  "auch",
  "bei",
  "bitte",
  "das",
  "der",
  "die",
  "ein",
  "eine",
  "für",
  "ist",
  "mit",
  "nach",
  "oder",
  "und",
  "was",
  "wie",
  "wir",
]);

function tokens(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase("de-CH")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 2 && !stopwords.has(token)),
  );
}

function score(
  query: Set<string>,
  document: ApprovedKnowledgeDocument,
): number {
  const haystack = tokens(`${document.title} ${document.content}`);
  let value = 0;
  for (const token of query) if (haystack.has(token)) value += 1;
  return value;
}

export class ApprovedKnowledgeService {
  readonly mode: "deterministic" | "local-openai" | "hosted-test";
  readonly model: string;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(
    private readonly documents = approvedKnowledgeDocuments,
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.mode = z
      .enum(["deterministic", "local-openai", "hosted-test"])
      .catch("deterministic")
      .parse(env.PFH_DEEP_LLM_MODE);
    this.model =
      env.PFH_DEEP_LLM_MODEL ??
      env.PFH_LLM_MODEL ??
      "deterministic-approved-knowledge-v1";
    const configuredBaseUrl = env.PFH_DEEP_LLM_BASE_URL ?? env.PFH_LLM_BASE_URL;
    this.baseUrl =
      this.mode === "local-openai"
        ? validateLocalAiEndpoint(configuredBaseUrl, env)
        : (configuredBaseUrl ?? null);
    this.apiKey = env.PFH_DEEP_LLM_API_KEY ?? env.PFH_LLM_API_KEY ?? null;
    this.timeoutMs = Math.min(
      60_000,
      Math.max(2_000, Number(env.PFH_DEEP_LLM_TIMEOUT_MS ?? 15_000)),
    );
    if (
      this.mode === "hosted-test" &&
      (env.PFH_DEMO_MODE !== "true" ||
        env.PFH_LLM_DATA_CLASSIFICATION !== "synthetic-only")
    )
      throw new Error(
        "Hosted deep-model mode is restricted to the synthetic demo.",
      );
  }

  status(): KnowledgeRuntimeStatus {
    return {
      mode: this.mode,
      model: this.model,
      ready: this.mode === "deterministic" || Boolean(this.baseUrl),
      documentCount: this.documents.length,
      message:
        this.mode === "deterministic"
          ? "Versionierte lokale Wissenssuche aktiv."
          : this.baseUrl
            ? "Getrennter Deep-LLM-Pfad mit lokaler, freigegebener Wissensbasis konfiguriert."
            : "Deep-LLM-Basis-URL fehlt; extraktiver Fallback bleibt aktiv.",
    };
  }

  async answer(
    prompt: string,
    role: Role,
    at = new Date(),
  ): Promise<KnowledgeAnswer> {
    const date = at.toISOString().slice(0, 10);
    const query = tokens(prompt);
    const matches = this.documents
      .filter(
        (document) =>
          document.allowedRoles.includes(role) &&
          document.validFrom <= date &&
          (!document.validTo || document.validTo >= date),
      )
      .map((document) => ({ document, score: score(query, document) }))
      .filter((item) => item.score > 0)
      .toSorted((left, right) => right.score - left.score)
      .slice(0, 3)
      .map((item) => item.document);
    if (!matches.length)
      return {
        answer:
          "In der für diese Rolle freigegebenen, aktuell gültigen Wissensbasis wurde keine passende Richtlinie gefunden. Bitte den festen lokalen Prozess oder die zuständige Fachverantwortung verwenden.",
        citations: [],
        mode: "deterministic-retrieval",
        degraded: false,
      };

    const fallback = (): KnowledgeAnswer => ({
      answer: matches.map((document) => document.content).join(" "),
      citations: matches.map(({ id, title, version, owner }) => ({
        id,
        title,
        version,
        owner,
      })),
      mode: "deterministic-retrieval",
      degraded: this.mode !== "deterministic",
    });
    if (this.mode === "deterministic" || !this.baseUrl) return fallback();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: 80,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'Select supporting document IDs for the question. Reply with exactly one JSON object in the exact shape {"citations":["document-id"]}. The object must contain only citations. Use only supplied IDs. No answer, explanation, or other keys. Never diagnose, prescribe, approve, or add facts.',
              },
              {
                role: "user",
                content: JSON.stringify({
                  question: prompt.slice(0, 1200),
                  documents: matches.map(({ id, title, version, content }) => ({
                    id,
                    title,
                    version,
                    content,
                  })),
                }),
              },
            ],
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`deep-model-http-${response.status}`);
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = body.choices?.[0]?.message?.content ?? "";
      const start = content.indexOf("{");
      const end = content.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("deep-model-schema");
      const parsed = citationSelectionSchema.parse(
        JSON.parse(content.slice(start, end + 1)),
      );
      const known = new Map(matches.map((document) => [document.id, document]));
      if (parsed.citations.some((id) => !known.has(id)))
        throw new Error("deep-model-unsupported-citation");
      const citedDocuments = parsed.citations.map((id) => known.get(id)!);
      return {
        // The model may select approved passages, but it is never trusted to
        // rewrite clinical guidance. Displayed claims remain verbatim approved
        // local content and therefore mechanically grounded.
        answer: citedDocuments.map((document) => document.content).join(" "),
        citations: citedDocuments.map((document) => {
          return {
            id: document.id,
            title: document.title,
            version: document.version,
            owner: document.owner,
          };
        }),
        mode:
          this.mode === "local-openai"
            ? "local-deep-llm"
            : "hosted-test-deep-llm",
        degraded: false,
      };
    } catch {
      return fallback();
    } finally {
      clearTimeout(timer);
    }
  }
}
