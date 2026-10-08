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
import {
  InMemoryDemoScenarioStore,
  PostgresDemoScenarioStore,
} from "../infrastructure/demo-scenario-store.js";
import { loadOrganizationCommercialConfig } from "../core/organization-economics.js";
import { siteConfiguration } from "../core/site-config.js";
import { runtimeProfileFromEnvironment } from "./runtime-profile.js";
import { installDemoScenarioRuntime } from "../core/demo-scenario-runtime.js";
import { scenarioDigest } from "../core/demo-scenario.js";
import { validateCanonicalClinicalReferences } from "../core/fhir-resource-set.js";

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
const workspace = clinicalWorkspaceFromEnvironment();
const operationalUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
if (!operationalUrl && !demoMode)
  throw new Error("Production requires PFH_OPERATIONAL_DATABASE_URL.");
const operationalStore = operationalUrl
  ? new PostgresOperationalStore(operationalUrl)
  : new InMemoryOperationalStore();
await operationalStore.initialize();
const scenarioStore = operationalUrl
  ? new PostgresDemoScenarioStore(operationalUrl)
  : new InMemoryDemoScenarioStore();
const activeScenario = demoMode ? await scenarioStore.initialize() : null;
const service = new PflegehelferService(
  new InMemoryReferenceStatePort(
    activeScenario ? activeScenario.state : emptyWorkflowState(),
  ),
  providerRegistry,
  demoMode ? "synthetic-simulator" : "production",
);
if (demoMode)
  await seedSyntheticDemoWorkspace(operationalStore, activeScenario?.workspace);
const commercialStore = operationalUrl
  ? new PostgresCommercialStore(operationalUrl)
  : new InMemoryCommercialStore();
const commercialConfiguration = loadOrganizationCommercialConfig();
if (commercialConfiguration.organizationId !== siteConfiguration.institutionId)
  throw new Error("COMMERCIAL_CONFIGURATION_SCOPE_MISMATCH");
await commercialStore.initialize(commercialConfiguration);
const projectedCheckpoint = demoMode ? null : await workspace.loadCheckpoint();
if (projectedCheckpoint) service.restoreCheckpoint(projectedCheckpoint);
else if (!demoMode)
  throw new Error(
    "RESOURCE_NATIVE_CUTOVER_RECEIPT_REQUIRED: normal startup will not infer authorization or clinical authority from an unverified FHIR inventory",
  );
const durableAuditEntries = await operationalStore.loadAuditEntries();
if (durableAuditEntries.length > 0) service.audit.restore(durableAuditEntries);
if (demoMode) installDemoScenarioRuntime(service.checkpoint().state);
// Historical Provenance/AuditEvent resources are already append-only in
// Medplum and must not be rewritten on every boot. The active synthetic
// scenario is transactionally advanced with accepted commands. Production
// continues to restore its authenticated scoped legacy checkpoint until an
// explicit inventory/digest-bound cutover has materialized and verified every
// native resource plus a separate authorization directory. Normal startup is
// never allowed to perform that migration implicitly.
const startupResources = service
  .fhirResources()
  .filter(
    (resource) =>
      resource.resourceType !== "AuditEvent" &&
      resource.resourceType !== "Provenance",
  );
let bootstrapEmptyDemoProjection = false;
if (demoMode && workspace.mode === "medplum") {
  if (!workspace.loadManagedProjectionInventory)
    throw new Error("MANAGED_PROJECTION_INVENTORY_READ_NOT_AVAILABLE");
  const actual = await workspace.loadManagedProjectionInventory();
  const actualTotal = Object.values(actual).reduce(
    (total, count) => total + count,
    0,
  );
  const diagnostics = await operationalStore.deliveryDiagnostics();
  const unresolvedClinical = Object.entries(
    diagnostics.clinicalProjections,
  ).some(([state, count]) => state !== "delivered" && count > 0);
  if (actualTotal === 0) {
    if (unresolvedClinical)
      throw new Error("DEMO_BOOTSTRAP_BLOCKED_BY_PENDING_CLINICAL_PROJECTION");
    bootstrapEmptyDemoProjection = true;
  } else if (!unresolvedClinical) {
    if (!workspace.loadCanonicalClinicalState || !activeScenario)
      throw new Error("RESOURCE_NATIVE_CLINICAL_READ_NOT_AVAILABLE");
    const native = await workspace.loadCanonicalClinicalState();
    // Resource-native clinical data may reference identities, but it is never
    // an authorization directory. Bind every actor/owner reference to the
    // already authenticated scenario directory before accepting the read.
    validateCanonicalClinicalReferences(native, activeScenario.state.users);
    const expectedClinicalState = {
      users: activeScenario.state.users,
      patients: activeScenario.state.patients,
      tasks: activeScenario.state.tasks,
      observations: activeScenario.state.observations,
      notes: activeScenario.state.notes,
      communications: activeScenario.state.communications,
      intake: activeScenario.state.intake,
      roundActions: activeScenario.state.roundActions,
    };
    const nativeClinicalState = {
      users: native.users,
      patients: native.patients,
      tasks: native.tasks,
      observations: native.observations,
      notes: native.notes,
      communications: native.communications,
      intake: native.intake,
      roundActions: native.roundActions,
    };
    const currentDiagnostics = await operationalStore.deliveryDiagnostics();
    const acceptedDuringRead = Object.entries(
      currentDiagnostics.clinicalProjections,
    ).some(([state, count]) => state !== "delivered" && count > 0);
    if (!acceptedDuringRead) {
      // A non-empty FHIR inventory is not proof of a complete projection.
      // Until an explicit generation/digest cutover exists, PostgreSQL stays
      // authoritative and FHIR is verified against it, never copied over it.
      if (
        scenarioDigest(nativeClinicalState) !==
        scenarioDigest(expectedClinicalState)
      )
        throw new Error("RESOURCE_NATIVE_PROJECTION_DIVERGENCE");
    }
  }
}
await workspace.initialize(startupResources, undefined, {
  // Production startup is read-only. In particular, absence of a legacy
  // checkpoint must never turn an empty process cache into a destructive
  // stale-resource cleanup. Explicit migration materializes v2 resources;
  // normal startup only verifies transport and reads native state.
  reconcile: bootstrapEmptyDemoProjection,
});
const app = buildApp(service, {
  workspace,
  operationalStore,
  commercialStore,
  scenarioStore,
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
