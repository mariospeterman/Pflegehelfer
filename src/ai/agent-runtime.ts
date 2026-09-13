import { createHash } from "node:crypto";
import { z } from "zod";

export type AgentTerminalStatus =
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
    activeEpisodePatientId: string | null;
    resumableEpisodePatientId: string | null;
    recentConversation: readonly {
      role: "user" | "assistant";
      text: string;
    }[];
  };
  instructions: {
    packVersion: string;
    packDigest: string;
    system: string[];
    skills: Array<{ id: string; description: string; contentHash: string }>;
  };
}

export interface AgentToolResult {
  referenceId: string;
  data: unknown;
  sourceVersion?: string;
  freshness?: string;
  complete: boolean;
}

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
      kind: "answer" | "clarification-needed" | "no-action" | "safe-handoff";
      text: string;
    }
  | {
      kind: "draft-ready";
      text: string;
      draftReferenceId: string;
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
      contentHash: string;
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
  }): Promise<AgentRunResult> {
    const trace: AgentTraceEvent[] = [];
    const turns: AgentModelTurn[] = [
      ...input.context.workingContext.recentConversation
        .slice(-8)
        .map((turn) => ({
          role: turn.role,
          content: turn.text.slice(0, 400),
        })),
      { role: "user", content: input.request.slice(0, 4_000) },
    ];
    const calls = new Map<string, number>();
    const draftReferences = new Set<string>();
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
        } catch {
          const aborted = controller.signal.aborted;
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
          return { status, text: safeTerminalText, trace, toolCalls };
        }
        trace.push({
          sequence: trace.length + 1,
          kind: "model",
          modelId: this.model.id,
          latencyMs: Math.round(performance.now() - started),
        });
        if (decision.kind !== "tool-call") {
          if (
            decision.kind === "draft-ready" &&
            !draftReferences.has(decision.draftReferenceId)
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
              sourceVersion: result.sourceVersion ?? null,
              freshness: result.freshness ?? null,
              data: result.data,
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
