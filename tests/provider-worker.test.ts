import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalClinicalCommandSchema,
  createSyntheticProviderRegistry,
  ProviderDeliveryWorker,
  type CanonicalClinicalCommand,
  type ProviderAcknowledgement,
  type ProviderDeliveryStore,
  type ProviderErrorClassification,
  type ProviderOutboxJob,
} from "../src/core/provider-integration/index.js";
import { PflegehelferService } from "../src/core/service.js";

function command(key: string): CanonicalClinicalCommand {
  const id = randomUUID();
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
    approvedAt: "2026-09-13T08:00:00.000Z",
  };
}

function job(
  retrySafety: "idempotent-provider" | "reconcile-before-retry",
  options: Partial<ProviderOutboxJob> = {},
): ProviderOutboxJob {
  const providerCommand = command(`worker-${randomUUID()}`);
  return {
    id: randomUUID(),
    provider: "device-gateway",
    profile: "synthetic-simulator",
    operation: providerCommand.operation,
    idempotencyKey: providerCommand.idempotencyKey,
    payload: { schemaVersion: 1, command: providerCommand, retrySafety },
    attempts: 1,
    recoveredExpiredLease: false,
    latestReceiptId: null,
    ...options,
  };
}

const authorizeDelivery = () => ({ allowed: true as const });

class RecordingDeliveryStore implements ProviderDeliveryStore {
  readonly completed: Array<{
    acknowledgement: ProviderAcknowledgement;
    readBackEvidence?: {
      providerVersion: string;
      contentHash: string;
      adapterVersion: string;
      mappingVersion: string;
    };
  }> = [];
  readonly failures: Array<{
    errorCode: string;
    errorClassification: ProviderErrorClassification;
    retryAt: Date | null;
  }> = [];

  constructor(private jobs: ProviderOutboxJob[]) {}

  enqueueProviderCommand(): Promise<{ id: string; inserted: boolean }> {
    throw new Error("not used");
  }

  claimProviderCommands(): Promise<ProviderOutboxJob[]> {
    const jobs = this.jobs;
    this.jobs = [];
    return Promise.resolve(jobs);
  }

  finishProviderDelivery(input: {
    acknowledgement: ProviderAcknowledgement;
    readBackEvidence?: {
      providerVersion: string;
      contentHash: string;
      adapterVersion: string;
      mappingVersion: string;
    };
  }): Promise<void> {
    this.completed.push(input);
    return Promise.resolve();
  }

  failProviderDelivery(input: {
    errorCode: string;
    errorClassification: ProviderErrorClassification;
    retryAt: Date | null;
  }): Promise<void> {
    this.failures.push(input);
    return Promise.resolve();
  }
}

