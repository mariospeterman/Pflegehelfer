import { z } from "zod";
import { validateLocalAiEndpoint } from "./local-endpoint-policy.js";
import {
  assistantProposalSchema,
  deterministicAssistantProposal,
  explicitlyRefusesDocumentation,
  requiresDedicatedClinicalWorkflow,
  verifyModelProposalAgainstDeterministicCompiler,
  type AssistantProposal,
} from "./assistant-proposal.js";

export const assistantIntentSchema = z
  .object({
    intent: z.enum([
      "patient-summary",
      "open-tasks",
      "latest-vitals",
      "handover",
      "team-inbox",
      "sync-status",
      "draft-note",
      "draft-physician-question",
      "draft-task",
      "care-update",
      "knowledge-query",
      "medication-request",
      "unknown",
    ]),
  })
  .strict();

export type AssistantIntent = z.infer<typeof assistantIntentSchema>["intent"];
export type AiRuntimeMode =
  "disabled" | "deterministic" | "hosted-test" | "local-openai";

export interface IntentClassification {
  intent: AssistantIntent;
  mode: AiRuntimeMode;
  model: string;
  degraded: boolean;
  failure?: ClinicalPlanResult["failure"];
}

export interface ModelRuntimeStatus {
  mode: AiRuntimeMode;
  model: string;
  ready: boolean;
  configured: boolean;
  acceptance: "accepted" | "ready-for-test" | "not-configured";
  dataBoundary: "none" | "deterministic" | "synthetic-hosted" | "local-network";
  message: string;
}

export interface ClinicalPlanResult {
  plan: AssistantProposal | null;
  mode: AiRuntimeMode;
  model: string;
  degraded: boolean;
  failure?: {
    code:
      | "not-configured"
      | "timeout"
      | "rate-limited"
      | "refusal"
      | "incomplete"
      | "http-error"
      | "invalid-output";
    message: string;
  };
}

export interface ModelSyntheticTestResult {
  ready: boolean;
  mode: AiRuntimeMode;
  model: string;
  latencyMs: number;
  dataBoundary: ModelRuntimeStatus["dataBoundary"];
  message: string;
}

export interface AuthorizedModelContext {
  organizationLabel: string;
  actorRole: string;
  workflowStep: string;
  activeEpisodeTitle: string | null;
  recentPrompts: string[];
  recentConversation?: Array<{
    role: "user" | "assistant";
    text: string;
  }>;
  dataClass: "synthetic-demo" | "institution-local";
}

function boundedContext(context?: AuthorizedModelContext): string | null {
  if (!context) return null;
  return JSON.stringify({
    organization: context.organizationLabel.slice(0, 120),
    role: context.actorRole.slice(0, 80),
    workflowStep: context.workflowStep.slice(0, 80),
    activeEpisode: context.activeEpisodeTitle?.slice(0, 160) ?? null,
    recentConversation: context.recentPrompts
      ? (
          context.recentConversation ??
          context.recentPrompts.map((text) => ({ role: "user", text }))
        )
          .slice(-8)
          .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 400) }))
      : [],
    dataClass: context.dataClass,
  });
}

class ModelResponseError extends Error {
  constructor(
    readonly code: NonNullable<ClinicalPlanResult["failure"]>["code"],
    message: string,
  ) {
    super(message);
  }
}

function responseText(body: unknown): string {
  if (!body || typeof body !== "object")
    throw new ModelResponseError("invalid-output", "model-empty");
  const value = body as {
    status?: unknown;
    incomplete_details?: { reason?: unknown };
    output_text?: unknown;
    output?: Array<{
      content?: Array<{ type?: unknown; text?: unknown; refusal?: unknown }>;
    }>;
    choices?: Array<{
      finish_reason?: unknown;
      message?: { content?: unknown; refusal?: unknown };
    }>;
  };
  if (value.status === "incomplete")
    throw new ModelResponseError(
      "incomplete",
      typeof value.incomplete_details?.reason === "string"
        ? value.incomplete_details.reason
        : "model-response-incomplete",
    );
  const choice = value.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new ModelResponseError("incomplete", "model-output-limit");
  if (typeof choice?.message?.refusal === "string")
    throw new ModelResponseError("refusal", choice.message.refusal);
  if (typeof value.output_text === "string") return value.output_text;
  for (const item of value.output ?? [])
    for (const content of item.content ?? []) {
      if (typeof content.refusal === "string")
        throw new ModelResponseError("refusal", content.refusal);
      if (typeof content.text === "string") return content.text;
    }
  const chatContent = value.choices?.[0]?.message?.content;
  if (typeof chatContent === "string") return chatContent;
  throw new ModelResponseError("invalid-output", "model-empty");
}

