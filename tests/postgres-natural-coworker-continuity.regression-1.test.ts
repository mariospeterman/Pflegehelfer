import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const commandHeaders = (user: string) => ({
  "x-demo-user": user,
  "x-command-id": crypto.randomUUID(),
});

describe.runIf(Boolean(databaseUrl))(
  "PostgreSQL natural coworker continuity",
  () => {
    // Regression: ISSUE-008 — an ordinary question revoked unrelated pending work
    // Found by /qa on 2026-09-13
    // Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-13.md
    it("keeps the durable proposal pending across a read-only question", async () => {
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
          headers: commandHeaders("u-nurse"),
          payload: { patientId: "p-anna" },
        });
        const drafted = await app.inject({
          method: "POST",
          url: "/api/v1/assistant/query",
          headers: commandHeaders("u-nurse"),
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
          headers: commandHeaders("u-nurse"),
          payload: {
            patientId: "p-anna",
            prompt: "Was ist noch offen?",
            inputModality: "typed",
          },
        });
        expect(question.statusCode).toBe(200);

        const session = await store.getOrStartSession(
          "u-nurse",
          "registered-nurse",
        );
        await expect(
          store.loadIntentAuthority({
            tokenHash: createHash("sha256").update(token!).digest("hex"),
            actorId: "u-nurse",
            sessionId: session.id,
            threadId: session.threadId,
            contextRevision: session.contextRevision,
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
          }),
        ).resolves.toMatchObject({ command: "care-update:draft" });
        await expect(
          store.loadPendingIntentReview(
            "u-nurse",
            "p-anna",
            "enc-anna-2026",
            session.threadId,
          ),
        ).resolves.toMatchObject({ responseId: draftBody.id });
      } finally {
        await app.close();
      }
    });

    it("restores a suspended patient proposal after leaving and returning", async () => {
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
            headers: commandHeaders("u-nurse"),
            payload: { patientId },
          });
        await switchTo("p-anna");
        const drafted = await app.inject({
          method: "POST",
          url: "/api/v1/assistant/query",
          headers: commandHeaders("u-nurse"),
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
          headers: commandHeaders("u-nurse"),
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
        const session = await store.getOrStartSession(
          "u-nurse",
          "registered-nurse",
        );
        await expect(
          store.loadIntentAuthority({
            tokenHash: createHash("sha256").update(originalToken).digest("hex"),
            actorId: "u-nurse",
            sessionId: session.id,
            threadId: session.threadId,
            contextRevision: session.contextRevision,
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
          }),
        ).resolves.toBeNull();
        await expect(
          store.loadIntentAuthority({
            tokenHash: createHash("sha256").update(newToken).digest("hex"),
            actorId: "u-nurse",
            sessionId: session.id,
            threadId: session.threadId,
            contextRevision: session.contextRevision,
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
          }),
        ).resolves.toMatchObject({ command: "care-update:draft" });
      } finally {
        await app.close();
      }
    });
  },
);
