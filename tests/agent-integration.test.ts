import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import {
  AssistantService,
  verifyAssistantEvidenceDigest,
} from "../src/core/assistant-service.js";
import { runtimeSitePack } from "../src/core/runtime-instructions.js";
import { PflegehelferService } from "../src/core/service.js";
import { deterministicAssistantProposal } from "../src/ai/assistant-proposal.js";

afterEach(() => vi.unstubAllGlobals());

const syntheticCredential = ["synthetic", "test", "credential"].join("-");

const workingContext = (patientId: "p-luca" | null = "p-luca") => ({
  organizationId: "org-tertianum",
  sessionId: "session-test",
  threadId: patientId
    ? `assistant:u-nurse:patient:${patientId}:enc-luca-2026`
    : "assistant:u-nurse:general",
  contextRevision: 4,
  departmentId: "rehab-2",
  stationId: "rehabilitation-2",
  roleProfileId: "fage-efz",
  workflowId: "nursing-day",
  currentStepId: patientId ? "patient-work" : "work-plan",
  activeEpisodeTitle: patientId ? "Morgenpflege" : null,
  activeEpisodePatientId: patientId,
  resumableEpisodePatientId: null,
  recentPrompts: [],
  recentConversation: [],
  organizationLabel: "Kronenhof Demo",
  actorRole: "registered-nurse",
  dataClass: "synthetic-demo" as const,
  workdayHandover: null,
});

