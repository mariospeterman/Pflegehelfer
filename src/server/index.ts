import { buildApp } from "./app.js";
import { emptyWorkflowState, PflegehelferService } from "../core/service.js";
import { InMemoryReferenceStatePort } from "../core/clinical-data-port.js";
import {
  createProductionProviderRegistry,
  createSyntheticProviderRegistry,
} from "../core/provider-integration/index.js";
import { clinicalWorkspaceFromEnvironment } from "../infrastructure/medplum-workspace.js";
import {
  InMemoryOperationalStore,
  PostgresOperationalStore,
} from "../infrastructure/operational-store.js";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "127.0.0.1";
const demoMode = process.env.PFH_DEMO_MODE === "true";
const service = new PflegehelferService(
  demoMode ? undefined : new InMemoryReferenceStatePort(emptyWorkflowState()),
  demoMode
    ? createSyntheticProviderRegistry()
    : createProductionProviderRegistry(),
  demoMode ? "synthetic-simulator" : "production",
);
const workspace = clinicalWorkspaceFromEnvironment();
const operationalUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
if (!operationalUrl && !demoMode)
  throw new Error("Production requires PFH_OPERATIONAL_DATABASE_URL.");
const operationalStore = operationalUrl
  ? new PostgresOperationalStore(operationalUrl)
  : new InMemoryOperationalStore();
await operationalStore.initialize();
const checkpoint = await workspace.loadCheckpoint();
if (checkpoint) service.restoreCheckpoint(checkpoint);
// Historical Provenance/AuditEvent resources are already append-only in
// Medplum and must not be rewritten on every boot. Current clinical resources
// and the authenticated checkpoint are sufficient for restart reconciliation.
const startupResources = service
  .fhirResources()
  .filter(
    (resource) =>
      resource.resourceType !== "AuditEvent" &&
      resource.resourceType !== "Provenance",
  );
await workspace.initialize(startupResources, service.checkpoint(), {
  reconcile: checkpoint === null,
});
const app = buildApp(service, { workspace, operationalStore });

const close = async (signal: string) => {
  app.log.info({ signal }, "graceful shutdown");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error({ err: error }, "startup failed");
  process.exit(1);
}
