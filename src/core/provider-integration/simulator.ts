import { createHash, randomUUID } from "node:crypto";
import {
  adapterManifestSchema,
  type AdapterManifest,
  type CanonicalClinicalCommand,
  type CanonicalResource,
  type ExternalReference,
  type InboundChangeBatch,
  type PreparedProviderCommand,
  type ProviderAcknowledgement,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderHealth,
  type ProviderRecord,
  type ReconciliationRequest,
  type ReconciliationResult,
  type SyncCursor,
} from "./contract.js";

export type ProviderSimulatorMode =
  "normal" | "delay" | "reject" | "down" | "conflict";

export class ProviderTransportError extends Error {
  constructor(public readonly code: "PROVIDER_UNAVAILABLE") {
    super(code);
    this.name = "ProviderTransportError";
  }
}

interface SimulatorOptions {
  records?: ProviderRecord[];
  now?: () => string;
  createId?: () => string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseCursor(cursor?: SyncCursor): number {
  if (!cursor) return 0;
  const match = /^sim:(\d+)$/.exec(cursor.value);
  if (!match) throw new Error("INVALID_SIMULATOR_CURSOR");
  return Number.parseInt(match[1]!, 10);
}

function nextVersion(expected: string | null): string {
  const match = expected ? /^(?:sim-v)?(\d+)$/.exec(expected) : null;
  return `sim-v${match ? Number.parseInt(match[1]!, 10) + 1 : 1}`;
}

/**
 * Complete provider contract test double. It deliberately uses only synthetic
 * semantics and cannot be configured with a vendor endpoint or credential.
 */
export class ProviderContractSimulator implements ProviderAdapter {
  private readonly adapterManifest: AdapterManifest;
  private readonly records: ProviderRecord[];
  private readonly acknowledgements = new Map<
    string,
    { payloadHash: string; acknowledgement: ProviderAcknowledgement }
  >();
  private readonly receiptById = new Map<string, string>();
  private readonly now: () => string;
  private readonly createId: () => string;
  private mode: ProviderSimulatorMode = "normal";

  constructor(manifest: AdapterManifest, options: SimulatorOptions = {}) {
    this.adapterManifest = adapterManifestSchema.parse(manifest);
    if (this.adapterManifest.profile !== "synthetic-simulator")
      throw new Error("SIMULATOR_REQUIRES_SYNTHETIC_PROFILE");
    this.records = clone(options.records ?? []);
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? randomUUID;
  }

  setMode(mode: ProviderSimulatorMode): void {
    this.mode = mode;
  }

  reset(): void {
    this.mode = "normal";
    this.acknowledgements.clear();
    this.receiptById.clear();
  }

  manifest(): AdapterManifest {
    return clone(this.adapterManifest);
  }

  async discoverCapabilities(): Promise<ProviderCapability[]> {
    await Promise.resolve();
    return clone(this.adapterManifest.capabilities);
  }

  async health(): Promise<ProviderHealth> {
    await Promise.resolve();
    return this.healthSnapshot();
  }

  healthSnapshot(): ProviderHealth {
    return {
      status:
        this.mode === "down"
          ? "unavailable"
          : this.mode === "delay"
            ? "degraded"
            : "available",
      checkedAt: this.now(),
      latencyMs: this.mode === "down" ? null : this.mode === "delay" ? 2500 : 5,
      message:
        this.mode === "normal"
          ? "Synthetic provider simulator available"
          : `Synthetic provider simulator mode: ${this.mode}`,
    };
  }

  async pullChanges(cursor?: SyncCursor): Promise<InboundChangeBatch> {
    await Promise.resolve();
    this.assertAvailable();
    const offset = parseCursor(cursor);
    const pageSize = 50;
    const records = this.records.slice(offset, offset + pageSize);
    const nextOffset = offset + records.length;
    return {
      records: clone(records),
      nextCursor:
        nextOffset < this.records.length
          ? { value: `sim:${nextOffset}` }
          : null,
      hasMore: nextOffset < this.records.length,
    };
  }

  async read(reference: ExternalReference): Promise<ProviderRecord> {
    await Promise.resolve();
    this.assertAvailable();
    const record = this.records.find(
      (candidate) =>
        candidate.reference.resourceType === reference.resourceType &&
        candidate.reference.externalId === reference.externalId,
    );
    if (!record) throw new Error("SIMULATOR_RECORD_NOT_FOUND");
    return clone(record);
  }

  async mapInbound(record: ProviderRecord): Promise<CanonicalResource[]> {
    await Promise.resolve();
    const payload = record.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("SIMULATOR_INVALID_INBOUND_RECORD");
    const objectPayload = payload as Record<string, unknown>;
    const resourceType = objectPayload.resourceType;
    const id = objectPayload.id;
    if (typeof resourceType !== "string" || typeof id !== "string")
      throw new Error("SIMULATOR_INVALID_INBOUND_RECORD");
    return [{ resourceType, id, body: clone(objectPayload) }];
  }

