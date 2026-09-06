import {
  adapterManifestSchema,
  providerAdapterConfigSchema,
  type AdapterManifest,
  type ExternalVendorGate,
  type ProviderAdapter,
  type ProviderAdapterConfig,
  type ProviderCapability,
  type ProviderHealth,
  type ProviderId,
  type ProviderOperation,
  type ProviderProfile,
} from "./contract.js";
import {
  ProviderContractSimulator,
  type ProviderSimulatorMode,
} from "./simulator.js";

export type ProviderOperationalStatus =
  | "SIMULATED"
  | "READY"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "DISABLED"
  | "EXTERNAL_VENDOR_GATE";

export interface ProviderRegistryStatus {
  provider: ProviderId;
  profile: ProviderProfile;
  displayName: string;
  contractVersion: string;
  adapterVersion: string;
  operationalStatus: ProviderOperationalStatus;
  capabilities: ProviderCapability[];
  sourceOfTruth: AdapterManifest["sourceOfTruth"];
  gates: ExternalVendorGate[];
  health: ProviderHealth | null;
}

interface Registration {
  config: ProviderAdapterConfig;
  manifest: AdapterManifest;
  adapter: ProviderAdapter | null;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function key(provider: ProviderId, profile: ProviderProfile): string {
  return `${provider}:${profile}`;
}

export class ProviderRegistry {
  private readonly registrations = new Map<string, Registration>();

  register(
    configInput: ProviderAdapterConfig,
    manifestInput: AdapterManifest,
    adapter: ProviderAdapter | null = null,
  ): void {
    const config = providerAdapterConfigSchema.parse(configInput);
    const manifest = adapterManifestSchema.parse(manifestInput);
    if (
      config.provider !== manifest.provider ||
      config.profile !== manifest.profile ||
      config.adapterVersion !== manifest.adapterVersion
    )
      throw new Error("PROVIDER_REGISTRATION_IDENTITY_MISMATCH");
    if (config.enabled && !adapter)
      throw new Error("ENABLED_PROVIDER_REQUIRES_ADAPTER");
    if (adapter) {
      const adapterIdentity = adapterManifestSchema.parse(adapter.manifest());
      if (
        adapterIdentity.provider !== manifest.provider ||
        adapterIdentity.profile !== manifest.profile ||
        adapterIdentity.adapterVersion !== manifest.adapterVersion ||
        adapterIdentity.contractVersion !== manifest.contractVersion
      )
        throw new Error("PROVIDER_ADAPTER_MANIFEST_MISMATCH");
    }
    if (config.connection.kind === "external-vendor-gate") {
      const knownGateIds = new Set(manifest.gates.map((gate) => gate.gateId));
      if (config.connection.gateIds.some((gateId) => !knownGateIds.has(gateId)))
        throw new Error("PROVIDER_CONFIG_REFERENCES_UNKNOWN_GATE");
    }
    this.registrations.set(key(config.provider, config.profile), {
      config: clone(config),
      manifest: clone(manifest),
      adapter,
    });
  }

  adapter(
    provider: ProviderId,
    profile: ProviderProfile,
  ): ProviderAdapter | null {
    const registration = this.registrations.get(key(provider, profile));
    if (
      !registration?.config.enabled ||
      registration.config.connection.kind === "external-vendor-gate" ||
      registration.manifest.gates.length > 0 ||
      registration.manifest.capabilities.some(
        (capability) => capability.support === "external-vendor-gate",
      )
    )
      return null;
    return registration.adapter;
  }

  manifest(
    provider: ProviderId,
    profile: ProviderProfile,
  ): AdapterManifest | null {
    const registration = this.registrations.get(key(provider, profile));
    return registration ? clone(registration.manifest) : null;
  }

  setSimulatorMode(
    provider: ProviderId,
    mode: ProviderSimulatorMode,
  ): ProviderHealth {
    const adapter = this.adapter(provider, "synthetic-simulator");
    if (!(adapter instanceof ProviderContractSimulator))
      throw new Error("SYNTHETIC_PROVIDER_SIMULATOR_NOT_CONFIGURED");
    adapter.setMode(mode);
    return adapter.healthSnapshot();
  }

  resetSimulators(): void {
    for (const registration of this.registrations.values())
      if (registration.adapter instanceof ProviderContractSimulator)
        registration.adapter.reset();
  }

  async status(profile?: ProviderProfile): Promise<ProviderRegistryStatus[]> {
    const statuses: ProviderRegistryStatus[] = [];
    for (const registration of this.registrations.values()) {
      if (profile && registration.manifest.profile !== profile) continue;
      statuses.push(await this.projectStatus(registration));
    }
    return statuses.sort((left, right) =>
      `${left.provider}:${left.profile}`.localeCompare(
        `${right.provider}:${right.profile}`,
      ),
    );
  }

