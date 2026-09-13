import { createHash } from "node:crypto";
import { z } from "zod";
import {
  type AdapterManifest,
  type CanonicalClinicalCommand,
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

const externalReferenceSchema = z
  .object({ resourceType: z.string().min(1).max(100), externalId: z.string().min(1).max(200) })
  .strict();
const providerRecordSchema = z
  .object({
    reference: externalReferenceSchema,
    originVersion: z.string().min(1).max(200),
    effectiveAt: z.iso.datetime({ offset: true }),
    recordedAt: z.iso.datetime({ offset: true }),
    receivedAt: z.iso.datetime({ offset: true }),
    payload: z.unknown(),
  })
  .strict();
const acknowledgementSchema = z
  .object({
    receiptId: z.string().min(1).max(300),
    idempotencyKey: z.string().min(1).max(300),
    status: z.enum(["acknowledged", "pending", "rejected", "conflict"]),
    providerVersion: z.string().min(1).max(200).nullable(),
    errorCode: z.string().max(200).nullable(),
    errorClassification: z
      .enum([
        "technical",
        "clinical-content",
        "mapping",
        "authorization",
        "version-conflict",
      ])
      .nullable(),
    providerSnapshot: providerRecordSchema.nullable(),
    receivedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

function clone<T>(value: T): T {
  return structuredClone(value);
}

/** Network client for the independent synthetic provider process. */
export class HttpProviderSimulatorAdapter implements ProviderAdapter {
  constructor(
    private readonly adapterManifest: AdapterManifest,
    private readonly baseUrl: string,
    private readonly token: string,
  ) {
    const endpoint = new URL(baseUrl);
    if (!["http:", "https:"].includes(endpoint.protocol))
      throw new Error("INVALID_SIMULATOR_PROTOCOL");
    if (token.length < 32) throw new Error("SIMULATOR_TOKEN_TOO_SHORT");
  }

  manifest(): AdapterManifest {
    return clone(this.adapterManifest);
  }

  discoverCapabilities(): Promise<ProviderCapability[]> {
    return Promise.resolve(clone(this.adapterManifest.capabilities));
  }

  health(): Promise<ProviderHealth> {
    return this.request("/health");
  }

  pullChanges(cursor?: SyncCursor): Promise<InboundChangeBatch> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor.value)}` : "";
    return this.request(`/changes${query}`);
  }

  read(reference: ExternalReference): Promise<ProviderRecord> {
    return this.request("/read", {
      method: "POST",
      body: JSON.stringify(reference),
    }).then((value) => providerRecordSchema.parse(value));
  }

  mapInbound(record: ProviderRecord) {
    const payload = record.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      throw new Error("SIMULATOR_INVALID_INBOUND_RECORD");
    const resourceType = (payload as Record<string, unknown>).resourceType;
    const id = (payload as Record<string, unknown>).id;
    if (typeof resourceType !== "string" || typeof id !== "string")
      throw new Error("SIMULATOR_INVALID_INBOUND_RECORD");
    return Promise.resolve([
      { resourceType, id, body: clone(payload as Record<string, unknown>) },
    ]);
  }

  prepareCommand(
    command: CanonicalClinicalCommand,
  ): Promise<PreparedProviderCommand> {
    return Promise.resolve({
      provider: this.adapterManifest.provider,
      adapterVersion: this.adapterManifest.adapterVersion,
      command: clone(command),
      payloadHash: createHash("sha256")
        .update(JSON.stringify(command))
        .digest("hex"),
      preparedAt: new Date().toISOString(),
    });
  }

  executeCommand(
    prepared: PreparedProviderCommand,
  ): Promise<ProviderAcknowledgement> {
    return this.request("/commands", {
      method: "POST",
      body: JSON.stringify(prepared),
    }).then((value) => acknowledgementSchema.parse(value));
  }

  getCommandStatus(receiptId: string): Promise<ProviderAcknowledgement> {
    return this.request(`/commands/${encodeURIComponent(receiptId)}`).then(
      (value) => acknowledgementSchema.parse(value),
    );
  }

  reconcile(request: ReconciliationRequest): Promise<ReconciliationResult> {
    return this.request("/reconcile", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  setMode(mode: string): Promise<ProviderHealth> {
    return this.request("/mode", {
      method: "POST",
      body: JSON.stringify({ mode }),
    });
  }

  reset(): Promise<void> {
    return this.request("/reset", { method: "POST", body: "{}" });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}/v1/providers/${this.adapterManifest.provider}${path}`,
        {
          ...init,
          headers: {
            authorization: `Bearer ${this.token}`,
            ...(init.body ? { "content-type": "application/json" } : {}),
          },
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 503
            ? "PROVIDER_UNAVAILABLE"
            : `SIMULATOR_HTTP_${response.status}`,
        );
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
