import { EventEmitter } from "node:events";
import pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";
import { monitorPostgresPool } from "../src/infrastructure/postgres-pool-health.js";

const { Pool } = pg;
const testDatabaseUrl = process.env.PFH_TEST_DATABASE_URL;

class SyntheticPool extends EventEmitter {
  query = vi.fn<(query: unknown) => Promise<unknown>>(() =>
    Promise.resolve({ rows: [] }),
  );
}

describe("PostgreSQL pool recovery boundary", () => {
  it("contains an unexpected idle-client error and recovers only after a probe", async () => {
    const pool = new SyntheticPool();
    const health = monitorPostgresPool(pool);

    expect(() =>
      pool.emit("error", new Error("connection terminated")),
    ).not.toThrow();
    expect(health.available()).toBe(false);

    expect(await health.probe()).toBe(true);
    expect(health.available()).toBe(true);
    const probeQuery = pool.query.mock.calls[0]?.[0] as {
      query_timeout?: unknown;
      signal?: unknown;
      text?: unknown;
    };
    expect(probeQuery).toMatchObject({
      text: "SELECT 1",
      query_timeout: 2_000,
    });
    expect(probeQuery.signal).toBeInstanceOf(AbortSignal);

    health.dispose();
    expect(pool.listenerCount("error")).toBe(0);
  });

  it("stays unavailable while the bounded readiness probe fails", async () => {
    const pool = new SyntheticPool();
    pool.query.mockRejectedValueOnce(new Error("database in recovery"));
    const health = monitorPostgresPool(pool);

    expect(await health.probe()).toBe(false);
    expect(health.available()).toBe(false);

    health.dispose();
  });

  it("contains errors emitted while a client is checked out", () => {
    const pool = new SyntheticPool();
    const client = new EventEmitter();
    const health = monitorPostgresPool(pool);

    pool.emit("connect", client);
    expect(() =>
      client.emit("error", new Error("transaction connection lost")),
    ).not.toThrow();
    expect(health.available()).toBe(false);

    health.dispose();
  });

  it("bounds a probe even when a pool query never settles", async () => {
    const pool = new SyntheticPool();
    pool.query.mockReturnValueOnce(new Promise(() => undefined));
    const health = monitorPostgresPool(pool, 20);

    const startedAt = performance.now();
    expect(await health.probe()).toBe(false);
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(health.available()).toBe(false);

    health.dispose();
  });
});

describe.skipIf(!testDatabaseUrl)(
  "PostgreSQL pool recovery against a real server",
  () => {
    it("survives forced idle-connection termination and reconnects on a later probe", async () => {
      const storeUrl = new URL(testDatabaseUrl!);
      storeUrl.searchParams.set("application_name", "pfh-recovery-store");
      const adminUrl = new URL(testDatabaseUrl!);
      adminUrl.searchParams.set("application_name", "pfh-recovery-admin");
      const store = new PostgresOperationalStore(storeUrl.toString());
      const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
      try {
        expect(await store.health()).toBe(true);
        const connection = await admin.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity
           WHERE datname=current_database()
             AND application_name='pfh-recovery-store'
             AND pid<>pg_backend_pid()
           ORDER BY backend_start DESC LIMIT 1`,
        );
        expect(connection.rows[0]?.pid).toBeTypeOf("number");
        const terminated = await admin.query<{ terminated: boolean }>(
          "SELECT pg_terminate_backend($1) AS terminated",
          [connection.rows[0]!.pid],
        );
        expect(terminated.rows[0]?.terminated).toBe(true);

        await vi.waitFor(
          async () => {
            expect(await store.health()).toBe(true);
          },
          { timeout: 10_000, interval: 100 },
        );
      } finally {
        await Promise.all([store.close(), admin.end()]);
      }
    });

    it("contains a checked-out client failure between transaction statements", async () => {
      const guardedUrl = new URL(testDatabaseUrl!);
      guardedUrl.searchParams.set(
        "application_name",
        "pfh-recovery-checked-out",
      );
      const adminUrl = new URL(testDatabaseUrl!);
      adminUrl.searchParams.set("application_name", "pfh-recovery-admin");
      const pool = new Pool({
        connectionString: guardedUrl.toString(),
        max: 1,
        connectionTimeoutMillis: 2_000,
      });
      const health = monitorPostgresPool(pool);
      const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
      const client = await pool.connect();
      try {
        const backend = await client.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        );
        await admin.query("SELECT pg_terminate_backend($1)", [
          backend.rows[0]!.pid,
        ]);
        await expect(client.query("SELECT 1")).rejects.toThrow();
        await vi.waitFor(
          () => {
            expect(health.available()).toBe(false);
          },
          { timeout: 2_000, interval: 20 },
        );
      } finally {
        client.release(true);
      }

      await vi.waitFor(
        async () => {
          expect(await health.probe()).toBe(true);
        },
        { timeout: 10_000, interval: 100 },
      );
      await Promise.all([pool.end(), admin.end()]);
      health.dispose();
    });
  },
);
