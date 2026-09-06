import { createHash, createHmac, timingSafeEqual } from "node:crypto";
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
import { fhirResourceId } from "../core/fhir-resource-set.js";
import type { CommandReceipt, ServiceCheckpoint } from "../core/service.js";

const checkpointId = fhirResourceId("Binary", "workflow-control-plane-v1");
const receiptContentType = "application/vnd.pflegehelfer.command-receipt+json";
const conversationContentType =
  "application/vnd.pflegehelfer.shift-conversation+json";
const managedClinicalResourceTypes = [
  "Patient",
  "Encounter",
  "Task",
  "Observation",
  "Communication",
  "QuestionnaireResponse",
] satisfies ResourceType[];
const managedTag =
  "https://pflegehelfer.example.invalid/data-classification|synthetic";
function isNotFoundError(error: unknown): boolean {
  return (
    (typeof error === "object" &&
      error !== null &&
      "outcome" in error &&
      JSON.stringify(error).includes("not found")) ||
    (error instanceof Error && /not found|404/i.test(error.message))
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
const auditRecord = z
  .object({
    id: z.string().min(1).max(160),
    occurredAt: z.iso.datetime(),
    actorId: z.string().min(1).max(160),
    actorRole: z.string().min(1).max(80),
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
            handovers: z.array(identifiedRecord),
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
      ],
    },
    contentType: "application/vnd.pflegehelfer.workflow-state+json",
    data: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64"),
  };
}

export function deserializeCheckpoint(
  binary: Binary,
  hmacKey: string | null,
  previousHmacKeys: string[] = [],
): ServiceCheckpoint {
  if (
    binary.contentType !== "application/vnd.pflegehelfer.workflow-state+json" ||
    !binary.data
  )
    throw new Error("Medplum workflow checkpoint has an unexpected format.");
  const rawEnvelope = JSON.parse(
    Buffer.from(binary.data, "base64").toString("utf8"),
  ) as {
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
  const checkpoint = envelope.payload as unknown as ServiceCheckpoint;
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
    handover: checkpoint.state.handovers,
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
    schemaVersion: 1,
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
          code: "command-receipt-v1",
        },
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
  if (envelope.schemaVersion !== 1)
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

export interface ShiftConversationTurn {
  id: string;
  prompt: string;
  response: unknown;
  createdAt: string;
  inputModality: "typed" | "voice";
}

export interface ShiftConversation {
  actorId: string;
  expiresAt: string;
  turns: ShiftConversationTurn[];
}

const conversationSchema = z
  .object({
    actorId: z.string().regex(/^[A-Za-z0-9:._-]{1,80}$/),
    expiresAt: z.iso.datetime(),
    turns: z
      .array(
        z
          .object({
            id: z.uuid(),
            prompt: z.string().max(1200),
            response: z.unknown(),
            createdAt: z.iso.datetime(),
            inputModality: z.enum(["typed", "voice"]),
          })
          .strict(),
      )
      .max(80),
  })
  .strict();

function conversationId(actorId: string): string {
  return fhirResourceId("Binary", `shift-conversation:${actorId}`);
}

function serializeConversation(
  conversation: ShiftConversation,
  hmacKey: string | null,
): Binary {
  const bounded = conversationSchema.parse(conversation);
  const payload = JSON.stringify(bounded);
  return {
    resourceType: "Binary",
    id: conversationId(bounded.actorId),
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
          code: "short-lived-shift-conversation-v1",
        },
      ],
    },
    contentType: conversationContentType,
    data: Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
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
        payload: bounded,
      }),
      "utf8",
    ).toString("base64"),
  };
}

