import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { AssistantService } from "../src/core/assistant-service.js";
import { runtimeSitePack } from "../src/core/runtime-instructions.js";
import { PflegehelferService } from "../src/core/service.js";
import { deterministicAssistantProposal } from "../src/ai/assistant-proposal.js";

afterEach(() => vi.unstubAllGlobals());

const syntheticCredential = ["synthetic", "test", "credential"].join("-");

describe("runtime-guided assistant agent", () => {
  it("sends reviewed Markdown, observes an authorized tool result, and returns grounded GenUI", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let agentTurn = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected a serialized model request");
        const body = JSON.parse(init.body) as Record<string, unknown>;
        bodies.push(body);
        const format = (body.text as { format?: { name?: string } } | undefined)
          ?.format;
        const agentDecisions = [
          {
            kind: "tool-call",
            toolName: "load_workflow_skill",
            input: { skillId: "nursing-early" },
            text: null,
            draftReferenceId: null,
            sourceReferenceIds: [],
          },
          {
            kind: "tool-call",
            toolName: "get_latest_vitals",
            input: {},
            text: null,
            draftReferenceId: null,
            sourceReferenceIds: [],
          },
          {
            kind: "tool-call",
            toolName: "get_handover",
            input: {},
            text: null,
            draftReferenceId: null,
            sourceReferenceIds: [],
          },
          {
            kind: "answer",
            toolName: null,
            input: null,
            text: "Offen: 2.",
            draftReferenceId: null,
            sourceReferenceIds: [
              `RuntimeInstruction/nursing-early/${runtimeSitePack.instructions["nursing-early"]!.sha256}`,
              "WorkdayHandover/2026-09-13:early",
            ],
          },
        ];
        const output =
          format?.name === "assistant_intent_v1"
            ? { intent: "unknown" }
            : agentDecisions[agentTurn++];
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
      PFH_LLM_API_KEY: syntheticCredential,
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
        activeEpisodePatientId: "p-luca",
        resumableEpisodePatientId: "p-anna",
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
      toolCalls: 3,
      status: "answer",
    });
    const lead = response.components[0];
    expect(lead?.type).toBe("AssistantText");
    if (lead?.type !== "AssistantText")
      throw new Error("Missing grounded lead");
    expect(lead.message).toContain("Offen: 2");
    expect(response.components).toHaveLength(1);
    const agentSystemText = (
      bodies[0]!.input as Array<{
        role: string;
        content: Array<{ text: string }>;
      }>
    )
      .filter(({ role }) => role === "system")
      .flatMap(({ content }) => content.map(({ text }) => text))
      .join("\n");
    expect(agentSystemText).toContain(runtimeSitePack.instructions.base!.body);
    expect(JSON.stringify(bodies[0])).toContain("availableWorkflowSkills");
    expect(JSON.stringify(bodies[0])).toContain("nursing-early");
    expect(JSON.stringify(bodies[0])).toContain(
      "Ich habe vier Kontexte geprüft",
    );
    expect(agentSystemText).toContain("TRUSTED_WORKING_CONTEXT");
    expect(agentSystemText).toContain('"hasResumableEpisode":true');
    expect(agentSystemText).not.toContain("p-luca");
    expect(agentSystemText).not.toContain("p-anna");
    expect(JSON.stringify(bodies[1])).toContain("UNTRUSTED_TOOL_DATA");
    expect(JSON.stringify(bodies[1])).toContain(
      runtimeSitePack.instructions["nursing-early"]!.sha256,
    );
    expect(JSON.stringify(bodies[1])).toContain(
      "Begin with the exact versioned handover roster",
    );
    expect(JSON.stringify(bodies[1])).not.toContain(
      runtimeSitePack.instructions.arzt!.body,
    );
    expect(JSON.stringify(bodies[2])).toContain("observations");
    expect(JSON.stringify(bodies[2])).not.toContain("Patient/p-");
    expect(JSON.stringify(bodies[2])).not.toContain("externalId");
    expect(JSON.stringify(bodies[3])).toContain(
      "4/6 Patientenkontexte geprüft",
    );
    expect(JSON.stringify(bodies)).not.toContain(syntheticCredential);
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
      PFH_LLM_API_KEY: syntheticCredential,
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
      route: "safe-fallback",
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

  it("does not make a second hosted call when a care-draft agent run fails", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 503 })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    const response = await new AssistantService(
      new PflegehelferService(),
      new ModelGateway({
        PFH_AI_MODE: "hosted-test",
        PFH_DEMO_MODE: "true",
        PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
        PFH_ALLOW_EXTERNAL_AI: "true",
        PFH_LLM_API_KEY: syntheticCredential,
        PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
        PFH_LLM_MODEL: "fixture-agent",
      }),
    ).query("u-nurse", {
      prompt: "Luca mobilisiert.",
      patientId: "p-luca",
      workingContext: {
        organizationId: "org-tertianum",
        sessionId: "session-test",
        threadId: "assistant:u-nurse:patient:p-luca:enc-luca-2026",
        contextRevision: 4,
        departmentId: "rehab-2",
        stationId: "rehabilitation-2",
        roleProfileId: "fage-efz",
        workflowId: "nursing-day",
        currentStepId: "patient-work",
        activeEpisodeTitle: "Morgenpflege",
        activeEpisodePatientId: "p-luca",
        resumableEpisodePatientId: null,
        recentPrompts: [],
        recentConversation: [],
        organizationLabel: "Kronenhof Demo",
        actorRole: "registered-nurse",
        dataClass: "synthetic-demo",
        workdayHandover: null,
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.runtime).toMatchObject({
      route: "safe-fallback",
      degraded: true,
      agent: { status: "failed", toolCalls: 0 },
    });
    expect(response.components).toContainEqual(
      expect.objectContaining({ type: "DraftAction", kind: "care-update" }),
    );
  });

  it("lets the bounded agent choose a patient-bound draft tool for an unfamiliar care paraphrase", async () => {
    const prompt = "Beim Aufstehen bis zum Fenster unterstützt.";
    const fixturePlan = deterministicAssistantProposal(prompt);
    if (!fixturePlan) throw new Error("Expected a faithful fixture proposal");
    let agentTurn = 0;
    const seenFormats: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        if (typeof init?.body !== "string")
          throw new Error("Expected a serialized model request");
        const body = JSON.parse(init.body) as Record<string, unknown>;
        const format = (body.text as { format?: { name?: string } } | undefined)
          ?.format?.name;
        if (format) seenFormats.push(format);
        const latestToolReference = JSON.stringify(body).match(
          /DraftPreparation\/care-update\/request-[a-f0-9]+/,
        )?.[0];
        const output =
          agentTurn++ === 0
            ? {
                kind: "tool-call",
                toolName: "prepare_clinical_draft",
                input: { proposalJson: JSON.stringify(fixturePlan) },
                text: null,
                draftReferenceId: null,
                sourceReferenceIds: [],
              }
            : {
                kind: "draft-ready",
                toolName: null,
                input: null,
                text: "Ich habe deine Aussage als prüfbaren Entwurf vorbereitet.",
                draftReferenceId: latestToolReference,
                sourceReferenceIds: [],
              };
        return Promise.resolve(
          new Response(
            JSON.stringify({ output_text: JSON.stringify(output) }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }),
    );
    const clinical = new PflegehelferService();
    const initialNotes = clinical.snapshot("u-nurse").notes.length;
    const gateway = new ModelGateway({
      PFH_AI_MODE: "hosted-test",
      PFH_DEMO_MODE: "true",
      PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
      PFH_ALLOW_EXTERNAL_AI: "true",
      PFH_LLM_API_KEY: syntheticCredential,
      PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
      PFH_LLM_MODEL: "fixture-agent",
    });
    const response = await new AssistantService(clinical, gateway).query(
      "u-nurse",
      {
        prompt,
        patientId: "p-luca",
        workingContext: {
          organizationId: "org-tertianum",
          sessionId: "session-test",
          threadId: "assistant:u-nurse:patient:p-luca:enc-luca-2026",
          contextRevision: 4,
          departmentId: "rehab-2",
          stationId: "rehabilitation-2",
          roleProfileId: "fage-efz",
          workflowId: "nursing-day",
          currentStepId: "patient-work",
          activeEpisodeTitle: "Morgenpflege",
          activeEpisodePatientId: "p-luca",
          resumableEpisodePatientId: null,
          recentPrompts: [],
          recentConversation: [],
          organizationLabel: "Kronenhof Demo",
          actorRole: "registered-nurse",
          dataClass: "synthetic-demo",
          workdayHandover: null,
        },
      },
    );

    expect(response.classification.intent).toBe("care-update");
    expect(response.runtime.agent).toMatchObject({
      status: "draft-ready",
      toolCalls: 1,
    });
    expect(response.runtime.agent?.trace).toContainEqual(
      expect.objectContaining({
        kind: "tool",
        tool: "prepare_clinical_draft",
        status: "ok",
      }),
    );
    const draft = response.components.find(
      (component) =>
        component.type === "DraftAction" && component.kind === "care-update",
    );
    expect(draft?.type).toBe("DraftAction");
    if (draft?.type !== "DraftAction")
      throw new Error("Expected one care-update review");
    expect(draft.preview).toContain(prompt);
    expect(seenFormats).toEqual([
      "pflegehelfer_agent_decision_v1",
      "pflegehelfer_agent_decision_v1",
    ]);
    expect(clinical.snapshot("u-nurse").notes).toHaveLength(initialNotes);
  });

  it.each([
    {
      toolName: "get_patient_summary",
      answer: "Luca ist heute schmerzfrei und hat sicher keine Allergien.",
      referencePrefix: "Patient/",
    },
    {
      toolName: "get_open_tasks",
      answer: "Luca hat 4 offene Aufgaben.",
      referencePrefix: "Task/search/",
    },
  ])(
    "withholds unsupported clinical prose even when it cites $referencePrefix",
    async ({ toolName, answer, referencePrefix }) => {
      let agentTurn = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          if (typeof init?.body !== "string")
            throw new Error("Expected a serialized model request");
          const body = JSON.parse(init.body) as Record<string, unknown>;
          const format = (
            body.text as { format?: { name?: string } } | undefined
          )?.format;
          if (format?.name === "assistant_intent_v1")
            return Promise.resolve(
              new Response(
                JSON.stringify({
                  output_text: JSON.stringify({ intent: "unknown" }),
                }),
                {
                  status: 200,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
          const serialized = JSON.stringify(body);
          const reference = serialized.match(
            new RegExp(`${referencePrefix.replaceAll("/", "\\/")}[^"\\\\]+`),
          )?.[0];
          const decision =
            agentTurn++ === 0
              ? {
                  kind: "tool-call",
                  toolName,
                  input: {},
                  text: null,
                  draftReferenceId: null,
                  sourceReferenceIds: [],
                }
              : {
                  kind: "answer",
                  toolName: null,
                  input: null,
                  text: answer,
                  draftReferenceId: null,
                  sourceReferenceIds: reference ? [reference] : [],
                };
          return Promise.resolve(
            new Response(
              JSON.stringify({ output_text: JSON.stringify(decision) }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }),
      );
      const gateway = new ModelGateway({
        PFH_AI_MODE: "hosted-test",
        PFH_DEMO_MODE: "true",
        PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
        PFH_ALLOW_EXTERNAL_AI: "true",
        PFH_LLM_API_KEY: syntheticCredential,
        PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
        PFH_LLM_MODEL: "fixture-agent",
      });
      const response = await new AssistantService(
        new PflegehelferService(),
        gateway,
      ).query("u-nurse", {
        prompt: "Was ist wichtig?",
        patientId: "p-luca",
        workingContext: {
          organizationId: "org-tertianum",
          sessionId: "session-test",
          threadId: "assistant:u-nurse:patient:p-luca:enc-luca-2026",
          contextRevision: 4,
          departmentId: "rehab-2",
          stationId: "rehabilitation-2",
          roleProfileId: "fage-efz",
          workflowId: "nursing-day",
          currentStepId: "patient-work",
          activeEpisodeTitle: "Morgenpflege",
          activeEpisodePatientId: "p-luca",
          resumableEpisodePatientId: null,
          recentPrompts: [],
          organizationLabel: "Kronenhof Demo",
          actorRole: "registered-nurse",
          dataClass: "synthetic-demo",
          workdayHandover: null,
        },
      });

      expect(JSON.stringify(response.components)).not.toContain(answer);
      expect(response.warnings.join(" ")).toContain(
        "widersprüchlicher Quellenbindung",
      );
    },
  );
});
