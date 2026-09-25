import { createHash } from "node:crypto";
import { z } from "zod";

export type AgentTerminalStatus =
  | "conversation"
  | "answer"
  | "clarification-needed"
  | "draft-ready"
  | "no-action"
  | "safe-handoff"
  | "cancelled"
  | "budget-exhausted"
  | "failed";

export interface AgentRunContext {
  organizationId: string;
  actorId: string;
  actorRole: string;
  purpose: string;
  sessionId: string;
  threadId: string;
  contextRevision: number;
  patientId: string | null;
  encounterId: string | null;
  dataClass: "synthetic-demo" | "institution-local";
  workingContext: {
    currentStepId: string;
    activeEpisodeTitle: string | null;
    activeEpisodeIsCurrentPatient: boolean;
    hasResumableEpisode: boolean;
    recentConversation: readonly {
      role: "user" | "assistant";
      text: string;
    }[];
  };
  instructions: {
    packVersion: string;
    packDigest: string;
    system: string[];
    skills: Array<{ id: string; description: string }>;
  };
}

export interface AgentToolResult {
  /** Opaque run-local handle shown to the model and used in its claims. */
  referenceId: string;
  /** Durable source reference retained server-side and never serialized. */
  sourceReferenceId?: string;
  data: unknown;
  sourceVersion?: string;
  freshness?: string;
  complete: boolean;
  /** Server-only mapping from a result row to its durable source record. */
  rowProvenance?: Array<{
    path: string;
    resourceId: string;
    version: string;
    patientId?: string;
    encounterId?: string;
    effectiveAt?: string;
    provider?: string;
  }>;
}

export interface AgentEvidenceRecord extends AgentToolResult {
  toolName: string;
}

export interface AgentEvidenceClaim {
  referenceId: string;
  /** Dot-separated path inside the referenced tool result's data object. */
  path: string;
  value: string | number | boolean | null;
}

export type AgentPresentationSpec =
  | { kind: "text" }
  | {
      kind: "table";
      sourceReferenceId: string;
      title: string;
      collectionPath: string;
      columns: Array<{ path: string; label: string }>;
    }
  | {
      kind: "chart";
      sourceReferenceId: string;
      title: string;
      collectionPath: string;
      xPath: string;
      yPath: string;
      labelPath: string;
    };

/** The exact non-executable presentation primitives registered by the PWA. */
export const agentPresentationCatalog = [
  {
    kind: "text",
    component: "AssistantMessage",
    description: "Use for a sufficient short natural answer; no card required.",
  },
  {
    kind: "table",
    component: "EvidenceTable",
    description:
      "Use for comparing several rows from one cited authorized result.",
  },
  {
    kind: "chart",
    component: "EvidenceChart",
    description:
      "Use only for a timestamped numeric series from one cited authorized result.",
  },
] as const;

export interface AgentTool<Schema extends z.ZodType = z.ZodType> {
  name: string;
  version: number;
  description: string;
  effect: "read" | "draft";
  input: Schema;
  execute: (
    input: z.output<Schema>,
    context: AgentRunContext,
    signal: AbortSignal,
  ) => Promise<AgentToolResult>;
}

export interface AgentToolDescriptor {
  name: string;
  version: number;
  description: string;
  effect: "read" | "draft";
  inputSchema: Record<string, unknown>;
}

export type AgentModelDecision =
  | {
      kind: "tool-call";
      toolName: string;
      input: unknown;
    }
  | {
      kind:
        | "conversation"
        | "answer"
        | "clarification-needed"
        | "no-action"
        | "safe-handoff";
      text: string;
      /** Exact references emitted by successful tools during this run. */
      sourceReferenceIds?: string[];
      evidenceClaims?: AgentEvidenceClaim[];
      presentation?: AgentPresentationSpec;
    }
  | {
      kind: "draft-ready";
      text: string;
      draftReferenceId: string;
      sourceReferenceIds?: string[];
      evidenceClaims?: AgentEvidenceClaim[];
      presentation?: AgentPresentationSpec;
    };

export interface AgentModelTurn {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  resultReferenceId?: string;
}