function deserializeConversation(
  binary: Binary,
  actorId: string,
  hmacKey: string | null,
  previousHmacKeys: string[],
): ShiftConversation {
  if (binary.contentType !== conversationContentType || !binary.data)
    throw new Error("Shift conversation has an unexpected format.");
  const envelope = JSON.parse(
    Buffer.from(binary.data, "base64").toString("utf8"),
  ) as {
    schemaVersion?: unknown;
    sha256?: unknown;
    hmacSha256?: unknown;
    hmacKeyId?: unknown;
    payload?: unknown;
  };
  if (envelope.schemaVersion !== 1)
    throw new Error("Shift conversation has an unsupported version.");
  const payload = JSON.stringify(envelope.payload);
  if (createHash("sha256").update(payload).digest("hex") !== envelope.sha256)
    throw new Error("Shift conversation failed integrity validation.");
  if (
    hmacKey &&
    !verifyHmac(payload, envelope.hmacSha256, envelope.hmacKeyId, [
      hmacKey,
      ...previousHmacKeys,
    ])
  )
    throw new Error("Shift conversation failed authenticity validation.");
  const conversation = conversationSchema.parse(envelope.payload);
  if (conversation.actorId !== actorId)
    throw new Error("Shift conversation actor mismatch.");
  return conversation;
}

export interface ClinicalWorkspace {
  readonly mode: ClinicalWorkspaceStatus["mode"];
  initialize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
  ): Promise<void>;
  synchronize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
    removedReferences?: string[],
    commandReceipt?: CommandReceipt,
  ): Promise<void>;
  loadCheckpoint(): Promise<ServiceCheckpoint | null>;
  loadCommandReceipt(key: string): Promise<CommandReceipt | null>;
  loadConversation(actorId: string): Promise<ShiftConversation | null>;
  saveConversation(conversation: ShiftConversation): Promise<void>;
  deleteConversation(actorId: string): Promise<void>;
  status(): Promise<ClinicalWorkspaceStatus>;
  detailUrl(resourceReference?: string): string | null;
}

export class InMemoryClinicalWorkspace implements ClinicalWorkspace {
  readonly mode = "in-memory" as const;
  private readonly conversations = new Map<string, ShiftConversation>();
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  synchronize(): Promise<void> {
    return Promise.resolve();
  }
  loadCheckpoint(): Promise<ServiceCheckpoint | null> {
    return Promise.resolve(null);
  }
  loadCommandReceipt(): Promise<CommandReceipt | null> {
    return Promise.resolve(null);
  }
  loadConversation(actorId: string): Promise<ShiftConversation | null> {
    const conversation = this.conversations.get(actorId);
    if (!conversation) return Promise.resolve(null);
    if (conversation.expiresAt < new Date().toISOString()) {
      this.conversations.delete(actorId);
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(conversation));
  }
  saveConversation(conversation: ShiftConversation): Promise<void> {
    const bounded = conversationSchema.parse(conversation);
    this.conversations.set(bounded.actorId, structuredClone(bounded));
    return Promise.resolve();
  }
  deleteConversation(actorId: string): Promise<void> {
    this.conversations.delete(actorId);
    return Promise.resolve();
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
  private statusCache: {
    expiresAt: number;
    value: ClinicalWorkspaceStatus;
  } | null = null;
  private statusInFlight: Promise<ClinicalWorkspaceStatus> | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly appBaseUrl: string,
    private readonly checkpointHmacKey: string | null = null,
    private readonly previousCheckpointHmacKeys: string[] = [],
  ) {
    this.client = new MedplumClient({
      baseUrl,
      cacheTime: 0,
      maxRetries: 2,
    });
  }

