import { createHash } from "node:crypto";
import { z } from "zod";
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
  QuestionnaireResponse,
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
  IntakeItem,
  Observation,
  Patient,
  RoundAction,
  AuditEntry,
} from "./types.js";
import { parseVoiceTranscriptProvenance } from "./voice-provenance.js";

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
  intake: IntakeItem[];
  roundActions: RoundAction[];
}

export function validateCanonicalClinicalReferences(
  state: CanonicalClinicalState,
  trustedUsers: readonly DemoUser[] = state.users,
): void {
  const users = new Map(trustedUsers.map((user) => [user.id, user]));
  const patients = new Map(
    state.patients.map((patient) => [patient.id, patient]),
  );
  const tasks = new Set(state.tasks.map((task) => task.id));
  const requireUser = (id: string | null, relation: string) => {
    if (id && !users.has(id))
      throw new Error(
        `CANONICAL_TRUSTED_USER_REFERENCE_INVALID:${relation}:${id}`,
      );
  };
  const requirePatientEncounter = (
    patientId: string,
    encounterId: string | null,
    relation: string,
  ) => {
    const patient = patients.get(patientId);
    if (!patient)
      throw new Error(`CANONICAL_DOMAIN_PATIENT_ORPHAN:${patientId}`);
    if (encounterId && patient.encounterId !== encounterId)
      throw new Error(
        `CANONICAL_DOMAIN_ENCOUNTER_ORPHAN:${relation}:${encounterId}`,
      );
  };
  const validateApprovalState = (
    record: Observation | ClinicalNote,
    kind: "observation" | "note",
  ) => {
    const authorId =
      kind === "observation"
        ? (record as Observation).performerId
        : (record as ClinicalNote).authorId;
    const requiresIndependent = ["high-assurance", "four-eyes"].includes(
      record.approvalPolicy,
    );
    if (record.status === "draft") {
      if (record.approvals.length !== 0 || record.approvedAt !== null)
        throw new Error(
          `CANONICAL_APPROVAL_STATE_INVALID:${kind}/${record.id}`,
        );
      return;
    }
    if (record.status === "reviewed") {
      if (
        !requiresIndependent ||
        record.approvals.length !== 1 ||
        record.approvals[0] !== authorId ||
        record.approvedAt !== null
      )
        throw new Error(
          `CANONICAL_APPROVAL_STATE_INVALID:${kind}/${record.id}`,
        );
      return;
    }
    if (record.approvedAt === null)
      throw new Error(`CANONICAL_APPROVAL_STATE_INVALID:${kind}/${record.id}`);
    if (record.approvalPolicy === "standard") {
      if (record.approvals.length !== 1)
        throw new Error(
          `CANONICAL_APPROVAL_STATE_INVALID:${kind}/${record.id}`,
        );
      return;
    }
    if (record.approvals[0] !== authorId)
      throw new Error(`CANONICAL_APPROVAL_AUTHOR_INVALID:${kind}/${record.id}`);
    if (!requiresIndependent) {
      if (record.approvals.length !== 1)
        throw new Error(
          `CANONICAL_APPROVAL_STATE_INVALID:${kind}/${record.id}`,
        );
      return;
    }
    if (record.approvals.length !== 2 || record.approvals[1] === authorId)
      throw new Error(
        `CANONICAL_INDEPENDENT_APPROVAL_INVALID:${kind}/${record.id}`,
      );
    const reviewer = users.get(record.approvals[1]!);
    const qualification =
      kind === "observation"
        ? "clinical-observation-independent-review"
        : "clinical-note-independent-review";
    if (!reviewer?.qualificationIds?.includes(qualification))
      throw new Error(
        `CANONICAL_INDEPENDENT_APPROVAL_QUALIFICATION_INVALID:${kind}/${record.id}`,
      );
  };
  for (const task of state.tasks) {
    if (task.patientId)
      requirePatientEncounter(
        task.patientId,
        task.encounterId,
        `task/${task.id}`,
      );
    requireUser(
      task.requesterId.startsWith("u-") ? task.requesterId : null,
      `task-requester/${task.id}`,
    );
    requireUser(task.ownerId, `task-owner/${task.id}`);
    if (task.ownerId && users.get(task.ownerId)?.role !== task.ownerRole)
      throw new Error(`CANONICAL_TASK_OWNER_ROLE_MISMATCH:${task.id}`);
  }
  for (const observation of state.observations) {
    requirePatientEncounter(
      observation.patientId,
      observation.encounterId,
      `observation/${observation.id}`,
    );
    const deviceAuthored =
      observation.deviceId !== null &&
      observation.deviceId === observation.performerId;
    if (!deviceAuthored)
      requireUser(
        observation.performerId,
        `observation-performer/${observation.id}`,
      );
    for (const approver of observation.approvals) {
      const providerApproval =
        observation.approvalPolicy === "standard" &&
        deviceAuthored &&
        approver === "device-gateway";
      if (!providerApproval)
        requireUser(approver, `observation-approver/${observation.id}`);
    }
    if (new Set(observation.approvals).size !== observation.approvals.length)
      throw new Error(
        `CANONICAL_APPROVAL_DUPLICATE:observation/${observation.id}`,
      );
    validateApprovalState(observation, "observation");
  }
  for (const note of state.notes) {
    requirePatientEncounter(
      note.patientId,
      note.encounterId,
      `note/${note.id}`,
    );
    requireUser(note.authorId, `note-author/${note.id}`);
    for (const approver of note.approvals)
      requireUser(approver, `note-approver/${note.id}`);
    if (new Set(note.approvals).size !== note.approvals.length)
      throw new Error(`CANONICAL_APPROVAL_DUPLICATE:note/${note.id}`);
    validateApprovalState(note, "note");
  }
  for (const communication of state.communications) {
    requirePatientEncounter(
      communication.patientId,
      communication.encounterId,
      `communication/${communication.id}`,
    );
    requireUser(
      communication.senderId,
      `communication-sender/${communication.id}`,
    );
    requireUser(
      communication.recipientId,
      `communication-recipient/${communication.id}`,
    );
    requireUser(
      communication.acknowledgedBy,
      `communication-acknowledger/${communication.id}`,
    );
    requireUser(
      communication.answeredBy,
      `communication-answerer/${communication.id}`,
    );
    if (
      communication.resultingTaskId &&
      !tasks.has(communication.resultingTaskId)
    )
      throw new Error(
        `CANONICAL_TASK_REFERENCE_INVALID:communication/${communication.id}`,
      );
  }
  for (const item of state.intake) {
    requirePatientEncounter(item.patientId, null, `intake/${item.id}`);
    if (item.taskId && !tasks.has(item.taskId))
      throw new Error(`CANONICAL_TASK_REFERENCE_INVALID:intake/${item.id}`);
  }
  for (const action of state.roundActions) {
    requirePatientEncounter(
      action.patientId,
      null,
      `round-action/${action.id}`,
    );
    requireUser(action.createdBy, `round-action-creator/${action.id}`);
    if (action.taskId && !tasks.has(action.taskId))
      throw new Error(
        `CANONICAL_TASK_REFERENCE_INVALID:round-action/${action.id}`,
      );
  }
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
export const canonicalDomainExtensionUrl =
  "https://pflegehelfer.example.invalid/fhir/StructureDefinition/canonical-domain-envelope-v2";

export type CanonicalDomainKind =
  | "user"
  | "patient"
  | "task"
  | "observation"
  | "note"
  | "communication"
  | "intake"
  | "round-action";

const roleSchema = z.enum([
  "care-assistant",
  "registered-nurse",
  "physician",
  "pharmacy",
  "physiotherapy",
  "occupational-therapy",
  "transport",
  "service",
  "administration",
  "management",
  "hr",
  "it",
  "quality-safety",
]);
const purposeSchema = z.enum([
  "direct-care",
  "operations",
  "administration",
  "quality-review",
  "emergency",
]);
const providerSchema = z.enum([
  "wicare",
  "carecoach",
  "sap-vitals",
  "device-gateway",
  "nurse-call",
  "pflegehelfer",
]);
const sourceMetaSchema = z
  .object({
    provider: providerSchema,
    externalId: z.string().min(1).max(300),
    version: z.number().int().nonnegative(),
    mappingVersion: z.string().min(1).max(160),
    effectiveAt: z.iso.datetime(),
    recordedAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
    syncedAt: z.iso.datetime().nullable(),
  })
  .strict();
const domainSchemas = {
  user: z
    .object({
      id: z.string().min(1).max(160),
      displayName: z.string().min(1).max(300),
      role: roleSchema,
      wardIds: z.array(z.string().min(1).max(160)).max(256),
      patientIds: z.array(z.string().min(1).max(160)).max(10_000),
      managedDevice: z.boolean(),
      defaultPurpose: purposeSchema,
      qualificationIds: z.array(z.string().min(1).max(160)).max(256).optional(),
      directoryProfile: z
        .object({
          professionalTitle: z.string().max(300),
          team: z.string().max(300),
          station: z.string().max(300),
          workEmail: z.string().max(320),
          workPhone: z.string().max(80),
          languages: z.array(z.string().max(80)).max(64),
          responsibilities: z.array(z.string().max(500)).max(256),
        })
        .strict()
        .optional(),
    })
    .strict(),
  patient: z
    .object({
      id: z.string().min(1).max(160),
      displayName: z.string().min(1).max(300),
      birthDate: z.iso.date(),
      mrn: z.string().min(1).max(160),
      room: z.string().min(1).max(80),
      wardId: z.string().min(1).max(160),
      encounterId: z.string().min(1).max(160),
      allergyStatus: z.enum(["confirmed", "explicit-negative", "unknown"]),
      allergies: z.array(z.string().max(500)).max(1_000),
      risks: z.array(z.string().max(500)).max(1_000),
      diagnoses: z.array(z.string().max(500)).max(1_000),
      careGoals: z.array(z.string().max(1_000)).max(1_000),
      medicationSummary: z.array(z.string().max(1_000)).max(2_000),
      carePreferences: z.array(z.string().max(1_000)).max(1_000).optional(),
      communicationPreferences: z
        .array(z.string().max(1_000))
        .max(1_000)
        .optional(),
      dailyRoutine: z.array(z.string().max(1_000)).max(1_000).optional(),
      source: sourceMetaSchema,
    })
    .strict(),
  task: z
    .object({
      id: z.string().min(1).max(160),
      patientId: z.string().min(1).max(160).nullable(),
      encounterId: z.string().min(1).max(160).nullable(),
      title: z.string().min(1).max(1_000),
      reason: z.string().max(2_000),
      requesterId: z.string().min(1).max(160),
      ownerRole: roleSchema,
      ownerId: z.string().min(1).max(160).nullable(),
      priority: z.enum(["routine", "elevated", "urgent"]),
      dueAt: z.iso.datetime(),
      state: z.enum([
        "new",
        "accepted",
        "in-progress",
        "waiting",
        "completed",
        "escalated",
      ]),
      acknowledgementRequired: z.boolean(),
      acknowledgedAt: z.iso.datetime().nullable(),
      dependencies: z.array(z.string().min(1).max(160)).max(1_000),
      comments: z.array(z.string().max(2_000)).max(1_000),
      completionEvidence: z.string().max(4_000).nullable(),
      escalation: z.string().max(2_000),
      source: sourceMetaSchema,
    })
    .strict(),
  observation: z
    .object({
      id: z.string().min(1).max(160),
      patientId: z.string().min(1).max(160),
      encounterId: z.string().min(1).max(160),
      code: z.enum([
        "blood-pressure",
        "temperature",
        "oxygen-saturation",
        "pulse",
        "weight",
      ]),
      label: z.string().min(1).max(300),
      value: z.number().finite(),
      secondaryValue: z.number().finite().nullable(),
      unit: z.enum(["mmHg", "°C", "%", "/min", "kg"]),
      effectiveAt: z.iso.datetime(),
      performerId: z.string().min(1).max(160),
      deviceId: z.string().min(1).max(160).nullable(),
      status: z.enum([
        "draft",
        "reviewed",
        "approved",
        "pending-provider",
        "external-gated",
        "synced",
        "rejected",
        "conflict",
        "manual-review",
      ]),
      version: z.number().int().positive(),
      basedOnVersion: z.number().int().nonnegative(),
      approvalPolicy: z.enum([
        "standard",
        "sensitive",
        "high-assurance",
        "four-eyes",
      ]),
      approvals: z.array(z.string().min(1).max(160)).max(64),
      approvedAt: z.iso.datetime().nullable(),
      source: sourceMetaSchema,
    })
    .strict(),
  note: z
    .object({
      id: z.string().min(1).max(160),
      patientId: z.string().min(1).max(160),
      encounterId: z.string().min(1).max(160),
      transcript: z
        .string()
        .max(64 * 1024)
        .nullable(),
      voiceTranscriptProvenance: z.array(z.unknown()).max(64).optional(),
      structuredText: z.string().max(64 * 1024),
      criticalEntities: z.array(z.string().max(1_000)).max(1_000),
      authorId: z.string().min(1).max(160),
      status: z.enum([
        "draft",
        "reviewed",
        "approved",
        "pending-provider",
        "external-gated",
        "synced",
        "rejected",
        "conflict",
        "manual-review",
      ]),
      version: z.number().int().positive(),
      basedOnVersion: z.number().int().nonnegative(),
      approvalPolicy: z.enum([
        "standard",
        "sensitive",
        "high-assurance",
        "four-eyes",
      ]),
      approvals: z.array(z.string().min(1).max(160)).max(64),
      approvedAt: z.iso.datetime().nullable(),
      provider: providerSchema.exclude(["pflegehelfer"]),
      source: sourceMetaSchema,
    })
    .strict(),
  communication: z
    .object({
      id: z.string().min(1).max(160),
      patientId: z.string().min(1).max(160),
      encounterId: z.string().min(1).max(160),
      request: z
        .string()
        .min(1)
        .max(16 * 1024),
      reason: z.string().max(16 * 1024),
      senderId: z.string().min(1).max(160),
      recipientRole: roleSchema,
      recipientId: z.string().min(1).max(160).nullable(),
      escalationRecipientRole: roleSchema.nullable(),
      escalatedAt: z.iso.datetime().nullable(),
      priority: z.enum(["routine", "elevated", "urgent"]),
      dueAt: z.iso.datetime().nullable(),
      state: z.enum([
        "sent",
        "acknowledged",
        "answered",
        "closed",
        "escalated",
      ]),
      acknowledgedBy: z.string().min(1).max(160).nullable(),
      answeredBy: z.string().min(1).max(160).nullable(),
      response: z
        .string()
        .max(16 * 1024)
        .nullable(),
      resultingTaskId: z.string().min(1).max(160).nullable(),
      source: sourceMetaSchema,
    })
    .strict(),
  intake: z
    .object({
      id: z.string().min(1).max(160),
      patientId: z.string().min(1).max(160),
      label: z.string().min(1).max(1_000),
      state: z.enum(["complete", "missing", "discrepancy", "reviewed"]),
      detail: z.string().max(16 * 1024),
      ownerRole: roleSchema,
      sourceLabels: z.array(z.string().max(1_000)).max(1_000),
      taskId: z.string().min(1).max(160).nullable(),
    })
    .strict(),
  "round-action": z
    .object({
      id: z.string().min(1).max(160),
      patientId: z.string().min(1).max(160),
      actionKind: z.enum([
        "mobility-followup",
        "vital-sign-followup",
        "wound-observation",
        "therapy-followup",
        "diagnostic-followup",
      ]),
      decision: z.string().min(1).max(2_000),
      category: z.enum(["care", "therapy", "diagnostic-followup"]),
      ownerRole: roleSchema,
      deadline: z.iso.datetime(),
      requiredConfirmation: z.string().min(1).max(2_000),
      targetSystem: providerSchema,
      status: z.enum(["draft", "approved", "completed"]),
      createdBy: z.string().min(1).max(160),
      taskId: z.string().min(1).max(160).nullable(),
    })
    .strict(),
} as const;

function parseCanonicalDomainPayload(
  kind: CanonicalDomainKind,
  payload: unknown,
): unknown {
  if (kind === "note") {
    const parsed = domainSchemas.note.parse(payload);
    for (const provenance of parsed.voiceTranscriptProvenance ?? [])
      parseVoiceTranscriptProvenance(provenance);
    return parsed;
  }
  return domainSchemas[kind].parse(payload);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function withCanonicalDomain<T extends Resource>(
  resource: T,
  kind: CanonicalDomainKind,
  value: unknown,
): T {
  const payload = structuredClone(value);
  const envelope = {
    schemaVersion: 2 as const,
    kind,
    payload,
    sha256: createHash("sha256").update(canonicalJson(payload)).digest("hex"),
  };
  const domain = resource as T & {
    extension?: Array<{ url: string; valueString?: string }>;
  };
  return {
    ...resource,
    extension: [
      ...(domain.extension ?? []).filter(
        (extension) => extension.url !== canonicalDomainExtensionUrl,
      ),
      {
        url: canonicalDomainExtensionUrl,
        valueString: JSON.stringify(envelope),
      },
    ],
  };
}

export function readCanonicalDomainEnvelope<T>(
  resource: Resource,
  expectedKind: CanonicalDomainKind,
): T {
  const domain = resource as Resource & {
    extension?: Array<{ url?: string; valueString?: string }>;
  };
  const extensions = (domain.extension ?? []).filter(
    (extension) => extension.url === canonicalDomainExtensionUrl,
  );
  if (extensions.length !== 1 || !extensions[0]?.valueString)
    throw new Error(
      `CANONICAL_DOMAIN_ENVELOPE_MISSING:${resource.resourceType}/${resource.id ?? "missing"}`,
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(extensions[0].valueString);
  } catch {
    throw new Error(
      `CANONICAL_DOMAIN_ENVELOPE_INVALID:${resource.resourceType}/${resource.id ?? "missing"}`,
    );
  }
  if (!parsed || typeof parsed !== "object")
    throw new Error("CANONICAL_DOMAIN_ENVELOPE_INVALID");
  const envelope = parsed as {
    schemaVersion?: unknown;
    kind?: unknown;
    payload?: unknown;
    sha256?: unknown;
  };
  if (!envelope.payload || typeof envelope.payload !== "object")
    throw new Error(
      `CANONICAL_DOMAIN_ENVELOPE_INVALID:${resource.resourceType}/${resource.id ?? "missing"}`,
    );
  const digest = createHash("sha256")
    .update(canonicalJson(envelope.payload))
    .digest("hex");
  if (
    envelope.schemaVersion !== 2 ||
    envelope.kind !== expectedKind ||
    typeof envelope.sha256 !== "string" ||
    envelope.sha256 !== digest
  )
    throw new Error(
      `CANONICAL_DOMAIN_ENVELOPE_INVALID:${resource.resourceType}/${resource.id ?? "missing"}`,
    );
  return structuredClone(
    parseCanonicalDomainPayload(expectedKind, envelope.payload),
  ) as T;
}

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
  return withCanonicalDomain<Practitioner>(
    {
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
          text: user.displayName,
          ...(first ? { given: [first] } : {}),
          family: family.join(" "),
        },
      ],
    },
    "user",
    user,
  );
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
  return withCanonicalDomain<Task>(
    {
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
      restriction: { period: { end: item.dueAt } },
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
    },
    "task",
    item,
  );
}