export interface AgentModelAdapter {
  id: string;
  next(input: {
    instructions: string[];
    skills: readonly {
      id: string;
      description: string;
    }[];
    userRequest: string;
    turns: readonly AgentModelTurn[];
    tools: readonly AgentToolDescriptor[];
    signal: AbortSignal;
  }): Promise<AgentModelDecision>;
}

export interface AgentTraceEvent {
  sequence: number;
  kind: "model" | "tool" | "terminal";
  modelId: string;
  tool?: string;
  inputHash?: string;
  resultReferenceId?: string;
  status?: AgentTerminalStatus | "ok" | "rejected";
  latencyMs: number;
}

export interface AgentRunResult {
  status: AgentTerminalStatus;
  text: string;
  draftReferenceId?: string;
  trace: AgentTraceEvent[];
  toolCalls: number;
  sourceReferenceIds?: string[];
  evidenceClaims?: AgentEvidenceClaim[];
  presentation?: AgentPresentationSpec;
  /** Immutable successful results from this run; independent of rendered UI. */
  evidenceRecords?: AgentEvidenceRecord[];
  /** Sanitized provider/runtime failure detail. Never contains prompts or response bodies. */
  failure?: AgentFailureDiagnostic;
}

export interface AgentFailureDiagnostic {
  stage:
    | "configuration"
    | "request"
    | "transport"
    | "provider"
    | "response"
    | "schema"
    | "orchestration";
  code:
    | "not-configured"
    | "authentication"
    | "authorization"
    | "model-access"
    | "rate-limited"
    | "quota-exhausted"
    | "network"
    | "tls"
    | "redirect"
    | "timeout"
    | "cancelled"
    | "unsupported-parameter"
    | "unsupported-schema"
    | "refusal"
    | "incomplete"
    | "invalid-output"
    | "provider-error";
  message: string;
  requestedModel: string;
  returnedModel?: string;
  runtimeMode: string;
  adapter: string;
  apiVersion: string;
  schemaVersion: string;
  httpStatus?: number;
  providerCode?: string;
  providerType?: string;
  providerParam?: string;
  requestId?: string;
  retryAfterSeconds?: number;
  finishReason?: string;
  incompleteReason?: string;
  validationPaths?: string[];
  elapsedMs: number;
  tokenUsage?: {
    input?: number;
    cachedInput?: number;
    output?: number;
    total?: number;
  };
  fallbackUsed: false;
  configurationDigest: string;
  promptDigest: string;
}

export class AgentModelError extends Error {
  constructor(readonly diagnostic: AgentFailureDiagnostic) {
    super(diagnostic.message);
  }
}

export class AgentToolError extends Error {
  constructor(
    readonly code:
      "TOOL_NOT_ALLOWED" | "TOOL_INPUT_INVALID" | "TOOL_RESULT_TOO_LARGE",
    message: string,
  ) {
    super(message);
  }
}

export class AuthorizedToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  constructor(tools: readonly AgentTool[]) {
    for (const tool of tools) {
      if (this.tools.has(tool.name))
        throw new Error(`DUPLICATE_AGENT_TOOL:${tool.name}`);
      if (!/^[a-z][a-z0-9_]{2,63}$/.test(tool.name))
        throw new Error(`INVALID_AGENT_TOOL_NAME:${tool.name}`);
      this.tools.set(tool.name, tool);
    }
  }

  descriptors(allowed: readonly string[]): AgentToolDescriptor[] {
    return allowed.map((name) => {
      const tool = this.tools.get(name);
      if (!tool) throw new AgentToolError("TOOL_NOT_ALLOWED", name);
      return {
        name: tool.name,
        version: tool.version,
        description: tool.description,
        effect: tool.effect,
        inputSchema: z.toJSONSchema(tool.input),
      };
    });
  }

  effect(allowed: readonly string[], name: string): AgentTool["effect"] {
    const tool = allowed.includes(name) ? this.tools.get(name) : undefined;
    if (!tool) throw new AgentToolError("TOOL_NOT_ALLOWED", name);
    return tool.effect;
  }

  async execute(
    allowed: readonly string[],
    name: string,
    input: unknown,
    context: AgentRunContext,
    signal: AbortSignal,
  ): Promise<AgentToolResult> {
    const tool = allowed.includes(name) ? this.tools.get(name) : undefined;
    if (!tool) throw new AgentToolError("TOOL_NOT_ALLOWED", name);
    const parsed = tool.input.safeParse(input);
    if (!parsed.success) throw new AgentToolError("TOOL_INPUT_INVALID", name);
    return tool.execute(parsed.data, context, signal);
  }
}

