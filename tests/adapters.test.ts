import { describe, expect, it } from "vitest";
import { observations, patients } from "../src/core/seed.js";
import {
  observationToFhirR4,
  patientToFhirR4,
  validateFhirR4Shape,
} from "../src/core/fhir.js";
describe("FHIR R4 boundary mapping", () => {
  it("maps synthetic patients and vital signs with explicit mapping provenance", () => {
    const patient = patientToFhirR4(patients[0]!);
    const observation = observationToFhirR4(observations[0]!);
    expect(validateFhirR4Shape(patient)).toEqual([]);
    expect(validateFhirR4Shape(observation)).toEqual([]);
    expect(observation).toMatchObject({
      resourceType: "Observation",
      meta: {
        profile: ["http://hl7.org/fhir/StructureDefinition/vitalsigns"],
      },
      subject: { reference: "Patient/p-anna" },
    });
    expect(patient).toMatchObject({
      meta: {
        profile: [
          "http://fhir.ch/ig/ch-core/StructureDefinition/ch-core-patient",
        ],
      },
    });
    expect(observation.component).toHaveLength(2);
  });
});
