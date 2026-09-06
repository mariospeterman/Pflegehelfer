import type { Observation, Patient } from "./types.js";

export interface FhirR4Resource {
  resourceType: "Patient" | "Observation";
  id: string;
  meta: { profile: string[]; tag: { system: string; code: string }[] };
  [key: string]: unknown;
}

const loinc: Record<Observation["code"], { code: string; display: string }> = {
  "blood-pressure": { code: "85354-9", display: "Blood pressure panel" },
  temperature: { code: "8310-5", display: "Body temperature" },
  "oxygen-saturation": {
    code: "59408-5",
    display: "Oxygen saturation in Arterial blood by Pulse oximetry",
  },
  pulse: { code: "8867-4", display: "Heart rate" },
  weight: { code: "29463-7", display: "Body weight" },
};

const sourceTag = (provider: Patient["source"]["provider"]) => [
  {
    system: "https://pflegehelfer.example.invalid/source-provider",
    code: provider,
  },
  {
    system: "https://pflegehelfer.example.invalid/mapping",
    code: "r4-ch-core-6.0.0-v1",
  },
];

export function patientToFhirR4(patient: Patient): FhirR4Resource {
  return {
    resourceType: "Patient",
    id: patient.id,
    meta: {
      profile: [
        "http://fhir.ch/ig/ch-core/StructureDefinition/ch-core-patient",
      ],
      tag: sourceTag(patient.source.provider),
    },
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/synthetic-mrn",
        value: patient.mrn,
      },
    ],
    name: [{ use: "official", text: patient.displayName }],
    birthDate: patient.birthDate,
  };
}

export function observationToFhirR4(observation: Observation): FhirR4Resource {
  const coding = loinc[observation.code];
  const base: FhirR4Resource = {
    resourceType: "Observation",
    id: observation.id,
    meta: {
      profile: ["http://hl7.org/fhir/StructureDefinition/vitalsigns"],
      tag: sourceTag(observation.source.provider),
    },
    status: ["synced", "approved"].includes(observation.status)
      ? "final"
      : "preliminary",
    category: [
      {
        coding: [
          {
            system:
              "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "vital-signs",
          },
        ],
      },
    ],
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: coding.code,
          display: coding.display,
        },
      ],
      text: observation.label,
    },
    subject: { reference: `Patient/${observation.patientId}` },
    effectiveDateTime: observation.effectiveAt,
    performer: [{ reference: `Practitioner/${observation.performerId}` }],
  };
  if (observation.code === "blood-pressure") {
    base.component = [
      {
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "8480-6",
              display: "Systolic blood pressure",
            },
          ],
        },
        valueQuantity: {
          value: observation.value,
          unit: "mmHg",
          system: "http://unitsofmeasure.org",
          code: "mm[Hg]",
        },
      },
      {
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "8462-4",
              display: "Diastolic blood pressure",
            },
          ],
        },
        valueQuantity: {
          value: observation.secondaryValue,
          unit: "mmHg",
          system: "http://unitsofmeasure.org",
          code: "mm[Hg]",
        },
      },
    ];
  } else {
    const unitCode: Record<
      Exclude<Observation["code"], "blood-pressure">,
      string
    > = {
      temperature: "Cel",
      "oxygen-saturation": "%",
      pulse: "/min",
      weight: "kg",
    };
    base.valueQuantity = {
      value: observation.value,
      unit: observation.unit,
      system: "http://unitsofmeasure.org",
      code: unitCode[observation.code],
    };
  }
  return base;
}

export function validateFhirR4Shape(resource: FhirR4Resource): string[] {
  const errors: string[] = [];
  if (!resource.id || !/^[A-Za-z0-9\-.]{1,64}$/.test(resource.id))
    errors.push("id");
  if (!resource.meta.tag.some((tag) => tag.system.endsWith("/mapping")))
    errors.push("meta.mapping");
  if (!resource.meta.profile.length) errors.push("meta.profile");
  if (resource.resourceType === "Observation") {
    if (!resource.subject || !resource.effectiveDateTime || !resource.code)
      errors.push("observation.required");
  } else if (!resource.identifier || !resource.name || !resource.birthDate)
    errors.push("patient.required");
  return errors;
}
