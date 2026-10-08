import { buildSourceReadSetV1 } from "../src/core/source-read-set.js";
import type { Purpose } from "../src/core/types.js";

export function sourceReadSetFixture(input: {
  patientId: string;
  encounterId: string;
  version: string | number;
  purpose?: Purpose;
  policyVersion?: string;
}) {
  return buildSourceReadSetV1({
    schemaVersion: 1,
    evidenceAuthority: "memory-demo-not-fhir-evident",
    capturedAt: "2026-10-08T10:00:00.000Z",
    purpose: input.purpose ?? "direct-care",
    policyVersion: input.policyVersion ?? "test-policy-v1",
    patientId: input.patientId,
    encounterId: input.encounterId,
    resources: [
      {
        reference: `Patient/${input.patientId}`,
        logicalReference: `Patient/${input.patientId}`,
        version: String(input.version),
        patientId: input.patientId,
        encounterId: input.encounterId,
        claims: [],
      },
      {
        reference: `Encounter/${input.encounterId}`,
        logicalReference: `Encounter/${input.encounterId}`,
        version: String(input.version),
        patientId: input.patientId,
        encounterId: input.encounterId,
        claims: [],
      },
    ],
    selectors: [],
  });
}
