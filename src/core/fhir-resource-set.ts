import { createHash } from "node:crypto";
import type {
  AuditEvent,
  CarePlan,
  Communication as FhirCommunication,
  DocumentReference,
  Encounter,
  Goal,
  Location,
  Practitioner,
  Provenance,
  Resource,
  Task,
} from "@medplum/fhirtypes";
import { observationToFhirR4, patientToFhirR4 } from "./fhir.js";
import { siteConfiguration } from "./site-config.js";
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
    .update(
      `pflegehelfer:${siteConfiguration.institutionId}:${siteConfiguration.siteId}:${resourceType}:${domainId}`,
    )
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

/** Previous unscoped ID algorithm, retained only for one-way upgrade reads. */
export function legacyFhirResourceId(
  resourceType: string,
  domainId: string,
): string {
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

type DataClass = "synthetic-demo" | "institution-local";
const dataClassificationSystem =
  "https://pflegehelfer.example.invalid/data-classification";
export const tenantTagSystem =
  "https://pflegehelfer.example.invalid/institution-site";
export const managedProjectionTag = {
  system: "https://pflegehelfer.example.invalid/managed-projection",
  code: "pflegehelfer-clinical-v1",
} as const;

const classificationTag = (dataClass: DataClass) => ({
  system: dataClassificationSystem,
  code: dataClass,
});

export const tenantTag = () => ({
  system: tenantTagSystem,
  code: `${siteConfiguration.institutionId}.${siteConfiguration.siteId}`,
});

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
  dataClass: DataClass,
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
    classificationTag(dataClass),
    {
      system: "https://pflegehelfer.example.invalid/source-recorded-at",
      code: source.recordedAt,
    },
  ];
}

function practitioner(user: DemoUser, dataClass: DataClass): Practitioner {
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
        classificationTag(dataClass),
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

function encounter(patient: Patient, dataClass: DataClass): Encounter {
  return {
    resourceType: "Encounter",
    id: fhirResourceId("Encounter", patient.encounterId),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/encounter-id",
        value: patient.encounterId,
      },
    ],
    meta: { tag: sourceTags(patient.source, dataClass) },
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

function location(patient: Patient, dataClass: DataClass): Location {
  return {
    resourceType: "Location",
    id: fhirResourceId("Location", `room-${patient.room.toLowerCase()}`),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/location-id",
        value: `room-${patient.room.toLowerCase()}`,
      },
    ],
    meta: { tag: [classificationTag(dataClass)] },
    status: "active",
    name: `Zimmer ${patient.room}`,
    partOf: { reference: ref("Location", patient.wardId) },
  };
}

function task(item: ClinicalTask, dataClass: DataClass): Task {
  return {
    resourceType: "Task",
    id: fhirResourceId("Task", item.id),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/task-id",
        value: item.id,
      },
    ],
    meta: { tag: sourceTags(item.source, dataClass) },
    status: taskStatus[item.state],
    businessStatus: {
      coding: [
        {
          system: "https://pflegehelfer.example.invalid/task-workflow-state",
          code: item.state,
        },
      ],
      text: item.state,
    },
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
    ...(item.encounterId
      ? { encounter: { reference: ref("Encounter", item.encounterId) } }
      : {}),
    ...(item.requesterId.startsWith("u-")
      ? { requester: { reference: ref("Practitioner", item.requesterId) } }
      : {}),
    owner: item.ownerId
      ? { reference: ref("Practitioner", item.ownerId) }
      : { display: item.ownerRole },
    executionPeriod: { end: item.dueAt },
    ...(item.comments.length > 0 || item.completionEvidence
      ? {
          note: [
            ...item.comments.map((text) => ({ text })),
            ...(item.completionEvidence
              ? [{ text: item.completionEvidence }]
              : []),
          ],
        }
      : {}),
  };
}

function communication(
  item: Communication,
  dataClass: DataClass,
): FhirCommunication {
  return {
    resourceType: "Communication",
    id: fhirResourceId("Communication", item.id),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/communication-id",
        value: item.id,
      },
    ],
    meta: { tag: sourceTags(item.source, dataClass) },
    status: communicationStatus[item.state],
    priority: item.priority === "elevated" ? "urgent" : item.priority,
    subject: { reference: ref("Patient", item.patientId) },
    encounter: { reference: ref("Encounter", item.encounterId) },
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

function note(item: ClinicalNote, dataClass: DataClass): DocumentReference {
  return {
    resourceType: "DocumentReference",
    id: fhirResourceId("DocumentReference", item.id),
    identifier: [
      {
        system: "https://pflegehelfer.example.invalid/note-id",
        value: item.id,
      },
    ],
    meta: { tag: sourceTags(item.source, dataClass) },
    status: "current",
    docStatus: [
      "synced",
      "approved",
      "pending-provider",
      "external-gated",
    ].includes(item.status)
      ? "final"
      : "preliminary",
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "11506-3",
          display: "Progress note",
        },
      ],
      text: "Pflegeverlaufsnotiz",
    },
    subject: { reference: ref("Patient", item.patientId) },
    context: { encounter: [{ reference: ref("Encounter", item.encounterId) }] },
    author: [{ reference: ref("Practitioner", item.authorId) }],
    date: item.source.recordedAt,
    description: "Strukturierte Pflegedokumentation",
    content: [
      {
        attachment: {
          contentType: "text/plain; charset=utf-8",
          title: "Pflegeverlaufsnotiz",
          creation: item.source.recordedAt,
          data: Buffer.from(item.structuredText, "utf8").toString("base64"),
        },
      },
    ],
  };
}

