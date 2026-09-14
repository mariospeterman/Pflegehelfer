import { createHash, randomUUID } from "node:crypto";
import type { Resource } from "@medplum/fhirtypes";
import pg from "pg";
import { workflowForRole, type WorkflowDefinition } from "../core/workflows.js";
import type { DurableIntentRecord } from "../core/assistant.js";
import type { ServiceCheckpoint } from "../core/service.js";
import {
  providerIdSchema,
  providerOutboxPayloadSchema,
  providerProfileSchema,
  type CanonicalClinicalCommand,
  type ProviderAcknowledgement,
  type ProviderDeliveryStore,
  type ProviderErrorClassification,
  type ProviderOutboxJob,
  type ProviderOutboxPayload,
  type ProviderProfile,
} from "../core/provider-integration/index.js";
import {
  DomainError,
  type AuditEntry,
  type Purpose,
  type Role,
} from "../core/types.js";
import type {
  ResponsibilityTransferView,
  WorkdayCommand,
  WorkdayView,
  WorkEpisodeView,
} from "../core/workday.js";
import { siteConfiguration } from "../core/site-config.js";
import { runMigrations } from "./migrations.js";
import type {
  VoiceTranscriptOriginal,
  VoiceTranscriptProvenance,
} from "../core/voice-provenance.js";

export type {
  WorkdayCommand,
  WorkdayView,
  WorkEpisodeView,
} from "../core/workday.js";

const { Pool } = pg;
const organizationId = siteConfiguration.institutionId;
const departmentId = siteConfiguration.department.id;
const sessionTtlMs = siteConfiguration.sessionTtlHours * 60 * 60_000;

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

function facilityDateKey(value = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: siteConfiguration.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

interface HandoverContentItem {
  patientId: string;
  title: string;
  reason: string;
  window: string;
  encounterId: string | null;
  currentImportant: string[];
  recentChanges: string[];
  openQuestions: string[];
}

export interface HandoverClinicalSnapshotItem {
  patientId: string;
  encounterId: string;
  currentImportant: string[];
  recentChanges: string[];
  openQuestions: string[];
}

function handoverContent(patientIds: readonly string[]): HandoverContentItem[] {
  return patientIds.map((patientId) => {
    const assignment = siteConfiguration.nursingAssignments.find(
      (item) => item.patientId === patientId,
    );
    return {
      patientId,
      title: assignment?.title ?? "Individueller Pflegeauftrag",
      reason: assignment?.reason ?? "Gemäss freigegebenem Pflegeplan",
      window: assignment?.window ?? "Im Schichtverlauf",
      encounterId: null,
      currentImportant: [],
      recentChanges: [],
      openQuestions: [],
    };
  });
}

function handoverSourceHash(input: {
  departmentId: string;
  shiftKey: string;
  actorId: string;
  content: readonly HandoverContentItem[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        organizationId,
        departmentId: input.departmentId,
        shiftKey: input.shiftKey,
        actorId: input.actorId,
        content: [...input.content]
          .sort((left, right) => left.patientId.localeCompare(right.patientId))
          .map((item) => [
            item.patientId,
            item.title,
            item.reason,
            item.window,
            item.encounterId,
            [...item.currentImportant],
            [...item.recentChanges],
            [...item.openQuestions],
          ]),
      }),
    )
    .digest("hex");
}

function workdayConfiguration(
  actorId: string,
  role: Role,
  sessionStartedAt?: string,
) {
  const assignment = siteConfiguration.staffAssignments.find(
    (candidate) => candidate.actorId === actorId && candidate.role === role,
  );
  if (!assignment)
    throw new DomainError(
      "AUTH_DENIED",
      "Für diese Identität und Rolle ist keine Schichtzuweisung konfiguriert.",
      403,
    );
  const shiftId = assignment.shiftId;
  const shift = siteConfiguration.shifts[shiftId]!;
  return {
    shiftId,
    shift,
    patientIds: assignment.patientIds,
    shiftKey: `${siteConfiguration.siteId}-${facilityDateKey(
      sessionStartedAt ? new Date(sessionStartedAt) : new Date(),
    )}-${shiftId}`,
  };
}

function optionalWorkdayConfiguration(actorId: string, role: Role) {
  const assignment = siteConfiguration.staffAssignments.find(
    (candidate) => candidate.actorId === actorId && candidate.role === role,
  );
  if (!assignment) return null;
  const shiftId = assignment.shiftId;
  const shift = siteConfiguration.shifts[shiftId]!;
  return {
    shiftId,
    shift,
    patientIds: assignment.patientIds,
    shiftKey: `${siteConfiguration.siteId}-${facilityDateKey()}-${shiftId}`,
  };
}

export interface StoredConversationTurn {
  id: string;
  prompt: string;
  response: unknown;
  createdAt: string;
  inputModality: "typed" | "voice";
  voiceTranscriptProvenance?: VoiceTranscriptProvenance[];
  originPatientId?: string | null;
  originEncounterId?: string | null;
  originThreadId?: string;
  originContextRevision?: number;
}

// Shared/team/direct channels are deliberately not represented until their
// membership and revocation ACLs are enforced on every read and write path.
export type ConversationType = "general-assistant" | "patient-assistant";

export interface ConversationDescriptor {
  id: string;
  type: ConversationType;
  title: string;
  patientId: string | null;
  encounterId: string | null;
  retentionClass:
    "shift-session" | "patient-record" | "department-record" | "direct-message";
  pinned: boolean;
  lastActivityAt: string;
  active: boolean;
}

function storedTurnPatientId(turn: StoredConversationTurn): string | null {
  if (turn.originPatientId !== undefined) return turn.originPatientId;
  if (!turn.response || typeof turn.response !== "object") return null;
  const patientContext = (turn.response as { patientContext?: unknown })
    .patientContext;
  if (!patientContext || typeof patientContext !== "object") return null;
  const patientId = (patientContext as { patientId?: unknown }).patientId;
  return typeof patientId === "string" ? patientId : null;
}

export interface DurableVoiceAuthority {
  clientContextId: string;
  actorId: string;
  patientId: string | null;
  encounterId: string | null;
  purpose: Purpose;
  original: VoiceTranscriptOriginal;
  sessionId: string;
  threadId: string;
  contextRevision: number;
  expiresAt: number;
}

export interface AcceptedCommandReceipt {
  id: string;
  statusCode: number;
  payload: unknown;
  replayed: boolean;
}

export interface LocalIntentAcceptance {
  tokenHash: string;
  clientContextId?: string;
  actorId: string;
  actorRole: Role;
  purpose: Purpose;
  patientId: string;
  encounterId: string;
  sessionId: string;
  threadId: string;
  contextRevision: number;
  resourceVersion: number;
  commandKey: string;
  requestHash: string;
  statusCode: number;
  resultPayload: unknown;
  selectedActionIds: string[];
  policyVersion: string;
  sourceReadSet: unknown[];
  auditEntries: AuditEntry[];
  clinicalResources: Resource[];
  removedReferences: string[];
  clinicalExpectedVersions: Record<string, string | null>;
  checkpoint: ServiceCheckpoint;
  episodeEvidence?: string;
  providerCommands: Array<{
    provider: ProviderOutboxJob["provider"];
    profile: ProviderProfile;
    command: CanonicalClinicalCommand;
    retrySafety: ProviderOutboxPayload["retrySafety"];
  }>;
}

export interface ClinicalProjectionJob {
  id: string;
  acceptedCommandId: string;
  idempotencyKey: string;
  resources: Resource[];
  removedReferences: string[];
  expectedVersions: Record<string, string | null>;
  checkpoint: ServiceCheckpoint;
  attempts: number;
}

export interface ManualClinicalProjectionHold {
  jobId: string;
  acceptedCommandId: string;
  errorCode: string;
  attempts: number;
  createdAt: string;
}

export interface ClinicalProjectionRecoveryReceipt {
  jobId: string;
  acceptedCommandId: string;
  previousErrorCode: string;
  state: "retry";
  replayed: boolean;
}

export interface DeliveryDiagnostics {
  acceptedCommands: Record<string, number>;
  clinicalProjections: Record<string, number>;
  providerDeliveries: Record<string, number>;
}

export interface WorkingSessionView {
  id: string;
  organizationId: string;
  departmentId: string;
  actorId: string;
  effectiveRole: Role;
  workflowTemplateId: string;
  workflowVersion: number;
  workflowName: string;
  definition: WorkflowDefinition;
  threadId: string;
  currentStepId: string;
  contextRevision: number;
  patientId: string | null;
  encounterId: string | null;
  rowVersion: number;
  status: "active" | "paused" | "completed";
  startedAt: string;
}

export interface AssistantContextBinding {
  clientContextId: string;
  sessionId: string;
  threadId: string;
  contextRevision: number;
  patientId: string | null;
  encounterId: string | null;
}

