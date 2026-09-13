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
}

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

/**
 * Stateless bounded provider worker. PostgreSQL owns claiming and outcomes;
 * adapters only perform the leased operation. Unknown failures fail closed to
 * manual review instead of being replayed as possibly duplicated writes.
 */
export class ProviderDeliveryWorker {
  private readonly options: z.infer<typeof workerOptionsSchema> & {
    now: () => Date;
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
        await this.store.finishProviderDelivery({
          jobId: job.id,
          workerId: this.options.workerId,
          acknowledgement,
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
