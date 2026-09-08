import { afterEach, describe, expect, it } from "vitest";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("interrupted nursing shift", () => {
  it("denies a nursing workday without an exact actor and role assignment", async () => {
    const store = new InMemoryOperationalStore();
    await expect(
      store.getWorkday("u-unassigned", "registered-nurse"),
    ).rejects.toThrow(/keine Schichtzuweisung/);
  });

  it("derives the workday shift from the configured staff assignment", async () => {
    const store = new InMemoryOperationalStore();
    const workday = await store.getWorkday(
      "u-nurse-evening",
      "registered-nurse",
    );
    expect(workday.handover.shiftKey).toMatch(/-late$/);
    expect(workday.handover.patientIds).toHaveLength(6);
  });

  it("preserves responsibility through handover, interruption, alarm and next-shift transfer", async () => {
    const store = new InMemoryOperationalStore();
    const actor = "u-nurse";
    const role = "registered-nurse" as const;

    let workday = await store.getWorkday(actor, role);
    expect(workday.stage).toBe("handover");
    for (const patientId of workday.handover.patientIds) {
      workday = await store.applyWorkdayCommand(actor, role, {
        type: "acknowledge-handover",
        patientId,
        version: workday.handover.version,
      });
    }
    expect(workday.stage).toBe("plan");

    workday = await store.applyWorkdayCommand(actor, role, {
      type: "start-episode",
      patientId: "p-anna",
      encounterId: "enc-anna",
      kind: "planned",
      title: "Morgenpflege und Mobilisation",
    });
    expect((await store.getOrStartSession(actor, role)).patientId).toBe(
      "p-anna",
    );
    const annaEpisode = workday.activeEpisode!;
    workday = await store.applyWorkdayCommand(actor, role, {
      type: "pause-episode",
      episodeId: annaEpisode.id,
      reason: "interruption",
    });
    expect(workday.resumableEpisode?.patientId).toBe("p-anna");

    workday = await store.applyWorkdayCommand(actor, role, {
      type: "start-episode",
      patientId: "p-luca",
      encounterId: "enc-luca",
      kind: "alarm",
      title: "Nurse-call: ungeplanter Zimmerbesuch",
    });
    expect((await store.getOrStartSession(actor, role)).patientId).toBe(
      "p-luca",
    );
    const alarmEpisode = workday.activeEpisode!;
    workday = await store.applyWorkdayCommand(actor, role, {
      type: "complete-episode",
      episodeId: alarmEpisode.id,
      evidence:
        "Beim Aufstehen unterstützt; keine neuen Beschwerden angegeben.",
    });
    workday = await store.applyWorkdayCommand(actor, role, {
      type: "resume-episode",
      episodeId: annaEpisode.id,
    });
    expect((await store.getOrStartSession(actor, role)).patientId).toBe(
      "p-anna",
    );
    workday = await store.applyWorkdayCommand(actor, role, {
      type: "complete-episode",
      episodeId: annaEpisode.id,
      evidence: "Morgenpflege durchgeführt und mit Rollator mobilisiert.",
    });
    for (const patientId of workday.handover.patientIds.filter(
      (id) => id !== "p-anna",
    )) {
      workday = await store.applyWorkdayCommand(actor, role, {
        type: "start-episode",
        patientId,
        encounterId: `enc-${patientId.slice(2)}-2026`,
        kind: "planned",
        title: "Geplante Tagesversorgung",
      });
      workday = await store.applyWorkdayCommand(actor, role, {
        type: "complete-episode",
        episodeId: workday.activeEpisode!.id,
        evidence: "Geplante Versorgung durchgeführt und dokumentiert.",
      });
    }
    workday = await store.applyWorkdayCommand(actor, role, {
      type: "close-shift",
    });

    expect(workday.stage).toBe("closed");
    expect(workday.handover.status).toBe("transferred");
    expect(workday.episodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ patientId: "p-anna", state: "completed" }),
        expect.objectContaining({
          patientId: "p-luca",
          kind: "alarm",
          state: "completed",
        }),
      ]),
    );
    expect(
      workday.episodes.filter((episode) => episode.kind === "planned"),
    ).toHaveLength(6);
    expect((await store.getWorkday(actor, role)).stage).toBe("closed");
  });

  it("makes acknowledgment idempotent and refuses transfer with paused responsibility", async () => {
    const store = new InMemoryOperationalStore();
    const actor = "u-assistant";
    const role = "care-assistant" as const;
    const initial = await store.getWorkday(actor, role);
    await store.applyWorkdayCommand(actor, role, {
      type: "acknowledge-handover",
      patientId: "p-anna",
      version: initial.handover.version,
    });
    const duplicate = await store.applyWorkdayCommand(actor, role, {
      type: "acknowledge-handover",
      patientId: "p-anna",
      version: initial.handover.version,
    });
    expect(duplicate.handover.acknowledgedPatientIds).toEqual(["p-anna"]);

    await store.applyWorkdayCommand(actor, role, {
      type: "start-episode",
      patientId: "p-anna",
      encounterId: "enc-anna",
      kind: "planned",
      title: "Morgenpflege",
    });
    const active = (await store.getWorkday(actor, role)).activeEpisode!;
    await store.applyWorkdayCommand(actor, role, {
      type: "pause-episode",
      episodeId: active.id,
      reason: "pause",
    });
    await expect(
      store.applyWorkdayCommand(actor, role, { type: "close-shift" }),
    ).rejects.toThrow("PAUSED_EPISODE_REQUIRES_RESOLUTION");
  });

  it("refuses transfer while any planned patient responsibility is unresolved", async () => {
    const store = new InMemoryOperationalStore();
    const actor = "u-nurse";
    const role = "registered-nurse" as const;
    const initial = await store.getWorkday(actor, role);
    for (const patientId of initial.handover.patientIds)
      await store.applyWorkdayCommand(actor, role, {
        type: "acknowledge-handover",
        patientId,
        version: initial.handover.version,
      });
    let workday = await store.applyWorkdayCommand(actor, role, {
      type: "start-episode",
      patientId: "p-anna",
      encounterId: "enc-anna",
      kind: "planned",
      title: "Morgenpflege",
    });
    workday = await store.applyWorkdayCommand(actor, role, {
      type: "complete-episode",
      episodeId: workday.activeEpisode!.id,
      evidence: "Morgenpflege abgeschlossen.",
    });
    expect(
      workday.plan.find((item) => item.patientId === "p-luca")?.status,
    ).toBe("planned");
    await expect(
      store.applyWorkdayCommand(actor, role, { type: "close-shift" }),
    ).rejects.toThrow("PLANNED_RESPONSIBILITY_REQUIRES_RESOLUTION");
  });

  it("rejects a request-supplied encounter that does not belong to the patient", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workday",
      headers: {
        "x-demo-user": "u-nurse",
        "x-command-id": crypto.randomUUID(),
      },
      payload: {
        type: "start-episode",
        patientId: "p-anna",
        encounterId: "enc-luca",
        kind: "planned",
        title: "Morgenpflege",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: "VALIDATION" });
  });

  it("rejects a mismatched encounter during an interruption", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const headers = {
      "x-demo-user": "u-nurse",
      "x-command-id": crypto.randomUUID(),
    };
    const started = await app.inject({
      method: "POST",
      url: "/api/v1/workday",
      headers,
      payload: {
        type: "start-episode",
        patientId: "p-anna",
        encounterId: "enc-anna-2026",
        kind: "planned",
        title: "Morgenpflege",
      },
    });
    const activeEpisode = started.json<{ activeEpisode: { id: string } }>()
      .activeEpisode.id;
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/workday",
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        type: "interrupt-and-start",
        episodeId: activeEpisode,
        patientId: "p-luca",
        encounterId: "enc-anna-2026",
        title: "Nurse-call Zimmer 207",
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: "VALIDATION" });
  });

  it("does not expose the clinical workday to non-nursing roles", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    for (const user of ["u-hr", "u-it", "u-manager", "u-transport"]) {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/workday",
        headers: { "x-demo-user": user },
      });
      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain("p-anna");
    }
  });

  it("lets natural conversation atomically pause current work and enter the next room", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const user = "u-nurse";
    const headers = { "x-demo-user": user };
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/assistant/context",
          headers: { ...headers, "x-command-id": crypto.randomUUID() },
          payload: { patientId: "p-anna" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/workday",
          headers: { ...headers, "x-command-id": crypto.randomUUID() },
          payload: {
            type: "start-episode",
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
            kind: "planned",
            title: "Morgenpflege",
          },
        })
      ).statusCode,
    ).toBe(200);
    const answer = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        prompt: "Anna pausieren, ich gehe zu Zimmer 207.",
        patientId: "p-anna",
        inputModality: "typed",
      },
    });
    expect(answer.statusCode).toBe(200);
    const response = answer.json<{
      components: Array<{
        type: string;
        title?: string;
        intentToken?: string;
        reviewItems?: Array<{ id: string; kind: string }>;
      }>;
      patientContext: {
        patientId: string;
        encounterId: string;
        resourceVersion: number;
      };
    }>();
    const review = response.components.find(
      (component: { type: string }) => component.type === "DraftAction",
    );
    if (!review?.intentToken || !review.reviewItems)
      throw new Error("expected workflow review");
    expect(review.title).toContain("verstanden");
    expect(review.reviewItems).toHaveLength(1);
    expect(review.reviewItems[0]?.kind).toBe("workflow");
    const execution = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${review.intentToken}/execute`,
      headers: { ...headers, "x-command-id": crypto.randomUUID() },
      payload: {
        patientId: response.patientContext.patientId,
        encounterId: response.patientContext.encounterId,
        purpose: "direct-care",
        resourceVersion: response.patientContext.resourceVersion,
        explicitlyConfirmed: true,
        reviewedActionIds: review.reviewItems.map(
          (item: { id: string }) => item.id,
        ),
      },
    });
    expect(execution.statusCode).toBe(200);
    expect(execution.json()).toMatchObject({
      workflowChanged: true,
      workday: {
        activeEpisode: { patientId: "p-luca", kind: "spontaneous" },
        resumableEpisode: { patientId: "p-anna", state: "paused" },
      },
    });
    const session = await app.inject({
      method: "GET",
      url: "/api/v1/working-session",
      headers,
    });
    expect(session.json()).toMatchObject({ patientId: "p-luca" });
  });
});