export interface DurableUiEvent {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface PendingIntentReview {
  record: DurableIntentRecord;
  reviewItems: Array<{ id: string; label: string; kind: string }>;
  responseId: string;
}

export interface OperationalStore {
  readonly mode: "in-memory" | "postgresql";
  initialize(): Promise<void>;
  getOrStartSession(actorId: string, role: Role): Promise<WorkingSessionView>;
  changePatientContext(
    actorId: string,
    role: Role,
    patientId: string | null,
    encounterId?: string | null,
  ): Promise<WorkingSessionView>;
  bindAssistantContext(
    actorId: string,
    role: Role,
    clientContextId: string,
    patientId: string | null,
    encounterId?: string | null,
  ): Promise<AssistantContextBinding>;
  resolveAssistantContext(
    actorId: string,
    role: Role,
    clientContextId: string,
  ): Promise<AssistantContextBinding | null>;
  advanceAssistantRevision(
    actorId: string,
    role: Role,
  ): Promise<WorkingSessionView>;
  loadConversation(
    actorId: string,
    role: Role,
    patientId?: string | null,
    context?: AssistantContextBinding,
  ): Promise<StoredConversationTurn[]>;
  loadPendingCarePlan(
    actorId: string,
    patientId: string,
    encounterId: string,
    threadId: string,
  ): Promise<string | null>;
  loadPendingIntentReview(
    actorId: string,
    patientId: string,
    encounterId: string,
    threadId: string,
  ): Promise<PendingIntentReview | null>;
  listConversations(
    actorId: string,
    role: Role,
  ): Promise<ConversationDescriptor[]>;
  appendConversationTurn(
    actorId: string,
    role: Role,
    turn: StoredConversationTurn,
    context?: AssistantContextBinding,
  ): Promise<void>;
  clearConversation(
    actorId: string,
    role: Role,
    context?: AssistantContextBinding,
  ): Promise<void>;
  getWorkday(actorId: string, role: Role): Promise<WorkdayView>;
  bindHandoverClinicalSnapshot(
    actorId: string,
    role: Role,
    handoverId: string,
    version: number,
    items: HandoverClinicalSnapshotItem[],
  ): Promise<WorkdayView>;
  applyWorkdayCommand(
    actorId: string,
    role: Role,
    command: WorkdayCommand,
  ): Promise<WorkdayView>;
  appendAudit(entry: AuditEntry): Promise<void>;
  appendUiInvalidation(
    actorId: string,
    payload: Record<string, unknown>,
  ): Promise<number>;
  listUiEventsAfter(
    actorId: string,
    afterId: number,
    limit?: number,
  ): Promise<DurableUiEvent[]>;
  storeIntentAuthority(input: {
    tokenHash: string;
    record: DurableIntentRecord;
    sessionId: string;
    threadId: string;
    contextRevision: number;
    responseId: string;
    reviewItems: unknown[];
    clientContextId?: string;
  }): Promise<void>;
  loadIntentAuthority(input: {
    tokenHash: string;
    actorId: string;
    sessionId: string;
    threadId: string;
    contextRevision: number;
    patientId: string;
    encounterId: string;
    clientContextId?: string;
  }): Promise<DurableIntentRecord | null>;
  consumeIntentAuthority(tokenHash: string): Promise<boolean>;
  acceptIntentCommand(
    input: LocalIntentAcceptance,
  ): Promise<AcceptedCommandReceipt>;
  loadAcceptedCommandReceipt(
    commandKey: string,
    requestHash: string,
  ): Promise<AcceptedCommandReceipt | null>;
  loadLatestAcceptedCheckpoint(): Promise<ServiceCheckpoint | null>;
  claimClinicalProjection(input: {
    workerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ClinicalProjectionJob | null>;
  finishClinicalProjection(input: {
    jobId: string;
    workerId: string;
  }): Promise<void>;
  failClinicalProjection(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    retryAt: Date | null;
  }): Promise<void>;
  manualClinicalProjectionHead(): Promise<ManualClinicalProjectionHold | null>;
  recoverManualClinicalProjection(input: {
    actorId: string;
    actorRole: Role;
    jobId: string;
    expectedErrorCode: string;
    commandKey: string;
    requestHash: string;
    auditEntry: AuditEntry;
  }): Promise<ClinicalProjectionRecoveryReceipt>;
  providerDeliveryState(
    patientIds: readonly string[],
  ): Promise<"pending" | "simulated-acknowledged" | "external-gated">;
  providerDeliverySummary(
    patientIds: readonly string[],
  ): Promise<{ unresolved: number; conflicts: number }>;
  deliveryDiagnostics(): Promise<DeliveryDiagnostics>;
  releaseIntentAuthority(tokenHash: string): Promise<void>;
  revokeResponseAuthorities(actorId: string, responseId: string): Promise<void>;
  suspendActorAuthorities(actorId: string): Promise<void>;
  suspendAssistantContextAuthorities(
    actorId: string,
    clientContextId: string,
  ): Promise<void>;
  revokeActorAuthorities(actorId: string): Promise<void>;
  storeVoiceAuthority(
    tokenHash: string,
    record: DurableVoiceAuthority,
  ): Promise<void>;
  loadVoiceAuthority(tokenHash: string): Promise<DurableVoiceAuthority | null>;
  consumeVoiceAuthority(tokenHash: string): Promise<boolean>;
  health(): Promise<boolean>;
  resetDemoState(): Promise<void>;
  close(): Promise<void>;
}

interface MemorySession extends WorkingSessionView {
  handoverId: string;
  acknowledgedPatientIds: string[];
  acknowledgedHandoverKey: string | null;
  handoverStatus: "open" | "transferred" | "acknowledged";
  receivingActorId: string | null;
  episodes: WorkEpisodeView[];
}

export class InMemoryOperationalStore implements OperationalStore {
  readonly mode = "in-memory" as const;
  private readonly sessions = new Map<string, MemorySession>();
  private readonly memoryThreads = new Map<
    string,
    ConversationDescriptor & {
      actorId: string;
      contextRevision: number;
      turns: StoredConversationTurn[];
    }
  >();
  private readonly clientContexts = new Map<
    string,
    AssistantContextBinding & { actorId: string; role: Role }
  >();
  private readonly transfers: ResponsibilityTransferView[] = [];
  private readonly uiEvents: Array<DurableUiEvent & { actorId: string }> = [];
  private readonly handoverClinical = new Map<
    string,
    HandoverClinicalSnapshotItem[]
  >();
  private readonly authorities = new Map<
    string,
    {
      record: DurableIntentRecord;
      sessionId: string;
      threadId: string;
      contextRevision: number;
      responseId: string;
      reviewItems: Array<{ id: string; label: string; kind: string }>;
      clientContextId: string | null;
      consumed: boolean;
    }
  >();
  private readonly voiceAuthorities = new Map<
    string,
    { record: DurableVoiceAuthority; consumed: boolean }
  >();
  private readonly acceptedCommands = new Map<
    string,
    { requestHash: string; receipt: AcceptedCommandReceipt }
  >();
  private readonly clinicalProjectionJobs: Array<
    ClinicalProjectionJob & {
      state: "pending" | "leased" | "delivered" | "retry" | "manual";
      leaseOwner: string | null;
      lastErrorCode: string | null;
      createdAt: string;
    }
  > = [];
  initialize(): Promise<void> {
    return Promise.resolve();
  }
  getOrStartSession(actorId: string, role: Role): Promise<WorkingSessionView> {
    let session = this.sessions.get(actorId);
    if (!session) {
      const workflow = workflowForRole(role);
      session = {
        id: randomUUID(),
        organizationId,
        departmentId,
        actorId,
        effectiveRole: role,
        workflowTemplateId: workflow.id,
        workflowVersion: workflow.version,
        workflowName: workflow.name,
        definition: workflow.definition,
        threadId: randomUUID(),
        currentStepId: workflow.definition.steps[0]!.id,
        contextRevision: 0,
        patientId: null,
        encounterId: null,
        rowVersion: 1,
        status: "active",
        startedAt: new Date().toISOString(),
        handoverId: randomUUID(),
        acknowledgedPatientIds: [],
        acknowledgedHandoverKey: null,
        handoverStatus: "open",
        receivingActorId: null,
        episodes: [],
      };
      this.sessions.set(actorId, session);
      this.memoryThreads.set(session.threadId, {
        id: session.threadId,
        type: "general-assistant",
        title: "Mein Assistent",
        patientId: null,
        encounterId: null,
        retentionClass: "shift-session",
        pinned: true,
        lastActivityAt: session.startedAt,
        active: true,
        actorId,
        contextRevision: 0,
        turns: [],
      });
    }
    return Promise.resolve(structuredClone(session));
  }
  async changePatientContext(
    actorId: string,
    role: Role,
    patientId: string | null,
    encounterId: string | null = null,
  ): Promise<WorkingSessionView> {
    if (patientId && !encounterId)
      throw new Error("PATIENT_ENCOUNTER_REQUIRED");
    const session =
      this.sessions.get(actorId) ??
      ((await this.getOrStartSession(actorId, role)) as MemorySession);
    const stored = this.sessions.get(actorId) ?? session;
    const previous = this.memoryThreads.get(stored.threadId);
    if (previous) previous.active = false;
    let thread = [...this.memoryThreads.values()].find(
      (candidate) =>
        candidate.actorId === actorId &&
        candidate.type ===
          (patientId ? "patient-assistant" : "general-assistant") &&
        candidate.patientId === patientId &&
        candidate.encounterId === (patientId ? encounterId : null),
    );
    if (!thread) {
      const id = randomUUID();
      thread = {
        id,
        type: patientId ? "patient-assistant" : "general-assistant",
        title: patientId ? "Patientengespräch" : "Mein Assistent",
        patientId,
        encounterId: patientId ? encounterId : null,
        retentionClass: patientId ? "patient-record" : "shift-session",
        pinned: patientId === null,
        lastActivityAt: new Date().toISOString(),
        active: true,
        actorId,
        contextRevision: 0,
        turns: [],
      };
      this.memoryThreads.set(id, thread);
    }
    thread.active = true;
    thread.contextRevision += 1;
    thread.lastActivityAt = new Date().toISOString();
    stored.threadId = thread.id;
    stored.patientId = thread.patientId;
    stored.encounterId = thread.encounterId;
    stored.contextRevision = thread.contextRevision;
    stored.rowVersion += 1;
    return structuredClone(stored);
  }
  async bindAssistantContext(
    actorId: string,
    role: Role,
    clientContextId: string,
    patientId: string | null,
    encounterId: string | null = null,
  ): Promise<AssistantContextBinding> {
    const session = await this.changePatientContext(
      actorId,
      role,
      patientId,
      encounterId,
    );
    const prior = this.clientContexts.get(clientContextId);
    if (prior && (prior.actorId !== actorId || prior.role !== role))
      throw new DomainError(
        "AUTH_DENIED",
        "Browserkontext gehört nicht zu dieser Mitarbeitenden-Sitzung.",
        403,
      );
    const binding: AssistantContextBinding & { actorId: string; role: Role } = {
      clientContextId,
      actorId,
      role,
      sessionId: session.id,
      threadId: session.threadId,
      contextRevision: (prior?.contextRevision ?? 0) + 1,
      patientId,
      encounterId: patientId ? encounterId : null,
    };
    this.clientContexts.set(clientContextId, binding);
    return structuredClone(binding);
  }
  resolveAssistantContext(
    actorId: string,
    role: Role,
    clientContextId: string,
  ): Promise<AssistantContextBinding | null> {
    const context = this.clientContexts.get(clientContextId);
    const session = this.sessions.get(actorId);
    const thread = context
      ? this.memoryThreads.get(context.threadId)
      : undefined;
    if (
      !context ||
      !session ||
      !thread ||
      context.actorId !== actorId ||
      context.role !== role ||
      context.sessionId !== session.id ||
      thread.actorId !== actorId ||
      thread.patientId !== context.patientId ||
      thread.encounterId !== context.encounterId
    )
      return Promise.resolve(null);
    return Promise.resolve(structuredClone(context));
  }
  async advanceAssistantRevision(
    actorId: string,
    role: Role,
  ): Promise<WorkingSessionView> {
    const session =
      this.sessions.get(actorId) ??
      ((await this.getOrStartSession(actorId, role)) as MemorySession);
    const thread = this.memoryThreads.get(session.threadId);
    if (!thread) throw new Error("ASSISTANT_THREAD_NOT_FOUND");
    thread.contextRevision += 1;
    thread.lastActivityAt = new Date().toISOString();
    session.contextRevision = thread.contextRevision;
    session.rowVersion += 1;
    return structuredClone(session);
  }
  async loadConversation(
    actorId: string,
    role: Role,
    patientId?: string | null,
    context?: AssistantContextBinding,
  ): Promise<StoredConversationTurn[]> {
    const session =
      this.sessions.get(actorId) ??
      ((await this.getOrStartSession(actorId, role)) as MemorySession);
    if (
      context &&
      !(await this.resolveAssistantContext(
        actorId,
        role,
        context.clientContextId,
      ))
    )
      throw new Error("ASSISTANT_CONTEXT_STALE");
    const turns =
      this.memoryThreads.get(context?.threadId ?? session.threadId)?.turns ??
      [];
    return structuredClone(
      patientId === undefined
        ? turns
        : turns.filter((turn) => storedTurnPatientId(turn) === patientId),
    );
  }
  loadPendingCarePlan(
    actorId: string,
    patientId: string,
    encounterId: string,
    threadId: string,
  ): Promise<string | null> {
    const candidates = [...this.authorities.values()].filter(
      ({ record, consumed }) =>
        !consumed &&
        record.actorId === actorId &&
        record.patientId === patientId &&
        record.encounterId === encounterId &&
        record.command === "care-update:draft" &&
        this.memoryThreads.get(threadId)?.actorId === actorId,
    );
    return Promise.resolve(candidates.at(-1)?.record.payload.plan ?? null);
  }
  loadPendingIntentReview(
    actorId: string,
    patientId: string,
    encounterId: string,
    threadId: string,
  ): Promise<PendingIntentReview | null> {
    const pending = [...this.authorities.values()].findLast(
      ({ record, consumed, threadId: authorityThreadId }) =>
        !consumed &&
        record.actorId === actorId &&
        record.patientId === patientId &&
        record.encounterId === encounterId &&
        authorityThreadId === threadId,
    );
    return Promise.resolve(
      pending
        ? structuredClone({
            record: pending.record,
            reviewItems: pending.reviewItems,
            responseId: pending.responseId,
          })
        : null,
    );
  }
  async appendConversationTurn(
    actorId: string,
    role: Role,
    turn: StoredConversationTurn,
    context?: AssistantContextBinding,
  ): Promise<void> {
    await this.getOrStartSession(actorId, role);
    const session = this.sessions.get(actorId)!;
    if (
      context &&
      !(await this.resolveAssistantContext(
        actorId,
        role,
        context.clientContextId,
      ))
    )
      throw new Error("ASSISTANT_CONTEXT_STALE");
    const thread = this.memoryThreads.get(
      context?.threadId ?? turn.originThreadId ?? session.threadId,
    );
    if (!thread) throw new Error("ASSISTANT_THREAD_NOT_FOUND");
    if (
      thread.actorId !== actorId ||
      (turn.originPatientId !== undefined &&
        thread.patientId !== turn.originPatientId) ||
      (turn.originEncounterId !== undefined &&
        thread.encounterId !== turn.originEncounterId) ||
      (!context &&
        turn.originContextRevision !== undefined &&
        thread.contextRevision !== turn.originContextRevision) ||
      (context !== undefined &&
        (turn.originThreadId !== context.threadId ||
          turn.originPatientId !== context.patientId ||
          turn.originEncounterId !== context.encounterId ||
          turn.originContextRevision !== context.contextRevision))
    )
      throw new Error("ASSISTANT_CONTEXT_STALE");
    thread.turns = [...thread.turns, structuredClone(turn)].slice(-80);
    thread.lastActivityAt = new Date().toISOString();
  }
  async listConversations(
    actorId: string,
    role: Role,
  ): Promise<ConversationDescriptor[]> {
    const session = await this.getOrStartSession(actorId, role);
    return [...this.memoryThreads.values()]
      .filter((thread) => thread.actorId === actorId)
      .toSorted((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
      .map((thread) => ({
        id: thread.id,
        type: thread.type,
        title: thread.title,
        patientId: thread.patientId,
        encounterId: thread.encounterId,
        retentionClass: thread.retentionClass,
        pinned: thread.pinned,
        lastActivityAt: thread.lastActivityAt,
        active: thread.id === session.threadId,
      }));
  }
  async clearConversation(
    actorId: string,
    role: Role,
    context?: AssistantContextBinding,
  ): Promise<void> {
    await this.getOrStartSession(actorId, role);
    const session = this.sessions.get(actorId)!;
    const thread = this.memoryThreads.get(
      context?.threadId ?? session.threadId,
    );
    if (thread) {
      if (context) {
        const nextThreadId = randomUUID();
        this.memoryThreads.set(nextThreadId, {
          ...structuredClone(thread),
          id: nextThreadId,
          turns: [],
          contextRevision: 0,
          lastActivityAt: new Date().toISOString(),
        });
        const storedContext = this.clientContexts.get(context.clientContextId);
        if (storedContext) {
          storedContext.threadId = nextThreadId;
          storedContext.contextRevision += 1;
        }
        session.threadId = nextThreadId;
      } else {
        thread.turns = [];
        thread.lastActivityAt = new Date().toISOString();
      }
    }
  }
  async getWorkday(actorId: string, role: Role): Promise<WorkdayView> {
    await this.getOrStartSession(actorId, role);
    const session = this.sessions.get(actorId)!;
    return memoryWorkdayView(
      session,
      this.transfers,
      this.receivedMemoryHandover(actorId) ?? session,
      this.handoverClinical.get(
        (this.receivedMemoryHandover(actorId) ?? session).handoverId,
      ),
    );
  }
  async bindHandoverClinicalSnapshot(
    actorId: string,
    role: Role,
    handoverId: string,
    version: number,
    items: HandoverClinicalSnapshotItem[],
  ): Promise<WorkdayView> {
    const workday = await this.getWorkday(actorId, role);
    if (workday.handover.id !== handoverId)
      throw new Error("HANDOVER_VERSION_STALE");
    if (!workday.handover.clinicalBound) {
      if (workday.handover.version !== version)
        throw new Error("HANDOVER_VERSION_STALE");
      const expected = new Set(workday.handover.patientIds);
      if (
        items.length !== expected.size ||
        items.some(
          (item) =>
            !expected.has(item.patientId) ||
            !item.encounterId ||
            items.filter((candidate) => candidate.patientId === item.patientId)
              .length !== 1,
        )
      )
        throw new Error("HANDOVER_CONTENT_MISMATCH");
      this.handoverClinical.set(handoverId, structuredClone(items));
    }
    return this.getWorkday(actorId, role);
  }
  async applyWorkdayCommand(
    actorId: string,
    role: Role,
    command: WorkdayCommand,
  ): Promise<WorkdayView> {
    await this.getOrStartSession(actorId, role);
    const session = this.sessions.get(actorId)!;
    const configuredWorkday = workdayConfiguration(
      actorId,
      role,
      session.startedAt,
    );
    if (session.status === "completed") throw new Error("SHIFT_ALREADY_CLOSED");
    if (command.type === "acknowledge-handover") {
      const handover = [...this.sessions.values()].find(
        (candidate) => candidate.handoverId === command.handoverId,
      );
      const handoverVersion = this.handoverClinical.has(command.handoverId)
        ? 2
        : 1;
      if (
        !handover ||
        (handover.actorId !== actorId &&
          handover.receivingActorId !== actorId) ||
        command.version !== handoverVersion ||
        !workdayConfiguration(
          handover.actorId,
          handover.effectiveRole,
          handover.startedAt,
        ).patientIds.includes(command.patientId)
      )
        throw new Error("HANDOVER_VERSION_STALE");
      const acknowledgementKey = `${command.handoverId}:${command.version}`;
      if (session.acknowledgedHandoverKey !== acknowledgementKey) {
        session.acknowledgedHandoverKey = acknowledgementKey;
        session.acknowledgedPatientIds = [];
      }
      if (!session.acknowledgedPatientIds.includes(command.patientId))
        session.acknowledgedPatientIds.push(command.patientId);
      if (
        session.acknowledgedPatientIds.length ===
        configuredWorkday.patientIds.length
      ) {
        session.currentStepId = "prioritize";
        if (handover.receivingActorId === actorId)
          handover.handoverStatus = "acknowledged";
      }
    } else if (command.type === "start-episode") {
      if (command.kind === "planned") {
        const handover = this.receivedMemoryHandover(actorId) ?? session;
        const handoverVersion = this.handoverClinical.has(handover.handoverId)
          ? 2
          : 1;
        if (
          session.acknowledgedHandoverKey !==
          `${handover.handoverId}:${handoverVersion}`
        )
          throw new Error("HANDOVER_ACKNOWLEDGEMENT_REQUIRED");
        const assignedPatientIds = workdayConfiguration(
          handover.actorId,
          handover.effectiveRole,
          handover.startedAt,
        ).patientIds;
        if (
          !assignedPatientIds.every((patientId) =>
            session.acknowledgedPatientIds.includes(patientId),
          )
        )
          throw new Error("HANDOVER_ACKNOWLEDGEMENT_REQUIRED");
      }
      if (session.episodes.some((episode) => episode.state === "active"))
        throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
      if (
        command.kind === "planned" &&
        session.episodes.some(
          (episode) =>
            episode.kind === "planned" &&
            episode.patientId === command.patientId,
        )
      )
        throw new Error("PLANNED_EPISODE_ALREADY_EXISTS");
      const assignment =
        command.kind === "planned" &&
        configuredWorkday.patientIds.includes(command.patientId)
          ? siteConfiguration.nursingAssignments.find(
              (item) => item.patientId === command.patientId,
            )
          : null;
      if (command.kind === "planned" && !assignment)
        throw new Error("PLANNED_ASSIGNMENT_NOT_FOUND");
      session.episodes.push({
        id: randomUUID(),
        patientId: command.patientId,
        encounterId: command.encounterId,
        kind: command.kind,
        title: assignment?.title ?? command.title,
        state: "active",
        startedAt: new Date().toISOString(),
        completedAt: null,
        draftText: "",
        completionEvidence: null,
      });
      session.currentStepId = "work";
      await this.changePatientContext(
        actorId,
        role,
        command.patientId,
        command.encounterId,
      );
    } else if (command.type === "interrupt-and-start") {
      const active = session.episodes.find(
        (episode) =>
          episode.id === command.episodeId && episode.state === "active",
      );
      if (!active) throw new Error("EPISODE_STATE_CONFLICT");
      active.state = "paused";
      active.draftText = command.pausedDraftText?.slice(0, 1200) ?? "";
      session.episodes.push({
        id: randomUUID(),
        patientId: command.patientId,
        encounterId: command.encounterId,
        kind: "spontaneous",
        title: command.title,
        state: "active",
        startedAt: new Date().toISOString(),
        completedAt: null,
        draftText: "",
        completionEvidence: null,
      });
      session.currentStepId = "work";
      await this.changePatientContext(
        actorId,
        role,
        command.patientId,
        command.encounterId,
      );
    } else {
      const episode = [
        "close-shift",
        "defer-responsibility",
        "acknowledge-transfer",
      ].includes(command.type)
        ? null
        : session.episodes.find(
            (item) =>
              item.id ===
              (command as Extract<WorkdayCommand, { episodeId: string }>)
                .episodeId,
          );
      if (
        ![
          "close-shift",
          "defer-responsibility",
          "acknowledge-transfer",
        ].includes(command.type) &&
        !episode
      )
        throw new Error("EPISODE_NOT_FOUND");
      if (command.type === "pause-episode" && episode) {
        if (episode.state !== "active")
          throw new Error("EPISODE_STATE_CONFLICT");
        episode.state = "paused";
        if (command.draftText !== undefined)
          episode.draftText = command.draftText.slice(0, 1200);
      }
      if (command.type === "resume-episode" && episode) {
        if (episode.state !== "paused")
          throw new Error("EPISODE_STATE_CONFLICT");
        if (session.episodes.some((item) => item.state === "active"))
          throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        episode.state = "active";
        await this.changePatientContext(
          actorId,
          role,
          episode.patientId,
          episode.encounterId,
        );
      }
      if (
        command.type === "save-episode-draft" &&
        episode &&
        !["active", "paused"].includes(episode.state)
      )
        throw new Error("EPISODE_STATE_CONFLICT");
      if (command.type === "save-episode-draft" && episode)
        episode.draftText = command.draftText.slice(0, 1200);
      if (command.type === "defer-responsibility") {
        const existing = session.episodes.find(
          (item) =>
            item.patientId === command.patientId && item.kind === "planned",
        );
        if (existing?.state === "completed")
          throw new Error("RESPONSIBILITY_ALREADY_COMPLETED");
        if (existing) {
          existing.state = "deferred";
          existing.completedAt = new Date().toISOString();
        } else {
          const assignment = siteConfiguration.nursingAssignments.find(
            (item) => item.patientId === command.patientId,
          );
          if (!assignment) throw new Error("PLANNED_ASSIGNMENT_NOT_FOUND");
          session.episodes.push({
            id: randomUUID(),
            patientId: command.patientId,
            encounterId: command.encounterId,
            kind: "planned",
            title: assignment.title,
            state: "deferred",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            draftText: "",
            completionEvidence: null,
          });
        }
        if (
          !this.transfers.some(
            (item) =>
              item.fromActorId === actorId &&
              item.patientId === command.patientId &&
              item.state === "pending",
          )
        )
          this.transfers.push({
            id: randomUUID(),
            patientId: command.patientId,
            fromActorId: actorId,
            toActorId: command.receivingActorId,
            reason: command.reason,
            state: "pending",
            createdAt: new Date().toISOString(),
            acknowledgedAt: null,
          });
      }
      if (command.type === "acknowledge-transfer") {
        const transfer = this.transfers.find(
          (item) =>
            item.id === command.transferId && item.toActorId === actorId,
        );
        if (!transfer) throw new Error("TRANSFER_NOT_FOUND");
        transfer.state = "acknowledged";
        transfer.acknowledgedAt = new Date().toISOString();
      }
      if (command.type === "complete-episode" && episode) {
        if (episode.state !== "active")
          throw new Error("EPISODE_STATE_CONFLICT");
        if (command.evidence.trim().length < 10)
          throw new Error("COMPLETION_EVIDENCE_REQUIRED");
        episode.state = "completed";
        episode.completedAt = new Date().toISOString();
        episode.completionEvidence = command.evidence.trim();
        episode.draftText = "";
      }
      if (command.type === "close-shift") {
        if (session.episodes.some((item) => item.state === "active"))
          throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        if (session.episodes.some((item) => item.state === "paused"))
          throw new Error("PAUSED_EPISODE_REQUIRES_RESOLUTION");
        const unresolvedPatients = configuredWorkday.patientIds.filter(
          (patientId) =>
            !session.episodes.some(
              (item) =>
                item.patientId === patientId &&
                item.kind === "planned" &&
                ["completed", "deferred"].includes(item.state),
            ),
        );
        if (unresolvedPatients.length > 0)
          throw new Error("PLANNED_RESPONSIBILITY_REQUIRES_RESOLUTION");
        session.handoverStatus = "transferred";
        session.receivingActorId =
          configuredWorkday.shift.nextResponsibleActorId;
        session.currentStepId = "complete";
        session.status = "completed";
      }
    }
    session.rowVersion += 1;
    return memoryWorkdayView(
      session,
      this.transfers,
      this.receivedMemoryHandover(actorId) ?? session,
      this.handoverClinical.get(
        (this.receivedMemoryHandover(actorId) ?? session).handoverId,
      ),
    );
  }
  private receivedMemoryHandover(actorId: string): MemorySession | undefined {
    return [...this.sessions.values()]
      .filter(
        (candidate) =>
          candidate.receivingActorId === actorId &&
          ["transferred", "acknowledged"].includes(candidate.handoverStatus),
      )
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  }
  appendAudit(entry: AuditEntry): Promise<void> {
    void entry;
    return Promise.resolve();
  }
  appendUiInvalidation(
    actorId: string,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const id = (this.uiEvents.at(-1)?.id ?? 0) + 1;
    this.uiEvents.push({
      id,
      actorId,
      eventType: "snapshot-invalidated",
      payload: structuredClone(payload),
      occurredAt: new Date().toISOString(),
    });
    return Promise.resolve(id);
  }
  listUiEventsAfter(
    actorId: string,
    afterId: number,
    limit = 100,
  ): Promise<DurableUiEvent[]> {
    return Promise.resolve(
      this.uiEvents
        .filter((event) => event.actorId === actorId && event.id > afterId)
        .slice(0, limit)
        .map(({ id, eventType, payload, occurredAt }) =>
          structuredClone({ id, eventType, payload, occurredAt }),
        ),
    );
  }
  storeIntentAuthority(input: {
    tokenHash: string;
    record: DurableIntentRecord;
    sessionId: string;
    threadId: string;
    contextRevision: number;
    responseId: string;
    reviewItems: unknown[];
    clientContextId?: string;
  }): Promise<void> {
    const session = this.sessions.get(input.record.actorId);
    const thread = this.memoryThreads.get(input.threadId);
    const clientContext = input.clientContextId
      ? this.clientContexts.get(input.clientContextId)
      : null;
    if (
      !session ||
      !thread ||
      session.id !== input.sessionId ||
      session.status !== "active" ||
      thread.type !== "patient-assistant" ||
      thread.patientId !== input.record.patientId ||
      thread.encounterId !== input.record.encounterId ||
      (clientContext
        ? clientContext.actorId !== input.record.actorId ||
          clientContext.sessionId !== input.sessionId ||
          clientContext.threadId !== input.threadId ||
          clientContext.contextRevision !== input.contextRevision
        : session.threadId !== input.threadId ||
          thread.contextRevision !== input.contextRevision)
    )
      return Promise.reject(new Error("ASSISTANT_CONTEXT_STALE"));
    for (const authority of this.authorities.values())
      if (
        !authority.consumed &&
        authority.record.actorId === input.record.actorId &&
        authority.threadId === input.threadId &&
        authority.record.patientId === input.record.patientId &&
        authority.record.encounterId === input.record.encounterId &&
        authority.responseId !== input.responseId
      )
        authority.consumed = true;
    if (!this.authorities.has(input.tokenHash))
      this.authorities.set(input.tokenHash, {
        record: structuredClone(input.record),
        sessionId: input.sessionId,
        threadId: input.threadId,
        contextRevision: input.contextRevision,
        responseId: input.responseId,
        reviewItems: input.reviewItems as Array<{
          id: string;
          label: string;
          kind: string;
        }>,
        clientContextId: input.clientContextId ?? null,
        consumed: false,
      });
    return Promise.resolve();
  }
  loadIntentAuthority(input: {
    tokenHash: string;
    actorId: string;
    sessionId: string;
    threadId: string;
    contextRevision: number;
    patientId: string;
    encounterId: string;
    clientContextId?: string;
  }): Promise<DurableIntentRecord | null> {
    const authority = this.authorities.get(input.tokenHash);
    if (
      !authority ||
      authority.consumed ||
      authority.record.expiresAt < Date.now() ||
      authority.record.actorId !== input.actorId ||
      authority.record.patientId !== input.patientId ||
      authority.record.encounterId !== input.encounterId ||
      authority.sessionId !== input.sessionId ||
      authority.threadId !== input.threadId ||
      authority.contextRevision !== input.contextRevision ||
      (input.clientContextId !== undefined &&
        authority.clientContextId !== input.clientContextId)
    )
      return Promise.resolve(null);
    return Promise.resolve(structuredClone(authority.record));
  }
  consumeIntentAuthority(tokenHash: string): Promise<boolean> {
    const authority = this.authorities.get(tokenHash);
    if (!authority || authority.consumed) return Promise.resolve(false);
    for (const candidate of this.authorities.values())
      if (
        candidate.record.actorId === authority.record.actorId &&
        candidate.threadId === authority.threadId &&
        candidate.responseId === authority.responseId
      )
        candidate.consumed = true;
    return Promise.resolve(true);
  }
  acceptIntentCommand(
    input: LocalIntentAcceptance,
  ): Promise<AcceptedCommandReceipt> {
    const prior = this.acceptedCommands.get(input.commandKey);
    if (prior) {
      if (prior.requestHash !== input.requestHash)
        return Promise.reject(new Error("COMMAND_ID_PAYLOAD_MISMATCH"));
      return Promise.resolve({
        ...structuredClone(prior.receipt),
        replayed: true,
      });
    }
    const authority = this.authorities.get(input.tokenHash);
    if (
      !authority ||
      authority.consumed ||
      authority.record.expiresAt < Date.now() ||
      authority.record.actorId !== input.actorId ||
      authority.record.patientId !== input.patientId ||
      authority.record.encounterId !== input.encounterId ||
      authority.sessionId !== input.sessionId ||
      authority.threadId !== input.threadId ||
      authority.contextRevision !== input.contextRevision ||
      (input.clientContextId !== undefined
        ? authority.clientContextId !== input.clientContextId
        : authority.clientContextId !== null)
    )
      return Promise.reject(new Error("INTENT_AUTHORITY_INVALID"));
    for (const candidate of this.authorities.values())
      if (
        candidate.record.actorId === authority.record.actorId &&
        candidate.threadId === authority.threadId &&
        candidate.responseId === authority.responseId
      )
        candidate.consumed = true;
    const receipt: AcceptedCommandReceipt = {
      id: randomUUID(),
      statusCode: input.statusCode,
      payload: structuredClone(input.resultPayload),
      replayed: false,
    };
    this.acceptedCommands.set(input.commandKey, {
      requestHash: input.requestHash,
      receipt,
    });
    this.clinicalProjectionJobs.push({
      id: randomUUID(),
      acceptedCommandId: receipt.id,
      idempotencyKey: `clinical:${receipt.id}`,
      resources: structuredClone(input.clinicalResources),
      removedReferences: [...input.removedReferences],
      expectedVersions: structuredClone(input.clinicalExpectedVersions),
      checkpoint: structuredClone(input.checkpoint),
      attempts: 0,
      state: "pending",
      leaseOwner: null,
      lastErrorCode: null,
      createdAt: new Date().toISOString(),
    });
    return Promise.resolve(structuredClone(receipt));
  }
  loadAcceptedCommandReceipt(
    commandKey: string,
    requestHash: string,
  ): Promise<AcceptedCommandReceipt | null> {
    const prior = this.acceptedCommands.get(commandKey);
    if (!prior) return Promise.resolve(null);
    if (prior.requestHash !== requestHash)
      return Promise.reject(new Error("COMMAND_ID_PAYLOAD_MISMATCH"));
    return Promise.resolve({
      ...structuredClone(prior.receipt),
      replayed: true,
    });
  }
  loadLatestAcceptedCheckpoint(): Promise<ServiceCheckpoint | null> {
    const latest = this.clinicalProjectionJobs.at(-1);
    return Promise.resolve(latest ? structuredClone(latest.checkpoint) : null);
  }
  claimClinicalProjection(input: {
    workerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ClinicalProjectionJob | null> {
    void input.leaseDurationMs;
    void input.now;
    const job = this.clinicalProjectionJobs.find(
      (candidate) => candidate.state !== "delivered",
    );
    // Checkpoints are whole-state recovery artifacts. Never project a newer
    // checkpoint around an older retry/manual hold and later let the older
    // checkpoint overwrite it.
    if (!job || !["pending", "retry"].includes(job.state))
      return Promise.resolve(null);
    job.state = "leased";
    job.leaseOwner = input.workerId;
    job.lastErrorCode = null;
    job.attempts += 1;
    return Promise.resolve(structuredClone(job));
  }
  finishClinicalProjection(input: {
    jobId: string;
    workerId: string;
  }): Promise<void> {
    const job = this.clinicalProjectionJobs.find(
      (candidate) =>
        candidate.id === input.jobId && candidate.leaseOwner === input.workerId,
    );
    if (!job)
      return Promise.reject(new Error("CLINICAL_PROJECTION_LEASE_LOST"));
    job.state = "delivered";
    job.leaseOwner = null;
    return Promise.resolve();
  }
  failClinicalProjection(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    retryAt: Date | null;
  }): Promise<void> {
    const job = this.clinicalProjectionJobs.find(
      (candidate) =>
        candidate.id === input.jobId && candidate.leaseOwner === input.workerId,
    );
    if (!job)
      return Promise.reject(new Error("CLINICAL_PROJECTION_LEASE_LOST"));
    job.state = input.retryAt ? "retry" : "manual";
    job.leaseOwner = null;
    job.lastErrorCode = input.errorCode;
    return Promise.resolve();
  }
  manualClinicalProjectionHead(): Promise<ManualClinicalProjectionHold | null> {
    const head = this.clinicalProjectionJobs.find(
      (candidate) => candidate.state !== "delivered",
    );
    if (head?.state !== "manual" || !head.lastErrorCode)
      return Promise.resolve(null);
    return Promise.resolve({
      jobId: head.id,
      acceptedCommandId: head.acceptedCommandId,
      errorCode: head.lastErrorCode,
      attempts: head.attempts,
      createdAt: head.createdAt,
    });
  }
  recoverManualClinicalProjection(input: {
    actorId: string;
    actorRole: Role;
    jobId: string;
    expectedErrorCode: string;
    commandKey: string;
    requestHash: string;
    auditEntry: AuditEntry;
  }): Promise<ClinicalProjectionRecoveryReceipt> {
    if (input.actorRole !== "it")
      return Promise.reject(
        new DomainError(
          "AUTH_DENIED",
          "Nur IT darf eine klinische Projektion erneut einreihen.",
          403,
        ),
      );
    if (
      input.auditEntry.actorId !== input.actorId ||
      input.auditEntry.actorRole !== input.actorRole ||
      input.auditEntry.action !== "clinical-projection:retry" ||
      input.auditEntry.purpose !== "operations" ||
      input.auditEntry.outcome !== "success"
    )
      return Promise.reject(
        new DomainError(
          "AUTH_DENIED",
          "Der Betriebsnachweis ist nicht an diese Freigabe gebunden.",
          403,
        ),
      );
    const prior = this.acceptedCommands.get(input.commandKey);
    if (prior) {
      if (prior.requestHash !== input.requestHash)
        return Promise.reject(
          new DomainError(
            "INVALID_STATE",
            "Befehls-ID wurde bereits mit einem anderen Inhalt verwendet.",
            409,
          ),
        );
      return Promise.resolve({
        ...(structuredClone(
          prior.receipt.payload,
        ) as ClinicalProjectionRecoveryReceipt),
        replayed: true,
      });
    }
    const head = this.clinicalProjectionJobs.find(
      (candidate) => candidate.state !== "delivered",
    );
    if (
      !head ||
      head.id !== input.jobId ||
      head.state !== "manual" ||
      head.lastErrorCode !== input.expectedErrorCode
    )
      return Promise.reject(
        new DomainError(
          "INVALID_STATE",
          "Projektionsauftrag oder Fehlerstand hat sich geändert.",
          409,
        ),
      );
    const result: ClinicalProjectionRecoveryReceipt = {
      jobId: head.id,
      acceptedCommandId: head.acceptedCommandId,
      previousErrorCode: head.lastErrorCode,
      state: "retry",
      replayed: false,
    };
    head.state = "retry";
    head.leaseOwner = null;
    this.acceptedCommands.set(input.commandKey, {
      requestHash: input.requestHash,
      receipt: {
        id: randomUUID(),
        statusCode: 200,
        payload: structuredClone(result),
        replayed: false,
      },
    });
    const id = (this.uiEvents.at(-1)?.id ?? 0) + 1;
    this.uiEvents.push({
      id,
      actorId: input.actorId,
      eventType: "ClinicalProjectionRetryAuthorized",
      payload: {
        jobId: head.id,
        acceptedCommandId: head.acceptedCommandId,
        previousErrorCode: head.lastErrorCode,
        auditEntryHash: input.auditEntry.hash,
      },
      occurredAt: new Date().toISOString(),
    });
    return Promise.resolve(structuredClone(result));
  }
  providerDeliveryState(): Promise<"external-gated"> {
    return Promise.resolve("external-gated");
  }
  providerDeliverySummary(): Promise<{
    unresolved: number;
    conflicts: number;
  }> {
    return Promise.resolve({ unresolved: 0, conflicts: 0 });
  }
  deliveryDiagnostics(): Promise<DeliveryDiagnostics> {
    return Promise.resolve({
      acceptedCommands: {},
      clinicalProjections: {},
      providerDeliveries: {},
    });
  }
  releaseIntentAuthority(tokenHash: string): Promise<void> {
    const authority = this.authorities.get(tokenHash);
    if (authority && authority.record.expiresAt >= Date.now())
      authority.consumed = false;
    return Promise.resolve();
  }
  revokeResponseAuthorities(
    actorId: string,
    responseId: string,
  ): Promise<void> {
    for (const authority of this.authorities.values())
      if (
        authority.record.actorId === actorId &&
        authority.responseId === responseId
      )
        authority.consumed = true;
    return Promise.resolve();
  }
  suspendActorAuthorities(actorId: string): Promise<void> {
    for (const authority of this.voiceAuthorities.values())
      if (authority.record.actorId === actorId) authority.consumed = true;
    return Promise.resolve();
  }
  suspendAssistantContextAuthorities(
    actorId: string,
    clientContextId: string,
  ): Promise<void> {
    // Intent payload remains as a suspended draft. The changed client binding
    // makes its old token unusable; returning to the thread can reissue it.
    for (const authority of this.voiceAuthorities.values())
      if (
        authority.record.actorId === actorId &&
        authority.record.clientContextId === clientContextId
      )
        authority.consumed = true;
    return Promise.resolve();
  }
  revokeActorAuthorities(actorId: string): Promise<void> {
    for (const authority of this.authorities.values()) {
      if (authority.record.actorId === actorId) authority.consumed = true;
    }
    for (const authority of this.voiceAuthorities.values()) {
      if (authority.record.actorId === actorId) authority.consumed = true;
    }
    return Promise.resolve();
  }
  storeVoiceAuthority(
    tokenHash: string,
    record: DurableVoiceAuthority,
  ): Promise<void> {
    if (!this.voiceAuthorities.has(tokenHash))
      this.voiceAuthorities.set(tokenHash, {
        record: structuredClone(record),
        consumed: false,
      });
    return Promise.resolve();
  }
  loadVoiceAuthority(tokenHash: string): Promise<DurableVoiceAuthority | null> {
    const authority = this.voiceAuthorities.get(tokenHash);
    return Promise.resolve(
      authority &&
        !authority.consumed &&
        authority.record.expiresAt >= Date.now()
        ? structuredClone(authority.record)
        : null,
    );
  }
  consumeVoiceAuthority(tokenHash: string): Promise<boolean> {
    const authority = this.voiceAuthorities.get(tokenHash);
    if (!authority || authority.consumed) return Promise.resolve(false);
    authority.consumed = true;
    return Promise.resolve(true);
  }
  health(): Promise<boolean> {
    return Promise.resolve(true);
  }
  resetDemoState(): Promise<void> {
    this.sessions.clear();
    this.memoryThreads.clear();
    this.clientContexts.clear();
    this.transfers.splice(0, this.transfers.length);
    this.uiEvents.splice(0, this.uiEvents.length);
    this.handoverClinical.clear();
    this.authorities.clear();
    this.voiceAuthorities.clear();
    this.acceptedCommands.clear();
    this.clinicalProjectionJobs.splice(0, this.clinicalProjectionJobs.length);
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

export class PostgresOperationalStore
  implements OperationalStore, ProviderDeliveryStore
{
  readonly mode = "postgresql" as const;
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      statement_timeout: 15_000,
    });
  }
  async initialize(): Promise<void> {
    await runMigrations(this.pool, {
      allowLegacyAttestation: process.env.PFH_DEMO_MODE === "true",
      lockName: `${organizationId}:pflegehelfer-schema-migrations`,
    });
    await this.pool.query(
      `INSERT INTO organizations (id,name) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`,
      [organizationId, siteConfiguration.displayName],
    );
    await this.pool.query(
      `INSERT INTO departments (organization_id,id,name) VALUES ($1,$2,$3)
       ON CONFLICT (organization_id,id) DO UPDATE SET name=EXCLUDED.name`,
      [
        organizationId,
        siteConfiguration.department.id,
        siteConfiguration.department.displayName,
      ],
    );
    // Quarantine pre-scope transcripts without reading or relabelling them.
    // Active work sessions are relinked to a fresh general thread so episodes
    // and responsibility remain attached to the same operational session.
    const migration = await this.pool.connect();
    try {
      await migration.query("BEGIN");
      const activeLegacy = await migration.query<{
        session_id: string;
        actor_id: string;
        effective_role: Role;
        department_id: string;
      }>(
        `SELECT s.id AS session_id,s.actor_id,s.effective_role,s.department_id
         FROM working_sessions s
         JOIN assistant_threads t
           ON t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
         WHERE s.organization_id=$1 AND s.status='active'
           AND s.department_id=$2
           AND t.site_id='legacy-unassigned'
         FOR UPDATE OF s,t`,
        [organizationId, departmentId],
      );
      if (
        activeLegacy.rows.length > 0 &&
        process.env.PFH_ALLOW_LEGACY_THREAD_QUARANTINE_RELINK !== "true"
      )
        throw new Error(
          "LEGACY_THREAD_MIGRATION_MANIFEST_REQUIRED: set the one-time, site-scoped quarantine relink gate only after reviewing the exact department migration.",
        );
      for (const row of activeLegacy.rows) {
        const threadId = randomUUID();
        await migration.query(
          `INSERT INTO assistant_threads
             (organization_id,id,actor_id,effective_role,department_id,site_id,thread_type,title,audience,membership,retention_class,pinned,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,'general-assistant','Mein Assistent',$7,$8,'shift-session',true,$9)`,
          [
            organizationId,
            threadId,
            row.actor_id,
            row.effective_role,
            row.department_id,
            siteConfiguration.siteId,
            { actorId: row.actor_id },
            JSON.stringify([row.actor_id]),
            new Date(Date.now() + sessionTtlMs),
          ],
        );
        await migration.query(
          `UPDATE working_sessions SET assistant_thread_id=$3,row_version=row_version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, row.session_id, threadId],
        );
      }
      await migration.query(
        `UPDATE safety_authority a SET consumed_at=COALESCE(consumed_at,now())
         FROM assistant_threads t
         WHERE a.organization_id=$1 AND t.organization_id=a.organization_id
           AND t.id=a.thread_id AND t.site_id='legacy-unassigned'
           AND t.department_id=$2`,
        [organizationId, departmentId],
      );
      await migration.query(
        `UPDATE assistant_proposal_revisions p SET status='expired'
         FROM assistant_threads t
         WHERE p.organization_id=$1 AND p.status='pending'
           AND t.organization_id=p.organization_id AND t.id=p.thread_id
           AND t.site_id='legacy-unassigned' AND t.department_id=$2`,
        [organizationId, departmentId],
      );
      await migration.query(
        `UPDATE assistant_threads
         SET expires_at=LEAST(expires_at,now()),updated_at=now()
         WHERE organization_id=$1 AND site_id='legacy-unassigned'
           AND department_id=$2`,
        [organizationId, departmentId],
      );
      await migration.query("COMMIT");
    } catch (error) {
      await migration.query("ROLLBACK");
      throw error;
    } finally {
      migration.release();
    }
  }
  async getOrStartSession(
    actorId: string,
    role: Role,
  ): Promise<WorkingSessionView> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // The PWA loads the working session and workday concurrently. Serialize
      // creation for one actor so both requests either create or reuse the same
      // active session instead of racing the partial unique index.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${organizationId}:${actorId}`],
      );
      await client.query(
        `UPDATE working_sessions s
         SET status='paused', updated_at=now()
         FROM assistant_threads t
         WHERE s.organization_id=$1 AND s.actor_id=$2 AND s.status='active'
           AND t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
           AND (t.expires_at <= now() OR s.effective_role <> $3)`,
        [organizationId, actorId, role],
      );
      const workflow = workflowForRole(role);
      const configuredWorkday = optionalWorkdayConfiguration(actorId, role);
      await client.query(
        `INSERT INTO workflow_templates (organization_id,id,name,eligible_roles,active_version)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organization_id,id) DO UPDATE SET name=EXCLUDED.name, eligible_roles=EXCLUDED.eligible_roles`,
        [
          organizationId,
          workflow.id,
          workflow.name,
          workflow.eligibleRoles,
          workflow.version,
        ],
      );
      await client.query(
        `INSERT INTO workflow_template_versions
           (organization_id,template_id,version,status,definition,definition_hash,published_at,published_by)
         VALUES ($1,$2,$3,'published',$4,$5,now(),'system-bootstrap')
         ON CONFLICT (organization_id,template_id,version) DO NOTHING`,
        [
          organizationId,
          workflow.id,
          workflow.version,
          workflow.definition,
          workflow.definitionHash,
        ],
      );
      await client.query(
        `UPDATE workflow_templates SET active_version=$3
         WHERE organization_id=$1 AND id=$2 AND active_version IS NULL`,
        [organizationId, workflow.id, workflow.version],
      );
      const existing = await client.query(
        `SELECT s.*, t.context_revision, t.patient_id, t.subject_encounter_id, v.definition, w.name AS workflow_name
         FROM working_sessions s
         JOIN assistant_threads t ON t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
         JOIN workflow_template_versions v ON v.organization_id=s.organization_id AND v.template_id=s.workflow_template_id AND v.version=s.workflow_version
         JOIN workflow_templates w ON w.organization_id=s.organization_id AND w.id=s.workflow_template_id
         WHERE s.organization_id=$1 AND s.actor_id=$2 AND s.effective_role=$3
           AND t.site_id=$5 AND t.department_id=$6
           AND (
             (s.status='active' AND t.expires_at > now())
             OR (
               s.status='completed' AND $4::text IS NOT NULL AND EXISTS (
                 SELECT 1 FROM handover_snapshots h
                 WHERE h.organization_id=s.organization_id
                   AND h.owner_actor_id=s.actor_id
                   AND h.shift_key=$4
                   AND h.status IN ('transferred','acknowledged')
               )
             )
           )
         ORDER BY CASE WHEN s.status='active' THEN 0 ELSE 1 END, s.started_at DESC
         LIMIT 1
         FOR UPDATE OF s`,
        [
          organizationId,
          actorId,
          role,
          configuredWorkday?.shiftKey ?? null,
          siteConfiguration.siteId,
          departmentId,
        ],
      );
      let row = existing.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        const threadId = randomUUID();
        const sessionId = randomUUID();
        const expiresAt = new Date(Date.now() + sessionTtlMs);
        await client.query(
          `INSERT INTO assistant_threads
             (organization_id,id,actor_id,effective_role,department_id,site_id,thread_type,title,audience,membership,retention_class,pinned,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,'general-assistant','Mein Assistent',$7,$8,'shift-session',true,$9)`,
          [
            organizationId,
            threadId,
            actorId,
            role,
            departmentId,
            siteConfiguration.siteId,
            { actorId },
            JSON.stringify([actorId]),
            expiresAt,
          ],
        );
        if (configuredWorkday)
          await client.query(
            `INSERT INTO handover_snapshots
             (organization_id,id,department_id,shift_key,version,patient_ids,cutoff_at,source_hash,status,owner_actor_id,created_by,content,content_hash)
           VALUES ($1,$2,$3,$4,1,$5,now(),$6,'open',$7,$7,$8::jsonb,$6)
           ON CONFLICT DO NOTHING`,
            [
              organizationId,
              randomUUID(),
              departmentId,
              configuredWorkday.shiftKey,
              configuredWorkday.patientIds,
              handoverSourceHash({
                departmentId,
                shiftKey: configuredWorkday.shiftKey,
                actorId,
                content: handoverContent(configuredWorkday.patientIds),
              }),
              actorId,
              JSON.stringify(handoverContent(configuredWorkday.patientIds)),
            ],
          );
        await client.query(
          `INSERT INTO working_sessions
             (organization_id,id,actor_id,effective_role,department_id,workflow_template_id,workflow_version,assistant_thread_id,current_step_id,status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active')`,
          [
            organizationId,
            sessionId,
            actorId,
            role,
            departmentId,
            workflow.id,
            workflow.version,
            threadId,
            workflow.definition.steps[0]!.id,
          ],
        );
        await client.query(
          `INSERT INTO workflow_step_instances (organization_id,session_id,step_id,ordinal,status)
           VALUES ($1,$2,$3,1,'open')`,
          [organizationId, sessionId, workflow.definition.steps[0]!.id],
        );
        await client.query(
          `INSERT INTO domain_events (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
           VALUES ($1,'working-session',$2,'WorkflowSessionStarted',$3,$4)`,
          [
            organizationId,
            sessionId,
            { actorId },
            {
              threadId,
              workflowTemplateId: workflow.id,
              workflowVersion: workflow.version,
            },
          ],
        );
        row = (
          await client.query(
            `SELECT s.*, t.context_revision, t.patient_id, t.subject_encounter_id, v.definition, w.name AS workflow_name
           FROM working_sessions s
           JOIN assistant_threads t ON t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
           JOIN workflow_template_versions v ON v.organization_id=s.organization_id AND v.template_id=s.workflow_template_id AND v.version=s.workflow_version
           JOIN workflow_templates w ON w.organization_id=s.organization_id AND w.id=s.workflow_template_id
           WHERE s.organization_id=$1 AND s.id=$2`,
            [organizationId, sessionId],
          )
        ).rows[0] as Record<string, unknown>;
      }
      await client.query("COMMIT");
      return this.toView(row);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async changePatientContext(
    actorId: string,
    role: Role,
    patientId: string | null,
    encounterId: string | null = null,
  ): Promise<WorkingSessionView> {
    if (patientId && !encounterId)
      throw new Error("PATIENT_ENCOUNTER_REQUIRED");
    const session = await this.getOrStartSession(actorId, role);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          `${organizationId}:${actorId}:conversation:${patientId ?? "general"}:${encounterId ?? "none"}`,
        ],
      );
      const desiredType = patientId ? "patient-assistant" : "general-assistant";
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM assistant_threads
         WHERE organization_id=$1 AND actor_id=$2 AND effective_role=$3
           AND site_id=$4 AND department_id=$5
           AND thread_type=$6 AND patient_id IS NOT DISTINCT FROM $7
           AND subject_encounter_id IS NOT DISTINCT FROM $8
           AND expires_at > now()
         ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
        [
          organizationId,
          actorId,
          role,
          siteConfiguration.siteId,
          departmentId,
          desiredType,
          patientId,
          patientId ? encounterId : null,
        ],
      );
      const nextThreadId = existing.rows[0]?.id ?? randomUUID();
      if (!existing.rows[0])
        await client.query(
          `INSERT INTO assistant_threads
             (organization_id,id,actor_id,effective_role,department_id,site_id,thread_type,patient_id,subject_encounter_id,title,audience,membership,retention_class,pinned,expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            organizationId,
            nextThreadId,
            actorId,
            role,
            departmentId,
            siteConfiguration.siteId,
            desiredType,
            patientId,
            patientId ? encounterId : null,
            patientId ? "Patientengespräch" : "Mein Assistent",
            patientId ? { actorId, patientId, encounterId } : { actorId },
            JSON.stringify([actorId]),
            patientId ? "patient-record" : "shift-session",
            patientId === null,
            new Date(Date.now() + sessionTtlMs),
          ],
        );
      const changed = await client.query<{ context_revision: number }>(
        `UPDATE assistant_threads
         SET context_revision=context_revision+1, updated_at=now()
         WHERE organization_id=$1 AND id=$2 RETURNING context_revision`,
        [organizationId, nextThreadId],
      );
      const contextRevision = Number(changed.rows[0]?.context_revision);
      await client.query(
        `INSERT INTO assistant_messages
           (organization_id,thread_id,sequence,id,kind,patient_id,context_revision,content)
         SELECT organization_id,id,next_sequence,$3,'context',$4,$5,$6
         FROM assistant_threads WHERE organization_id=$1 AND id=$2`,
        [
          organizationId,
          nextThreadId,
          randomUUID(),
          patientId,
          contextRevision,
          { patientId, encounterId: patientId ? encounterId : null },
        ],
      );
      await client.query(
        `UPDATE assistant_threads SET next_sequence=next_sequence+1 WHERE organization_id=$1 AND id=$2`,
        [organizationId, nextThreadId],
      );
      await client.query(
        `UPDATE working_sessions
         SET assistant_thread_id=$3,row_version=row_version+1,updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [organizationId, session.id, nextThreadId],
      );
      await client.query(
        `INSERT INTO domain_events (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'assistant-thread',$2,'ContextChanged',$3,$4)`,
        [
          organizationId,
          nextThreadId,
          { actorId },
          {
            patientId,
            encounterId: patientId ? encounterId : null,
            contextRevision,
          },
        ],
      );
      await client.query("COMMIT");
      return await this.getOrStartSession(actorId, role);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async bindAssistantContext(
    actorId: string,
    role: Role,
    clientContextId: string,
    patientId: string | null,
    encounterId: string | null = null,
  ): Promise<AssistantContextBinding> {
    const session = await this.changePatientContext(
      actorId,
      role,
      patientId,
      encounterId,
    );
    const result = await this.pool.query<{
      context_revision: number;
    }>(
      `INSERT INTO assistant_client_contexts
         (organization_id,id,actor_id,effective_role,session_id,thread_id,context_revision,patient_id,encounter_id,expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8,$9)
       ON CONFLICT (organization_id,id) DO UPDATE
       SET session_id=EXCLUDED.session_id,
           thread_id=EXCLUDED.thread_id,
           context_revision=assistant_client_contexts.context_revision+1,
           patient_id=EXCLUDED.patient_id,
           encounter_id=EXCLUDED.encounter_id,
           expires_at=EXCLUDED.expires_at,
           updated_at=now()
       WHERE assistant_client_contexts.actor_id=EXCLUDED.actor_id
         AND assistant_client_contexts.effective_role=EXCLUDED.effective_role
       RETURNING context_revision`,
      [
        organizationId,
        clientContextId,
        actorId,
        role,
        session.id,
        session.threadId,
        patientId,
        patientId ? encounterId : null,
        new Date(Date.now() + sessionTtlMs),
      ],
    );
    const contextRevision = result.rows[0]?.context_revision;
    if (contextRevision === undefined)
      throw new DomainError(
        "AUTH_DENIED",
        "Browserkontext gehört nicht zu dieser Mitarbeitenden-Sitzung.",
        403,
      );
    return {
      clientContextId,
      sessionId: session.id,
      threadId: session.threadId,
      contextRevision,
      patientId,
      encounterId: patientId ? encounterId : null,
    };
  }
  async resolveAssistantContext(
    actorId: string,
    role: Role,
    clientContextId: string,
  ): Promise<AssistantContextBinding | null> {
    const result = await this.pool.query<{
      session_id: string;
      thread_id: string;
      context_revision: number;
      patient_id: string | null;
      encounter_id: string | null;
    }>(
      `SELECT c.session_id::text,c.thread_id::text,c.context_revision,
              c.patient_id,c.encounter_id
       FROM assistant_client_contexts c
       JOIN working_sessions s
         ON s.organization_id=c.organization_id AND s.id=c.session_id
       JOIN assistant_threads t
         ON t.organization_id=c.organization_id AND t.id=c.thread_id
       WHERE c.organization_id=$1 AND c.id=$2 AND c.actor_id=$3
         AND c.effective_role=$4 AND c.expires_at > now()
         AND s.actor_id=$3 AND s.effective_role=$4 AND s.status='active'
         AND t.actor_id=$3 AND t.effective_role=$4
         AND t.site_id=$5 AND t.department_id=$6 AND t.expires_at > now()
         AND t.patient_id IS NOT DISTINCT FROM c.patient_id
         AND t.subject_encounter_id IS NOT DISTINCT FROM c.encounter_id`,
      [
        organizationId,
        clientContextId,
        actorId,
        role,
        siteConfiguration.siteId,
        departmentId,
      ],
    );
    const row = result.rows[0];
    return row
      ? {
          clientContextId,
          sessionId: row.session_id,
          threadId: row.thread_id,
          contextRevision: Number(row.context_revision),
          patientId: row.patient_id,
          encounterId: row.encounter_id,
        }
      : null;
  }
  async advanceAssistantRevision(
    actorId: string,
    role: Role,
  ): Promise<WorkingSessionView> {
    const session = await this.getOrStartSession(actorId, role);
    const advanced = await this.pool.query<{ context_revision: number }>(
      `UPDATE assistant_threads
       SET context_revision=context_revision+1,updated_at=now()
       WHERE organization_id=$1 AND id=$2
       RETURNING context_revision`,
      [organizationId, session.threadId],
    );
    const contextRevision = advanced.rows[0]?.context_revision;
    if (contextRevision === undefined)
      throw new Error("ASSISTANT_THREAD_NOT_FOUND");
    return { ...session, contextRevision };
  }
  async loadConversation(
    actorId: string,
    role: Role,
    patientId?: string | null,
    context?: AssistantContextBinding,
  ): Promise<StoredConversationTurn[]> {
    const session = await this.getOrStartSession(actorId, role);
    if (
      context &&
      !(await this.resolveAssistantContext(
        actorId,
        role,
        context.clientContextId,
      ))
    )
      throw new Error("ASSISTANT_CONTEXT_STALE");
    const result = await this.pool.query<{
      content: StoredConversationTurn;
      created_at: Date;
    }>(
      `SELECT content, created_at FROM (
         SELECT content, created_at, sequence FROM assistant_messages
         WHERE organization_id=$1 AND thread_id=$2 AND kind='assistant'
           AND ($3::boolean = false OR patient_id IS NOT DISTINCT FROM $4)
         ORDER BY sequence DESC LIMIT 80
       ) recent ORDER BY sequence ASC`,
      [
        organizationId,
        context?.threadId ?? session.threadId,
        patientId !== undefined,
        patientId ?? null,
      ],
    );
    return result.rows.map((row) => ({
      ...row.content,
      createdAt: row.content.createdAt ?? row.created_at.toISOString(),
    }));
  }
  async loadPendingCarePlan(
    actorId: string,
    patientId: string,
    encounterId: string,
    threadId: string,
  ): Promise<string | null> {
    const result = await this.pool.query<{ plan: string | null }>(
      `SELECT p.payload->'payload'->>'plan' AS plan
       FROM assistant_proposal_revisions p
       WHERE p.organization_id=$1 AND p.actor_id=$2 AND p.thread_id=$3
         AND p.patient_id=$4 AND p.encounter_id=$5 AND p.status='pending'
         AND p.payload->>'command'='care-update:draft'
       ORDER BY p.revision DESC,p.created_at DESC LIMIT 1`,
      [organizationId, actorId, threadId, patientId, encounterId],
    );
    return result.rows[0]?.plan ?? null;
  }
  async loadPendingIntentReview(
    actorId: string,
    patientId: string,
    encounterId: string,
    threadId: string,
  ): Promise<PendingIntentReview | null> {
    const result = await this.pool.query<{
      payload: {
        actorId: string;
        patientId: string;
        encounterId: string;
        command: DurableIntentRecord["command"];
        payload: Record<string, string>;
        resourceVersion: number;
        purpose: Purpose;
      };
      review_items: Array<{ id: string; label: string; kind: string }>;
      source_response_id: string;
      effective_role: Role;
    }>(
      `SELECT p.payload,p.review_items,p.source_response_id,s.effective_role
       FROM assistant_proposal_revisions p
       JOIN working_sessions s
         ON s.organization_id=p.organization_id AND s.id=p.session_id
       WHERE p.organization_id=$1 AND p.actor_id=$2 AND p.thread_id=$3
         AND p.patient_id=$4 AND p.encounter_id=$5 AND p.status='pending'
       ORDER BY p.revision DESC,p.created_at DESC LIMIT 1`,
      [organizationId, actorId, threadId, patientId, encounterId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      record: {
        actorId: row.payload.actorId,
        actorRole: row.effective_role,
        patientId: row.payload.patientId,
        encounterId: row.payload.encounterId,
        purpose: row.payload.purpose,
        resourceVersion: row.payload.resourceVersion,
        command: row.payload.command,
        payload: row.payload.payload,
        expiresAt: Date.now() + 120_000,
      },
      reviewItems: row.review_items,
      responseId: row.source_response_id,
    };
  }
  async listConversations(
    actorId: string,
    role: Role,
  ): Promise<ConversationDescriptor[]> {
    const session = await this.getOrStartSession(actorId, role);
    const result = await this.pool.query<{
      id: string;
      thread_type: ConversationType;
      title: string;
      patient_id: string | null;
      subject_encounter_id: string | null;
      retention_class: ConversationDescriptor["retentionClass"];
      pinned: boolean;
      updated_at: Date;
    }>(
      `SELECT id,thread_type,title,patient_id,subject_encounter_id,
              retention_class,pinned,updated_at
       FROM assistant_threads
       WHERE organization_id=$1 AND site_id=$2 AND actor_id=$3
         AND effective_role=$4 AND department_id=$5 AND expires_at > now()
       ORDER BY pinned DESC,updated_at DESC LIMIT 80`,
      [organizationId, siteConfiguration.siteId, actorId, role, departmentId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      type: row.thread_type,
      title: String(row.title),
      patientId: row.patient_id ? String(row.patient_id) : null,
      encounterId: row.subject_encounter_id
        ? String(row.subject_encounter_id)
        : null,
      retentionClass: row.retention_class,
      pinned: Boolean(row.pinned),
      lastActivityAt: row.updated_at.toISOString(),
      active: String(row.id) === session.threadId,
    }));
  }
  async appendConversationTurn(
    actorId: string,
    role: Role,
    turn: StoredConversationTurn,
    context?: AssistantContextBinding,
  ): Promise<void> {
    const session = await this.getOrStartSession(actorId, role);
    const targetThreadId =
      context?.threadId ?? turn.originThreadId ?? session.threadId;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (context) {
        const bound = await client.query(
          `SELECT 1 FROM assistant_client_contexts
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3
             AND effective_role=$4 AND session_id=$5 AND thread_id=$6
             AND context_revision=$7 AND patient_id IS NOT DISTINCT FROM $8
             AND encounter_id IS NOT DISTINCT FROM $9 AND expires_at > now()`,
          [
            organizationId,
            context.clientContextId,
            actorId,
            role,
            context.sessionId,
            context.threadId,
            context.contextRevision,
            context.patientId,
            context.encounterId,
          ],
        );
        if (bound.rowCount !== 1) throw new Error("ASSISTANT_CONTEXT_STALE");
      }
      const thread = await client.query(
        `SELECT next_sequence,context_revision,patient_id,subject_encounter_id
         FROM assistant_threads
         WHERE organization_id=$1 AND site_id=$2 AND id=$3
           AND actor_id=$4 AND effective_role=$5 AND department_id=$6
           AND expires_at > now()
         FOR UPDATE`,
        [
          organizationId,
          siteConfiguration.siteId,
          targetThreadId,
          actorId,
          role,
          departmentId,
        ],
      );
      const row = thread.rows[0] as
        | {
            next_sequence: string;
            context_revision: number;
            patient_id: string | null;
            subject_encounter_id: string | null;
          }
        | undefined;
      if (
        !row ||
        (turn.originPatientId !== undefined &&
          row.patient_id !== turn.originPatientId) ||
        (turn.originEncounterId !== undefined &&
          row.subject_encounter_id !== turn.originEncounterId) ||
        (!context &&
          turn.originContextRevision !== undefined &&
          row.context_revision !== turn.originContextRevision) ||
        (context !== undefined &&
          (turn.originThreadId !== context.threadId ||
            turn.originPatientId !== context.patientId ||
            turn.originEncounterId !== context.encounterId ||
            turn.originContextRevision !== context.contextRevision))
      )
        throw new Error("ASSISTANT_CONTEXT_STALE");
      await client.query(
        `INSERT INTO assistant_messages
           (organization_id,thread_id,sequence,id,kind,patient_id,context_revision,input_modality,content)
         VALUES ($1,$2,$3,$4,'assistant',$5,$6,$7,$8)`,
        [
          organizationId,
          targetThreadId,
          row.next_sequence,
          turn.id,
          turn.originPatientId === undefined
            ? row.patient_id
            : turn.originPatientId,
          turn.originContextRevision ?? row.context_revision,
          turn.inputModality,
          turn,
        ],
      );
      await client.query(
        `UPDATE assistant_threads SET next_sequence=next_sequence+1,updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [organizationId, targetThreadId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async clearConversation(
    actorId: string,
    role: Role,
    context?: AssistantContextBinding,
  ): Promise<void> {
    const session = await this.getOrStartSession(actorId, role);
    const sourceThreadId = context?.threadId ?? session.threadId;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const nextThreadId = randomUUID();
      await client.query(
        `INSERT INTO assistant_threads
           (organization_id,id,actor_id,effective_role,department_id,site_id,thread_type,patient_id,subject_encounter_id,title,audience,membership,retention_class,pinned,expires_at)
         SELECT $1,$2,$3,$4,$5,$6,thread_type,patient_id,subject_encounter_id,title,audience,membership,retention_class,pinned,$7
         FROM assistant_threads WHERE organization_id=$1 AND id=$8`,
        [
          organizationId,
          nextThreadId,
          actorId,
          role,
          departmentId,
          siteConfiguration.siteId,
          new Date(Date.now() + sessionTtlMs),
          sourceThreadId,
        ],
      );
      await client.query(
        `UPDATE working_sessions
         SET assistant_thread_id=$3,row_version=row_version+1,updated_at=now()
         WHERE organization_id=$1 AND id=$2`,
        [organizationId, session.id, nextThreadId],
      );
      if (context) {
        const rebound = await client.query(
          `UPDATE assistant_client_contexts
           SET thread_id=$4,context_revision=context_revision+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3
             AND thread_id=$5 AND context_revision=$6`,
          [
            organizationId,
            context.clientContextId,
            actorId,
            nextThreadId,
            context.threadId,
            context.contextRevision,
          ],
        );
        if (rebound.rowCount !== 1) throw new Error("ASSISTANT_CONTEXT_STALE");
      }
      await client.query(
        `INSERT INTO domain_events
           (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'working-session',$2,'ConversationSegmentStarted',$3,$4)`,
        [
          organizationId,
          session.id,
          { actorId },
          { previousThreadId: sourceThreadId, nextThreadId },
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async getWorkday(actorId: string, role: Role): Promise<WorkdayView> {
    const session = await this.getOrStartSession(actorId, role);
    const configuredWorkday = workdayConfiguration(
      actorId,
      role,
      session.startedAt,
    );
    await this.pool.query(
      `INSERT INTO handover_snapshots
         (organization_id,id,department_id,shift_key,version,patient_ids,cutoff_at,source_hash,status,owner_actor_id,created_by,content,content_hash)
       VALUES ($1,$2,$3,$4,1,$5,now(),$6,'open',$7,$7,$8::jsonb,$6)
       ON CONFLICT DO NOTHING`,
      [
        organizationId,
        randomUUID(),
        session.departmentId,
        configuredWorkday.shiftKey,
        configuredWorkday.patientIds,
        handoverSourceHash({
          departmentId: session.departmentId,
          shiftKey: configuredWorkday.shiftKey,
          actorId,
          content: handoverContent(configuredWorkday.patientIds),
        }),
        actorId,
        JSON.stringify(handoverContent(configuredWorkday.patientIds)),
      ],
    );
    const handoverResult = await this.pool.query(
      `SELECT * FROM handover_snapshots
       WHERE organization_id=$1 AND department_id=$2
         AND content IS NOT NULL AND content_hash=source_hash
         AND ((shift_key=$3 AND owner_actor_id=$4) OR receiving_actor_id=$4)
       ORDER BY CASE
         WHEN receiving_actor_id=$4 AND status='transferred' THEN 0
         WHEN shift_key=$3 AND status IN ('transferred','acknowledged') THEN 1
         WHEN receiving_actor_id=$4 AND status='acknowledged' THEN 2
         ELSE 3 END,
         created_at DESC
       LIMIT 1`,
      [
        organizationId,
        session.departmentId,
        configuredWorkday.shiftKey,
        actorId,
      ],
    );
    const handover = handoverResult.rows[0] as {
      id: string;
      version: number;
      shift_key: string;
      patient_ids: string[];
      cutoff_at: Date | string;
      source_hash: string;
      content: HandoverContentItem[];
      clinical_bound: boolean;
      status: "open" | "transferred" | "acknowledged";
    };
    const acknowledgements = await this.pool.query<{ patient_id: string }>(
      `SELECT patient_id FROM handover_acknowledgements
       WHERE organization_id=$1 AND handover_id=$2 AND actor_id=$3 AND status='acknowledged'`,
      [organizationId, handover.id, actorId],
    );
    const episodeResult = await this.pool.query(
      `SELECT * FROM work_episodes WHERE organization_id=$1 AND session_id=$2
       ORDER BY started_at ASC`,
      [organizationId, session.id],
    );
    const transferResult = await this.pool.query(
      `SELECT * FROM responsibility_transfers
       WHERE organization_id=$1 AND (from_actor_id=$2 OR to_actor_id=$2)
       ORDER BY created_at ASC`,
      [organizationId, actorId],
    );
    return buildWorkdayView(
      session,
      handover,
      acknowledgements.rows.map((row) => row.patient_id),
      episodeResult.rows.map(toEpisodeView),
      transferResult.rows.map(toTransferView),
    );
  }
  async bindHandoverClinicalSnapshot(
    actorId: string,
    role: Role,
    handoverId: string,
    version: number,
    items: HandoverClinicalSnapshotItem[],
  ): Promise<WorkdayView> {
    const session = await this.getOrStartSession(actorId, role);
    const configuredWorkday = workdayConfiguration(
      actorId,
      role,
      session.startedAt,
    );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string;
        version: number;
        patient_ids: string[];
        content: HandoverContentItem[];
        clinical_bound: boolean;
        department_id: string;
        shift_key: string;
        owner_actor_id: string;
      }>(
        `SELECT id,version,patient_ids,content,clinical_bound,department_id,shift_key,owner_actor_id
         FROM handover_snapshots
         WHERE organization_id=$1 AND department_id=$2 AND id=$3
           AND ((shift_key=$4 AND owner_actor_id=$5) OR receiving_actor_id=$5)
         FOR UPDATE`,
        [
          organizationId,
          session.departmentId,
          handoverId,
          configuredWorkday.shiftKey,
          actorId,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("HANDOVER_VERSION_STALE");
      if (row.clinical_bound) {
        await client.query("COMMIT");
        return await this.getWorkday(actorId, role);
      }
      if (row.version !== version) throw new Error("HANDOVER_VERSION_STALE");
      const acknowledgements = await client.query<{ count: string }>(
        `SELECT count(*) FROM handover_acknowledgements
         WHERE organization_id=$1 AND handover_id=$2`,
        [organizationId, handoverId],
      );
      if (Number(acknowledgements.rows[0]?.count) > 0)
        throw new Error("HANDOVER_ALREADY_ACKNOWLEDGED");
      const expected = new Set(row.patient_ids);
      if (
        items.length !== expected.size ||
        items.some(
          (item) =>
            !expected.has(item.patientId) ||
            !item.encounterId ||
            items.filter((candidate) => candidate.patientId === item.patientId)
              .length !== 1,
        )
      )
        throw new Error("HANDOVER_CONTENT_MISMATCH");
      const clinicalByPatient = new Map(
        items.map((item) => [item.patientId, item]),
      );
      const content = row.content.map((base) => {
        const clinical = clinicalByPatient.get(base.patientId)!;
        return {
          ...base,
          encounterId: clinical.encounterId,
          currentImportant: [...clinical.currentImportant],
          recentChanges: [...clinical.recentChanges],
          openQuestions: [...clinical.openQuestions],
        };
      });
      const sourceHash = handoverSourceHash({
        departmentId: row.department_id,
        shiftKey: row.shift_key,
        actorId: row.owner_actor_id,
        content,
      });
      const updated = await client.query(
        `UPDATE handover_snapshots
         SET content=$3::jsonb,source_hash=$4,content_hash=$4,
             clinical_bound=true,version=version+1
         WHERE organization_id=$1 AND id=$2 AND version=$5 AND clinical_bound=false`,
        [
          organizationId,
          handoverId,
          JSON.stringify(content),
          sourceHash,
          version,
        ],
      );
      if (updated.rowCount !== 1) throw new Error("HANDOVER_VERSION_STALE");
      await client.query("COMMIT");
      return await this.getWorkday(actorId, role);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async setThreadPatientContext(
    client: pg.PoolClient,
    session: WorkingSessionView,
    actorId: string,
    patientId: string,
    encounterId: string,
  ): Promise<void> {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`${organizationId}:${actorId}:conversation:${patientId}:${encounterId}`],
    );
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM assistant_threads
         WHERE organization_id=$1 AND actor_id=$2
         AND effective_role=$3 AND site_id=$4 AND department_id=$5
         AND thread_type='patient-assistant'
         AND patient_id=$6 AND subject_encounter_id=$7 AND expires_at > now()
       ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`,
      [
        organizationId,
        actorId,
        session.effectiveRole,
        siteConfiguration.siteId,
        departmentId,
        patientId,
        encounterId,
      ],
    );
    const threadId = existing.rows[0]?.id ?? randomUUID();
    if (!existing.rows[0])
      await client.query(
        `INSERT INTO assistant_threads
           (organization_id,id,actor_id,effective_role,department_id,site_id,thread_type,patient_id,subject_encounter_id,title,audience,membership,retention_class,pinned,expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'patient-assistant',$7,$8,'Patientengespräch',$9,$10,'patient-record',false,$11)`,
        [
          organizationId,
          threadId,
          actorId,
          session.effectiveRole,
          session.departmentId,
          siteConfiguration.siteId,
          patientId,
          encounterId,
          { actorId, patientId, encounterId },
          JSON.stringify([actorId]),
          new Date(Date.now() + sessionTtlMs),
        ],
      );
    const changed = await client.query<{
      context_revision: number;
      message_sequence: string;
    }>(
      `UPDATE assistant_threads
       SET context_revision=context_revision+1,
           next_sequence=next_sequence+1, updated_at=now()
       WHERE organization_id=$1 AND id=$2
       RETURNING context_revision, (next_sequence-1)::text AS message_sequence`,
      [organizationId, threadId],
    );
    const context = changed.rows[0];
    if (!context) return;
    await client.query(
      `INSERT INTO assistant_messages
         (organization_id,thread_id,sequence,id,kind,patient_id,context_revision,content)
       VALUES ($1,$2,$3,$4,'context',$5,$6,$7)`,
      [
        organizationId,
        threadId,
        context.message_sequence,
        randomUUID(),
        patientId,
        context.context_revision,
        { patientId, encounterId },
      ],
    );
    await client.query(
      `INSERT INTO domain_events
         (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
       VALUES ($1,'assistant-thread',$2,'ContextChanged',$3,$4)`,
      [
        organizationId,
        threadId,
        { actorId },
        { patientId, encounterId, contextRevision: context.context_revision },
      ],
    );
    await client.query(
      `UPDATE working_sessions
       SET assistant_thread_id=$3,row_version=row_version+1,updated_at=now()
       WHERE organization_id=$1 AND id=$2`,
      [organizationId, session.id, threadId],
    );
  }
  async applyWorkdayCommand(
    actorId: string,
    role: Role,
    command: WorkdayCommand,
  ): Promise<WorkdayView> {
    if (!["care-assistant", "registered-nurse"].includes(role))
      throw new Error("WORKDAY_ROLE_DENIED");
    const session = await this.getOrStartSession(actorId, role);
    if (session.status === "completed") throw new Error("SHIFT_ALREADY_CLOSED");
    const configuredWorkday = workdayConfiguration(
      actorId,
      role,
      session.startedAt,
    );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const lockedSession = await client.query<{ status: string }>(
        `SELECT status FROM working_sessions WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
        [organizationId, session.id],
      );
      if (lockedSession.rows[0]?.status !== "active")
        throw new Error("SHIFT_ALREADY_CLOSED");
      if (command.type === "acknowledge-handover") {
        const handover = await client.query(
          `SELECT * FROM handover_snapshots
           WHERE organization_id=$1 AND department_id=$2 AND id=$3
             AND ((shift_key=$4 AND owner_actor_id=$5) OR receiving_actor_id=$5)
           FOR UPDATE`,
          [
            organizationId,
            session.departmentId,
            command.handoverId,
            configuredWorkday.shiftKey,
            actorId,
          ],
        );
        const row = handover.rows[0] as {
          id: string;
          version: number;
          patient_ids: string[];
          source_hash: string;
          content_hash: string;
          content: HandoverContentItem[];
          clinical_bound: boolean;
          department_id: string;
          shift_key: string;
          owner_actor_id: string;
        };
        const calculatedHash = row
          ? handoverSourceHash({
              departmentId: row.department_id,
              shiftKey: row.shift_key,
              actorId: row.owner_actor_id,
              content: row.content,
            })
          : null;
        if (
          !row ||
          row.version !== command.version ||
          row.source_hash !== row.content_hash ||
          calculatedHash !== row.source_hash ||
          !row.clinical_bound ||
          !Array.isArray(row.content) ||
          !row.content.some((item) => item.patientId === command.patientId) ||
          !row.patient_ids.includes(command.patientId)
        )
          throw new Error("HANDOVER_VERSION_STALE");
        await client.query(
          `INSERT INTO handover_acknowledgements
             (organization_id,handover_id,patient_id,version,actor_id,status)
           VALUES ($1,$2,$3,$4,$5,'acknowledged') ON CONFLICT DO NOTHING`,
          [organizationId, row.id, command.patientId, command.version, actorId],
        );
        const count = await client.query<{ count: string }>(
          `SELECT count(*) FROM handover_acknowledgements
           WHERE organization_id=$1 AND handover_id=$2 AND actor_id=$3 AND status='acknowledged'`,
          [organizationId, row.id, actorId],
        );
        if (Number(count.rows[0]?.count) >= row.patient_ids.length) {
          await client.query(
            `UPDATE working_sessions SET current_step_id='prioritize',row_version=row_version+1,updated_at=now()
             WHERE organization_id=$1 AND id=$2`,
            [organizationId, session.id],
          );
          await client.query(
            `UPDATE handover_snapshots SET status='acknowledged'
             WHERE organization_id=$1 AND id=$2 AND receiving_actor_id=$3
               AND status='transferred'`,
            [organizationId, row.id, actorId],
          );
        }
      } else if (command.type === "start-episode") {
        if (command.kind === "planned") {
          const acknowledged = await client.query<{
            patient_count: number;
            acknowledged_count: string;
          }>(
            `WITH target AS (
               SELECT * FROM handover_snapshots
               WHERE organization_id=$1 AND department_id=$2
                 AND content IS NOT NULL AND content_hash=source_hash
                 AND ((shift_key=$3 AND owner_actor_id=$4) OR receiving_actor_id=$4)
               ORDER BY CASE
                 WHEN receiving_actor_id=$4 AND status='transferred' THEN 0
                 WHEN shift_key=$3 AND status IN ('transferred','acknowledged') THEN 1
                 WHEN receiving_actor_id=$4 AND status='acknowledged' THEN 2
                 ELSE 3 END,
                 created_at DESC
               LIMIT 1
               FOR UPDATE
             )
             SELECT cardinality(target.patient_ids) AS patient_count,
                    count(ack.patient_id)::text AS acknowledged_count
             FROM target
             LEFT JOIN handover_acknowledgements ack
               ON ack.organization_id=target.organization_id
              AND ack.handover_id=target.id
              AND ack.actor_id=$4
              AND ack.status='acknowledged'
             GROUP BY target.patient_ids`,
            [
              organizationId,
              session.departmentId,
              configuredWorkday.shiftKey,
              actorId,
            ],
          );
          const row = acknowledged.rows[0];
          if (
            !row ||
            Number(row.acknowledged_count) < Number(row.patient_count)
          )
            throw new Error("HANDOVER_ACKNOWLEDGEMENT_REQUIRED");
        }
        const assignment =
          command.kind === "planned" &&
          configuredWorkday.patientIds.includes(command.patientId)
            ? siteConfiguration.nursingAssignments.find(
                (item) => item.patientId === command.patientId,
              )
            : null;
        if (command.kind === "planned" && !assignment)
          throw new Error("PLANNED_ASSIGNMENT_NOT_FOUND");
        if (command.kind === "planned") {
          const duplicate = await client.query(
            `SELECT id FROM work_episodes
             WHERE organization_id=$1 AND session_id=$2 AND patient_id=$3 AND kind='planned'
             FOR UPDATE`,
            [organizationId, session.id, command.patientId],
          );
          if (duplicate.rowCount)
            throw new Error("PLANNED_EPISODE_ALREADY_EXISTS");
        }
        const active = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND actor_id=$2 AND state='active' FOR UPDATE`,
          [organizationId, actorId],
        );
        if (active.rowCount) throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        const episodeId = randomUUID();
        await client.query(
          `INSERT INTO work_episodes
             (organization_id,id,session_id,actor_id,patient_id,encounter_id,kind,title,state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active')`,
          [
            organizationId,
            episodeId,
            session.id,
            actorId,
            command.patientId,
            command.encounterId,
            command.kind,
            assignment?.title ?? command.title,
          ],
        );
        await client.query(
          `INSERT INTO work_episode_segments (organization_id,episode_id,ordinal,started_at)
           VALUES ($1,$2,1,now())`,
          [organizationId, episodeId],
        );
        await this.setThreadPatientContext(
          client,
          session,
          actorId,
          command.patientId,
          command.encounterId,
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='work',row_version=row_version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
      } else if (command.type === "interrupt-and-start") {
        const changed = await client.query(
          `UPDATE work_episodes SET state='paused',draft_text=$4,row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state='active' RETURNING id`,
          [
            organizationId,
            command.episodeId,
            actorId,
            command.pausedDraftText?.slice(0, 1200) ?? "",
          ],
        );
        if (!changed.rowCount) throw new Error("EPISODE_STATE_CONFLICT");
        await client.query(
          `UPDATE work_episode_segments SET ended_at=now(),end_reason='interruption'
           WHERE organization_id=$1 AND episode_id=$2 AND ordinal=(SELECT max(ordinal) FROM work_episode_segments WHERE organization_id=$1 AND episode_id=$2) AND ended_at IS NULL`,
          [organizationId, command.episodeId],
        );
        const episodeId = randomUUID();
        await client.query(
          `INSERT INTO work_episodes
             (organization_id,id,session_id,actor_id,patient_id,encounter_id,kind,title,state)
           VALUES ($1,$2,$3,$4,$5,$6,'spontaneous',$7,'active')`,
          [
            organizationId,
            episodeId,
            session.id,
            actorId,
            command.patientId,
            command.encounterId,
            command.title,
          ],
        );
        await client.query(
          `INSERT INTO work_episode_segments (organization_id,episode_id,ordinal,started_at)
           VALUES ($1,$2,1,now())`,
          [organizationId, episodeId],
        );
        await this.setThreadPatientContext(
          client,
          session,
          actorId,
          command.patientId,
          command.encounterId,
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='work',row_version=row_version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
      } else if (command.type === "pause-episode") {
        const changed = await client.query(
          `UPDATE work_episodes SET state='paused',row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state='active' RETURNING id`,
          [organizationId, command.episodeId, actorId],
        );
        if (!changed.rowCount) throw new Error("EPISODE_STATE_CONFLICT");
        await client.query(
          `UPDATE work_episode_segments SET ended_at=now(),end_reason=$3
           WHERE organization_id=$1 AND episode_id=$2 AND ordinal=(SELECT max(ordinal) FROM work_episode_segments WHERE organization_id=$1 AND episode_id=$2) AND ended_at IS NULL`,
          [organizationId, command.episodeId, command.reason],
        );
        await client.query(
          `UPDATE work_episodes SET draft_text=$4
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3`,
          [
            organizationId,
            command.episodeId,
            actorId,
            command.draftText?.slice(0, 1200) ?? "",
          ],
        );
      } else if (command.type === "save-episode-draft") {
        const changed = await client.query(
          `UPDATE work_episodes SET draft_text=$4,row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state IN ('active','paused') RETURNING id`,
          [organizationId, command.episodeId, actorId, command.draftText],
        );
        if (!changed.rowCount) throw new Error("EPISODE_STATE_CONFLICT");
      } else if (command.type === "defer-responsibility") {
        const assignment = siteConfiguration.nursingAssignments.find(
          (item) => item.patientId === command.patientId,
        );
        if (
          !assignment ||
          !configuredWorkday.patientIds.includes(command.patientId)
        )
          throw new Error("PLANNED_ASSIGNMENT_NOT_FOUND");
        const active = await client.query(
          `SELECT id FROM work_episodes
           WHERE organization_id=$1 AND actor_id=$2 AND state='active' AND patient_id<>$3`,
          [organizationId, actorId, command.patientId],
        );
        if (active.rowCount) throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        const existing = await client.query<{ id: string; state: string }>(
          `SELECT id,state FROM work_episodes
           WHERE organization_id=$1 AND session_id=$2 AND patient_id=$3 AND kind='planned'
           ORDER BY started_at DESC LIMIT 1 FOR UPDATE`,
          [organizationId, session.id, command.patientId],
        );
        if (existing.rows[0]?.state === "completed")
          throw new Error("RESPONSIBILITY_ALREADY_COMPLETED");
        const episodeId = existing.rows[0]?.id ?? randomUUID();
        if (existing.rows[0]) {
          await client.query(
            `UPDATE work_episodes SET state='deferred',completed_at=now(),row_version=row_version+1
             WHERE organization_id=$1 AND id=$2`,
            [organizationId, episodeId],
          );
          await client.query(
            `UPDATE work_episode_segments SET ended_at=COALESCE(ended_at,now()),end_reason=COALESCE(end_reason,'pause')
             WHERE organization_id=$1 AND episode_id=$2 AND ended_at IS NULL`,
            [organizationId, episodeId],
          );
        } else {
          await client.query(
            `INSERT INTO work_episodes
               (organization_id,id,session_id,actor_id,patient_id,encounter_id,kind,title,state,completed_at)
             VALUES ($1,$2,$3,$4,$5,$6,'planned',$7,'deferred',now())`,
            [
              organizationId,
              episodeId,
              session.id,
              actorId,
              command.patientId,
              command.encounterId,
              assignment.title,
            ],
          );
        }
        await client.query(
          `INSERT INTO responsibility_transfers
             (organization_id,id,session_id,patient_id,encounter_id,from_actor_id,to_actor_id,reason,state)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
           ON CONFLICT (organization_id,session_id,patient_id)
           DO UPDATE SET to_actor_id=EXCLUDED.to_actor_id,reason=EXCLUDED.reason,state='pending',acknowledged_at=NULL`,
          [
            organizationId,
            randomUUID(),
            session.id,
            command.patientId,
            command.encounterId,
            actorId,
            command.receivingActorId,
            command.reason,
          ],
        );
      } else if (command.type === "acknowledge-transfer") {
        const changed = await client.query(
          `UPDATE responsibility_transfers SET state='acknowledged',acknowledged_at=now()
           WHERE organization_id=$1 AND id=$2 AND to_actor_id=$3 AND state='pending' RETURNING id`,
          [organizationId, command.transferId, actorId],
        );
        if (!changed.rowCount) throw new Error("TRANSFER_NOT_FOUND");
      } else if (command.type === "resume-episode") {
        const active = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND actor_id=$2 AND state='active' FOR UPDATE`,
          [organizationId, actorId],
        );
        if (active.rowCount) throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        const changed = await client.query<{
          patient_id: string;
          encounter_id: string;
        }>(
          `UPDATE work_episodes SET state='active',row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state='paused' RETURNING id,patient_id,encounter_id`,
          [organizationId, command.episodeId, actorId],
        );
        const resumed = changed.rows[0];
        if (!resumed) throw new Error("EPISODE_STATE_CONFLICT");
        await this.setThreadPatientContext(
          client,
          session,
          actorId,
          resumed.patient_id,
          resumed.encounter_id,
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='work',row_version=row_version+1,updated_at=now()
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
        await client.query(
          `INSERT INTO work_episode_segments (organization_id,episode_id,ordinal,started_at)
           SELECT $1,$2,COALESCE(max(ordinal),0)+1,now() FROM work_episode_segments WHERE organization_id=$1 AND episode_id=$2`,
          [organizationId, command.episodeId],
        );
      } else if (command.type === "complete-episode") {
        if (command.evidence.trim().length < 10)
          throw new Error("COMPLETION_EVIDENCE_REQUIRED");
        const episode = await client.query(
          `UPDATE work_episodes SET state='completed',completed_at=now(),completion_evidence=$4,row_version=row_version+1
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3 AND state='active' RETURNING *`,
          [organizationId, command.episodeId, actorId, command.evidence.trim()],
        );
        if (!episode.rowCount) throw new Error("EPISODE_STATE_CONFLICT");
        await client.query(
          `UPDATE work_episode_segments SET ended_at=COALESCE(ended_at,now()),end_reason=COALESCE(end_reason,'complete')
           WHERE organization_id=$1 AND episode_id=$2 AND ended_at IS NULL`,
          [organizationId, command.episodeId],
        );
        const row = episode.rows[0] as { id: string; patient_id: string };
        await client.query(
          `INSERT INTO service_evidence
             (organization_id,id,episode_id,actor_id,patient_id,actual_started_at,actual_ended_at,interruption_seconds,review_status)
           SELECT $1,$2,$3,$4,$5,min(started_at),max(ended_at),
             GREATEST(0, EXTRACT(EPOCH FROM (max(ended_at)-min(started_at)))::integer -
               COALESCE(sum(EXTRACT(EPOCH FROM (ended_at-started_at)))::integer,0)),
             'draft'
           FROM work_episode_segments
           WHERE organization_id=$1 AND episode_id=$3 AND ended_at IS NOT NULL
           ON CONFLICT (organization_id,episode_id) DO NOTHING`,
          [organizationId, randomUUID(), row.id, actorId, row.patient_id],
        );
      } else if (command.type === "close-shift") {
        const active = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND actor_id=$2 AND state='active'`,
          [organizationId, actorId],
        );
        if (active.rowCount) throw new Error("ACTIVE_EPISODE_REQUIRES_PAUSE");
        const paused = await client.query(
          `SELECT id FROM work_episodes WHERE organization_id=$1 AND session_id=$2 AND state='paused'`,
          [organizationId, session.id],
        );
        if (paused.rowCount)
          throw new Error("PAUSED_EPISODE_REQUIRES_RESOLUTION");
        const unresolved = await client.query(
          `SELECT assigned.patient_id
           FROM unnest((SELECT patient_ids FROM handover_snapshots
                        WHERE organization_id=$1 AND department_id=$2 AND shift_key=$4
                          AND owner_actor_id=$5
                        ORDER BY created_at DESC LIMIT 1)) AS assigned(patient_id)
           WHERE NOT EXISTS (
             SELECT 1 FROM work_episodes AS completed_episode
             WHERE completed_episode.organization_id=$1 AND completed_episode.session_id=$3
               AND completed_episode.patient_id=assigned.patient_id
               AND completed_episode.kind='planned'
               AND completed_episode.state IN ('completed','deferred')
           )`,
          [
            organizationId,
            session.departmentId,
            session.id,
            configuredWorkday.shiftKey,
            actorId,
          ],
        );
        if (unresolved.rowCount)
          throw new Error("PLANNED_RESPONSIBILITY_REQUIRES_RESOLUTION");
        await client.query(
          `UPDATE handover_snapshots SET status='transferred',receiving_actor_id=$3
           WHERE organization_id=$1 AND department_id=$2 AND shift_key=$4
             AND owner_actor_id=$5 AND status='open'`,
          [
            organizationId,
            session.departmentId,
            configuredWorkday.shift.nextResponsibleActorId,
            configuredWorkday.shiftKey,
            actorId,
          ],
        );
        await client.query(
          `UPDATE working_sessions SET current_step_id='complete',status='completed',completed_at=now(),row_version=row_version+1
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, session.id],
        );
      }
      await client.query(
        `INSERT INTO domain_events (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'working-session',$2,$3,$4,$5)`,
        [
          organizationId,
          session.id,
          `Workday:${command.type}`,
          { actorId },
          { command: command.type },
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.getWorkday(actorId, role);
  }
  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_entries
         (organization_id,actor_id,actor_role,action,outcome,patient_id,purpose,detail,previous_hash,entry_hash,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (organization_id,entry_hash) DO NOTHING`,
      [
        organizationId,
        entry.actorId,
        entry.actorRole,
        entry.action,
        entry.outcome,
        entry.patientId,
        entry.purpose,
        entry.detail,
        entry.previousHash,
        entry.hash,
        entry.occurredAt,
      ],
    );
  }
  async appendUiInvalidation(
    actorId: string,
    payload: Record<string, unknown>,
  ): Promise<number> {
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO domain_events
         (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
       VALUES ($1,'ui-session',$2,'snapshot-invalidated',$3::jsonb,$4::jsonb)
       RETURNING id::text`,
      [
        organizationId,
        actorId,
        JSON.stringify({ actorIds: [actorId] }),
        JSON.stringify(payload),
      ],
    );
    return Number(result.rows[0]!.id);
  }
  async listUiEventsAfter(
    actorId: string,
    afterId: number,
    limit = 100,
  ): Promise<DurableUiEvent[]> {
    const result = await this.pool.query<{
      id: string;
      event_type: string;
      payload: Record<string, unknown>;
      occurred_at: Date | string;
    }>(
      `SELECT id::text,event_type,payload,occurred_at
       FROM domain_events
       WHERE organization_id=$1 AND id>$2 AND audience @> $3::jsonb
       ORDER BY id ASC LIMIT $4`,
      [organizationId, afterId, JSON.stringify({ actorIds: [actorId] }), limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      eventType: row.event_type,
      payload: row.payload,
      occurredAt:
        row.occurred_at instanceof Date
          ? row.occurred_at.toISOString()
          : String(row.occurred_at),
    }));
  }
  async storeIntentAuthority(input: {
    tokenHash: string;
    record: DurableIntentRecord;
    sessionId: string;
    threadId: string;
    contextRevision: number;
    responseId: string;
    reviewItems: unknown[];
    clientContextId?: string;
  }): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const proposalPayload = {
        actorId: input.record.actorId,
        patientId: input.record.patientId,
        encounterId: input.record.encounterId,
        contextRevision: input.contextRevision,
        responseId: input.responseId,
        command: input.record.command,
        payload: input.record.payload,
        resourceVersion: input.record.resourceVersion,
        purpose: input.record.purpose,
        reviewItems: input.reviewItems,
        clientContextId: input.clientContextId ?? null,
      };
      const proposalHash = createHash("sha256")
        .update(JSON.stringify(proposalPayload))
        .digest("hex");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${organizationId}:authority:${input.tokenHash}`],
      );
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [
          `${organizationId}:${input.record.actorId}:proposal:${input.threadId}:${input.record.patientId}:${input.record.encounterId}`,
        ],
      );
      const boundContext = input.clientContextId
        ? await client.query(
            `SELECT 1
             FROM assistant_client_contexts c
             JOIN working_sessions s
               ON s.organization_id=c.organization_id AND s.id=c.session_id
             JOIN assistant_threads t
               ON t.organization_id=c.organization_id AND t.id=c.thread_id
             WHERE c.organization_id=$1 AND c.id=$2 AND c.actor_id=$3
               AND c.effective_role=$4 AND c.session_id=$5 AND c.thread_id=$6
               AND c.context_revision=$7 AND c.patient_id=$8
               AND c.encounter_id=$9 AND c.expires_at > now()
               AND s.status='active' AND t.site_id=$10
               AND t.thread_type='patient-assistant' AND t.expires_at > now()`,
            [
              organizationId,
              input.clientContextId,
              input.record.actorId,
              input.record.actorRole,
              input.sessionId,
              input.threadId,
              input.contextRevision,
              input.record.patientId,
              input.record.encounterId,
              siteConfiguration.siteId,
            ],
          )
        : await client.query(
            `SELECT 1
             FROM working_sessions s
             JOIN assistant_threads t
               ON t.organization_id=s.organization_id AND t.id=s.assistant_thread_id
             WHERE s.organization_id=$1 AND s.id=$2 AND s.actor_id=$3
               AND s.assistant_thread_id=$4 AND s.status='active'
               AND t.site_id=$5 AND t.thread_type='patient-assistant'
               AND t.context_revision=$6 AND t.patient_id=$7
               AND t.subject_encounter_id=$8 AND t.expires_at > now()`,
            [
              organizationId,
              input.sessionId,
              input.record.actorId,
              input.threadId,
              siteConfiguration.siteId,
              input.contextRevision,
              input.record.patientId,
              input.record.encounterId,
            ],
          );
      if (boundContext.rowCount !== 1)
        throw new Error("ASSISTANT_CONTEXT_STALE");
      const existingAuthority = await client.query<{
        proposal_hash: string | null;
      }>(
        `SELECT proposal_hash FROM safety_authority
         WHERE organization_id=$1 AND token_hash=$2 FOR UPDATE`,
        [organizationId, input.tokenHash],
      );
      if (existingAuthority.rows[0]) {
        if (existingAuthority.rows[0].proposal_hash !== proposalHash)
          throw new Error("INTENT_AUTHORITY_TOKEN_CONFLICT");
        await client.query("COMMIT");
        return;
      }
      const prior = await client.query<{
        id: string;
        revision: number;
        proposal_hash: string;
        status: "pending" | "superseded" | "consumed" | "expired";
      }>(
        `SELECT id,revision,proposal_hash,status FROM assistant_proposal_revisions
         WHERE organization_id=$1 AND actor_id=$2 AND thread_id=$3
           AND patient_id=$4 AND encounter_id=$5
         ORDER BY revision DESC,created_at DESC LIMIT 1 FOR UPDATE`,
        [
          organizationId,
          input.record.actorId,
          input.threadId,
          input.record.patientId,
          input.record.encounterId,
        ],
      );
      const samePendingProposal =
        prior.rows[0]?.status === "pending" &&
        prior.rows[0].proposal_hash === proposalHash;
      const proposalId = samePendingProposal ? prior.rows[0]!.id : randomUUID();
      if (prior.rows[0]?.status === "pending" && !samePendingProposal)
        await client.query(
          `UPDATE assistant_proposal_revisions SET status='superseded'
           WHERE organization_id=$1 AND id=$2 AND status='pending'`,
          [organizationId, prior.rows[0].id],
        );
      if (!samePendingProposal)
        await client.query(
          `INSERT INTO assistant_proposal_revisions
           (organization_id,id,actor_id,session_id,thread_id,context_revision,patient_id,encounter_id,source_response_id,revision,proposal_hash,payload,review_items,status,supersedes_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14)`,
          [
            organizationId,
            proposalId,
            input.record.actorId,
            input.sessionId,
            input.threadId,
            input.contextRevision,
            input.record.patientId,
            input.record.encounterId,
            input.responseId,
            (prior.rows[0]?.revision ?? 0) + 1,
            proposalHash,
            proposalPayload,
            JSON.stringify(input.reviewItems),
            prior.rows[0]?.id ?? null,
          ],
        );
      await client.query(
        `INSERT INTO safety_authority
           (organization_id,token_hash,authority_type,actor_id,session_id,thread_id,context_revision,patient_id,binding,proposal_revision_id,proposal_hash,expires_at,client_context_id)
         VALUES ($1,$2,'intent',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         `,
        [
          organizationId,
          input.tokenHash,
          input.record.actorId,
          input.sessionId,
          input.threadId,
          input.contextRevision,
          input.record.patientId,
          input.record,
          proposalId,
          proposalHash,
          new Date(input.record.expiresAt),
          input.clientContextId ?? null,
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async loadIntentAuthority(input: {
    tokenHash: string;
    actorId: string;
    sessionId: string;
    threadId: string;
    contextRevision: number;
    patientId: string;
    encounterId: string;
    clientContextId?: string;
  }): Promise<DurableIntentRecord | null> {
    const result = await this.pool.query<{ binding: DurableIntentRecord }>(
      `SELECT a.binding FROM safety_authority a
       JOIN assistant_proposal_revisions p
         ON p.organization_id=a.organization_id AND p.id=a.proposal_revision_id
       WHERE a.organization_id=$1 AND a.token_hash=$2 AND a.authority_type='intent'
         AND a.actor_id=$3 AND a.session_id=$4 AND a.thread_id=$5
         AND a.context_revision=$6 AND a.patient_id=$7
         AND a.binding->>'encounterId'=$8
         AND ($9::uuid IS NULL OR (
           a.client_context_id=$9 AND EXISTS (
             SELECT 1 FROM assistant_client_contexts c
             WHERE c.organization_id=a.organization_id AND c.id=$9
               AND c.actor_id=$3 AND c.session_id=$4 AND c.thread_id=$5
               AND c.context_revision=$6 AND c.patient_id=$7
               AND c.encounter_id=$8 AND c.expires_at > now()
           )
         ))
         AND a.consumed_at IS NULL AND a.expires_at > now()
         AND p.status='pending' AND p.proposal_hash=a.proposal_hash`,
      [
        organizationId,
        input.tokenHash,
        input.actorId,
        input.sessionId,
        input.threadId,
        input.contextRevision,
        input.patientId,
        input.encounterId,
        input.clientContextId ?? null,
      ],
    );
    return result.rows[0]?.binding
      ? structuredClone(result.rows[0].binding)
      : null;
  }
  async consumeIntentAuthority(tokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `WITH consumed AS (
         UPDATE safety_authority SET consumed_at=now()
         WHERE organization_id=$1 AND token_hash=$2 AND authority_type='intent'
           AND consumed_at IS NULL AND expires_at > now()
         RETURNING proposal_revision_id
       )
       UPDATE assistant_proposal_revisions p
       SET status='consumed',consumed_at=now()
       FROM consumed
       WHERE p.organization_id=$1 AND p.id=consumed.proposal_revision_id
         AND p.status='pending'
       RETURNING p.id`,
      [organizationId, tokenHash],
    );
    return Boolean(result.rowCount);
  }
  async acceptIntentCommand(
    input: LocalIntentAcceptance,
  ): Promise<AcceptedCommandReceipt> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${organizationId}:accepted-command:${input.commandKey}`],
      );
      const prior = await client.query<{
        id: string;
        request_hash: string;
        status_code: number;
        result_payload: unknown;
      }>(
        `SELECT id::text,request_hash,status_code,result_payload
         FROM accepted_commands
         WHERE organization_id=$1 AND command_key=$2 FOR UPDATE`,
        [organizationId, input.commandKey],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== input.requestHash)
          throw new DomainError(
            "INVALID_STATE",
            "Befehls-ID wurde bereits mit einem anderen Inhalt verwendet.",
            409,
          );
        await client.query("COMMIT");
        return {
          id: prior.rows[0].id,
          statusCode: prior.rows[0].status_code,
          payload: structuredClone(prior.rows[0].result_payload),
          replayed: true,
        };
      }
      if (input.clientContextId) {
        const lockedContext = await client.query(
          `SELECT 1 FROM assistant_client_contexts
           WHERE organization_id=$1 AND id=$2 AND actor_id=$3
             AND effective_role=$4 AND session_id=$5 AND thread_id=$6
             AND context_revision=$7 AND patient_id=$8 AND encounter_id=$9
             AND expires_at > now()
           FOR UPDATE`,
          [
            organizationId,
            input.clientContextId,
            input.actorId,
            input.actorRole,
            input.sessionId,
            input.threadId,
            input.contextRevision,
            input.patientId,
            input.encounterId,
          ],
        );
        if (lockedContext.rowCount !== 1)
          throw new DomainError(
            "AUTH_DENIED",
            "Browserkontext ist abgelaufen oder wurde gewechselt.",
            403,
          );
      }
      const authority = await client.query<{
        binding: DurableIntentRecord;
        proposal_revision_id: string;
        proposal_hash: string;
        review_items: unknown;
        workflow_template_id: string;
        workflow_version: number;
      }>(
        `SELECT a.binding,a.proposal_revision_id::text,a.proposal_hash,
                p.review_items,s.workflow_template_id,s.workflow_version
         FROM safety_authority a
         JOIN assistant_proposal_revisions p
           ON p.organization_id=a.organization_id AND p.id=a.proposal_revision_id
         JOIN working_sessions s
           ON s.organization_id=a.organization_id AND s.id=a.session_id
         JOIN assistant_threads t
           ON t.organization_id=a.organization_id AND t.id=a.thread_id
         LEFT JOIN assistant_client_contexts c
           ON c.organization_id=a.organization_id AND c.id=a.client_context_id
         WHERE a.organization_id=$1 AND a.token_hash=$2
           AND a.authority_type='intent' AND a.actor_id=$3
           AND a.session_id=$4 AND a.thread_id=$5
           AND a.context_revision=$6 AND a.patient_id=$7
           AND a.binding->>'encounterId'=$8
           AND a.consumed_at IS NULL AND a.expires_at > now()
           AND p.status='pending' AND p.proposal_hash=a.proposal_hash
           AND s.status='active' AND s.actor_id=$3
           AND (
             ($9::uuid IS NOT NULL AND a.client_context_id=$9
               AND c.actor_id=$3 AND c.effective_role=$10
               AND c.session_id=$4 AND c.thread_id=$5
               AND c.context_revision=$6 AND c.patient_id=$7
               AND c.encounter_id=$8 AND c.expires_at > now())
             OR
             ($9::uuid IS NULL AND a.client_context_id IS NULL
               AND s.assistant_thread_id=$5 AND t.context_revision=$6)
           )
           AND t.site_id=$11 AND t.department_id=$12
           AND t.patient_id=$7
           AND t.subject_encounter_id=$8
         FOR UPDATE OF a,p,s,t`,
        [
          organizationId,
          input.tokenHash,
          input.actorId,
          input.sessionId,
          input.threadId,
          input.contextRevision,
          input.patientId,
          input.encounterId,
          input.clientContextId ?? null,
          input.actorRole,
          siteConfiguration.siteId,
          departmentId,
        ],
      );
      const bound = authority.rows[0];
      if (
        !bound ||
        bound.binding.actorId !== input.actorId ||
        bound.binding.purpose !== input.purpose ||
        bound.binding.patientId !== input.patientId ||
        bound.binding.encounterId !== input.encounterId ||
        bound.binding.resourceVersion !== input.resourceVersion
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Assistenzaktion ist ungültig, abgelaufen oder bereits verwendet.",
          403,
        );
      const reviewItems: unknown[] = Array.isArray(bound.review_items)
        ? (bound.review_items as unknown[])
        : [];
      const reviewIds = new Set(
        reviewItems.flatMap((item): string[] => {
          if (!item || typeof item !== "object" || !("id" in item)) return [];
          const id = (item as { id?: unknown }).id;
          return typeof id === "string" ? [id] : [];
        }),
      );
      if (input.selectedActionIds.some((id) => !reviewIds.has(id)))
        throw new DomainError(
          "AUTH_DENIED",
          "Die bestätigte Auswahl gehört nicht zur geprüften Änderung.",
          403,
        );

      const acceptedCommandId = randomUUID();
      await client.query(
        `INSERT INTO accepted_commands
           (organization_id,id,command_key,request_hash,actor_id,actor_role,site_id,
            department_id,purpose,patient_id,encounter_id,session_id,thread_id,
            context_revision,workflow_template_id,workflow_version,policy_version,
            proposal_revision_id,proposal_hash,selected_action_ids,source_read_set,
            result_payload,status_code,state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18,$19,$20,$21,$22,$23,'delivery-pending')`,
        [
          organizationId,
          acceptedCommandId,
          input.commandKey,
          input.requestHash,
          input.actorId,
          input.actorRole,
          siteConfiguration.siteId,
          departmentId,
          input.purpose,
          input.patientId,
          input.encounterId,
          input.sessionId,
          input.threadId,
          input.contextRevision,
          bound.workflow_template_id,
          bound.workflow_version,
          input.policyVersion,
          bound.proposal_revision_id,
          bound.proposal_hash,
          JSON.stringify(input.selectedActionIds),
          JSON.stringify(input.sourceReadSet),
          JSON.stringify(input.resultPayload),
          input.statusCode,
        ],
      );
      await client.query(
        `UPDATE safety_authority SET consumed_at=now()
         WHERE organization_id=$1 AND token_hash=$2 AND consumed_at IS NULL`,
        [organizationId, input.tokenHash],
      );
      await client.query(
        `UPDATE assistant_proposal_revisions
         SET status='consumed',consumed_at=now()
         WHERE organization_id=$1 AND id=$2 AND status='pending'`,
        [organizationId, bound.proposal_revision_id],
      );
      await client.query(
        `INSERT INTO command_receipts
           (organization_id,command_key,request_hash,status_code,result_ref,expires_at)
         VALUES ($1,$2,$3,$4,$5,now()+interval '30 days')`,
        [
          organizationId,
          input.commandKey,
          input.requestHash,
          input.statusCode,
          JSON.stringify({
            acceptedCommandId,
            payload: input.resultPayload,
          }),
        ],
      );
      for (const entry of input.auditEntries)
        await client.query(
          `INSERT INTO audit_entries
             (organization_id,actor_id,actor_role,action,outcome,patient_id,purpose,
              detail,previous_hash,entry_hash,occurred_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT (organization_id,entry_hash) DO NOTHING`,
          [
            organizationId,
            entry.actorId,
            entry.actorRole,
            entry.action,
            entry.outcome,
            entry.patientId,
            entry.purpose,
            entry.detail,
            entry.previousHash,
            entry.hash,
            entry.occurredAt,
          ],
        );
      await client.query(
        `INSERT INTO domain_events
           (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'accepted-command',$2,'CommandLocallyAccepted',$3,$4)`,
        [
          organizationId,
          acceptedCommandId,
          JSON.stringify({ actorIds: [input.actorId] }),
          JSON.stringify({ acceptedCommandId }),
        ],
      );
      const episodeEvidence = input.episodeEvidence?.trim().slice(0, 1200);
      if (episodeEvidence)
        await client.query(
          `UPDATE work_episodes
           SET draft_text=CASE
                 WHEN position($6 in draft_text)>0 THEN draft_text
                 WHEN draft_text='' THEN $6
                 ELSE left(draft_text || E'\n' || $6,1200)
               END,
               row_version=row_version+1
           WHERE organization_id=$1 AND actor_id=$2 AND session_id=$3
             AND patient_id=$4 AND encounter_id=$5 AND state='active'`,
          [
            organizationId,
            input.actorId,
            input.sessionId,
            input.patientId,
            input.encounterId,
            episodeEvidence,
          ],
        );
      await client.query(
        `INSERT INTO clinical_projection_outbox
           (organization_id,id,accepted_command_id,idempotency_key,payload,state)
         VALUES ($1,$2,$3,$4,$5,'pending')`,
        [
          organizationId,
          randomUUID(),
          acceptedCommandId,
          `clinical:${acceptedCommandId}`,
          JSON.stringify({
            resources: input.clinicalResources,
            removedReferences: input.removedReferences,
            expectedVersions: input.clinicalExpectedVersions,
            checkpoint: input.checkpoint,
          }),
        ],
      );
      const authorityEnvelope = {
        acceptedCommandId,
        organizationId,
        siteId: siteConfiguration.siteId,
        departmentId,
        actorId: input.actorId,
        actorRole: input.actorRole,
        purpose: input.purpose,
        patientId: input.patientId,
        encounterId: input.encounterId,
        sessionId: input.sessionId,
        threadId: input.threadId,
        contextRevision: input.contextRevision,
        proposalRevisionId: bound.proposal_revision_id,
        proposalHash: bound.proposal_hash,
        policyVersion: input.policyVersion,
        acceptedAt: new Date().toISOString(),
      };
      for (const pending of input.providerCommands) {
        const payload = providerOutboxPayloadSchema.parse({
          schemaVersion: 1,
          command: pending.command,
          retrySafety: pending.retrySafety,
        });
        const outboxId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO provider_outbox
             (organization_id,id,provider_id,profile_id,operation,idempotency_key,
              payload,state,accepted_command_id,authority_envelope)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9)
           ON CONFLICT (organization_id,provider_id,profile_id,idempotency_key)
           DO NOTHING RETURNING id`,
          [
            organizationId,
            outboxId,
            pending.provider,
            pending.profile,
            pending.command.operation,
            pending.command.idempotencyKey,
            payload,
            acceptedCommandId,
            authorityEnvelope,
          ],
        );
        if (!inserted.rowCount) {
          const existing = await client.query<{ payload: unknown }>(
            `SELECT payload FROM provider_outbox
             WHERE organization_id=$1 AND provider_id=$2 AND profile_id=$3
               AND idempotency_key=$4`,
            [
              organizationId,
              pending.provider,
              pending.profile,
              pending.command.idempotencyKey,
            ],
          );
          if (
            canonicalJson(existing.rows[0]?.payload) !== canonicalJson(payload)
          )
            throw new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
        }
      }
      await client.query("COMMIT");
      return {
        id: acceptedCommandId,
        statusCode: input.statusCode,
        payload: structuredClone(input.resultPayload),
        replayed: false,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async loadAcceptedCommandReceipt(
    commandKey: string,
    requestHash: string,
  ): Promise<AcceptedCommandReceipt | null> {
    const result = await this.pool.query<{
      id: string;
      request_hash: string;
      status_code: number;
      result_payload: unknown;
    }>(
      `SELECT id::text,request_hash,status_code,result_payload
       FROM accepted_commands WHERE organization_id=$1 AND command_key=$2`,
      [organizationId, commandKey],
    );
    const row = result.rows[0];
    if (!row) {
      const operational = await this.pool.query<{
        request_hash: string;
        status_code: number;
        result_ref: { acceptedCommandId?: unknown; payload?: unknown };
      }>(
        `SELECT request_hash,status_code,result_ref
         FROM command_receipts
         WHERE organization_id=$1 AND command_key=$2 AND expires_at > now()`,
        [organizationId, commandKey],
      );
      const receipt = operational.rows[0];
      if (!receipt) return null;
      if (receipt.request_hash !== requestHash)
        throw new DomainError(
          "INVALID_STATE",
          "Befehls-ID wurde bereits mit einem anderen Inhalt verwendet.",
          409,
        );
      return {
        id:
          typeof receipt.result_ref?.acceptedCommandId === "string"
            ? receipt.result_ref.acceptedCommandId
            : commandKey,
        statusCode: receipt.status_code,
        payload: structuredClone(receipt.result_ref?.payload),
        replayed: true,
      };
    }
    if (row.request_hash !== requestHash)
      throw new DomainError(
        "INVALID_STATE",
        "Befehls-ID wurde bereits mit einem anderen Inhalt verwendet.",
        409,
      );
    return {
      id: row.id,
      statusCode: row.status_code,
      payload: structuredClone(row.result_payload),
      replayed: true,
    };
  }
  async loadLatestAcceptedCheckpoint(): Promise<ServiceCheckpoint | null> {
    const result = await this.pool.query<{
      payload: { checkpoint?: unknown };
    }>(
      `SELECT c.payload
       FROM clinical_projection_outbox c
       JOIN accepted_commands a
         ON a.organization_id=c.organization_id AND a.id=c.accepted_command_id
       WHERE c.organization_id=$1
       ORDER BY a.accepted_at DESC,a.id DESC LIMIT 1`,
      [organizationId],
    );
    const checkpoint = result.rows[0]?.payload.checkpoint;
    if (!checkpoint) return null;
    return structuredClone(checkpoint) as ServiceCheckpoint;
  }
  async claimClinicalProjection(input: {
    workerId: string;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ClinicalProjectionJob | null> {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);
    const result = await this.pool.query<{
      id: string;
      accepted_command_id: string;
      idempotency_key: string;
      payload: {
        resources: Resource[];
        removedReferences: string[];
        expectedVersions: Record<string, string | null>;
        checkpoint: ServiceCheckpoint;
      };
      attempts: number;
    }>(
      `WITH candidate AS (
         SELECT o.organization_id,o.id FROM clinical_projection_outbox o
         WHERE o.organization_id=$1 AND (
           (o.state IN ('pending','retry') AND o.next_attempt_at <= $2)
           OR (o.state='leased' AND o.lease_expires_at <= $2)
         ) AND NOT EXISTS (
           SELECT 1 FROM clinical_projection_outbox earlier
           WHERE earlier.organization_id=o.organization_id
             AND earlier.state <> 'delivered'
             AND (earlier.created_at < o.created_at OR
               (earlier.created_at=o.created_at AND earlier.id::text < o.id::text))
         )
         ORDER BY o.created_at,o.id FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE clinical_projection_outbox o
       SET state='leased',attempts=o.attempts+1,lease_owner=$3,
           lease_expires_at=$4,last_error_class=NULL
       FROM candidate c
       WHERE o.organization_id=c.organization_id AND o.id=c.id
       RETURNING o.id::text,o.accepted_command_id::text,o.idempotency_key,
                 o.payload,o.attempts`,
      [organizationId, now, input.workerId, leaseExpiresAt],
    );
    const row = result.rows[0];
    if (!row) return null;
    const payload = row.payload;
    const references = [
      ...(Array.isArray(payload?.resources)
        ? payload.resources.map(
            (resource) => `${resource.resourceType}/${resource.id}`,
          )
        : []),
      ...(Array.isArray(payload?.removedReferences)
        ? payload.removedReferences
        : []),
    ];
    const validPayload =
      Array.isArray(payload?.resources) &&
      Array.isArray(payload?.removedReferences) &&
      payload.expectedVersions !== null &&
      typeof payload.expectedVersions === "object" &&
      payload.checkpoint?.formatVersion === 1 &&
      references.every(
        (reference) =>
          Object.hasOwn(payload.expectedVersions, reference) &&
          (payload.expectedVersions[reference] === null ||
            typeof payload.expectedVersions[reference] === "string"),
      );
    if (!validPayload) {
      await this.failClinicalProjection({
        jobId: row.id,
        workerId: input.workerId,
        errorCode: "CLINICAL_OUTBOX_PAYLOAD_INVALID",
        retryAt: null,
      });
      return null;
    }
    return {
      id: row.id,
      acceptedCommandId: row.accepted_command_id,
      idempotencyKey: row.idempotency_key,
      resources: structuredClone(payload.resources),
      removedReferences: [...payload.removedReferences],
      expectedVersions: structuredClone(payload.expectedVersions),
      checkpoint: structuredClone(payload.checkpoint),
      attempts: Number(row.attempts),
    };
  }
  async finishClinicalProjection(input: {
    jobId: string;
    workerId: string;
  }): Promise<void> {
    const result = await this.pool.query(
      `WITH projected AS (
         UPDATE clinical_projection_outbox
         SET state='delivered',lease_owner=NULL,lease_expires_at=NULL,
             delivered_at=now(),last_error_class=NULL
         WHERE organization_id=$1 AND id=$2 AND state='leased' AND lease_owner=$3
         RETURNING accepted_command_id
       )
       UPDATE accepted_commands a SET state=CASE
         WHEN a.state='manual-review' OR EXISTS (
           SELECT 1 FROM clinical_projection_outbox c
           WHERE c.organization_id=a.organization_id
             AND c.accepted_command_id=a.id AND c.state='manual'
         ) OR EXISTS (
           SELECT 1 FROM provider_outbox p
           WHERE p.organization_id=a.organization_id
             AND p.accepted_command_id=a.id AND p.state='manual'
         ) THEN 'manual-review'
         WHEN EXISTS (
           SELECT 1 FROM provider_outbox p
           WHERE p.organization_id=a.organization_id
             AND p.accepted_command_id=a.id AND p.state<>'delivered'
         ) THEN 'delivery-pending' ELSE 'delivered' END
       FROM projected
       WHERE a.organization_id=$1 AND a.id=projected.accepted_command_id
       RETURNING a.id`,
      [organizationId, input.jobId, input.workerId],
    );
    if (!result.rowCount) throw new Error("CLINICAL_PROJECTION_LEASE_LOST");
  }
  async failClinicalProjection(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    retryAt: Date | null;
  }): Promise<void> {
    const result = await this.pool.query(
      `WITH failed AS (
         UPDATE clinical_projection_outbox
         SET state=$4,next_attempt_at=COALESCE($5,next_attempt_at),
             lease_owner=NULL,lease_expires_at=NULL,last_error_class=$6
         WHERE organization_id=$1 AND id=$2 AND state='leased' AND lease_owner=$3
         RETURNING accepted_command_id
       ), marked AS (
         UPDATE accepted_commands a SET state='manual-review'
         FROM failed
         WHERE $4='manual' AND a.organization_id=$1
           AND a.id=failed.accepted_command_id
         RETURNING a.id
       )
       SELECT accepted_command_id FROM failed`,
      [
        organizationId,
        input.jobId,
        input.workerId,
        input.retryAt ? "retry" : "manual",
        input.retryAt,
        input.errorCode,
      ],
    );
    if (result.rowCount !== 1)
      throw new Error("CLINICAL_PROJECTION_LEASE_LOST");
  }
  async manualClinicalProjectionHead(): Promise<ManualClinicalProjectionHold | null> {
    const result = await this.pool.query<{
      id: string;
      accepted_command_id: string;
      last_error_class: string | null;
      attempts: number;
      created_at: Date | string;
    }>(
      `SELECT id::text,accepted_command_id::text,last_error_class,attempts,created_at
       FROM clinical_projection_outbox
       WHERE organization_id=$1 AND state <> 'delivered'
       ORDER BY created_at,id LIMIT 1`,
      [organizationId],
    );
    const row = result.rows[0];
    if (!row || !row.last_error_class) return null;
    const state = await this.pool.query<{ state: string }>(
      `SELECT state FROM clinical_projection_outbox
       WHERE organization_id=$1 AND id=$2`,
      [organizationId, row.id],
    );
    if (state.rows[0]?.state !== "manual") return null;
    return {
      jobId: row.id,
      acceptedCommandId: row.accepted_command_id,
      errorCode: row.last_error_class,
      attempts: Number(row.attempts),
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at),
    };
  }
  async recoverManualClinicalProjection(input: {
    actorId: string;
    actorRole: Role;
    jobId: string;
    expectedErrorCode: string;
    commandKey: string;
    requestHash: string;
    auditEntry: AuditEntry;
  }): Promise<ClinicalProjectionRecoveryReceipt> {
    if (input.actorRole !== "it")
      throw new DomainError(
        "AUTH_DENIED",
        "Nur IT darf eine klinische Projektion erneut einreihen.",
        403,
      );
    if (
      input.auditEntry.actorId !== input.actorId ||
      input.auditEntry.actorRole !== input.actorRole ||
      input.auditEntry.action !== "clinical-projection:retry" ||
      input.auditEntry.purpose !== "operations" ||
      input.auditEntry.outcome !== "success"
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Der Betriebsnachweis ist nicht an diese Freigabe gebunden.",
        403,
      );
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`${organizationId}:operator-command:${input.commandKey}`],
      );
      const prior = await client.query<{
        request_hash: string;
        status_code: number;
        result_ref: { payload?: ClinicalProjectionRecoveryReceipt };
      }>(
        `SELECT request_hash,status_code,result_ref
         FROM command_receipts
         WHERE organization_id=$1 AND command_key=$2 AND expires_at > now()
         FOR UPDATE`,
        [organizationId, input.commandKey],
      );
      const priorReceipt = prior.rows[0];
      if (priorReceipt) {
        if (priorReceipt.request_hash !== input.requestHash)
          throw new DomainError(
            "INVALID_STATE",
            "Befehls-ID wurde bereits mit einem anderen Inhalt verwendet.",
            409,
          );
        if (!priorReceipt.result_ref?.payload)
          throw new DomainError(
            "INVALID_STATE",
            "Der gespeicherte Betriebsbeleg ist unvollständig.",
            409,
          );
        await client.query("COMMIT");
        return {
          ...structuredClone(priorReceipt.result_ref.payload),
          replayed: true,
        };
      }
      const head = await client.query<{
        id: string;
        accepted_command_id: string;
        state: string;
        last_error_class: string | null;
      }>(
        `SELECT id::text,accepted_command_id::text,state,last_error_class
         FROM clinical_projection_outbox
         WHERE organization_id=$1 AND state <> 'delivered'
         ORDER BY created_at,id LIMIT 1 FOR UPDATE`,
        [organizationId],
      );
      const row = head.rows[0];
      if (
        !row ||
        row.id !== input.jobId ||
        row.state !== "manual" ||
        row.last_error_class !== input.expectedErrorCode
      )
        throw new DomainError(
          "INVALID_STATE",
          "Projektionsauftrag oder Fehlerstand hat sich geändert.",
          409,
        );
      await client.query(
        `UPDATE clinical_projection_outbox
         SET state='retry',next_attempt_at=now(),lease_owner=NULL,
             lease_expires_at=NULL
         WHERE organization_id=$1 AND id=$2 AND state='manual'
           AND last_error_class=$3`,
        [organizationId, input.jobId, input.expectedErrorCode],
      );
      await client.query(
        `UPDATE accepted_commands a SET state=CASE
           WHEN EXISTS (
             SELECT 1 FROM clinical_projection_outbox c
             WHERE c.organization_id=a.organization_id
               AND c.accepted_command_id=a.id AND c.state='manual'
           ) OR EXISTS (
             SELECT 1 FROM provider_outbox p
             WHERE p.organization_id=a.organization_id
               AND p.accepted_command_id=a.id AND p.state='manual'
           ) THEN 'manual-review' ELSE 'delivery-pending' END
         WHERE a.organization_id=$1 AND a.id=$2`,
        [organizationId, row.accepted_command_id],
      );
      const receipt: ClinicalProjectionRecoveryReceipt = {
        jobId: row.id,
        acceptedCommandId: row.accepted_command_id,
        previousErrorCode: input.expectedErrorCode,
        state: "retry",
        replayed: false,
      };
      await client.query(
        `INSERT INTO command_receipts
           (organization_id,command_key,request_hash,status_code,result_ref,expires_at)
         VALUES ($1,$2,$3,200,$4,now()+interval '30 days')`,
        [
          organizationId,
          input.commandKey,
          input.requestHash,
          JSON.stringify({ payload: receipt }),
        ],
      );
      await client.query(
        `INSERT INTO audit_entries
           (organization_id,actor_id,actor_role,action,outcome,patient_id,purpose,
            detail,previous_hash,entry_hash,occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (organization_id,entry_hash) DO NOTHING`,
        [
          organizationId,
          input.auditEntry.actorId,
          input.auditEntry.actorRole,
          input.auditEntry.action,
          input.auditEntry.outcome,
          input.auditEntry.patientId,
          input.auditEntry.purpose,
          input.auditEntry.detail,
          input.auditEntry.previousHash,
          input.auditEntry.hash,
          input.auditEntry.occurredAt,
        ],
      );
      await client.query(
        `INSERT INTO domain_events
           (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'clinical-projection',$2,'ClinicalProjectionRetryAuthorized',$3,$4)`,
        [
          organizationId,
          row.id,
          JSON.stringify({ actorIds: [input.actorId] }),
          JSON.stringify({
            jobId: row.id,
            acceptedCommandId: row.accepted_command_id,
            previousErrorCode: input.expectedErrorCode,
            auditEntryHash: input.auditEntry.hash,
          }),
        ],
      );
      await client.query("COMMIT");
      return receipt;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async providerDeliveryState(
    patientIds: readonly string[],
  ): Promise<"pending" | "simulated-acknowledged" | "external-gated"> {
    if (patientIds.length === 0) return "external-gated";
    const references = patientIds.map((id) => `Patient/${id}`);
    const result = await this.pool.query<{ state: string; count: number }>(
      `SELECT state,count(*)::int count FROM provider_outbox
       WHERE organization_id=$1
         AND payload->'command'->>'patientReference'=ANY($2::text[])
       GROUP BY state`,
      [organizationId, references],
    );
    if (result.rows.length === 0) return "external-gated";
    if (
      result.rows.some((row) =>
        ["pending", "leased", "retry", "manual"].includes(row.state),
      )
    )
      return "pending";
    return result.rows.every((row) => row.state === "delivered")
      ? "simulated-acknowledged"
      : "external-gated";
  }
  async providerDeliverySummary(
    patientIds: readonly string[],
  ): Promise<{ unresolved: number; conflicts: number }> {
    if (patientIds.length === 0) return { unresolved: 0, conflicts: 0 };
    const references = patientIds.map((id) => `Patient/${id}`);
    const result = await this.pool.query<{
      unresolved: number;
      conflicts: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE state <> 'delivered')::int unresolved,
         count(*) FILTER (WHERE state = 'manual')::int conflicts
       FROM provider_outbox
       WHERE organization_id=$1
         AND payload->'command'->>'patientReference'=ANY($2::text[])`,
      [organizationId, references],
    );
    return {
      unresolved: Number(result.rows[0]?.unresolved ?? 0),
      conflicts: Number(result.rows[0]?.conflicts ?? 0),
    };
  }
  async deliveryDiagnostics(): Promise<DeliveryDiagnostics> {
    const result = await this.pool.query<{
      queue: "accepted" | "clinical" | "provider";
      state: string;
      count: number;
    }>(
      `SELECT 'accepted' queue,state,count(*)::int count
       FROM accepted_commands WHERE organization_id=$1 GROUP BY state
       UNION ALL
       SELECT 'clinical' queue,state,count(*)::int count
       FROM clinical_projection_outbox WHERE organization_id=$1 GROUP BY state
       UNION ALL
       SELECT 'provider' queue,state,count(*)::int count
       FROM provider_outbox WHERE organization_id=$1 GROUP BY state`,
      [organizationId],
    );
    const diagnostics: DeliveryDiagnostics = {
      acceptedCommands: {},
      clinicalProjections: {},
      providerDeliveries: {},
    };
    for (const row of result.rows) {
      const target =
        row.queue === "accepted"
          ? diagnostics.acceptedCommands
          : row.queue === "clinical"
            ? diagnostics.clinicalProjections
            : diagnostics.providerDeliveries;
      target[row.state] = Number(row.count);
    }
    return diagnostics;
  }
  async releaseIntentAuthority(tokenHash: string): Promise<void> {
    await this.pool.query(
      `WITH released AS (
         UPDATE safety_authority SET consumed_at=NULL
         WHERE organization_id=$1 AND token_hash=$2 AND authority_type='intent'
           AND consumed_at IS NOT NULL AND expires_at > now()
         RETURNING proposal_revision_id
       )
       UPDATE assistant_proposal_revisions p
       SET status='pending',consumed_at=NULL
       FROM released
       WHERE p.organization_id=$1 AND p.id=released.proposal_revision_id
         AND p.status='consumed'`,
      [organizationId, tokenHash],
    );
  }
  async revokeResponseAuthorities(
    actorId: string,
    responseId: string,
  ): Promise<void> {
    await this.pool.query(
      `WITH revoked AS (
         UPDATE safety_authority a SET consumed_at=now()
         FROM assistant_proposal_revisions p
         WHERE a.organization_id=$1 AND a.actor_id=$2
           AND a.authority_type='intent' AND a.consumed_at IS NULL
           AND p.organization_id=a.organization_id
           AND p.id=a.proposal_revision_id
           AND p.source_response_id=$3
         RETURNING a.proposal_revision_id
       )
       UPDATE assistant_proposal_revisions p
       SET status='superseded'
       FROM revoked
       WHERE p.organization_id=$1 AND p.id=revoked.proposal_revision_id
         AND p.status='pending'`,
      [organizationId, actorId, responseId],
    );
  }
  async revokeActorAuthorities(actorId: string): Promise<void> {
    await this.pool.query(
      `WITH revoked AS (
         UPDATE safety_authority SET consumed_at=now()
         WHERE organization_id=$1 AND actor_id=$2 AND consumed_at IS NULL
         RETURNING proposal_revision_id
       )
       UPDATE assistant_proposal_revisions p
       SET status='superseded'
       FROM revoked
       WHERE p.organization_id=$1 AND p.id=revoked.proposal_revision_id
         AND p.status='pending'`,
      [organizationId, actorId],
    );
  }
  async suspendActorAuthorities(actorId: string): Promise<void> {
    await this.pool.query(
      `UPDATE safety_authority SET consumed_at=now()
       WHERE organization_id=$1 AND actor_id=$2 AND consumed_at IS NULL`,
      [organizationId, actorId],
    );
  }
  async suspendAssistantContextAuthorities(
    actorId: string,
    clientContextId: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE safety_authority SET consumed_at=now()
       WHERE organization_id=$1 AND actor_id=$2 AND client_context_id=$3
         AND consumed_at IS NULL`,
      [organizationId, actorId, clientContextId],
    );
  }
  async storeVoiceAuthority(
    tokenHash: string,
    record: DurableVoiceAuthority,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO safety_authority
         (organization_id,token_hash,authority_type,actor_id,session_id,thread_id,context_revision,patient_id,binding,expires_at,client_context_id)
       VALUES ($1,$2,'voice',$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (organization_id,token_hash) DO NOTHING`,
      [
        organizationId,
        tokenHash,
        record.actorId,
        record.sessionId,
        record.threadId,
        record.contextRevision,
        record.patientId,
        record,
        new Date(record.expiresAt),
        record.clientContextId,
      ],
    );
  }
  async loadVoiceAuthority(
    tokenHash: string,
  ): Promise<DurableVoiceAuthority | null> {
    const result = await this.pool.query<{ binding: DurableVoiceAuthority }>(
      `SELECT binding FROM safety_authority
       WHERE organization_id=$1 AND token_hash=$2 AND authority_type='voice'
         AND consumed_at IS NULL AND expires_at > now()`,
      [organizationId, tokenHash],
    );
    return result.rows[0]?.binding
      ? structuredClone(result.rows[0].binding)
      : null;
  }
  async consumeVoiceAuthority(tokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE safety_authority SET consumed_at=now()
       WHERE organization_id=$1 AND token_hash=$2 AND authority_type='voice'
         AND consumed_at IS NULL AND expires_at > now()`,
      [organizationId, tokenHash],
    );
    return Boolean(result.rowCount);
  }
  async enqueueProviderCommand(input: {
    provider: ProviderOutboxJob["provider"];
    profile: ProviderProfile;
    command: CanonicalClinicalCommand;
    retrySafety?: ProviderOutboxPayload["retrySafety"];
  }): Promise<{ id: string; inserted: boolean }> {
    const provider = providerIdSchema.parse(input.provider);
    const profile = providerProfileSchema.parse(input.profile);
    if (profile === "production" && input.retrySafety === "idempotent-provider")
      throw new Error("PROVIDER_IDEMPOTENCY_EVIDENCE_REQUIRED");
    const payload = providerOutboxPayloadSchema.parse({
      schemaVersion: 1,
      command: input.command,
      retrySafety: input.retrySafety ?? "reconcile-before-retry",
    });
    const id = randomUUID();
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO provider_outbox
         (organization_id,id,provider_id,profile_id,operation,idempotency_key,payload,state)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
       ON CONFLICT (organization_id,provider_id,profile_id,idempotency_key)
       DO NOTHING
       RETURNING id::text`,
      [
        organizationId,
        id,
        provider,
        profile,
        payload.command.operation,
        payload.command.idempotencyKey,
        payload,
      ],
    );
    if (inserted.rows[0]) return { id: inserted.rows[0].id, inserted: true };
    const existing = await this.pool.query<{ id: string; payload: unknown }>(
      `SELECT id::text,payload FROM provider_outbox
       WHERE organization_id=$1 AND provider_id=$2 AND profile_id=$3
         AND idempotency_key=$4`,
      [organizationId, provider, profile, payload.command.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new Error("PROVIDER_OUTBOX_CONCURRENT_INSERT_LOST");
    if (canonicalJson(row.payload) !== canonicalJson(payload))
      throw new Error("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
    return { id: row.id, inserted: false };
  }
  async claimProviderCommands(input: {
    workerId: string;
    profile: ProviderProfile;
    limit: number;
    leaseDurationMs: number;
    now?: Date;
  }): Promise<ProviderOutboxJob[]> {
    const workerId = input.workerId.trim();
    if (!workerId || workerId.length > 120)
      throw new Error("INVALID_WORKER_ID");
    const profile = providerProfileSchema.parse(input.profile);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100)
      throw new Error("INVALID_PROVIDER_BATCH_SIZE");
    if (
      !Number.isInteger(input.leaseDurationMs) ||
      input.leaseDurationMs < 1_000 ||
      input.leaseDurationMs > 5 * 60_000
    )
      throw new Error("INVALID_PROVIDER_LEASE_DURATION");
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const claimed = await client.query<{
        id: string;
        provider_id: string;
        profile_id: string;
        operation: string;
        idempotency_key: string;
        payload: unknown;
        attempts: number;
        prior_state: string;
        latest_receipt_id: string | null;
        accepted_command_id: string | null;
        authority_envelope: Record<string, unknown> | null;
      }>(
        `WITH candidates AS (
           SELECT organization_id,id,state AS prior_state
           FROM provider_outbox
           WHERE organization_id=$1 AND profile_id=$2
             AND (
               accepted_command_id IS NULL OR EXISTS (
                 SELECT 1 FROM clinical_projection_outbox clinical
                 WHERE clinical.organization_id=provider_outbox.organization_id
                   AND clinical.accepted_command_id=provider_outbox.accepted_command_id
                   AND clinical.state='delivered'
               )
             )
             AND (
               (state IN ('pending','retry') AND next_attempt_at <= $3)
               OR (state='leased' AND lease_expires_at <= $3)
             )
           ORDER BY next_attempt_at,id
           FOR UPDATE SKIP LOCKED
           LIMIT $4
         ), claimed AS (
           UPDATE provider_outbox o
           SET state='leased',attempts=o.attempts+1,lease_owner=$5,
               lease_expires_at=$6,last_error_class=NULL
           FROM candidates c
           WHERE o.organization_id=c.organization_id AND o.id=c.id
           RETURNING o.*,c.prior_state
         )
         SELECT c.id::text,c.provider_id,c.profile_id,c.operation,
                c.idempotency_key,c.payload,c.attempts,c.prior_state,
                receipt.external_reference AS latest_receipt_id,
                c.accepted_command_id::text,c.authority_envelope
         FROM claimed c
         LEFT JOIN LATERAL (
           SELECT external_reference
           FROM provider_receipts r
           WHERE r.organization_id=c.organization_id AND r.outbox_id=c.id
           ORDER BY r.created_at DESC,r.id DESC LIMIT 1
         ) receipt ON true
         ORDER BY c.next_attempt_at,c.id`,
        [organizationId, profile, now, input.limit, workerId, leaseExpiresAt],
      );
      const jobs: ProviderOutboxJob[] = [];
      for (const row of claimed.rows) {
        const payload = providerOutboxPayloadSchema.safeParse(row.payload);
        const provider = providerIdSchema.safeParse(row.provider_id);
        const storedProfile = providerProfileSchema.safeParse(row.profile_id);
        const valid =
          payload.success &&
          provider.success &&
          storedProfile.success &&
          payload.data.command.operation === row.operation &&
          payload.data.command.idempotencyKey === row.idempotency_key;
        if (!valid) {
          await client.query(
            `UPDATE provider_outbox
             SET state='manual',lease_owner=NULL,lease_expires_at=NULL,
                 last_error_class='OUTBOX_PAYLOAD_INVALID'
             WHERE organization_id=$1 AND id=$2 AND state='leased'
               AND lease_owner=$3`,
            [organizationId, row.id, workerId],
          );
          if (row.accepted_command_id)
            await client.query(
              `UPDATE accepted_commands SET state='manual-review'
               WHERE organization_id=$1 AND id=$2`,
              [organizationId, row.accepted_command_id],
            );
          await client.query(
            `INSERT INTO domain_events
               (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
             VALUES ($1,'provider-outbox',$2,'ProviderOutboxQuarantined',$3,$4)`,
            [
              organizationId,
              row.id,
              { roles: ["it"] },
              { outboxId: row.id, reason: "OUTBOX_PAYLOAD_INVALID" },
            ],
          );
          continue;
        }
        jobs.push({
          id: row.id,
          provider: provider.data,
          profile: storedProfile.data,
          operation: payload.data.command.operation,
          idempotencyKey: row.idempotency_key,
          payload: payload.data,
          attempts: Number(row.attempts),
          recoveredExpiredLease: row.prior_state === "leased",
          latestReceiptId: row.latest_receipt_id,
          acceptedCommandId: row.accepted_command_id,
          authorityEnvelope: row.authority_envelope,
        });
      }
      await client.query("COMMIT");
      return jobs;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async finishProviderDelivery(input: {
    jobId: string;
    workerId: string;
    acknowledgement: ProviderAcknowledgement;
    retryAt: Date | null;
    readBackEvidence?: {
      providerVersion: string;
      contentHash: string;
      adapterVersion: string;
      mappingVersion: string;
    };
  }): Promise<void> {
    if (
      input.acknowledgement.status === "acknowledged" &&
      (!input.readBackEvidence ||
        !input.readBackEvidence.providerVersion.trim() ||
        !input.readBackEvidence.adapterVersion.trim() ||
        !input.readBackEvidence.mappingVersion.trim() ||
        !/^[a-f0-9]{64}$/.test(input.readBackEvidence.contentHash) ||
        (input.acknowledgement.providerVersion !== null &&
          input.acknowledgement.providerVersion !==
            input.readBackEvidence.providerVersion))
    )
      throw new Error("PROVIDER_READBACK_EVIDENCE_REQUIRED");
    const nextState =
      input.acknowledgement.status === "acknowledged"
        ? "delivered"
        : input.acknowledgement.status === "pending" && input.retryAt
          ? "retry"
          : "manual";
    const lastError =
      input.acknowledgement.status === "pending" && !input.retryAt
        ? "technical:MAX_PENDING_ATTEMPTS"
        : input.acknowledgement.errorClassification
          ? `${input.acknowledgement.errorClassification}:${input.acknowledgement.errorCode ?? "PROVIDER_REJECTED"}`
          : null;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const updated = await client.query<{
        provider_id: string;
        idempotency_key: string;
        accepted_command_id: string | null;
      }>(
        `UPDATE provider_outbox
         SET state=$4,next_attempt_at=$5,lease_owner=NULL,lease_expires_at=NULL,
             last_error_class=$6
         WHERE organization_id=$1 AND id=$2 AND state='leased' AND lease_owner=$3
         RETURNING provider_id,idempotency_key,accepted_command_id::text`,
        [
          organizationId,
          input.jobId,
          input.workerId,
          nextState,
          nextState === "retry" ? input.retryAt : new Date(),
          lastError,
        ],
      );
      if (!updated.rows[0]) throw new Error("PROVIDER_OUTBOX_LEASE_LOST");
      if (
        !input.acknowledgement.receiptId ||
        input.acknowledgement.idempotencyKey !== updated.rows[0].idempotency_key
      )
        throw new Error("PROVIDER_ACKNOWLEDGEMENT_BINDING_MISMATCH");
      await client.query(
        `INSERT INTO provider_receipts
           (organization_id,id,provider_id,outbox_id,external_reference,
            acknowledgement_hash,provider_version,adapter_version,mapping_version,readback_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          organizationId,
          randomUUID(),
          updated.rows[0].provider_id,
          input.jobId,
          input.acknowledgement.receiptId,
          createHash("sha256")
            .update(canonicalJson(input.acknowledgement))
            .digest("hex"),
          input.readBackEvidence?.providerVersion ??
            input.acknowledgement.providerVersion,
          input.readBackEvidence?.adapterVersion ?? null,
          input.readBackEvidence?.mappingVersion ?? null,
          input.readBackEvidence?.contentHash ?? null,
        ],
      );
      await client.query(
        `INSERT INTO domain_events
           (organization_id,aggregate_type,aggregate_id,event_type,audience,payload)
         VALUES ($1,'provider-outbox',$2,$3,$4,$5)`,
        [
          organizationId,
          input.jobId,
          nextState === "delivered"
            ? "ProviderDeliveryAcknowledged"
            : nextState === "retry"
              ? "ProviderDeliveryPending"
              : "ProviderDeliveryNeedsReview",
          { roles: ["it"] },
          {
            outboxId: input.jobId,
            status: input.acknowledgement.status,
            receiptId: input.acknowledgement.receiptId,
          },
        ],
      );
      if (updated.rows[0].accepted_command_id)
        await client.query(
          `UPDATE accepted_commands a SET state=CASE
             WHEN a.state='manual-review' OR EXISTS (
               SELECT 1 FROM clinical_projection_outbox c
               WHERE c.organization_id=a.organization_id
                 AND c.accepted_command_id=a.id AND c.state='manual'
             ) OR EXISTS (
               SELECT 1 FROM provider_outbox p
               WHERE p.organization_id=a.organization_id
                 AND p.accepted_command_id=a.id AND p.state='manual'
             ) THEN 'manual-review'
             WHEN EXISTS (
               SELECT 1 FROM clinical_projection_outbox c
               WHERE c.organization_id=a.organization_id
                 AND c.accepted_command_id=a.id AND c.state<>'delivered'
             ) OR EXISTS (
               SELECT 1 FROM provider_outbox p
               WHERE p.organization_id=a.organization_id
                 AND p.accepted_command_id=a.id AND p.state<>'delivered'
             ) THEN 'delivery-pending' ELSE 'delivered' END
           WHERE a.organization_id=$1 AND a.id=$2`,
          [organizationId, updated.rows[0].accepted_command_id],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async failProviderDelivery(input: {
    jobId: string;
    workerId: string;
    errorCode: string;
    errorClassification: ProviderErrorClassification;
    retryAt: Date | null;
  }): Promise<void> {
    const state = input.retryAt ? "retry" : "manual";
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ accepted_command_id: string | null }>(
        `UPDATE provider_outbox
         SET state=$4,next_attempt_at=COALESCE($5,next_attempt_at),
             lease_owner=NULL,lease_expires_at=NULL,last_error_class=$6
         WHERE organization_id=$1 AND id=$2 AND state='leased' AND lease_owner=$3
         RETURNING accepted_command_id::text`,
        [
          organizationId,
          input.jobId,
          input.workerId,
          state,
          input.retryAt,
          `${input.errorClassification}:${input.errorCode}`,
        ],
      );
      if (!result.rows[0]) throw new Error("PROVIDER_OUTBOX_LEASE_LOST");
      if (state === "manual" && result.rows[0].accepted_command_id)
        await client.query(
          `UPDATE accepted_commands SET state='manual-review'
           WHERE organization_id=$1 AND id=$2`,
          [organizationId, result.rows[0].accepted_command_id],
        );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async health(): Promise<boolean> {
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
  async resetDemoState(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `DELETE FROM provider_receipts WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM provider_outbox WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM clinical_projection_outbox WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM accepted_commands WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM command_receipts WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM safety_authority WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM assistant_proposal_revisions WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM responsibility_transfers WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM service_evidence WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM work_episode_segments WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(`DELETE FROM work_episodes WHERE organization_id=$1`, [
        organizationId,
      ]);
      await client.query(
        `DELETE FROM handover_acknowledgements WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM handover_snapshots WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM workflow_step_instances WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM assistant_client_contexts WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM working_sessions WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM assistant_messages WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM assistant_threads WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(`DELETE FROM domain_events WHERE organization_id=$1`, [
        organizationId,
      ]);
      await client.query(
        `DELETE FROM sync_conflicts WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM provider_receipts WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM provider_inbox WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM provider_outbox WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query(
        `DELETE FROM provider_cursors WHERE organization_id=$1`,
        [organizationId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  private toView(row: Record<string, unknown>): WorkingSessionView {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      departmentId: String(row.department_id),
      actorId: String(row.actor_id),
      effectiveRole: String(row.effective_role) as Role,
      workflowTemplateId: String(row.workflow_template_id),
      workflowVersion: Number(row.workflow_version),
      workflowName: String(row.workflow_name),
      definition: row.definition as WorkflowDefinition,
      threadId: String(row.assistant_thread_id),
      currentStepId: String(row.current_step_id),
      contextRevision: Number(row.context_revision),
      patientId: typeof row.patient_id === "string" ? row.patient_id : null,
      encounterId:
        typeof row.subject_encounter_id === "string"
          ? row.subject_encounter_id
          : null,
      rowVersion: Number(row.row_version),
      status: String(row.status) as WorkingSessionView["status"],
      startedAt:
        row.started_at instanceof Date
          ? row.started_at.toISOString()
          : String(row.started_at),
    };
  }
}

function toEpisodeView(row: Record<string, unknown>): WorkEpisodeView {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    encounterId: String(row.encounter_id),
    kind: String(row.kind) as WorkEpisodeView["kind"],
    title: String(row.title),
    state: String(row.state) as WorkEpisodeView["state"],
    startedAt:
      row.started_at instanceof Date
        ? row.started_at.toISOString()
        : String(row.started_at),
    completedAt:
      row.completed_at instanceof Date
        ? row.completed_at.toISOString()
        : typeof row.completed_at === "string"
          ? row.completed_at
          : null,
    draftText: typeof row.draft_text === "string" ? row.draft_text : "",
    completionEvidence:
      typeof row.completion_evidence === "string"
        ? row.completion_evidence
        : null,
  };
}

function toTransferView(
  row: Record<string, unknown>,
): ResponsibilityTransferView {
  return {
    id: String(row.id),
    patientId: String(row.patient_id),
    fromActorId: String(row.from_actor_id),
    toActorId: String(row.to_actor_id),
    reason: String(row.reason),
    state: String(row.state) as ResponsibilityTransferView["state"],
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at),
    acknowledgedAt:
      row.acknowledged_at instanceof Date
        ? row.acknowledged_at.toISOString()
        : typeof row.acknowledged_at === "string"
          ? row.acknowledged_at
          : null,
  };
}

function buildWorkdayView(
  session: WorkingSessionView,
  handover: {
    id: string;
    version: number;
    shift_key: string;
    patient_ids: string[];
    cutoff_at: Date | string;
    source_hash: string;
    content: HandoverContentItem[];
    clinical_bound: boolean;
    status: "open" | "transferred" | "acknowledged";
  },
  acknowledgedPatientIds: string[],
  episodes: WorkEpisodeView[],
  transfers: ResponsibilityTransferView[] = [],
): WorkdayView {
  const outgoingTransfers = transfers.filter(
    (transfer) => transfer.fromActorId === session.actorId,
  );
  const displayedHandoverStatus =
    handover.status === "transferred" &&
    outgoingTransfers.length > 0 &&
    outgoingTransfers.every((transfer) => transfer.state === "acknowledged")
      ? "acknowledged"
      : handover.status;
  const activeEpisode =
    episodes.find((episode) => episode.state === "active") ?? null;
  const resumableEpisode =
    [...episodes].reverse().find((episode) => episode.state === "paused") ??
    null;
  const allAcknowledged = handover.patient_ids.every((id) =>
    acknowledgedPatientIds.includes(id),
  );
  const stage =
    session.status === "completed" ||
    session.currentStepId === "complete" ||
    handover.status === "transferred"
      ? "closed"
      : !allAcknowledged
        ? "handover"
        : activeEpisode || resumableEpisode || episodes.length > 0
          ? "patient-work"
          : "plan";
  return {
    sessionId: session.id,
    stage,
    handover: {
      id: handover.id,
      version: Number(handover.version),
      shiftKey: handover.shift_key,
      cutoffAt:
        handover.cutoff_at instanceof Date
          ? handover.cutoff_at.toISOString()
          : String(handover.cutoff_at),
      contentHash: handover.source_hash,
      clinicalBound: handover.clinical_bound,
      patientIds: handover.patient_ids,
      items: handover.content.map((item) => ({
        patientId: item.patientId,
        encounterId: item.encounterId,
        currentImportant: [...item.currentImportant],
        recentChanges: [...item.recentChanges],
        openQuestions: [...item.openQuestions],
      })),
      acknowledgedPatientIds,
      status: displayedHandoverStatus,
      nextResponsibleActorId:
        siteConfiguration.shifts[
          workdayConfiguration(
            session.actorId,
            session.effectiveRole,
            session.startedAt,
          ).shiftId
        ]!.nextResponsibleActorId,
    },
    plan: handover.content.map((snapshot) => {
      const patientId = snapshot.patientId;
      const episode = [...episodes]
        .reverse()
        .find(
          (item) => item.patientId === patientId && item.kind === "planned",
        );
      return {
        patientId,
        title: snapshot.title,
        reason: `${snapshot.window} · ${snapshot.reason}`,
        status:
          episode?.state === "deferred"
            ? "paused"
            : (episode?.state ?? "planned"),
      };
    }),
    episodes,
    activeEpisode,
    resumableEpisode,
    incomingTransfers: transfers.filter(
      (transfer) => transfer.toActorId === session.actorId,
    ),
    outgoingTransfers,
    // The operational store cannot infer provider delivery from episode
    // completion. The API overlays this with the clinical outbox/receipt state.
    providerState: "external-gated",
  };
}

function memoryWorkdayView(
  session: MemorySession,
  transfers: ResponsibilityTransferView[],
  handoverSession: MemorySession,
  clinicalItems?: HandoverClinicalSnapshotItem[],
): WorkdayView {
  const configuredWorkday = workdayConfiguration(
    handoverSession.actorId,
    handoverSession.effectiveRole,
    handoverSession.startedAt,
  );
  const clinicalByPatient = new Map(
    (clinicalItems ?? []).map((item) => [item.patientId, item]),
  );
  const content = handoverContent(configuredWorkday.patientIds).map((base) => {
    const clinical = clinicalByPatient.get(base.patientId);
    return clinical
      ? {
          ...base,
          encounterId: clinical.encounterId,
          currentImportant: [...clinical.currentImportant],
          recentChanges: [...clinical.recentChanges],
          openQuestions: [...clinical.openQuestions],
        }
      : base;
  });
  const clinicalBound =
    content.length === clinicalByPatient.size &&
    content.every((item) => item.encounterId !== null);
  return buildWorkdayView(
    session,
    {
      id: handoverSession.handoverId,
      version: clinicalBound ? 2 : 1,
      shift_key: configuredWorkday.shiftKey,
      patient_ids: configuredWorkday.patientIds,
      cutoff_at: session.startedAt,
      source_hash: handoverSourceHash({
        departmentId: session.departmentId,
        shiftKey: configuredWorkday.shiftKey,
        actorId: handoverSession.actorId,
        content,
      }),
      content,
      clinical_bound: clinicalBound,
      status: handoverSession.handoverStatus,
    },
    session.acknowledgedPatientIds,
    session.episodes,
    transfers,
  );
}
