import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HttpProviderSimulatorAdapter } from "../src/core/provider-integration/http-simulator.js";
import { providerRegistryFixtures } from "../src/core/provider-integration/registry.js";
import { createProviderSimulatorApp } from "../src/server/provider-simulator.js";

const apps: Array<Awaited<ReturnType<typeof createProviderSimulatorApp>>> = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("independent stateful provider simulator", () => {
  it("requires authentication and preserves an acknowledged record across restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pfh-provider-"));
    directories.push(directory);
    const statePath = join(directory, "state.json");
    const token = "synthetic-provider-test-token-32-characters";
    const first = await createProviderSimulatorApp({ token, statePath });
    apps.push(first);
    const firstAddress = await first.listen({ host: "127.0.0.1", port: 0 });
    const denied = await first.inject({ method: "GET", url: "/health" });
    expect(denied.statusCode).toBe(401);
    const adapter = new HttpProviderSimulatorAdapter(
      providerRegistryFixtures.simulatorManifest("wicare"),
      firstAddress,
      token,
    );
    const command = {
      commandId: "persistent-command-1",
      operation: "NursingNote.write" as const,
      patientReference: "Patient/p-luca",
      encounterReference: "Encounter/enc-luca-2026",
      resource: {
        resourceType: "DocumentReference",
        id: "note-persistent-1",
        body: {
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
          structuredText: "Synthetische persistente Pflegenotiz.",
        },
      },
      expectedProviderVersion: null,
      mappingVersion: "synthetic-v1",
      correlationId: "correlation-persistent-1",
      causationId: "causation-persistent-1",
      idempotencyKey: "persistent-note-p-luca-v1",
      approvedAt: "2026-09-13T08:00:00.000Z",
    };
    const acknowledgement = await adapter.executeCommand(
      await adapter.prepareCommand(command),
    );
    expect(acknowledgement.status).toBe("acknowledged");
    await first.close();
    apps.splice(apps.indexOf(first), 1);

    const second = await createProviderSimulatorApp({ token, statePath });
    apps.push(second);
    const secondAddress = await second.listen({ host: "127.0.0.1", port: 0 });
    const restarted = new HttpProviderSimulatorAdapter(
      providerRegistryFixtures.simulatorManifest("wicare"),
      secondAddress,
      token,
    );
    await expect(
      restarted.read({
        resourceType: "DocumentReference",
        externalId: "note-persistent-1",
      }),
    ).resolves.toMatchObject({
      payload: {
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        structuredText: "Synthetische persistente Pflegenotiz.",
      },
    });
  });
});
