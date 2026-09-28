import type { ClinicalWorkspace } from "../infrastructure/medplum-workspace.js";
import type { OperationalStore } from "../infrastructure/operational-store.js";

export interface ClinicalProjectionWorkerResult {
  claimed: number;
  delivered: number;
  retrying: number;
  manual: number;
}

/**
 * Delivers one locally accepted, resource-scoped FHIR projection. PostgreSQL
 * owns the lease and outcome; Medplum is never contacted inside acceptance.
 */
export class ClinicalProjectionWorker {
  constructor(
    private readonly store: OperationalStore,
    private readonly workspace: ClinicalWorkspace,
    private readonly options: {
      workerId: string;
      leaseDurationMs?: number;
      maximumAttempts?: number;
      retryBaseMs?: number;
      now?: () => Date;
    },
  ) {}

  async runOnce(): Promise<ClinicalProjectionWorkerResult> {
    const now = this.options.now?.() ?? new Date();
    const job = await this.store.claimClinicalProjection({
      workerId: this.options.workerId,
      leaseDurationMs: this.options.leaseDurationMs ?? 30_000,
      now,
    });
    if (!job) return { claimed: 0, delivered: 0, retrying: 0, manual: 0 };
    try {
      const references = [
        ...job.resources.map(
          (resource) => `${resource.resourceType}/${resource.id}`,
        ),
        ...job.removedReferences,
      ];
      if (this.workspace.loadResourceVersions) {
        const currentVersions =
          await this.workspace.loadResourceVersions(references);
        const versionChanged = references.some(
          (reference) =>
            currentVersions[reference] !== job.expectedVersions[reference],
        );
        if (versionChanged) {
          if (
            this.workspace.verifyProjection &&
            (await this.workspace.verifyProjection(
              job.resources,
              job.removedReferences,
            ))
          ) {
            await this.store.finishClinicalProjection({
              jobId: job.id,
              workerId: this.options.workerId,
            });
            return { claimed: 1, delivered: 1, retrying: 0, manual: 0 };
          }
          throw new Error("MEDPLUM_VERSION_CONFLICT:source-version-changed");
        }
      }
      await this.workspace.synchronize(
        job.resources,
        job.checkpoint,
        job.removedReferences,
        undefined,
        job.expectedVersions,
      );
      if (
        !this.workspace.verifyProjection ||
        !(await this.workspace.verifyProjection(
          job.resources,
          job.removedReferences,
        ))
      )
        throw new Error("MEDPLUM_READBACK_MISMATCH");
      await this.store.finishClinicalProjection({
        jobId: job.id,
        workerId: this.options.workerId,
      });
      return { claimed: 1, delivered: 1, retrying: 0, manual: 0 };
    } catch (error) {
      const maximumAttempts = this.options.maximumAttempts ?? 8;
      const errorCode =
        error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN";
      const concurrencyConflict =
        /(?:409|412|version|if-match|if-none-match)/i.test(errorCode);
      const retry = !concurrencyConflict && job.attempts < maximumAttempts;
      const retryAt = retry
        ? new Date(
            now.getTime() +
              (this.options.retryBaseMs ?? 1_000) *
                2 ** Math.max(0, job.attempts - 1),
          )
        : null;
      await this.store.failClinicalProjection({
        jobId: job.id,
        workerId: this.options.workerId,
        errorCode: concurrencyConflict
          ? `MEDPLUM_VERSION_CONFLICT:${errorCode}`.slice(0, 160)
          : errorCode,
        retryAt,
      });
      return {
        claimed: 1,
        delivered: 0,
        retrying: retry ? 1 : 0,
        manual: retry ? 0 : 1,
      };
    }
  }
}
