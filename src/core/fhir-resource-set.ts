import { createHash } from "node:crypto";
import type {
  AuditEvent,
  CarePlan,
  Communication as FhirCommunication,
  Encounter,
  Goal,
  Location,
  Practitioner,
  Provenance,
  QuestionnaireResponse,
  Resource,
  Task,
} from "@medplum/fhirtypes";
import { observationToFhirR4, patientToFhirR4 } from "./fhir.js";
import type {
  ClinicalNote,
  ClinicalTask,
  Communication,
  DemoUser,
  Observation,
  Patient,
  AuditEntry,
} from "./types.js";

export function fhirResourceId(resourceType: string, domainId: string): string {
  const hash = createHash("sha256")
    .update(`pflegehelfer:${resourceType}:${domainId}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

const ref = (resourceType: string, domainId: string): string =>
  `${resourceType}/${fhirResourceId(resourceType, domainId)}`;

export interface CanonicalClinicalState {
  users: DemoUser[];
  patients: Patient[];
  tasks: ClinicalTask[];
  observations: Observation[];
  notes: ClinicalNote[];
  communications: Communication[];
}

const taskStatus: Record<ClinicalTask["state"], Task["status"]> = {
  new: "ready",
  accepted: "accepted",
  "in-progress": "in-progress",
  waiting: "on-hold",
  completed: "completed",
  escalated: "on-hold",
};

const communicationStatus: Record<
  Communication["state"],
  FhirCommunication["status"]
> = {
  sent: "in-progress",
  acknowledged: "in-progress",
  answered: "completed",
  closed: "completed",
  escalated: "in-progress",
};

function sourceTags(
  source: Patient["source"],
): NonNullable<NonNullable<Resource["meta"]>["tag"]> {
  return [
    {
      system: "https://pflegehelfer.example.invalid/source-provider",
      code: source.provider,
    },
    {
      system: "https://pflegehelfer.example.invalid/source-version",
      code: String(source.version),
    },
    {
      system: "https://pflegehelfer.example.invalid/mapping-version",
      code: source.mappingVersion,
    },
    {
      system: "https://pflegehelfer.example.invalid/data-classification",
      code: "synthetic",
    },
    {
      system: "https://pflegehelfer.example.invalid/source-recorded-at",
      code: source.recordedAt,
    },
  ];
}

function practitioner(user: DemoUser): Practitioner {
  const [first, ...family] = user.displayName.replace("Dr. ", "").split(" ");
  return {
    resourceType: "Practitioner",
    id: fhirResourceId("Practitioner", user.id),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/practitioner-id",
        value: user.id,
      },
    ],
    meta: {
      tag: [
        {
          system: "https://pflegehelfer.example.invalid/role",
          code: user.role,
        },
      ],
    },
    active: true,
    name: [
      {
        ...(first ? { given: [first] } : {}),
        family: family.join(" "),
      },
    ],
  };
}

function encounter(patient: Patient): Encounter {
  return {
    resourceType: "Encounter",
    id: fhirResourceId("Encounter", patient.encounterId),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/encounter-id",
        value: patient.encounterId,
      },
    ],
    meta: { tag: sourceTags(patient.source) },
    status: "in-progress",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "IMP",
      display: "inpatient encounter",
    },
    subject: { reference: ref("Patient", patient.id) },
    location: [
      {
        location: {
          reference: ref("Location", `room-${patient.room.toLowerCase()}`),
        },
      },
    ],
  };
}

function location(patient: Patient): Location {
  return {
    resourceType: "Location",
    id: fhirResourceId("Location", `room-${patient.room.toLowerCase()}`),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/location-id",
        value: `room-${patient.room.toLowerCase()}`,
      },
    ],
    status: "active",
    name: `Zimmer ${patient.room}`,
    partOf: { reference: ref("Location", patient.wardId) },
  };
}

function task(item: ClinicalTask): Task {
  return {
    resourceType: "Task",
    id: fhirResourceId("Task", item.id),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/task-id",
        value: item.id,
      },
    ],
    meta: { tag: sourceTags(item.source) },
    status: taskStatus[item.state],
    intent: "order",
    priority:
      item.priority === "urgent"
        ? "stat"
        : item.priority === "elevated"
          ? "urgent"
          : "routine",
    code: { text: item.title },
    description: item.reason,
    ...(item.patientId
      ? { for: { reference: ref("Patient", item.patientId) } }
      : {}),
    ...(item.requesterId.startsWith("u-")
      ? { requester: { reference: ref("Practitioner", item.requesterId) } }
      : {}),
    owner: item.ownerId
      ? { reference: ref("Practitioner", item.ownerId) }
      : { display: item.ownerRole },
    executionPeriod: { end: item.dueAt },
    note: [
      ...item.comments.map((text) => ({ text })),
      ...(item.completionEvidence ? [{ text: item.completionEvidence }] : []),
    ],
  };
}

function communication(item: Communication): FhirCommunication {
  return {
    resourceType: "Communication",
    id: fhirResourceId("Communication", item.id),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/communication-id",
        value: item.id,
      },
    ],
    meta: { tag: sourceTags(item.source) },
    status: communicationStatus[item.state],
    priority: item.priority === "elevated" ? "urgent" : item.priority,
    subject: { reference: ref("Patient", item.patientId) },
    sender: { reference: ref("Practitioner", item.senderId) },
    recipient: [
      item.recipientId
        ? {
            reference: ref("Practitioner", item.recipientId),
            display: item.recipientRole,
          }
        : { display: item.recipientRole },
      ...(item.escalationRecipientRole
        ? [{ display: `escalation:${item.escalationRecipientRole}` }]
        : []),
    ],
    sent: item.source.recordedAt,
    payload: [
      { contentString: item.request },
      { contentString: `Grund: ${item.reason}` },
      ...(item.response
        ? [{ contentString: `Antwort: ${item.response}` }]
        : []),
    ],
  };
}

function note(item: ClinicalNote): QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    id: fhirResourceId("QuestionnaireResponse", item.id),
    identifier: {
      system: "https://pflegehelfer.example.invalid/note-id",
      value: item.id,
    },
    meta: { tag: sourceTags(item.source) },
    status: ["synced", "approved", "pending-provider"].includes(item.status)
      ? "completed"
      : "in-progress",
    subject: { reference: ref("Patient", item.patientId) },
    author: { reference: ref("Practitioner", item.authorId) },
    authored: item.source.recordedAt,
    item: [
      {
        linkId: "nursing-note",
        text: "Strukturierte Pflegedokumentation",
        answer: [{ valueString: item.structuredText }],
      },
    ],
  };
}

function goals(patient: Patient): Goal[] {
  return patient.careGoals.map((description, index) => ({
    resourceType: "Goal",
    id: fhirResourceId("Goal", `${patient.id}-goal-${index + 1}`),
    lifecycleStatus: "active",
    description: { text: description },
    subject: { reference: ref("Patient", patient.id) },
  }));
}

function carePlan(patient: Patient): CarePlan {
  return {
    resourceType: "CarePlan",
    id: fhirResourceId("CarePlan", `${patient.id}-care-plan`),
    status: "active",
    intent: "plan",
    subject: { reference: ref("Patient", patient.id) },
    encounter: { reference: ref("Encounter", patient.encounterId) },
    goal: patient.careGoals.map((_goal, index) => ({
      reference: ref("Goal", `${patient.id}-goal-${index + 1}`),
    })),
  };
}

function provenance(resource: Resource): Provenance | null {
  if (!resource.id || resource.resourceType === "Provenance") return null;
  return {
    resourceType: "Provenance",
    id: fhirResourceId("Provenance", `${resource.resourceType}/${resource.id}`),
    recorded:
      resource.meta?.tag?.find(
        (tag) =>
          tag.system ===
          "https://pflegehelfer.example.invalid/source-recorded-at",
      )?.code ?? "2026-09-05T00:00:00.000Z",
    target: [{ reference: `${resource.resourceType}/${resource.id}` }],
    agent: [
      {
        type: {
          coding: [
            {
              system:
                "http://terminology.hl7.org/CodeSystem/provenance-participant-type",
              code: "assembler",
            },
          ],
        },
        who: { display: "Pflegehelfer canonical mapper" },
      },
    ],
  };
}

function auditEvent(entry: AuditEntry): AuditEvent {
  const action = entry.action.includes(":read") ? "R" : "E";
  return {
    resourceType: "AuditEvent",
    id: entry.id,
    type: {
      system: "http://terminology.hl7.org/CodeSystem/audit-event-type",
      code: "rest",
      display: "RESTful Operation",
    },
    subtype: [
      {
        system: "https://pflegehelfer.example.invalid/audit-action",
        code: entry.action.slice(0, 64),
      },
    ],
    action,
    recorded: entry.occurredAt,
    outcome:
      entry.outcome === "denied" || entry.outcome === "failure" ? "8" : "0",
    agent: [
      {
        who:
          entry.actorType === "system"
            ? { display: entry.actorId }
            : { reference: ref("Practitioner", entry.actorId) },
        requestor: entry.actorType !== "system",
        role: [
          {
            coding: [
              {
                system: "https://pflegehelfer.example.invalid/role",
                code: entry.actorRole,
              },
            ],
          },
        ],
      },
    ],
    source: {
      observer: { display: "Pflegehelfer Clinical Action Gateway" },
      type: [
        {
          system: "http://terminology.hl7.org/CodeSystem/security-source-type",
          code: "4",
          display: "Application Server",
        },
      ],
    },
    entity: entry.patientId
      ? [
          {
            what: { reference: ref("Patient", entry.patientId) },
            detail: [
              { type: "purpose", valueString: entry.purpose },
              { type: "chainHash", valueString: entry.hash },
            ],
          },
        ]
      : [
          {
            name: "non-patient operation",
            detail: [
              { type: "purpose", valueString: entry.purpose },
              { type: "chainHash", valueString: entry.hash },
            ],
          },
        ],
  };
}

/** Canonical, deterministic projection stored in the Medplum showcase workspace. */
export function toFhirResourceSet(
  state: CanonicalClinicalState,
  auditEntries: readonly AuditEntry[] = [],
): Resource[] {
  const wardLocations: Location[] = [
    {
      resourceType: "Location",
      id: fhirResourceId("Location", "rehab-2"),
      identifier: [
        {
          system: "https://pflegehelfer.example.invalid/location-id",
          value: "rehab-2",
        },
      ],
      status: "active",
      name: "Rehabilitation Station 2",
    },
  ];
  const clinical: Resource[] = [
    ...wardLocations,
    ...state.users.map(practitioner),
    ...state.patients.flatMap((patient) => [
      {
        ...patientToFhirR4(patient),
        id: fhirResourceId("Patient", patient.id),
        meta: {
          profile: patientToFhirR4(patient).meta.profile,
          tag: [
            ...patientToFhirR4(patient).meta.tag,
            ...sourceTags(patient.source),
          ],
        },
        identifier: [
          {
            system: "https://pflegehelfer.example.invalid/patient-id",
            value: patient.id,
          },
          {
            system: "https://pflegehelfer.example.invalid/synthetic-mrn",
            value: patient.mrn,
          },
        ],
      } as Resource,
      location(patient),
      encounter(patient),
      ...goals(patient),
      carePlan(patient),
    ]),
    ...state.tasks.map(task),
    ...state.observations.map(
      (item) =>
        ({
          ...observationToFhirR4(item),
          id: fhirResourceId("Observation", item.id),
          meta: {
            profile: observationToFhirR4(item).meta.profile,
            tag: [
              ...observationToFhirR4(item).meta.tag,
              ...sourceTags(item.source),
            ],
          },
          identifier: [
            {
              system: "https://pflegehelfer.example.invalid/observation-id",
              value: item.id,
            },
          ],
          subject: { reference: ref("Patient", item.patientId) },
          performer: [{ reference: ref("Practitioner", item.performerId) }],
        }) as Resource,
    ),
    ...state.notes.map(note),
    ...state.communications.map(communication),
  ];
  return [
    ...clinical,
    ...clinical
      .map(provenance)
      .filter((item): item is Provenance => item !== null),
    ...auditEntries.map(auditEvent),
  ];
}
