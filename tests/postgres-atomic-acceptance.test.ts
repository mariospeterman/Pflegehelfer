import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { AuditChain } from "../src/core/audit.js";
import { users } from "../src/core/seed.js";
import { siteConfiguration } from "../src/core/site-config.js";
import { scenarioRunContentDigest } from "../src/core/demo-scenario.js";
import { fhirResourceId } from "../src/core/fhir-resource-set.js";
import { PflegehelferService } from "../src/core/service.js";
import { PostgresDemoScenarioStore } from "../src/infrastructure/demo-scenario-store.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";
import { sourceReadSetFixture } from "./source-read-set-fixture.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

describe.runIf(Boolean(databaseUrl))("atomic local command acceptance", () => {
  it("clears a conversation in the same transaction as its receipt", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const scenarios = new PostgresDemoScenarioStore(databaseUrl!);
    const inspection = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    try {
      await store.initialize();
      await store.resetDemoState();
      await inspection.query(
        `DELETE FROM demo_scenario_runs WHERE organization_id=$1`,
        [siteConfiguration.institutionId],
      );
      const scenario = await scenarios.initialize();
      const context = await store.bindAssistantContext(
        "u-assistant",
        "care-assistant",
        randomUUID(),
        "p-luca",
        "enc-luca-2026",
      );
      const makeInput = (key: string, expectedDigest: string) => {
        const resultPayload = { cleared: true, expiresAt: null };
        const requestHash = createHash("sha256").update(key).digest("hex");
        return {
          receipt: {
            key,
            requestHash,
            statusCode: 200,
            payload: JSON.stringify(resultPayload),
            authorization: {
              actorId: "u-assistant",
              actorRole: "care-assistant" as const,
              siteId: siteConfiguration.siteId,
              departmentId: siteConfiguration.department.id,
              route: "/api/v1/assistant/conversation/clear",
              purpose: "direct-care" as const,
              actions: ["patient:read" as const],
              patientId: "p-luca",
              encounterId: "enc-luca-2026",
              patientScopes: [
                { patientId: "p-luca", encounterId: "enc-luca-2026" },
              ],
              workdayAuthority: null,
            },
          },
          actorId: "u-assistant",
          actorRole: "care-assistant" as const,
          purpose: "direct-care" as const,
          policyVersion: "test-policy-v1",
          resultPayload,
          auditEntries: [],
          clinicalResources: [],
          removedReferences: [],
          clinicalExpectedVersions: {},
          demoScenarioState: scenario.state,
          demoScenarioWorkspace: scenario.workspace,
          demoScenarioExpectedDigest: expectedDigest,
          conversationClear: {
            actorId: "u-assistant",
            actorRole: "care-assistant" as const,
            context,
          },
          providerCommands: [],
        };
      };
      const rejected = makeInput(
        `conversation-clear-rejected-${randomUUID()}`,
        "0".repeat(64),
      );
      await expect(
        store.acceptApplicationCommand(rejected),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await expect(
        store.resolveAssistantContext(
          "u-assistant",
          "care-assistant",
          context.clientContextId,
        ),
      ).resolves.toMatchObject({
        threadId: context.threadId,
        contextRevision: context.contextRevision,
      });

      const input = makeInput(
        `conversation-clear-${randomUUID()}`,
        scenarioRunContentDigest(scenario),
      );
      const accepted = await store.acceptApplicationCommand(input);
      const cleared = await store.resolveAssistantContext(
        "u-assistant",
        "care-assistant",
        context.clientContextId,
      );
      expect(cleared?.threadId).not.toBe(context.threadId);
      expect(cleared?.contextRevision).toBe(context.contextRevision + 1);
      await expect(
        store.acceptApplicationCommand(input),
      ).resolves.toMatchObject({ id: accepted.id, replayed: true });
      await expect(
        store.resolveAssistantContext(
          "u-assistant",
          "care-assistant",
          context.clientContextId,
        ),
      ).resolves.toMatchObject({
        threadId: cleared?.threadId,
        contextRevision: cleared?.contextRevision,
      });
    } finally {
      await store.resetDemoState();
      await inspection.query(
        `DELETE FROM demo_scenario_runs WHERE organization_id=$1`,
        [siteConfiguration.institutionId],
      );
      await Promise.all([store.close(), scenarios.close(), inspection.end()]);
    }
  });

  it("rolls a workday mutation back with a failed application acceptance", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const scenarios = new PostgresDemoScenarioStore(databaseUrl!);
    const inspection = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    try {
      await store.initialize();
      await store.resetDemoState();
      await inspection.query(
        `DELETE FROM demo_scenario_runs WHERE organization_id=$1`,
        [siteConfiguration.institutionId],
      );
      const scenario = await scenarios.initialize();
      const before = await store.getWorkday("u-assistant", "care-assistant");
      const assistantContext = await store.bindAssistantContext(
        "u-assistant",
        "care-assistant",
        randomUUID(),
        "p-luca",
        "enc-luca-2026",
      );
      const command = {
        type: "start-episode" as const,
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        kind: "spontaneous" as const,
        title: "Atomarer Testbesuch",
      };
      const makeInput = (commandKey: string, expectedDigest: string) => {
        const requestHash = createHash("sha256")
          .update(commandKey)
          .digest("hex");
        const resultPayload = { ...before, providerState: "external-gated" };
        return {
          receipt: {
            key: commandKey,
            requestHash,
            statusCode: 200,
            payload: JSON.stringify(resultPayload),
            authorization: {
              actorId: "u-assistant",
              actorRole: "care-assistant" as const,
              siteId: siteConfiguration.siteId,
              departmentId: siteConfiguration.department.id,
              route: "/api/v1/workday",
              purpose: "direct-care" as const,
              actions: [
                "patient:read" as const,
                "task:update" as const,
                "note:approve" as const,
              ],
              patientId: "p-luca",
              encounterId: "enc-luca-2026",
              patientScopes: [
                { patientId: "p-luca", encounterId: "enc-luca-2026" },
              ],
              workdayAuthority: {
                sessionId: before.sessionId,
                handoverId: before.handover.id,
                handoverVersion: before.handover.version,
                handoverContentHash: before.handover.contentHash,
              },
            },
          },
          actorId: "u-assistant",
          actorRole: "care-assistant" as const,
          purpose: "direct-care" as const,
          policyVersion: "test-policy-v1",
          resultPayload,
          auditEntries: [],
          clinicalResources: [],
          removedReferences: [],
          clinicalExpectedVersions: {},
          demoScenarioState: scenario.state,
          demoScenarioWorkspace: scenario.workspace,
          demoScenarioExpectedDigest: expectedDigest,
          workdayCommand: {
            actorId: "u-assistant",
            actorRole: "care-assistant" as const,
            sessionId: before.sessionId,
            command,
          },
          voiceAuthority: {
            tokenHash: createHash("sha256")
              .update(`voice-${commandKey}`)
              .digest("hex"),
            record: {
              clientContextId: assistantContext.clientContextId,
              actorId: "u-assistant",
              patientId: "p-luca",
              encounterId: "enc-luca-2026",
              purpose: "direct-care" as const,
              original: {
                transcript: "Synthetischer atomarer Sprachbeleg",
                transcriptHash: createHash("sha256")
                  .update("Synthetischer atomarer Sprachbeleg")
                  .digest("hex"),
                capturedAt: new Date().toISOString(),
                source: {
                  kind: "asr" as const,
                  mode: "browser-demo" as const,
                  model: "synthetic-asr-v1",
                  language: "de",
                  confidence: null,
                  confidenceState: "unknown" as const,
                  audioRetained: false as const,
                },
              },
              sessionId: assistantContext.sessionId,
              threadId: assistantContext.threadId,
              contextRevision: assistantContext.contextRevision,
              expiresAt: Date.now() + 60_000,
            },
          },
          providerCommands: [
            {
              provider: "carecoach" as const,
              profile: "synthetic-simulator" as const,
              retrySafety: "idempotent-provider" as const,
              command: {
                commandId: randomUUID(),
                operation: "NursingNote.write" as const,
                patientReference: `Patient/${fhirResourceId("Patient", "p-luca")}`,
                encounterReference: `Encounter/${fhirResourceId("Encounter", "enc-luca-2026")}`,
                resource: {
                  resourceType: "DocumentReference" as const,
                  id: randomUUID(),
                  body: {
                    patientId: fhirResourceId("Patient", "p-luca"),
                    encounterId: fhirResourceId("Encounter", "enc-luca-2026"),
                    status: "final",
                    structuredText: "Synthetischer atomarer Workday-Beleg",
                  },
                },
                expectedProviderVersion: null,
                mappingVersion: "synthetic-v1",
                correlationId: randomUUID(),
                causationId: randomUUID(),
                idempotencyKey: randomUUID(),
                approvedAt: new Date().toISOString(),
              },
            },
          ],
        };
      };

      const rejectedKey = `workday-rollback-${randomUUID()}`;
      const rejectedInput = makeInput(rejectedKey, "0".repeat(64));
      await expect(
        store.acceptApplicationCommand(rejectedInput),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      await expect(
        store.loadVoiceAuthority(rejectedInput.voiceAuthority.tokenHash),
      ).resolves.toBeNull();
      expect(
        (await store.getWorkday("u-assistant", "care-assistant")).episodes,
      ).toHaveLength(0);
      const rejectedEvidence = await inspection.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM accepted_commands WHERE command_key=$1`,
        [rejectedKey],
      );
      expect(rejectedEvidence.rows[0]?.count).toBe(0);

      const acceptedKey = `workday-accepted-${randomUUID()}`;
      const input = makeInput(acceptedKey, scenarioRunContentDigest(scenario));
      const accepted = await store.acceptApplicationCommand(input);
      await expect(
        store.loadVoiceAuthority(input.voiceAuthority.tokenHash),
      ).resolves.toMatchObject({ actorId: "u-assistant" });
      const payload = JSON.parse(accepted.receipt.payload) as {
        activeEpisode: { patientId: string } | null;
      };
      expect(payload.activeEpisode?.patientId).toBe("p-luca");
      await expect(
        inspection.query(
          `UPDATE accepted_commands SET session_id=$2
           WHERE organization_id=$3 AND id=$1`,
          [accepted.id, randomUUID(), siteConfiguration.institutionId],
        ),
      ).rejects.toMatchObject({
        constraint: "accepted_commands_authority_shape",
      });
      await expect(
        store.acceptApplicationCommand(input),
      ).resolves.toMatchObject({ id: accepted.id, replayed: true });
      await expect(
        store.claimProviderCommands({
          workerId: "provider-only-acceptance",
          profile: "synthetic-simulator",
          limit: 1,
          leaseDurationMs: 30_000,
        }),
      ).resolves.toMatchObject([
        {
          acceptedCommandId: accepted.id,
          authorityEnvelope: {
            patientId: "p-luca",
            encounterId: "enc-luca-2026",
          },
        },
      ]);
      expect(
        (await store.getWorkday("u-assistant", "care-assistant")).episodes,
      ).toHaveLength(1);
    } finally {
      await store.resetDemoState();
      await inspection.query(
        `DELETE FROM demo_scenario_runs WHERE organization_id=$1`,
        [siteConfiguration.institutionId],
      );
      await Promise.all([store.close(), scenarios.close(), inspection.end()]);
    }
  });

  it("atomically accepts a typed application command and its clinical delta", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const scenarios = new PostgresDemoScenarioStore(databaseUrl!);
    const inspection = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    try {
      await store.initialize();
      await store.resetDemoState();
      await inspection.query(
        `DELETE FROM demo_scenario_runs WHERE organization_id=$1`,
        [siteConfiguration.institutionId],
      );
      const scenario = await scenarios.initialize();
      const patientResource = new PflegehelferService()
        .fhirResources()
        .find(
          (resource) =>
            resource.resourceType === "Patient" &&
            resource.id === fhirResourceId("Patient", "p-luca"),
        );
      if (!patientResource) throw new Error("patient resource missing");
      const commandKey = `application-command-${randomUUID()}`;
      const requestHash = createHash("sha256").update(commandKey).digest("hex");
      const resultPayload = { accepted: true };
      const acceptedScenarioState = structuredClone(scenario.state);
      acceptedScenarioState.tasks[0]!.title = "Atomic application command";
      const receipt = {
        key: commandKey,
        requestHash,
        statusCode: 200,
        payload: JSON.stringify(resultPayload),
        authorization: {
          actorId: "u-assistant",
          actorRole: "care-assistant" as const,
          siteId: siteConfiguration.siteId,
          departmentId: siteConfiguration.department.id,
          route: "/api/v1/tasks",
          purpose: "direct-care" as const,
          actions: ["task:create" as const],
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
          patientScopes: [
            { patientId: "p-luca", encounterId: "enc-luca-2026" },
          ],
          workdayAuthority: null,
        },
      };
      const input = {
        receipt,
        actorId: "u-assistant",
        actorRole: "care-assistant" as const,
        purpose: "direct-care" as const,
        policyVersion: "test-policy-v1",
        resultPayload,
        auditEntries: [],
        clinicalResources: [patientResource],
        removedReferences: [],
        clinicalExpectedVersions: {
          [`Patient/${patientResource.id}`]: null,
        },
        demoScenarioState: acceptedScenarioState,
        demoScenarioWorkspace: scenario.workspace,
        demoScenarioExpectedDigest: scenarioRunContentDigest(scenario),
        providerCommands: [],
      };
      const accepted = await store.acceptApplicationCommand(input);
      const replayed = await store.acceptApplicationCommand(input);
      expect(accepted.replayed).toBe(false);
      expect(replayed).toMatchObject({ id: accepted.id, replayed: true });
      await expect(
        store.loadApplicationCommandReceipt(commandKey, requestHash),
      ).resolves.toEqual(receipt);
      await expect(
        store.claimClinicalProjection({
          workerId: "application-command-worker",
          leaseDurationMs: 30_000,
        }),
      ).resolves.toMatchObject({ acceptedCommandId: accepted.id });
      const evidence = await inspection.query<{
        authorityKind: string;
        receipts: number;
        projections: number;
      }>(
        `SELECT authority_kind AS "authorityKind",
                (SELECT count(*)::int FROM command_receipts WHERE command_key=$2) receipts,
                (SELECT count(*)::int FROM clinical_projection_outbox
                  WHERE accepted_command_id=$1) projections
         FROM accepted_commands WHERE id=$1`,
        [accepted.id, commandKey],
      );
      expect(evidence.rows[0]).toEqual({
        authorityKind: "application-command",
        receipts: 1,
        projections: 1,
      });
      const staleKey = `application-command-${randomUUID()}`;
      await expect(
        store.acceptApplicationCommand({
          ...input,
          receipt: {
            ...receipt,
            key: staleKey,
            requestHash: createHash("sha256").update(staleKey).digest("hex"),
          },
        }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      const rolledBack = await inspection.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM accepted_commands WHERE command_key=$1`,
        [staleKey],
      );
      expect(rolledBack.rows[0]?.count).toBe(0);
    } finally {
      await store.resetDemoState();
      await inspection.query(
        `DELETE FROM demo_scenario_runs WHERE organization_id=$1`,
        [siteConfiguration.institutionId],
      );
      await Promise.all([store.close(), scenarios.close(), inspection.end()]);
    }
  });

  it("consumes authority, stores receipt/audit/projection and replays once", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspection = new Pool({
      connectionString: databaseUrl,
      options: "-c pfh.organization_id=org-demo",
    });
    try {
      await store.initialize();
      await store.resetDemoState();
      const session = await store.changePatientContext(
        "u-assistant",
        "care-assistant",
        "p-luca",
        "enc-luca-2026",
      );
      const token = randomUUID();
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const responseId = randomUUID();
      const sourceReadSet = sourceReadSetFixture({
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        version: 4,
      });
      const record = {
        actorId: "u-assistant",
        actorRole: "care-assistant" as const,
        command: "care-update:draft" as const,
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        purpose: "direct-care" as const,
        resourceVersion: 4,
        payload: { plan: "{}" },
        sourceReadSet,
        expiresAt: Date.now() + 60_000,
      };
      await store.appendConversationTurn("u-assistant", "care-assistant", {
        id: responseId,
        prompt: "Synthetischer Annahmetest",
        response: {},
        createdAt: new Date().toISOString(),
        inputModality: "typed",
        originPatientId: "p-luca",
        originEncounterId: "enc-luca-2026",
        originThreadId: session.threadId,
        originContextRevision: session.contextRevision,
      });
      await store.storeIntentAuthority({
        tokenHash,
        record,
        sessionId: session.id,
        threadId: session.threadId,
        contextRevision: session.contextRevision,
        responseId,
        reviewItems: [{ id: "action-1", kind: "note" }],
      });
      const audit = new AuditChain();
      audit.restore(await store.loadAuditEntries());
      const auditEntry = audit.append({
        actor: users.find((user) => user.id === "u-assistant")!,
        action: "assistant:intent-executed",
        patientId: "p-luca",
        purpose: "direct-care",
        outcome: "success",
      });
      const commandKey = `u-assistant:POST:/acceptance:${randomUUID()}`;
      const requestHash = createHash("sha256").update("request").digest("hex");
      const input = {
        tokenHash,
        actorId: "u-assistant",
        actorRole: "care-assistant" as const,
        purpose: "direct-care" as const,
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        sessionId: session.id,
        threadId: session.threadId,
        contextRevision: session.contextRevision,
        resourceVersion: 4,
        commandKey,
        requestHash,
        statusCode: 200,
        resultPayload: { accepted: true },
        selectedActionIds: ["action-1"],
        authorizationActions: ["patient:read", "note:draft"] as [
          "patient:read",
          "note:draft",
        ],
        policyVersion: "test-policy-v1",
        sourceReadSet,
        auditEntries: [auditEntry],
        clinicalResources: [],
        removedReferences: [],
        clinicalExpectedVersions: {},
        providerCommands: [
          {
            provider: "device-gateway" as const,
            profile: "synthetic-simulator" as const,
            retrySafety: "idempotent-provider" as const,
            command: {
              commandId: randomUUID(),
              operation: "Observation.write" as const,
              patientReference: "Patient/p-luca",
              encounterReference: "Encounter/enc-luca-2026",
              resource: {
                resourceType: "Observation" as const,
                id: randomUUID(),
                body: {
                  patientId: "p-luca",
                  encounterId: "enc-luca-2026",
                  valueQuantity: { value: 150, code: "mL" },
                },
              },
              expectedProviderVersion: null,
              mappingVersion: "synthetic-v1",
              correlationId: randomUUID(),
              causationId: randomUUID(),
              idempotencyKey: `atomic-provider-${randomUUID()}`,
              approvedAt: new Date().toISOString(),
            },
          },
        ],
      };
      await expect(
        store.acceptIntentCommand({
          ...input,
          sourceReadSet: sourceReadSetFixture({
            patientId: "p-luca",
            encounterId: "enc-luca-2026",
            version: 5,
          }),
        }),
      ).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
      const accepted = await store.acceptIntentCommand(input);
      const replay = await store.acceptIntentCommand(input);
      expect(accepted.replayed).toBe(false);
      expect(replay).toMatchObject({
        id: accepted.id,
        payload: { accepted: true },
        replayed: true,
      });
      const persistedReadSet = await inspection.query<{
        proposal_digest: string;
        authority_digest: string;
        accepted_digest: string;
      }>(
        `SELECT p.source_read_set_digest AS proposal_digest,
                a.source_read_set_digest AS authority_digest,
                c.source_read_set->>'digest' AS accepted_digest
         FROM assistant_proposal_revisions p
         JOIN safety_authority a
           ON a.organization_id=p.organization_id AND a.proposal_revision_id=p.id
         JOIN accepted_commands c
           ON c.organization_id=p.organization_id AND c.proposal_revision_id=p.id
         WHERE p.organization_id='org-demo' AND p.source_response_id=$1`,
        [responseId],
      );
      expect(persistedReadSet.rows).toEqual([
        {
          proposal_digest: sourceReadSet.digest,
          authority_digest: sourceReadSet.digest,
          accepted_digest: sourceReadSet.digest,
        },
      ]);
      await expect(
        store.loadConversation("u-assistant", "care-assistant", "p-luca"),
      ).resolves.toMatchObject([
        {
          id: responseId,
          executionStatus: "locally-accepted",
          proposalLifecycle: { revision: 1, status: "consumed" },
        },
      ]);
      await store.supersedeIntentAuthority(tokenHash);
      await expect(
        store.loadConversation("u-assistant", "care-assistant", "p-luca"),
      ).resolves.toMatchObject([
        {
          id: responseId,
          executionStatus: "locally-accepted",
          proposalLifecycle: { revision: 1, status: "consumed" },
        },
      ]);
      await expect(
        store.loadIntentAuthority({
          tokenHash,
          actorId: record.actorId,
          sessionId: session.id,
          threadId: session.threadId,
          contextRevision: session.contextRevision,
          patientId: record.patientId,
          encounterId: record.encounterId,
        }),
      ).resolves.toBeNull();
      const counts = await inspection.query<{
        accepted: number;
        receipts: number;
        audits: number;
        projections: number;
        providerJobs: number;
        projectionSchema: number;
        projectionContainsCheckpoint: boolean;
        projectionSite: string;
      }>(
        `SELECT
           (SELECT count(*)::int FROM accepted_commands WHERE id=$1) accepted,
           (SELECT count(*)::int FROM command_receipts WHERE command_key=$2) receipts,
           (SELECT count(*)::int FROM audit_entries WHERE entry_hash=$3) audits,
           (SELECT count(*)::int FROM clinical_projection_outbox WHERE accepted_command_id=$1) projections,
           (SELECT count(*)::int FROM provider_outbox WHERE accepted_command_id=$1) "providerJobs",
           (SELECT payload_schema_version::int FROM clinical_projection_outbox
             WHERE accepted_command_id=$1) "projectionSchema",
           (SELECT payload ? 'checkpoint' FROM clinical_projection_outbox
             WHERE accepted_command_id=$1) "projectionContainsCheckpoint",
           (SELECT site_id FROM clinical_projection_outbox
             WHERE accepted_command_id=$1) "projectionSite"`,
        [accepted.id, commandKey, auditEntry.hash],
      );
      expect(counts.rows[0]).toEqual({
        accepted: 1,
        receipts: 1,
        audits: 1,
        projections: 1,
        providerJobs: 1,
        projectionSchema: 2,
        projectionContainsCheckpoint: false,
        projectionSite: siteConfiguration.siteId,
      });
      const restartedStore = new PostgresOperationalStore(databaseUrl!);
      try {
        await restartedStore.initialize();
        const restoredAudit = new AuditChain();
        restoredAudit.restore(await restartedStore.loadAuditEntries());
        expect(restoredAudit.snapshot().at(-1)?.hash).toBe(auditEntry.hash);
      } finally {
        await restartedStore.close();
      }
      await expect(
        store.claimProviderCommands({
          workerId: "too-early-provider",
          profile: "synthetic-simulator",
          limit: 1,
          leaseDurationMs: 30_000,
        }),
      ).resolves.toEqual([]);
      const abandonedProjection = await store.claimClinicalProjection({
        workerId: "crashed-clinical-worker",
        leaseDurationMs: 1_000,
      });
      await expect(
        store.claimClinicalProjection({
          workerId: "too-early-clinical-worker",
          leaseDurationMs: 1_000,
        }),
      ).resolves.toBeNull();
      await inspection.query(
        `UPDATE clinical_projection_outbox
         SET lease_expires_at=clock_timestamp()-interval '1 second'
         WHERE id=$1`,
        [abandonedProjection!.id],
      );
      const claimedProjection = await store.claimClinicalProjection({
        workerId: "recovered-clinical-worker",
        leaseDurationMs: 30_000,
      });
      expect(claimedProjection?.id).toBe(abandonedProjection?.id);
      expect(claimedProjection?.attempts).toBe(2);
      expect(claimedProjection?.acceptedCommandId).toBe(accepted.id);
      await store.finishClinicalProjection({
        jobId: claimedProjection!.id,
        workerId: "recovered-clinical-worker",
      });
      const [providerJob] = await store.claimProviderCommands({
        workerId: "manual-provider-worker",
        profile: "synthetic-simulator",
        limit: 1,
        leaseDurationMs: 30_000,
      });
      expect(providerJob?.acceptedCommandId).toBe(accepted.id);
      await store.failProviderDelivery({
        jobId: providerJob!.id,
        workerId: "manual-provider-worker",
        errorCode: "TEST_READBACK_MISMATCH",
        errorClassification: "version-conflict",
        retryAt: null,
      });
      await expect(
        inspection.query<{ state: string }>(
          `SELECT state FROM accepted_commands WHERE id=$1`,
          [accepted.id],
        ),
      ).resolves.toMatchObject({ rows: [{ state: "manual-review" }] });
      await expect(
        store.loadAcceptedCommandReceipt(
          commandKey,
          createHash("sha256").update("different").digest("hex"),
        ),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    } finally {
      await store.resetDemoState();
      await inspection.end();
      await store.close();
    }
  });
});
