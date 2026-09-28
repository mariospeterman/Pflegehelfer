import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import baselineJson from "../../config/demo-scenarios/kronenhof-ward-day-v1.json" with { type: "json" };
import type { WorkflowState } from "./service.js";
import {
  demoWorkspaceSnapshotSchema,
  type DemoWorkspaceSnapshot,
} from "./workspace.js";

const id = z.string().regex(/^[a-z0-9][a-z0-9:-]{1,119}$/);
const iso = z.iso.datetime({ offset: true });
const role = z.enum([
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
const provider = z.enum([
  "wicare",
  "carecoach",
  "sap-vitals",
  "device-gateway",
  "nurse-call",
]);
const source = z
  .object({
    provider: z.union([provider, z.literal("pflegehelfer")]),
    externalId: z.string().trim().min(1).max(240),
    version: z.number().int().positive(),
    mappingVersion: z.string().trim().min(1).max(120),
    effectiveAt: iso,
    recordedAt: iso,
    receivedAt: iso,
    syncedAt: iso.nullable(),
  })
  .strict();
const user = z
  .object({
    id,
    displayName: z.string().trim().min(2).max(120),
    role,
    wardIds: z.array(id).max(40),
    patientIds: z.array(id).max(200),
    managedDevice: z.boolean(),
    defaultPurpose: z.enum([
      "direct-care",
      "operations",
      "administration",
      "quality-review",
      "emergency",
    ]),
    qualificationIds: z.array(id).max(40).optional(),
    directoryProfile: z
      .object({
        professionalTitle: z.string().trim().min(2).max(160),
        team: z.string().trim().min(2).max(160),
        station: z.string().trim().min(2).max(160),
        workEmail: z.string().email().max(240),
        workPhone: z.string().trim().min(3).max(80),
        languages: z.array(z.string().trim().min(2).max(80)).max(20),
        responsibilities: z.array(z.string().trim().min(2).max(240)).max(40),
      })
      .strict()
      .optional(),
  })
  .strict();
const patient = z
  .object({
    id,
    displayName: z.string().trim().min(2).max(120),
    birthDate: z.iso.date(),
    mrn: z.string().trim().min(3).max(80),
    room: z.string().trim().min(1).max(40),
    wardId: id,
    encounterId: id,
    allergyStatus: z.enum(["confirmed", "explicit-negative", "unknown"]),
    allergies: z.array(z.string().trim().min(1).max(240)).max(40),
    risks: z.array(z.string().trim().min(1).max(240)).max(40),
    diagnoses: z.array(z.string().trim().min(1).max(240)).max(40),
    careGoals: z.array(z.string().trim().min(1).max(240)).max(40),
    medicationSummary: z.array(z.string().trim().min(1).max(320)).max(40),
    carePreferences: z
      .array(z.string().trim().min(1).max(240))
      .max(40)
      .optional(),
    communicationPreferences: z
      .array(z.string().trim().min(1).max(240))
      .max(40)
      .optional(),
    dailyRoutine: z.array(z.string().trim().min(1).max(240)).max(40).optional(),
    source,
  })
  .strict();
const task = z
  .object({
    id,
    patientId: id.nullable(),
    encounterId: id.nullable(),
    title: z.string().trim().min(2).max(200),
    reason: z.string().trim().min(2).max(500),
    requesterId: id,
    ownerRole: role,
    ownerId: id.nullable(),
    priority: z.enum(["routine", "elevated", "urgent"]),
    dueAt: iso,
    state: z.enum([
      "new",
      "accepted",
      "in-progress",
      "waiting",
      "completed",
      "escalated",
    ]),
    acknowledgementRequired: z.boolean(),
    acknowledgedAt: iso.nullable(),
    dependencies: z.array(id).max(40),
    comments: z.array(z.string().max(1000)).max(40),
    completionEvidence: z.string().max(2000).nullable(),
    escalation: z.string().trim().min(2).max(500),
    source,
  })
  .strict();
const observation = z
  .object({
    id,
    patientId: id,
    encounterId: id,
    code: z.enum([
      "blood-pressure",
      "temperature",
      "oxygen-saturation",
      "pulse",
      "weight",
    ]),
    label: z.string().trim().min(1).max(120),
    value: z.number().finite(),
    secondaryValue: z.number().finite().nullable(),
    unit: z.enum(["mmHg", "°C", "%", "/min", "kg"]),
    effectiveAt: iso,
    performerId: id,
    deviceId: id.nullable(),
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
    approvals: z.array(id).max(8),
    approvedAt: iso.nullable(),
    source,
  })
  .strict();
const note = z
  .object({
    id,
    patientId: id,
    encounterId: id,
    transcript: z.string().max(8000).nullable(),
    voiceTranscriptProvenance: z.array(z.unknown()).max(20).optional(),
    structuredText: z.string().max(8000),
    criticalEntities: z.array(z.string().max(240)).max(100),
    authorId: id,
    status: observation.shape.status,
    version: z.number().int().positive(),
    basedOnVersion: z.number().int().nonnegative(),
    approvalPolicy: observation.shape.approvalPolicy,
    approvals: z.array(id).max(8),
    approvedAt: iso.nullable(),
    provider,
    source,
  })
  .strict();
const communication = z
  .object({
    id,
    patientId: id,
    encounterId: id,
    request: z.string().max(4000),
    reason: z.string().max(2000),
    senderId: id,
    recipientRole: role,
    recipientId: id.nullable(),
    escalationRecipientRole: role.nullable(),
    escalatedAt: iso.nullable(),
    priority: z.enum(["routine", "elevated", "urgent"]),
    dueAt: iso.nullable(),
    state: z.enum(["sent", "acknowledged", "answered", "closed", "escalated"]),
    acknowledgedBy: id.nullable(),
    answeredBy: id.nullable(),
    response: z.string().max(4000).nullable(),
    resultingTaskId: id.nullable(),
    source,
  })
  .strict();
const intake = z
  .object({
    id,
    patientId: id,
    label: z.string().max(240),
    state: z.enum(["complete", "missing", "discrepancy", "reviewed"]),
    detail: z.string().max(2000),
    ownerRole: role,
    sourceLabels: z.array(z.string().max(240)).max(20),
    taskId: id.nullable(),
  })
  .strict();
const roundAction = z
  .object({
    id,
    patientId: id,
    actionKind: z.enum([
      "mobility-followup",
      "vital-sign-followup",
      "wound-observation",
      "therapy-followup",
      "diagnostic-followup",
    ]),
    decision: z.string().max(500),
    category: z.enum(["care", "therapy", "diagnostic-followup"]),
    ownerRole: role,
    deadline: iso,
    requiredConfirmation: z.string().max(500),
    targetSystem: z.union([provider, z.literal("pflegehelfer")]),
    status: z.enum(["draft", "approved", "completed"]),
    createdBy: id,
    taskId: id.nullable(),
  })
  .strict();
const providerHealth = z
  .object({
    provider,
    status: z.enum(["available", "degraded", "down"]),
    latencyMs: z.number().int().nonnegative(),
    checkedAt: iso,
    message: z.string().max(500),
  })
  .strict();

export const demoWorkflowStateSchema = z
  .object({
    users: z.array(user).min(1).max(200),
    patients: z.array(patient).min(1).max(500),
    tasks: z.array(task).max(5000),
    observations: z.array(observation).max(10000),
    notes: z.array(note).max(10000),
    communications: z.array(communication).max(10000),
    intake: z.array(intake).max(5000),
    roundActions: z.array(roundAction).max(5000),
    providerHealth: z.array(providerHealth).max(20),
    outbox: z.array(z.never()).length(0),
  })
  .strict();

export const demoScenarioPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    version: z.number().int().positive(),
    label: z.string().trim().min(3).max(160),
    synthetic: z.literal(true),
    sitePackId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    clock: z
      .object({
        mode: z.literal("frozen"),
        anchor: iso,
        timeZone: z.literal("Europe/Zurich"),
      })
      .strict(),
    state: demoWorkflowStateSchema,
    workspace: demoWorkspaceSnapshotSchema,
    predefinedEvents: z
      .array(
        z
          .object({
            id,
            label: z.string().trim().min(3).max(160),
            kind: z.literal("nurse-call"),
            patientId: id,
          })
          .strict(),
      )
      .max(40),
  })
  .strict()
  .superRefine((pack, context) => {
    const patients = new Map(
      pack.state.patients.map((item) => [item.id, item]),
    );
    const unique = (label: string, values: readonly string[]) => {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: "custom",
          path: ["state", label],
          message: `${label} ids must be unique.`,
        });
    };
    unique(
      "users",
      pack.state.users.map((item) => item.id),
    );
    unique(
      "patients",
      pack.state.patients.map((item) => item.id),
    );
    unique(
      "tasks",
      pack.state.tasks.map((item) => item.id),
    );
    unique(
      "observations",
      pack.state.observations.map((item) => item.id),
    );
    unique(
      "notes",
      pack.state.notes.map((item) => item.id),
    );
    unique(
      "workspace.comments",
      pack.workspace.comments.map((item) => item.id),
    );
    unique(
      "workspace.attachments",
      pack.workspace.attachments.map((item) => item.record.id),
    );
    unique(
      "workspace.projects",
      pack.workspace.projects.map((item) => item.id),
    );
    for (const [index, actor] of pack.state.users.entries())
      for (const patientId of actor.patientIds)
        if (!patients.has(patientId))
          context.addIssue({
            code: "custom",
            path: ["state", "users", index, "patientIds"],
            message: `Unknown patient ${patientId}.`,
          });
    for (const [collection, records] of [
      ["tasks", pack.state.tasks],
      ["observations", pack.state.observations],
      ["notes", pack.state.notes],
      ["communications", pack.state.communications],
    ] as const)
      for (const [index, record] of records.entries()) {
        if (record.patientId === null) continue;
        const linked = patients.get(record.patientId);
        if (
          !linked ||
          (record.encounterId !== null &&
            linked.encounterId !== record.encounterId)
        )
          context.addIssue({
            code: "custom",
            path: ["state", collection, index],
            message:
              "Patient and encounter must resolve to the same scenario record.",
          });
      }
    for (const [index, attachment] of pack.workspace.attachments.entries()) {
      const bytes = Buffer.from(attachment.contentBase64, "base64");
      if (bytes.byteLength !== attachment.record.size)
        context.addIssue({
          code: "custom",
          path: ["workspace", "attachments", index, "contentBase64"],
          message: "Attachment byte length does not match its record.",
        });
      if (
        createHash("sha256").update(bytes).digest("hex") !==
        attachment.record.sha256
      )
        context.addIssue({
          code: "custom",
          path: ["workspace", "attachments", index, "contentBase64"],
          message: "Attachment digest does not match its record.",
        });
    }
  });