type JsonSchema = Record<string, unknown>;

function permitsNull(schema: JsonSchema): boolean {
  if (schema.type === "null") return true;
  if (Array.isArray(schema.type) && schema.type.includes("null")) return true;
  return ["anyOf", "oneOf"].some(
    (key) =>
      Array.isArray(schema[key]) &&
      (schema[key] as unknown[]).some(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          permitsNull(item as JsonSchema),
      ),
  );
}

function nullableSchema(schema: JsonSchema): JsonSchema {
  return permitsNull(schema) ? schema : { anyOf: [schema, { type: "null" }] };
}

/**
 * OpenAI strict Structured Outputs requires every object property to be in
 * `required` and every object to deny additional properties. Domain schemas
 * still keep genuine optionality; the transport represents an omitted value
 * as null and normalizes it before domain validation.
 */
export function toStrictStructuredOutputSchema(schema: JsonSchema): JsonSchema {
  const visit = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== "object") return node;
    const current = node as JsonSchema;
    const mapped: JsonSchema = Object.fromEntries(
      Object.entries(current).map(([key, value]) => [key, visit(value)]),
    );
    if (current.type !== "object" || !current.properties) return mapped;
    const properties = current.properties as Record<string, JsonSchema>;
    const originallyRequired = new Set(
      Array.isArray(current.required)
        ? current.required.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    );
    mapped.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => {
        const visited = visit(value) as JsonSchema;
        return [
          key,
          originallyRequired.has(key) ? visited : nullableSchema(visited),
        ];
      }),
    );
    mapped.required = Object.keys(properties);
    mapped.additionalProperties = false;
    delete mapped.default;
    return mapped;
  };
  return visit(schema) as JsonSchema;
}

function normalizeProposalTransport(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const proposal = structuredClone(input) as {
    understoodFacts?: Array<Record<string, unknown>>;
  };
  for (const fact of proposal.understoodFacts ?? []) {
    if (fact.value === null) delete fact.value;
    if (fact.unit === null) delete fact.unit;
  }
  return proposal;
}