describe("bounded provider delivery worker", () => {
  it("rejects reads, medication writes and mismatched resource types as delivery commands", () => {
    const valid = command(`validation-${randomUUID()}`);
    for (const invalid of [
      { ...valid, operation: "Patient.read" },
      { ...valid, operation: "MedicationOrder.write" },
      {
        ...valid,
        resource: { ...valid.resource, resourceType: "Communication" },
      },
      { ...valid, patientReference: "Encounter/e-anna" },
      { ...valid, encounterReference: "Patient/p-anna" },
      {
        ...valid,
        resource: {
          ...valid.resource,
          body: { ...valid.resource.body, patientId: "p-luca" },
        },
      },
    ])
      expect(canonicalClinicalCommandSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it("validates service-generated commands without duplicate resource identity", () => {
    const service = new PflegehelferService();
    const draft = service.createObservationDraft("u-nurse", {
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      code: "temperature",
      value: 37.8,
      effectiveAt: "2026-09-13T08:00:00.000Z",
    });
    service.approve("u-nurse", "observation", draft.id, {
      expectedVersion: draft.version,
      patientMrn: "SH-260901-001",
      patientBirthDate: "1941-03-18",
      reviewedDiff: true,
    });

    const pending = service.pendingProviderCommands();
    expect(pending).toHaveLength(1);
    expect(() =>
      canonicalClinicalCommandSchema.parse(pending[0]!.command),
    ).not.toThrow();
    expect(pending[0]!.command).toMatchObject({
      patientReference: "Patient/p-anna",
      encounterReference: "Encounter/enc-anna-2026",
      resource: {
        id: draft.id,
        body: {
          patientId: "p-anna",
          encounterId: "enc-anna-2026",
        },
      },
    });
    expect(pending[0]!.command.resource.body).not.toHaveProperty("id");
    expect(pending[0]!.command.resource.body).not.toHaveProperty(
      "resourceType",
    );
    expect(
      service.retireAcceptedProviderCommands([
        pending[0]!.command.idempotencyKey,
      ]),
    ).toBe(1);
    expect(service.pendingProviderCommands()).toEqual([]);
  });

  it("delivers a leased command through the configured simulator", async () => {
    const store = new RecordingDeliveryStore([job("idempotent-provider")]);
    const worker = new ProviderDeliveryWorker(
      store,
      createSyntheticProviderRegistry(),
      {
        workerId: "worker-a",
        profile: "synthetic-simulator",
        authorizeDelivery,
      },
    );

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retrying: 0,
      manual: 0,
    });
    expect(store.completed).toHaveLength(1);
    expect(store.completed[0]?.acknowledgement.status).toBe("acknowledged");
    expect(store.completed[0]?.readBackEvidence).toMatchObject({
      providerVersion: "sim-v1",
      adapterVersion: "1.0.0",
      mappingVersion: "synthetic-v1",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(store.failures).toEqual([]);
  });

  it("does not blindly resend an expired lease without idempotency proof", async () => {
    const store = new RecordingDeliveryStore([
      job("reconcile-before-retry", { recoveredExpiredLease: true }),
    ]);
    const worker = new ProviderDeliveryWorker(
      store,
      createSyntheticProviderRegistry(),
      {
        workerId: "worker-recovery",
        profile: "synthetic-simulator",
        authorizeDelivery,
      },
    );

    await expect(worker.runOnce()).resolves.toMatchObject({
      claimed: 1,
      delivered: 0,
      manual: 1,
    });
    expect(store.completed).toEqual([]);
    expect(store.failures).toEqual([
      expect.objectContaining({
        errorCode: "UNCERTAIN_REMOTE_OUTCOME",
        errorClassification: "version-conflict",
        retryAt: null,
      }),
    ]);
  });

  it("retries only explicitly idempotent transport failures", async () => {
    const registry = createSyntheticProviderRegistry();
    await registry.setSimulatorMode("device-gateway", "down");
    const safeStore = new RecordingDeliveryStore([job("idempotent-provider")]);
    const unsafeStore = new RecordingDeliveryStore([
      job("reconcile-before-retry"),
    ]);
    const options = {
      profile: "synthetic-simulator" as const,
      retryBaseMs: 1_000,
      now: () => new Date("2026-09-13T08:00:00.000Z"),
      authorizeDelivery,
    };

    await expect(
      new ProviderDeliveryWorker(safeStore, registry, {
        ...options,
        workerId: "worker-safe",
      }).runOnce(),
    ).resolves.toMatchObject({ retrying: 1, manual: 0 });
    expect(safeStore.failures[0]?.retryAt?.toISOString()).toBe(
      "2026-09-13T08:00:01.000Z",
    );

    await expect(
      new ProviderDeliveryWorker(unsafeStore, registry, {
        ...options,
        workerId: "worker-unsafe",
      }).runOnce(),
    ).resolves.toMatchObject({ retrying: 0, manual: 1 });
    expect(unsafeStore.failures[0]?.retryAt).toBeNull();
  });

  it("fails closed before adapter execution when delivery authority is revoked", async () => {
    const store = new RecordingDeliveryStore([job("idempotent-provider")]);
    const worker = new ProviderDeliveryWorker(
      store,
      createSyntheticProviderRegistry(),
      {
        workerId: "worker-revoked",
        profile: "synthetic-simulator",
        authorizeDelivery: () => ({
          allowed: false,
          reason: "authority-revision-revoked",
        }),
      },
    );

    await expect(worker.runOnce()).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retrying: 0,
      manual: 1,
    });
    expect(store.completed).toEqual([]);
    expect(store.failures).toEqual([
      expect.objectContaining({
        errorCode: "DELIVERY_AUTHORIZATION_DENIED:authority-revision-revoked",
        errorClassification: "authorization",
        retryAt: null,
      }),
    ]);
  });
});
