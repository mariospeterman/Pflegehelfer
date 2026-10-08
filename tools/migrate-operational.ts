import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const runtimeUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const migrationUrl = process.env.PFH_MIGRATION_DATABASE_URL;
if (!runtimeUrl || !migrationUrl)
  throw new Error(
    "PFH_OPERATIONAL_DATABASE_URL and PFH_MIGRATION_DATABASE_URL are required.",
  );

const store = new PostgresOperationalStore(runtimeUrl, migrationUrl);
try {
  await store.initialize();
} finally {
  await store.close();
}
