import { createHash } from "node:crypto";
import { z } from "zod";
import {
  canonicalClinicalCommandSchema,
  providerIdSchema,
  providerOperationSchema,
  providerProfileSchema,
  type CanonicalClinicalCommand,
  type ProviderAcknowledgement,
  type ProviderErrorClassification,
  type ProviderId,
  type ProviderOperation,
  type ProviderProfile,
} from "./contract.js";
import type { ProviderRegistry } from "./registry.js";

export const providerOutboxPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    command: canonicalClinicalCommandSchema,
    retrySafety: z.enum(["idempotent-provider", "reconcile-before-retry"]),
  })
  .strict();

export type ProviderOutboxPayload = z.infer<typeof providerOutboxPayloadSchema>;

export interface ProviderOutboxJob {
  id: string;
  provider: ProviderId;
  profile: ProviderProfile;
  operation: ProviderOperation;
  idempotencyKey: string;
  payload: ProviderOutboxPayload;
  attempts: number;
  recoveredExpiredLease: boolean;
  latestReceiptId: string | null;
  acceptedCommandId?: string | null;
  authorityEnvelope?: Readonly<Record<string, unknown>> | null;
}

export interface ProviderDeliveryStore {
  enqueueProviderCommand(input: {
    provider: ProviderId;
    profile: ProviderProfile;
    command: CanonicalClinicalCommand;
    retrySafety?: ProviderOutboxPayload["retrySafety"];
  }): Promise<{ id: string; inserted: boolean }>;
  claimProviderCommands(input: {
    workerId: string;
    profile: ProviderProfile;
    limit: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ProviderOutboxJob[]>;
  finishProviderDelivery(input: {
    jobId: string;
    workerId: string;
    acknowledgement: ProviderAcknowledgement;
    retryAt: Date | null;
    readBackEvidence?: {
      providerVersion: string;
      contentHash: string;
      adapterVersion: string;
      mappingVersion: string;
    };
  }): Promise<void>;
  failProviderDelivery(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorClassification: ProviderErrorClassification;
    retryAt: Date | null;
  }): Promise<void>;
}

export interface ProviderWorkerResult {
  claimed: number;
  delivered: number;
  retrying: number;
  manual: number;
}

export interface ProviderWorkerOptions {
  workerId: string;
  profile: ProviderProfile;
  batchSize?: number;
  leaseDurationMs?: number;
  retryBaseMs?: number;
  retryMaximumMs?: number;
  maximumAttempts?: number;
  now?: () => Date;
  authorizeDelivery: (
    job: Readonly<ProviderOutboxJob>,
  ) => Promise<ProviderDeliveryAuthorization> | ProviderDeliveryAuthorization;
}

export type ProviderDeliveryAuthorization =
  { allowed: true } | { allowed: false; reason: string };

const workerOptionsSchema = z
  .object({
    workerId: z.string().trim().min(1).max(120),
    profile: providerProfileSchema,
    batchSize: z.number().int().min(1).max(100),
    leaseDurationMs: z
      .number()
      .int()
      .min(1_000)
      .max(5 * 60_000),
    retryBaseMs: z.number().int().min(100).max(60_000),
    retryMaximumMs: z
      .number()
      .int()
      .min(100)
      .max(24 * 60 * 60_000),
    maximumAttempts: z.number().int().min(1).max(100),
  })
  .strict()
  .refine((value) => value.retryMaximumMs >= value.retryBaseMs, {
    message: "retryMaximumMs must be greater than or equal to retryBaseMs",
  });

function technicalFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "ProviderTransportError" ||
      error.message === "PROVIDER_UNAVAILABLE")
  );
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

async function verifyProviderReadBack(
  adapter: NonNullable<ReturnType<ProviderRegistry["adapterForOperation"]>>,
  command: CanonicalClinicalCommand,
): Promise<{ providerVersion: string; contentHash: string } | null> {
  const record = await adapter.read({
    resourceType: command.resource.resourceType,
    externalId: command.resource.id,
  });
  const mapped = await adapter.mapInbound(record);
  const resource = mapped.find(
    (candidate) =>
      candidate.resourceType === command.resource.resourceType &&
      candidate.id === command.resource.id,
  );
  if (!resource) return null;
  const body = { ...resource.body };
  delete body.resourceType;
  delete body.id;
  if (canonicalJson(body) !== canonicalJson(command.resource.body)) return null;
  return {
    providerVersion: record.originVersion,
    contentHash: createHash("sha256")
      .update(canonicalJson(record))
      .digest("hex"),
  };
}

/**
 * Stateless bounded provider worker. PostgreSQL owns claiming and outcomes;
 * adapters only perform the leased operation. Unknown failures fail closed to
 * manual review instead of being replayed as possibly duplicated writes.
 */
export class ProviderDeliveryWorker {
  private readonly options: z.infer<typeof workerOptionsSchema> & {
    now: () => Date;
    authorizeDelivery: ProviderWorkerOptions["authorizeDelivery"];
  };

  constructor(
    private readonly store: ProviderDeliveryStore,
    private readonly registry: ProviderRegistry,
    options: ProviderWorkerOptions,
  ) {
    this.options = {
      ...workerOptionsSchema.parse({
        workerId: options.workerId,
        profile: options.profile,
        batchSize: options.batchSize ?? 20,
        leaseDurationMs: options.leaseDurationMs ?? 30_000,
        retryBaseMs: options.retryBaseMs ?? 1_000,
        retryMaximumMs: options.retryMaximumMs ?? 5 * 60_000,
        maximumAttempts: options.maximumAttempts ?? 8,
      }),
      now: options.now ?? (() => new Date()),
      authorizeDelivery: options.authorizeDelivery,
    };
  }

