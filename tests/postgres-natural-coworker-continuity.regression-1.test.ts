import { createHash } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;
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
      const inspection = new Pool({ connectionString: databaseUrl });
      const triggerSuffix = crypto.randomUUID().replaceAll("-", "");
      const triggerName = `pfh_test_rebind_${triggerSuffix}`;
      const functionName = `${triggerName}_fn`;
      let triggerInstalled = false;
      await store.initialize();
      await store.resetDemoState();
      const app = buildApp(undefined, {
        demoMode: true,
        operationalStore: store,
        modelGateway: new ModelGateway({ PFH_AI_MODE: "deterministic" }),
        // This targets the integrated acceptance transaction. Clinical
        // resource payloads remain a synthetic in-process projection fixture;
        // separate live-Medplum tests prove the external transaction/read-back.
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
        const annaEpisodeId = started.json<{
          activeEpisode: { id: string };
        }>().activeEpisode.id;
        const originalDraft =
          "Anna: Morgenpflege begonnen; Mobilisation noch nicht erfolgt.";
        const savedDraft = await app.inject({
          method: "POST",
          url: "/api/v1/workday",
          headers: commandHeaders("u-nurse"),
          payload: {
            type: "save-episode-draft",
            episodeId: annaEpisodeId,
            draftText: originalDraft,
          },
        });
        expect(savedDraft.statusCode).toBe(200);

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
        const contextBeforeFailure = await store.resolveAssistantContext(
          "u-nurse",
          "registered-nurse",
          clientContextId,
        );
        expect(contextBeforeFailure).not.toBeNull();
        const countsBeforeFailure = await inspection.query(
          `SELECT
             (SELECT count(*)::int FROM accepted_commands) accepted,
             (SELECT count(*)::int FROM command_receipts) receipts,
             (SELECT count(*)::int FROM clinical_projection_outbox) projections,
             (SELECT count(*)::int FROM provider_outbox) provider_jobs,
             (SELECT count(*)::int FROM audit_entries) audit,
             (SELECT count(*)::int FROM domain_events) events`,
        );
        const proposalBeforeFailure = await inspection.query(
          `SELECT p.id,p.revision,p.status,p.proposal_hash,p.payload,p.review_items,p.consumed_at
           FROM assistant_proposal_revisions p
           JOIN safety_authority a
             ON a.organization_id=p.organization_id
            AND a.proposal_revision_id=p.id
           WHERE a.token_hash=$1`,
          [createHash("sha256").update(action!.intentToken!).digest("hex")],
        );
        const workdayRowsBeforeFailure = await inspection.query(
          `SELECT * FROM (
           SELECT 'session' kind,to_jsonb(s.*) body
             FROM working_sessions s WHERE id=$1
           UNION ALL
           SELECT 'episode',to_jsonb(e.*) FROM work_episodes e
             WHERE session_id=$1
           UNION ALL
           SELECT 'segment',to_jsonb(g.*) FROM work_episode_segments g
             JOIN work_episodes e ON e.organization_id=g.organization_id AND e.id=g.episode_id
             WHERE e.session_id=$1
           ) rows ORDER BY kind,body::text`,
          [contextBeforeFailure!.sessionId],
        );
        await inspection.query(
          `CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN
             IF OLD.id = '${clientContextId}'::uuid THEN
               -- The request can fail with this trigger only after both
               -- workday mutations are visible inside the same transaction.
               -- If ordering regresses, return normally so the HTTP 500
               -- assertion below fails instead of accepting an ambiguous error.
               IF EXISTS (
                 SELECT 1 FROM work_episodes
                 WHERE id='${annaEpisodeId}'::uuid
                   AND state='paused' AND draft_text='${originalDraft.replaceAll("'", "''")}'
               ) AND EXISTS (
                 SELECT 1 FROM work_episodes
                 WHERE session_id=OLD.session_id AND patient_id='p-luca'
                   AND kind='spontaneous' AND state='active'
               ) THEN
                 RAISE EXCEPTION 'PFH_TEST_REBIND_FAILURE_AFTER_PAUSE';
               END IF;
             END IF;
             RETURN NEW;
           END $$`,
        );
        await inspection.query(
          `CREATE TRIGGER ${triggerName}
           BEFORE UPDATE OF thread_id ON assistant_client_contexts
           FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
        );
        triggerInstalled = true;

        const interrupted = await execute();
        expect(interrupted.statusCode).toBe(500);
        const rolledBackWorkday = await store.getWorkday(
          "u-nurse",
          "registered-nurse",
        );
        expect(rolledBackWorkday.activeEpisode).toMatchObject({
          id: annaEpisodeId,
          patientId: "p-anna",
          state: "active",
          draftText: originalDraft,
        });
        expect(rolledBackWorkday.resumableEpisode).toBeNull();
        await expect(
          store.resolveAssistantContext(
            "u-nurse",
            "registered-nurse",
            clientContextId,
          ),
        ).resolves.toEqual(contextBeforeFailure);
        await expect(
          store.loadIntentAuthority({
            tokenHash: createHash("sha256")
              .update(action!.intentToken!)
              .digest("hex"),
            actorId: "u-nurse",
            sessionId: contextBeforeFailure!.sessionId,
            threadId: contextBeforeFailure!.threadId,
            contextRevision: contextBeforeFailure!.contextRevision,
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
            clientContextId,
          }),
        ).resolves.toMatchObject({ command: "care-update:draft" });
        const countsAfterFailure = await inspection.query(
          `SELECT
             (SELECT count(*)::int FROM accepted_commands) accepted,
             (SELECT count(*)::int FROM command_receipts) receipts,
             (SELECT count(*)::int FROM clinical_projection_outbox) projections,
             (SELECT count(*)::int FROM provider_outbox) provider_jobs,
             (SELECT count(*)::int FROM audit_entries) audit,
             (SELECT count(*)::int FROM domain_events) events`,
        );
        expect(countsAfterFailure.rows).toEqual(countsBeforeFailure.rows);
        const proposalAfterFailure = await inspection.query(
          `SELECT p.id,p.revision,p.status,p.proposal_hash,p.payload,p.review_items,p.consumed_at
           FROM assistant_proposal_revisions p
           JOIN safety_authority a
             ON a.organization_id=p.organization_id
            AND a.proposal_revision_id=p.id
           WHERE a.token_hash=$1`,
          [createHash("sha256").update(action!.intentToken!).digest("hex")],
        );
        expect(proposalAfterFailure.rows).toEqual(proposalBeforeFailure.rows);
        const workdayRowsAfterFailure = await inspection.query(
          `SELECT * FROM (
           SELECT 'session' kind,to_jsonb(s.*) body
             FROM working_sessions s WHERE id=$1
           UNION ALL
           SELECT 'episode',to_jsonb(e.*) FROM work_episodes e
             WHERE session_id=$1
           UNION ALL
           SELECT 'segment',to_jsonb(g.*) FROM work_episode_segments g
             JOIN work_episodes e ON e.organization_id=g.organization_id AND e.id=g.episode_id
             WHERE e.session_id=$1
           ) rows ORDER BY kind,body::text`,
          [contextBeforeFailure!.sessionId],
        );
        expect(workdayRowsAfterFailure.rows).toEqual(
          workdayRowsBeforeFailure.rows,
        );
        await inspection.query(
          `DROP TRIGGER ${triggerName} ON assistant_client_contexts`,
        );
        await inspection.query(`DROP FUNCTION ${functionName}()`);
        triggerInstalled = false;

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
          draftText: originalDraft,
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
        if (triggerInstalled) {
          await inspection.query(
            `DROP TRIGGER IF EXISTS ${triggerName} ON assistant_client_contexts`,
          );
          await inspection.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
        }
        await inspection.end();
        await app.close();
      }
    });
  },
);