export interface AgentRuntimeOptions {
  maxModelTurns?: number;
  maxToolCalls?: number;
  maxResultBytes?: number;
  deadlineMs?: number;
  repeatedCallLimit?: number;
}

const safeTerminalText =
  "Ich kann diese Anfrage im aktuellen sicheren Arbeitskontext nicht weiter ausführen.";

function hashInput(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function evidenceValueAt(data: unknown, path: string): unknown {
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.\d+|\.[A-Za-z][A-Za-z0-9_]*)*$/.test(path))
    return undefined;
  return path.split(".").reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && /^\d+$/.test(segment))
      return current[Number(segment)];
    if (
      current !== null &&
      typeof current === "object" &&
      !Array.isArray(current) &&
      Object.prototype.hasOwnProperty.call(current, segment)
    )
      return (current as Record<string, unknown>)[segment];
    return undefined;
  }, data);
}

function claimableEvidence(
  data: unknown,
  path = "",
  claims: AgentEvidenceClaim[] = [],
): AgentEvidenceClaim[] {
  if (claims.length >= 64) return claims;
  if (
    data === null ||
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  ) {
    if (path && (typeof data !== "string" || data.length <= 500))
      claims.push({ referenceId: "", path, value: data });
    return claims;
  }
  if (Array.isArray(data)) {
    data.forEach((value, index) =>
      claimableEvidence(
        value,
        path ? `${path}.${index}` : String(index),
        claims,
      ),
    );
    return claims;
  }
  if (typeof data === "object")
    Object.entries(data as Record<string, unknown>).forEach(([key, value]) =>
      claimableEvidence(value, path ? `${path}.${key}` : key, claims),
    );
  return claims;
}

function terminalStatus(
  decision: Exclude<AgentModelDecision, { kind: "tool-call" }>,
): AgentTerminalStatus {
  return decision.kind;
}

/**
 * A small, provider-independent orchestration loop. It deliberately knows
 * nothing about FHIR, SQL, provider URLs or final-write authority. The caller
 * supplies the exact allowed tool names for one already-authorized request.
 */
export class BoundedAgentRuntime {
  private readonly maxModelTurns: number;
  private readonly maxToolCalls: number;
  private readonly maxResultBytes: number;
  private readonly deadlineMs: number;
  private readonly repeatedCallLimit: number;

  constructor(
    private readonly model: AgentModelAdapter,
    private readonly registry: AuthorizedToolRegistry,
    options: AgentRuntimeOptions = {},
  ) {
    this.maxModelTurns = Math.min(8, Math.max(1, options.maxModelTurns ?? 5));
    this.maxToolCalls = Math.min(6, Math.max(0, options.maxToolCalls ?? 4));
    this.maxResultBytes = Math.min(
      32_768,
      Math.max(512, options.maxResultBytes ?? 16_384),
    );
    this.deadlineMs = Math.min(
      30_000,
      Math.max(500, options.deadlineMs ?? 12_000),
    );
    this.repeatedCallLimit = Math.min(
      2,
      Math.max(1, options.repeatedCallLimit ?? 1),
    );
  }

