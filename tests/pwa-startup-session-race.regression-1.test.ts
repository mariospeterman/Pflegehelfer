import pg from "pg";
import { describe, expect, it } from "vitest";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const { Pool } = pg;

describe.runIf(Boolean(databaseUrl))("PWA startup session recovery", () => {
  // Regression: ISSUE-001 — stale site-bound session caused a fatal startup screen
  // Found by /qa on 2026-09-14
  // Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-14.md
  it("retires an active session bound to a stale site before starting the current session", async () => {
    const store = new PostgresOperationalStore(databaseUrl!);
    const inspection = new Pool({ connectionString: databaseUrl });
    try {
      await store.initialize();
      await store.resetDemoState();
      const stale = await store.getOrStartSession(
        "u-assistant",
        "care-assistant",
      );
      await inspection.query(
        `UPDATE assistant_threads
         SET site_id='legacy-unassigned'
         WHERE id=$1`,
        [stale.threadId],
      );

      const current = await store.getOrStartSession(
        "u-assistant",
        "care-assistant",
      );

      expect(current.id).not.toBe(stale.id);
      await expect(
        inspection.query<{ status: string }>(
          `SELECT status FROM working_sessions
           WHERE id=$1`,
          [stale.id],
        ),
      ).resolves.toMatchObject({ rows: [{ status: "paused" }] });
      await expect(
        inspection.query<{ active: number }>(
          `SELECT count(*)::int AS active FROM working_sessions
           WHERE actor_id='u-assistant' AND status='active'`,
        ),
      ).resolves.toMatchObject({ rows: [{ active: 1 }] });
    } finally {
      await store.resetDemoState();
      await inspection.end();
      await store.close();
    }
  });
});