export type DemoScenarioPack = Omit<
  z.infer<typeof demoScenarioPackSchema>,
  "state"
> & {
  state: WorkflowState;
};

export interface DemoScenarioRun {
  schemaVersion: 1;
  runId: string;
  scenarioId: string;
  scenarioVersion: number;
  label: string;
  sourceRunId: string | null;
  clock: {
    mode: "frozen" | "start-today";
    anchor: string;
    timeZone: "Europe/Zurich";
    offsetMs: number;
  };
  state: WorkflowState;
  workspace: DemoWorkspaceSnapshot;
  createdAt: string;
  updatedAt: string;
}

export const demoScenarioRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.uuid(),
    scenarioId: z.string().regex(/^[a-z0-9][a-z0-9-]{2,79}$/),
    scenarioVersion: z.number().int().positive(),
    label: z.string().trim().min(3).max(160),
    sourceRunId: z.uuid().nullable(),
    clock: z
      .object({
        mode: z.enum(["frozen", "start-today"]),
        anchor: iso,
        timeZone: z.literal("Europe/Zurich"),
        offsetMs: z.number().int().safe(),
      })
      .strict(),
    state: demoWorkflowStateSchema,
    workspace: demoWorkspaceSnapshotSchema,
    createdAt: iso,
    updatedAt: iso,
  })
  .strict();

