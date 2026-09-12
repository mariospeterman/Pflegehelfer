import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";

export interface MigrationFile {
  version: number;
  name: string;
  checksum: string;
  sql: string;
}

export interface MigrationHistoryRow {
  version: number;
  name: string;
  checksum: string;
  provenance: "verified-current-run" | "legacy-unverified";
}

export function verifyMigrationHistory(
  migrations: readonly MigrationFile[],
  history: readonly MigrationHistoryRow[],
  allowLegacyAttestation: boolean,
): void {
  const filesByVersion = new Map(
    migrations.map((migration) => [migration.version, migration]),
  );
  for (const row of history) {
    const file = filesByVersion.get(row.version);
    if (!file)
      throw new Error(`MIGRATION_FILE_MISSING:${row.version}:${row.name}`);
    if (file.name !== row.name || file.checksum !== row.checksum)
      throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${row.version}:${row.name}`);
    if (row.provenance === "legacy-unverified" && !allowLegacyAttestation)
      throw new Error(`MIGRATION_LEGACY_UNVERIFIED:${row.version}:${row.name}`);
  }
}

export async function loadMigrationFiles(
  directory = resolve(process.cwd(), "db/migrations"),
): Promise<MigrationFile[]> {
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const migrations = await Promise.all(
    names.map(async (name) => {
      const sql = await readFile(resolve(directory, name), "utf8");
      return {
        version: Number.parseInt(name.slice(0, 3), 10),
        name,
        checksum: createHash("sha256").update(sql).digest("hex"),
        sql,
      } satisfies MigrationFile;
    }),
  );
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1)
      throw new Error(`MIGRATION_SEQUENCE_INVALID:${migration.name}`);
  });
  return migrations;
}

async function tableExists(client: pg.PoolClient, name: string) {
  const result = await client.query<{ present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [name],
  );
  return result.rows[0]?.present === true;
}

export async function runMigrations(
  pool: pg.Pool,
  options: {
    allowLegacyAttestation?: boolean;
    directory?: string;
    lockName?: string;
  } = {},
): Promise<void> {
  const migrations = await loadMigrationFiles(options.directory);
  const client = await pool.connect();
  const lockName = options.lockName ?? "pflegehelfer-schema-migrations";
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
      lockName,
    ]);
    const ledgerExisted = await tableExists(
      client,
      "public.pfh_schema_migrations",
    );
    const appliedBefore = ledgerExisted
      ? new Set(
          (
            await client.query<{ version: number }>(
              "SELECT version FROM pfh_schema_migrations",
            )
          ).rows.map((row) => row.version),
        )
      : new Set<number>();
    const appliedThisRun = new Set<number>();

    for (const migration of migrations) {
      if (appliedBefore.has(migration.version)) continue;
      await client.query(migration.sql);
      appliedThisRun.add(migration.version);
    }

    if (!(await tableExists(client, "public.pfh_migration_history")))
      throw new Error("MIGRATION_HISTORY_NOT_INITIALIZED");

    const historyResult = await client.query<MigrationHistoryRow>(
      `SELECT version,name,checksum,provenance FROM pfh_migration_history
       ORDER BY version`,
    );
    const recordedVersions = new Set(
      historyResult.rows.map((row) => row.version),
    );
    for (const migration of migrations) {
      if (recordedVersions.has(migration.version)) continue;
      const provenance = appliedThisRun.has(migration.version)
        ? "verified-current-run"
        : "legacy-unverified";
      await client.query(
        `INSERT INTO pfh_migration_history
           (version,name,checksum,provenance)
         VALUES ($1,$2,$3,$4)`,
        [migration.version, migration.name, migration.checksum, provenance],
      );
    }

    const finalHistory = await client.query<MigrationHistoryRow>(
      `SELECT version,name,checksum,provenance FROM pfh_migration_history
       ORDER BY version`,
    );
    verifyMigrationHistory(
      migrations,
      finalHistory.rows,
      options.allowLegacyAttestation === true,
    );
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [lockName])
      .catch(() => undefined);
    client.release();
  }
}