function communication(
  item: Communication,
  dataClass: DataClass,
): FhirCommunication {
  return withCanonicalDomain(
    {
      resourceType: "Communication",
      id: fhirResourceId("Communication", item.id),
      identifier: [
        {
          system: "https://pflegehelfer.example.invalid/communication-id",
          value: item.id,
        },
      ],
      meta: {
        tag: [
          ...sourceTags(item.source, dataClass),
          {
            system:
              "https://pflegehelfer.example.invalid/communication-workflow-state",
            code: item.state,
          },
        ],
      },
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
    },
    "communication",
    item,
  );
}

function note(item: ClinicalNote, dataClass: DataClass): DocumentReference {
  return withCanonicalDomain(
    {
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
      context: {
        encounter: [{ reference: ref("Encounter", item.encounterId) }],
      },
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
        ...(item.voiceTranscriptProvenance?.length
          ? [
              {
                attachment: {
                  contentType:
                    "application/vnd.pflegehelfer.voice-transcript-provenance+json",
                  title: "Spracherfassungsnachweis",
                  creation: item.source.recordedAt,
                  data: Buffer.from(
                    JSON.stringify(item.voiceTranscriptProvenance),
                    "utf8",
                  ).toString("base64"),
                },
              },
            ]
          : []),
      ],
    },
    "note",
    item,
  );
}