  async prepareCommand(
    command: CanonicalClinicalCommand,
  ): Promise<PreparedProviderCommand> {
    await Promise.resolve();
    const capability = this.adapterManifest.capabilities.find(
      (candidate) => candidate.operation === command.operation,
    );
    if (
      !capability ||
      !["supported", "conditional"].includes(capability.support)
    )
      throw new Error("CAPABILITY_NOT_AVAILABLE");
    const payloadHash = createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex");
    return {
      provider: this.adapterManifest.provider,
      adapterVersion: this.adapterManifest.adapterVersion,
      command: clone(command),
      payloadHash,
      preparedAt: this.now(),
    };
  }

  async executeCommand(
    prepared: PreparedProviderCommand,
  ): Promise<ProviderAcknowledgement> {
    await Promise.resolve();
    this.assertAvailable();
    if (
      prepared.provider !== this.adapterManifest.provider ||
      prepared.adapterVersion !== this.adapterManifest.adapterVersion
    )
      throw new Error("PREPARED_COMMAND_ADAPTER_MISMATCH");
    const expectedHash = createHash("sha256")
      .update(JSON.stringify(prepared.command))
      .digest("hex");
    if (expectedHash !== prepared.payloadHash)
      throw new Error("PREPARED_COMMAND_HASH_MISMATCH");

    const previous = this.acknowledgements.get(prepared.command.idempotencyKey);
    if (previous) {
      if (previous.payloadHash !== prepared.payloadHash)
        throw new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
      return clone(previous.acknowledgement);
    }

    const providerVersion = nextVersion(
      prepared.command.expectedProviderVersion,
    );
    const receiptId = `sim-${this.createId()}`;
    const acknowledgement: ProviderAcknowledgement = {
      receiptId,
      idempotencyKey: prepared.command.idempotencyKey,
      status:
        this.mode === "delay"
          ? "pending"
          : this.mode === "reject"
            ? "rejected"
            : this.mode === "conflict"
              ? "conflict"
              : "acknowledged",
      providerVersion,
      errorCode:
        this.mode === "reject"
          ? "SIMULATED_CONTENT_REJECTION"
          : this.mode === "conflict"
            ? "SIMULATED_VERSION_CONFLICT"
            : null,
      errorClassification:
        this.mode === "reject"
          ? "clinical-content"
          : this.mode === "conflict"
            ? "version-conflict"
            : null,
      providerSnapshot:
        this.mode === "conflict"
          ? {
              reference: {
                resourceType: prepared.command.resource.resourceType,
                externalId: prepared.command.resource.id,
              },
              originVersion: providerVersion,
              effectiveAt: prepared.command.approvedAt,
              recordedAt: this.now(),
              receivedAt: this.now(),
              payload: {
                resourceType: prepared.command.resource.resourceType,
                id: prepared.command.resource.id,
                syntheticConflict: true,
              },
            }
          : null,
      receivedAt: this.now(),
    };
    this.acknowledgements.set(prepared.command.idempotencyKey, {
      payloadHash: prepared.payloadHash,
      acknowledgement: clone(acknowledgement),
    });
    this.receiptById.set(receiptId, prepared.command.idempotencyKey);
    return clone(acknowledgement);
  }

  async getCommandStatus(receiptId: string): Promise<ProviderAcknowledgement> {
    await Promise.resolve();
    this.assertAvailable();
    const idempotencyKey = this.receiptById.get(receiptId);
    const acknowledgement = idempotencyKey
      ? this.acknowledgements.get(idempotencyKey)?.acknowledgement
      : undefined;
    if (!acknowledgement) throw new Error("SIMULATOR_RECEIPT_NOT_FOUND");
    if (acknowledgement.status === "pending") {
      acknowledgement.status = "acknowledged";
      acknowledgement.errorCode = null;
      acknowledgement.errorClassification = null;
    }
    return clone(acknowledgement);
  }

  async reconcile(
    request: ReconciliationRequest,
  ): Promise<ReconciliationResult> {
    const acknowledgement = await this.getCommandStatus(request.receiptId);
    if (acknowledgement.idempotencyKey !== request.idempotencyKey)
      throw new Error("SIMULATOR_RECONCILIATION_KEY_MISMATCH");
    return { status: acknowledgement.status, acknowledgement };
  }

  private assertAvailable(): void {
    if (this.mode === "down")
      throw new ProviderTransportError("PROVIDER_UNAVAILABLE");
  }
}
