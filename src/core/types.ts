export type Role =
  | "care-assistant"
  | "registered-nurse"
  | "physician"
  | "pharmacy"
  | "physiotherapy"
  | "occupational-therapy"
  | "transport"
  | "service"
  | "administration"
  | "management"
  | "hr"
  | "it"
  | "quality-safety";

export type Purpose =
  | "direct-care"
  | "operations"
  | "administration"
  | "quality-review"
  | "emergency";
export type ProviderId =
  "wicare" | "carecoach" | "sap-vitals" | "device-gateway" | "nurse-call";
export type SyncState =
  | "draft"
  | "reviewed"
  | "approved"
  | "pending-provider"
  | "synced"
  | "rejected"
  | "conflict"
  | "manual-review";
export type ProviderErrorClassification =
  | "technical"
  | "clinical-content"
  | "mapping"
  | "authorization"
  | "version-conflict";
export type TaskState =
  "new" | "accepted" | "in-progress" | "waiting" | "completed" | "escalated";
export type ApprovalPolicy =
  "standard" | "sensitive" | "high-assurance" | "four-eyes";

export interface DemoUser {
  id: string;
  displayName: string;
  role: Role;
  wardIds: string[];
  patientIds: string[];
  managedDevice: boolean;
  defaultPurpose: Purpose;
}

export interface SourceMeta {
  provider: ProviderId | "pflegehelfer";
  externalId: string;
  version: number;
  mappingVersion: string;
  effectiveAt: string;
  recordedAt: string;
  receivedAt: string;
  syncedAt: string | null;
}

export interface Patient {
  id: string;
  displayName: string;
  birthDate: string;
  mrn: string;
  room: string;
  wardId: string;
  encounterId: string;
  allergies: string[];
  risks: string[];
  diagnoses: string[];
  careGoals: string[];
  medicationSummary: string[];
  source: SourceMeta;
}

export interface ClinicalTask {
  id: string;
  patientId: string | null;
  title: string;
  reason: string;
  requesterId: string;
  ownerRole: Role;
  ownerId: string | null;
  priority: "routine" | "elevated" | "urgent";
  dueAt: string;
  state: TaskState;
  acknowledgementRequired: boolean;
  acknowledgedAt: string | null;
  dependencies: string[];
  comments: string[];
  completionEvidence: string | null;
  escalation: string;
  source: SourceMeta;
}

export interface Observation {
  id: string;
  patientId: string;
  code:
    "blood-pressure" | "temperature" | "oxygen-saturation" | "pulse" | "weight";
  label: string;
  value: number;
  secondaryValue: number | null;
  unit: "mmHg" | "°C" | "%" | "/min" | "kg";
  effectiveAt: string;
  performerId: string;
  deviceId: string | null;
  status: SyncState;
  version: number;
  basedOnVersion: number;
  approvalPolicy: ApprovalPolicy;
  approvals: string[];
  approvedAt: string | null;
  source: SourceMeta;
}

export interface ClinicalNote {
  id: string;
  patientId: string;
  transcript: string | null;
  structuredText: string;
  criticalEntities: string[];
  authorId: string;
  status: SyncState;
  version: number;
  basedOnVersion: number;
  approvalPolicy: ApprovalPolicy;
  approvals: string[];
  approvedAt: string | null;
  provider: ProviderId;
  source: SourceMeta;
}

export interface Communication {
  id: string;
  patientId: string;
  request: string;
  reason: string;
  senderId: string;
  recipientRole: Role;
  recipientId: string | null;
  escalationRecipientRole: Role | null;
  escalatedAt: string | null;
  priority: "routine" | "elevated" | "urgent";
  dueAt: string;
  state: "sent" | "acknowledged" | "answered" | "closed" | "escalated";
  acknowledgedBy: string | null;
  answeredBy: string | null;
  response: string | null;
  resultingTaskId: string | null;
  source: SourceMeta;
}

export interface IntakeItem {
  id: string;
  patientId: string;
  label: string;
  state: "complete" | "missing" | "discrepancy" | "reviewed";
  detail: string;
  ownerRole: Role;
  sourceLabels: string[];
  taskId: string | null;
}

