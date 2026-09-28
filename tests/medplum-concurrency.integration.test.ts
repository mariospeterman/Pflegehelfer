import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PflegehelferService } from "../src/core/service.js";
import { clinicalWorkspaceFromEnvironment } from "../src/infrastructure/medplum-workspace.js";

describe.runIf(process.env.PFH_MEDPLUM_INTEGRATION_TEST === "true")(
  "Medplum optimistic-concurrency integration",
  () => {
    it("rejects a stale accepted version and preserves the newer resource", async () => {
      const workspace = clinicalWorkspaceFromEnvironment();
      const id = randomUUID();
      const reference = `Patient/${id}`;
      const template = new PflegehelferService()
        .fhirResources()
        .find((resource) => resource.resourceType === "Patient")!;
      const initial = { ...structuredClone(template), id, active: true };
      const absent = await workspace.loadResourceVersions!([reference]);
      expect(absent[reference]).toBeNull();
      await workspace.synchronize([initial], undefined, [], undefined, absent);
      const acceptedVersions = await workspace.loadResourceVersions!([
        reference,
      ]);
      const newer = { ...initial, active: false };
      await workspace.synchronize(
        [newer],
        undefined,
        [],
        undefined,
        acceptedVersions,
      );
      await expect(
        workspace.synchronize(
          [{ ...initial, active: true }],
          undefined,
          [],
          undefined,
          acceptedVersions,
        ),
      ).rejects.toThrow(/412|Precondition|transaction rejected/i);
      await expect(workspace.verifyProjection!([newer])).resolves.toBe(true);
      const current = await workspace.loadResourceVersions!([reference]);
      await workspace.synchronize(
        [],
        undefined,
        [reference],
        undefined,
        current,
      );
      await expect(workspace.verifyProjection!([], [reference])).resolves.toBe(
        true,
      );
    });
  },
);