export function parseDemoScenarioRun(value: unknown): DemoScenarioRun {
  return demoScenarioRunSchema.parse(value) as unknown as DemoScenarioRun;
}

export const baselineDemoScenario = demoScenarioPackSchema.parse(
  baselineJson,
) as unknown as DemoScenarioPack;

export function scenarioDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function scenarioRunContentDigest(
  run: Pick<DemoScenarioRun, "state" | "workspace">,
): string {
  return scenarioDigest({ state: run.state, workspace: run.workspace });
}

export function createScenarioRun(
  input: {
    pack?: DemoScenarioPack;
    label?: string;
    mode?: "frozen" | "start-today";
    sourceRun?: DemoScenarioRun;
    cloneCurrent?: boolean;
    now?: Date;
  } = {},
): DemoScenarioRun {
  const pack = input.pack ?? baselineDemoScenario;
  const now = input.now ?? new Date();
  const source = input.sourceRun;
  const state = input.cloneCurrent && source ? source.state : pack.state;
  const workspace =
    input.cloneCurrent && source ? source.workspace : pack.workspace;
  const anchor = source?.clock.anchor ?? pack.clock.anchor;
  const mode = input.mode ?? source?.clock.mode ?? "frozen";
  const offsetMs =
    mode === "start-today"
      ? now.getTime() - Date.parse(anchor)
      : (source?.clock.offsetMs ?? 0);
  return {
    schemaVersion: 1,
    runId: randomUUID(),
    scenarioId: pack.id,
    scenarioVersion: pack.version,
    label: input.label?.trim() || `${pack.label} · ${now.toISOString()}`,
    sourceRunId: source?.runId ?? null,
    clock: { mode, anchor, timeZone: "Europe/Zurich", offsetMs },
    state: structuredClone(state),
    workspace: structuredClone(workspace),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function scenarioInventory(state: WorkflowState) {
  return {
    users: state.users.length,
    patients: state.patients.length,
    assignedPatients: new Set(
      state.users
        .filter((actor) => actor.role === "care-assistant")
        .flatMap((actor) => actor.patientIds),
    ).size,
    tasks: state.tasks.length,
    observations: state.observations.length,
    notes: state.notes.length,
    communications: state.communications.length,
  };
}
