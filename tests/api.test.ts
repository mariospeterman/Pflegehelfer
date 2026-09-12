import { afterEach, describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import type { Observation, OutboxSummary } from "../src/core/types.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
const commandHeaders = (user: string, commandId = crypto.randomUUID()) => ({
  "x-demo-user": user,
  "x-command-id": commandId,
});
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("purpose-specific BFF", () => {
  it("never emits clinical or resource identifiers in access logs", async () => {
    const stream = new PassThrough();
    let logs = "";
    stream.on("data", (chunk: Buffer | string) => {
      logs += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    const app = buildApp(undefined, {
      demoMode: true,
      loggerStream: stream,
      loggerLevel: "info",
    });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/simulators/nurse-call",
      headers: commandHeaders("u-it"),
      payload: { patientId: "p-anna" },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/not-a-transition",
      headers: commandHeaders("u-nurse"),
      payload: {},
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Anna Beispiel SH-260901-001 PROMPT-LOG-SECRET",
      },
    });
    const boundary = "pflegehelfer-log-test";
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/transcribe",
      headers: {
        ...commandHeaders("u-nurse"),
        "x-pfh-patient-context": "p-anna",
        "x-pfh-purpose": "direct-care",
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.webm"\r\nContent-Type: audio/webm\r\n\r\nsynthetic-audio\r\n--${boundary}--\r\n`,
      ),
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(logs).not.toContain("p-anna");
    expect(logs).not.toContain("t-bp-anna");
    expect(logs).not.toContain("Anna Beispiel");
    expect(logs).not.toContain("SH-260901-001");
    expect(logs).not.toContain("PROMPT-LOG-SECRET");
    expect(logs).toContain('"route":"/api/v1/simulators/nurse-call"');
  });
  it("does not accept demo identity headers outside explicit demo mode", async () => {
    const app = buildApp(undefined, { demoMode: false });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/snapshot",
      headers: commandHeaders("u-it"),
    });
    expect(response.statusCode).toBe(503);
    const readiness = await app.inject({ method: "GET", url: "/ready" });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({
      status: "not-ready",
      reason: "production-identity-adapter-not-configured",
    });
    const simulator = await app.inject({
      method: "POST",
      url: "/api/v1/simulators/providers/wicare/down",
      headers: { "x-demo-user": "u-it" },
      payload: {},
    });
    expect(simulator.statusCode).toBe(404);
  });
  it("returns only a role-safe snapshot", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/snapshot",
      headers: { "x-demo-user": "u-hr" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      patients: [],
      tasks: [],
      observations: [],
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
  });

  it("validates request bodies and avoids echoing sensitive values", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/observations/drafts",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        code: "temperature",
        value: 999,
        effectiveAt: "not-a-date",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("p-anna");
    expect(response.body).not.toContain("999");
  });

  it("enforces high-assurance and occurrence time on every observation entry path", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: commandHeaders("u-nurse"),
      payload: { patientId: "p-anna" },
    });
    const draftResponse = await app.inject({
      method: "POST",
      url: "/api/v1/observations/drafts",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        code: "oxygen-saturation",
        value: 35,
        effectiveAt: "2026-09-05T09:00:00.000Z",
      },
    });
    expect(draftResponse.statusCode).toBe(201);
    const draft = draftResponse.json<Observation>();
    expect(draft.approvalPolicy).toBe("high-assurance");
    const firstReview = await app.inject({
      method: "POST",
      url: `/api/v1/observation/${draft.id}/approve`,
      headers: commandHeaders("u-nurse"),
      payload: {
        expectedVersion: draft.version,
        patientMrn: "SH-260901-001",
        patientBirthDate: "1941-03-18",
        reviewedDiff: true,
      },
    });
    expect(firstReview.json()).toMatchObject({
      status: "reviewed",
      approvedAt: null,
    });
    const summary = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Patientenprofil",
        inputModality: "typed",
      },
    });
    expect(summary.body).toContain("Sauerstoffsättigung 35 %");
    expect(summary.body).toContain("unabhängige Prüfung ausstehend");
    expect(summary.body).toContain(
      "noch nicht als klinischer Ist-Wert freigegeben",
    );

    const future = await app.inject({
      method: "POST",
      url: "/api/v1/observations/drafts",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        code: "pulse",
        value: 80,
        effectiveAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      },
    });
    expect(future.statusCode).toBe(422);
  });

  it("rejects unknown identity and direct cross-role writes", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers: commandHeaders("does-not-exist"),
      payload: {},
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "AUTH_DENIED" });
  });

  it("rejects contradictory evidence on direct task completion", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const accepted = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers: commandHeaders("u-assistant"),
      payload: {},
    });
    expect(accepted.statusCode).toBe(200);
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/complete",
      headers: commandHeaders("u-assistant"),
      payload: {
        evidence: "Blutdruckkontrolle nicht durchgeführt; später nachholen.",
      },
    });
    expect(rejected.statusCode).toBe(422);
    const snapshot = await app.inject({
      method: "GET",
      url: "/api/v1/snapshot",
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(
      snapshot
        .json<{ tasks: Array<{ id: string; state: string }> }>()
        .tasks.find((task) => task.id === "t-bp-anna")?.state,
    ).toBe("accepted");
  });

  it("keeps treatment instructions out of the generic task endpoint", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/tasks",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        title: "Insulin 20 IE sofort geben",
        reason: "Freie Texteingabe aus dem generischen Aufgabenweg",
        ownerRole: "registered-nurse",
        priority: "urgent",
        dueAt: "2026-09-09T14:00:00.000Z",
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it("exposes degraded-safe readiness independent of AI and providers", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({ method: "GET", url: "/ready" });
    expect(response.json()).toEqual(
      expect.objectContaining({
        status: "ready",
        aiRequired: false,
        providersRequired: false,
        auditValid: true,
      }),
    );
  });

  it("never returns canonical clinical commands from operator endpoints", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/outbox/process",
      headers: commandHeaders("u-it"),
      payload: {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("canonicalCommand");
    expect(response.body).not.toContain("patientId");
  });

  it("requires an explicit version comparison for provider reconciliation", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/observations/drafts",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-luca",
        encounterId: "enc-luca-2026",
        code: "temperature",
        value: 37.8,
        effectiveAt: "2026-09-05T09:00:00.000Z",
      },
    });
    const observation = draft.json<Observation>();
    const wrongContextApproval = await app.inject({
      method: "POST",
      url: `/api/v1/observation/${observation.id}/approve`,
      headers: commandHeaders("u-nurse"),
      payload: {
        expectedVersion: 1,
        patientMrn: "SH-260902-004",
        patientBirthDate: "1937-11-02",
        reviewedDiff: true,
      },
    });
    expect(wrongContextApproval.statusCode).toBe(403);
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: commandHeaders("u-nurse"),
      payload: { patientId: "p-luca" },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/observation/${observation.id}/approve`,
      headers: commandHeaders("u-nurse"),
      payload: {
        expectedVersion: 1,
        patientMrn: "SH-260902-004",
        patientBirthDate: "1937-11-02",
        reviewedDiff: true,
      },
    });
    await app.inject({
      method: "POST",
      url: "/api/v1/simulators/providers/device-gateway/conflict",
      headers: commandHeaders("u-it"),
      payload: {},
    });
    const flushed = await app.inject({
      method: "POST",
      url: "/api/v1/outbox/process",
      headers: commandHeaders("u-it"),
      payload: {},
    });
    const item = flushed.json<OutboxSummary[]>()[0]!;
    expect(item).toMatchObject({ state: "conflict", localVersion: 2 });
    const unconfirmed = await app.inject({
      method: "POST",
      url: `/api/v1/outbox/${item.id}/reconcile`,
      headers: commandHeaders("u-it"),
      payload: { confirmedVersionComparison: false },
    });
    expect(unconfirmed.statusCode).toBe(400);
    const reconciled = await app.inject({
      method: "POST",
      url: `/api/v1/outbox/${item.id}/reconcile`,
      headers: commandHeaders("u-nurse"),
      payload: {
        confirmedVersionComparison: true,
        expectedLocalVersion: item.localVersion,
        expectedLocalHash: item.localHash,
        expectedProviderVersion: item.providerVersion,
        expectedProviderHash: item.providerHash,
      },
    });
    expect(reconciled.json()).toMatchObject({
      state: "pending",
      expectedProviderVersion: "sim-v1",
    });
    expect(reconciled.body).not.toContain("canonicalCommand");
  });

  it("rejects arbitrary free-text rounds and accepts only catalogued follow-ups", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/round-actions",
      headers: commandHeaders("u-physician"),
      payload: {
        patientId: "p-anna",
        decision: "Lasix morgens zusätzlich geben",
        category: "care",
        ownerRole: "registered-nurse",
        deadline: "2026-09-05T15:00:00.000Z",
        requiredConfirmation: "Durchführung",
        targetSystem: "pflegehelfer",
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it("requires and deduplicates client command identifiers", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers: { "x-demo-user": "u-assistant" },
      payload: {},
    });
    expect(missing.statusCode).toBe(400);

    const headers = commandHeaders("u-assistant");
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers,
      payload: {},
    });
    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers,
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toBe(first.body);
    const mismatchedReplay = await app.inject({
      method: "POST",
      url: "/api/v1/tasks/t-bp-anna/accept",
      headers,
      payload: { evidence: "anderer Befehlsinhalt" },
    });
    expect(mismatchedReplay.statusCode).toBe(409);
    expect(mismatchedReplay.json()).toMatchObject({ error: "INVALID_STATE" });
  });

  it("restores only the actor-bound short-lived shift conversation", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const query = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-assistant"),
      payload: {
        patientId: null,
        prompt: "Meine offenen Aufgaben",
        inputModality: "typed",
      },
    });
    expect(query.statusCode).toBe(200);
    const own = await app.inject({
      method: "GET",
      url: "/api/v1/assistant/conversation",
      headers: { "x-demo-user": "u-assistant" },
    });
    expect(own.json<{ turns: unknown[] }>().turns).toHaveLength(1);
    const other = await app.inject({
      method: "GET",
      url: "/api/v1/assistant/conversation",
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(other.json<{ turns: unknown[] }>().turns).toEqual([]);
    const rejectedVoice = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-assistant"),
      payload: {
        patientId: "p-anna",
        prompt: "Blutdruck 128 zu 76 dokumentieren",
        inputModality: "voice",
      },
    });
    expect(rejectedVoice.statusCode).toBe(400);
    const forgedVoice = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-assistant"),
      payload: {
        patientId: "p-anna",
        prompt: "Blutdruck 128 zu 76 dokumentieren",
        inputModality: "voice",
        voiceTranscriptConfirmed: true,
        voiceReceiptId: "00000000-0000-4000-8000-000000000999",
      },
    });
    expect(forgedVoice.statusCode).toBe(403);
    expect(forgedVoice.json()).toMatchObject({ error: "AUTH_DENIED" });
  });

  it("releases authority after a validation error, then consumes it exactly once", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: commandHeaders("u-nurse"),
      payload: { patientId: "p-anna" },
    });
    const query = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Mobilisiert, Puls 82.",
        inputModality: "typed",
      },
    });
    expect(query.statusCode).toBe(200);
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
    const draftAction = response.components.find(
      (component) => component.type === "DraftAction",
    );
    expect(draftAction?.intentToken).toBeTypeOf("string");
    const execution = {
      patientId: response.patientContext.patientId,
      encounterId: response.patientContext.encounterId,
      purpose: "direct-care",
      resourceVersion: response.patientContext.resourceVersion,
      explicitlyConfirmed: true,
      reviewedActionIds: ["action-12"],
    };
    const executeUrl = `/api/v1/assistant/intents/${draftAction!.intentToken}/execute`;
    const invalid = await app.inject({
      method: "POST",
      url: executeUrl,
      headers: commandHeaders("u-nurse"),
      payload: execution,
    });
    expect(invalid.statusCode).toBe(400);

    const valid = await app.inject({
      method: "POST",
      url: executeUrl,
      headers: commandHeaders("u-nurse"),
      payload: {
        ...execution,
        reviewedActionIds: draftAction!.reviewItems!.map((item) => item.id),
      },
    });
    expect(valid.statusCode).toBe(200);
    const replay = await app.inject({
      method: "POST",
      url: executeUrl,
      headers: commandHeaders("u-nurse"),
      payload: {
        ...execution,
        reviewedActionIds: draftAction!.reviewItems!.map((item) => item.id),
      },
    });
    expect(replay.statusCode).toBe(403);
  });

  it("durably revokes an older same-context review when a newer query arrives", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers: commandHeaders("u-nurse"),
      payload: { patientId: "p-anna" },
    });
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Puls 82.",
        inputModality: "typed",
      },
    });
    const firstBody = first.json<{
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
    const stale = firstBody.components.find(
      (component) => component.type === "DraftAction",
    )!;
    await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: "p-anna",
        prompt: "Puls 83.",
        inputModality: "typed",
      },
    });
    const rejected = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${stale.intentToken}/execute`,
      headers: commandHeaders("u-nurse"),
      payload: {
        patientId: firstBody.patientContext.patientId,
        encounterId: firstBody.patientContext.encounterId,
        purpose: "direct-care",
        resourceVersion: firstBody.patientContext.resourceVersion,
        explicitlyConfirmed: true,
        reviewedActionIds: stale.reviewItems!.map((item) => item.id),
      },
    });
    expect(rejected.statusCode).toBe(403);
  });
});
