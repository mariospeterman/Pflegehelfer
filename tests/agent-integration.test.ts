import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { AssistantService } from "../src/core/assistant-service.js";
import { runtimeSitePack } from "../src/core/runtime-instructions.js";
import { PflegehelferService } from "../src/core/service.js";

afterEach(() => vi.unstubAllGlobals());

describe("runtime-guided assistant agent", () => {
  it("sends reviewed Markdown, observes an authorized tool result, and returns grounded GenUI", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let agentTurn = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        bodies.push(body);
        const format = (body.text as { format?: { name?: string } } | undefined)
          ?.format;
        const output =
          format?.name === "assistant_intent_v1"
            ? { intent: "unknown" }
            : agentTurn++ === 0
              ? {
                  kind: "tool-call",
                  toolName: "get_latest_vitals",
                  input: {},
                  text: null,
                  draftReferenceId: null,
                }
              : agentTurn === 2
                ? {
                    kind: "tool-call",
                    toolName: "get_handover",
                    input: {},
                    text: null,
                    draftReferenceId: null,
                  }
                : {
                    kind: "answer",
                    toolName: null,
                    input: null,
                    text: "Deine Übergabe ist bereit; zwei Punkte sind noch offen.",
                    draftReferenceId: null,
                  };
        return Promise.resolve(
          new Response(
            JSON.stringify({ output_text: JSON.stringify(output) }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            },
          ),
        );
      }),
    );
    const gateway = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: "synthetic-test-key",
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "fixture-agent",
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Was muss ich jetzt als Nächstes wissen?",
      patientId: null,
      workingContext: {
        organizationId: "org-tertianum",
        sessionId: "session-test",
        threadId: "assistant:u-nurse:general",
        contextRevision: 4,
        departmentId: "rehab-2",
        stationId: "rehabilitation-2",
        roleProfileId: "fage-efz",
        workflowId: "nursing-day",
        currentStepId: "handover",
        activeEpisodeTitle: null,
        activeEpisodePatientId: null,
        resumableEpisodePatientId: null,
        recentPrompts: [],
        recentConversation: [
          { role: "user", text: "Ich habe vier Kontexte geprüft." },
          { role: "assistant", text: "Zwei sind noch offen." },
        ],
        organizationLabel: "Kronenhof Demo",
        actorRole: "registered-nurse",
        dataClass: "synthetic-demo",
        workdayHandover: {
          shiftKey: "2026-09-13:early",
          status: "open",
          acknowledgedCount: 4,
          assignedCount: 6,
          openCount: 2,
          summary: "4/6 Patientenkontexte geprüft",
        },
      },
    });

    expect(response.runtime.agent).toMatchObject({
      packId: runtimeSitePack.packId,
      packVersion: runtimeSitePack.version,
      toolCalls: 2,
      status: "answer",
    });
    expect(response.components[0]).toMatchObject({
      type: "AssistantText",
      message: expect.stringContaining("operationaler Übergabe"),
    });
    expect(JSON.stringify(response.components)).not.toContain(
      "zwei Punkte sind noch offen",
    );
    expect(response.components).toContainEqual(
      expect.objectContaining({ type: "HandoverChecklist", openCount: 2 }),
    );
    const agentSystemText = (
      bodies[1]!.input as Array<{
        role: string;
        content: Array<{ text: string }>;
      }>
    )
      .filter(({ role }) => role === "system")
      .flatMap(({ content }) => content.map(({ text }) => text))
      .join("\n");
    expect(agentSystemText).toContain(runtimeSitePack.instructions.base!.body);
    expect(JSON.stringify(bodies[1])).toContain("availableWorkflowSkills");
    expect(JSON.stringify(bodies[1])).toContain("nursing-early");
    expect(JSON.stringify(bodies[1])).toContain(
      "Ich habe vier Kontexte geprüft",
    );
    expect(agentSystemText).toContain("TRUSTED_WORKING_CONTEXT");
    expect(JSON.stringify(bodies[2])).toContain("UNTRUSTED_TOOL_DATA");
    expect(JSON.stringify(bodies[2])).toContain("observations");
    expect(JSON.stringify(bodies[2])).not.toContain("Patient/p-");
    expect(JSON.stringify(bodies[3])).toContain(
      "4/6 Patientenkontexte geprüft",
    );
    expect(JSON.stringify(bodies)).not.toContain("synthetic-test-key");
  });

  it("reports a failed agent run and falls back to deterministic read UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 503 }))),
    );
    const gateway = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: "synthetic-test-key",
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "fixture-agent",
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Was ist noch offen?",
      patientId: null,
      workingContext: {
        organizationId: "org-tertianum",
        sessionId: "session-test",
        threadId: "assistant:u-nurse:general",
        contextRevision: 4,
        departmentId: "rehab-2",
        stationId: "rehabilitation-2",
        roleProfileId: "fage-efz",
        workflowId: "nursing-day",
        currentStepId: "work-plan",
        activeEpisodeTitle: null,
        activeEpisodePatientId: null,
        resumableEpisodePatientId: null,
        recentPrompts: [],
        organizationLabel: "Kronenhof Demo",
        actorRole: "registered-nurse",
        dataClass: "synthetic-demo",
        workdayHandover: null,
      },
    });

    expect(response.runtime).toMatchObject({
      route: "deterministic",
      degraded: true,
      agent: { status: "failed", toolCalls: 0 },
    });
    expect(response.runtime.label).toContain("Fallback");
    expect(response.components).toContainEqual(
      expect.objectContaining({ type: "TaskList" }),
    );
    expect(response.warnings.join(" ")).toContain(
      "Agentenlauf wurde nicht abgeschlossen",
    );
  });
});
