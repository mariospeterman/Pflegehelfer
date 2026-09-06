import { z } from "zod";
import { validateLocalAiEndpoint } from "./local-endpoint-policy.js";
import {
  clinicalActionPlanSchema,
  deterministicCareUpdatePlan,
  verifyModelPlanAgainstDeterministicCompiler,
  type ClinicalActionPlan,
} from "./clinical-action-plan.js";

export const assistantIntentSchema = z
  .object({
    intent: z.enum([
      "patient-summary",
      "open-tasks",
      "latest-vitals",
      "handover",
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
  plan: ClinicalActionPlan | null;
  mode: AiRuntimeMode;
  model: string;
  degraded: boolean;
}

function deterministicIntent(prompt: string): AssistantIntent {
  const text = prompt.toLocaleLowerCase("de-CH");
  // Multi-object bedside updates must be recognized before their individual
  // vital/note/message fragments. The model never decides the resulting
  // writes; the typed assistant service extracts and validates the bundle.
  if (
    /(blutdruck|\brr\b)/.test(text) &&
    /(dokument|mobilis|fertig|gemacht)/.test(text) &&
    /(arzt|ärzt|informier|kontrolle|nochmal|wiederhol)/.test(text)
  )
    return "care-update";
  // A request for an approved SOP can mention medication without being a
  // medication action. Route explicit governance language before the more
  // general medication safety guard so the grounded knowledge path is usable.
  if (/richtlinie|standard|sop|policy|vorgehen|was gilt|prozess/.test(text))
    return "knowledge-query";
  if (/torasemid|medikament|medikation|dosis|dosierung|mg\b/.test(text))
    return "medication-request";
  if (/übergabe|uebergabe|handover|schichtwechsel/.test(text))
    return "handover";
  if (/blutdruck|vital|temperatur|sättigung|saettigung|puls|gewicht/.test(text))
    return "latest-vitals";
  if (/offen|aufgabe|task|zu tun|todo/.test(text)) return "open-tasks";
  if (/notiz|dokumentier|anamnes|pflegebericht|schreib.*auf/.test(text))
    return "draft-note";
  if (/arzt|ärzt|frage|nachricht|informier/.test(text))
    return "draft-physician-question";
  if (/profil|patient|wer ist|übersicht|uebersicht/.test(text))
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
    this.model = env.PFH_LLM_MODEL ?? "deterministic-clinical-router-v1";
    this.baseUrl =
      this.mode === "local-openai"
        ? validateLocalAiEndpoint(env.PFH_LLM_BASE_URL, env)
        : (env.PFH_LLM_BASE_URL ?? null);
    this.apiKey = env.PFH_LLM_API_KEY ?? null;
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
        env.PFH_DEMO_MODE !== "true")
    )
      throw new Error(
        "Hosted model mode is permitted only for explicit synthetic demo data.",
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
    if (!this.baseUrl)
      return {
        mode: this.mode,
        model: this.model,
        ready: false,
        dataBoundary:
          this.mode === "hosted-test" ? "synthetic-hosted" : "local-network",
        message: "LLM-Basis-URL fehlt.",
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
    if (!this.baseUrl)
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
            max_tokens: 40,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'Classify the user\'s German clinical workflow request. Reply with exactly one JSON object in the exact shape {"intent":"patient-summary"}. The object must contain only the intent key. Replace the example value with exactly one of: patient-summary, open-tasks, latest-vitals, handover, draft-note, draft-physician-question, draft-task, care-update, knowledge-query, medication-request, unknown. No explanation, no other keys, no arrays. Never diagnose, prescribe, approve, or invent patient facts.',
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

  async planCareUpdate(prompt: string): Promise<ClinicalPlanResult> {
    const fallback = deterministicCareUpdatePlan(prompt);
    if (
      !fallback ||
      this.mode === "disabled" ||
      this.mode === "deterministic" ||
      !this.baseUrl
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
            max_tokens: 1200,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "clinical_action_plan_v1",
                strict: true,
                schema: z.toJSONSchema(clinicalActionPlanSchema),
              },
            },
            messages: [
              {
                role: "system",
                content:
                  "Extract, never invent, a bounded clinical action proposal. Use exact zero-based source spans into the user text. Allowed actions are only note-proposal, blood-pressure observation-proposal, physician communication-proposal, and registered-nurse task-proposal. Do not include patient identity, provider targets, FHIR, diagnoses, prescriptions, URLs, or approvals. Put uncertainty in ambiguities. Return only schema-valid JSON.",
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
        plan: verifyModelPlanAgainstDeterministicCompiler(
          prompt,
          JSON.parse(content),
          fallback,
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
