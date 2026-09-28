import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { PflegehelferService } from "../src/core/service.js";
import { buildApp } from "../src/server/app.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

async function queueSyntheticProjection(store: InMemoryOperationalStore) {
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
        transcript: "Synthetische Notiz",
        structuredText: "Synthetische Notiz",
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
  await store.acceptIntentCommand({
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
    commandKey: `recovery-fixture-${randomUUID()}`,
    requestHash: createHash("sha256").update(token).digest("hex"),
    statusCode: 200,
    resultPayload: { queued: true },
    selectedActionIds: ["action-1"],
    policyVersion: "test-policy-v1",
    sourceReadSet: [],
    auditEntries: [],
    clinicalResources: [],
    removedReferences: [],
    clinicalExpectedVersions: {},
    checkpoint: new PflegehelferService().checkpoint(),
    providerCommands: [],
  });
}

describe("clinical projection operator recovery", () => {
  it("requires IT and exact head/error, records audit, and replays one command", async () => {
    const store = new InMemoryOperationalStore();
    const service = new PflegehelferService();
    await queueSyntheticProjection(store);
    const leased = await store.claimClinicalProjection({
      workerId: "test-worker",
      leaseDurationMs: 30_000,
    });
    await store.failClinicalProjection({
      jobId: leased!.id,
      workerId: "test-worker",
      errorCode: "SYNTHETIC_MANUAL_HOLD",
      retryAt: null,
    });
    const app = buildApp(service, {
      demoMode: true,
      operationalStore: store,
    });
    apps.push(app);

    const deniedRead = await app.inject({
      method: "GET",
      url: "/api/v1/operations/clinical-projections/manual-head",
      headers: { "x-demo-user": "u-assistant" },
    });
    expect(deniedRead.statusCode).toBe(403);
    const head = await app.inject({
      method: "GET",
      url: "/api/v1/operations/clinical-projections/manual-head",
      headers: { "x-demo-user": "u-it" },
    });
    expect(head.json()).toMatchObject({
      hold: {
        jobId: leased!.id,
        errorCode: "SYNTHETIC_MANUAL_HOLD",
      },
    });

    const deniedRetry = await app.inject({
      method: "POST",
      url: `/api/v1/operations/clinical-projections/${leased!.id}/retry`,
      headers: {
        "x-demo-user": "u-assistant",
        "x-command-id": randomUUID(),
      },
      payload: { expectedErrorCode: "SYNTHETIC_MANUAL_HOLD" },
    });
    expect(deniedRetry.statusCode).toBe(403);
    const staleRetry = await app.inject({
      method: "POST",
      url: `/api/v1/operations/clinical-projections/${leased!.id}/retry`,
      headers: { "x-demo-user": "u-it", "x-command-id": randomUUID() },
      payload: { expectedErrorCode: "CHANGED_ERROR" },
    });
    expect(staleRetry.statusCode).toBe(409);

    const commandId = randomUUID();
    const request = {
      method: "POST" as const,
      url: `/api/v1/operations/clinical-projections/${leased!.id}/retry`,
      headers: { "x-demo-user": "u-it", "x-command-id": commandId },
      payload: { expectedErrorCode: "SYNTHETIC_MANUAL_HOLD" },
    };
    const recovered = await app.inject(request);
    const replayed = await app.inject(request);
    expect(recovered.statusCode, recovered.body).toBe(200);
    expect(recovered.json()).toMatchObject({ state: "retry", replayed: false });
    expect(replayed.statusCode, replayed.body).toBe(200);
    expect(replayed.json()).toMatchObject({ state: "retry", replayed: false });
    expect(
      service.auditEvidence("u-it").actionCounts["clinical-projection:retry"],
    ).toBe(1);
    await expect(
      store.claimClinicalProjection({
        workerId: "retry-worker",
        leaseDurationMs: 30_000,
      }),
    ).resolves.toMatchObject({ id: leased!.id, attempts: 2 });
  });
});