function goals(patient: Patient, dataClass: DataClass): Goal[] {
  return patient.careGoals.map((description, index) => ({
    resourceType: "Goal",
    id: fhirResourceId("Goal", `${patient.id}-goal-${index + 1}`),
    meta: { tag: [classificationTag(dataClass)] },
    lifecycleStatus: "active",
    description: { text: description },
    subject: { reference: ref("Patient", patient.id) },
  }));
}

function carePlan(patient: Patient, dataClass: DataClass): CarePlan {
  return {
    resourceType: "CarePlan",
    id: fhirResourceId("CarePlan", `${patient.id}-care-plan`),
    meta: { tag: [classificationTag(dataClass)] },
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
  const sourceVersion =
    resource.meta?.tag?.find(
      (tag) =>
        tag.system === "https://pflegehelfer.example.invalid/source-version",
    )?.code ?? "initial";
  return {
    resourceType: "Provenance",
    id: fhirResourceId(
      "Provenance",
      `${resource.resourceType}/${resource.id}/version/${sourceVersion}`,
    ),
    recorded:
      resource.meta?.tag?.find(
        (tag) =>
          tag.system ===
          "https://pflegehelfer.example.invalid/source-recorded-at",
      )?.code ?? "2026-09-05T00:00:00.000Z",
    meta: {
      tag: (resource.meta?.tag ?? []).filter(
        (tag) => tag.system === dataClassificationSystem,
      ),
    },
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

export function auditEventToFhirR4(
  entry: AuditEntry,
  dataClass: DataClass = "synthetic-demo",
): AuditEvent {
  const action = entry.action.includes(":read") ? "R" : "E";
  return {
    resourceType: "AuditEvent",
    id: entry.id,
    meta: { tag: [classificationTag(dataClass)] },
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
  dataClass: DataClass = "synthetic-demo",
): Resource[] {
  const wardLocations: Location[] = [
    {
      resourceType: "Location",
      id: fhirResourceId("Location", siteConfiguration.department.id),
      identifier: [
        {
          system: "https://pflegehelfer.example.invalid/location-id",
          value: siteConfiguration.department.id,
        },
      ],
      status: "active",
      name: siteConfiguration.department.displayName,
      meta: { tag: [classificationTag(dataClass)] },
    },
  ];
  const clinical: Resource[] = [
    ...wardLocations,
    ...state.users.map((user) => practitioner(user, dataClass)),
    ...state.patients.flatMap((patient) => [
      {
        ...patientToFhirR4(patient, dataClass),
        id: fhirResourceId("Patient", patient.id),
        meta: {
          profile: patientToFhirR4(patient, dataClass).meta.profile,
          tag: [
            ...patientToFhirR4(patient, dataClass).meta.tag,
            ...sourceTags(patient.source, dataClass).filter(
              (tag) => tag.system !== dataClassificationSystem,
            ),
          ],
        },
        identifier: [
          {
            system: "https://pflegehelfer.example.invalid/patient-id",
            value: patient.id,
          },
          {
            system: `https://pflegehelfer.example.invalid/${dataClass === "synthetic-demo" ? "synthetic-mrn" : "medical-record-number"}`,
            value: patient.mrn,
          },
        ],
      } as Resource,
      location(patient, dataClass),
      encounter(patient, dataClass),
      ...goals(patient, dataClass),
      carePlan(patient, dataClass),
    ]),
    ...state.tasks.map((item) => task(item, dataClass)),
    ...state.observations.map(
      (item) =>
        ({
          ...observationToFhirR4(item, dataClass),
          id: fhirResourceId("Observation", item.id),
          meta: {
            profile: observationToFhirR4(item, dataClass).meta.profile,
            tag: [
              ...observationToFhirR4(item, dataClass).meta.tag,
              ...sourceTags(item.source, dataClass).filter(
                (tag) => tag.system !== dataClassificationSystem,
              ),
            ],
          },
          identifier: [
            {
              system: "https://pflegehelfer.example.invalid/observation-id",
              value: item.id,
            },
          ],
          subject: { reference: ref("Patient", item.patientId) },
          encounter: { reference: ref("Encounter", item.encounterId) },
          performer: [{ reference: ref("Practitioner", item.performerId) }],
        }) as Resource,
    ),
    ...state.notes.map((item) => note(item, dataClass)),
    ...state.communications.map((item) => communication(item, dataClass)),
  ];
  return [
    ...clinical,
    ...clinical
      .map(provenance)
      .filter((item): item is Provenance => item !== null),
    ...auditEntries.map((entry) => auditEventToFhirR4(entry, dataClass)),
  ].map((resource) => ({
    ...resource,
    meta: {
      ...resource.meta,
      tag: [
        ...(resource.meta?.tag ?? []).filter(
          (tag) =>
            tag.system !== tenantTagSystem &&
            tag.system !== managedProjectionTag.system,
        ),
        tenantTag(),
        managedProjectionTag,
      ],
    },
  }));
}
