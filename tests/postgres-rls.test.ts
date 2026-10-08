import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const migrationUrl = process.env.PFH_MIGRATION_DATABASE_URL;
const { Pool } = pg;

describe.runIf(Boolean(databaseUrl && migrationUrl))(
  "restricted PostgreSQL tenant RLS",
  () => {
    it("denies absent and foreign tenant context and survives rollback reuse", async () => {
      const scoped = new Pool({
        connectionString: databaseUrl,
        options: "-c pfh.organization_id=org-demo",
      });
      const absent = new Pool({ connectionString: databaseUrl });
      const foreign = new Pool({
        connectionString: databaseUrl,
        options: "-c pfh.organization_id=org-foreign",
      });
      const owner = new Pool({ connectionString: migrationUrl });
      try {
        await owner.query(
          `INSERT INTO organizations(id,name) VALUES ('org-foreign','Foreign synthetic tenant')
           ON CONFLICT (id) DO NOTHING`,
        );
        const role = await scoped.query<{
          current_user: string;
          rolsuper: boolean;
          rolbypassrls: boolean;
        }>(
          `SELECT current_user,r.rolsuper,r.rolbypassrls
           FROM pg_roles r WHERE r.rolname=current_user`,
        );
        expect(role.rows[0]).toMatchObject({
          current_user: "pflegehelfer_runtime",
          rolsuper: false,
          rolbypassrls: false,
        });
        await expect(
          scoped.query("SELECT role_name FROM runtime_tenant_principals"),
        ).rejects.toMatchObject({ code: "42501" });
        await expect(
          scoped.query("SELECT id FROM organizations"),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          absent.query("SELECT id FROM organizations"),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          foreign.query("SELECT id FROM organizations"),
        ).resolves.toMatchObject({ rowCount: 1 });
        await expect(
          scoped.query(
            "INSERT INTO organizations(id,name) VALUES ('org-foreign','denied')",
          ),
        ).rejects.toMatchObject({ code: "42501" });

        const client = await scoped.connect();
        try {
          await client.query("BEGIN");
          await client.query("SET LOCAL pfh.organization_id='org-foreign'");
          await expect(
            client.query("SELECT id FROM organizations"),
          ).resolves.toMatchObject({ rowCount: 1 });
          await client.query("ROLLBACK");
          const restored = await client.query<{ tenant: string }>(
            "SELECT current_setting('pfh.organization_id') AS tenant",
          );
          expect(restored.rows[0]?.tenant).toBe("org-demo");
        } finally {
          client.release();
        }
      } finally {
        await Promise.all([
          scoped.end(),
          absent.end(),
          foreign.end(),
          owner.end(),
        ]);
      }
    });

    it("forces RLS on every tenant table", async () => {
      const owner = new Pool({ connectionString: migrationUrl });
      try {
        const result = await owner.query<{ table_name: string }>(
          `SELECT c.table_name
           FROM information_schema.columns c
           JOIN pg_class p ON p.relname=c.table_name
           JOIN pg_namespace n ON n.oid=p.relnamespace AND n.nspname='public'
           WHERE c.table_schema='public' AND c.column_name='organization_id'
             AND c.table_name <> 'runtime_tenant_principals'
             AND (NOT p.relrowsecurity OR NOT p.relforcerowsecurity)`,
        );
        expect(result.rows).toEqual([]);
      } finally {
        await owner.end();
      }
    });

    it("refuses a privileged schema owner as the application runtime", async () => {
      const { PostgresOperationalStore } =
        await import("../src/infrastructure/operational-store.js");
      const unsafe = new PostgresOperationalStore(migrationUrl!);
      try {
        await expect(unsafe.initialize()).rejects.toThrow(
          "OPERATIONAL_SCHEMA_OR_TENANT_PRINCIPAL_NOT_READY",
        );
      } finally {
        await unsafe.close();
      }
    });

    it("refuses a privileged login that assumes the runtime role", async () => {
      const { PostgresOperationalStore } =
        await import("../src/infrastructure/operational-store.js");
      const assumedRoleUrl = new URL(migrationUrl!);
      assumedRoleUrl.searchParams.set(
        "options",
        "-c role=pflegehelfer_runtime",
      );
      const unsafe = new PostgresOperationalStore(assumedRoleUrl.toString());
      try {
        await expect(unsafe.initialize()).rejects.toThrow(
          "OPERATIONAL_SCHEMA_OR_TENANT_PRINCIPAL_NOT_READY",
        );
      } finally {
        await unsafe.close();
      }
    });
  },
);
