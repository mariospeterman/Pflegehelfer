import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createSyntheticProviderRegistry,
  ProviderDeliveryWorker,
  type CanonicalClinicalCommand,
  type ProviderAcknowledgement,
  type ProviderDeliveryStore,
  type ProviderOutboxJob,
} from "../src/core/provider-integration/index.js";

function providerJob(): ProviderOutboxJob {
  const id = randomUUID();
  const command: CanonicalClinicalCommand = {
    commandId: id,
    operation: "Observation.write",
    patientReference: "Patient/p-anna",
    encounterReference: "Encounter/enc-anna-2026",
    resource: {
      resourceType: "Observation",
      id,
      body: {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        status: "final",
        valueQuantity: { value: 37.8, code: "Cel" },
      },
    },
    expectedProviderVersion: null,
    mappingVersion: "synthetic-v1",
    correlationId: randomUUID(),
    causationId: randomUUID(),
    idempotencyKey: `readback-version-${randomUUID()}`,
    approvedAt: "2026-09-13T08:00:00.000Z",
  };
  return {
    id: randomUUID(),
    provider: "device-gateway",
    profile: "synthetic-simulator",
    operation: command.operation,
    idempotencyKey: command.idempotencyKey,
    payload: {
      schemaVersion: 1,
      command,
      retrySafety: "idempotent-provider",
    },
    attempts: 1,
    recoveredExpiredLease: false,
    latestReceiptId: null,
  };
}

describe("provider read-back version proof", () => {
  it("quarantines an exact body returned from a different provider version", async () => {
    const job = providerJob();
    let completed: ProviderAcknowledgement | null = null;
    const store: ProviderDeliveryStore = {
      enqueueProviderCommand: () => Promise.reject(new Error("not used")),
      claimProviderCommands: () => Promise.resolve([job]),
      finishProviderDelivery: (input) => {
        completed = input.acknowledgement;
        return Promise.resolve();
      },
      failProviderDelivery: () => Promise.reject(new Error("not used")),
    };
    const registry = createSyntheticProviderRegistry();
    const adapter = registry.adapterForOperation(
      "device-gateway",
      "synthetic-simulator",
      "Observation.write",
    )!;
    const originalRead = adapter.read.bind(adapter);
    vi.spyOn(adapter, "read").mockImplementation(async (reference) => ({
      ...(await originalRead(reference)),
      originVersion: "sim-v999",
    }));

    await expect(
      new ProviderDeliveryWorker(store, registry, {
        workerId: "version-proof-worker",
        profile: "synthetic-simulator",
        authorizeDelivery: () => ({ allowed: true }),
      }).runOnce(),
    ).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retrying: 0,
      manual: 1,
    });
    expect(completed).toMatchObject({
      status: "conflict",
      errorCode: "PROVIDER_READBACK_MISMATCH",
      errorClassification: "version-conflict",
    });
  });
});
