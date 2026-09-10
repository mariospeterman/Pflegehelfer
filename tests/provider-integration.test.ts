import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  adapterManifestSchema,
  createSyntheticProviderRegistry,
  providerAdapterConfigJsonSchema,
  providerAdapterConfigSchema,
  providerIntegrationRoutes,
  providerRegistryFixtures,
  ProviderContractSimulator,
  ProviderRegistry,
  type CanonicalClinicalCommand,
  type ProviderAdapter,
} from "../src/core/provider-integration/index.js";

const now = "2026-09-05T12:00:00.000Z";

function command(idempotencyKey: string): CanonicalClinicalCommand {
  return {
    commandId: "command-1",
    operation: "Observation.write",
    patientReference: "Patient/p-anna",
    resource: {
      resourceType: "Observation",
      id: "observation-1",
      body: { status: "final", valueQuantity: { value: 37.8, code: "Cel" } },
    },
    expectedProviderVersion: "sim-v1",
    mappingVersion: "ch-core-6.0.0-v1",
    correlationId: "correlation-1",
    causationId: "approval-1",
    idempotencyKey,
    approvedAt: now,
  };
}

describe("versioned provider integration schemas", () => {
  it("keeps simulator activation and production vendor gates mutually exclusive", () => {
    expect(providerAdapterConfigJsonSchema).toMatchObject({ type: "object" });
    expect(() =>
      providerAdapterConfigSchema.parse({
        schemaVersion: "1.0.0",
        provider: "wicare",
        profile: "production",
        adapterVersion: "1.0.0",
        enabled: true,
        connection: { kind: "simulator" },
      }),
    ).toThrow(/Production profiles cannot use simulator connections/);
    expect(() =>
      providerAdapterConfigSchema.parse({
        schemaVersion: "1.0.0",
        provider: "wicare",
        profile: "production",
        adapterVersion: "0.0.0-external-vendor-gate",
        enabled: true,
        connection: {
          kind: "external-vendor-gate",
          gateIds: ["wicare-patient-read"],
        },
      }),
    ).toThrow(/external vendor gate cannot be activated/i);
  });

  it("requires actionable details for every externally gated capability", () => {
    const manifest = providerRegistryFixtures.productionManifest("wicare");
    expect(adapterManifestSchema.parse(manifest)).toEqual(manifest);
    expect(() =>
      adapterManifestSchema.parse({ ...manifest, gates: [] }),
    ).toThrow(/Missing gate details/);
    for (const gate of manifest.gates) {
      expect(gate.status).toBe("EXTERNAL_VENDOR_GATE");
      expect(gate.missingArtifacts.length).toBeGreaterThan(0);
      expect(gate.activationTests.length).toBeGreaterThan(0);
      expect(gate.safeFallback.length).toBeGreaterThan(10);
    }
  });
});