function intakeItem(
  item: IntakeItem,
  dataClass: DataClass,
): QuestionnaireResponse {
  return withCanonicalDomain<QuestionnaireResponse>(
    {
      resourceType: "QuestionnaireResponse",
      id: fhirResourceId("QuestionnaireResponse", `intake/${item.id}`),
      identifier: {
        system: "https://pflegehelfer.example.invalid/intake-id",
        value: item.id,
      },
      meta: { tag: [classificationTag(dataClass)] },
      status: item.state === "reviewed" ? "completed" : "in-progress",
      subject: { reference: ref("Patient", item.patientId) },
      item: [
        {
          linkId: "intake-item",
          text: item.label,
          answer: [{ valueString: item.detail }],
        },
      ],
    },
    "intake",
    item,
  );
}

const roundActionStatus: Record<RoundAction["status"], Task["status"]> = {
  draft: "draft",
  approved: "ready",
  completed: "completed",
};

function roundAction(item: RoundAction, dataClass: DataClass): Task {
  return withCanonicalDomain(
    {
      resourceType: "Task",
      id: fhirResourceId("Task", `round-action/${item.id}`),
      identifier: [
        {
          system: "https://pflegehelfer.example.invalid/round-action-id",
          value: item.id,
        },
      ],
      meta: {
        profile: [
          "https://pflegehelfer.example.invalid/fhir/StructureDefinition/round-action-v1",
        ],
        tag: [classificationTag(dataClass)],
      },
      status: roundActionStatus[item.status],
      intent: "plan",
      code: {
        coding: [
          {
            system:
              "https://pflegehelfer.example.invalid/CodeSystem/round-action-kind",
            code: item.actionKind,
          },
        ],
        text: item.decision,
      },
      description: item.decision,
      for: { reference: ref("Patient", item.patientId) },
      requester: { reference: ref("Practitioner", item.createdBy) },
      owner: { display: item.ownerRole },
      restriction: { period: { end: item.deadline } },
      ...(item.taskId
        ? {
            output: [
              {
                type: { text: "resulting-clinical-task" },
                valueReference: { reference: ref("Task", item.taskId) },
              },
            ],
          }
        : {}),
      input: [
        {
          type: {
            text: "required-confirmation",
          },
          valueString: item.requiredConfirmation,
        },
      ],
    },
    "round-action",
    item,
  );
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
      withCanonicalDomain(
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
        "patient",
        patient,
      ),
      location(patient, dataClass),
      encounter(patient, dataClass),
      ...goals(patient, dataClass),
      carePlan(patient, dataClass),
    ]),
    ...state.tasks.map((item) => task(item, dataClass)),
    ...state.observations.map((item) =>
      withCanonicalDomain(
        {
          ...observationToFhirR4(item, dataClass),
          id: fhirResourceId("Observation", item.id),
          meta: {
            profile: observationToFhirR4(item, dataClass).meta.profile,
            tag: [
              ...observationToFhirR4(item, dataClass).meta.tag,
              ...sourceTags(item.source, dataClass).filter(
                (tag) => tag.system !== dataClassificationSystem,
              ),
              {
                system:
                  "https://pflegehelfer.example.invalid/observation-approval-state",
                code: item.approvedAt === null ? "pending" : "accepted",
              },
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
        } as Resource,
        "observation",
        item,
      ),
    ),
    ...state.notes.map((item) => note(item, dataClass)),
    ...state.communications.map((item) => communication(item, dataClass)),
    ...state.intake.map((item) => intakeItem(item, dataClass)),
    ...state.roundActions.map((item) => roundAction(item, dataClass)),
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

function domainIdentifier(resource: Resource, system: string): string | null {
  const identified = resource as Resource & {
    identifier?:
      | { system?: string; value?: string }
      | Array<{ system?: string; value?: string }>;
  };
  const identifiers = Array.isArray(identified.identifier)
    ? identified.identifier
    : identified.identifier
      ? [identified.identifier]
      : [];
  const matches = identifiers.filter(
    (identifier) => identifier.system === system && identifier.value,
  );
  if (matches.length > 1)
    throw new Error(
      `CANONICAL_DOMAIN_IDENTIFIER_DUPLICATE:${resource.resourceType}/${resource.id ?? "missing"}`,
    );
  return matches[0]?.value ?? null;
}

function assertCanonicalNativeProjection(
  kind: CanonicalDomainKind,
  value:
    | DemoUser
    | Patient
    | ClinicalTask
    | Observation
    | ClinicalNote
    | Communication
    | IntakeItem
    | RoundAction,
  resource: Resource,
): void {
  const state: CanonicalClinicalState = {
    users: kind === "user" ? [value as DemoUser] : [],
    patients: kind === "patient" ? [value as Patient] : [],
    tasks: kind === "task" ? [value as ClinicalTask] : [],
    observations: kind === "observation" ? [value as Observation] : [],
    notes: kind === "note" ? [value as ClinicalNote] : [],
    communications: kind === "communication" ? [value as Communication] : [],
    intake: kind === "intake" ? [value as IntakeItem] : [],
    roundActions: kind === "round-action" ? [value as RoundAction] : [],
  };
  const classification = resource.meta?.tag?.find(
    (tag) => tag.system === dataClassificationSystem,
  )?.code;
  if (
    classification !== "synthetic-demo" &&
    classification !== "institution-local"
  )
    throw new Error(`CANONICAL_DATA_CLASS_MISSING:${kind}/${value.id}`);
  const expected = toFhirResourceSet(state, [], classification).find(
    (candidate) =>
      candidate.resourceType === resource.resourceType &&
      candidate.id === resource.id,
  );
  if (!expected)
    throw new Error(`CANONICAL_NATIVE_PROJECTION_MISSING:${kind}/${value.id}`);
  const normalized = (candidate: Resource) => {
    const copy = structuredClone(candidate) as Resource & {
      extension?: Array<{ url?: string }>;
    };
    copy.extension = (copy.extension ?? []).filter(
      (extension) => extension.url !== canonicalDomainExtensionUrl,
    );
    if (copy.extension.length === 0) delete copy.extension;
    if (copy.meta) {
      delete copy.meta.versionId;
      delete copy.meta.lastUpdated;
      delete copy.meta.source;
    }
    return copy;
  };
  if (
    canonicalJson(normalized(resource)) !== canonicalJson(normalized(expected))
  )
    throw new Error(`CANONICAL_NATIVE_FIELD_MISMATCH:${kind}/${value.id}`);
}

export function assertCanonicalManagedResourceOwnership(
  resource: Resource,
): void {
  const tenantTags = (resource.meta?.tag ?? []).filter(
    (tag) => tag.system === tenantTagSystem,
  );
  const projectionTags = (resource.meta?.tag ?? []).filter(
    (tag) => tag.system === managedProjectionTag.system,
  );
  if (
    tenantTags.length !== 1 ||
    tenantTags[0]?.code !== tenantTag().code ||
    projectionTags.length !== 1 ||
    projectionTags[0]?.code !== managedProjectionTag.code
  )
    throw new Error("CANONICAL_DOMAIN_RESOURCE_SCOPE_INVALID");
  const hasEnvelope = (
    resource as Resource & { extension?: Array<{ url?: string }> }
  ).extension?.some(
    (extension) => extension.url === canonicalDomainExtensionUrl,
  );
  if (!hasEnvelope) {
    if (
      [
        "Practitioner",
        "Patient",
        "Task",
        "Observation",
        "Communication",
        "DocumentReference",
        "QuestionnaireResponse",
      ].includes(resource.resourceType)
    )
      throw new Error("CANONICAL_DOMAIN_ENVELOPE_MISSING");
    return;
  }
  let kind: CanonicalDomainKind;
  let identifierSystem: string;
  let physicalDomainPrefix = "";
  if (resource.resourceType === "Practitioner") {
    kind = "user";
    identifierSystem = "https://pflegehelfer.example.invalid/practitioner-id";
  } else if (resource.resourceType === "Patient") {
    kind = "patient";
    identifierSystem = "https://pflegehelfer.example.invalid/patient-id";
  } else if (resource.resourceType === "Observation") {
    kind = "observation";
    identifierSystem = "https://pflegehelfer.example.invalid/observation-id";
  } else if (resource.resourceType === "DocumentReference") {
    kind = "note";
    identifierSystem = "https://pflegehelfer.example.invalid/note-id";
  } else if (resource.resourceType === "Communication") {
    kind = "communication";
    identifierSystem = "https://pflegehelfer.example.invalid/communication-id";
  } else if (resource.resourceType === "QuestionnaireResponse") {
    kind = "intake";
    identifierSystem = "https://pflegehelfer.example.invalid/intake-id";
    physicalDomainPrefix = "intake/";
  } else if (
    resource.resourceType === "Task" &&
    domainIdentifier(
      resource,
      "https://pflegehelfer.example.invalid/round-action-id",
    )
  ) {
    kind = "round-action";
    identifierSystem = "https://pflegehelfer.example.invalid/round-action-id";
    physicalDomainPrefix = "round-action/";
  } else if (resource.resourceType === "Task") {
    kind = "task";
    identifierSystem = "https://pflegehelfer.example.invalid/task-id";
  } else throw new Error("CANONICAL_DOMAIN_RESOURCE_TYPE_INVALID");
  const value = readCanonicalDomainEnvelope<{ id: string }>(resource, kind);
  if (domainIdentifier(resource, identifierSystem) !== value.id)
    throw new Error("CANONICAL_DOMAIN_IDENTIFIER_MISMATCH");
  if (
    resource.id !==
    fhirResourceId(resource.resourceType, `${physicalDomainPrefix}${value.id}`)
  )
    throw new Error("CANONICAL_DOMAIN_PHYSICAL_ID_MISMATCH");
  assertCanonicalNativeProjection(
    kind,
    value as unknown as
      | DemoUser
      | Patient
      | ClinicalTask
      | Observation
      | ClinicalNote
      | Communication
      | IntakeItem
      | RoundAction,
    resource,
  );
}

/**
 * Reconstructs only Pflegehelfer-owned canonical resources. Imported/native
 * FHIR records without this projection profile remain available to scoped
 * source reads but are never guessed into the local command model.
 */
export function fromFhirResourceSet(
  resources: readonly Resource[],
  options: { requireServerVersion?: boolean } = {},
): CanonicalClinicalState {
  const result: CanonicalClinicalState = {
    users: [],
    patients: [],
    tasks: [],
    observations: [],
    notes: [],
    communications: [],
    intake: [],
    roundActions: [],
  };
  const seen = new Set<string>();
  const exactTenant = tenantTag().code;
  const assertManaged = (resource: Resource) => {
    const tenantTags = (resource.meta?.tag ?? []).filter(
      (tag) => tag.system === tenantTagSystem,
    );
    if (tenantTags.length !== 1 || tenantTags[0]?.code !== exactTenant)
      throw new Error(
        `CANONICAL_DOMAIN_TENANT_MISMATCH:${resource.resourceType}/${resource.id ?? "missing"}`,
      );
    const projectionTags = (resource.meta?.tag ?? []).filter(
      (tag) => tag.system === managedProjectionTag.system,
    );
    if (
      projectionTags.length !== 1 ||
      projectionTags[0]?.code !== managedProjectionTag.code
    )
      throw new Error(
        `CANONICAL_DOMAIN_PROJECTION_TAG_MISSING:${resource.resourceType}/${resource.id ?? "missing"}`,
      );
    if (options.requireServerVersion && !resource.meta?.versionId)
      throw new Error(
        `CANONICAL_DOMAIN_VERSION_MISSING:${resource.resourceType}/${resource.id ?? "missing"}`,
      );
  };
  const push = <T extends { id: string }>(
    kind: CanonicalDomainKind,
    resource: Resource,
    identifierSystem: string,
    target: T[],
  ) => {
    assertManaged(resource);
    const value = readCanonicalDomainEnvelope<T>(resource, kind);
    if (!value || typeof value.id !== "string" || value.id.length === 0)
      throw new Error(`CANONICAL_DOMAIN_PAYLOAD_INVALID:${kind}`);
    if (domainIdentifier(resource, identifierSystem) !== value.id)
      throw new Error(
        `CANONICAL_DOMAIN_IDENTIFIER_MISMATCH:${kind}/${value.id}`,
      );
    const physical =
      kind === "user"
        ? ["Practitioner", value.id]
        : kind === "patient"
          ? ["Patient", value.id]
          : kind === "task"
            ? ["Task", value.id]
            : kind === "observation"
              ? ["Observation", value.id]
              : kind === "note"
                ? ["DocumentReference", value.id]
                : kind === "communication"
                  ? ["Communication", value.id]
                  : kind === "intake"
                    ? ["QuestionnaireResponse", `intake/${value.id}`]
                    : ["Task", `round-action/${value.id}`];
    if (resource.id !== fhirResourceId(physical[0]!, physical[1]!))
      throw new Error(
        `CANONICAL_DOMAIN_PHYSICAL_ID_MISMATCH:${kind}/${value.id}`,
      );
    assertCanonicalNativeProjection(
      kind,
      value as unknown as
        | DemoUser
        | Patient
        | ClinicalTask
        | Observation
        | ClinicalNote
        | Communication
        | IntakeItem
        | RoundAction,
      resource,
    );
    const payload = value as T & {
      patientId?: string | null;
      encounterId?: string | null;
    };
    const linked = resource as Resource & {
      for?: { reference?: string };
      subject?: { reference?: string };
      encounter?: { reference?: string };
      context?: { encounter?: Array<{ reference?: string }> };
    };
    if (payload.patientId) {
      const expectedPatient = ref("Patient", payload.patientId);
      const actualPatient = linked.for?.reference ?? linked.subject?.reference;
      if (actualPatient !== expectedPatient)
        throw new Error(
          `CANONICAL_DOMAIN_PATIENT_REFERENCE_MISMATCH:${kind}/${value.id}`,
        );
    }
    if (payload.encounterId && kind !== "patient") {
      const expectedEncounter = ref("Encounter", payload.encounterId);
      const actualEncounter =
        linked.encounter?.reference ??
        linked.context?.encounter?.[0]?.reference;
      if (actualEncounter !== expectedEncounter)
        throw new Error(
          `CANONICAL_DOMAIN_ENCOUNTER_REFERENCE_MISMATCH:${kind}/${value.id}`,
        );
    }
    const unique = `${kind}/${value.id}`;
    if (seen.has(unique))
      throw new Error(`CANONICAL_DOMAIN_DUPLICATE:${unique}`);
    seen.add(unique);
    target.push(value);
  };

  for (const resource of resources) {
    const domain = resource as Resource & {
      extension?: Array<{ url?: string }>;
    };
    const hasEnvelope = (domain.extension ?? []).some(
      (extension) => extension.url === canonicalDomainExtensionUrl,
    );
    if (!hasEnvelope) {
      if (
        [
          "Practitioner",
          "Patient",
          "Task",
          "Observation",
          "Communication",
          "DocumentReference",
          "QuestionnaireResponse",
        ].includes(resource.resourceType)
      )
        throw new Error(
          `CANONICAL_DOMAIN_ENVELOPE_MISSING:${resource.resourceType}/${resource.id ?? "missing"}`,
        );
      continue;
    }
    if (resource.resourceType === "Practitioner")
      push(
        "user",
        resource,
        "https://pflegehelfer.example.invalid/practitioner-id",
        result.users,
      );
    else if (resource.resourceType === "Patient")
      push(
        "patient",
        resource,
        "https://pflegehelfer.example.invalid/patient-id",
        result.patients,
      );
    else if (resource.resourceType === "Observation")
      push(
        "observation",
        resource,
        "https://pflegehelfer.example.invalid/observation-id",
        result.observations,
      );
    else if (resource.resourceType === "DocumentReference")
      push(
        "note",
        resource,
        "https://pflegehelfer.example.invalid/note-id",
        result.notes,
      );
    else if (resource.resourceType === "Communication")
      push(
        "communication",
        resource,
        "https://pflegehelfer.example.invalid/communication-id",
        result.communications,
      );
    else if (resource.resourceType === "QuestionnaireResponse")
      push(
        "intake",
        resource,
        "https://pflegehelfer.example.invalid/intake-id",
        result.intake,
      );
    else if (resource.resourceType === "Task") {
      const roundId = domainIdentifier(
        resource,
        "https://pflegehelfer.example.invalid/round-action-id",
      );
      if (roundId)
        push(
          "round-action",
          resource,
          "https://pflegehelfer.example.invalid/round-action-id",
          result.roundActions,
        );
      else
        push(
          "task",
          resource,
          "https://pflegehelfer.example.invalid/task-id",
          result.tasks,
        );
    } else
      throw new Error(
        `CANONICAL_DOMAIN_RESOURCE_TYPE_INVALID:${resource.resourceType}`,
      );
  }

  const patientIds = new Set(result.patients.map((patient) => patient.id));
  const orphan = [
    ...result.tasks.flatMap((item) => (item.patientId ? [item.patientId] : [])),
    ...result.observations.map((item) => item.patientId),
    ...result.notes.map((item) => item.patientId),
    ...result.communications.map((item) => item.patientId),
    ...result.intake.map((item) => item.patientId),
    ...result.roundActions.map((item) => item.patientId),
  ].find((patientId) => !patientIds.has(patientId));
  if (orphan) throw new Error(`CANONICAL_DOMAIN_PATIENT_ORPHAN:${orphan}`);
  validateCanonicalClinicalReferences(result);
  return result;
}
