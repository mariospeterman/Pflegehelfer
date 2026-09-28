import { describe, expect, it, vi } from "vitest";
import { ClinicalProjectionWorker } from "../src/core/clinical-projection-worker.js";
import type { ClinicalWorkspace } from "../src/infrastructure/medplum-workspace.js";
import type {
  ClinicalProjectionJob,
  OperationalStore,
} from "../src/infrastructure/operational-store.js";

const job: ClinicalProjectionJob = {
  id: "projection-1",
  acceptedCommandId: "accepted-1",
  idempotencyKey: "clinical:accepted-1",
  resources: [{ resourceType: "Patient", id: "patient-1", active: true }],
  removedReferences: ["Task/task-1"],
  expectedVersions: { "Patient/patient-1": "7", "Task/task-1": "3" },
  checkpoint: {
    formatVersion: 1,
    dataClass: "synthetic-demo",
    state: {
      users: [],
      patients: [],
      tasks: [],
      observations: [],
      notes: [],
      communications: [],
      intake: [],
      roundActions: [],
      providerHealth: [],
      outbox: [],
    },
    audit: [],
    commandReceipts: [],
  },
  attempts: 1,
};

function harness(synchronize: ClinicalWorkspace["synchronize"]) {
  const finishClinicalProjection = vi.fn(
    (input: Parameters<OperationalStore["finishClinicalProjection"]>[0]) => {
      void input;
      return Promise.resolve();
    },
  );
  const failClinicalProjection = vi.fn(
    (input: Parameters<OperationalStore["failClinicalProjection"]>[0]) => {
      void input;
      return Promise.resolve();
    },
  );
  const store = {
    claimClinicalProjection: () => Promise.resolve(structuredClone(job)),
    finishClinicalProjection,
    failClinicalProjection,
  } as unknown as OperationalStore;
  const verifyProjection = vi.fn(() => Promise.resolve(true));
  const workspace = {
    synchronize,
    verifyProjection,
  } as unknown as ClinicalWorkspace;
  return {
    worker: new ClinicalProjectionWorker(store, workspace, {
      workerId: "clinical-worker-test",
    }),
    finishClinicalProjection,
    failClinicalProjection,
    verifyProjection,
  };
}

describe("clinical projection worker", () => {
  it("carries accepted versions into the FHIR transaction and verifies deletions", async () => {
    const synchronize = vi.fn(() => Promise.resolve());
    const test = harness(synchronize);
    await expect(test.worker.runOnce()).resolves.toEqual({
      claimed: 1,
      delivered: 1,
      retrying: 0,
      manual: 0,
    });
    expect(synchronize).toHaveBeenCalledWith(
      job.resources,
      job.checkpoint,
      job.removedReferences,
      undefined,
      job.expectedVersions,
    );
    expect(test.verifyProjection).toHaveBeenCalledWith(
      job.resources,
      job.removedReferences,
    );
    expect(test.finishClinicalProjection).toHaveBeenCalledOnce();
  });

  it("quarantines an optimistic-concurrency conflict without retrying", async () => {
    const test = harness(() =>
      Promise.reject(
        new Error("Medplum transaction rejected: 412 Precondition Failed"),
      ),
    );
    await expect(test.worker.runOnce()).resolves.toEqual({
      claimed: 1,
      delivered: 0,
      retrying: 0,
      manual: 1,
    });
    const failure = test.failClinicalProjection.mock.calls[0]?.[0];
    expect(failure?.errorCode).toContain("MEDPLUM_VERSION_CONFLICT");
    expect(failure?.retryAt).toBeNull();
  });
});
