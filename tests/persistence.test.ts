import { createHash } from "node:crypto";
import type { Bundle, Resource } from "@medplum/fhirtypes";
import { describe, expect, it } from "vitest";
import type { CommandReceipt, ServiceCheckpoint } from "../src/core/service.js";
import { PflegehelferService } from "../src/core/service.js";
import {
  deserializeCheckpoint,
  deserializeCommandReceipt,
  MedplumClinicalWorkspace,
  serializeCheckpoint,
  serializeCommandReceipt,
  type ClinicalWorkspace,
  type ClinicalWorkspaceStatus,
} from "../src/infrastructure/medplum-workspace.js";
import { buildApp } from "../src/server/app.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";
import {
  fhirResourceId,
  legacyFhirResourceId,
} from "../src/core/fhir-resource-set.js";

class RecordingWorkspace implements ClinicalWorkspace {
  readonly mode = "medplum" as const;
  checkpoint: ServiceCheckpoint | null = null;
  failNext = false;
  commitThenFail = false;
  activeWrites = 0;
  maxActiveWrites = 0;
  maxResourceBatch = 0;
  receipts = new Map<string, CommandReceipt>();

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  async synchronize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
    _removedReferences?: string[],
    commandReceipt?: CommandReceipt,
  ): Promise<void> {
    this.maxResourceBatch = Math.max(this.maxResourceBatch, resources.length);
    this.activeWrites += 1;
    this.maxActiveWrites = Math.max(this.maxActiveWrites, this.activeWrites);
    await new Promise((resolve) => setTimeout(resolve, 5));
    try {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("simulated durable write failure");
      }
      if (checkpoint) this.checkpoint = structuredClone(checkpoint);
      if (commandReceipt)
        this.receipts.set(commandReceipt.key, structuredClone(commandReceipt));
      if (this.commitThenFail) {
        this.commitThenFail = false;
        throw new Error("simulated response loss after commit");
      }
    } finally {
      this.activeWrites -= 1;
    }
  }

  loadCheckpoint(): Promise<ServiceCheckpoint | null> {
    return Promise.resolve(
      this.checkpoint ? structuredClone(this.checkpoint) : null,
    );
  }

  loadCommandReceipt(key: string): Promise<CommandReceipt | null> {
    const receipt = this.receipts.get(key);
    return Promise.resolve(receipt ? structuredClone(receipt) : null);
  }

  status(): Promise<ClinicalWorkspaceStatus> {
    return Promise.resolve({
      mode: "medplum",
      ready: true,
      serverVersion: "test",
      resourceCounts: {},
      message: "test",
      checkedAt: "2026-09-05T12:00:00.000Z",
    });
  }

  detailUrl(): string | null {
    return null;
  }
}

