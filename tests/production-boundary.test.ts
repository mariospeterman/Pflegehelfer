import { describe, expect, it } from "vitest";
import { InMemoryReferenceStatePort } from "../src/core/clinical-data-port.js";
import {
  emptyWorkflowState,
  PflegehelferService,
} from "../src/core/service.js";
import { createProductionProviderRegistry } from "../src/core/provider-integration/index.js";

describe("production bootstrap boundary", () => {
  it("starts an unconfigured production domain with zero synthetic clinical records", () => {
    const service = new PflegehelferService(
      new InMemoryReferenceStatePort(emptyWorkflowState()),
      createProductionProviderRegistry(),
      "production",
    );
    const resourceTypes = service
      .fhirResources()
      .map((resource) => resource.resourceType);
    expect(resourceTypes).not.toContain("Patient");
    expect(resourceTypes).not.toContain("Observation");
    expect(service.checkpoint().state.patients).toEqual([]);
  });
});
