import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, it } from "vitest";
import type { CanonicalClinicalCommand } from "../src/core/provider-integration/index.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

function command(patientId: string, key: string): CanonicalClinicalCommand {
  const id = randomUUID();
  return {
    commandId: id,
    operation: "Observation.write",
    patientReference: `Patient/${patientId}`,
    encounterReference: `Encounter/enc-${patientId}`,
    resource: {
      resourceType: "Observation",
      id,
      body: {
        patientId,
        encounterId: `enc-${patientId}`,
        status: "final",
        valueQuantity: { value: 150, code: "mL" },
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
  "ISSUE-007 relational synchronization read model",
  () => {
    it("counts only visible relational deliveries and exposes manual outcomes as conflicts", async () => {
      const store = new PostgresOperationalStore(databaseUrl!);
      const inspection = new Pool({ connectionString: databaseUrl });
      const ids: string[] = [];
      try {
        await store.initialize();
        for (const patientId of ["p-luca", "p-luca", "p-hidden"]) {
          const inserted = await store.enqueueProviderCommand({
            provider: "carecoach",
            profile: "synthetic-simulator",
            command: command(
              patientId,
              `sync-summary-${patientId}-${randomUUID()}`,
            ),
            retrySafety: "idempotent-provider",
          });
          ids.push(inserted.id);
        }
        await inspection.query(
          `UPDATE provider_outbox SET state='manual' WHERE id=$1`,
          [ids[1]],
        );
        await inspection.query(
          `UPDATE provider_outbox SET state='delivered' WHERE id=$1`,
          [ids[2]],
        );

        await expect(
          store.providerDeliverySummary(["p-luca"]),
        ).resolves.toEqual({ unresolved: 2, conflicts: 1 });
        await expect(
          store.providerDeliverySummary(["p-hidden"]),
        ).resolves.toEqual({ unresolved: 0, conflicts: 0 });
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