function deterministicIntent(prompt: string): AssistantIntent {
  const text = prompt.toLocaleLowerCase("de-CH");
  const completedClinicalReport =
    !requiresDedicatedClinicalWorkflow(text) &&
    /\b(?:wurde|war|ist|hat|habe)\b[^.;]{0,80}\b(?:gegeben|verabreicht|abgesetzt|durchgeführt|behandelt)\b/.test(
      text,
    );
  // Explicit refusals always pass through the grounded care compiler. They
  // must never be turned into a draft merely because a route keyword occurs.
  if (explicitlyRefusesDocumentation(text)) return "care-update";
  // An explicitly addressed message remains communication even when its body
  // contains bedside-work vocabulary. Recipient resolution and permissions
  // are checked later; this only preserves the user's stated conversational
  // intent instead of swallowing it as a generic care update.
  if (
    /\b(?:frag|frage|nachricht|informier|sag|schreib|send)\p{L}*\s+@\p{L}[\p{L}-]*/iu.test(
      text,
    )
  )
    return "draft-physician-question";
  // Governance questions may mention a medicine, treatment or diagnosis.
  // They remain read-only knowledge queries; imperative clinical language is
  // routed into the dedicated fail-closed workflow before any note prefix can
  // accidentally turn it into writable documentation.
  if (/richtlinie|standard|sop|policy|vorgehen|was gilt|prozess/.test(text))
    return "knowledge-query";
  if (
    requiresDedicatedClinicalWorkflow(text) ||
    (!completedClinicalReport &&
      (/\b(?:torasemid|insulin|antibiotik|medikament|medikation|dosis|dosierung|therapie|behandlung|diagnos|verordn|verschreib)\b/.test(
        text,
      ) ||
        /\b\d+(?:[,.]\d+)?\s*(?:mg|ie|i\.e\.)\b/.test(text))) ||
    (!completedClinicalReport &&
      /^\s*(?:bitte\s+)?(?:notiz|dokumentiere|schreib(?:e)?(?:\s+auf)?|anamnes(?:e|is)|pflegebericht)\b/.test(
        text,
      ) &&
      /\b(?:geben|verabreichen|absetzen|entfernen|wechseln|legen|applizieren|anordnen|verordnen|verschreiben|behandeln|therapieren)\b/.test(
        text,
      )) ||
    (!completedClinicalReport &&
      /\b(?:geben|verabreichen|absetzen|anordnen|verordnen|verschreiben|behandeln|wundbehandlung\s+(?:jetzt\s+)?durchführen)\b/.test(
        text,
      ) &&
      /\b(?:tropfen|injektion|infusion|sauerstoff|wunde?|wundbehandlung|\d+(?:[,.]\d+)?\s*(?:ml|l\/min))\b/.test(
        text,
      ))
  )
    return "medication-request";
  if (
    /^\s*(?:bitte\s+)?(?:notiz|dokumentiere|schreib(?:e)?(?:\s+auf)?|anamnes(?:e|is))\b/.test(
      text,
    )
  )
    return "draft-note";
  // Multi-object bedside updates must be recognized before their individual
  // vital/note/message fragments. The model never decides the resulting
  // writes; the typed assistant service extracts and validates the bundle.
  if (
    /\b(?:mobilisiert|mobilisation|morgenpflege|gegessen|getrunken|durchgeführt|erledigt|pausieren|zimmer\s+\d{1,4})\b/.test(
      text,
    ) ||
    /\b\d{1,4}\s*ml\b/.test(text) ||
    /\b(?:arzt|ärztin|ärztlichen?\s+dienst)\b[^.;]{0,60}\b(?:nicht|kein(?:e|en)?)\b/.test(
      text,
    ) ||
    /\b(?:arzt|ärztin)\b[^.;!?]{0,60}\b(?:keineswegs|keinesfalls|mitnichten)\b|\b(?:arzt|ärztin)[^.;!?]{0,35}\b(?:informieren|benachrichtigen|fragen)\b\s*\?\s*nein\b/.test(
      text,
    ) ||
    /\b(?:keine?|nicht)\b[^.;]{0,30}\b(?:folgekontrolle|kontrolle|nachmessen)\b/.test(
      text,
    )
  )
    return "care-update";
  if (
    /(blutdruck|\brr\b)/.test(text) &&
    /(dokument|mobilis|fertig|gemacht)/.test(text) &&
    /(arzt|ärzt|informier|kontrolle|nochmal|wiederhol)/.test(text)
  )
    return "care-update";
  const measurementKinds = [
    /(?:temperatur|temp)\s*(?:war|ist|betrug|:)?\s*\d{2}[,.]\d/,
    /puls\s*(?:war|ist|betrug|:)?\s*\d{2,3}/,
    /(?:sättigung|saettigung|spo2)\s*(?:war|ist|betrug|:)?\s*\d{2,3}/,
    /(?:blutdruck|\brr\b)\s*(?:war|ist|betrug|:)?\s*\d{2,3}/,
  ].filter((pattern) => pattern.test(text)).length;
  if (measurementKinds >= 2 && !/\?|wie|was|zeige|letzte/.test(text))
    return "care-update";
  if (/übergabe|uebergabe|handover|schichtwechsel/.test(text))
    return "handover";
  if (/synchron|provider|abgleich|schnittstelle/.test(text))
    return "sync-status";
  if (/teamfrage|teamfragen|@|erwähnung|mention/.test(text))
    return "team-inbox";
  if (
    /\b(?:blutdruck|rr|temperatur|temp\.?|sättigung|saettigung|spo2|puls|gewicht)\b[^.;!?]{0,30}\d/i.test(
      text,
    ) &&
    !/\b(?:zeige|zeig|was|wie|welche|letzte|aktuelle|nachschauen|lookup)\b|\?/.test(
      text,
    )
  )
    return "care-update";
  if (/blutdruck|vital|temperatur|sättigung|saettigung|puls|gewicht/.test(text))
    return "latest-vitals";
  if (/offen|aufgabe|task|zu tun|todo/.test(text)) return "open-tasks";
  if (/notiz|dokumentier|anamnes|pflegebericht|schreib.*auf/.test(text))
    return "draft-note";
  if (/arzt|ärzt|frage|nachricht|informier/.test(text))
    return "draft-physician-question";
  if (
    /profil|patient|wer ist|übersicht|uebersicht|pflegeprotokoll|tagesprotokoll|verlauf/.test(
      text,
    )
  )
    return "patient-summary";
  return "unknown";
}

