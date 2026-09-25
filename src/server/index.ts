import { buildApp } from "./app.js";
import { emptyWorkflowState, PflegehelferService } from "../core/service.js";
import { InMemoryReferenceStatePort } from "../core/clinical-data-port.js";
import {
  createExternalSyntheticProviderRegistry,
  createProductionProviderRegistry,
  createSyntheticProviderRegistry,
} from "../core/provider-integration/index.js";
import { clinicalWorkspaceFromEnvironment } from "../infrastructure/medplum-workspace.js";
import {
  InMemoryOperationalStore,
  PostgresOperationalStore,
} from "../infrastructure/operational-store.js";
import {
  InMemoryCommercialStore,
  PostgresCommercialStore,
} from "../infrastructure/commercial-store.js";
import { seedSyntheticDemoWorkspace } from "../infrastructure/demo-workspace.js";
import { loadOrganizationCommercialConfig } from "../core/organization-economics.js";
import { siteConfiguration } from "../core/site-config.js";
import { runtimeProfileFromEnvironment } from "./runtime-profile.js";

const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const host = process.env.HOST ?? "127.0.0.1";
const runtime = runtimeProfileFromEnvironment();
const demoMode = runtime.demoMode;
const providerRegistry =
  runtime.providerMode === "external-simulator"
    ? createExternalSyntheticProviderRegistry(
        process.env.PFH_PROVIDER_SIMULATOR_BASE_URL!,
        process.env.PFH_PROVIDER_SIMULATOR_TOKEN!,
      )
    : runtime.providerMode === "in-process-simulator"
      ? createSyntheticProviderRegistry()
      : createProductionProviderRegistry();
const service = new PflegehelferService(
  demoMode ? undefined : new InMemoryReferenceStatePort(emptyWorkflowState()),
  providerRegistry,
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
if (demoMode) await seedSyntheticDemoWorkspace(operationalStore);
const commercialStore = operationalUrl
  ? new PostgresCommercialStore(operationalUrl)
  : new InMemoryCommercialStore();
const commercialConfiguration = loadOrganizationCommercialConfig();
if (commercialConfiguration.organizationId !== siteConfiguration.institutionId)
  throw new Error("COMMERCIAL_CONFIGURATION_SCOPE_MISMATCH");
await commercialStore.initialize(commercialConfiguration);
const [projectedCheckpoint, locallyAcceptedCheckpoint] = await Promise.all([
  workspace.loadCheckpoint(),
  operationalStore.loadLatestAcceptedCheckpoint(),
]);
const recoveryCheckpoint = locallyAcceptedCheckpoint ?? projectedCheckpoint;
if (recoveryCheckpoint) service.restoreCheckpoint(recoveryCheckpoint);
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
  // A locally accepted checkpoint must reach Medplum through its leased
  // clinical projection job. Startup must not bypass that durable queue.
  reconcile: projectedCheckpoint === null && locallyAcceptedCheckpoint === null,
});
const app = buildApp(service, {
  workspace,
  operationalStore,
  commercialStore,
  runtime,
});

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
