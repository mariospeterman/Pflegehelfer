import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import type { DurableIntentRecord } from "../src/core/assistant.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("assistant request cancellation", () => {
  it("retains one-use authority after a normally delivered HTTP response", async () => {
    const operationalStore = new InMemoryOperationalStore();
    const app = buildApp(undefined, {
      demoMode: true,
      operationalStore,
      modelGateway: new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: {
        "x-demo-user": "u-assistant",
        "x-command-id": crypto.randomUUID(),
      },
      payload: { patientId: "p-luca" },
    });

    let stored:
      | Parameters<InMemoryOperationalStore["storeIntentAuthority"]>[0]
      | undefined;
    const originalStore =
      operationalStore.storeIntentAuthority.bind(operationalStore);
    vi.spyOn(operationalStore, "storeIntentAuthority").mockImplementation(
      async (input) => {
        stored = input;
        await originalStore(input);
      },
    );

    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const body = JSON.stringify({
      patientId: "p-luca",
      prompt: "Luca mobilisiert, etwa 200 ml getrunken. Gewicht später.",
      inputModality: "typed",
    });
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(
        `${address}/api/v1/assistant/query`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "x-demo-user": "u-assistant",
            "x-command-id": crypto.randomUUID(),
          },
        },
        (response) => {
          response.resume();
          response.once("end", () => {
            if (response.statusCode === 200) resolve();
            else reject(new Error(`unexpected-status:${response.statusCode}`));
          });
        },
      );
      request.once("error", reject);
      request.end(body);
    });

    expect(stored).toBeDefined();
    const authority = stored!;
    await expect(
      operationalStore.loadIntentAuthority({
        tokenHash: authority.tokenHash,
        actorId: authority.record.actorId,
        sessionId: authority.sessionId,
        threadId: authority.threadId,
        contextRevision: authority.contextRevision,
        patientId: authority.record.patientId,
        encounterId: authority.record.encounterId,
      }),
    ).resolves.toMatchObject({
      actorId: authority.record.actorId,
      command: "care-update:draft",
    });
  });

  it.each(["/api/v1/assistant/query", "/api/v1/assistant/query/stream"])(
    "revokes authority when the client disconnects during durable insertion at %s",
    async (url) => {
      const operationalStore = new InMemoryOperationalStore();
      const app = buildApp(undefined, {
        demoMode: true,
        operationalStore,
        modelGateway: new ModelGateway({ PFH_AI_MODE: "deterministic" }),
      });
      apps.push(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/assistant/context",
        headers: {
          "x-demo-user": "u-nurse",
          "x-command-id": crypto.randomUUID(),
        },
        payload: { patientId: "p-anna" },
      });

      let clientRequest: ReturnType<typeof httpRequest> | null = null;
      let stored:
        | {
            tokenHash: string;
            record: DurableIntentRecord;
            sessionId: string;
            threadId: string;
            contextRevision: number;
          }
        | undefined;
      const originalStore =
        operationalStore.storeIntentAuthority.bind(operationalStore);
      const insertionReached = new Promise<void>((resolve) => {
        vi.spyOn(operationalStore, "storeIntentAuthority").mockImplementation(
          async (input) => {
            stored = input;
            clientRequest?.destroy();
            await new Promise((finish) => setTimeout(finish, 10));
            await originalStore(input);
            resolve();
          },
        );
      });

      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const body = JSON.stringify({
        patientId: "p-anna",
        prompt: "Mobilisiert, Puls 82.",
        inputModality: "typed",
      });
      await new Promise<void>((resolve) => {
        clientRequest = httpRequest(
          `${address}${url}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
              "x-demo-user": "u-nurse",
              "x-command-id": crypto.randomUUID(),
            },
          },
          (response) => {
            response.resume();
            response.once("end", resolve);
          },
        );
        clientRequest.once("error", resolve);
        clientRequest.end(body);
      });
      await insertionReached;
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(stored).toBeDefined();
      const authority = stored!;
      await expect(
        operationalStore.loadIntentAuthority({
          tokenHash: authority.tokenHash,
          actorId: authority.record.actorId,
          sessionId: authority.sessionId,
          threadId: authority.threadId,
          contextRevision: authority.contextRevision,
          patientId: authority.record.patientId,
          encounterId: authority.record.encounterId,
        }),
      ).resolves.toBeNull();
    },
  );

  it.each([
    ["/api/v1/assistant/query", 500],
    ["/api/v1/assistant/query/stream", 200],
  ])(
    "revokes durable authority when conversation persistence fails at %s",
    async (url, expectedStatus) => {
      const operationalStore = new InMemoryOperationalStore();
      const app = buildApp(undefined, {
        demoMode: true,
        operationalStore,
        modelGateway: new ModelGateway({ PFH_AI_MODE: "deterministic" }),
      });
      apps.push(app);
      await app.inject({
        method: "POST",
        url: "/api/v1/assistant/context",
        headers: {
          "x-demo-user": "u-nurse",
          "x-command-id": crypto.randomUUID(),
        },
        payload: { patientId: "p-anna" },
      });

      let stored:
        | Parameters<InMemoryOperationalStore["storeIntentAuthority"]>[0]
        | undefined;
      const originalStore =
        operationalStore.storeIntentAuthority.bind(operationalStore);
      vi.spyOn(operationalStore, "storeIntentAuthority").mockImplementation(
        async (input) => {
          stored = input;
          await originalStore(input);
        },
      );
      vi.spyOn(
        operationalStore,
        "appendConversationTurn",
      ).mockRejectedValueOnce(new Error("synthetic-thread-write-failure"));

      const response = await app.inject({
        method: "POST",
        url,
        headers: {
          "x-demo-user": "u-nurse",
          "x-command-id": crypto.randomUUID(),
        },
        payload: {
          patientId: "p-anna",
          prompt: "Mobilisiert, Puls 82.",
          inputModality: "typed",
        },
      });

      expect(response.statusCode).toBe(expectedStatus);
      if (url.endsWith("/stream"))
        expect(response.body).toContain(
          "Die Assistenzantwort konnte nicht sicher übertragen werden.",
        );
      expect(stored).toBeDefined();
      const authority = stored!;
      await expect(
        operationalStore.loadIntentAuthority({
          tokenHash: authority.tokenHash,
          actorId: authority.record.actorId,
          sessionId: authority.sessionId,
          threadId: authority.threadId,
          contextRevision: authority.contextRevision,
          patientId: authority.record.patientId,
          encounterId: authority.record.encounterId,
        }),
      ).resolves.toBeNull();
    },
  );
});
