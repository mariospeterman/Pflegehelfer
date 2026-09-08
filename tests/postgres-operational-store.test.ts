import pg from "pg";
import { describe, expect, it } from "vitest";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

describe.runIf(Boolean(databaseUrl))("PostgreSQL operational store", () => {
  it("reuses one active session when initial PWA requests race", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const actorId = "u-assistant";

    try {
      await store.initialize();
      await store.resetDemoState();
      const sessions = await Promise.all(
        Array.from({ length: 8 }, () =>
          store.getOrStartSession(actorId, "care-assistant"),
        ),
      );

      expect(new Set(sessions.map((session) => session.id)).size).toBe(1);
      expect(new Set(sessions.map((session) => session.threadId)).size).toBe(1);
    } finally {
      await store.close();
    }
  });

  it("pauses an expired session before starting its replacement", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspectionPool = new Pool({ connectionString: databaseUrl });
    const actorId = "u-assistant";

    try {
      await store.initialize();
      await store.resetDemoState();
      const expired = await store.getOrStartSession(actorId, "care-assistant");
      await inspectionPool.query(
        `UPDATE assistant_threads SET expires_at=now() - interval '1 minute'
         WHERE organization_id=$1 AND id=$2`,
        [expired.organizationId, expired.threadId],
      );

      const replacement = await store.getOrStartSession(
        actorId,
        "care-assistant",
      );
      const statuses = await inspectionPool.query<{
        id: string;
        status: string;
      }>(
        `SELECT id::text, status FROM working_sessions
         WHERE organization_id=$1 AND actor_id=$2 ORDER BY started_at`,
        [expired.organizationId, actorId],
      );

      expect(replacement.id).not.toBe(expired.id);
      expect(statuses.rows).toEqual([
        { id: expired.id, status: "paused" },
        { id: replacement.id, status: "active" },
      ]);
    } finally {
      await Promise.all([store.close(), inspectionPool.end()]);
    }
  });

  it("atomically binds a started work episode to the assistant thread", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const actorId = "u-assistant";

    try {
      await store.initialize();
      await store.resetDemoState();
      const initial = await store.getOrStartSession(actorId, "care-assistant");
      const workday = await store.applyWorkdayCommand(
        actorId,
        "care-assistant",
        {
          type: "start-episode",
          patientId: "p-luca",
          encounterId: "enc-luca-2026",
          kind: "planned",
          title: "Morgenpflege und Mobilisation",
        },
      );
      const current = await store.getOrStartSession(actorId, "care-assistant");

      expect(workday.activeEpisode).toMatchObject({
        patientId: "p-luca",
        state: "active",
      });
      expect(current.patientId).toBe("p-luca");
      expect(current.contextRevision).toBe(initial.contextRevision + 1);
      expect(current.currentStepId).toBe("work");
    } finally {
      await store.close();
    }
  });
});
