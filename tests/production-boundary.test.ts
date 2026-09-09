import { describe, expect, it } from "vitest";
import { InMemoryReferenceStatePort } from "../src/core/clinical-data-port.js";
import {
  emptyWorkflowState,
  PflegehelferService,
} from "../src/core/service.js";
import { createProductionProviderRegistry } from "../src/core/provider-integration/index.js";

describe("production bootstrap boundary", () => {
  it("never labels institution-local FHIR projection as synthetic", () => {
    const service = new PflegehelferService(
      undefined,
      createProductionProviderRegistry(),
      "production",
    );
    const resources = service.fhirResources();
    expect(JSON.stringify(resources)).not.toContain("synthetic-mrn");
    for (const resource of resources)
      expect(resource.meta?.tag).toContainEqual({
        system: "https://pflegehelfer.example.invalid/data-classification",
        code: "institution-local",
      });
  });

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

  it("keeps local work usable while outbound vendor delivery stays explicitly gated", () => {
    const service = new PflegehelferService(
      undefined,
      createProductionProviderRegistry(),
      "production",
    );
    const task = service.createTask("u-nurse", {
      patientId: "p-anna",
      title: "Providergebundene Aufgabe",
      reason:
        "Der interne Auftrag bleibt auch ohne privaten Provider-Vertrag nutzbar.",
      ownerRole: "care-assistant",
      priority: "routine",
      dueAt: "2026-09-05T12:00:00.000Z",
    });
    const communication = service.createCommunication("u-nurse", {
      patientId: "p-anna",
      request: "Bitte im Provider bestätigen.",
      reason: "Die interne Teamkommunikation darf nicht vom Vendor abhängen.",
      recipientRole: "physician",
      priority: "routine",
      dueAt: "2026-09-05T12:00:00.000Z",
    });

    const after = service.checkpoint().state;
    expect(after.tasks).toContainEqual(
      expect.objectContaining({ id: task.id }),
    );
    expect(after.communications).toContainEqual(
      expect.objectContaining({ id: communication.id }),
    );
    expect(
      after.outbox.filter((item) =>
        [task.id, communication.id].includes(item.aggregateId),
      ),
    ).toEqual([
      expect.objectContaining({
        aggregateId: task.id,
        state: "external-gated",
        errorCode: "EXTERNAL_VENDOR_GATE",
      }),
      expect.objectContaining({
        aggregateId: communication.id,
        state: "external-gated",
        errorCode: "EXTERNAL_VENDOR_GATE",
      }),
    ]);
    expect(service.hasPendingProviderWork()).toBe(false);
  });
});
