import { describe, expect, it } from "vitest";
import { ModelGateway } from "../src/ai/model-gateway.js";
import { AssistantService } from "../src/core/assistant-service.js";
import { PflegehelferService } from "../src/core/service.js";
import {
  buildSourceReadSetV1,
  parseSourceReadSetV1,
  sourceReadSetMatches,
} from "../src/core/source-read-set.js";

function sourceReadSet(
  membershipReferences = ["Task/task-a"],
  taskVersion = "7",
) {
  return buildSourceReadSetV1({
    schemaVersion: 1,
    evidenceAuthority: "fhir-meta-versionId",
    capturedAt: "2026-10-08T10:00:00.000Z",
    purpose: "direct-care",
    policyVersion: "policy-v1",
    patientId: "patient-a",
    encounterId: "encounter-a",
    resources: [
      {
        reference: "Patient/patient-a",
        logicalReference: "Patient/patient-a",
        version: "3",
        patientId: "patient-a",
        encounterId: "encounter-a",
        claims: [{ path: "patient.id", value: "patient-a" }],
      },
      {
        reference: "Encounter/encounter-a",
        logicalReference: "Encounter/encounter-a",
        version: "4",
        patientId: "patient-a",
        encounterId: "encounter-a",
        claims: [],
      },
      ...membershipReferences.map((reference) => ({
        reference,
        logicalReference: reference,
        version: taskVersion,
        patientId: "patient-a",
        encounterId: "encounter-a",
        claims: [{ path: "tasks.0.state", value: "new" as const }],
      })),
    ],
    selectors: [
      {
        id: "get_open_tasks.tasks",
        resourceType: "Task",
        predicate: "task-open",
        patientId: "patient-a",
        encounterId: "encounter-a",
        order: "due-asc",
        limit: 20,
        totalCount: membershipReferences.length,
        complete: true,
        absenceObserved: membershipReferences.length === 0,
        membershipReferences,
        selectedReferences: membershipReferences,
        claims: [{ path: "totalCount", value: membershipReferences.length }],
      },
    ],
  });
}

describe("SourceReadSetV1", () => {
  it("keeps a stable digest across capture timestamps and input ordering", () => {
    const first = sourceReadSet(["Task/task-b", "Task/task-a"]);
    const content = {
      schemaVersion: first.schemaVersion,
      evidenceAuthority: first.evidenceAuthority,
      capturedAt: first.capturedAt,
      purpose: first.purpose,
      policyVersion: first.policyVersion,
      patientId: first.patientId,
      encounterId: first.encounterId,
      resources: first.resources,
      selectors: first.selectors,
    };
    const second = buildSourceReadSetV1({
      ...content,
      capturedAt: "2026-10-08T10:05:00.000Z",
      resources: [...first.resources].reverse(),
      selectors: first.selectors.map((selector) => ({
        ...selector,
        membershipReferences: [...selector.membershipReferences].reverse(),
      })),
    });
    expect(second.digest).toBe(first.digest);
    expect(sourceReadSetMatches(first, second)).toBe(true);
  });

  it("requires re-review when a version or selector membership changes", () => {
    const reviewed = sourceReadSet();
    expect(sourceReadSetMatches(reviewed, sourceReadSet([], "7"))).toBe(false);
    expect(sourceReadSetMatches(reviewed, sourceReadSet(undefined, "8"))).toBe(
      false,
    );
  });

  it("rejects a tampered durable digest", () => {
    expect(() =>
      parseSourceReadSetV1({ ...sourceReadSet(), digest: "0".repeat(64) }),
    ).toThrow("SOURCE_READ_SET_DIGEST_MISMATCH");
  });

  it("binds every executable draft to an explicitly non-FHIR memory read set", async () => {
    const clinical = new PflegehelferService();
    const assistant = new AssistantService(
      clinical,
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    );
    const response = await assistant.query("u-nurse", {
      prompt: "Notiz: Bewohnerin wirkte beim Gespräch ruhig und aufmerksam.",
      patientId: "p-anna",
      purpose: "direct-care",
    });
    const draft = response.components.find(
      (component) => component.type === "DraftAction",
    );
    if (!draft || draft.type !== "DraftAction")
      throw new Error("Expected draft action");
    const record = assistant.durableIntentRecord(draft.intentToken);
    expect(record?.sourceReadSet).toMatchObject({
      schemaVersion: 1,
      evidenceAuthority: "memory-demo-not-fhir-evident",
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
    });
    expect(typeof record?.sourceReadSet.policyVersion).toBe("string");
    expect(
      record?.sourceReadSet.resources.map(({ reference }) => reference),
    ).toEqual(
      expect.arrayContaining(["Patient/p-anna", "Encounter/enc-anna-2026"]),
    );
    expect(() => parseSourceReadSetV1(record?.sourceReadSet)).not.toThrow();
    const checkpoint = clinical.checkpoint();
    const patient = checkpoint.state.patients.find(
      (candidate) => candidate.id === "p-anna",
    )!;
    patient.source.version += 1;
    clinical.restoreCheckpoint(checkpoint);
    const current = assistant.refreshMemorySourceReadSet(
      "u-nurse",
      record!.sourceReadSet,
    );
    expect(sourceReadSetMatches(record!.sourceReadSet, current)).toBe(false);
  });
});