export class ModelGateway {
  readonly mode: AiRuntimeMode;
  readonly model: string;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly timeoutMs: number;
  private verifiedAt: number | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.mode = z
      .enum(["disabled", "deterministic", "hosted-test", "local-openai"])
      .catch("disabled")
      .parse(env.PFH_AI_MODE);
    this.model =
      env.PFH_LLM_MODEL ??
      (this.mode === "hosted-test"
        ? "gpt-5.6-terra"
        : "deterministic-clinical-router-v1");
    this.baseUrl =
      this.mode === "local-openai"
        ? validateLocalAiEndpoint(env.PFH_LLM_BASE_URL, env)
        : (env.PFH_LLM_BASE_URL ??
          (this.mode === "hosted-test" ? "https://api.openai.com/v1" : null));
    this.apiKey = env.PFH_LLM_API_KEY ?? env.OPENAI_API_KEY ?? null;
    this.timeoutMs = Math.min(
      30_000,
      Math.max(2_000, Number(env.PFH_LLM_TIMEOUT_MS ?? 10_000)),
    );
    if (
      this.mode === "local-openai" &&
      env.PFH_DEMO_MODE !== "true" &&
      !/^[a-f0-9]{64}$/.test(env.PFH_LLM_MODEL_DIGEST ?? "")
    )
      throw new Error(
        "Production local AI requires an immutable PFH_LLM_MODEL_DIGEST and governed model pack.",
      );
    if (
      this.mode === "hosted-test" &&
      (env.PFH_LLM_DATA_CLASSIFICATION !== "synthetic-only" ||
        env.PFH_DEMO_MODE !== "true" ||
        env.PFH_ALLOW_EXTERNAL_AI !== "true")
    )
      throw new Error(
        "Hosted model mode requires explicit external-AI consent and synthetic demo data.",
      );
  }

  private get canCallConfiguredModel(): boolean {
    return Boolean(
      this.baseUrl && (this.mode !== "hosted-test" || this.apiKey),
    );
  }

  private requestContract(
    systemPrompts: string[],
    userPrompt: string,
    name: string,
    schema: Record<string, unknown>,
    maxOutputTokens: number,
  ): { path: string; body: Record<string, unknown> } {
    if (this.mode === "hosted-test")
      return {
        path: "/responses",
        body: {
          model: this.model,
          store: false,
          max_output_tokens: maxOutputTokens,
          input: [
            ...systemPrompts.map((prompt) => ({
              role: "system",
              content: [{ type: "input_text", text: prompt }],
            })),
            {
              role: "user",
              content: [{ type: "input_text", text: userPrompt }],
            },
          ],
          text: {
            format: { type: "json_schema", name, strict: true, schema },
          },
        },
      };
    return {
      path: "/chat/completions",
      body: {
        model: this.model,
        temperature: 0,
        max_tokens: maxOutputTokens,
        response_format: {
          type: "json_schema",
          json_schema: { name, strict: true, schema },
        },
        messages: [
          ...systemPrompts.map((content) => ({ role: "system", content })),
          { role: "user", content: userPrompt },
        ],
      },
    };
  }

  async testSynthetic(): Promise<ModelSyntheticTestResult> {
    const started = performance.now();
    const dataBoundary: ModelRuntimeStatus["dataBoundary"] =
      this.mode === "hosted-test"
        ? "synthetic-hosted"
        : this.mode === "local-openai"
          ? "local-network"
          : this.mode === "deterministic"
            ? "deterministic"
            : "none";
    if (!["hosted-test", "local-openai"].includes(this.mode))
      return {
        ready: false,
        mode: this.mode,
        model: this.model,
        latencyMs: Math.round(performance.now() - started),
        dataBoundary,
        message:
          "Kein aufrufbares Sprachmodell für einen echten Test konfiguriert.",
      };
    const result = await this.planCareUpdate(
      "Luca mobilisiert, fast alles gegessen, ca. 200 ml getrunken.",
      {
        organizationLabel: "Synthetische Testinstitution",
        actorRole: "registered-nurse",
        workflowStep: "document",
        activeEpisodeTitle: "Synthetischer Funktionstest",
        recentPrompts: [],
        dataClass: "synthetic-demo",
      },
    );
    const ready = !result.degraded && result.plan !== null;
    if (ready) this.verifiedAt = Date.now();
    return {
      ready,
      mode: this.mode,
      model: result.model,
      latencyMs: Math.round(performance.now() - started),
      dataBoundary,
      message: ready
        ? "Echter synthetischer Strukturierungstest erfolgreich; keine Daten wurden geschrieben."
        : "Sprachmodelltest fehlgeschlagen; deterministischer Fallback blieb aktiv.",
    };
  }

  async status(): Promise<ModelRuntimeStatus> {
    if (this.mode === "disabled")
      return {
        mode: this.mode,
        model: this.model,
        ready: false,
        configured: false,
        acceptance: "not-configured",
        dataBoundary: "none",
        message:
          "Sprachmodell deaktiviert; feste klinische Abläufe bleiben verfügbar.",
      };
    if (this.mode === "deterministic")
      return {
        mode: this.mode,
        model: "deterministic-clinical-router-v1",
        ready: true,
        configured: true,
        acceptance: "accepted",
        dataBoundary: "deterministic",
        message: "Deterministischer Intent-Router aktiv.",
      };
    if (!this.baseUrl || (this.mode === "hosted-test" && !this.apiKey))
      return {
        mode: this.mode,
        model: this.model,
        ready: false,
        configured: false,
        acceptance: "not-configured",
        dataBoundary:
          this.mode === "hosted-test" ? "synthetic-hosted" : "local-network",
        message:
          this.mode === "hosted-test"
            ? "OPENAI_API_KEY beziehungsweise PFH_LLM_API_KEY fehlt."
            : "LLM-Basis-URL fehlt.",
      };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/models`,
        {
          ...(this.apiKey
            ? { headers: { authorization: `Bearer ${this.apiKey}` } }
            : {}),
          signal: controller.signal,
          redirect: "error",
        },
      );
      return {
        mode: this.mode,
        model: this.model,
        ready: response.ok && this.verifiedAt !== null,
        configured: true,
        acceptance:
          response.ok && this.verifiedAt !== null
            ? "accepted"
            : response.ok
              ? "ready-for-test"
              : "not-configured",
        dataBoundary:
          this.mode === "hosted-test" ? "synthetic-hosted" : "local-network",
        message: response.ok
          ? this.verifiedAt
            ? "Sprachmodell mit echtem synthetischem Strukturierungstest bestätigt."
            : "Sprachmodell-Gateway erreichbar; echter synthetischer Strukturierungstest steht noch aus."
          : `Sprachmodell-Gateway antwortet mit HTTP ${response.status}.`,
      };
    } catch {
      return {
        mode: this.mode,
        model: this.model,
        ready: false,
        configured: true,
        acceptance: "ready-for-test",
        dataBoundary:
          this.mode === "hosted-test" ? "synthetic-hosted" : "local-network",
        message:
          "Sprachmodell-Gateway nicht erreichbar; deterministischer Fallback aktiv.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async classify(
    prompt: string,
    context?: AuthorizedModelContext,
  ): Promise<IntentClassification> {
    const fallback = deterministicIntent(prompt);
    if (this.mode === "disabled" || this.mode === "deterministic")
      return {
        intent: fallback,
        mode: this.mode,
        model: "deterministic-clinical-router-v1",
        degraded: false,
      };
    // Recognizable clinical commands stay deterministic and low-latency. The
    // model is reserved for ambiguous language; it never becomes the action
    // authority or a prerequisite for daily work.
    if (fallback !== "unknown")
      return {
        intent: fallback,
        mode: this.mode,
        model: "deterministic-clinical-router-v1",
        degraded: false,
      };
    if (
      !this.canCallConfiguredModel ||
      (this.mode === "hosted-test" && context?.dataClass !== "synthetic-demo")
    )
      return {
        intent: fallback,
        mode: this.mode,
        model: this.model,
        degraded: true,
        failure: {
          code: "not-configured",
          message: this.canCallConfiguredModel
            ? "hosted-model-synthetic-data-only"
            : "model-not-configured",
        },
      };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const contract = this.requestContract(
        [
          'Classify the user\'s German clinical workflow request. Reply with exactly one JSON object in the exact shape {"intent":"patient-summary"}. The object must contain only the intent key. Replace the example value with exactly one of: patient-summary, open-tasks, latest-vitals, handover, team-inbox, sync-status, draft-note, draft-physician-question, draft-task, care-update, knowledge-query, medication-request, unknown. No explanation, no other keys, no arrays. Never diagnose, prescribe, approve, or invent patient facts.',
          ...(boundedContext(context)
            ? [`Authorized bounded working context: ${boundedContext(context)}`]
            : []),
        ],
        prompt.slice(0, 1200),
        "assistant_intent_v1",
        toStrictStructuredOutputSchema(z.toJSONSchema(assistantIntentSchema)),
        40,
      );
      const response = await fetch(
        `${this.baseUrl!.replace(/\/$/, "")}${contract.path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(contract.body),
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new ModelResponseError(
          response.status === 429 ? "rate-limited" : "http-error",
          `model-http-${response.status}`,
        );
      const content = responseText(await response.json());
      const jsonStart = content.indexOf("{");
      const jsonEnd = content.lastIndexOf("}");
      if (jsonStart < 0 || jsonEnd <= jsonStart)
        throw new Error("model-schema");
      const parsed = assistantIntentSchema.parse(
        JSON.parse(content.slice(jsonStart, jsonEnd + 1)),
      );
      return {
        intent: parsed.intent,
        mode: this.mode,
        model: this.model,
        degraded: false,
      };
    } catch (error) {
      const failure =
        error instanceof ModelResponseError
          ? { code: error.code, message: error.message }
          : error instanceof DOMException && error.name === "AbortError"
            ? { code: "timeout" as const, message: "model-timeout" }
            : {
                code: "invalid-output" as const,
                message: "model-invalid-output",
              };
      return {
        intent: fallback,
        mode: this.mode,
        model: this.model,
        degraded: true,
        failure,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async planCareUpdate(
    prompt: string,
    context?: AuthorizedModelContext,
  ): Promise<ClinicalPlanResult> {
    const inputTimestamp = new Date().toISOString();
    const fallback = deterministicAssistantProposal(prompt, { inputTimestamp });
    if (
      this.mode === "disabled" ||
      this.mode === "deterministic" ||
      !this.canCallConfiguredModel ||
      (this.mode === "hosted-test" && context?.dataClass !== "synthetic-demo")
    )
      return {
        plan: fallback,
        mode: this.mode,
        model: "deterministic-clinical-planner-v1",
        degraded: this.mode !== "disabled" && this.mode !== "deterministic",
      };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const contract = this.requestContract(
        [
          "Act as a careful clinical coworker. Extract meaning, never invent it, into the supplied AssistantProposal schema. Use the bounded conversation only to resolve references and corrections; the latest explicit user statement supersedes older conversational wording. Do not require information already present in that context. Keep natural work, observations, task changes, communications, workflow actions, ambiguities, and evidence separate. Copy note structuredText verbatim from its exact source span. Use exact zero-based source spans into the current user text. Medication, treatment, and diagnostic commands are forbidden. Never convert mere mentions of doctor, control, medication, or task into actions; negation must remain negation. Do not add patient identity, provider targets, FHIR, diagnoses, prescriptions, URLs, approvals, or default actions. Return only schema-valid JSON.",
          ...(boundedContext(context)
            ? [`Authorized bounded working context: ${boundedContext(context)}`]
            : []),
        ],
        prompt.slice(0, 1200),
        "assistant_proposal_v3",
        toStrictStructuredOutputSchema(z.toJSONSchema(assistantProposalSchema)),
        1200,
      );
      const response = await fetch(
        `${this.baseUrl!.replace(/\/$/, "")}${contract.path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify(contract.body),
          signal: controller.signal,
          redirect: "error",
        },
      );
      if (!response.ok)
        throw new ModelResponseError(
          response.status === 429 ? "rate-limited" : "http-error",
          `model-http-${response.status}`,
        );
      const content = responseText(await response.json());
      return {
        plan: verifyModelProposalAgainstDeterministicCompiler(
          prompt,
          normalizeProposalTransport(JSON.parse(content)),
          fallback,
          inputTimestamp,
        ),
        mode: this.mode,
        model: this.model,
        degraded: false,
      };
    } catch (error) {
      const failure =
        error instanceof ModelResponseError
          ? { code: error.code, message: error.message }
          : error instanceof DOMException && error.name === "AbortError"
            ? { code: "timeout" as const, message: "model-timeout" }
            : {
                code: "invalid-output" as const,
                message: "model-invalid-output",
              };
      return {
        plan: fallback,
        mode: this.mode,
        model: "deterministic-clinical-planner-v1",
        degraded: true,
        failure,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
