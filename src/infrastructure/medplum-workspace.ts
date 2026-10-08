import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import "./node-websocket.js";
import { MedplumClient } from "@medplum/core";
import type {
  Binary,
  Bundle,
  CapabilityStatement,
  Resource,
  ResourceType,
} from "@medplum/fhirtypes";
import { z } from "zod";
import { verifyAuditEntries } from "../core/audit.js";
import {
  fhirResourceId,
  legacyFhirResourceId,
  managedProjectionTag,
  tenantTag,
  tenantTagSystem,
} from "../core/fhir-resource-set.js";
import { actionSchema, siteConfiguration } from "../core/site-config.js";
import type { CommandReceipt, ServiceCheckpoint } from "../core/service.js";
import { DomainError, type Role } from "../core/types.js";
import {
  buildSourceReadSetV1,
  parseSourceReadSetV1,
  type SourceReadResource,
  type SourceReadSetV1,
} from "../core/source-read-set.js";

const checkpointId = fhirResourceId("Binary", "workflow-control-plane-v1");
const legacyCheckpointId = legacyFhirResourceId(
  "Binary",
  "workflow-control-plane-v1",
);
const checkpointContentType =
  "application/vnd.pflegehelfer.workflow-state+json+gzip";
const legacyCheckpointContentType =
  "application/vnd.pflegehelfer.workflow-state+json";
const checkpointCompressedByteLimit = 8 * 1024 * 1024;
const checkpointUncompressedByteLimit = 32 * 1024 * 1024;
const receiptContentType = "application/vnd.pflegehelfer.command-receipt+json";
const managedClinicalResourceTypes = [
  "Patient",
  "Practitioner",
  "Location",
  "Encounter",
  "CarePlan",
  "Goal",
  "Task",
  "Observation",
  "Communication",
  "DocumentReference",
  "QuestionnaireResponse",
] satisfies ResourceType[];
const transactionalClinicalResourceTypes: readonly ResourceType[] = [
  ...managedClinicalResourceTypes,
  "AuditEvent",
  "Provenance",
];
const dataClassificationSystem =
  "https://pflegehelfer.example.invalid/data-classification";
const observationApprovalStateSystem =
  "https://pflegehelfer.example.invalid/observation-approval-state";
const communicationWorkflowStateSystem =
  "https://pflegehelfer.example.invalid/communication-workflow-state";
const domainIdentifierSystems: Record<string, string> = {
  Patient: "https://pflegehelfer.example.invalid/patient-id",
  Encounter: "https://pflegehelfer.example.invalid/encounter-id",
  Task: "https://pflegehelfer.example.invalid/task-id",
  Observation: "https://pflegehelfer.example.invalid/observation-id",
  Communication: "https://pflegehelfer.example.invalid/communication-id",
};
const legacyResourceReferencePattern = new RegExp(
  `^(?:${managedClinicalResourceTypes.join("|")})/[A-Za-z0-9.-]{1,64}$`,
);

export function legacyMigrationResourceReferencesSha256(
  references: readonly string[],
): string {
  return createHash("sha256")
    .update(JSON.stringify([...references].sort()))
    .digest("hex");
}

interface LegacyMigrationManifest {
  expectedInstitutionId: string;
  expectedSiteId: string;
  expectedBinarySha256: string;
  legacyResourceReferences: string[];
  expectedResourceReferencesSha256: string;
  receiptRetentionExpiredAt: string;
}
function isNotFoundError(error: unknown): boolean {
  return (
    (typeof error === "object" &&
      error !== null &&
      "outcome" in error &&
      /not found|gone|deleted|"code":"deleted"/i.test(JSON.stringify(error))) ||
    (error instanceof Error &&
      /not found|gone|deleted|404|410/i.test(error.message))
  );
}
const identifiedRecord = z
  .object({ id: z.string().min(1).max(160) })
  .passthrough();
const patientRecord = identifiedRecord.extend({
  mrn: z.string().min(1).max(160),
  birthDate: z.iso.date(),
  encounterId: z.string().min(1).max(160),
  source: z.object({ version: z.number().int().nonnegative() }).passthrough(),
});
const patientBoundRecord = identifiedRecord.extend({
  patientId: z.string().min(1).max(160),
});
const commandReceiptAuthorizationSchema = z
  .object({
    actorId: z.string().min(1),
    actorRole: z.custom<Role>(
      (value) =>
        typeof value === "string" && value in siteConfiguration.roleProfiles,
    ),
    siteId: z.string().min(1),
    departmentId: z.string().min(1),
    route: z.string().min(1),
    purpose: z.enum([
      "direct-care",
      "operations",
      "administration",
      "quality-review",
      "emergency",
    ]),
    actions: z.array(actionSchema),
    patientId: z.string().min(1).nullable(),
    encounterId: z.string().min(1).nullable(),
    patientScopes: z.array(
      z
        .object({
          patientId: z.string().min(1),
          encounterId: z.string().min(1),
        })
        .strict(),
    ),
    workdayAuthority: z
      .object({
        sessionId: z.string().min(1),
        handoverId: z.string().min(1),
        handoverVersion: z.number().int().positive(),
        handoverContentHash: z.string().min(1),
      })
      .strict()
      .nullable(),
  })
  .strict();
