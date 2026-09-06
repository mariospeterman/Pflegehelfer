import { z } from "zod";

export const PROVIDER_ADAPTER_CONTRACT_VERSION = "1.0.0" as const;
export const PROVIDER_CONFIG_SCHEMA_VERSION = "1.0.0" as const;

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const providerIdSchema = z.enum([
  "wicare",
  "carecoach",
  "sap-vitals",
  "device-gateway",
  "nurse-call",
]);

export const providerProfileSchema = z.enum([
  "synthetic-simulator",
  "production",
]);

export const providerOperationSchema = z.enum([
  "Patient.read",
  "Encounter.read",
  "CarePlan.read",
  "Observation.read",
  "Observation.write",
  "NursingNote.read",
  "NursingNote.write",
  "Task.read",
  "Task.write",
  "Communication.read",
  "Communication.write",
  "MedicationOrder.read",
  "MedicationOrder.write",
  "realtimeEvents",
  "bulkExport",
  "contextLaunch",
]);

export const capabilitySupportSchema = z.enum([
  "supported",
  "unsupported",
  "conditional",
  "external-vendor-gate",
]);

export const capabilitySchema = z
  .object({
    operation: providerOperationSchema,
    support: capabilitySupportSchema,
    conditions: z.array(z.string().trim().min(1).max(240)).max(20),
  })
  .strict();

export const informationDomainSchema = z.enum([
  "patient-identity",
  "encounter-location",
  "care-plan",
  "nursing-documentation",
  "vital-observation",
  "medication-order",
  "medication-administration",
  "task",
  "communication",
  "nurse-call",
]);

export const sourceAuthoritySchema = z.enum([
  "provider",
  "pflegehelfer",
  "designated-master",
  "read-only-projection",
  "unknown",
]);

export const externalVendorGateSchema = z
  .object({
    status: z.literal("EXTERNAL_VENDOR_GATE"),
    gateId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,80}$/),
    capability: providerOperationSchema,
    reason: z.string().trim().min(10).max(500),
    missingArtifacts: z.array(z.string().trim().min(3).max(160)).min(1).max(20),
    activationTests: z.array(z.string().trim().min(3).max(240)).min(1).max(20),
    affectedModules: z
      .array(z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/))
      .min(1)
      .max(20),
    safeFallback: z.string().trim().min(10).max(500),
  })
  .strict();

export const adapterManifestSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_ADAPTER_CONTRACT_VERSION),
    provider: providerIdSchema,
    profile: providerProfileSchema,
    adapterVersion: z.string().regex(semverPattern),
    displayName: z.string().trim().min(2).max(100),
    capabilities: z.array(capabilitySchema).min(1).max(100),
    sourceOfTruth: z.partialRecord(
      informationDomainSchema,
      sourceAuthoritySchema,
    ),
    gates: z.array(externalVendorGateSchema).max(100),
  })
  .strict()
  .superRefine((manifest, context) => {
    const operations = new Set<string>();
    for (const capability of manifest.capabilities) {
      if (operations.has(capability.operation)) {
        context.addIssue({
          code: "custom",
          path: ["capabilities"],
          message: `Duplicate capability ${capability.operation}`,
        });
      }
      operations.add(capability.operation);
    }
    const gates = new Map(
      manifest.gates.map((gate) => [gate.capability, gate]),
    );
    for (const capability of manifest.capabilities) {
      if (
        capability.support === "external-vendor-gate" &&
        !gates.has(capability.operation)
      ) {
        context.addIssue({
          code: "custom",
          path: ["gates"],
          message: `Missing gate details for ${capability.operation}`,
        });
      }
      if (
        manifest.profile === "synthetic-simulator" &&
        capability.support === "external-vendor-gate"
      ) {
        context.addIssue({
          code: "custom",
          path: ["capabilities"],
          message: "Simulator manifests cannot contain production vendor gates",
        });
      }
    }
    if (manifest.profile === "production") {
      for (const gate of manifest.gates) {
        const capability = manifest.capabilities.find(
          (candidate) => candidate.operation === gate.capability,
        );
        if (capability?.support !== "external-vendor-gate") {
          context.addIssue({
            code: "custom",
            path: ["gates"],
            message: `Gate ${gate.gateId} does not describe a gated capability`,
          });
        }
      }
    }
  });

const simulatorConnectionSchema = z
  .object({ kind: z.literal("simulator") })
  .strict();
const gatedConnectionSchema = z
  .object({
    kind: z.literal("external-vendor-gate"),
    gateIds: z.array(z.string()).min(1),
  })
  .strict();
const verifiedVendorConnectionSchema = z
  .object({
    kind: z.literal("verified-vendor-contract"),
    contractReference: z.string().trim().min(3).max(200),
    credentialSecretRef: z.string().regex(/^[a-z0-9][a-z0-9._/-]{2,200}$/),
    endpoint: z.url().refine((value) => value.startsWith("https://"), {
      message: "Provider endpoints require HTTPS",
    }),
  })
  .strict();

