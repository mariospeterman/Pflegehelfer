import { describe, expect, it } from "vitest";
import {
  loadMigrationFiles,
  verifyMigrationHistory,
} from "../src/infrastructure/migrations.js";

describe("immutable migration ledger", () => {
  it("discovers a consecutive migration history with stable digests", async () => {
    const migrations = await loadMigrationFiles();
    expect(migrations.map(({ version, name }) => ({ version, name }))).toEqual([
      { version: 1, name: "001_operational_kernel.sql" },
      { version: 2, name: "002_immutable_migration_history.sql" },
      { version: 3, name: "003_immutable_handover_content.sql" },
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
});
