import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { loadMigrationFiles } from "../src/infrastructure/migrations.js";

const migrationUrl = process.env.PFH_MIGRATION_DATABASE_URL;
const { Pool } = pg;
const createdDatabases: string[] = [];

afterAll(async () => {
  if (!migrationUrl) return;
  const adminUrl = new URL(migrationUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    for (const database of createdDatabases) {
      await admin.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname=$1 AND pid <> pg_backend_pid()`,
        [database],
      );
      await admin.query(`DROP DATABASE IF EXISTS ${database}`);
    }
  } finally {
    await admin.end();
  }
});

describe.runIf(Boolean(migrationUrl))(
  "legacy assistant capability upgrade",
  () => {
    it("invalidates login attempts and strips every archived executable capability", async () => {
      const suffix = randomUUID().replaceAll("-", "").slice(0, 16);
      const database = `pfh_upgrade_${suffix}`;
      createdDatabases.push(database);
      const adminUrl = new URL(migrationUrl!);
      adminUrl.pathname = "/postgres";
      const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
      await admin.query(`CREATE DATABASE ${database}`);
      await admin.end();

      const databaseUrl = new URL(migrationUrl!);
      databaseUrl.pathname = `/${database}`;
      const pool = new Pool({
        connectionString: databaseUrl.toString(),
        max: 1,
      });
      const migrations = await loadMigrationFiles();
      try {
        for (const migration of migrations.slice(0, 21)) {
          await pool.query(migration.sql);
          if (migration.version >= 2)
            await pool.query(
              `INSERT INTO pfh_migration_history
                 (version,name,checksum,provenance)
               VALUES ($1,$2,$3,'verified-current-run')
               ON CONFLICT (version) DO NOTHING`,
              [migration.version, migration.name, migration.checksum],
            );
        }
        const first = migrations[0]!;
        await pool.query(
          `INSERT INTO pfh_migration_history
             (version,name,checksum,provenance)
           VALUES ($1,$2,$3,'verified-current-run')
           ON CONFLICT (version) DO NOTHING`,
          [first.version, first.name, first.checksum],
        );

        const threadId = randomUUID();
        const responseId = randomUUID();
        const unknownResponseId = randomUUID();
        await pool.query(
          "INSERT INTO organizations(id,name) VALUES ('org-upgrade','Upgrade fixture')",
        );
        await pool.query(
          `INSERT INTO departments(organization_id,id,name)
           VALUES ('org-upgrade','dept-upgrade','Upgrade')`,
        );
        await pool.query(
          `INSERT INTO assistant_threads
             (organization_id,id,actor_id,effective_role,department_id,expires_at)
           VALUES ('org-upgrade',$1,'u-upgrade','registered-nurse','dept-upgrade',
                   clock_timestamp()+interval '1 day')`,
          [threadId],
        );
        await pool.query(
          `INSERT INTO assistant_messages
             (organization_id,thread_id,sequence,id,kind,context_revision,input_modality,content)
           VALUES ('org-upgrade',$1,2,$2,'assistant',1,'typed',$3)`,
          [
            threadId,
            unknownResponseId,
            {
              id: unknownResponseId,
              prompt: "synthetic unknown legacy request",
              response: "legacy-opaque-capability-secret",
              createdAt: new Date().toISOString(),
              inputModality: "typed",
            },
          ],
        );
        await pool.query(
          `INSERT INTO assistant_messages
             (organization_id,thread_id,sequence,id,kind,context_revision,input_modality,content)
           VALUES ('org-upgrade',$1,1,$2,'assistant',1,'typed',$3)`,
          [
            threadId,
            responseId,
            {
              id: responseId,
              prompt: "synthetic legacy request",
              response: {
                id: responseId,
                classification: { intent: "conversation", confidence: 1 },
                runtime: {
                  route: "assistant",
                  label: "synthetic",
                  degraded: false,
                },
                patientContext: null,
                components: [
                  {
                    type: "DraftAction",
                    intentToken: "legacy-live-secret",
                    nested: { authorityToken: "legacy-nested-secret" },
                  },
                  { type: "AssistantText", message: "Historischer Text" },
                ],
                openUi: "legacy-live-secret",
                evidence: [],
                warnings: [],
              },
              createdAt: new Date().toISOString(),
              inputModality: "typed",
            },
          ],
        );
        await pool.query(
          `INSERT INTO safety_authority
             (organization_id,token_hash,authority_type,actor_id,session_id,thread_id,
              context_revision,patient_id,binding,expires_at)
           VALUES ('org-upgrade',$1,'intent','u-upgrade',$2,$3,1,'p-upgrade',
                   '{"purpose":"direct-care"}'::jsonb,
                   clock_timestamp()+interval '1 day')`,
          ["a".repeat(64), randomUUID(), threadId],
        );
        await pool.query(
          `INSERT INTO oidc_login_attempts
             (organization_id,state_hash,encrypted_secrets,return_path,expires_at)
           VALUES ('org-upgrade',$1,'legacy-secret','/',
                   clock_timestamp()+interval '5 minutes')`,
          ["b".repeat(64)],
        );

        for (const migration of migrations.slice(21)) {
          await pool.query(migration.sql);
          await pool.query(
            `INSERT INTO pfh_migration_history
               (version,name,checksum,provenance)
             VALUES ($1,$2,$3,'verified-current-run')
             ON CONFLICT (version) DO NOTHING`,
            [migration.version, migration.name, migration.checksum],
          );
        }

        await expect(
          pool.query("SELECT count(*)::int AS count FROM oidc_login_attempts"),
        ).resolves.toMatchObject({ rows: [{ count: 0 }] });
        const archived = await pool.query<{ content: unknown }>(
          "SELECT content FROM assistant_messages WHERE id=$1",
          [responseId],
        );
        const serialized = JSON.stringify(archived.rows[0]?.content);
        expect(serialized).toContain("Historischer Text");
        expect(serialized).not.toContain("DraftAction");
        expect(serialized).not.toContain("legacy-live-secret");
        expect(serialized).not.toContain("legacy-nested-secret");
        const unknownArchived = await pool.query<{ content: unknown }>(
          "SELECT content FROM assistant_messages WHERE id=$1",
          [unknownResponseId],
        );
        expect(JSON.stringify(unknownArchived.rows[0]?.content)).not.toContain(
          "legacy-opaque-capability-secret",
        );
        await expect(
          pool.query(
            `SELECT consumed_at IS NOT NULL AS consumed
             FROM safety_authority WHERE token_hash=$1`,
            ["a".repeat(64)],
          ),
        ).resolves.toMatchObject({ rows: [{ consumed: true }] });
        const rls = await pool.query<{
          relname: string;
          relforcerowsecurity: boolean;
        }>(
          `SELECT relname,relforcerowsecurity FROM pg_class
           WHERE relname=ANY($1::text[]) ORDER BY relname`,
          [["assistant_messages", "oidc_login_attempts", "safety_authority"]],
        );
        expect(rls.rows).toEqual([
          { relname: "assistant_messages", relforcerowsecurity: true },
          { relname: "oidc_login_attempts", relforcerowsecurity: true },
          { relname: "safety_authority", relforcerowsecurity: true },
        ]);

        await pool.query(migrations[21]!.sql);
        await pool.query(migrations[22]!.sql);
      } finally {
        await pool.end();
      }
    }, 120_000);
  },
);
