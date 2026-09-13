import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { AuditChain } from "../src/core/audit.js";
import { users } from "../src/core/seed.js";
import { PflegehelferService } from "../src/core/service.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

describe.runIf(Boolean(databaseUrl))("atomic local command acceptance", () => {
  it("consumes authority, stores receipt/audit/projection and replays once", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspection = new Pool({ connectionString: databaseUrl });
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
      const record = {
        actorId: "u-assistant",
        actorRole: "care-assistant" as const,
        command: "care-update:draft" as const,
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        purpose: "direct-care" as const,
        resourceVersion: 4,
        payload: { plan: "{}" },
        expiresAt: Date.now() + 60_000,
      };
      await store.storeIntentAuthority({
        tokenHash,
        record,
        sessionId: session.id,
        threadId: session.threadId,
        contextRevision: session.contextRevision,
        responseId: randomUUID(),
        reviewItems: [{ id: "action-1", kind: "note" }],
      });
      const audit = new AuditChain();
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
        policyVersion: "test-policy-v1",
        sourceReadSet: [{ reference: "Patient/p-luca", version: 4 }],
        auditEntries: [auditEntry],
        clinicalResources: [],
        removedReferences: [],
        clinicalExpectedVersions: {},
        checkpoint: new PflegehelferService().checkpoint(),
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
      const accepted = await store.acceptIntentCommand(input);
      const replay = await store.acceptIntentCommand(input);
      expect(accepted.replayed).toBe(false);
      expect(replay).toMatchObject({
        id: accepted.id,
        payload: { accepted: true },
        replayed: true,
      });
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
      }>(
        `SELECT
           (SELECT count(*)::int FROM accepted_commands WHERE id=$1) accepted,
           (SELECT count(*)::int FROM command_receipts WHERE command_key=$2) receipts,
           (SELECT count(*)::int FROM audit_entries WHERE entry_hash=$3) audits,
           (SELECT count(*)::int FROM clinical_projection_outbox WHERE accepted_command_id=$1) projections,
           (SELECT count(*)::int FROM provider_outbox WHERE accepted_command_id=$1) "providerJobs"`,
        [accepted.id, commandKey, auditEntry.hash],
      );
      expect(counts.rows[0]).toEqual({
        accepted: 1,
        receipts: 1,
        audits: 1,
        projections: 1,
        providerJobs: 1,
      });
      await expect(
        store.claimProviderCommands({
          workerId: "too-early-provider",
          profile: "synthetic-simulator",
          limit: 1,
          leaseDurationMs: 30_000,
        }),
      ).resolves.toEqual([]);
      const leaseStart = new Date(Date.now() + 10_000);
      const abandonedProjection = await store.claimClinicalProjection({
        workerId: "crashed-clinical-worker",
        leaseDurationMs: 1_000,
        now: leaseStart,
      });
      await expect(
        store.claimClinicalProjection({
          workerId: "too-early-clinical-worker",
          leaseDurationMs: 1_000,
          now: new Date(leaseStart.getTime() + 500),
        }),
      ).resolves.toBeNull();
      const claimedProjection = await store.claimClinicalProjection({
        workerId: "recovered-clinical-worker",
        leaseDurationMs: 30_000,
        now: new Date(leaseStart.getTime() + 2_000),
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