function fixtureGateway(
  decision: (
    turn: number,
    serializedRequest: string,
  ) => Record<string, unknown>,
): ModelGateway {
  let turn = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init?: RequestInit) => {
      if (typeof init?.body !== "string")
        throw new Error("Expected a serialized model request");
      const body = JSON.parse(init.body) as Record<string, unknown>;
      const format = (body.text as { format?: { name?: string } } | undefined)
        ?.format?.name;
      const output =
        format === "assistant_intent_v1"
          ? { intent: "unknown" }
          : decision(turn++, JSON.stringify(body));
      return Promise.resolve(
        new Response(JSON.stringify({ output_text: JSON.stringify(output) }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  return new ModelGateway({
    PFH_AI_MODE: "hosted-test",
    PFH_DEMO_MODE: "true",
    PFH_LLM_DATA_CLASSIFICATION: "synthetic-only",
    PFH_ALLOW_EXTERNAL_AI: "true",
    PFH_LLM_API_KEY: syntheticCredential,
    PFH_LLM_BASE_URL: "https://synthetic-model.example.invalid/v1",
    PFH_LLM_MODEL: "fixture-agent",
  });
}

function observationClaims(
  referenceId: string,
  index: number,
  observation: {
    label: string;
    value: number;
    secondaryValue: number | null;
    unit: string;
    effectiveAt: string;
  },
) {
  const base = `observations.${index}`;
  return [
    { referenceId, path: `${base}.label`, value: observation.label },
    { referenceId, path: `${base}.value`, value: observation.value },
    {
      referenceId,
      path: `${base}.secondaryValue`,
      value: observation.secondaryValue,
    },
    { referenceId, path: `${base}.unit`, value: observation.unit },
    {
      referenceId,
      path: `${base}.effectiveAt`,
      value: observation.effectiveAt,
    },
    { referenceId, path: `${base}.status`, value: "accepted" },
  ];
}

function lucaTaskClaims(referenceId: string) {
  return [
    {
      referenceId,
      path: "tasks.0.patientLabel",
      value: "207 · Luca Demo",
    },
    {
      referenceId,
      path: "tasks.0.title",
      value: "Mobilisation mit Rollator",
    },
    { referenceId, path: "tasks.0.state", value: "accepted" },
  ];
}

function evidenceHandle(request: string, toolName: string): string | undefined {
  return request.match(
    new RegExp(`EvidenceResult/${toolName}/[A-Za-z0-9-]+`),
  )?.[0];
}

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
        const serializedBody = JSON.stringify(body);
        const workflowHandle = evidenceHandle(
          serializedBody,
          "load_workflow_skill",
        );
        const handoverHandle = evidenceHandle(serializedBody, "get_handover");
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
            sourceReferenceIds:
              workflowHandle && handoverHandle
                ? [workflowHandle, handoverHandle]
                : [],
            evidenceClaims: [
              {
                referenceId: workflowHandle ?? "missing-workflow-handle",
                path: "id",
                value: "nursing-early",
              },
              {
                referenceId: handoverHandle ?? "missing-handover-handle",
                path: "openCount",
                value: 2,
              },
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
          id: "handover-test",
          version: 3,
          contentHash: "handover-content-digest",
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
    expect(lead.message).toBe("Offen: 2.");
    const facts = response.components[1];
    expect(facts?.type).toBe("ClinicalFacts");
    if (facts?.type !== "ClinicalFacts")
      throw new Error("Missing exact clinical facts");
    expect(facts.items).toContain("Offene Übergabepunkte: 2.");
    expect(facts.sourceLabel).toBe("2 autorisierte Quellen");
    expect(response.components).toHaveLength(2);
    expect(response.evidence.map(({ resourceId }) => resourceId)).toEqual([
      expect.stringMatching(/^RuntimeInstruction\/nursing-early\//),
      "WorkdayHandover/handover-test/_history/3",
    ]);
    expect(
      response.evidence.every(({ digest }) =>
        /^[a-f0-9]{64}$/.test(digest ?? ""),
      ),
    ).toBe(true);
    expect(response.evidence.flatMap(({ claims }) => claims ?? [])).toEqual(
      expect.arrayContaining([
        { path: "id", value: "nursing-early" },
        { path: "openCount", value: 2 },
      ]),
    );
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
    expect(JSON.stringify(bodies[1])).not.toContain(
      runtimeSitePack.instructions["nursing-early"]!.sha256,
    );
    expect(JSON.stringify(bodies[1])).not.toContain('"sourceVersion"');
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
    expect(JSON.stringify(bodies[3])).not.toContain("handover-test");
    expect(JSON.stringify(bodies[3])).not.toContain("handover-content-digest");
    expect(JSON.stringify(bodies[3])).not.toContain('"version":3');
    expect(JSON.stringify(bodies[3])).not.toContain('"sourceVersion"');
    expect(JSON.stringify(bodies)).not.toContain(syntheticCredential);
  });

  it("shows a harmless natural answer without an unnecessary tool call", async () => {
    const gateway = fixtureGateway(() => ({
      kind: "conversation",
      toolName: null,
      input: null,
      text: "Gern — was möchtest du als Nächstes ansehen?",
      draftReferenceId: null,
      sourceReferenceIds: [],
      evidenceClaims: [],
    }));
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Danke, hilfst du mir weiter?",
      patientId: null,
      workingContext: workingContext(null),
    });

    expect(response.runtime.agent).toMatchObject({
      status: "conversation",
      toolCalls: 0,
    });
    expect(response.components).toEqual([
      {
        type: "AssistantText",
        message: "Gern — was möchtest du als Nächstes ansehen?",
      },
    ]);
    expect(response.evidence).toEqual([]);
  });

  it("withholds source-free patient claims in the general conversation", async () => {
    const gateway = fixtureGateway(() => ({
      kind: "conversation",
      toolName: null,
      input: null,
      text: "Luca ist schmerzfrei und kann selbstständig gehen.",
      draftReferenceId: null,
      sourceReferenceIds: [],
      evidenceClaims: [],
    }));
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Wie geht es Luca?",
      patientId: null,
      workingContext: workingContext(null),
    });

    expect(response.components).toEqual([
      {
        type: "AssistantText",
        message: "Gern. Wobei soll ich dich unterstützen?",
      },
    ]);
    expect(JSON.stringify(response)).not.toContain("schmerzfrei");
    expect(JSON.stringify(response)).not.toContain("selbstständig gehen");
    expect(response.evidence).toEqual([]);
  });

  it("does not let model conversation revive an older deterministic route", async () => {
    const gateway = fixtureGateway(() => ({
      kind: "conversation",
      toolName: null,
      input: null,
      text: "Das Patientenprofil ist vollständig dokumentiert.",
      draftReferenceId: null,
      sourceReferenceIds: [],
      evidenceClaims: [],
    }));
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Zeig mir das Patientenprofil.",
      patientId: "p-luca",
      workingContext: workingContext(),
    });

    expect(response.classification.intent).toBe("unknown");
    expect(response.components).toEqual([
      {
        type: "AssistantText",
        message: "Gern. Wobei soll ich dich unterstützen?",
      },
    ]);
    expect(response.evidence).toEqual([]);
    expect(JSON.stringify(response)).not.toContain("vollständig dokumentiert");
    expect(JSON.stringify(response)).not.toContain("intentToken");
  });

  it("never displays unsupported source-free clinical prose or a factual clarification premise", async () => {
    const unsupported = fixtureGateway(() => ({
      kind: "conversation",
      toolName: null,
      input: null,
      text: "Luca ist schmerzfrei und kann selbstständig gehen.",
      draftReferenceId: null,
      sourceReferenceIds: [],
      evidenceClaims: [],
    }));
    const sourceFree = await new AssistantService(
      new PflegehelferService(),
      unsupported,
    ).query("u-nurse", {
      prompt: "Wie geht es Luca?",
      patientId: "p-luca",
      workingContext: workingContext(),
    });
    expect(JSON.stringify(sourceFree)).not.toContain("schmerzfrei");
    expect(JSON.stringify(sourceFree)).not.toContain("selbstständig gehen");

    const premise = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_patient_summary",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const reference = evidenceHandle(request, "get_patient_summary");
      return {
        kind: "clarification-needed",
        toolName: null,
        input: null,
        text: "Luca läuft selbstständig. Soll ich fortfahren?",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: [],
      };
    });
    const clarified = await new AssistantService(
      new PflegehelferService(),
      premise,
    ).query("u-nurse", {
      prompt: "Hilf mir beim Überblick.",
      patientId: "p-luca",
      workingContext: workingContext(),
    });
    expect(JSON.stringify(clarified)).not.toContain("läuft selbstständig");
    expect(clarified.components[0]).toEqual({
      type: "AssistantText",
      message:
        "Ich brauche noch eine kurze Präzisierung, bevor ich den passenden freigegebenen Kontext öffne.",
    });
  });

  it("shows one concise clarification after reading an authorized result", async () => {
    const gateway = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_patient_summary",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const reference = evidenceHandle(request, "get_patient_summary");
      return {
        kind: "clarification-needed",
        toolName: null,
        input: null,
        text: "Möchtest du die Risiken oder die Pflegeziele zuerst ansehen?",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: [],
      };
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Hilf mir beim Überblick.",
      patientId: "p-luca",
      workingContext: workingContext(),
    });

    expect(response.runtime.agent).toMatchObject({
      status: "clarification-needed",
      toolCalls: 1,
    });
    expect(response.components[0]).toEqual({
      type: "AssistantText",
      message: "Möchtest du die Risiken oder die Pflegeziele zuerst ansehen?",
    });
    expect(response.evidence[0]?.resourceId).toMatch(
      /^Patient\/p-luca\/_history\//,
    );
  });

  it("uses the injected operational delivery authority for degraded sync lookup", async () => {
    let reads = 0;
    const response = await new AssistantService(
      new PflegehelferService(),
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
      undefined,
      {
        getSyncStatus: () => {
          reads += 1;
          return Promise.resolve({
            referenceId: "OperationalDeliveryDiagnostics/version-test",
            sourceVersion: "version-test",
            freshness: "2026-09-14T10:00:00.000Z",
            complete: true,
            data: {
              acceptedCommands: { accepted: 2 },
              clinicalProjections: { delivered: 1, retry: 1 },
              providerDeliveries: { delivered: 1, manual: 1 },
            },
          });
        },
      },
    ).query("u-nurse", {
      prompt: "Wie ist der Synchronisationsstatus?",
      patientId: null,
      workingContext: workingContext(null),
    });
    expect(reads).toBe(1);
    expect(
      response.components.find(({ type }) => type === "SyncSummary"),
    ).toMatchObject({ pending: 2, conflicts: 1 });
    expect(response.evidence).toEqual([
      expect.objectContaining({
        resourceId: "OperationalDeliveryDiagnostics/version-test",
        sourceVersion: "version-test",
        complete: true,
      }),
    ]);
  });

  it("excludes stale-encounter work from the general task lens", async () => {
    const clinical = new PflegehelferService();
    const checkpoint = clinical.checkpoint();
    const source = checkpoint.state.tasks.find(
      ({ id }) => id === "t-mobilise-luca",
    )!;
    checkpoint.state.tasks.push({
      ...structuredClone(source),
      id: "t-stale-luca",
      encounterId: "enc-luca-old",
      title: "Alte Aufgabe aus früherem Aufenthalt",
    });
    clinical.restoreCheckpoint(checkpoint);
    const response = await new AssistantService(
      clinical,
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    ).query("u-nurse", {
      prompt: "Was ist noch offen?",
      patientId: null,
      workingContext: workingContext(null),
    });
    expect(JSON.stringify(response.components)).not.toContain(
      "Alte Aufgabe aus früherem Aufenthalt",
    );
  });

  it("allows a faithful task-state paraphrase with exact same-row claims", async () => {
    const gateway = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_open_tasks",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const reference = evidenceHandle(request, "get_open_tasks");
      expect(request).not.toContain("Task/t-mobilise-luca");
      return {
        kind: "answer",
        toolName: null,
        input: null,
        text: "Die Mobilisation mit Rollator steht noch aus.",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: reference ? lucaTaskClaims(reference) : [],
      };
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Was steht bei Luca an?",
      patientId: "p-luca",
      workingContext: workingContext(),
    });

    expect(response.components[0]).toEqual({
      type: "AssistantText",
      message: "Die Mobilisation mit Rollator steht noch aus.",
    });
    expect(response.components[1]).toMatchObject({
      type: "ClinicalFacts",
      items: ["207 · Luca Demo · Mobilisation mit Rollator: offen."],
    });
    expect(response.components).toHaveLength(2);
    expect(response.evidence).toHaveLength(1);
    expect(response.evidence[0]?.resourceId).toMatch(/^Task\/search\//);
    expect(response.evidence[0]?.complete).toBe(true);
    expect(response.evidence[0]?.rowProvenance?.[0]).toEqual(
      expect.objectContaining({
        path: "tasks.0",
        resourceId: "Task/t-mobilise-luca",
        version: "1",
      }),
    );
    expect(verifyAssistantEvidenceDigest(response.evidence[0]!)).toBe(true);
    const tampered = structuredClone(response.evidence[0]!);
    tampered.claims![0]!.value = "completed";
    expect(verifyAssistantEvidenceDigest(tampered)).toBe(false);
    const sourceTampered = structuredClone(response.evidence[0]!);
    sourceTampered.sourceDigest = "0".repeat(64);
    expect(verifyAssistantEvidenceDigest(sourceTampered)).toBe(false);
    const sourceRemoved = structuredClone(response.evidence[0]!);
    delete sourceRemoved.sourceDigest;
    expect(verifyAssistantEvidenceDigest(sourceRemoved)).toBe(false);
  });

  it("keeps multiple cited facts inspectable without requiring a rendered card", async () => {
    const gateway = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_patient_summary",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      if (turn === 1)
        return {
          kind: "tool-call",
          toolName: "get_open_tasks",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const patientReference = evidenceHandle(request, "get_patient_summary");
      const taskReference = evidenceHandle(request, "get_open_tasks");
      return {
        kind: "answer",
        toolName: null,
        input: null,
        text: "Für Luca Demo steht die Mobilisation mit Rollator noch aus.",
        draftReferenceId: null,
        sourceReferenceIds:
          patientReference && taskReference
            ? [patientReference, taskReference]
            : [],
        evidenceClaims:
          patientReference && taskReference
            ? [
                {
                  referenceId: patientReference,
                  path: "displayName",
                  value: "Luca Demo",
                },
                {
                  referenceId: taskReference,
                  path: "tasks.0.patientLabel",
                  value: "207 · Luca Demo",
                },
                {
                  referenceId: taskReference,
                  path: "tasks.0.title",
                  value: "Mobilisation mit Rollator",
                },
                {
                  referenceId: taskReference,
                  path: "tasks.0.state",
                  value: "accepted",
                },
              ]
            : [],
      };
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Sag mir kurz, was ich wissen muss.",
      patientId: "p-luca",
      workingContext: workingContext(),
    });

    expect(response.components).toHaveLength(2);
    expect(response.components[0]).toEqual({
      type: "AssistantText",
      message: "Für Luca Demo steht die Mobilisation mit Rollator noch aus.",
    });
    expect(response.components[1]).toMatchObject({
      type: "ClinicalFacts",
      sourceLabel: "2 autorisierte Quellen",
    });
    expect(response.evidence.map(({ resourceId }) => resourceId)).toEqual([
      expect.stringMatching(/^Patient\/p-luca\/_history\//),
      expect.stringMatching(/^Task\/search\//),
    ]);
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
    async ({ toolName, answer }) => {
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
          const reference = evidenceHandle(serialized, toolName);
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

  it("rejects a measurement value relabeled as a different clinical concept", async () => {
    const gateway = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_latest_vitals",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const reference = evidenceHandle(request, "get_latest_vitals");
      return {
        kind: "answer",
        toolName: null,
        input: null,
        text: "Blutdruck 37.4 °C.",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: reference
          ? [
              {
                referenceId: reference,
                path: "observations.0.label",
                value: "Temperatur",
              },
              {
                referenceId: reference,
                path: "observations.0.value",
                value: 37.4,
              },
              {
                referenceId: reference,
                path: "observations.0.secondaryValue",
                value: null,
              },
              {
                referenceId: reference,
                path: "observations.0.unit",
                value: "°C",
              },
              {
                referenceId: reference,
                path: "observations.0.effectiveAt",
                value: "2026-09-05T06:40:00.000Z",
              },
              {
                referenceId: reference,
                path: "observations.0.status",
                value: "accepted",
              },
            ]
          : [],
      };
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Welcher Wert wurde gemessen?",
      patientId: "p-luca",
      workingContext: workingContext(),
    });

    expect(JSON.stringify(response.components)).not.toContain("Blutdruck 37.4");
    expect(JSON.stringify(response.components)).toContain(
      "Temperatur: 37,4 °C",
    );
  });

  it("renders blood pressure, decimal commas, occurrence time and status as one verified atom", async () => {
    const gateway = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_latest_vitals",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const reference = evidenceHandle(request, "get_latest_vitals");
      return {
        kind: "answer",
        toolName: null,
        input: null,
        text: "Aktuell 168/96; die Temperatur ist 2026 Grad.",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: reference
          ? [
              {
                referenceId: reference,
                path: "observations.0.label",
                value: "Blutdruck",
              },
              {
                referenceId: reference,
                path: "observations.0.value",
                value: 168,
              },
              {
                referenceId: reference,
                path: "observations.0.secondaryValue",
                value: 96,
              },
              {
                referenceId: reference,
                path: "observations.0.unit",
                value: "mmHg",
              },
              {
                referenceId: reference,
                path: "observations.0.effectiveAt",
                value: "2026-09-05T06:55:00.000Z",
              },
              {
                referenceId: reference,
                path: "observations.0.status",
                value: "accepted",
              },
            ]
          : [],
      };
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Welcher Blutdruck wurde bei Anna gemessen?",
      patientId: "p-anna",
      workingContext: {
        ...workingContext(),
        threadId: "assistant:u-nurse:patient:p-anna:enc-anna-2026",
      },
    });
    const rendered = JSON.stringify(response.components);
    expect(rendered).toContain("Blutdruck: 168/96 mmHg");
    expect(rendered).toContain("gemessen am");
    expect(rendered).toContain("freigegeben");
    expect(rendered).not.toContain("Aktuell");
    expect(rendered).not.toContain("2026 Grad");
  });

  it("hydrates only the server-owned complete measurement table recipe", async () => {
    const gateway = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_latest_vitals",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const reference = evidenceHandle(request, "get_latest_vitals");
      return {
        kind: "answer",
        toolName: null,
        input: null,
        text: "Nur der Wert genügt.",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: reference
          ? observationClaims(reference, 0, {
              label: "Temperatur",
              value: 37.4,
              secondaryValue: null,
              unit: "°C",
              effectiveAt: "2026-09-05T06:40:00.000Z",
            })
          : [],
        presentation: reference
          ? {
              kind: "table",
              sourceReferenceId: reference,
              title: "Werte",
              collectionPath: "observations",
              columns: [{ path: "value", label: "Wert" }],
              xPath: null,
              yPath: null,
              labelPath: null,
            }
          : null,
      };
    });
    const response = await new AssistantService(
      new PflegehelferService(),
      gateway,
    ).query("u-nurse", {
      prompt: "Zeig den Messwert als Tabelle.",
      patientId: "p-luca",
      workingContext: workingContext(),
    });
    const table = response.components.find(
      (component) => component.type === "EvidenceTable",
    );
    expect(table).toMatchObject({
      columns: ["Messwert", "Wert", "Einheit", "Gemessen am", "Status"],
      rows: [
        ["Temperatur", "37,4", "°C", "2026-09-05T06:40:00.000Z", "freigegeben"],
      ],
    });
  });

  it("rejects non-temporal and mixed-unit model charts", async () => {
    const chartDecision = (
      request: string,
      claims: Array<Record<string, unknown>>,
      xPath = "label",
    ) => {
      const reference = evidenceHandle(request, "get_latest_vitals");
      return {
        kind: "answer",
        toolName: null,
        input: null,
        text: "Hier ist der Verlauf.",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: reference
          ? claims.map((claim) => ({ ...claim, referenceId: reference }))
          : [],
        presentation: reference
          ? {
              kind: "chart",
              sourceReferenceId: reference,
              title: "Verlauf",
              collectionPath: "observations",
              columns: [],
              xPath,
              yPath: "value",
              labelPath: "label",
            }
          : null,
      };
    };
    const baseClaims = observationClaims("placeholder", 0, {
      label: "Temperatur",
      value: 37.4,
      secondaryValue: null,
      unit: "°C",
      effectiveAt: "2026-09-05T06:40:00.000Z",
    });
    const maliciousGateway = fixtureGateway((turn, request) =>
      turn === 0
        ? {
            kind: "tool-call",
            toolName: "get_latest_vitals",
            input: {},
            text: null,
            draftReferenceId: null,
            sourceReferenceIds: [],
          }
        : chartDecision(request, baseClaims),
    );
    const malicious = await new AssistantService(
      new PflegehelferService(),
      maliciousGateway,
    ).query("u-nurse", {
      prompt: "Zeig einen Verlauf.",
      patientId: "p-luca",
      workingContext: workingContext(),
    });
    expect(
      malicious.components.some(({ type }) => type === "EvidenceChart"),
    ).toBe(false);

    const clinical = new PflegehelferService();
    const pulse = clinical.createObservationDraft("u-nurse", {
      patientId: "p-luca",
      encounterId: "enc-luca-2026",
      code: "pulse",
      value: 78,
      effectiveAt: "2026-09-05T07:00:00.000Z",
    });
    clinical.approve("u-nurse", "observation", pulse.id, {
      expectedVersion: pulse.version,
      patientMrn: "SH-260902-004",
      patientBirthDate: "1937-11-02",
      reviewedDiff: true,
    });
    const mixedClaims = [
      ...baseClaims,
      ...observationClaims("placeholder", 1, {
        label: "Puls",
        value: 78,
        secondaryValue: null,
        unit: "/min",
        effectiveAt: "2026-09-05T07:00:00.000Z",
      }),
    ];
    const mixedGateway = fixtureGateway((turn, request) =>
      turn === 0
        ? {
            kind: "tool-call",
            toolName: "get_latest_vitals",
            input: {},
            text: null,
            draftReferenceId: null,
            sourceReferenceIds: [],
          }
        : chartDecision(request, mixedClaims, "effectiveAt"),
    );
    const mixed = await new AssistantService(clinical, mixedGateway).query(
      "u-nurse",
      {
        prompt: "Zeig beide Werte als Verlauf.",
        patientId: "p-luca",
        workingContext: workingContext(),
      },
    );
    expect(mixed.components.some(({ type }) => type === "EvidenceChart")).toBe(
      false,
    );
  });

  it("rejects false completion and generated medication instructions without effects", async () => {
    const taskGateway = fixtureGateway((turn, request) => {
      if (turn === 0)
        return {
          kind: "tool-call",
          toolName: "get_open_tasks",
          input: {},
          text: null,
          draftReferenceId: null,
          sourceReferenceIds: [],
        };
      const reference = evidenceHandle(request, "get_open_tasks");
      return {
        kind: "answer",
        toolName: null,
        input: null,
        text: "Die Mobilisation mit Rollator ist bereits abgeschlossen.",
        draftReferenceId: null,
        sourceReferenceIds: reference ? [reference] : [],
        evidenceClaims: reference ? lucaTaskClaims(reference) : [],
      };
    });
    const clinical = new PflegehelferService();
    const before = clinical.snapshot("u-nurse");
    const falseCompletion = await new AssistantService(
      clinical,
      taskGateway,
    ).query("u-nurse", {
      prompt: "Ist die Aufgabe erledigt?",
      patientId: "p-luca",
      workingContext: workingContext(),
    });
    expect(JSON.stringify(falseCompletion.components)).not.toContain(
      "bereits abgeschlossen",
    );

    const instructionGateway = fixtureGateway(() => ({
      kind: "answer",
      toolName: null,
      input: null,
      text: "Gib das Insulin jetzt als Behandlung.",
      draftReferenceId: null,
      sourceReferenceIds: [],
      evidenceClaims: [],
    }));
    const unauthorized = await new AssistantService(
      clinical,
      instructionGateway,
    ).query("u-nurse", {
      prompt: "Was soll ich machen?",
      patientId: "p-luca",
      workingContext: workingContext(),
    });
    expect(JSON.stringify(unauthorized.components)).not.toContain(
      "Gib das Insulin",
    );
    const after = clinical.snapshot("u-nurse");
    expect({
      notes: after.notes,
      observations: after.observations,
      tasks: after.tasks,
      communications: after.communications,
    }).toEqual({
      notes: before.notes,
      observations: before.observations,
      tasks: before.tasks,
      communications: before.communications,
    });
  });
});
