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
}

export interface ModelRuntimeStatus {
  mode: AiRuntimeMode;
  model: string;
  ready: boolean;
  dataBoundary: "none" | "deterministic" | "synthetic-hosted" | "local-network";
  message: string;
}

export interface ClinicalPlanResult {
  plan: AssistantProposal | null;
  mode: AiRuntimeMode;
  model: string;
  degraded: boolean;
}

export interface OpenUiCompositionResult {
  order: string[];
  composedByModel: boolean;
  degraded: boolean;
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
  // Governance questions may mention a medicine, treatment or diagnosis.
  // They remain read-only knowledge queries; imperative clinical language is
  // routed into the dedicated fail-closed workflow before any note prefix can
  // accidentally turn it into writable documentation.
  if (/richtlinie|standard|sop|policy|vorgehen|was gilt|prozess/.test(text))
    return "knowledge-query";
  if (
    requiresDedicatedClinicalWorkflow(text) ||
    /\b(?:torasemid|insulin|antibiotik|medikament|medikation|dosis|dosierung|therapie|behandlung|diagnos|verordn|verschreib)\b/.test(
      text,
    ) ||
    /\b\d+(?:[,.]\d+)?\s*(?:mg|ie|i\.e\.)\b/.test(text) ||
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

  async status(): Promise<ModelRuntimeStatus> {
    if (this.mode === "disabled")
      return {
        mode: this.mode,
        model: this.model,
        ready: false,
        dataBoundary: "none",
        message:
          "Sprachmodell deaktiviert; feste klinische Abläufe bleiben verfügbar.",
      };
    if (this.mode === "deterministic")
      return {
        mode: this.mode,
        model: "deterministic-clinical-router-v1",
        ready: true,
        dataBoundary: "deterministic",
        message: "Deterministischer Intent-Router aktiv.",
      };
    if (!this.baseUrl || (this.mode === "hosted-test" && !this.apiKey))
      return {
        mode: this.mode,
        model: this.model,
        ready: false,
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
        },
      );
      return {
        mode: this.mode,
        model: this.model,
        ready: response.ok,
        dataBoundary:
          this.mode === "hosted-test" ? "synthetic-hosted" : "local-network",
        message: response.ok
          ? "Konfiguriertes Sprachmodell-Gateway erreichbar."
          : `Sprachmodell-Gateway antwortet mit HTTP ${response.status}.`,
      };
    } catch {
      return {
        mode: this.mode,
        model: this.model,
        ready: false,
        dataBoundary:
          this.mode === "hosted-test" ? "synthetic-hosted" : "local-network",
        message:
          "Sprachmodell-Gateway nicht erreichbar; deterministischer Fallback aktiv.",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async classify(prompt: string): Promise<IntentClassification> {
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
    if (!this.canCallConfiguredModel)
      return {
        intent: fallback,
        mode: this.mode,
        model: this.model,
        degraded: true,
      };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `${this.baseUrl!.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: 40,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'Classify the user\'s German clinical workflow request. Reply with exactly one JSON object in the exact shape {"intent":"patient-summary"}. The object must contain only the intent key. Replace the example value with exactly one of: patient-summary, open-tasks, latest-vitals, handover, team-inbox, sync-status, draft-note, draft-physician-question, draft-task, care-update, knowledge-query, medication-request, unknown. No explanation, no other keys, no arrays. Never diagnose, prescribe, approve, or invent patient facts.',
              },
              { role: "user", content: prompt.slice(0, 1200) },
            ],
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`model-http-${response.status}`);
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("model-empty");
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
    } catch {
      return {
        intent: fallback,
        mode: this.mode,
        model: this.model,
        degraded: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async composeOpenUi(
    candidateTypes: string[],
  ): Promise<OpenUiCompositionResult> {
    const handles = candidateTypes.map(
      (_type, index) => `candidate-${index + 1}`,
    );
    const fallback = {
      order: handles,
      composedByModel: false,
      degraded: false,
    };
    if (
      this.mode === "disabled" ||
      this.mode === "deterministic" ||
      !this.canCallConfiguredModel ||
      handles.length < 2
    )
      return fallback;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `${this.baseUrl!.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: 180,
            messages: [
              {
                role: "system",
                content: [
                  "Compose a bounded OpenUI presentation using only opaque candidate handles.",
                  "Available components: ClinicalStack(children: Candidate[]), Candidate(handle: string).",
                  "Return exactly an OpenUI Lang program: root = ClinicalStack([item1, ...]) followed by one item line for each candidate.",
                  "Every supplied handle must occur exactly once. Do not add properties, text, facts, actions, URLs, code or handles.",
                ].join(" "),
              },
              {
                role: "user",
                content: handles
                  .map((handle, index) => `${handle}: ${candidateTypes[index]}`)
                  .join("\n"),
              },
            ],
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error("composition-http");
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content ?? "";
      const programLines = content
        .trim()
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const declarations = new Map(
        programLines.slice(1).map((line) => {
          const match = /^(item\d+) = Candidate\("(candidate-\d+)"\)$/.exec(
            line,
          );
          return [match?.[1] ?? "", match?.[2] ?? ""] as const;
        }),
      );
      const rootItems =
        /^root = ClinicalStack\(\[(.+)\]\)$/
          .exec(programLines[0] ?? "")?.[1]
          ?.split(",")
          .map((item) => item.trim()) ?? [];
      const declared = rootItems.map((item) => declarations.get(item) ?? "");
      if (
        programLines.length !== handles.length + 1 ||
        !/^root = ClinicalStack\(\[item\d+(, item\d+)*\]\)$/.test(
          programLines[0] ?? "",
        ) ||
        programLines
          .slice(1)
          .some(
            (line) => !/^item\d+ = Candidate\("candidate-\d+"\)$/.test(line),
          ) ||
        declared.length !== handles.length ||
        new Set(declared).size !== handles.length ||
        declared.some((handle) => !handles.includes(handle)) ||
        handles.some((handle) => !declared.includes(handle)) ||
        /<|>|https?:|javascript:|intentToken|patientId|sourceVersion/.test(
          content,
        )
      )
        throw new Error("composition-schema");
      return { order: declared, composedByModel: true, degraded: false };
    } catch {
      return { ...fallback, degraded: true };
    } finally {
      clearTimeout(timer);
    }
  }

  async planCareUpdate(prompt: string): Promise<ClinicalPlanResult> {
    const inputTimestamp = new Date().toISOString();
    const fallback = deterministicAssistantProposal(prompt, { inputTimestamp });
    if (
      this.mode === "disabled" ||
      this.mode === "deterministic" ||
      !this.canCallConfiguredModel
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
      const response = await fetch(
        `${this.baseUrl!.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            max_tokens: 1200,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "assistant_proposal_v3",
                strict: true,
                schema: z.toJSONSchema(assistantProposalSchema),
              },
            },
            messages: [
              {
                role: "system",
                content:
                  "Act as a careful clinical coworker. Extract meaning, never invent it, into the supplied AssistantProposal schema. Keep natural work, observations, task changes, communications, workflow actions, ambiguities, and evidence separate. Copy note structuredText verbatim from its exact source span. Use exact zero-based source spans into the user text. Medication, treatment, and diagnostic commands are forbidden. Never convert mere mentions of doctor, control, medication, or task into actions; negation must remain negation. Do not add patient identity, provider targets, FHIR, diagnoses, prescriptions, URLs, approvals, or default actions. Return only schema-valid JSON.",
              },
              { role: "user", content: prompt.slice(0, 1200) },
            ],
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(`model-http-${response.status}`);
      const body = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new Error("model-empty");
      return {
        plan: verifyModelProposalAgainstDeterministicCompiler(
          prompt,
          JSON.parse(content),
          fallback,
          inputTimestamp,
        ),
        mode: this.mode,
        model: this.model,
        degraded: false,
      };
    } catch {
      return {
        plan: fallback,
        mode: this.mode,
        model: "deterministic-clinical-planner-v1",
        degraded: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