  async runOnce(): Promise<ProviderWorkerResult> {
    const jobs = await this.store.claimProviderCommands({
      workerId: this.options.workerId,
      profile: this.options.profile,
      limit: this.options.batchSize,
      leaseDurationMs: this.options.leaseDurationMs,
      now: this.options.now(),
    });
    const result: ProviderWorkerResult = {
      claimed: jobs.length,
      delivered: 0,
      retrying: 0,
      manual: 0,
    };
    for (const job of jobs) {
      const authorization = await this.options.authorizeDelivery(job);
      if (!authorization.allowed) {
        await this.manual(
          job,
          `DELIVERY_AUTHORIZATION_DENIED:${authorization.reason}`,
          "authorization",
        );
        result.manual += 1;
        continue;
      }
      if (job.profile !== this.options.profile) {
        await this.manual(job, "PROVIDER_PROFILE_MISMATCH", "authorization");
        result.manual += 1;
        continue;
      }
      if (
        job.recoveredExpiredLease &&
        !job.latestReceiptId &&
        job.payload.retrySafety === "reconcile-before-retry"
      ) {
        await this.manual(job, "UNCERTAIN_REMOTE_OUTCOME", "version-conflict");
        result.manual += 1;
        continue;
      }
      const adapter = this.registry.adapterForOperation(
        job.provider,
        job.profile,
        job.operation,
      );
      if (!adapter) {
        await this.manual(job, "EXTERNAL_VENDOR_GATE", "authorization");
        result.manual += 1;
        continue;
      }
      try {
        const acknowledgement = job.latestReceiptId
          ? await adapter.getCommandStatus(job.latestReceiptId)
          : await adapter.executeCommand(
              await adapter.prepareCommand(job.payload.command),
            );
        let readBack: Awaited<ReturnType<typeof verifyProviderReadBack>> = null;
        if (acknowledgement.status === "acknowledged") {
          try {
            readBack = await verifyProviderReadBack(
              adapter,
              job.payload.command,
            );
          } catch (error) {
            if (!technicalFailure(error)) throw error;
            const retryAt =
              job.attempts < this.options.maximumAttempts
                ? this.retryAt(job.attempts)
                : null;
            // The remote receipt is already a durable fact. Persist it before
            // retrying read-back so restart recovery polls the receipt instead
            // of executing the command a second time.
            await this.store.finishProviderDelivery({
              jobId: job.id,
              workerId: this.options.workerId,
              acknowledgement: {
                ...acknowledgement,
                status: "pending",
                errorCode: "PROVIDER_READBACK_PENDING",
                errorClassification: "technical",
              },
              retryAt,
            });
            if (retryAt) result.retrying += 1;
            else result.manual += 1;
            continue;
          }
        }
        if (
          acknowledgement.status === "acknowledged" &&
          (!readBack ||
            (acknowledgement.providerVersion !== null &&
              readBack.providerVersion !== acknowledgement.providerVersion))
        ) {
          await this.store.finishProviderDelivery({
            jobId: job.id,
            workerId: this.options.workerId,
            acknowledgement: {
              ...acknowledgement,
              status: "conflict",
              errorCode: "PROVIDER_READBACK_MISMATCH",
              errorClassification: "version-conflict",
            },
            retryAt: null,
          });
          result.manual += 1;
          continue;
        }
        await this.store.finishProviderDelivery({
          jobId: job.id,
          workerId: this.options.workerId,
          acknowledgement,
          ...(readBack
            ? {
                readBackEvidence: {
                  ...readBack,
                  adapterVersion: adapter.manifest().adapterVersion,
                  mappingVersion: job.payload.command.mappingVersion,
                },
              }
            : {}),
          retryAt:
            acknowledgement.status === "pending" &&
            job.attempts >= this.options.maximumAttempts
              ? null
              : this.retryAt(job.attempts),
        });
        if (acknowledgement.status === "acknowledged") result.delivered += 1;
        else if (
          acknowledgement.status === "pending" &&
          job.attempts < this.options.maximumAttempts
        )
          result.retrying += 1;
        else result.manual += 1;
      } catch (error) {
        const retry =
          technicalFailure(error) &&
          job.attempts < this.options.maximumAttempts &&
          (Boolean(job.latestReceiptId) ||
            job.payload.retrySafety === "idempotent-provider");
        await this.store.failProviderDelivery({
          jobId: job.id,
          workerId: this.options.workerId,
          errorCode: technicalFailure(error)
            ? "PROVIDER_UNAVAILABLE"
            : "PROVIDER_DELIVERY_FAILED",
          errorClassification: technicalFailure(error)
            ? "technical"
            : "mapping",
          retryAt: retry ? this.retryAt(job.attempts) : null,
        });
        if (retry) result.retrying += 1;
        else result.manual += 1;
      }
    }
    return result;
  }

  private retryAt(attempts: number): Date {
    const delay = Math.min(
      this.options.retryMaximumMs,
      this.options.retryBaseMs * 2 ** Math.max(0, attempts - 1),
    );
    return new Date(this.options.now().getTime() + delay);
  }

  private manual(
    job: ProviderOutboxJob,
    errorCode: string,
    errorClassification: ProviderErrorClassification,
  ): Promise<void> {
    return this.store.failProviderDelivery({
      jobId: job.id,
      workerId: this.options.workerId,
      errorCode,
      errorClassification,
      retryAt: null,
    });
  }
}

export const providerWorkerSchemas = {
  providerId: providerIdSchema,
  profile: providerProfileSchema,
  operation: providerOperationSchema,
};