describe("provider registry", () => {
  it("separates simulated availability from gated production status", async () => {
    const registry = createSyntheticProviderRegistry();
    const production = await registry.status("production");
    const simulators = await registry.status("synthetic-simulator");
    expect(production).toHaveLength(5);
    expect(simulators).toHaveLength(5);
    expect(
      production.every(
        (entry) => entry.operationalStatus === "EXTERNAL_VENDOR_GATE",
      ),
    ).toBe(true);
    expect(
      simulators.every((entry) => entry.operationalStatus === "SIMULATED"),
    ).toBe(true);
    for (const entry of production) {
      expect(
        entry.capabilities.find(
          (capability) => capability.operation === "MedicationOrder.write",
        )?.support,
      ).toBe("unsupported");
      expect(
        entry.capabilities
          .filter((capability) => capability.support === "external-vendor-gate")
          .every((capability) =>
            entry.gates.some(
              (gate) => gate.capability === capability.operation,
            ),
          ),
      ).toBe(true);
    }
  });

  it("resolves verified capabilities without enabling gated operations", async () => {
    const simulator = providerRegistryFixtures.simulatorManifest("wicare");
    const production = providerRegistryFixtures.productionManifest("wicare");
    const gatedWrite = production.gates.find(
      (gate) => gate.capability === "Observation.write",
    )!;
    const manifest = adapterManifestSchema.parse({
      ...simulator,
      profile: "production",
      displayName: "WiCare partially verified fixture",
      capabilities: simulator.capabilities.map((capability) =>
        capability.operation === "Observation.write"
          ? {
              ...capability,
              support: "external-vendor-gate" as const,
              conditions: ["Write contract not supplied"],
            }
          : capability,
      ),
      gates: [gatedWrite],
    });
    const adapter: ProviderAdapter = {
      manifest: () => manifest,
      discoverCapabilities: () => Promise.resolve(manifest.capabilities),
      health: () =>
        Promise.resolve({
          status: "available",
          checkedAt: now,
          latencyMs: 1,
          message: "verified fixture",
        }),
      pullChanges: () =>
        Promise.resolve({
          records: [],
          nextCursor: { value: "0" },
          hasMore: false,
        }),
      read: () => Promise.reject(new Error("not exercised")),
      mapInbound: () => Promise.resolve([]),
      prepareCommand: () => Promise.reject(new Error("not exercised")),
      executeCommand: () => Promise.reject(new Error("not exercised")),
      getCommandStatus: () => Promise.reject(new Error("not exercised")),
      reconcile: () => Promise.reject(new Error("not exercised")),
    };
    const registry = new ProviderRegistry();
    registry.register(
      {
        schemaVersion: "1.0.0",
        provider: "wicare",
        profile: "production",
        adapterVersion: "1.0.0",
        enabled: true,
        connection: {
          kind: "verified-vendor-contract",
          contractReference: "verified-read-contract-v1",
          credentialSecretRef: "providers/wicare/read",
          endpoint: "https://wicare.example.invalid/api",
        },
      },
      manifest,
      adapter,
    );
    expect(
      registry.adapterForOperation("wicare", "production", "Patient.read"),
    ).toBe(adapter);
    expect(
      registry.adapterForOperation("wicare", "production", "Observation.write"),
    ).toBeNull();
    await expect(registry.get("wicare", "production")).resolves.toMatchObject({
      operationalStatus: "DEGRADED",
      gates: [expect.objectContaining({ capability: "Observation.write" })],
    });
  });
});

