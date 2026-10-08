import { describe, expect, it } from "vitest";
import {
  canonicalDomainExtensionUrl,
  fromFhirResourceSet,
  fhirResourceId,
  toFhirResourceSet,
} from "../src/core/fhir-resource-set.js";
import { PflegehelferService } from "../src/core/service.js";
import { MedplumClinicalWorkspace } from "../src/infrastructure/medplum-workspace.js";

function nativeWorkspace(
  resources: ReturnType<PflegehelferService["fhirResources"]>,
) {
  const workspace = new MedplumClinicalWorkspace(
    "http://medplum.invalid/",
    "client",
    "secret",
    "http://medplum-app.invalid/",
  );
  const versioned = resources.map((resource, index) => ({
    ...resource,
    meta: { ...resource.meta, versionId: String(index + 1) },
  }));
  const internals = workspace as unknown as {
    login: Promise<unknown> | null;
    client: {
      search: (resourceType: string) => Promise<{ total: number }>;
      searchResourcePages: (
        resourceType: string,
      ) => AsyncGenerator<(typeof versioned)[number][]>;
    };
  };
  internals.login = Promise.resolve();
  internals.client.search = (resourceType) =>
    Promise.resolve({
      total: versioned.filter(
        (resource) => resource.resourceType === resourceType,
      ).length,
    });
  internals.client.searchResourcePages = async function* (resourceType) {
    await Promise.resolve();
    yield versioned.filter(
      (resource) => resource.resourceType === resourceType,
    );
  };
  return { workspace, internals };
}

describe("resource-native clinical reconstruction", () => {
  it("round-trips every checkpoint-owned clinical collection by resource", () => {
    const service = new PflegehelferService();
    const checkpoint = service.checkpoint();
    const reconstructed = fromFhirResourceSet(service.fhirResources());

    expect(reconstructed).toEqual({
      users: checkpoint.state.users,
      patients: checkpoint.state.patients,
      tasks: checkpoint.state.tasks,
      observations: checkpoint.state.observations,
      notes: checkpoint.state.notes,
      communications: checkpoint.state.communications,
      intake: checkpoint.state.intake,
      roundActions: checkpoint.state.roundActions,
    });
  });

  it("uses Task.restriction for due time and projects intake/round actions", () => {
    const service = new PflegehelferService();
    const round = service.createRoundAction("u-physician", {
      patientId: "p-luca",
      actionKind: "therapy-followup",
      ownerRole: "physiotherapy",
      deadline: "2026-09-05T15:00:00.000Z",
      targetSystem: "pflegehelfer",
    });
    const state = service.checkpoint().state;
    const resources = service.fhirResources();
    const task = resources.find(
      (resource) =>
        resource.resourceType === "Task" &&
        resource.id === fhirResourceId("Task", state.tasks[0]!.id),
    );
    expect(task?.resourceType).toBe("Task");
    if (task?.resourceType !== "Task") throw new Error("task missing");
    expect(task.restriction?.period?.end).toBe(state.tasks[0]!.dueAt);
    expect(task.executionPeriod).toBeUndefined();
    expect(
      resources.filter(
        (resource) => resource.resourceType === "QuestionnaireResponse",
      ),
    ).toHaveLength(state.intake.length);
    const roundResource = resources.find(
      (resource) =>
        resource.resourceType === "Task" &&
        resource.identifier?.some(
          (identifier) =>
            identifier.system ===
              "https://pflegehelfer.example.invalid/round-action-id" &&
            identifier.value === round.id,
        ),
    );
    expect(roundResource?.resourceType).toBe("Task");
    if (roundResource?.resourceType !== "Task")
      throw new Error("round action missing");
    expect(roundResource.basedOn).toBeUndefined();
    expect(roundResource.output?.[0]?.valueReference?.reference).toBe(
      `Task/${fhirResourceId("Task", round.taskId!)}`,
    );
    expect(state.roundActions).toHaveLength(1);
    const reconstructed = fromFhirResourceSet(resources);
    expect(reconstructed.roundActions).toEqual(state.roundActions);
    expect(reconstructed.tasks.some((item) => item.id === round.taskId)).toBe(
      true,
    );
  });

  it("fails closed on a tampered per-resource envelope", () => {
    const service = new PflegehelferService();
    const resources = service.fhirResources();
    const patient = resources.find(
      (resource) => resource.resourceType === "Patient",
    ) as (typeof resources)[number] & {
      extension?: Array<{ url?: string; valueString?: string }>;
    };
    const extension = patient.extension?.find(
      (candidate) => candidate.url === canonicalDomainExtensionUrl,
    );
    expect(extension?.valueString).toBeTruthy();
    const envelope: unknown = JSON.parse(extension!.valueString!);
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      !("payload" in envelope) ||
      typeof envelope.payload !== "object" ||
      envelope.payload === null
    )
      throw new Error("canonical envelope missing");
    (envelope.payload as Record<string, unknown>).displayName = "Manipuliert";
    extension!.valueString = JSON.stringify(envelope);

    expect(() => fromFhirResourceSet(resources)).toThrow(
      "CANONICAL_DOMAIN_ENVELOPE_INVALID",
    );
  });

  it("fails closed when native FHIR fields contradict the envelope", () => {
    const service = new PflegehelferService();
    const resources = service.fhirResources();
    const patient = resources.find(
      (resource) => resource.resourceType === "Patient",
    );
    if (patient?.resourceType !== "Patient") throw new Error("patient missing");
    patient.name = [{ text: "Contradictory native value" }];
    expect(() => fromFhirResourceSet(resources)).toThrow(
      "CANONICAL_NATIVE_FIELD_MISMATCH:patient",
    );
  });

  it("revalidates independent approval qualifications during rehydrate", () => {
    const service = new PflegehelferService();
    const state = service.checkpoint().state;
    const observation = state.observations.find(
      (candidate) => candidate.performerId === "u-nurse",
    );
    if (!observation) throw new Error("human observation missing");
    observation.approvalPolicy = "high-assurance";
    observation.approvals = ["u-nurse", "u-assistant"];
    observation.approvedAt ??= "2026-09-05T08:00:00.000Z";

    expect(() => fromFhirResourceSet(toFhirResourceSet(state))).toThrow(
      "CANONICAL_INDEPENDENT_APPROVAL_QUALIFICATION_INVALID",
    );
  });

  it("reconstructs from bounded, counted, versioned Medplum pages", async () => {
    const service = new PflegehelferService();
    const { workspace } = nativeWorkspace(service.fhirResources());
    await expect(workspace.loadCanonicalClinicalState()).resolves.toEqual(
      fromFhirResourceSet(service.fhirResources()),
    );
  });

  it("rejects an incomplete Medplum result set", async () => {
    const service = new PflegehelferService();
    const { workspace, internals } = nativeWorkspace(service.fhirResources());
    const count = internals.client.search;
    internals.client.search = async (resourceType) => {
      const result = await count(resourceType);
      return resourceType === "Patient" ? { total: result.total + 1 } : result;
    };
    await expect(workspace.loadCanonicalClinicalState()).rejects.toThrow(
      "CANONICAL_RESOURCE_COUNT_MISMATCH:Patient",
    );
  });
});
