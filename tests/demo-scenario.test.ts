import { afterEach, describe, expect, it } from "vitest";
import {
  baselineDemoScenario,
  createScenarioRun,
  scenarioDigest,
} from "../src/core/demo-scenario.js";
import { buildApp } from "../src/server/app.js";
import type { WorkdayView } from "../src/core/workday.js";
import { InMemoryDemoScenarioStore } from "../src/infrastructure/demo-scenario-store.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";
import { seedSyntheticDemoWorkspace } from "../src/infrastructure/demo-workspace.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const headers = (userId: string) => ({
  "x-demo-user": userId,
  "x-command-id": crypto.randomUUID(),
});

describe("versioned synthetic scenarios", () => {
  it("validates the canonical baseline and rebases a new run once", () => {
    expect(baselineDemoScenario.state.patients).toHaveLength(15);
    expect(baselineDemoScenario.state.users).toHaveLength(15);
    const now = new Date("2026-10-10T08:00:00.000Z");
    const run = createScenarioRun({ mode: "start-today", now });
    expect(run.clock.mode).toBe("start-today");
    expect(run.clock.offsetMs).toBe(
      now.getTime() - Date.parse(baselineDemoScenario.clock.anchor),
    );
    expect(scenarioDigest(run.state)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("adds a ninth assigned patient without TypeScript fixture changes and exports it", async () => {
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);

    const denied = await app.inject({
      method: "GET",
      url: "/api/v1/admin/demo",
      headers: { "x-demo-user": "u-nurse" },
    });
    expect(denied.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/admin/demo/patients",
      headers: headers("u-it"),
      payload: {
        id: "p-klara",
        displayName: "Klara Testfall",
        birthDate: "1947-04-22",
        mrn: "SH-260916-018",
        room: "219",
        encounterId: "enc-klara-2026",
        allergyStatus: "unknown",
        allergies: [],
        risks: ["Sturzrisiko bei Müdigkeit"],
        diagnoses: ["Dekonditionierung nach längerer Hospitalisation"],
        careGoals: ["Sicherer Transfer mit Rollator"],
        medicationSummary: ["Medikation im führenden KIS – nur lesbar"],
        carePreferences: ["Tagesplan vor Mobilisation erklären"],
        communicationPreferences: ["Kurze Schritte ankündigen"],
        dailyRoutine: ["Ruhepause nach dem Mittagessen"],
      },
    });
    expect(created.statusCode).toBe(201);

    const existing = baselineDemoScenario.state.users.find(
      (item) => item.id === "u-assistant",
    )!.patientIds;
    const task = await app.inject({
      method: "POST",
      url: "/api/v1/admin/demo/task-assignment",
      headers: headers("u-it"),
      payload: {
        task: {
          id: "t-mobilise-klara",
          patientId: "p-klara",
          title: "Morgenpflege und Mobilisation vorbereiten",
          reason: "Synthetischer Rehabilitationsplan",
          ownerRole: "care-assistant",
          ownerId: "u-assistant",
          priority: "routine",
          escalation: "Bei Abweichung Pflegefachperson informieren",
        },
        dueOffsetMinutes: 165,
        actorId: "u-assistant",
        patientIds: ["p-klara"],
      },
    });
    expect(task.statusCode).toBe(201);
    expect(task.json<{ patientIds: string[] }>().patientIds).toEqual(
      expect.arrayContaining([...existing, "p-klara"]),
    );
    expect(
      Date.parse(task.json<{ task: { dueAt: string } }>().task.dueAt),
    ).toBeGreaterThan(Date.parse(baselineDemoScenario.clock.anchor));

    const snapshot = await app.inject({
      method: "GET",
      url: "/api/v1/snapshot",
      headers: { "x-demo-user": "u-assistant" },
    });
    expect(snapshot.statusCode).toBe(200);
    expect(
      snapshot.json<{ patients: Array<{ id: string }> }>().patients,
    ).toContainEqual(expect.objectContaining({ id: "p-klara" }));

    const workday = await app.inject({
      method: "GET",
      url: "/api/v1/workday",
      headers: { "x-demo-user": "u-assistant" },
    });
    expect(workday.statusCode).toBe(200);
    expect(workday.json<WorkdayView>().handover.patientIds).toHaveLength(9);
    expect(workday.json<WorkdayView>().plan).toContainEqual(
      expect.objectContaining({ patientId: "p-klara" }),
    );

    const exported = await app.inject({
      method: "GET",
      url: "/api/v1/admin/demo/export",
      headers: { "x-demo-user": "u-it" },
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers["cache-control"]).toBe("no-store");
    const bundle = exported.json<{
      run: { state: { patients: Array<{ id: string }> } };
      digest: string;
    }>();
    expect(bundle.run.state.patients).toContainEqual(
      expect.objectContaining({ id: "p-klara" }),
    );
    expect(bundle.digest).toBe(scenarioDigest(bundle.run));
  });

  it("clones baseline separately from the current editable run", async () => {
    const scenarioStore = new InMemoryDemoScenarioStore();
    const operationalStore = new InMemoryOperationalStore();
    await operationalStore.initialize();
    await seedSyntheticDemoWorkspace(operationalStore);
    const app = buildApp(undefined, {
      demoMode: true,
      scenarioStore,
      operationalStore,
    });
    apps.push(app);
    const current = await app.inject({
      method: "GET",
      url: "/api/v1/admin/demo",
      headers: { "x-demo-user": "u-it" },
    });
    const baselineClone = await app.inject({
      method: "POST",
      url: "/api/v1/admin/demo/runs",
      headers: headers("u-it"),
      payload: {
        source: "baseline",
        label: "Unveränderte Abnahmebasis",
        clockMode: "frozen",
      },
    });
    expect(baselineClone.statusCode).toBe(201);
    expect(baselineClone.json()).toMatchObject({
      status: "created-inactive",
      inventory: { patients: 15 },
    });
    const cloneBody = baselineClone.json<{
      runId: string;
    }>();
    const currentBody = current.json<{ run: { runId: string } }>();
    expect(cloneBody.runId).not.toBe(currentBody.run.runId);

    const currentClone = await app.inject({
      method: "POST",
      url: "/api/v1/admin/demo/runs",
      headers: headers("u-it"),
      payload: {
        source: "current",
        label: "Arbeitskopie mit Zusammenarbeit",
        clockMode: "frozen",
      },
    });
    expect(currentClone.statusCode).toBe(201);
    const currentCloneBody = currentClone.json<{ runId: string }>();
    const storedClone = await scenarioStore.get(currentCloneBody.runId);
    expect(storedClone?.workspace.comments).toHaveLength(2);
    expect(storedClone?.workspace.attachments).toHaveLength(2);
  });
});
