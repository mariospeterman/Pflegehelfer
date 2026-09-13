import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { PflegehelferService } from "../src/core/service.js";
import {
  PostgresOperationalStore,
  type WorkingSessionView,
} from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

async function acceptSyntheticCommand(
  store: PostgresOperationalStore,
  session: WorkingSessionView,
  sequence: number,
) {
  const token = randomUUID();
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
    sessionId: session.id,
    threadId: session.threadId,
    contextRevision: session.contextRevision,
    responseId: randomUUID(),
    reviewItems: [{ id: "action-1", kind: "note" }],
  });
  return store.acceptIntentCommand({
    tokenHash,
    actorId: "u-assistant",
    actorRole: "care-assistant",
    purpose: "direct-care",
    patientId: "p-luca",
    encounterId: "enc-luca-2026",
    sessionId: session.id,
    threadId: session.threadId,
    contextRevision: session.contextRevision,
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
        const session = await store.changePatientContext(
          "u-assistant",
          "care-assistant",
          "p-luca",
          "enc-luca-2026",
        );
        const first = await acceptSyntheticCommand(store, session, 1);
        await new Promise((resolve) => setTimeout(resolve, 10));
        const second = await acceptSyntheticCommand(store, session, 2);

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

        await inspection.query(
          `UPDATE clinical_projection_outbox
           SET state='delivered',delivered_at=now()
           WHERE organization_id='org-demo' AND id=$1`,
          [older!.id],
        );
        await expect(
          store.claimClinicalProjection({
            workerId: "next-in-order",
            leaseDurationMs: 30_000,
          }),
        ).resolves.toMatchObject({ acceptedCommandId: second.id });
      } finally {
        await store.resetDemoState();
        await Promise.all([store.close(), inspection.end()]);
      }
    });
  },
);