const auditRecord = z
  .object({
    id: z.string().min(1).max(160),
    occurredAt: z.iso.datetime(),
    actorId: z.string().min(1).max(160),
    actorRole: z.string().min(1).max(80),
    actorType: z.enum(["human", "system"]).optional(),
    action: z.string().min(1).max(200),
    patientId: z.string().nullable(),
    purpose: z.string().min(1).max(80),
    outcome: z.enum(["allowed", "denied", "success", "failure"]),
    detail: z.record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    ),
    previousHash: z.string(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const checkpointSchema = z
  .object({
    schemaVersion: z.literal(1),
    writtenAt: z.iso.datetime(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    hmacSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    hmacKeyId: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    payload: z
      .object({
        formatVersion: z.literal(1),
        dataClass: z.enum(["synthetic-demo", "institution-local"]).optional(),
        state: z
          .object({
            users: z.array(identifiedRecord),
            patients: z.array(patientRecord),
            tasks: z.array(
              identifiedRecord.extend({ patientId: z.string().nullable() }),
            ),
            observations: z.array(patientBoundRecord),
            notes: z.array(patientBoundRecord),
            communications: z.array(patientBoundRecord),
            intake: z.array(patientBoundRecord),
            // Read only for migration of checkpoints written before the
            // operational workday became the sole handover authority.
            handovers: z.array(identifiedRecord).optional(),
            roundActions: z.array(patientBoundRecord),
            providerHealth: z.array(
              z.object({ provider: z.string().min(1).max(80) }).passthrough(),
            ),
            outbox: z.array(patientBoundRecord),
          })
          .strict(),
        audit: z.array(auditRecord),
        commandReceipts: z
          .array(
            z
              .object({
                key: z.string().min(1).max(1000),
                requestHash: z.string().regex(/^[a-f0-9]{64}$/),
                statusCode: z.number().int().min(200).max(299),
                payload: z.string().max(64 * 1024),
                // Legacy checkpoint receipts are retained only long enough to
                // parse the clinical checkpoint. They are filtered below and
                // can never be replayed without a v2 authorization envelope.
                authorization: commandReceiptAuthorizationSchema.optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
  })
  .strict();

export function serializeCheckpoint(
  checkpoint: ServiceCheckpoint,
  hmacKey: string | null,
): Binary {
  const payload = JSON.stringify(checkpoint);
  const envelope = {
    schemaVersion: 1 as const,
    writtenAt: new Date().toISOString(),
    sha256: createHash("sha256").update(payload).digest("hex"),
    ...(hmacKey
      ? {
          hmacKeyId: createHash("sha256")
            .update(hmacKey)
            .digest("hex")
            .slice(0, 16),
          hmacSha256: createHmac("sha256", hmacKey)
            .update(payload)
            .digest("hex"),
        }
      : {}),
    payload: checkpoint,
  };
  const envelopeBytes = Buffer.from(JSON.stringify(envelope), "utf8");
  if (envelopeBytes.byteLength > checkpointUncompressedByteLimit)
    throw new Error("Medplum workflow checkpoint exceeds the size limit.");
  const compressed = gzipSync(envelopeBytes, { level: 6 });
  if (compressed.byteLength > checkpointCompressedByteLimit)
    throw new Error("Medplum workflow checkpoint exceeds the size limit.");
  return {
    resourceType: "Binary",
    id: checkpointId,
    meta: {
      security: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality",
          code: "V",
          display: "very restricted",
        },
      ],
      tag: [
        {
          system: "https://pflegehelfer.example.invalid/control-plane",
          code: "workflow-checkpoint-v1",
        },
        {
          system: "https://pflegehelfer.example.invalid/data-classification",
          code: checkpoint.dataClass,
        },
        tenantTag(),
      ],
    },
    contentType: checkpointContentType,
    data: compressed.toString("base64"),
  };
}

export function deserializeCheckpoint(
  binary: Binary,
  hmacKey: string | null,
  previousHmacKeys: string[] = [],
): ServiceCheckpoint {
  if (
    ![checkpointContentType, legacyCheckpointContentType].includes(
      binary.contentType,
    ) ||
    !binary.data
  )
    throw new Error("Medplum workflow checkpoint has an unexpected format.");
  const encoded = Buffer.from(binary.data, "base64");
  if (encoded.byteLength > checkpointCompressedByteLimit)
    throw new Error("Medplum workflow checkpoint exceeds the size limit.");
  const envelopeBytes =
    binary.contentType === checkpointContentType
      ? gunzipSync(encoded, {
          maxOutputLength: checkpointUncompressedByteLimit,
        })
      : encoded;
  if (envelopeBytes.byteLength > checkpointUncompressedByteLimit)
    throw new Error("Medplum workflow checkpoint exceeds the size limit.");
  const rawEnvelope = JSON.parse(envelopeBytes.toString("utf8")) as {
    payload?: unknown;
    sha256?: unknown;
    hmacSha256?: unknown;
    hmacKeyId?: unknown;
  };
  const payload = JSON.stringify(rawEnvelope.payload);
  const actualHash = createHash("sha256").update(payload).digest("hex");
  if (actualHash !== rawEnvelope.sha256)
    throw new Error("Medplum workflow checkpoint failed integrity validation.");
  if (
    hmacKey &&
    !verifyHmac(payload, rawEnvelope.hmacSha256, rawEnvelope.hmacKeyId, [
      hmacKey,
      ...previousHmacKeys,
    ])
  )
    throw new Error(
      "Medplum workflow checkpoint failed authenticity validation.",
    );
  const envelope = checkpointSchema.parse(rawEnvelope);
  const legacyCheckpoint = envelope.payload as unknown as ServiceCheckpoint & {
    state: ServiceCheckpoint["state"] & { handovers?: Array<{ id: string }> };
  };
  const { handovers: retiredHandovers, ...currentState } =
    legacyCheckpoint.state;
  void retiredHandovers;
  const checkpoint: ServiceCheckpoint = {
    ...legacyCheckpoint,
    dataClass: legacyCheckpoint.dataClass ?? "institution-local",
    state: currentState,
    commandReceipts: (legacyCheckpoint.commandReceipts ?? []).filter(
      (receipt): receipt is CommandReceipt =>
        commandReceiptSchema.safeParse(receipt).success,
    ),
  };
  const assertUnique = (label: string, records: Array<{ id: string }>) => {
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new Error(
        `Medplum workflow checkpoint contains duplicate ${label} IDs.`,
      );
  };
  assertUnique("user", checkpoint.state.users);
  assertUnique("patient", checkpoint.state.patients);
  for (const [label, records] of Object.entries({
    task: checkpoint.state.tasks,
    observation: checkpoint.state.observations,
    note: checkpoint.state.notes,
    communication: checkpoint.state.communications,
    intake: checkpoint.state.intake,
    roundAction: checkpoint.state.roundActions,
    outbox: checkpoint.state.outbox,
  }))
    assertUnique(label, records);
  const patientIds = new Set(
    checkpoint.state.patients.map((patient) => patient.id),
  );
  const patientReferences = [
    ...checkpoint.state.tasks.flatMap((task) =>
      task.patientId ? [task.patientId] : [],
    ),
    ...checkpoint.state.observations.map((record) => record.patientId),
    ...checkpoint.state.notes.map((record) => record.patientId),
    ...checkpoint.state.communications.map((record) => record.patientId),
    ...checkpoint.state.intake.map((record) => record.patientId),
    ...checkpoint.state.roundActions.map((record) => record.patientId),
    ...checkpoint.state.outbox.map((record) => record.patientId),
  ];
  if (patientReferences.some((patientId) => !patientIds.has(patientId)))
    throw new Error(
      "Medplum workflow checkpoint contains an orphan patient reference.",
    );
  if (!verifyAuditEntries(checkpoint.audit))
    throw new Error("Medplum workflow checkpoint audit chain is invalid.");
  return checkpoint;
}

function verifyHmac(
  payload: string,
  provided: unknown,
  keyId: unknown,
  keys: string[],
): boolean {
  if (typeof provided !== "string" || !/^[a-f0-9]{64}$/.test(provided))
    return false;
  const providedBytes = Buffer.from(provided, "hex");
  return keys.some((key) => {
    const candidateKeyId = createHash("sha256")
      .update(key)
      .digest("hex")
      .slice(0, 16);
    if (typeof keyId === "string" && keyId !== candidateKeyId) return false;
    const expected = createHmac("sha256", key).update(payload).digest();
    return (
      expected.byteLength === providedBytes.byteLength &&
      timingSafeEqual(expected, providedBytes)
    );
  });
}

const commandReceiptSchema = z
  .object({
    key: z.string().min(1).max(1000),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    statusCode: z.number().int().min(200).max(299),
    payload: z.string().max(64 * 1024),
    authorization: commandReceiptAuthorizationSchema,
  })
  .strict();

function commandReceiptId(key: string): string {
  return fhirResourceId("Binary", `command-receipt:${key}`);
}

export function serializeCommandReceipt(
  receipt: CommandReceipt,
  hmacKey: string | null,
): Binary {
  const payload = JSON.stringify(commandReceiptSchema.parse(receipt));
  const envelope = {
    schemaVersion: 2,
    sha256: createHash("sha256").update(payload).digest("hex"),
    ...(hmacKey
      ? {
          hmacKeyId: createHash("sha256")
            .update(hmacKey)
            .digest("hex")
            .slice(0, 16),
          hmacSha256: createHmac("sha256", hmacKey)
            .update(payload)
            .digest("hex"),
        }
      : {}),
    payload: receipt,
  };
  return {
    resourceType: "Binary",
    id: commandReceiptId(receipt.key),
    meta: {
      security: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality",
          code: "V",
          display: "very restricted",
        },
      ],
      tag: [
        {
          system: "https://pflegehelfer.example.invalid/control-plane",
          code: "command-receipt-v2",
        },
        tenantTag(),
      ],
    },
    contentType: receiptContentType,
    data: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"),
  };
}

export function deserializeCommandReceipt(
  binary: Binary,
  expectedKey: string,
  hmacKey: string | null,
  previousHmacKeys: string[],
): CommandReceipt {
  if (binary.contentType !== receiptContentType || !binary.data)
    throw new Error("Medplum command receipt has an unexpected format.");
  const envelope = JSON.parse(
    Buffer.from(binary.data, "base64").toString("utf8"),
  ) as {
    schemaVersion?: unknown;
    sha256?: unknown;
    hmacSha256?: unknown;
    hmacKeyId?: unknown;
    payload?: unknown;
  };
  if (envelope.schemaVersion !== 2)
    throw new Error("Medplum command receipt has an unsupported version.");
  const payload = JSON.stringify(envelope.payload);
  const actualHash = createHash("sha256").update(payload).digest("hex");
  if (actualHash !== envelope.sha256)
    throw new Error("Medplum command receipt failed integrity validation.");
  if (
    hmacKey &&
    !verifyHmac(payload, envelope.hmacSha256, envelope.hmacKeyId, [
      hmacKey,
      ...previousHmacKeys,
    ])
  )
    throw new Error("Medplum command receipt failed authenticity validation.");
  const receipt = commandReceiptSchema.parse(envelope.payload);
  if (receipt.key !== expectedKey)
    throw new Error("Medplum command receipt key mismatch.");
  return receipt;
}

export interface ClinicalWorkspaceStatus {
  mode: "in-memory" | "medplum";
  ready: boolean;
  serverVersion: string | null;
  resourceCounts: Record<string, number>;
  message: string;
  checkedAt: string;
}

export interface ClinicalWorkspace {
  readonly mode: ClinicalWorkspaceStatus["mode"];
  initialize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
    options?: { reconcile: boolean },
  ): Promise<void>;
  synchronize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
    removedReferences?: string[],
    commandReceipt?: CommandReceipt,
    expectedVersions?: Readonly<Record<string, string | null>>,
  ): Promise<void>;
  loadResourceVersions?(
    references: readonly string[],
  ): Promise<Record<string, string | null>>;
  verifyProjection?(
    resources: Resource[],
    removedReferences?: readonly string[],
  ): Promise<boolean>;
  captureSourceReadSet(
    sourceReadSet: SourceReadSetV1,
    expectedResources?: readonly Resource[],
  ): Promise<SourceReadSetV1>;
  refreshSourceReadSet(
    sourceReadSet: SourceReadSetV1,
    expectedResources?: readonly Resource[],
  ): Promise<SourceReadSetV1>;
  loadCheckpoint(): Promise<ServiceCheckpoint | null>;
  loadCommandReceipt(key: string): Promise<CommandReceipt | null>;
  status(): Promise<ClinicalWorkspaceStatus>;
  detailUrl(resourceReference?: string): string | null;
}

export class InMemoryClinicalWorkspace implements ClinicalWorkspace {
  readonly mode = "in-memory" as const;
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  synchronize(): Promise<void> {
    return Promise.resolve();
  }
  loadResourceVersions(
    references: readonly string[],
  ): Promise<Record<string, string | null>> {
    return Promise.resolve(
      Object.fromEntries(references.map((reference) => [reference, null])),
    );
  }
  verifyProjection(): Promise<boolean> {
    return Promise.resolve(true);
  }
  captureSourceReadSet(
    sourceReadSet: SourceReadSetV1,
  ): Promise<SourceReadSetV1> {
    const parsed = parseSourceReadSetV1(sourceReadSet);
    if (parsed.evidenceAuthority !== "memory-demo-not-fhir-evident")
      return Promise.reject(new Error("MEMORY_SOURCE_READ_AUTHORITY_INVALID"));
    return Promise.resolve(parsed);
  }
  refreshSourceReadSet(
    sourceReadSet: SourceReadSetV1,
  ): Promise<SourceReadSetV1> {
    return this.captureSourceReadSet(sourceReadSet);
  }
  loadCheckpoint(): Promise<ServiceCheckpoint | null> {
    return Promise.resolve(null);
  }
  loadCommandReceipt(): Promise<CommandReceipt | null> {
    return Promise.resolve(null);
  }
  status(): Promise<ClinicalWorkspaceStatus> {
    return Promise.resolve({
      mode: this.mode,
      ready: true,
      serverVersion: null,
      resourceCounts: {},
      message: "Deterministischer Referenzspeicher",
      checkedAt: new Date().toISOString(),
    });
  }
  detailUrl(): string | null {
    return null;
  }
}

export class MedplumClinicalWorkspace implements ClinicalWorkspace {
  readonly mode = "medplum" as const;
  private readonly client: MedplumClient;
  private login: Promise<unknown> | null = null;
  private checkpointVersionId: string | null = null;
  private legacyCheckpointReferenceToDelete: string | null = null;
  private legacyResourceReferencesToDelete: string[] = [];
  private statusCache: {
    expiresAt: number;
    value: ClinicalWorkspaceStatus;
  } | null = null;
  private statusInFlight: Promise<ClinicalWorkspaceStatus> | null = null;
  private transactionAtomicityVerified = false;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly appBaseUrl: string,
    private readonly checkpointHmacKey: string | null = null,
    private readonly previousCheckpointHmacKeys: string[] = [],
    private readonly legacyMigration: LegacyMigrationManifest | null = null,
  ) {
    this.client = new MedplumClient({
      baseUrl,
      cacheTime: 0,
      maxRetries: 2,
    });
    if (legacyMigration) {
      const references = legacyMigration.legacyResourceReferences;
      const retentionExpiredAt = Date.parse(
        legacyMigration.receiptRetentionExpiredAt,
      );
      if (
        references.length === 0 ||
        references.length > 2_000 ||
        new Set(references).size !== references.length ||
        references.some(
          (reference) => !legacyResourceReferencePattern.test(reference),
        ) ||
        legacyMigrationResourceReferencesSha256(references) !==
          legacyMigration.expectedResourceReferencesSha256 ||
        !Number.isFinite(retentionExpiredAt) ||
        retentionExpiredAt > Date.now()
      )
        throw new Error(
          "Legacy migration requires an exact digest-bound resource inventory and an elapsed command-receipt retention gate.",
        );
    }
  }

  detailUrl(resourceReference = ""): string | null {
    const base = this.appBaseUrl.endsWith("/")
      ? this.appBaseUrl
      : `${this.appBaseUrl}/`;
    const safeReference =
      /^(Patient|Task|Observation|Communication|DocumentReference|QuestionnaireResponse)\/[A-Za-z0-9.-]{1,64}$/.test(
        resourceReference,
      )
        ? resourceReference
        : "";
    return new URL(
      safeReference ? `${safeReference}/details` : "",
      base,
    ).toString();
  }

  private connect(): Promise<unknown> {
    this.login ??= this.client.startClientLogin(
      this.clientId,
      this.clientSecret,
    );
    return this.login;
  }

  async initialize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
    options: { reconcile: boolean } = { reconcile: true },
  ): Promise<void> {
    await this.connect();
    if (this.legacyCheckpointReferenceToDelete)
      this.assertLegacyInventoryDoesNotOverlap(resources);
    await this.verifyTransactionAtomicity();
    // A loaded, authenticated checkpoint already names the committed
    // projection. Replaying it during a rolling restart could overwrite a
    // newer replica's FHIR resources before checkpoint CAS detects the race.
    // A verified legacy checkpoint is not yet a committed scoped projection.
    // Its migration must materialize the complete site-scoped resource set and
    // atomically replace the legacy Binary even though startup did load state.
    if (!options.reconcile && !this.legacyCheckpointReferenceToDelete) return;
    // Medplum also limits request-body bytes, not only the FHIR Bundle entry
    // count. A restored checkpoint can grow independently from the current
    // materialized clinical resources, so never combine it with the boot-time
    // reconciliation bundle. Small, deterministic batches keep startup below
    // common reverse-proxy limits while each batch remains atomic.
    for (let offset = 0; offset < resources.length; offset += 40)
      await this.synchronize(resources.slice(offset, offset + 40));
    if (this.legacyCheckpointReferenceToDelete)
      await this.removeApprovedLegacyResources();
    if (checkpoint) await this.synchronize([], checkpoint);
    await this.removeStaleManagedResources(resources);
  }

  private async removeApprovedLegacyResources(): Promise<void> {
    for (
      let offset = 0;
      offset < this.legacyResourceReferencesToDelete.length;
      offset += 40
    ) {
      const chunk = this.legacyResourceReferencesToDelete.slice(
        offset,
        offset + 40,
      );
      const transaction: Bundle = {
        resourceType: "Bundle",
        type: "transaction",
        entry: chunk.map((reference) => ({
          request: { method: "DELETE", url: reference },
        })),
      };
      const response = await this.client.executeBatch(transaction);
      const failed = response.entry?.find(
        (entry) => !/^2\d\d(?:\s|$)/.test(entry.response?.status ?? ""),
      );
      if (failed)
        throw new Error(
          `Medplum legacy-resource cleanup rejected: ${failed.response?.status ?? "missing status"}`,
        );
    }
  }

  private assertLegacyInventoryDoesNotOverlap(
    scopedResources: Resource[],
  ): void {
    const scopedReferences = new Set(
      scopedResources
        .filter((resource) => resource.id)
        .map((resource) => `${resource.resourceType}/${resource.id}`),
    );
    if (
      this.legacyResourceReferencesToDelete.some((reference) =>
        scopedReferences.has(reference),
      )
    )
      throw new Error(
        "Legacy migration inventory overlaps the active site-scoped projection.",
      );
  }

  private async verifyTransactionAtomicity(): Promise<void> {
    if (this.transactionAtomicityVerified) return;
    const suffix = fhirResourceId("Patient", `atomicity-${randomUUID()}`);
    const patientId = `atomicity-${suffix}`.slice(0, 64);
    const invalidObservationId = `invalid-${suffix}`.slice(0, 64);
    const deliberatelyFailing: Bundle = {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          resource: {
            resourceType: "Patient",
            id: patientId,
            meta: {
              tag: [
                {
                  system: "https://pflegehelfer.example.invalid/verification",
                  code: "transaction-atomicity",
                },
              ],
            },
          },
          request: { method: "PUT", url: `Patient/${patientId}` },
        },
        {
          resource: {
            resourceType: "Observation",
            id: invalidObservationId,
          } as unknown as Resource,
          request: {
            method: "PUT",
            url: `Observation/${invalidObservationId}`,
          },
        },
      ],
    };
    let rejected = false;
    try {
      const response = await this.client.executeBatch(deliberatelyFailing);
      rejected = Boolean(
        response.entry?.some(
          (entry) => !/^2\d\d(?:\s|$)/.test(entry.response?.status ?? ""),
        ),
      );
    } catch {
      rejected = true;
    }
    if (!rejected)
      throw new Error("MEDPLUM_TRANSACTION_FAILURE_WAS_NOT_REJECTED");
    try {
      await this.client.readResource("Patient", patientId);
      await this.client
        .deleteResource("Patient", patientId)
        .catch(() => undefined);
      throw new Error("MEDPLUM_TRANSACTION_PARTIAL_WRITE_DETECTED");
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
    this.transactionAtomicityVerified = true;
  }

  async synchronize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
    removedReferences: string[] = [],
    commandReceipt?: CommandReceipt,
    expectedVersions?: Readonly<Record<string, string | null>>,
  ): Promise<void> {
    await this.connect();
    if (checkpoint && !this.checkpointVersionId) {
      try {
        const current = await this.client.readResource("Binary", checkpointId);
        this.checkpointVersionId = current.meta?.versionId ?? null;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }
    const noteMigrationResources =
      await this.supersededNoteResources(resources);
    const synchronizedResources = [
      ...resources,
      ...noteMigrationResources,
      ...(checkpoint
        ? [serializeCheckpoint(checkpoint, this.checkpointHmacKey)]
        : []),
      ...(commandReceipt
        ? [serializeCommandReceipt(commandReceipt, this.checkpointHmacKey)]
        : []),
    ];
    const referencesToRemove = [
      ...removedReferences,
      ...(checkpoint && this.legacyCheckpointReferenceToDelete
        ? [this.legacyCheckpointReferenceToDelete]
        : []),
    ];
    const entryCount = synchronizedResources.length + referencesToRemove.length;
    if (entryCount > 500)
      throw new Error("MEDPLUM_TRANSACTION_ENTRY_LIMIT_EXCEEDED");
    const transaction: Bundle = {
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        ...synchronizedResources.map((resource) => ({
          resource,
          request: {
            method: "PUT" as const,
            url: `${resource.resourceType}/${resource.id}`,
            ...(resource.resourceType === "Binary" &&
            resource.id === checkpointId &&
            this.checkpointVersionId
              ? { ifMatch: `W/"${this.checkpointVersionId}"` }
              : expectedVersions &&
                  Object.hasOwn(
                    expectedVersions,
                    `${resource.resourceType}/${resource.id}`,
                  )
                ? expectedVersions[`${resource.resourceType}/${resource.id}`]
                  ? {
                      ifMatch: `W/"${expectedVersions[`${resource.resourceType}/${resource.id}`]}"`,
                    }
                  : {}
                : {}),
          },
        })),
        ...referencesToRemove.map((reference) => ({
          request: {
            method: "DELETE" as const,
            url: reference,
            ...(expectedVersions && Object.hasOwn(expectedVersions, reference)
              ? expectedVersions[reference]
                ? { ifMatch: `W/"${expectedVersions[reference]}"` }
                : {}
              : {}),
          },
        })),
      ],
    };
    const response = await this.client.executeBatch(transaction);
    const failed = response.entry?.find((entry) => {
      const status = entry.response?.status ?? "";
      return !/^2\d\d(?:\s|$)/.test(status);
    });
    if (failed) {
      const diagnostics = JSON.stringify(failed.response?.outcome ?? {})
        .replace(/\s+/g, " ")
        .slice(0, 320);
      throw new Error(
        `Medplum transaction rejected: ${failed.response?.status ?? "missing status"}${diagnostics && diagnostics !== "{}" ? ` (${diagnostics})` : ""}`,
      );
    }
    if (checkpoint) {
      const checkpointIndex = synchronizedResources.findIndex(
        (resource) => resource.resourceType === "Binary",
      );
      const metadata = response.entry?.[checkpointIndex]?.response;
      const versionMatch =
        /W\/"([^"]+)"/.exec(metadata?.etag ?? "") ??
        /\/_history\/([^/]+)$/.exec(metadata?.location ?? "");
      this.checkpointVersionId = versionMatch?.[1] ?? null;
      this.legacyCheckpointReferenceToDelete = null;
      this.legacyResourceReferencesToDelete = [];
    }
  }

  async loadResourceVersions(
    references: readonly string[],
  ): Promise<Record<string, string | null>> {
    await this.connect();
    const versions: Record<string, string | null> = {};
    for (const reference of [...new Set(references)]) {
      const match = /^([A-Za-z][A-Za-z]+)\/([A-Za-z0-9.-]{1,64})$/.exec(
        reference,
      );
      if (
        !match ||
        !transactionalClinicalResourceTypes.includes(match[1] as ResourceType)
      )
        throw new Error(`INVALID_CLINICAL_RESOURCE_REFERENCE:${reference}`);
      try {
        const resource = await this.client.readResource(
          match[1] as ResourceType,
          match[2]!,
        );
        const version = resource.meta?.versionId;
        if (!version)
          throw new Error(`MEDPLUM_RESOURCE_VERSION_MISSING:${reference}`);
        versions[reference] = version;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
        versions[reference] = null;
      }
    }
    return versions;
  }

  private async readSourceReadSet(
    input: SourceReadSetV1,
    requireDraftMatch: boolean,
    expectedResources: readonly Resource[] = [],
  ): Promise<SourceReadSetV1> {
    await this.connect();
    const reviewed = parseSourceReadSetV1(input);
    const physicalReference = (logicalReference: string): string => {
      const [resourceType, domainId] = logicalReference.split("/");
      if (!resourceType || !domainId)
        throw new Error(
          `INVALID_CLINICAL_RESOURCE_REFERENCE:${logicalReference}`,
        );
      return `${resourceType}/${fhirResourceId(resourceType, domainId)}`;
    };
    const tagCode = (resource: Resource, system: string) =>
      resource.meta?.tag?.find((tag) => tag.system === system)?.code ?? null;
    const referenceOf = (resource: Resource): string => {
      if (!resource.id) throw new Error("SOURCE_READ_RESOURCE_ID_MISSING");
      return `${resource.resourceType}/${resource.id}`;
    };
    const logicalReferenceOf = (resource: Resource): string => {
      const system = domainIdentifierSystems[resource.resourceType];
      const identified = resource as Resource & {
        identifier?: Array<{ system?: string; value?: string }>;
      };
      const domainId = identified.identifier?.find(
        (identifier) => identifier.system === system,
      )?.value;
      // Authorized imported/native resources need not carry Pflegehelfer's
      // projection identifier. Their server-owned physical reference remains
      // the stable logical handle; managedProjection tags are never required
      // for read evidence.
      return domainId
        ? `${resource.resourceType}/${domainId}`
        : referenceOf(resource);
    };
    const expectedPhysicalByLogical = new Map(
      reviewed.resources.map((resource) => [
        resource.logicalReference,
        physicalReference(resource.logicalReference),
      ]),
    );
    const resourcesByReference = new Map<string, Resource>();
    const expectedByReference = new Map<string, Resource>(
      expectedResources.flatMap((resource) =>
        resource.id
          ? [[`${resource.resourceType}/${resource.id}`, resource] as const]
          : [],
      ),
    );
    const contentDigest = (resource: Resource): string => {
      const normalized = structuredClone(resource);
      if (normalized.meta) {
        delete normalized.meta.versionId;
        delete normalized.meta.lastUpdated;
      }
      const canonical = (value: unknown): string => {
        if (value === null || typeof value !== "object")
          return JSON.stringify(value);
        if (Array.isArray(value))
          return `[${value.map((item) => canonical(item)).join(",")}]`;
        const record = value as Record<string, unknown>;
        return `{${Object.keys(record)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
          .join(",")}}`;
      };
      return createHash("sha256").update(canonical(normalized)).digest("hex");
    };
    const selectorResults = [] as SourceReadSetV1["selectors"];
    for (const selector of reviewed.selectors) {
      const patientReference = `Patient/${fhirResourceId("Patient", selector.patientId)}`;
      const encounterReference = `Encounter/${fhirResourceId("Encounter", selector.encounterId)}`;
      const sort =
        selector.order === "due-asc"
          ? "period"
          : selector.order === "effective-desc"
            ? "-date"
            : "-sent";
      const query = new URLSearchParams({
        patient: patientReference,
        encounter: encounterReference,
        _count: "100",
        _total: "accurate",
        _sort: sort,
      });
      const existing: Resource[] = [];
      let pageCount = 0;
      for await (const page of this.client.searchResourcePages(
        selector.resourceType,
        query,
      )) {
        pageCount += 1;
        if (pageCount > 100 || existing.length + page.length > 10_000)
          throw new Error("SOURCE_READ_SELECTOR_INCOMPLETE");
        existing.push(...page);
      }
      const matching = existing.filter((resource) => {
        const candidate = resource as Resource & {
          for?: { reference?: string };
          subject?: { reference?: string };
          encounter?: { reference?: string };
          businessStatus?: { coding?: Array<{ code?: string }> };
        };
        const patientMatches =
          (candidate.for?.reference ?? candidate.subject?.reference) ===
          patientReference;
        if (
          !patientMatches ||
          candidate.encounter?.reference !== encounterReference
        )
          return false;
        if (selector.predicate === "task-open") {
          const state = candidate.businessStatus?.coding?.find(({ code }) =>
            Boolean(code),
          )?.code;
          if (!state)
            throw new Error(
              `SOURCE_READ_SELECTOR_STATE_MISSING:${referenceOf(resource)}`,
            );
          return state !== "completed";
        }
        if (selector.predicate === "observation-accepted") {
          const state = tagCode(resource, observationApprovalStateSystem);
          if (!state)
            throw new Error(
              `SOURCE_READ_SELECTOR_STATE_MISSING:${referenceOf(resource)}`,
            );
          return state === "accepted";
        }
        const state = tagCode(resource, communicationWorkflowStateSystem);
        if (!state)
          throw new Error(
            `SOURCE_READ_SELECTOR_STATE_MISSING:${referenceOf(resource)}`,
          );
        return state !== "closed";
      });
      matching.sort((left, right) => {
        const leftRecord = left as Resource & {
          executionPeriod?: { end?: string };
          effectiveDateTime?: string;
          sent?: string;
        };
        const rightRecord = right as typeof leftRecord;
        const leftValue =
          selector.order === "due-asc"
            ? (leftRecord.executionPeriod?.end ?? "9999")
            : selector.order === "effective-desc"
              ? (leftRecord.effectiveDateTime ?? "")
              : (leftRecord.sent ?? "");
        const rightValue =
          selector.order === "due-asc"
            ? (rightRecord.executionPeriod?.end ?? "9999")
            : selector.order === "effective-desc"
              ? (rightRecord.effectiveDateTime ?? "")
              : (rightRecord.sent ?? "");
        const direction = selector.order === "due-asc" ? 1 : -1;
        return (
          direction * leftValue.localeCompare(rightValue) ||
          referenceOf(left).localeCompare(referenceOf(right))
        );
      });
      for (const resource of matching)
        resourcesByReference.set(referenceOf(resource), resource);
      const orderedReferences = matching.map(referenceOf);
      const membershipReferences = [...orderedReferences].sort();
      const selectedReferences = orderedReferences.slice(0, selector.limit);
      if (requireDraftMatch) {
        const expectedMembership = selector.membershipReferences
          .map((reference) =>
            reviewed.evidenceAuthority === "fhir-meta-versionId"
              ? reference
              : physicalReference(reference),
          )
          .sort();
        const expectedSelected = selector.selectedReferences.map((reference) =>
          reviewed.evidenceAuthority === "fhir-meta-versionId"
            ? reference
            : physicalReference(reference),
        );
        if (
          JSON.stringify(expectedMembership) !==
            JSON.stringify(membershipReferences) ||
          JSON.stringify(expectedSelected) !==
            JSON.stringify(selectedReferences)
        )
          throw new Error(`SOURCE_READ_SET_DRAFT_STALE:${selector.id}`);
      }
      selectorResults.push({
        ...selector,
        totalCount: membershipReferences.length,
        // searchResourcePages exposes resource arrays, not the raw Bundle
        // total/next-link evidence. We therefore cannot prove that the
        // selector exhausted the server result set and must fail closed on
        // completeness and absence claims even after consuming every yielded
        // page. Membership/version evidence remains usable for positive reads.
        complete: false,
        absenceObserved: false,
        membershipReferences,
        selectedReferences,
      });
    }
    for (const reviewedResource of reviewed.resources) {
      const reference =
        reviewed.evidenceAuthority === "fhir-meta-versionId"
          ? reviewedResource.reference
          : expectedPhysicalByLogical.get(reviewedResource.logicalReference)!;
      if (resourcesByReference.has(reference)) continue;
      const [resourceType, id] = reference.split("/");
      try {
        const resource = await this.client.readResource(
          resourceType as ResourceType,
          id!,
        );
        resourcesByReference.set(reference, resource);
      } catch (error) {
        if (isNotFoundError(error))
          throw new Error(`SOURCE_READ_RESOURCE_MISSING:${reference}`);
        throw error;
      }
    }
    const reviewedByLogical = new Map(
      reviewed.resources.map((resource) => [
        resource.logicalReference,
        resource,
      ]),
    );
    const resources: SourceReadResource[] = [
      ...resourcesByReference.values(),
    ].map((resource) => {
      const reference = referenceOf(resource);
      const logicalReference = logicalReferenceOf(resource);
      const version = resource.meta?.versionId;
      if (!version)
        throw new Error(`MEDPLUM_RESOURCE_VERSION_MISSING:${reference}`);
      const prior = reviewedByLogical.get(logicalReference);
      const expected = expectedByReference.get(reference);
      if (
        requireDraftMatch &&
        prior &&
        (!expected || contentDigest(expected) !== contentDigest(resource))
      )
        throw new Error(`SOURCE_READ_RESOURCE_CONTENT_CHANGED:${reference}`);
      return {
        reference,
        logicalReference,
        version,
        ...(prior?.patientId ? { patientId: prior.patientId } : {}),
        ...(prior?.encounterId ? { encounterId: prior.encounterId } : {}),
        claims: prior?.claims ?? [],
      };
    });
    return buildSourceReadSetV1({
      schemaVersion: 1,
      evidenceAuthority: "fhir-meta-versionId",
      capturedAt: new Date().toISOString(),
      purpose: reviewed.purpose,
      policyVersion: reviewed.policyVersion,
      patientId: reviewed.patientId,
      encounterId: reviewed.encounterId,
      resources,
      selectors: selectorResults,
    });
  }

  captureSourceReadSet(
    sourceReadSet: SourceReadSetV1,
    expectedResources: readonly Resource[] = [],
  ): Promise<SourceReadSetV1> {
    return this.readSourceReadSet(sourceReadSet, true, expectedResources);
  }

  refreshSourceReadSet(
    sourceReadSet: SourceReadSetV1,
    expectedResources: readonly Resource[] = [],
  ): Promise<SourceReadSetV1> {
    return this.readSourceReadSet(sourceReadSet, false, expectedResources);
  }

  async verifyProjection(
    resources: Resource[],
    removedReferences: readonly string[] = [],
  ): Promise<boolean> {
    await this.connect();
    const canonical = (value: unknown): string => {
      if (value === null || typeof value !== "object")
        return JSON.stringify(value);
      if (Array.isArray(value))
        return `[${value.map((item) => canonical(item)).join(",")}]`;
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
        .join(",")}}`;
    };
    const normalize = (resource: Resource): unknown => {
      const copy = structuredClone(resource);
      if (copy.meta) {
        delete copy.meta.versionId;
        delete copy.meta.lastUpdated;
        delete copy.meta.author;
        delete copy.meta.project;
        delete copy.meta.compartment;
      }
      return copy;
    };
    for (const expected of resources) {
      if (!expected.id) return false;
      const actual = await this.client.readResource(
        expected.resourceType,
        expected.id,
      );
      if (canonical(normalize(actual)) !== canonical(normalize(expected)))
        return false;
    }
    for (const reference of removedReferences) {
      const match = /^([A-Za-z][A-Za-z]+)\/([A-Za-z0-9.-]{1,64})$/.exec(
        reference,
      );
      if (!match) return false;
      try {
        await this.client.readResource(match[1] as ResourceType, match[2]!);
        return false;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }
    return true;
  }

  private async supersededNoteResources(
    resources: Resource[],
  ): Promise<Resource[]> {
    const migrated: Resource[] = [];
    for (const resource of resources) {
      if (resource.resourceType !== "DocumentReference") continue;
      const noteId = resource.identifier?.find(
        (identifier) =>
          identifier.system === "https://pflegehelfer.example.invalid/note-id",
      )?.value;
      if (!noteId) continue;
      const priorId = fhirResourceId("QuestionnaireResponse", noteId);
      const migrationRecordedAt =
        "date" in resource && typeof resource.date === "string"
          ? resource.date
          : "2026-09-05T00:00:00.000Z";
      try {
        const prior = await this.client.readResource(
          "QuestionnaireResponse",
          priorId,
        );
        const isSameTenant = prior.meta?.tag?.some(
          (tag) =>
            tag.system === tenantTagSystem && tag.code === tenantTag().code,
        );
        if (!isSameTenant)
          throw new Error(
            "Refusing to migrate a note representation without the exact institution/site tag.",
          );
        migrated.push(
          {
            ...prior,
            status: "amended",
            meta: {
              ...prior.meta,
              tag: [
                ...(prior.meta?.tag ?? []).filter(
                  (tag) =>
                    tag.system !==
                    "https://pflegehelfer.example.invalid/representation-status",
                ),
                {
                  system:
                    "https://pflegehelfer.example.invalid/representation-status",
                  code: "superseded-by-document-reference",
                },
              ],
            },
          },
          {
            resourceType: "Provenance",
            id: fhirResourceId(
              "Provenance",
              `note-representation-migration/${noteId}`,
            ),
            recorded: migrationRecordedAt,
            meta: {
              tag: [
                tenantTag(),
                managedProjectionTag,
                ...(resource.meta?.tag?.filter(
                  (tag) => tag.system === dataClassificationSystem,
                ) ?? []),
              ],
            },
            target: [{ reference: `DocumentReference/${resource.id}` }],
            agent: [{ who: { display: "Pflegehelfer canonical mapper" } }],
            entity: [
              {
                role: "source",
                what: {
                  reference: `QuestionnaireResponse/${priorId}`,
                },
              },
            ],
          },
        );
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }
    return migrated;
  }

  private async removeStaleManagedResources(
    resources: Resource[],
  ): Promise<void> {
    const expected = new Set(
      resources
        .filter((resource) => resource.id)
        .map((resource) => `${resource.resourceType}/${resource.id}`),
    );
    const managedTags = new Set(
      resources.flatMap((resource) =>
        (resource.meta?.tag ?? [])
          .filter(
            (tag) =>
              tag.system === dataClassificationSystem && Boolean(tag.code),
          )
          .map((tag) => `${dataClassificationSystem}|${tag.code}`),
      ),
    );
    const stale: Resource[] = [];
    const scopedTenantTag = `${tenantTagSystem}|${tenantTag().code}`;
    const scopedProjectionTag = `${managedProjectionTag.system}|${managedProjectionTag.code}`;
    for (const resourceType of managedClinicalResourceTypes) {
      for (const managedTag of managedTags) {
        const existing = await this.client.searchResources(
          resourceType,
          `_tag=${encodeURIComponent(managedTag)}&_tag=${encodeURIComponent(scopedTenantTag)}&_tag=${encodeURIComponent(scopedProjectionTag)}&_count=1000`,
        );
        stale.push(
          ...existing.filter(
            (resource) =>
              resource.id &&
              !expected.has(`${resource.resourceType}/${resource.id}`),
          ),
        );
      }
    }
    for (let offset = 0; offset < stale.length; offset += 40) {
      const chunk = stale.slice(offset, offset + 40);
      const transaction: Bundle = {
        resourceType: "Bundle",
        type: "transaction",
        entry: chunk.map((resource) => ({
          request: {
            method: "DELETE",
            url: `${resource.resourceType}/${resource.id}`,
          },
        })),
      };
      const response = await this.client.executeBatch(transaction);
      const failed = response.entry?.find((entry) => {
        const status = entry.response?.status ?? "";
        return !/^2\d\d(?:\s|$)/.test(status);
      });
      if (failed)
        throw new Error(
          `Medplum stale-resource cleanup rejected: ${failed.response?.status ?? "missing status"}`,
        );
    }
  }

  async loadCheckpoint(): Promise<ServiceCheckpoint | null> {
    await this.connect();
    try {
      const binary = await this.client.readResource("Binary", checkpointId);
      this.checkpointVersionId = binary.meta?.versionId ?? null;
      return deserializeCheckpoint(
        binary,
        this.checkpointHmacKey,
        this.previousCheckpointHmacKeys,
      );
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      if (
        !this.legacyMigration ||
        this.legacyMigration.expectedInstitutionId !==
          siteConfiguration.institutionId ||
        this.legacyMigration.expectedSiteId !== siteConfiguration.siteId
      )
        return null;
      try {
        const legacy = await this.client.readResource(
          "Binary",
          legacyCheckpointId,
        );
        const actualBinarySha256 = createHash("sha256")
          .update(legacy.data ?? "")
          .digest("hex");
        if (actualBinarySha256 !== this.legacyMigration.expectedBinarySha256)
          throw new Error(
            "Legacy checkpoint does not match the approved migration manifest.",
          );
        const restored = deserializeCheckpoint(
          legacy,
          this.checkpointHmacKey,
          this.previousCheckpointHmacKeys,
        );
        this.checkpointVersionId = null;
        this.legacyCheckpointReferenceToDelete = `Binary/${legacyCheckpointId}`;
        this.legacyResourceReferencesToDelete = [
          ...this.legacyMigration.legacyResourceReferences,
          ...(restored.commandReceipts ?? []).map(
            (receipt) =>
              `Binary/${legacyFhirResourceId("Binary", `command-receipt:${receipt.key}`)}`,
          ),
        ].filter(
          (reference, index, references) =>
            references.indexOf(reference) === index,
        );
        return restored;
      } catch (legacyError) {
        if (isNotFoundError(legacyError)) return null;
        throw legacyError;
      }
    }
  }

  async loadCommandReceipt(key: string): Promise<CommandReceipt | null> {
    await this.connect();
    try {
      const binary = await this.client.readResource(
        "Binary",
        commandReceiptId(key),
      );
      return deserializeCommandReceipt(
        binary,
        key,
        this.checkpointHmacKey,
        this.previousCheckpointHmacKeys,
      );
    } catch (error) {
      if (isNotFoundError(error)) return null;
      if (
        error instanceof Error &&
        error.message === "Medplum command receipt has an unsupported version."
      )
        throw new DomainError(
          "INVALID_STATE",
          "Der frühere Operationsbeleg kann nach dem Sicherheitsupgrade nicht automatisch wiederaufgenommen werden. Bitte den Status prüfen, bevor eine neue Aktion gestartet wird.",
          409,
        );
      throw error;
    }
  }

  async status(): Promise<ClinicalWorkspaceStatus> {
    if (this.statusCache && this.statusCache.expiresAt > Date.now())
      return structuredClone(this.statusCache.value);
    if (this.statusInFlight) return this.statusInFlight;
    this.statusInFlight = this.readStatus();
    try {
      const value = await this.statusInFlight;
      this.statusCache = { expiresAt: Date.now() + 30_000, value };
      return structuredClone(value);
    } finally {
      this.statusInFlight = null;
    }
  }

  private async readStatus(): Promise<ClinicalWorkspaceStatus> {
    const checkedAt = new Date().toISOString();
    try {
      await this.connect();
      const capability = await this.client.get<CapabilityStatement>(
        `fhir/R4/metadata?_summary=true`,
      );
      const resourceTypes = [
        "Patient",
        "Encounter",
        "Task",
        "Observation",
        "Communication",
        "DocumentReference",
        "CarePlan",
        "Goal",
      ] satisfies ResourceType[];
      const countPairs = await Promise.all(
        resourceTypes.map(async (resourceType) => {
          const result = await this.client.search(
            resourceType,
            "_summary=count",
          );
          return [resourceType, result.total ?? 0] as const;
        }),
      );
      return {
        mode: this.mode,
        ready: true,
        serverVersion: capability.software?.version ?? null,
        resourceCounts: Object.fromEntries(countPairs),
        message: this.transactionAtomicityVerified
          ? "Medplum FHIR R4 erreichbar; Transaktionsatomizität verifiziert"
          : "Medplum FHIR R4 erreichbar; Transaktionsprüfung noch nicht ausgeführt",
        checkedAt,
      };
    } catch {
      this.login = null;
      return {
        mode: this.mode,
        ready: false,
        serverVersion: null,
        resourceCounts: {},
        message: "Medplum nicht erreichbar oder Anmeldung fehlgeschlagen",
        checkedAt,
      };
    }
  }
}

export function clinicalWorkspaceFromEnvironment(): ClinicalWorkspace {
  const demoMode = process.env.PFH_DEMO_MODE === "true";
  if (process.env.PFH_STORAGE_MODE !== "medplum") {
    if (!demoMode)
      throw new Error(
        "Production startup requires PFH_STORAGE_MODE=medplum; in-memory storage is test/demo only.",
      );
    return new InMemoryClinicalWorkspace();
  }
  const baseUrl = process.env.PFH_FHIR_BASE_URL;
  const clientId =
    process.env.MEDPLUM_CLIENT_ID ??
    (demoMode ? process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_ID : undefined);
  const clientSecret =
    process.env.MEDPLUM_CLIENT_SECRET ??
    (demoMode
      ? process.env.MEDPLUM_DEFAULT_SUPER_ADMIN_CLIENT_SECRET
      : undefined);
  const appBaseUrl = process.env.MEDPLUM_APP_BASE_URL;
  const checkpointHmacKey = process.env.PFH_CHECKPOINT_HMAC_KEY ?? null;
  const previousCheckpointHmacKeys = (
    process.env.PFH_CHECKPOINT_HMAC_PREVIOUS_KEYS ?? ""
  )
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  const legacyMigration =
    process.env.PFH_ALLOW_LEGACY_UNSCOPED_MIGRATION === "true"
      ? {
          expectedInstitutionId:
            process.env.PFH_LEGACY_MIGRATION_INSTITUTION_ID ?? "",
          expectedSiteId: process.env.PFH_LEGACY_MIGRATION_SITE_ID ?? "",
          expectedBinarySha256:
            process.env.PFH_LEGACY_CHECKPOINT_BINARY_SHA256 ?? "",
          legacyResourceReferences: (
            process.env.PFH_LEGACY_MIGRATION_RESOURCE_REFERENCES ?? ""
          )
            .split(",")
            .map((reference) => reference.trim())
            .filter(Boolean),
          expectedResourceReferencesSha256:
            process.env.PFH_LEGACY_MIGRATION_RESOURCE_REFERENCES_SHA256 ?? "",
          receiptRetentionExpiredAt:
            process.env.PFH_LEGACY_RECEIPT_RETENTION_EXPIRED_AT ?? "",
        }
      : null;
  if (!baseUrl || !clientId || !clientSecret || !appBaseUrl)
    throw new Error(
      "Medplum mode requires FHIR/app base URLs and generated client credentials.",
    );
  if (
    !demoMode &&
    (!checkpointHmacKey || Buffer.byteLength(checkpointHmacKey, "utf8") < 32)
  )
    throw new Error(
      "Production Medplum mode requires a PFH_CHECKPOINT_HMAC_KEY of at least 32 bytes.",
    );
  if (
    !demoMode &&
    previousCheckpointHmacKeys.some(
      (key) => Buffer.byteLength(key, "utf8") < 32,
    )
  )
    throw new Error(
      "Every PFH_CHECKPOINT_HMAC_PREVIOUS_KEYS entry must contain at least 32 bytes.",
    );
  if (
    legacyMigration &&
    (legacyMigration.expectedInstitutionId !==
      siteConfiguration.institutionId ||
      legacyMigration.expectedSiteId !== siteConfiguration.siteId ||
      !/^[a-f0-9]{64}$/.test(legacyMigration.expectedBinarySha256) ||
      !/^[a-f0-9]{64}$/.test(legacyMigration.expectedResourceReferencesSha256))
  )
    throw new Error(
      "Legacy migration requires the exact active institution/site and approved checkpoint/resource-inventory SHA-256 manifest.",
    );
  return new MedplumClinicalWorkspace(
    baseUrl,
    clientId,
    clientSecret,
    appBaseUrl,
    checkpointHmacKey,
    previousCheckpointHmacKeys,
    legacyMigration,
  );
}