  async get(
    provider: ProviderId,
    profile: ProviderProfile,
  ): Promise<ProviderRegistryStatus | null> {
    const registration = this.registrations.get(key(provider, profile));
    return registration ? this.projectStatus(registration) : null;
  }

  private async projectStatus(
    registration: Registration,
  ): Promise<ProviderRegistryStatus> {
    let health: ProviderHealth | null = null;
    let operationalStatus: ProviderOperationalStatus;
    const hasUnresolvedGates =
      registration.manifest.gates.length > 0 ||
      registration.manifest.capabilities.some(
        (capability) => capability.support === "external-vendor-gate",
      );
    if (
      registration.config.connection.kind === "external-vendor-gate" ||
      hasUnresolvedGates
    ) {
      operationalStatus = "EXTERNAL_VENDOR_GATE";
    } else if (!registration.config.enabled) {
      operationalStatus = "DISABLED";
    } else {
      try {
        health = await registration.adapter!.health();
        operationalStatus =
          registration.config.profile === "synthetic-simulator"
            ? "SIMULATED"
            : health.status === "available"
              ? "READY"
              : health.status === "degraded"
                ? "DEGRADED"
                : "UNAVAILABLE";
      } catch {
        operationalStatus = "UNAVAILABLE";
      }
    }
    return clone({
      provider: registration.manifest.provider,
      profile: registration.manifest.profile,
      displayName: registration.manifest.displayName,
      contractVersion: registration.manifest.contractVersion,
      adapterVersion: registration.manifest.adapterVersion,
      operationalStatus,
      capabilities: registration.manifest.capabilities,
      sourceOfTruth: registration.manifest.sourceOfTruth,
      gates: registration.manifest.gates,
      health,
    });
  }
}

const providerLabels: Record<ProviderId, string> = {
  wicare: "WiCare",
  carecoach: "careCoach",
  "sap-vitals": "SAP/Vitals",
  "device-gateway": "Vital/Device Gateway",
  "nurse-call": "Nurse-call Mirror",
};

const vendorRequirements: Record<
  ProviderId,
  {
    missingArtifacts: string[];
    activationTests: string[];
    safeFallback: string;
  }
> = {
  wicare: {
    missingArtifacts: [
      "Vendor WSDL and SOAP schemas",
      "WiCare Gate and supported HL7 message specifications",
      "Authentication, authorization and certificate requirements",
      "Concurrency, acknowledgement and error semantics",
      "Licensed sandbox and compatibility matrix",
    ],
    activationTests: [
      "Validate signed fixtures against the vendor schema",
      "Pass sandbox read, write, duplicate and stale-version tests",
      "Record vendor approval for every activated operation",
    ],
    safeFallback:
      "Keep WiCare authoritative and expose only synthetic simulation or an approved context launch.",
  },
  carecoach: {
    missingArtifacts: [
      "Vendor-approved interface and payload specification",
      "Authentication and authorization contract",
      "Version, acknowledgement and error semantics",
      "Licensed sandbox and supported-version matrix",
    ],
    activationTests: [
      "Pass vendor sandbox mapping and authorization tests",
      "Pass duplicate, rejection and conflict contract tests",
      "Record topCare approval for every activated operation",
    ],
    safeFallback:
      "Keep careCoach authoritative and use only approved read/export or context-launch workflows.",
  },
  "sap-vitals": {
    missingArtifacts: [
      "Institution-specific OData or clinical service metadata",
      "Approved OAuth, certificate or service-account configuration",
      "Business schema, ownership and concurrency rules",
      "Institutional sandbox and transport allowlist",
    ],
    activationTests: [
      "Import and validate service metadata without screen automation",
      "Pass sandbox authorization, mapping and stale-version tests",
      "Approve the site-specific source-of-truth matrix",
    ],
    safeFallback:
      "Keep SAP or the identified vital system authoritative and disable unverified exchange.",
  },
  "device-gateway": {
    missingArtifacts: [
      "Installed device or edge-gateway protocol specification",
      "Device identity, calibration and measurement-quality semantics",
      "Authentication, time synchronization and replay rules",
      "Representative hardware or certified simulator environment",
    ],
    activationTests: [
      "Verify device identity, unit, time and origin preservation",
      "Pass duplicate, clock-skew, quality-flag and outage tests",
      "Complete institutional device integration acceptance",
    ],
    safeFallback:
      "Use approved manual vital entry and retain the installed device system as authority.",
  },
  "nurse-call": {
    missingArtifacts: [
      "Installed nurse-call vendor and protocol specification",
      "Authenticated event and acknowledgement contract",
      "Facility routing, escalation and downtime rules",
      "Clinical safety and vendor acceptance evidence",
    ],
    activationTests: [
      "Prove the primary nurse-call path remains independent",
      "Pass duplicate, outage and delayed-event mirror tests",
      "Complete clinical safety acceptance for the installed system",
    ],
    safeFallback:
      "Keep the certified nurse-call system primary and disable the unverified event mirror.",
  },
};

const providerOperations: Record<ProviderId, ProviderOperation[]> = {
  wicare: [
    "Patient.read",
    "Encounter.read",
    "CarePlan.read",
    "Observation.read",
    "Observation.write",
    "NursingNote.read",
    "NursingNote.write",
    "Task.read",
    "contextLaunch",
    "bulkExport",
  ],
  carecoach: [
    "Patient.read",
    "Encounter.read",
    "CarePlan.read",
    "Observation.read",
    "Observation.write",
    "NursingNote.read",
    "NursingNote.write",
    "Task.read",
    "contextLaunch",
    "bulkExport",
  ],
  "sap-vitals": [
    "Patient.read",
    "Encounter.read",
    "Observation.read",
    "Observation.write",
    "contextLaunch",
  ],
  "device-gateway": ["Observation.read", "Observation.write", "realtimeEvents"],
  "nurse-call": ["realtimeEvents"],
};

function capability(
  operation: ProviderOperation,
  support: ProviderCapability["support"],
  conditions: string[] = [],
): ProviderCapability {
  return { operation, support, conditions };
}

function gate(
  provider: ProviderId,
  operation: ProviderOperation,
): ExternalVendorGate {
  const requirements = vendorRequirements[provider];
  return {
    status: "EXTERNAL_VENDOR_GATE",
    gateId: `${provider}-${operation.toLowerCase().replaceAll(".", "-")}`,
    capability: operation,
    reason: `No verified ${provider} contract currently authorizes ${operation}.`,
    missingArtifacts: requirements.missingArtifacts,
    activationTests: requirements.activationTests,
    affectedModules: ["provider-integration", "provider-mapping"],
    safeFallback: requirements.safeFallback,
  };
}

function productionManifest(provider: ProviderId): AdapterManifest {
  const gatedOperations = providerOperations[provider];
  const capabilities = gatedOperations.map((operation) =>
    capability(operation, "external-vendor-gate", [
      "Activation requires the named private vendor artifacts and tests.",
    ]),
  );
  capabilities.push(capability("MedicationOrder.write", "unsupported"));
  return adapterManifestSchema.parse({
    contractVersion: "1.0.0",
    provider,
    profile: "production",
    adapterVersion: "0.0.0-external-vendor-gate",
    displayName: providerLabels[provider],
    capabilities,
    sourceOfTruth:
      provider === "nurse-call"
        ? { "nurse-call": "provider", task: "pflegehelfer" }
        : provider === "device-gateway" || provider === "sap-vitals"
          ? { "vital-observation": "provider" }
          : {
              "patient-identity": "designated-master",
              "care-plan": "provider",
              "nursing-documentation": "provider",
            },
    gates: gatedOperations.map((operation) => gate(provider, operation)),
  });
}

function simulatorManifest(provider: ProviderId): AdapterManifest {
  const simulated = providerOperations[provider].map((operation) =>
    capability(
      operation,
      operation.endsWith(".write") ? "conditional" : "supported",
      ["Synthetic data only; this is not evidence of vendor capability."],
    ),
  );
  simulated.push(capability("MedicationOrder.write", "unsupported"));
  return adapterManifestSchema.parse({
    contractVersion: "1.0.0",
    provider,
    profile: "synthetic-simulator",
    adapterVersion: "1.0.0",
    displayName: `${providerLabels[provider]} Simulator`,
    capabilities: simulated,
    sourceOfTruth: { task: "pflegehelfer" },
    gates: [],
  });
}

const providerIds = Object.keys(providerLabels) as ProviderId[];

export function createProductionProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const provider of providerIds) {
    const manifest = productionManifest(provider);
    registry.register(
      {
        schemaVersion: "1.0.0",
        provider,
        profile: "production",
        adapterVersion: manifest.adapterVersion,
        enabled: false,
        connection: {
          kind: "external-vendor-gate",
          gateIds: manifest.gates.map((item) => item.gateId),
        },
      },
      manifest,
    );
  }
  return registry;
}

export function createSyntheticProviderRegistry(): ProviderRegistry {
  const registry = createProductionProviderRegistry();
  for (const provider of providerIds) {
    const manifest = simulatorManifest(provider);
    registry.register(
      {
        schemaVersion: "1.0.0",
        provider,
        profile: "synthetic-simulator",
        adapterVersion: manifest.adapterVersion,
        enabled: true,
        connection: { kind: "simulator" },
      },
      manifest,
      new ProviderContractSimulator(manifest),
    );
  }
  return registry;
}

export const providerRegistryFixtures = {
  productionManifest,
  simulatorManifest,
};