export interface Handover {
  id: string;
  wardId: string;
  fromShift: string;
  toShift: string;
  patientIds: string[];
  deltaTaskIds: string[];
  deltaObservationIds: string[];
  unresolvedCommunicationIds: string[];
  narrative: string;
  signedBy: string | null;
  acknowledgedBy: string | null;
  status: "draft" | "signed" | "acknowledged";
  createdAt: string;
}

export interface RoundAction {
  id: string;
  patientId: string;
  actionKind:
    | "mobility-followup"
    | "vital-sign-followup"
    | "wound-observation"
    | "therapy-followup"
    | "diagnostic-followup";
  decision: string;
  category: "care" | "therapy" | "diagnostic-followup";
  ownerRole: Role;
  deadline: string;
  requiredConfirmation: string;
  targetSystem: ProviderId | "pflegehelfer";
  status: "draft" | "approved" | "completed";
  createdBy: string;
  taskId: string | null;
}

export interface ProviderHealth {
  provider: ProviderId;
  status: "available" | "degraded" | "down";
  latencyMs: number;
  checkedAt: string;
  message: string;
}

export interface OutboxItem {
  id: string;
  aggregateType: "observation" | "note";
  aggregateId: string;
  patientId: string;
  provider: ProviderId;
  idempotencyKey: string;
  expectedProviderVersion: string | null;
  canonicalCommand: {
    kind: "observation.upsert" | "nursing-note.upsert";
    resource: Observation | ClinicalNote;
  };
  correlationId: string;
  causationId: string;
  attempts: number;
  state: "pending" | "processing" | "acknowledged" | "rejected" | "conflict";
  createdAt: string;
  lastAttemptAt: string | null;
  receiptId: string | null;
  providerVersion: string | null;
  errorCode: string | null;
  errorClassification: ProviderErrorClassification | null;
  conflictSnapshot: { version: string; summary: string } | null;
}

export type OutboxSummary = Pick<
  OutboxItem,
  | "id"
  | "aggregateType"
  | "aggregateId"
  | "provider"
  | "state"
  | "attempts"
  | "errorCode"
  | "errorClassification"
  | "createdAt"
  | "expectedProviderVersion"
  | "providerVersion"
> & {
  localVersion: number;
  localHash: string;
  providerHash: string | null;
};
export type ClinicalOutboxSummary = OutboxSummary & {
  patientId: string;
  localSummary: string;
  conflictSnapshot: { version: string; summary: string } | null;
};

export interface AuditEntry {
  id: string;
  occurredAt: string;
  actorId: string;
  actorRole: Role;
  actorType?: "human" | "system";
  action: string;
  patientId: string | null;
  purpose: Purpose;
  outcome: "allowed" | "denied" | "success" | "failure";
  detail: Record<string, string | number | boolean | null>;
  previousHash: string;
  hash: string;
}

export interface AppSnapshot {
  currentUser: DemoUser;
  users: DemoUser[];
  patients: Patient[];
  tasks: ClinicalTask[];
  observations: Observation[];
  notes: ClinicalNote[];
  communications: Communication[];
  intake: IntakeItem[];
  handovers: Handover[];
  roundActions: RoundAction[];
  providerHealth: ProviderHealth[];
  outbox: (OutboxSummary | ClinicalOutboxSummary)[];
  syncSummary: {
    unresolved: number;
    conflicts: number;
  };
  capabilityProfile: "synthetic-simulator" | "production";
  serverTime: string;
  aiEnabled: boolean;
  workspace: {
    mode: "in-memory" | "medplum";
    ready: boolean;
    serverVersion: string | null;
    resourceCounts: Record<string, number>;
    message: string;
    checkedAt: string;
  };
  workspaceLinks: {
    home: string;
    patients: Record<string, string>;
  } | null;
}

export class DomainError extends Error {
  constructor(
    public readonly code:
      | "AUTH_DENIED"
      | "NOT_FOUND"
      | "INVALID_STATE"
      | "VALIDATION"
      | "VERSION_CONFLICT"
      | "PROVIDER_UNAVAILABLE"
      | "EXTERNAL_VENDOR_GATE",
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
