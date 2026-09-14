import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const commandHeaders = (user: string, clientContextId?: string) => ({
  "x-demo-user": user,
  "x-command-id": crypto.randomUUID(),
  ...(clientContextId
    ? { "x-pfh-client-context": clientContextId }
    : undefined),
});

describe.runIf(Boolean(databaseUrl))(
  "PostgreSQL natural coworker continuity",
  () => {
    // Regression: ISSUE-008 — an ordinary question revoked unrelated pending work
    // Found by /qa on 2026-09-13
    // Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-13.md
    it("keeps the durable proposal pending across a read-only question", async () => {
      const clientContextId = crypto.randomUUID();
      const store = new PostgresOperationalStore(databaseUrl!);
      await store.initialize();
      await store.resetDemoState();
      const app = buildApp(undefined, {
        demoMode: true,
        operationalStore: store,
        modelGateway: new ModelGateway({ PFH_AI_MODE: "deterministic" }),
      });
      try {
        await app.inject({
          method: "POST",
          url: "/api/v1/assistant/context",
          headers: commandHeaders("u-nurse", clientContextId),
          payload: { patientId: "p-anna" },
        });
        const drafted = await app.inject({
          method: "POST",
          url: "/api/v1/assistant/query",
          headers: commandHeaders("u-nurse", clientContextId),
          payload: {
            patientId: "p-anna",
            prompt: "Puls 82.",
            inputModality: "typed",
          },
        });
        const draftBody = drafted.json<{
          id: string;
          components: Array<{ type: string; intentToken?: string }>;
        }>();
        const token = draftBody.components.find(
          (component) => component.type === "DraftAction",
        )?.intentToken;
        expect(token).toBeTruthy();

        const question = await app.inject({
          method: "POST",
          url: "/api/v1/assistant/query",
          headers: commandHeaders("u-nurse", clientContextId),
          payload: {
            patientId: "p-anna",
            prompt: "Was ist noch offen?",
            inputModality: "typed",
          },
        });
        expect(question.statusCode).toBe(200);

        const context = await store.resolveAssistantContext(
          "u-nurse",
          "registered-nurse",
          clientContextId,
        );
        expect(context).not.toBeNull();
        await expect(
          store.loadIntentAuthority({
            tokenHash: createHash("sha256").update(token!).digest("hex"),
            actorId: "u-nurse",
            sessionId: context!.sessionId,
            threadId: context!.threadId,
            contextRevision: context!.contextRevision,
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
          }),
        ).resolves.toMatchObject({ command: "care-update:draft" });
        await expect(
          store.loadPendingIntentReview(
            "u-nurse",
            "p-anna",
            "enc-anna-2026",
            context!.threadId,
          ),
        ).resolves.toMatchObject({ responseId: draftBody.id });
      } finally {
        await app.close();
      }
    });

    it("restores a suspended patient proposal after leaving and returning", async () => {
      const clientContextId = crypto.randomUUID();
      const store = new PostgresOperationalStore(databaseUrl!);
      await store.initialize();
      await store.resetDemoState();
      const app = buildApp(undefined, {
        demoMode: true,
        operationalStore: store,
        modelGateway: new ModelGateway({ PFH_AI_MODE: "deterministic" }),
      });
      try {
        const switchTo = (patientId: string) =>
          app.inject({
            method: "POST",
            url: "/api/v1/assistant/context",
            headers: commandHeaders("u-nurse", clientContextId),
            payload: { patientId },
          });
        await switchTo("p-anna");
        const drafted = await app.inject({
          method: "POST",
          url: "/api/v1/assistant/query",
          headers: commandHeaders("u-nurse", clientContextId),
          payload: {
            patientId: "p-anna",
            prompt: "Puls 82.",
            inputModality: "typed",
          },
        });
        const originalToken = drafted
          .json<{
            components: Array<{ type: string; intentToken?: string }>;
          }>()
          .components.find(
            (component) => component.type === "DraftAction",
          )!.intentToken!;
        await switchTo("p-luca");
        await switchTo("p-anna");
        const restored = await app.inject({
          method: "POST",
          url: "/api/v1/assistant/pending-review",
          headers: commandHeaders("u-nurse", clientContextId),
          payload: {},
        });
        expect(restored.statusCode).toBe(200);
        const newToken = restored
          .json<{
            pending: {
              response: {
                components: Array<{ type: string; intentToken?: string }>;
              };
            };
          }>()
          .pending.response.components.find(
            (component) => component.type === "DraftAction",
          )!.intentToken!;
        expect(newToken).not.toBe(originalToken);
        const context = await store.resolveAssistantContext(
          "u-nurse",
          "registered-nurse",
          clientContextId,
        );
        expect(context).not.toBeNull();
        await expect(
          store.loadIntentAuthority({
            tokenHash: createHash("sha256").update(originalToken).digest("hex"),
            actorId: "u-nurse",
            sessionId: context!.sessionId,
            threadId: context!.threadId,
            contextRevision: context!.contextRevision,
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
          }),
        ).resolves.toBeNull();
        await expect(
          store.loadIntentAuthority({
            tokenHash: createHash("sha256").update(newToken).digest("hex"),
            actorId: "u-nurse",
            sessionId: context!.sessionId,
            threadId: context!.threadId,
            contextRevision: context!.contextRevision,
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
          }),
        ).resolves.toMatchObject({ command: "care-update:draft" });
      } finally {
        await app.close();
      }
    });

    it("accepts an assistant-requested interruption atomically with the one-use receipt", async () => {
      const clientContextId = crypto.randomUUID();
      const store = new PostgresOperationalStore(databaseUrl!);
      await store.initialize();
      await store.resetDemoState();
      const app = buildApp(undefined, {
        demoMode: true,
        operationalStore: store,
        modelGateway: new ModelGateway({ PFH_AI_MODE: "deterministic" }),
        runtime: {
          profile: "integrated-demo",
          demoMode: true,
          storageMode: "medplum",
          persistenceMode: "postgresql",
          providerMode: "external-simulator",
        },
      });
      try {
        let workdayResponse = await app.inject({
          method: "GET",
          url: "/api/v1/workday",
          headers: { "x-demo-user": "u-nurse" },
        });
        const handover = workdayResponse.json<{
          handover: { id: string; version: number; patientIds: string[] };
        }>().handover;
        for (const patientId of handover.patientIds)
          workdayResponse = await app.inject({
            method: "POST",
            url: "/api/v1/workday",
            headers: commandHeaders("u-nurse"),
            payload: {
              type: "acknowledge-handover",
              handoverId: handover.id,
              patientId,
              version: handover.version,
            },
          });
        expect(workdayResponse.statusCode).toBe(200);
        const started = await app.inject({
          method: "POST",
          url: "/api/v1/workday",
          headers: commandHeaders("u-nurse"),
          payload: {
            type: "start-episode",
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
            kind: "planned",
            title: "Morgenpflege",
          },
        });
        expect(started.statusCode).toBe(200);

        await app.inject({
          method: "POST",
          url: "/api/v1/assistant/context",
          headers: commandHeaders("u-nurse", clientContextId),
          payload: { patientId: "p-anna" },
        });
        const drafted = await app.inject({
          method: "POST",
          url: "/api/v1/assistant/query",
          headers: commandHeaders("u-nurse", clientContextId),
          payload: {
            patientId: "p-anna",
            prompt: "Anna pausieren, ich gehe zu Zimmer 207.",
            inputModality: "typed",
          },
        });
        expect(drafted.statusCode).toBe(200);
        const draft = drafted.json<{
          patientContext: {
            patientId: string;
            encounterId: string;
            resourceVersion: number;
          };
          components: Array<{
            type: string;
            intentToken?: string;
            reviewItems?: Array<{ id: string }>;
          }>;
        }>();
        const action = draft.components.find(
          (component) => component.type === "DraftAction",
        );
        expect(action?.reviewItems).toHaveLength(1);
        const commandId = crypto.randomUUID();
        const payload = {
          patientId: draft.patientContext.patientId,
          encounterId: draft.patientContext.encounterId,
          purpose: "direct-care",
          resourceVersion: draft.patientContext.resourceVersion,
          explicitlyConfirmed: true,
          reviewedActionIds: action!.reviewItems!.map(({ id }) => id),
        };
        const execute = () =>
          app.inject({
            method: "POST",
            url: `/api/v1/assistant/intents/${action!.intentToken}/execute`,
            headers: {
              "x-demo-user": "u-nurse",
              "x-command-id": commandId,
              "x-pfh-client-context": clientContextId,
            },
            payload,
          });
        const accepted = await execute();
        expect(accepted.statusCode).toBe(200);
        expect(accepted.json()).toEqual({
          workflowChanged: true,
          activePatientId: "p-luca",
        });
        const replay = await execute();
        expect(replay.statusCode).toBe(200);
        expect(replay.body).toBe(accepted.body);

        const workday = await store.getWorkday("u-nurse", "registered-nurse");
        expect(workday.activeEpisode).toMatchObject({
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
          kind: "spontaneous",
        });
        expect(workday.resumableEpisode).toMatchObject({
          patientId: "p-anna",
          state: "paused",
        });
        await expect(
          store.resolveAssistantContext(
            "u-nurse",
            "registered-nurse",
            clientContextId,
          ),
        ).resolves.toMatchObject({
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
        });
      } finally {
        await app.close();
      }
    });
  },
);