  async run(input: {
    request: string;
    context: AgentRunContext;
    allowedTools: readonly string[];
    signal?: AbortSignal;
    onProgress?: (event: {
      stage: "model" | "tool" | "validation";
      toolName?: string;
    }) => void;
  }): Promise<AgentRunResult> {
    const reportProgress = (event: {
      stage: "model" | "tool" | "validation";
      toolName?: string;
    }) => {
      try {
        input.onProgress?.(event);
      } catch {
        // Progress is advisory; it must never affect the bounded decision.
      }
    };
    const trace: AgentTraceEvent[] = [];
    const turns: AgentModelTurn[] = [
      ...input.context.workingContext.recentConversation
        .slice(-8)
        .map((turn) => ({
          role: turn.role,
          content: turn.text.slice(0, 400),
        })),
      { role: "user", content: input.request.slice(0, 8_000) },
    ];
    const calls = new Map<string, number>();
    const draftReferences = new Set<string>();
    const toolReferences = new Set<string>();
    const evidenceRecords = new Map<string, AgentEvidenceRecord>();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error("AGENT_DEADLINE_EXCEEDED")),
      this.deadlineMs,
    );
    const onAbort = () => controller.abort(input.signal?.reason);
    input.signal?.addEventListener("abort", onAbort, { once: true });
    let toolCalls = 0;
    try {
      const tools = this.registry.descriptors(input.allowedTools);
      for (let modelTurn = 0; modelTurn < this.maxModelTurns; modelTurn += 1) {
        if (controller.signal.aborted)
          return {
            status: input.signal?.aborted ? "cancelled" : "budget-exhausted",
            text: safeTerminalText,
            trace,
            toolCalls,
          };
        const started = performance.now();
        reportProgress({ stage: "model" });
        let decision: AgentModelDecision;
        try {
          decision = await this.model.next({
            instructions: input.context.instructions.system,
            skills: input.context.instructions.skills,
            userRequest: input.request,
            // Give the adapter an immutable snapshot. Later tool results must
            // not retroactively alter a retained request/tracing object.
            turns: turns.map((turn) => ({ ...turn })),
            tools,
            signal: controller.signal,
          });
        } catch (error) {
          const aborted = controller.signal.aborted;
          const retryableInvalidOutput =
            !aborted &&
            error instanceof AgentModelError &&
            error.diagnostic.code === "invalid-output" &&
            modelTurn + 1 < this.maxModelTurns;
          if (retryableInvalidOutput) {
            trace.push({
              sequence: trace.length + 1,
              kind: "model",
              modelId: this.model.id,
              status: "failed",
              latencyMs: Math.round(performance.now() - started),
            });
            continue;
          }
          const status = input.signal?.aborted
            ? "cancelled"
            : aborted
              ? "budget-exhausted"
              : "failed";
          trace.push({
            sequence: trace.length + 1,
            kind: "terminal",
            modelId: this.model.id,
            status,
            latencyMs: Math.round(performance.now() - started),
          });
          return {
            status,
            text: safeTerminalText,
            trace,
            toolCalls,
            ...(error instanceof AgentModelError
              ? { failure: error.diagnostic }
              : {}),
          };
        }
        trace.push({
          sequence: trace.length + 1,
          kind: "model",
          modelId: this.model.id,
          latencyMs: Math.round(performance.now() - started),
        });
        if (decision.kind !== "tool-call") {
          reportProgress({ stage: "validation" });
          const citedReferences = decision.sourceReferenceIds ?? [];
          const inventedReference = citedReferences.find(
            (referenceId) => !toolReferences.has(referenceId),
          );
          const invalidClaim = (decision.evidenceClaims ?? []).find((claim) => {
            const record = evidenceRecords.get(claim.referenceId);
            return (
              !record ||
              !citedReferences.includes(claim.referenceId) ||
              !Object.is(evidenceValueAt(record.data, claim.path), claim.value)
            );
          });
          const presentationReference =
            decision.presentation && decision.presentation.kind !== "text"
              ? decision.presentation.sourceReferenceId
              : null;
          if (
            (decision.kind === "draft-ready" &&
              !draftReferences.has(decision.draftReferenceId)) ||
            inventedReference !== undefined ||
            invalidClaim !== undefined ||
            (presentationReference !== null &&
              (!toolReferences.has(presentationReference) ||
                !citedReferences.includes(presentationReference))) ||
            (decision.kind === "answer" &&
              toolCalls > 0 &&
              citedReferences.length === 0)
          ) {
            trace.push({
              sequence: trace.length + 1,
              kind: "terminal",
              modelId: this.model.id,
              status: "rejected",
              latencyMs: 0,
            });
            return {
              status: "safe-handoff",
              text: safeTerminalText,
              trace,
              toolCalls,
            };
          }
          const status = terminalStatus(decision);
          trace.push({
            sequence: trace.length + 1,
            kind: "terminal",
            modelId: this.model.id,
            status,
            latencyMs: 0,
          });
          return {
            status,
            text: decision.text.slice(0, 4_000),
            ...(decision.kind === "draft-ready"
              ? { draftReferenceId: decision.draftReferenceId }
              : {}),
            ...(citedReferences.length > 0
              ? { sourceReferenceIds: citedReferences }
              : {}),
            ...((decision.evidenceClaims?.length ?? 0) > 0
              ? { evidenceClaims: decision.evidenceClaims }
              : {}),
            ...(decision.presentation
              ? { presentation: decision.presentation }
              : {}),
            evidenceRecords: [...evidenceRecords.values()].map((record) =>
              structuredClone(record),
            ),
            trace,
            toolCalls,
          };
        }
        if (toolCalls >= this.maxToolCalls)
          return {
            status: "budget-exhausted",
            text: safeTerminalText,
            trace: [
              ...trace,
              {
                sequence: trace.length + 1,
                kind: "terminal",
                modelId: this.model.id,
                status: "budget-exhausted",
                latencyMs: 0,
              },
            ],
            toolCalls,
          };
        const inputHash = hashInput({
          tool: decision.toolName,
          input: decision.input,
        });
        const repeated = (calls.get(inputHash) ?? 0) + 1;
        calls.set(inputHash, repeated);
        if (repeated > this.repeatedCallLimit)
          return {
            status: "budget-exhausted",
            text: safeTerminalText,
            trace: [
              ...trace,
              {
                sequence: trace.length + 1,
                kind: "terminal",
                modelId: this.model.id,
                tool: decision.toolName,
                inputHash,
                status: "budget-exhausted",
                latencyMs: 0,
              },
            ],
            toolCalls,
          };
        const toolStarted = performance.now();
        reportProgress({ stage: "tool", toolName: decision.toolName });
        try {
          const result = await this.registry.execute(
            input.allowedTools,
            decision.toolName,
            decision.input,
            input.context,
            controller.signal,
          );
          const serialized = JSON.stringify(result.data);
          if (Buffer.byteLength(serialized, "utf8") > this.maxResultBytes)
            throw new AgentToolError(
              "TOOL_RESULT_TOO_LARGE",
              decision.toolName,
            );
          toolCalls += 1;
          if (
            this.registry.effect(input.allowedTools, decision.toolName) ===
            "draft"
          )
            draftReferences.add(result.referenceId);
          toolReferences.add(result.referenceId);
          evidenceRecords.set(result.referenceId, {
            ...structuredClone(result),
            toolName: decision.toolName,
          });
          trace.push({
            sequence: trace.length + 1,
            kind: "tool",
            modelId: this.model.id,
            tool: decision.toolName,
            inputHash,
            resultReferenceId: result.referenceId,
            status: "ok",
            latencyMs: Math.round(performance.now() - toolStarted),
          });
          turns.push({
            role: "assistant",
            content: `Requested approved tool ${decision.toolName}.`,
            toolName: decision.toolName,
          });
          turns.push({
            role: "tool",
            toolName: decision.toolName,
            resultReferenceId: result.referenceId,
            content: JSON.stringify({
              boundary: "UNTRUSTED_TOOL_DATA",
              referenceId: result.referenceId,
              complete: result.complete,
              freshness: result.freshness ?? null,
              data: result.data,
              claimableEvidence: claimableEvidence(result.data).map(
                ({ path, value }) => ({
                  referenceId: result.referenceId,
                  path,
                  value,
                }),
              ),
            }),
          });
        } catch (error) {
          const rejected = error instanceof AgentToolError;
          trace.push({
            sequence: trace.length + 1,
            kind: "tool",
            modelId: this.model.id,
            tool: decision.toolName,
            inputHash,
            status: "rejected",
            latencyMs: Math.round(performance.now() - toolStarted),
          });
          return {
            status: rejected ? "safe-handoff" : "failed",
            text: safeTerminalText,
            trace,
            toolCalls,
          };
        }
      }
      return {
        status: "budget-exhausted",
        text: safeTerminalText,
        trace: [
          ...trace,
          {
            sequence: trace.length + 1,
            kind: "terminal",
            modelId: this.model.id,
            status: "budget-exhausted",
            latencyMs: 0,
          },
        ],
        toolCalls,
      };
    } finally {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}
