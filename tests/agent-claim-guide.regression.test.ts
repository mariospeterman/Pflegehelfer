import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AuthorizedToolRegistry,
  AgentModelError,
  BoundedAgentRuntime,
  type AgentModelAdapter,
  type AgentRunContext,
} from "../src/ai/agent-runtime.js";

const context: AgentRunContext = {
  organizationId: "synthetic-org",
  actorId: "synthetic-reviewer",
  actorRole: "quality-safety",
  purpose: "synthetic-acceptance",
  sessionId: "session-claim-guide",
  threadId: "thread-claim-guide",
  contextRevision: 1,
  patientId: null,
  encounterId: null,
  dataClass: "synthetic-demo",
  workingContext: {
    currentStepId: "acceptance",
    activeEpisodeTitle: null,
    activeEpisodeIsCurrentPatient: false,
    hasResumableEpisode: false,
    recentConversation: [],
  },
  instructions: {
    packVersion: "synthetic-v1",
    packDigest: "a".repeat(64),
    system: ["Synthetic no-write acceptance."],
    skills: [],
  },
};

describe("agent claim guide regression", () => {
  it("retries one schema-invalid model response inside the existing turn budget", async () => {
    let attempts = 0;
    const model: AgentModelAdapter = {
      id: "schema-retry-fixture",
      next: () => {
        attempts += 1;
        if (attempts === 1)
          return Promise.reject(
            new AgentModelError({
              stage: "schema",
              code: "invalid-output",
              message: "synthetic-invalid-output",
              requestedModel: "fixture",
              runtimeMode: "synthetic",
              adapter: "fixture",
              apiVersion: "fixture-v1",
              schemaVersion: "fixture-v1",
              elapsedMs: 1,
              fallbackUsed: false,
              configurationDigest: "a".repeat(64),
              promptDigest: "b".repeat(64),
            }),
          );
        return Promise.resolve({
          kind: "conversation" as const,
          text: "Verstanden.",
        });
      },
    };

    const result = await new BoundedAgentRuntime(
      model,
      new AuthorizedToolRegistry([]),
      { maxModelTurns: 2 },
    ).run({ request: "Danke.", context, allowedTools: [] });

    expect(result.status).toBe("conversation");
    expect(attempts).toBe(2);
    expect(result.trace).toMatchObject([
      { kind: "model", status: "failed" },
      { kind: "model" },
      { kind: "terminal", status: "conversation" },
    ]);
  });

  it("shows exact scalar claim paths after a read without weakening validation", async () => {
    let invocation = 0;
    const model: AgentModelAdapter = {
      id: "claim-guide-fixture",
      next: (input) => {
        invocation += 1;
        if (invocation === 1)
          return Promise.resolve({
            kind: "tool-call" as const,
            toolName: "get_open_tasks",
            input: {},
          });
        const toolTurn = JSON.parse(input.turns.at(-1)!.content) as {
          referenceId: string;
          claimableEvidence: Array<{
            referenceId: string;
            path: string;
            value: string;
          }>;
        };
        expect(toolTurn.claimableEvidence).toEqual([
          {
            referenceId: toolTurn.referenceId,
            path: "tasks.0.patientLabel",
            value: "Synthetische Person",
          },
          {
            referenceId: toolTurn.referenceId,
            path: "tasks.0.title",
            value: "Synthetische Rückfrage prüfen",
          },
          {
            referenceId: toolTurn.referenceId,
            path: "tasks.0.state",
            value: "accepted",
          },
        ]);
        return Promise.resolve({
          kind: "answer" as const,
          text: "Eine Aufgabe ist offen.",
          sourceReferenceIds: [toolTurn.referenceId],
          evidenceClaims: toolTurn.claimableEvidence,
        });
      },
    };
    const registry = new AuthorizedToolRegistry([
      {
        name: "get_open_tasks",
        version: 1,
        description: "Read isolated synthetic tasks.",
        effect: "read",
        input: z.object({}).strict(),
        execute: () =>
          Promise.resolve({
            referenceId: "EvidenceResult/synthetic/tasks",
            complete: true,
            data: {
              tasks: [
                {
                  patientLabel: "Synthetische Person",
                  title: "Synthetische Rückfrage prüfen",
                  state: "accepted",
                },
              ],
            },
          }),
      },
    ]);

    await expect(
      new BoundedAgentRuntime(model, registry).run({
        request: "Welche Aufgabe ist offen?",
        context,
        allowedTools: ["get_open_tasks"],
      }),
    ).resolves.toMatchObject({
      status: "answer",
      toolCalls: 1,
      sourceReferenceIds: ["EvidenceResult/synthetic/tasks"],
    });
  });
});
