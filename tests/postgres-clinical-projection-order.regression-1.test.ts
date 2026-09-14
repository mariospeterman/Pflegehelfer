import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { AuditChain } from "../src/core/audit.js";
import { PflegehelferService } from "../src/core/service.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

async function acceptSyntheticCommand(
  store: PostgresOperationalStore,
  sequence: number,
) {
  const token = randomUUID();
  const clientContextId = randomUUID();
  const context = await store.bindAssistantContext(
    "u-assistant",
    "care-assistant",
    clientContextId,
    "p-luca",
    "enc-luca-2026",
  );
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await store.storeIntentAuthority({
    tokenHash,
    record: {
      actorId: "u-assistant",
      actorRole: "care-assistant",
      command: "note:draft",
      patientId: "p-luca",
      encounterId: "enc-luca-2026",
      purpose: "direct-care",
      resourceVersion: 4,
      payload: {
        transcript: `Synthetische Notiz ${sequence}`,
        structuredText: `Synthetische Notiz ${sequence}`,
      },
      expiresAt: Date.now() + 60_000,
    },
    sessionId: context.sessionId,
    threadId: context.threadId,
    contextRevision: context.contextRevision,
    responseId: randomUUID(),
    reviewItems: [{ id: "action-1", kind: "note" }],
    clientContextId,
  });
  return store.acceptIntentCommand({
    tokenHash,
    clientContextId,
    actorId: "u-assistant",
    actorRole: "care-assistant",
    purpose: "direct-care",
    patientId: "p-luca",
    encounterId: "enc-luca-2026",
    sessionId: context.sessionId,
    threadId: context.threadId,
    contextRevision: context.contextRevision,
    resourceVersion: 4,
    commandKey: `projection-order-${sequence}-${randomUUID()}`,
    requestHash: createHash("sha256")
      .update(`projection-order-${sequence}`)
      .digest("hex"),
    statusCode: 200,
    resultPayload: { sequence },
    selectedActionIds: ["action-1"],
    policyVersion: "test-policy-v1",
    sourceReadSet: [{ reference: "Patient/p-luca", version: 4 }],
    auditEntries: [],
    clinicalResources: [],
    removedReferences: [],
    clinicalExpectedVersions: {},
    checkpoint: new PflegehelferService().checkpoint(),
    providerCommands: [],
  });
}

describe.runIf(Boolean(databaseUrl))(
  "PostgreSQL clinical projection order",
  () => {
    it("does not lease a newer whole-state checkpoint past an unresolved older job", async () => {
      const store = new PostgresOperationalStore(databaseUrl!);
      const inspection = new Pool({ connectionString: databaseUrl });
      try {
        await store.initialize();
        await store.resetDemoState();
        const first = await acceptSyntheticCommand(store, 1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const second = await acceptSyntheticCommand(store, 2);

        const older = await store.claimClinicalProjection({
          workerId: "ordering-worker",
          leaseDurationMs: 30_000,
        });
        expect(older?.acceptedCommandId).toBe(first.id);
        await store.failClinicalProjection({
          jobId: older!.id,
          workerId: "ordering-worker",
          errorCode: "SYNTHETIC_MANUAL_HOLD",
          retryAt: null,
        });

        await expect(
          store.claimClinicalProjection({
            workerId: "must-not-overtake",
            leaseDurationMs: 30_000,
          }),
        ).resolves.toBeNull();

        await expect(
          store.manualClinicalProjectionHead(),
        ).resolves.toMatchObject({
          jobId: older!.id,
          acceptedCommandId: first.id,
          errorCode: "SYNTHETIC_MANUAL_HOLD",
        });
        const commandKey = `u-it:POST:/api/v1/operations/clinical-projections/:jobId/retry:${randomUUID()}`;
        const requestHash = createHash("sha256")
          .update("recover-first-projection")
          .digest("hex");
        const audit = new AuditChain().append({
          actor: new PflegehelferService().user("u-it"),
          action: "clinical-projection:retry",
          patientId: null,
          purpose: "operations",
          outcome: "success",
          detail: {
            jobId: older!.id,
            errorCode: "SYNTHETIC_MANUAL_HOLD",
          },
        });
        await expect(
          store.recoverManualClinicalProjection({
            actorId: "u-it",
            actorRole: "it",
            jobId: older!.id,
            expectedErrorCode: "CHANGED_ERROR",
            commandKey,
            requestHash,
            auditEntry: audit,
          }),
        ).rejects.toMatchObject({ code: "INVALID_STATE" });
        const recovered = await store.recoverManualClinicalProjection({
          actorId: "u-it",
          actorRole: "it",
          jobId: older!.id,
          expectedErrorCode: "SYNTHETIC_MANUAL_HOLD",
          commandKey,
          requestHash,
          auditEntry: audit,
        });
        expect(recovered).toMatchObject({
          jobId: older!.id,
          acceptedCommandId: first.id,
          previousErrorCode: "SYNTHETIC_MANUAL_HOLD",
          state: "retry",
          replayed: false,
        });
        await expect(
          store.recoverManualClinicalProjection({
            actorId: "u-it",
            actorRole: "it",
            jobId: older!.id,
            expectedErrorCode: "SYNTHETIC_MANUAL_HOLD",
            commandKey,
            requestHash,
            auditEntry: audit,
          }),
        ).resolves.toMatchObject({ replayed: true });
        const retried = await store.claimClinicalProjection({
          workerId: "retry-head-in-order",
          leaseDurationMs: 30_000,
        });
        expect(retried?.acceptedCommandId).toBe(first.id);
        await store.finishClinicalProjection({
          jobId: retried!.id,
          workerId: "retry-head-in-order",
        });
        await expect(
          store.claimClinicalProjection({
            workerId: "next-in-order",
            leaseDurationMs: 30_000,
          }),
        ).resolves.toMatchObject({ acceptedCommandId: second.id });
        const evidence = await inspection.query<{
          receipts: number;
          audits: number;
          events: number;
        }>(
          `SELECT
             (SELECT count(*)::int FROM command_receipts WHERE command_key=$1) receipts,
             (SELECT count(*)::int FROM audit_entries WHERE entry_hash=$2) audits,
             (SELECT count(*)::int FROM domain_events
              WHERE aggregate_id=$3 AND event_type='ClinicalProjectionRetryAuthorized') events`,
          [commandKey, audit.hash, older!.id],
        );
        expect(evidence.rows[0]).toEqual({ receipts: 1, audits: 1, events: 1 });
      } finally {
        await store.resetDemoState();
        await Promise.all([store.close(), inspection.end()]);
      }
    });
  },
);
