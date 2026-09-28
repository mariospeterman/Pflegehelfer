import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import {
  createSyntheticProviderRegistry,
  ProviderDeliveryWorker,
  type CanonicalClinicalCommand,
} from "../src/core/provider-integration/index.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;
const authorizeDelivery = () => ({ allowed: true as const });

function command(key: string, id = randomUUID()): CanonicalClinicalCommand {
  return {
    commandId: id,
    operation: "Observation.write",
    patientReference: "Patient/p-anna",
    encounterReference: "Encounter/e-anna",
    resource: {
      resourceType: "Observation",
      id,
      body: {
        patientId: "p-anna",
        encounterId: "e-anna",
        status: "final",
        valueQuantity: { value: 37.8, code: "Cel" },
      },
    },
    expectedProviderVersion: null,
    mappingVersion: "synthetic-v1",
    correlationId: randomUUID(),
    causationId: randomUUID(),
    idempotencyKey: key,
    approvedAt: new Date().toISOString(),
  };
}

describe.runIf(Boolean(databaseUrl))(
  "PostgreSQL provider delivery worker",
  () => {
    it("leases one job to only one worker and rejects an idempotency collision", async () => {
      const store = new PostgresOperationalStore(databaseUrl!);
      const inspection = new Pool({ connectionString: databaseUrl });
      const registry = createSyntheticProviderRegistry();
      const key = `provider-worker-${randomUUID()}`;
      const firstCommand = command(key);
      const ids: string[] = [];
      try {
        await store.initialize();
        const first = await store.enqueueProviderCommand({
          provider: "device-gateway",
          profile: "synthetic-simulator",
          command: firstCommand,
          retrySafety: "idempotent-provider",
        });
        ids.push(first.id);
        await expect(
          store.enqueueProviderCommand({
            provider: "device-gateway",
            profile: "synthetic-simulator",
            command: firstCommand,
            retrySafety: "idempotent-provider",
          }),
        ).resolves.toEqual({ id: first.id, inserted: false });
        await expect(
          store.enqueueProviderCommand({
            provider: "device-gateway",
            profile: "synthetic-simulator",
            command: { ...firstCommand, commandId: randomUUID() },
            retrySafety: "idempotent-provider",
          }),
        ).rejects.toThrow("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

        const workers = ["worker-a", "worker-b"].map(
          (workerId) =>
            new ProviderDeliveryWorker(store, registry, {
              workerId,
              profile: "synthetic-simulator",
              authorizeDelivery,
            }),
        );
        const results = await Promise.all(
          workers.map((worker) => worker.runOnce()),
        );
        expect(results.reduce((sum, result) => sum + result.claimed, 0)).toBe(
          1,
        );
        expect(results.reduce((sum, result) => sum + result.delivered, 0)).toBe(
          1,
        );
        await expect(
          inspection.query<{ state: string; attempts: number }>(
            `SELECT state,attempts FROM provider_outbox WHERE id=$1`,
            [first.id],
          ),
        ).resolves.toMatchObject({
          rows: [{ state: "delivered", attempts: 1 }],
        });
        const receipts = await inspection.query<{
          provider_version: string | null;
          adapter_version: string | null;
          mapping_version: string | null;
          readback_hash: string | null;
        }>(
          `SELECT provider_version,adapter_version,mapping_version,readback_hash
           FROM provider_receipts WHERE outbox_id=$1`,
          [first.id],
        );
        expect(receipts.rowCount).toBe(1);
        expect(receipts.rows[0]).toMatchObject({
          provider_version: "sim-v1",
          adapter_version: "1.0.0",
          mapping_version: "synthetic-v1",
        });
        expect(receipts.rows[0]?.readback_hash).toMatch(/^[a-f0-9]{64}$/);
      } finally {
        await inspection.query(
          `DELETE FROM provider_receipts WHERE outbox_id=ANY($1::uuid[])`,
          [ids],
        );
        await inspection.query(
          `DELETE FROM provider_outbox WHERE id=ANY($1::uuid[])`,
          [ids],
        );
        await Promise.all([store.close(), inspection.end()]);
      }
    });

    it("recovers an expired idempotent lease but quarantines an uncertain one", async () => {
      const store = new PostgresOperationalStore(databaseUrl!);
      const inspection = new Pool({ connectionString: databaseUrl });
      const registry = createSyntheticProviderRegistry();
      const base = new Date(Date.now() + 10_000);
      const ids: string[] = [];
      try {
        await store.initialize();
        const safe = await store.enqueueProviderCommand({
          provider: "device-gateway",
          profile: "synthetic-simulator",
          command: command(`expired-safe-${randomUUID()}`),
          retrySafety: "idempotent-provider",
        });
        const uncertain = await store.enqueueProviderCommand({
          provider: "device-gateway",
          profile: "synthetic-simulator",
          command: command(`expired-uncertain-${randomUUID()}`),
        });
        ids.push(safe.id, uncertain.id);
        const abandoned = await store.claimProviderCommands({
          workerId: "crashed-worker",
          profile: "synthetic-simulator",
          limit: 2,
          leaseDurationMs: 1_000,
          now: base,
        });
        expect(abandoned).toHaveLength(2);
        const recovery = new ProviderDeliveryWorker(store, registry, {
          workerId: "recovery-worker",
          profile: "synthetic-simulator",
          now: () => new Date(base.getTime() + 2_000),
          authorizeDelivery,
        });
        await expect(recovery.runOnce()).resolves.toMatchObject({
          claimed: 2,
          delivered: 1,
          manual: 1,
        });
        const states = await inspection.query<{ id: string; state: string }>(
          `SELECT id::text,state FROM provider_outbox WHERE id=ANY($1::uuid[])
           ORDER BY id`,
          [ids],
        );
        expect(new Map(states.rows.map((row) => [row.id, row.state]))).toEqual(
          new Map([
            [safe.id, "delivered"],
            [uncertain.id, "manual"],
          ]),
        );
      } finally {
        await inspection.query(
          `DELETE FROM provider_receipts WHERE outbox_id=ANY($1::uuid[])`,
          [ids],
        );
        await inspection.query(
          `DELETE FROM provider_outbox WHERE id=ANY($1::uuid[])`,
          [ids],
        );
        await Promise.all([store.close(), inspection.end()]);
      }
    });

    it("polls a durable pending receipt and quarantines poison without blocking valid work", async () => {
      const store = new PostgresOperationalStore(databaseUrl!);
      const inspection = new Pool({ connectionString: databaseUrl });
      const registry = createSyntheticProviderRegistry();
      const key = `pending-receipt-${randomUUID()}`;
      const poisonId = randomUUID();
      const ids: string[] = [poisonId];
      const start = new Date(Date.now() + 10_000);
      try {
        await store.initialize();
        const valid = await store.enqueueProviderCommand({
          provider: "device-gateway",
          profile: "synthetic-simulator",
          command: command(key),
          retrySafety: "idempotent-provider",
        });
        ids.push(valid.id);
        await inspection.query(
          `INSERT INTO provider_outbox
             (organization_id,id,provider_id,profile_id,operation,idempotency_key,payload,state,next_attempt_at)
           SELECT organization_id,$2,'device-gateway','synthetic-simulator',
                  'Observation.write',$3,$4,'pending',$5
           FROM provider_outbox WHERE id=$1`,
          [
            valid.id,
            poisonId,
            `poison-${randomUUID()}`,
            { invalid: true },
            start,
          ],
        );
        await registry.setSimulatorMode("device-gateway", "delay");
        const first = new ProviderDeliveryWorker(store, registry, {
          workerId: "pending-worker",
          profile: "synthetic-simulator",
          retryBaseMs: 1_000,
          now: () => start,
          authorizeDelivery,
        });
        await expect(first.runOnce()).resolves.toMatchObject({
          claimed: 1,
          retrying: 1,
        });
        await registry.setSimulatorMode("device-gateway", "normal");
        const second = new ProviderDeliveryWorker(store, registry, {
          workerId: "receipt-poller",
          profile: "synthetic-simulator",
          now: () => new Date(start.getTime() + 2_000),
          authorizeDelivery,
        });
        await expect(second.runOnce()).resolves.toMatchObject({
          claimed: 1,
          delivered: 1,
        });
        const states = await inspection.query<{
          id: string;
          state: string;
          last_error_class: string | null;
        }>(
          `SELECT id::text,state,last_error_class FROM provider_outbox
           WHERE id=ANY($1::uuid[])`,
          [ids],
        );
        expect(states.rows).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: valid.id, state: "delivered" }),
            expect.objectContaining({
              id: poisonId,
              state: "manual",
              last_error_class: "OUTBOX_PAYLOAD_INVALID",
            }),
          ]),
        );
        expect(
          await inspection.query(
            `SELECT id FROM provider_receipts WHERE outbox_id=$1`,
            [valid.id],
          ),
        ).toMatchObject({ rowCount: 2 });
      } finally {
        await inspection.query(
          `DELETE FROM provider_receipts WHERE outbox_id=ANY($1::uuid[])`,
          [ids],
        );
        await inspection.query(
          `DELETE FROM provider_outbox WHERE id=ANY($1::uuid[])`,
          [ids],
        );
        await Promise.all([store.close(), inspection.end()]);
      }
    });
  },
);