describe("full provider simulator contract", () => {
  it("validates mapping, payload integrity, idempotency and receipt polling", async () => {
    const manifest =
      providerRegistryFixtures.simulatorManifest("device-gateway");
    const simulator = new ProviderContractSimulator(manifest, {
      now: () => now,
      createId: () => "00000000-0000-4000-8000-000000000001",
      records: [
        {
          reference: {
            resourceType: "Observation",
            externalId: "external-observation-1",
          },
          originVersion: "sim-v1",
          effectiveAt: now,
          recordedAt: now,
          receivedAt: now,
          payload: {
            resourceType: "Observation",
            id: "external-observation-1",
            status: "final",
          },
        },
      ],
    });
    const batch = await simulator.pullChanges();
    expect(batch.records).toHaveLength(1);
    expect(await simulator.mapInbound(batch.records[0]!)).toMatchObject([
      { resourceType: "Observation", id: "external-observation-1" },
    ]);

    const prepared = await simulator.prepareCommand(command("stable-key"));
    const first = await simulator.executeCommand(prepared);
    const replay = await simulator.executeCommand(prepared);
    expect(replay.receiptId).toBe(first.receiptId);
    await expect(
      simulator.read({
        resourceType: "Observation",
        externalId: "observation-1",
      }),
    ).resolves.toMatchObject({
      originVersion: "sim-v2",
      payload: {
        resourceType: "Observation",
        id: "observation-1",
        valueQuantity: { value: 37.8, code: "Cel" },
      },
    });
    const differentPayload = await simulator.prepareCommand({
      ...command("stable-key"),
      commandId: "different-command",
    });
    await expect(simulator.executeCommand(differentPayload)).rejects.toThrow(
      /IDEMPOTENCY_KEY_PAYLOAD_MISMATCH/,
    );
    await expect(
      simulator.executeCommand({ ...prepared, payloadHash: "c".repeat(64) }),
    ).rejects.toThrow(/HASH_MISMATCH/);

    const delayed = new ProviderContractSimulator(manifest, {
      now: () => now,
      createId: () => "00000000-0000-4000-8000-000000000002",
    });
    delayed.setMode("delay");
    const pending = await delayed.executeCommand(
      await delayed.prepareCommand(command("pending-key")),
    );
    expect(pending.status).toBe("pending");
    await expect(
      delayed.read({
        resourceType: "Observation",
        externalId: "observation-1",
      }),
    ).rejects.toThrow(/SIMULATOR_RECORD_NOT_FOUND/);
    await expect(
      delayed.getCommandStatus(pending.receiptId),
    ).resolves.toMatchObject({
      status: "acknowledged",
      receiptId: pending.receiptId,
    });
    await expect(
      delayed.read({
        resourceType: "Observation",
        externalId: "observation-1",
      }),
    ).resolves.toMatchObject({ originVersion: "sim-v2" });

    delayed.injectInboundRecord({
      reference: {
        resourceType: "Observation",
        externalId: "provider-follow-up",
      },
      originVersion: "sim-v3",
      effectiveAt: now,
      recordedAt: now,
      receivedAt: now,
      payload: {
        resourceType: "Observation",
        id: "provider-follow-up",
        valueQuantity: { value: 151, unit: "mmHg" },
      },
    });
    const inbound = await delayed.pullChanges();
    expect(inbound.records.map((record) => record.reference.externalId)).toEqual(
      ["observation-1", "provider-follow-up"],
    );
    expect(inbound.records[1]).toMatchObject({
      originVersion: "sim-v3",
      payload: {
        resourceType: "Observation",
        id: "provider-follow-up",
        valueQuantity: { value: 151, unit: "mmHg" },
      },
    });
  });

  it("classifies content rejection and version conflict separately", async () => {
    const manifest =
      providerRegistryFixtures.simulatorManifest("device-gateway");
    const rejected = new ProviderContractSimulator(manifest, {
      now: () => now,
    });
    rejected.setMode("reject");
    await expect(
      rejected.executeCommand(await rejected.prepareCommand(command("reject"))),
    ).resolves.toMatchObject({
      status: "rejected",
      errorClassification: "clinical-content",
    });
    const conflict = new ProviderContractSimulator(manifest, {
      now: () => now,
    });
    conflict.setMode("conflict");
    await expect(
      conflict.executeCommand(
        await conflict.prepareCommand(command("conflict")),
      ),
    ).resolves.toMatchObject({
      status: "conflict",
      errorClassification: "version-conflict",
      providerSnapshot: { originVersion: "sim-v2" },
    });
  });
});

describe("provider integration route plugin", () => {
  it("exposes the safe registry and no duplicate reconciliation API", async () => {
    const registry = createSyntheticProviderRegistry();
    const app = Fastify();
    await app.register(providerIntegrationRoutes, {
      registry,
      authorize: () => undefined,
    });
    const registryResponse = await app.inject({
      method: "GET",
      url: "/api/v1/providers/registry?profile=production",
    });
    expect(registryResponse.statusCode).toBe(200);
    const registryBody = registryResponse.json<{
      providers: Array<{ operationalStatus: string }>;
    }>();
    expect(registryBody.providers).toHaveLength(5);
    expect(
      registryBody.providers.every(
        (entry) => entry.operationalStatus === "EXTERNAL_VENDOR_GATE",
      ),
    ).toBe(true);

    const removedDuplicate = await app.inject({
      method: "GET",
      url: "/api/v1/providers/reconciliation",
    });
    expect(removedDuplicate.statusCode).toBe(404);
    await app.close();
  });
});
