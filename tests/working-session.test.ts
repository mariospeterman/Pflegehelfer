import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  workflowDefinitionSchema,
  workflowForRole,
} from "../src/core/workflows.js";
import {
  nursingPatientIds,
  siteConfigurationSchema,
} from "../src/core/site-config.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("versioned working session", () => {
  it("starts one role workflow and keeps explicit context across reads", async () => {
    const store = new InMemoryOperationalStore();
    const first = await store.getOrStartSession("u-nurse", "registered-nurse");
    expect(first.workflowTemplateId).toBe("nursing-day");
    expect(first.definition.steps).toHaveLength(10);
    expect(first.currentStepId).toBe("handover");
    expect(first.patientId).toBeNull();

    const changed = await store.changePatientContext(
      "u-nurse",
      "registered-nurse",
      "p-anna",
      "enc-anna-2026",
    );
    const resumed = await store.getOrStartSession(
      "u-nurse",
      "registered-nurse",
    );
    expect(resumed.id).toBe(first.id);
    expect(resumed.workflowVersion).toBe(first.workflowVersion);
    expect(resumed.patientId).toBe("p-anna");
    expect(resumed.contextRevision).toBe(changed.contextRevision);
    expect(resumed.contextRevision).toBe(1);
  });

  it("keeps model conversation recall inside the current patient context", async () => {
    const store = new InMemoryOperationalStore();
    const turn = (id: string, patientId: string | null, prompt: string) => ({
      id,
      prompt,
      response: { patientContext: patientId ? { patientId } : null },
      createdAt: new Date().toISOString(),
      inputModality: "typed" as const,
    });
    await store.changePatientContext(
      "u-nurse",
      "registered-nurse",
      "p-anna",
      "enc-anna-2026",
    );
    await store.appendConversationTurn(
      "u-nurse",
      "registered-nurse",
      turn("anna", "p-anna", "Anna wurde mobilisiert."),
    );
    await store.changePatientContext(
      "u-nurse",
      "registered-nurse",
      "p-luca",
      "enc-luca-2026",
    );
    await store.appendConversationTurn(
      "u-nurse",
      "registered-nurse",
      turn("luca", "p-luca", "Luca hat 200 ml getrunken."),
    );
    await store.changePatientContext("u-nurse", "registered-nurse", null);
    await store.appendConversationTurn(
      "u-nurse",
      "registered-nurse",
      turn("general", null, "Was ist heute wichtig?"),
    );

    await store.changePatientContext(
      "u-nurse",
      "registered-nurse",
      "p-luca",
      "enc-luca-2026",
    );
    await expect(
      store.loadConversation("u-nurse", "registered-nurse", "p-luca"),
    ).resolves.toMatchObject([{ id: "luca" }]);
    await store.changePatientContext("u-nurse", "registered-nurse", null);
    await expect(
      store.loadConversation("u-nurse", "registered-nurse", null),
    ).resolves.toMatchObject([{ id: "general" }]);
    await expect(
      store.loadConversation("u-nurse", "registered-nurse"),
    ).resolves.toMatchObject([{ id: "general" }]);

    const conversations = await store.listConversations(
      "u-nurse",
      "registered-nurse",
    );
    expect(conversations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "general-assistant",
          patientId: null,
          active: true,
        }),
        expect.objectContaining({
          type: "patient-assistant",
          patientId: "p-anna",
          active: false,
        }),
        expect.objectContaining({
          type: "patient-assistant",
          patientId: "p-luca",
          active: false,
        }),
      ]),
    );
  });

  it("rejects duplicate steps, executable fields and a missing completion", () => {
    expect(
      workflowDefinitionSchema.safeParse({
        schemaVersion: 1,
        steps: [
          { id: "same", kind: "orientation", title: "A", prompt: "A" },
          { id: "same", kind: "completion", title: "B", prompt: "B" },
        ],
      }).success,
    ).toBe(false);
    expect(
      workflowDefinitionSchema.safeParse({
        schemaVersion: 1,
        steps: [
          {
            id: "start",
            kind: "orientation",
            title: "A",
            prompt: "A",
            javascript: "fetch('https://example.invalid')",
          },
          { id: "work", kind: "work-queue", title: "B", prompt: "B" },
        ],
      }).success,
    ).toBe(false);
    expect(workflowForRole("physician").definition.steps[0]?.id).toBe(
      "questions",
    );
  });

  it("loads six assignments and rejects executable configuration fields", () => {
    expect(nursingPatientIds).toHaveLength(6);
    expect(new Set(nursingPatientIds).size).toBe(6);
    expect(
      siteConfigurationSchema.safeParse({
        schemaVersion: 1,
        institutionId: "demo",
        siteId: "ward",
        displayName: "Demo",
        roleProfiles: {},
        workflows: {},
        nursingAssignments: [],
        javascript: "grantAll()",
      }).success,
    ).toBe(false);
  });

  it("exposes server-persisted context and real transport frames", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const headers = {
      "x-demo-user": "u-nurse",
      "x-command-id": crypto.randomUUID(),
    };
    const session = await app.inject({
      method: "GET",
      url: "/api/v1/working-session",
      headers,
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({
      workflowTemplateId: "nursing-day",
      patientId: null,
      contextRevision: 0,
    });
    const context = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers,
      payload: { patientId: "p-anna" },
    });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({
      patientId: "p-anna",
      contextRevision: 1,
    });
    const streamed = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query/stream",
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        patientId: "p-anna",
        prompt: "Letzte Vitalwerte",
        inputModality: "typed",
      },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers["content-type"]).toContain("application/x-ndjson");
    const frames = streamed.body
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; response?: unknown });
    expect(frames[0]).toMatchObject({
      type: "start",
      response: { components: [], openUi: "" },
    });
    expect(frames.some((frame) => frame.type === "openui")).toBe(true);
    expect(frames.at(-1)?.type).toBe("complete");

    const restored = await app.inject({
      method: "GET",
      url: "/api/v1/assistant/conversation",
      headers,
    });
    const restoredBody: unknown = restored.json();
    expect(restoredBody).toMatchObject({ turns: [expect.any(Object)] });
  });

  it("rejects an intent after the durable patient context changes", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const headers = {
      "x-demo-user": "u-nurse",
      "x-command-id": crypto.randomUUID(),
    };
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers,
      payload: { patientId: "p-anna" },
    });
    const query = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        patientId: "p-anna",
        prompt: "Notiz: Mobilisation sicher durchgeführt.",
        inputModality: "typed",
      },
    });
    const proposal = z
      .object({
        patientContext: z.object({
          patientId: z.string(),
          encounterId: z.string(),
          resourceVersion: z.number(),
        }),
        components: z.array(
          z.object({ type: z.string(), intentToken: z.string().optional() }),
        ),
      })
      .parse(JSON.parse(query.body) as unknown);
    const token = proposal.components.find(
      (component) => component.type === "DraftAction",
    )?.intentToken;
    expect(token).toBeTruthy();
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: { patientId: "p-luca" },
    });
    const execution = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${token}/execute`,
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        ...proposal.patientContext,
        purpose: "direct-care",
        explicitlyConfirmed: true,
      },
    });
    expect(execution.statusCode).toBe(403);
  });
});
