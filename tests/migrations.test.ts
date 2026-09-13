import type pg from "pg";
import { describe, expect, it } from "vitest";
import {
  loadMigrationFiles,
  runMigrations,
  verifyMigrationHistory,
} from "../src/infrastructure/migrations.js";

describe("immutable migration ledger", () => {
  it("discovers a consecutive migration history with stable digests", async () => {
    const migrations = await loadMigrationFiles();
    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "001_operational_kernel.sql" },
      { version: 2, name: "002_immutable_migration_history.sql" },
      { version: 3, name: "003_immutable_handover_content.sql" },
      { version: 4, name: "004_zero_assignment_handover.sql" },
      { version: 5, name: "005_clinical_handover_snapshot.sql" },
      { version: 6, name: "006_single_handover_authority.sql" },
      { version: 7, name: "007_atomic_local_acceptance.sql" },
    ]);
    expect(
      migrations.every(({ checksum }) => /^[a-f0-9]{64}$/.test(checksum)),
    ).toBe(true);
  });

  it("fails closed when an executed migration changes", async () => {
    const migrations = await loadMigrationFiles();
    expect(() =>
      verifyMigrationHistory(
        migrations,
        migrations.map((migration) => ({
          ...migration,
          checksum:
            migration.version === 1 ? "0".repeat(64) : migration.checksum,
          provenance: "verified-current-run" as const,
        })),
        false,
      ),
    ).toThrow("MIGRATION_CHECKSUM_MISMATCH:1");
  });

  it("requires an explicit demo-only exception for legacy provenance", async () => {
    const migrations = await loadMigrationFiles();
    const history = migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
      provenance:
        migration.version === 1
          ? ("legacy-unverified" as const)
          : ("verified-current-run" as const),
    }));
    expect(() => verifyMigrationHistory(migrations, history, false)).toThrow(
      "MIGRATION_LEGACY_UNVERIFIED:1",
    );
    expect(() =>
      verifyMigrationHistory(migrations, history, true),
    ).not.toThrow();
  });

  it.each(["checksum", "name"] as const)(
    "rejects a historical %s mismatch before pending SQL can have an effect",
    async (mismatch) => {
      const migrations = await loadMigrationFiles();
      const pendingSqlEffects: string[] = [];
      const client = {
        query<T>(sql: string, parameters?: unknown[]) {
          if (sql.includes("pg_advisory_lock"))
            return Promise.resolve({ rows: [] as T[] });
          if (sql.includes("pg_advisory_unlock"))
            return Promise.resolve({ rows: [] as T[] });
          if (sql.includes("to_regclass"))
            return Promise.resolve({ rows: [{ present: true }] });
          if (sql.includes("SELECT version FROM pfh_schema_migrations"))
            return Promise.resolve({ rows: [{ version: 1 }] as T[] });
          if (sql.includes("FROM pfh_migration_history"))
            return Promise.resolve({
              rows: [
                {
                  version: 1,
                  name:
                    mismatch === "name"
                      ? "001_unexpected_name.sql"
                      : migrations[0]!.name,
                  checksum:
                    mismatch === "checksum"
                      ? "0".repeat(64)
                      : migrations[0]!.checksum,
                  provenance: "verified-current-run",
                },
              ] as T[],
            });
          pendingSqlEffects.push(`${parameters?.length ?? 0}:${sql}`);
          return Promise.resolve({ rows: [] as T[] });
        },
        release() {},
      };
      const pool = {
        connect() {
          return Promise.resolve(client);
        },
      } as unknown as pg.Pool;

      await expect(runMigrations(pool)).rejects.toThrow(
        "MIGRATION_CHECKSUM_MISMATCH:1",
      );
      expect(pendingSqlEffects).toEqual([]);
    },
  );

  it("records a non-self-transactional migration in the same transaction", async () => {
    const migrations = await loadMigrationFiles();
    const history = migrations.slice(0, 6).map((migration) => ({
      version: migration.version,
      name: migration.name,
      checksum: migration.checksum,
      provenance: "verified-current-run" as const,
    }));
    const calls: string[] = [];
    const client = {
      query<T>(sql: string, parameters?: unknown[]) {
        calls.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
        if (sql.includes("pg_advisory_"))
          return Promise.resolve({ rows: [] as T[] });
        if (sql.includes("to_regclass"))
          return Promise.resolve({ rows: [{ present: true }] as T[] });
        if (sql.includes("SELECT version FROM pfh_schema_migrations"))
          return Promise.resolve({
            rows: migrations
              .slice(0, 6)
              .map(({ version }) => ({ version })) as T[],
          });
        if (sql.includes("FROM pfh_migration_history"))
          return Promise.resolve({ rows: [...history] as T[] });
        if (sql.includes("INSERT INTO pfh_migration_history")) {
          history.push({
            version: parameters![0] as number,
            name: parameters![1] as string,
            checksum: parameters![2] as string,
            provenance: "verified-current-run",
          });
        }
        return Promise.resolve({ rows: [] as T[] });
      },
      release() {},
    };
    const pool = {
      connect: () => Promise.resolve(client),
    } as unknown as pg.Pool;

    await expect(runMigrations(pool)).resolves.toBeUndefined();
    const begin = calls.indexOf("BEGIN");
    const migration = calls.findIndex((call) =>
      call.startsWith("CREATE TABLE accepted_commands"),
    );
    const historyInsert = calls.findIndex((call) =>
      call.startsWith("INSERT INTO pfh_migration_history"),
    );
    const commit = calls.indexOf("COMMIT");
    expect(begin).toBeGreaterThan(-1);
    expect(begin).toBeLessThan(migration);
    expect(migration).toBeLessThan(historyInsert);
    expect(historyInsert).toBeLessThan(commit);
  });
});