export const providerAdapterConfigSchema = z
  .object({
    schemaVersion: z.literal(PROVIDER_CONFIG_SCHEMA_VERSION),
    provider: providerIdSchema,
    profile: providerProfileSchema,
    adapterVersion: z.string().regex(semverPattern),
    enabled: z.boolean(),
    connection: z.discriminatedUnion("kind", [
      simulatorConnectionSchema,
      gatedConnectionSchema,
      verifiedVendorConnectionSchema,
    ]),
  })
  .strict()
  .superRefine((config, context) => {
    if (
      config.profile === "synthetic-simulator" &&
      config.connection.kind !== "simulator"
    ) {
      context.addIssue({
        code: "custom",
        path: ["connection"],
        message: "Synthetic profiles require a simulator connection",
      });
    }
    if (
      config.profile === "production" &&
      config.connection.kind === "simulator"
    ) {
      context.addIssue({
        code: "custom",
        path: ["connection"],
        message: "Production profiles cannot use simulator connections",
      });
    }
    if (config.connection.kind === "external-vendor-gate" && config.enabled) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "An external vendor gate cannot be activated",
      });
    }
  });

export const providerAdapterConfigJsonSchema = z.toJSONSchema(
  providerAdapterConfigSchema,
);
export const adapterManifestJsonSchema = z.toJSONSchema(adapterManifestSchema);

export type ProviderId = z.infer<typeof providerIdSchema>;
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export type ProviderOperation = z.infer<typeof providerOperationSchema>;
export type CapabilitySupport = z.infer<typeof capabilitySupportSchema>;
export type ProviderCapability = z.infer<typeof capabilitySchema>;
export type ExternalVendorGate = z.infer<typeof externalVendorGateSchema>;
export type AdapterManifest = z.infer<typeof adapterManifestSchema>;
export type ProviderAdapterConfig = z.infer<typeof providerAdapterConfigSchema>;

export interface ProviderHealth {
  status: "available" | "degraded" | "unavailable";
  checkedAt: string;
  latencyMs: number | null;
  message: string;
}

export interface SyncCursor {
  value: string;
}

export interface ExternalReference {
  resourceType: string;
  externalId: string;
}

export interface ProviderRecord {
  reference: ExternalReference;
  originVersion: string;
  effectiveAt: string;
  recordedAt: string;
  receivedAt: string;
  payload: unknown;
}

export interface InboundChangeBatch {
  records: ProviderRecord[];
  nextCursor: SyncCursor | null;
  hasMore: boolean;
}

export interface CanonicalResource {
  resourceType: string;
  id: string;
  body: Readonly<Record<string, unknown>>;
}

export interface CanonicalClinicalCommand {
  commandId: string;
  operation: ProviderOperation;
  patientReference: string;
  resource: CanonicalResource;
  expectedProviderVersion: string | null;
  mappingVersion: string;
  correlationId: string;
  causationId: string;
  idempotencyKey: string;
  approvedAt: string;
}

export interface PreparedProviderCommand {
  provider: ProviderId;
  adapterVersion: string;
  command: CanonicalClinicalCommand;
  payloadHash: string;
  preparedAt: string;
}

export type ProviderErrorClassification =
  | "technical"
  | "clinical-content"
  | "mapping"
  | "authorization"
  | "version-conflict";

export interface ProviderAcknowledgement {
  receiptId: string;
  idempotencyKey: string;
  status: "acknowledged" | "pending" | "rejected" | "conflict";
  providerVersion: string | null;
  errorCode: string | null;
  errorClassification: ProviderErrorClassification | null;
  providerSnapshot: ProviderRecord | null;
  receivedAt: string;
}

export interface ReconciliationRequest {
  receiptId: string;
  idempotencyKey: string;
}

export interface ReconciliationResult {
  status: ProviderAcknowledgement["status"];
  acknowledgement: ProviderAcknowledgement;
}

export interface ProviderAdapter {
  manifest(): AdapterManifest;
  discoverCapabilities(): Promise<ProviderCapability[]>;
  health(): Promise<ProviderHealth>;
  pullChanges(cursor?: SyncCursor): Promise<InboundChangeBatch>;
  read(reference: ExternalReference): Promise<ProviderRecord>;
  mapInbound(record: ProviderRecord): Promise<CanonicalResource[]>;
  prepareCommand(
    command: CanonicalClinicalCommand,
  ): Promise<PreparedProviderCommand>;
  executeCommand(
    command: PreparedProviderCommand,
  ): Promise<ProviderAcknowledgement>;
  getCommandStatus(receiptId: string): Promise<ProviderAcknowledgement>;
  reconcile(request: ReconciliationRequest): Promise<ReconciliationResult>;
}