  detailUrl(resourceReference = ""): string | null {
    const base = this.appBaseUrl.endsWith("/")
      ? this.appBaseUrl
      : `${this.appBaseUrl}/`;
    const safeReference =
      /^(Patient|Task|Observation|Communication|QuestionnaireResponse)\/[A-Za-z0-9.-]{1,64}$/.test(
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
  ): Promise<void> {
    await this.connect();
    await this.synchronize(resources, checkpoint);
    await this.removeStaleManagedResources(resources);
  }

  async synchronize(
    resources: Resource[],
    checkpoint?: ServiceCheckpoint,
    removedReferences: string[] = [],
    commandReceipt?: CommandReceipt,
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
    const synchronizedResources = [
      ...resources,
      ...(checkpoint
        ? [serializeCheckpoint(checkpoint, this.checkpointHmacKey)]
        : []),
      ...(commandReceipt
        ? [serializeCommandReceipt(commandReceipt, this.checkpointHmacKey)]
        : []),
    ];
    const entryCount = synchronizedResources.length + removedReferences.length;
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
              : {}),
          },
        })),
        ...removedReferences.map((reference) => ({
          request: { method: "DELETE" as const, url: reference },
        })),
      ],
    };
    const response = await this.client.executeBatch(transaction);
    const failed = response.entry?.find((entry) => {
      const status = entry.response?.status ?? "";
      return !/^2\d\d(?:\s|$)/.test(status);
    });
    if (failed)
      throw new Error(
        `Medplum transaction rejected: ${failed.response?.status ?? "missing status"}`,
      );
    if (checkpoint) {
      const checkpointIndex = synchronizedResources.findIndex(
        (resource) => resource.resourceType === "Binary",
      );
      const metadata = response.entry?.[checkpointIndex]?.response;
      const versionMatch =
        /W\/"([^"]+)"/.exec(metadata?.etag ?? "") ??
        /\/_history\/([^/]+)$/.exec(metadata?.location ?? "");
      this.checkpointVersionId = versionMatch?.[1] ?? null;
    }
  }

  private async removeStaleManagedResources(
    resources: Resource[],
  ): Promise<void> {
    const expected = new Set(
      resources
        .filter((resource) => resource.id)
        .map((resource) => `${resource.resourceType}/${resource.id}`),
    );
    const stale: Resource[] = [];
    for (const resourceType of managedClinicalResourceTypes) {
      const existing = await this.client.searchResources(
        resourceType,
        `_tag=${encodeURIComponent(managedTag)}&_count=1000`,
      );
      stale.push(
        ...existing.filter(
          (resource) =>
            resource.id &&
            !expected.has(`${resource.resourceType}/${resource.id}`),
        ),
      );
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
      if (isNotFoundError(error)) return null;
      throw error;
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
      throw error;
    }
  }

  async loadConversation(actorId: string): Promise<ShiftConversation | null> {
    await this.connect();
    try {
      const binary = await this.client.readResource(
        "Binary",
        conversationId(actorId),
      );
      const conversation = deserializeConversation(
        binary,
        actorId,
        this.checkpointHmacKey,
        this.previousCheckpointHmacKeys,
      );
      if (conversation.expiresAt < new Date().toISOString()) {
        await this.deleteConversation(actorId);
        return null;
      }
      return conversation;
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async saveConversation(conversation: ShiftConversation): Promise<void> {
    await this.connect();
    const binary = serializeConversation(conversation, this.checkpointHmacKey);
    const response = await this.client.executeBatch({
      resourceType: "Bundle",
      type: "transaction",
      entry: [
        {
          resource: binary,
          request: { method: "PUT", url: `Binary/${binary.id}` },
        },
      ],
    });
    const status = response.entry?.[0]?.response?.status ?? "";
    if (!/^2\d\d(?:\s|$)/.test(status))
      throw new Error(`Conversation persistence rejected: ${status}`);
  }

  async deleteConversation(actorId: string): Promise<void> {
    await this.connect();
    try {
      await this.client.deleteResource("Binary", conversationId(actorId));
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
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
        "QuestionnaireResponse",
        "CarePlan",
        "Goal",
        "Provenance",
        "AuditEvent",
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
        serverVersion: capability.software?.version ?? "5.1.37",
        resourceCounts: Object.fromEntries(countPairs),
        message: "Medplum FHIR R4 erreichbar und synchronisiert",
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
  return new MedplumClinicalWorkspace(
    baseUrl,
    clientId,
    clientSecret,
    appBaseUrl,
    checkpointHmacKey,
    previousCheckpointHmacKeys,
  );
}