describe("durable workflow checkpoint", () => {
  it("verifies an old checkpoint during controlled HMAC rotation", () => {
    const checkpoint = new PflegehelferService().checkpoint();
    const oldKey = "old-checkpoint-key-with-at-least-32-bytes";
    const nextKey = "next-checkpoint-key-with-at-least-32-bytes";
    const signed = serializeCheckpoint(checkpoint, oldKey);
    expect(signed.meta?.tag).toContainEqual({
      system: "https://pflegehelfer.example.invalid/institution-site",
      code: "org-demo.rehab-2",
    });
    expect(deserializeCheckpoint(signed, nextKey, [oldKey])).toEqual(
      checkpoint,
    );
    expect(() => deserializeCheckpoint(signed, nextKey)).toThrow(
      /authenticity validation/,
    );
  });

  it("does not read an unscoped legacy checkpoint without an approved manifest", async () => {
    const workspace = new MedplumClinicalWorkspace(
      "http://127.0.0.1:8103/",
      "test-client",
      "test-secret",
      "http://127.0.0.1:3001/",
    );
    const reads: string[] = [];
    const internals = workspace as unknown as {
      client: {
        startClientLogin: () => Promise<void>;
        readResource: (type: string, id: string) => Promise<never>;
      };
    };
    internals.client.startClientLogin = () => Promise.resolve();
    internals.client.readResource = (_type, id) => {
      reads.push(id);
      return Promise.reject(new Error("404 not found"));
    };
    await expect(workspace.loadCheckpoint()).resolves.toBeNull();
    expect(reads).toHaveLength(1);
    expect(reads).not.toContain(
      legacyFhirResourceId("Binary", "workflow-control-plane-v1"),
    );
  });

  it("rejects a legacy checkpoint that differs from its approved digest", async () => {
    const checkpoint = new PflegehelferService().checkpoint();
    const legacy = serializeCheckpoint(checkpoint, null);
    legacy.id = legacyFhirResourceId("Binary", "workflow-control-plane-v1");
    const workspace = new MedplumClinicalWorkspace(
      "http://127.0.0.1:8103/",
      "test-client",
      "test-secret",
      "http://127.0.0.1:3001/",
      null,
      [],
      {
        expectedInstitutionId: "org-demo",
        expectedSiteId: "rehab-2",
        expectedBinarySha256: "0".repeat(64),
      },
    );
    const internals = workspace as unknown as {
      client: {
        startClientLogin: () => Promise<void>;
        readResource: (type: string, id: string) => Promise<typeof legacy>;
      };
    };
    internals.client.startClientLogin = () => Promise.resolve();
    internals.client.readResource = (_type, id) =>
      id === legacy.id
        ? Promise.resolve(legacy)
        : Promise.reject(new Error("404 not found"));
    await expect(workspace.loadCheckpoint()).rejects.toThrow(
      /approved migration manifest/,
    );
  });

  it("materializes a verified legacy checkpoint into the scoped projection", async () => {
    const service = new PflegehelferService();
    const checkpoint = service.checkpoint();
    const legacy = serializeCheckpoint(checkpoint, null);
    legacy.id = legacyFhirResourceId("Binary", "workflow-control-plane-v1");
    legacy.meta = {
      tag: [
        {
          system: "https://pflegehelfer.example.invalid/data-classification",
          code: "synthetic",
        },
      ],
    };
    const workspace = new MedplumClinicalWorkspace(
      "http://127.0.0.1:8103/",
      "test-client",
      "test-secret",
      "http://127.0.0.1:3001/",
      null,
      [],
      {
        expectedInstitutionId: "org-demo",
        expectedSiteId: "rehab-2",
        expectedBinarySha256: createHash("sha256")
          .update(legacy.data ?? "")
          .digest("hex"),
      },
    );
    const acceptedTransactions: Bundle[] = [];
    const internals = workspace as unknown as {
      client: {
        startClientLogin: () => Promise<void>;
        readResource: (type: string, id: string) => Promise<Resource>;
        executeBatch: (bundle: Bundle) => Promise<Bundle>;
        searchResources: () => Promise<Resource[]>;
      };
    };
    internals.client.startClientLogin = () => Promise.resolve();
    internals.client.readResource = (type, id) =>
      type === "Binary" && id === legacy.id
        ? Promise.resolve(legacy)
        : Promise.reject(new Error("404 not found"));
    internals.client.executeBatch = (bundle) => {
      if (
        bundle.entry?.some((entry) =>
          entry.resource?.id?.startsWith("invalid-"),
        )
      )
        return Promise.reject(new Error("expected atomicity rejection"));
      acceptedTransactions.push(structuredClone(bundle));
      return Promise.resolve({
        resourceType: "Bundle",
        type: "transaction-response",
        entry: (bundle.entry ?? []).map((entry) => ({
          response: {
            status: entry.request?.method === "DELETE" ? "204" : "200",
            etag: 'W/"1"',
          },
        })),
      });
    };
    internals.client.searchResources = () => Promise.resolve([]);

    const restored = await workspace.loadCheckpoint();
    expect(restored).toEqual(checkpoint);
    const patient = service
      .fhirResources()
      .find((resource) => resource.resourceType === "Patient")!;
    await workspace.initialize([patient], restored!, { reconcile: false });

    const entries = acceptedTransactions.flatMap(
      (transaction) => transaction.entry ?? [],
    );
    expect(
      entries.some(
        (entry) =>
          entry.request?.method === "PUT" &&
          entry.request.url ===
            `Binary/${fhirResourceId("Binary", "workflow-control-plane-v1")}`,
      ),
    ).toBe(true);
    expect(
      entries.some(
        (entry) =>
          entry.request?.method === "DELETE" &&
          entry.request.url === `Binary/${legacy.id}`,
      ),
    ).toBe(true);
    expect(
      entries.some(
        (entry) =>
          entry.request?.method === "PUT" &&
          entry.request.url === `Patient/${patient.id}`,
      ),
    ).toBe(true);
  });

  it("authenticates durable receipts across rotation and rejects tampering", () => {
    const oldKey = "old-receipt-key-with-at-least-32-random-bytes";
    const nextKey = "next-receipt-key-with-at-least-32-random-bytes";
    const receipt: CommandReceipt = {
      key: "signed-receipt-probe",
      requestHash: "a".repeat(64),
      statusCode: 201,
      payload: '{"id":"task-signed"}',
    };
    const signed = serializeCommandReceipt(receipt, oldKey);
    expect(signed.meta?.tag).toContainEqual({
      system: "https://pflegehelfer.example.invalid/institution-site",
      code: "org-demo.rehab-2",
    });
    expect(
      deserializeCommandReceipt(signed, receipt.key, nextKey, [oldKey]),
    ).toEqual(receipt);
    const envelope = JSON.parse(
      Buffer.from(signed.data!, "base64").toString("utf8"),
    ) as { payload: CommandReceipt; sha256: string };
    envelope.payload.payload = '{"id":"task-tampered"}';
    envelope.sha256 = createHash("sha256")
      .update(JSON.stringify(envelope.payload))
      .digest("hex");
    signed.data = Buffer.from(JSON.stringify(envelope), "utf8").toString(
      "base64",
    );
    expect(() =>
      deserializeCommandReceipt(signed, receipt.key, nextKey, [oldKey]),
    ).toThrow(/authenticity validation/);
  });

  it("creates safe links to the current Medplum detail route", () => {
    const workspace = new MedplumClinicalWorkspace(
      "http://127.0.0.1:8103/",
      "test-client",
      "test-secret",
      "http://127.0.0.1:3001/",
    );
    expect(workspace.detailUrl("Patient/123")).toBe(
      "http://127.0.0.1:3001/Patient/123/details",
    );
    expect(workspace.detailUrl("https://attacker.invalid/")).toBe(
      "http://127.0.0.1:3001/",
    );
  });

  it("applies checkpoint CAS only to the checkpoint Binary", async () => {
    const workspace = new MedplumClinicalWorkspace(
      "http://127.0.0.1:8103/",
      "test-client",
      "test-secret",
      "http://127.0.0.1:3001/",
    );
    let captured: Bundle | null = null;
    const internals = workspace as unknown as {
      checkpointVersionId: string | null;
      client: {
        startClientLogin: () => Promise<void>;
        executeBatch: (bundle: Bundle) => Promise<Bundle>;
      };
    };
    internals.checkpointVersionId = "42";
    internals.client.startClientLogin = () => Promise.resolve();
    internals.client.executeBatch = (bundle) => {
      captured = bundle;
      return Promise.resolve({
        resourceType: "Bundle",
        type: "transaction-response",
        entry: [
          { response: { status: "200 OK", etag: 'W/"43"' } },
          { response: { status: "201 Created" } },
        ],
      });
    };
    await workspace.synchronize(
      [],
      new PflegehelferService().checkpoint(),
      [],
      {
        key: "receipt-cas-probe",
        requestHash: "a".repeat(64),
        statusCode: 200,
        payload: "{}",
      },
    );
    const entries = (captured as Bundle | null)?.entry ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[0]?.request?.ifMatch).toBe('W/"42"');
    expect(entries[1]?.request?.ifMatch).toBeUndefined();
  });

  it("restores workflow state and the verified audit chain", () => {
    const first = new PflegehelferService();
    first.updateTask("u-assistant", "t-bp-anna", "accept", {});
    const checkpoint = first.checkpoint();

    const restored = new PflegehelferService();
    restored.restoreCheckpoint(checkpoint);
    expect(
      restored
        .snapshot("u-assistant")
        .tasks.find((task) => task.id === "t-bp-anna"),
    ).toMatchObject({ state: "accepted", ownerId: "u-assistant" });
    expect(restored.audit.verify()).toBe(true);

    checkpoint.audit[0]!.detail.reason = "tampered";
    expect(() => restored.restoreCheckpoint(checkpoint)).toThrow(
      /hash-chain validation/,
    );
  });

  it("rolls a command back when the clinical workspace write fails", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    workspace.failNext = true;
    const app = buildApp(service, { demoMode: true, workspace });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers: {
        "x-demo-user": "u-assistant",
        "x-command-id": "00000000-0000-4000-8000-000000000101",
      },
      payload: {},
    });
    expect(response.statusCode).toBe(500);
    expect(
      service
        .snapshot("u-assistant")
        .tasks.find((task) => task.id === "t-bp-anna"),
    ).toMatchObject({ state: "new", ownerId: null });
    await app.close();
  });

  it("does not expose a mutation before its durable write commits", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    workspace.failNext = true;
    const app = buildApp(service, { demoMode: true, workspace });
    const title = "Darf nie vor Commit sichtbar sein";
    const write = app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": "00000000-0000-4000-8000-000000000108",
      },
      payload: {
        patientId: "p-anna",
        title,
        reason:
          "Ein fehlgeschlagener Commit darf keinen Phantomzustand zeigen.",
        ownerRole: "registered-nurse",
        priority: "routine",
        dueAt: "2026-09-06T13:00:00.000Z",
      },
    });
    while (workspace.activeWrites === 0)
      await new Promise((resolve) => setImmediate(resolve));
    const read = app.inject({
      method: "GET",
      url: "/api/v1/snapshot",
      headers: { "x-demo-user": "u-nurse" },
    });
    const [writeResponse, readResponse] = await Promise.all([write, read]);
    expect(writeResponse.statusCode).toBe(500);
    expect(readResponse.statusCode).toBe(200);
    expect(
      readResponse
        .json<{ tasks: Array<{ title: string }> }>()
        .tasks.some((task) => task.title === title),
    ).toBe(false);
    await app.close();
  });

  it("serializes concurrent commands before committing checkpoints", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    const app = buildApp(service, { demoMode: true, workspace });
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/tasks/t-bp-anna/accept",
        headers: {
          "x-demo-user": "u-assistant",
          "x-command-id": "00000000-0000-4000-8000-000000000102",
        },
        payload: {},
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/tasks/t-mobilise-luca/start",
        headers: {
          "x-demo-user": "u-assistant",
          "x-command-id": "00000000-0000-4000-8000-000000000103",
        },
        payload: {},
      }),
    ]);
    expect([first.statusCode, second.statusCode]).toEqual([200, 200]);
    expect(workspace.maxActiveWrites).toBe(1);
    expect(workspace.checkpoint?.state.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "t-bp-anna", state: "accepted" }),
        expect.objectContaining({
          id: "t-mobilise-luca",
          state: "in-progress",
        }),
      ]),
    );
    await app.close();
  });

  it("commits read audits incrementally so idle clients cannot overflow the next write", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    const app = buildApp(service, { demoMode: true, workspace });
    for (let index = 0; index < 170; index += 1) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/snapshot",
        headers: { "x-demo-user": "u-assistant" },
      });
      expect(response.statusCode).toBe(200);
    }
    const mutation = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers: {
        "x-demo-user": "u-assistant",
        "x-command-id": "00000000-0000-4000-8000-000000000170",
      },
      payload: {},
    });
    expect(mutation.statusCode).toBe(200);
    expect(workspace.maxResourceBatch).toBeLessThan(20);
    await app.close();
  }, 20_000);

  it("replays a successful command from the durable receipt after restart", async () => {
    const workspace = new RecordingWorkspace();
    const firstService = new PflegehelferService();
    const firstApp = buildApp(firstService, { demoMode: true, workspace });
    const headers = {
      "x-demo-user": "u-nurse",
      "x-command-id": "00000000-0000-4000-8000-000000000104",
    };
    const payload = {
      patientId: "p-anna",
      title: "Durabler Neustarttest",
      reason:
        "Derselbe Befehl darf nach Neustart keine zweite Aufgabe anlegen.",
      ownerRole: "registered-nurse",
      priority: "routine",
      dueAt: "2026-09-06T10:00:00.000Z",
    };
    const created = await firstApp.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers,
      payload,
    });
    expect(created.statusCode).toBe(201);
    for (let index = 0; index < 200; index += 1)
      firstService.recordCommandReceipt({
        key: `eviction-probe-${index}`,
        requestHash: "a".repeat(64),
        statusCode: 200,
        payload: JSON.stringify({ index, padding: "x".repeat(1024) }),
      });
    await workspace.synchronize([], firstService.checkpoint());
    expect(
      workspace.checkpoint?.commandReceipts?.some(
        (receipt) =>
          receipt.key ===
          `${headers["x-demo-user"]}:POST:/api/v1/tasks:${headers["x-command-id"]}`,
      ),
    ).toBe(false);
    expect(
      Buffer.byteLength(JSON.stringify(workspace.checkpoint), "utf8"),
    ).toBeLessThan(256 * 1024);
    await firstApp.close();

    const restoredService = new PflegehelferService();
    restoredService.restoreCheckpoint((await workspace.loadCheckpoint())!);
    const restoredApp = buildApp(restoredService, {
      demoMode: true,
      workspace,
    });
    const replayed = await restoredApp.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers,
      payload,
    });
    expect(replayed.statusCode).toBe(201);
    expect(replayed.body).toBe(created.body);
    expect(
      restoredService
        .snapshot("u-nurse")
        .tasks.filter((task) => task.title === payload.title),
    ).toHaveLength(1);
    const mismatch = await restoredApp.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers,
      payload: { ...payload, title: "Anderer Inhalt" },
    });
    expect(mismatch.statusCode).toBe(409);
    await restoredApp.close();
  });

  it("reloads a committed receipt displaced from the bounded hot cache", async () => {
    const workspace = new RecordingWorkspace();
    const service = new PflegehelferService();
    const requests = Array.from({ length: 130 }, (_, index) => {
      const commandId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      const payload = {
        patientId: "p-anna",
        title: `Durable cache replay ${index}`,
        reason: "A durable receipt remains authoritative after cache eviction.",
        ownerRole: "registered-nurse",
        priority: "routine",
        dueAt: "2026-09-06T14:00:00.000Z",
      };
      const receipt: CommandReceipt = {
        key: `u-nurse:POST:/api/v1/tasks:${commandId}`,
        requestHash: createHash("sha256")
          .update(JSON.stringify(payload))
          .digest("hex"),
        statusCode: 201,
        payload: JSON.stringify({ id: `durable-task-${index}` }),
      };
      service.recordCommandReceipt(receipt);
      workspace.receipts.set(receipt.key, structuredClone(receipt));
      return { commandId, payload };
    });
    const app = buildApp(service, { demoMode: true, workspace });
    for (const index of [0, 2]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tasks",
        headers: {
          "x-demo-user": "u-nurse",
          "x-command-id": requests[index]!.commandId,
        },
        payload: requests[index]!.payload,
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ id: `durable-task-${index}` });
    }
    await app.close();
  });

  it("retains and durably checkpoints a rejected assistant intent audit", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    const app = buildApp(service, { demoMode: true, workspace });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/intents/00000000-0000-4000-8000-000000000999/execute",
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": "00000000-0000-4000-8000-000000000105",
      },
      payload: {
        patientId: "p-anna",
        encounterId: "e-anna",
        purpose: "direct-care",
        resourceVersion: 1,
        explicitlyConfirmed: true,
      },
    });
    expect(response.statusCode).toBe(403);
    expect(service.audit.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "assistant:intent-rejected",
          outcome: "denied",
        }),
      ]),
    );
    expect(workspace.checkpoint?.audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "assistant:intent-rejected" }),
      ]),
    );
    await app.close();
  });

  it("never exposes a staged receipt as success to a concurrent retry", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    workspace.failNext = true;
    const app = buildApp(service, { demoMode: true, workspace });
    const request = {
      method: "POST" as const,
      url: "/api/v1/tasks",
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": "00000000-0000-4000-8000-000000000106",
      },
      payload: {
        patientId: "p-anna",
        title: "Gleichzeitiger Wiederholungsversuch",
        reason: "Nur ein dauerhaft bestätigter Befehl darf Erfolg melden.",
        ownerRole: "registered-nurse",
        priority: "routine",
        dueAt: "2026-09-06T11:00:00.000Z",
      },
    };
    const responses = await Promise.all([
      app.inject(request),
      app.inject(request),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 500,
    ]);
    expect(
      service
        .snapshot("u-nurse")
        .tasks.filter((task) => task.title === request.payload.title),
    ).toHaveLength(1);
    await app.close();
  });

  it("recovers committed success when the workspace response is lost", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    workspace.commitThenFail = true;
    const app = buildApp(service, { demoMode: true, workspace });
    const request = {
      method: "POST" as const,
      url: "/api/v1/tasks",
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": "00000000-0000-4000-8000-000000000107",
      },
      payload: {
        patientId: "p-anna",
        title: "Unklare Commit-Antwort",
        reason: "Der bestätigte Checkpoint entscheidet über den Ausgang.",
        ownerRole: "registered-nurse",
        priority: "routine",
        dueAt: "2026-09-06T12:00:00.000Z",
      },
    };
    const first = await app.inject(request);
    const replay = await app.inject(request);
    expect([first.statusCode, replay.statusCode]).toEqual([201, 201]);
    expect(replay.body).toBe(first.body);
    expect(
      service
        .snapshot("u-nurse")
        .tasks.filter((task) => task.title === request.payload.title),
    ).toHaveLength(1);
    await app.close();
  });

  it("restores a still-valid one-use assistant intent after an API restart", async () => {
    const service = new PflegehelferService();
    const operationalStore = new InMemoryOperationalStore();
    const first = buildApp(service, { demoMode: true, operationalStore });
    await first.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": "00000000-0000-4000-8000-000000000108",
      },
      payload: { patientId: "p-anna" },
    });
    const query = await first.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: { "x-demo-user": "u-nurse" },
      payload: {
        patientId: "p-anna",
        prompt:
          "Notiz: Transfer mit Rollator und Hilfestellung sicher durchgeführt.",
        inputModality: "typed",
      },
    });
    const response = query.json<{
      patientContext: {
        patientId: string;
        encounterId: string;
        resourceVersion: number;
      };
      components: Array<{ type: string; intentToken?: string }>;
    }>();
    const token = response.components.find(
      (component) => component.type === "DraftAction",
    )?.intentToken;
    expect(token).toBeTruthy();
    await first.close();

    const restarted = buildApp(service, { demoMode: true, operationalStore });
    const patientContext = response.patientContext;
    const execution = await restarted.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${token}/execute`,
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": "00000000-0000-4000-8000-000000000109",
      },
      payload: {
        patientId: patientContext.patientId,
        encounterId: patientContext.encounterId,
        resourceVersion: patientContext.resourceVersion,
        purpose: "direct-care",
        explicitlyConfirmed: true,
      },
    });
    expect(execution.statusCode, execution.body).toBe(200);
    expect(execution.json()).toMatchObject({
      patientId: "p-anna",
      status: "pending-provider",
    });
    const replay = await restarted.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${token}/execute`,
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": "00000000-0000-4000-8000-000000000110",
      },
      payload: {
        patientId: patientContext.patientId,
        encounterId: patientContext.encounterId,
        resourceVersion: patientContext.resourceVersion,
        purpose: "direct-care",
        explicitlyConfirmed: true,
      },
    });
    expect(replay.statusCode).toBe(403);
    await restarted.close();
  });

  it("does not copy assistant evidence when the clinical workspace rejects execution", async () => {
    const service = new PflegehelferService();
    const workspace = new RecordingWorkspace();
    const operationalStore = new InMemoryOperationalStore();
    const app = buildApp(service, {
      demoMode: true,
      workspace,
      operationalStore,
    });
    const actorId = "u-nurse";
    const role = "registered-nurse" as const;
    const headers = { "x-demo-user": actorId };
    let workday = await operationalStore.getWorkday(actorId, role);
    for (const patientId of workday.handover.patientIds)
      workday = await operationalStore.applyWorkdayCommand(actorId, role, {
        type: "acknowledge-handover",
        handoverId: workday.handover.id,
        patientId,
        version: workday.handover.version,
      });
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: { patientId: "p-anna" },
    });
    const started = await operationalStore.applyWorkdayCommand(actorId, role, {
      type: "start-episode",
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      kind: "planned",
      title: "Morgenpflege",
    });
    const episodeId = started.activeEpisode!.id;
    const query = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        prompt: "Anna mobilisiert, Blutdruck 128/76.",
        patientId: "p-anna",
        inputModality: "typed",
      },
    });
    const response = query.json<{
      patientContext: {
        patientId: string;
        encounterId: string;
        resourceVersion: number;
      };
      components: Array<{
        type: string;
        intentToken?: string;
        reviewItems?: Array<{ id: string }>;
      }>;
    }>();
    const review = response.components.find(
      (component) => component.type === "DraftAction",
    )!;
    workspace.failNext = true;
    const execution = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${review.intentToken}/execute`,
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        patientId: response.patientContext.patientId,
        encounterId: response.patientContext.encounterId,
        resourceVersion: response.patientContext.resourceVersion,
        purpose: "direct-care",
        explicitlyConfirmed: true,
        reviewedActionIds: review.reviewItems!.map((item) => item.id),
      },
    });
    expect(execution.statusCode).toBe(500);
    expect(
      (await operationalStore.getWorkday(actorId, role)).episodes.find(
        (episode) => episode.id === episodeId,
      )?.draftText,
    ).toBe("");
    await app.close();
  });
});
