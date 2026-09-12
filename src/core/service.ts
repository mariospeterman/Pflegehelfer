import { createHash, randomUUID } from "node:crypto";
import type { Resource } from "@medplum/fhirtypes";
import { AuditChain } from "./audit.js";
import {
  completionEvidenceIsIncomplete,
  observationNeedsHighAssurance,
  requiresDedicatedTaskWorkflow,
} from "../ai/assistant-proposal.js";
import {
  InMemoryReferenceStatePort,
  type ReferenceStatePort,
} from "./clinical-data-port.js";
import {
  communications as seedCommunications,
  intake as seedIntake,
  notes as seedNotes,
  observations as seedObservations,
  patients as seedPatients,
  providerHealth as seedProviderHealth,
  roundActions as seedRoundActions,
  tasks as seedTasks,
  users as seedUsers,
} from "./seed.js";
import {
  createSyntheticProviderRegistry,
  type CanonicalClinicalCommand,
  type ProviderRegistry,
  type ProviderProfile,
  type ProviderOperation,
  type ProviderSimulatorMode,
} from "./provider-integration/index.js";
import {
  canSeeTask,
  decide,
  minimumPatientView,
  type Action,
} from "./policy.js";
import type {
  AppSnapshot,
  ApprovalPolicy,
  AuditEntry,
  ClinicalNote,
  ClinicalTask,
  Communication,
  DemoUser,
  DomainError as DomainErrorType,
  IntakeItem,
  Observation,
  OutboxItem,
  OutboxSummary,
  ClinicalOutboxSummary,
  Patient,
  ProviderHealth,
  ProviderId,
  Purpose,
  RoundAction,
  Role,
  SyncState,
} from "./types.js";
import { DomainError } from "./types.js";
import { auditEventToFhirR4, toFhirResourceSet } from "./fhir-resource-set.js";
import { siteConfiguration } from "./site-config.js";

export interface WorkflowState {
  users: DemoUser[];
  patients: Patient[];
  tasks: ClinicalTask[];
  observations: Observation[];
  notes: ClinicalNote[];
  communications: Communication[];
  intake: IntakeItem[];
  roundActions: RoundAction[];
  providerHealth: ProviderHealth[];
  outbox: OutboxItem[];
}

export interface ServiceCheckpoint {
  formatVersion: 1;
  dataClass: "synthetic-demo" | "institution-local";
  state: WorkflowState;
  audit: AuditEntry[];
  commandReceipts?: CommandReceipt[];
}

export interface CommandReceipt {
  key: string;
  requestHash: string;
  statusCode: number;
  payload: string;
}

// Receipts are durably stored as individual, deterministic Medplum Binary
// resources. The checkpoint carries only a small hot cache so its size remains
// bounded below Medplum's transaction/JSON limits.
const receiptCacheMaxEntries = 128;
const receiptCacheMaxBytes = 128 * 1024;

interface ApprovalInput {
  expectedVersion: number;
  patientMrn: string;
  patientBirthDate: string;
  reviewedDiff: boolean;
  purpose?: Purpose | undefined;
}

const clone = <T>(value: T): T => structuredClone(value);

function initialState(): WorkflowState {
  const state = clone({
    users: seedUsers,
    patients: seedPatients,
    tasks: seedTasks,
    observations: seedObservations,
    notes: seedNotes,
    communications: seedCommunications,
    intake: seedIntake,
    roundActions: seedRoundActions,
    providerHealth: seedProviderHealth,
    outbox: [],
  });
  for (const communication of state.communications)
    if (["sent", "acknowledged"].includes(communication.state))
      communication.dueAt = new Date(Date.now() + 90 * 60_000).toISOString();
  return state;
}

export function emptyWorkflowState(): WorkflowState {
  return {
    users: [],
    patients: [],
    tasks: [],
    observations: [],
    notes: [],
    communications: [],
    intake: [],
    roundActions: [],
    providerHealth: [],
    outbox: [],
  };
}

const deadlineEngineActor: DemoUser = {
  id: "system:deadline-engine",
  displayName: "Deterministic Deadline Engine",
  role: "it",
  wardIds: [],
  patientIds: [],
  managedDevice: true,
  defaultPurpose: "operations",
};

function idempotency(
  aggregateType: string,
  aggregateId: string,
  version: number,
): string {
  return createHash("sha256")
    .update(`${aggregateType}:${aggregateId}:${version}`)
    .digest("hex");
}

const labels: Record<Observation["code"], string> = {
  "blood-pressure": "Blutdruck",
  temperature: "Temperatur",
  "oxygen-saturation": "Sauerstoffsättigung",
  pulse: "Puls",
  weight: "Gewicht",
};

const units: Record<Observation["code"], Observation["unit"]> = {
  "blood-pressure": "mmHg",
  temperature: "°C",
  "oxygen-saturation": "%",
  pulse: "/min",
  weight: "kg",
};

const roundActionCatalog: Record<
  RoundAction["actionKind"],
  Pick<RoundAction, "decision" | "category" | "requiredConfirmation">
> = {
  "mobility-followup": {
    decision: "Mobilität im Pflegeplan nachverfolgen",
    category: "care",
    requiredConfirmation: "Pflegedokumentation",
  },
  "vital-sign-followup": {
    decision: "Vereinbarten Vitalwert erneut erheben",
    category: "care",
    requiredConfirmation: "Geprüfter Vitalwert",
  },
  "wound-observation": {
    decision: "Wundbeobachtung nach Pflegeplan dokumentieren",
    category: "care",
    requiredConfirmation: "Geprüfte Wundbeobachtung",
  },
  "therapy-followup": {
    decision: "Therapieeinheit nachverfolgen",
    category: "therapy",
    requiredConfirmation: "Therapiebericht",
  },
  "diagnostic-followup": {
    decision: "Vorliegenden Diagnostikauftrag nachverfolgen",
    category: "diagnostic-followup",
    requiredConfirmation: "Befundstatus im autoritativen System",
  },
};

export class PflegehelferService {
  private readonly clinicalData: ReferenceStatePort<WorkflowState>;
  readonly audit = new AuditChain();
  readonly providerRegistry: ProviderRegistry;
  readonly providerProfile: ProviderProfile;
  private readonly commandReceipts = new Map<string, CommandReceipt>();
  readonly aiEnabled = (process.env.PFH_AI_MODE ?? "disabled") !== "disabled";
  private currentDataClass: "synthetic-demo" | "institution-local";

  constructor(
    clinicalData: ReferenceStatePort<WorkflowState> = new InMemoryReferenceStatePort(
      initialState(),
    ),
    providerRegistry: ProviderRegistry = createSyntheticProviderRegistry(),
    providerProfile: ProviderProfile = "synthetic-simulator",
  ) {
    this.clinicalData = clinicalData;
    this.providerRegistry = providerRegistry;
    this.providerProfile = providerProfile;
    this.currentDataClass =
      providerProfile === "synthetic-simulator"
        ? "synthetic-demo"
        : "institution-local";
  }

  private get state(): WorkflowState {
    return this.clinicalData.read();
  }

  reset(options: { resetAudit?: boolean; actor?: DemoUser } = {}): void {
    this.clinicalData.replace(initialState());
    this.commandReceipts.clear();
    this.currentDataClass =
      this.providerProfile === "synthetic-simulator"
        ? "synthetic-demo"
        : "institution-local";
    // The ephemeral in-memory demo/test workspace represents a new synthetic
    // centre after reset. Durable Medplum environments retain their audit
    // history and append the reset event to the existing chain.
    if (options.resetAudit) this.audit.restore([]);
    if (options.actor)
      this.audit.append({
        actor: options.actor,
        action: "demo:reset",
        patientId: null,
        purpose: "operations",
        outcome: "success",
        detail: { auditEpochReset: options.resetAudit === true },
      });
    if (this.providerProfile !== "synthetic-simulator") return;
    this.providerRegistry.resetSimulators();
  }

  checkpoint(): ServiceCheckpoint {
    return {
      formatVersion: 1,
      dataClass: this.currentDataClass,
      state: clone(this.state),
      audit: this.audit.snapshot(),
      commandReceipts: [...this.commandReceipts.values()].map(clone),
    };
  }

  restoreCheckpoint(checkpoint: ServiceCheckpoint): void {
    if (checkpoint.formatVersion !== 1)
      throw new Error("Unsupported Pflegehelfer workflow checkpoint version.");
    this.currentDataClass = checkpoint.dataClass;
    this.audit.restore(checkpoint.audit);
    this.clinicalData.replace(clone(checkpoint.state));
    this.commandReceipts.clear();
    for (const receipt of checkpoint.commandReceipts ?? [])
      this.recordCommandReceipt(receipt);
  }

  dataClass(): "synthetic-demo" | "institution-local" {
    return this.currentDataClass;
  }

  runAtomically<T>(operation: () => T): T {
    const before = this.checkpoint();
    try {
      return this.clinicalData.transaction(operation);
    } catch (error) {
      this.restoreCheckpoint(before);
      throw error;
    }
  }

  commandReceipt(key: string): CommandReceipt | null {
    const receipt = this.commandReceipts.get(key);
    return receipt ? clone(receipt) : null;
  }

  commandReceiptKeys(): string[] {
    return [...this.commandReceipts.keys()];
  }

  recordCommandReceipt(receipt: CommandReceipt): void {
    this.commandReceipts.delete(receipt.key);
    this.commandReceipts.set(receipt.key, clone(receipt));
    const cacheBytes = () =>
      Buffer.byteLength(
        JSON.stringify([...this.commandReceipts.values()]),
        "utf8",
      );
    while (
      this.commandReceipts.size > receiptCacheMaxEntries ||
      cacheBytes() > receiptCacheMaxBytes
    ) {
      const oldest = this.commandReceipts.keys().next().value;
      if (!oldest) break;
      this.commandReceipts.delete(oldest);
    }
  }

  /** Full canonical projection for the trusted clinical workspace adapter. */
  fhirResources(): Resource[] {
    return toFhirResourceSet(
      this.state,
      this.audit.snapshot(),
      this.currentDataClass,
    );
  }

  /** Incremental access-audit projection for read-only request commits. */
  fhirAuditResourcesSince(index: number): Resource[] {
    return this.audit
      .slice(index)
      .map((entry) => auditEventToFhirR4(entry, this.currentDataClass));
  }

  user(userId: string): DemoUser {
    const user = this.state.users.find((candidate) => candidate.id === userId);
    if (!user)
      throw new DomainError(
        "AUTH_DENIED",
        "Unbekannte oder abgelaufene Identität.",
        401,
      );
    return user;
  }

  private patient(patientId: string): Patient {
    const patient = this.state.patients.find(
      (candidate) => candidate.id === patientId,
    );
    if (!patient)
      throw new DomainError(
        "NOT_FOUND",
        "Patientenkontext wurde nicht gefunden.",
        404,
      );
    return patient;
  }

  private authorize(
    user: DemoUser,
    action: Action,
    purpose: Purpose,
    patient?: Patient,
  ): void {
    const decision = decide(user, action, purpose, patient);
    this.audit.append({
      actor: user,
      action: `policy:${action}`,
      patientId: patient?.id ?? null,
      purpose,
      outcome: decision.allow ? "allowed" : "denied",
      detail: { reason: decision.reason },
    });
    if (!decision.allow)
      throw new DomainError("AUTH_DENIED", decision.reason, 403);
  }

  snapshot(userId: string, purpose?: Purpose): AppSnapshot {
    const user = this.user(userId);
    const activePurpose = purpose ?? user.defaultPurpose;
    const visiblePatients = this.state.patients
      .filter(
        (patient) =>
          decide(
            user,
            user.role === "administration"
              ? "patient:administrative-read"
              : "patient:read",
            activePurpose,
            patient,
          ).allow,
      )
      .map((patient) => minimumPatientView(user, patient));
    const visibleIds = new Set(visiblePatients.map((patient) => patient.id));
    const visibleTasks = this.state.tasks.filter((task) => {
      const patient = task.patientId
        ? this.state.patients.find(
            (candidate) => candidate.id === task.patientId,
          )
        : undefined;
      if (!canSeeTask(user, patient, task.ownerRole)) return false;
      if (["transport", "service", "administration"].includes(user.role))
        return activePurpose === user.defaultPurpose;
      return patient
        ? visibleIds.has(patient.id)
        : task.ownerRole === user.role;
    });
    const clinical = ![
      "transport",
      "service",
      "administration",
      "management",
      "hr",
      "it",
      "quality-safety",
    ].includes(user.role);

    this.audit.append({
      actor: user,
      action: "snapshot:read",
      patientId: null,
      purpose: activePurpose,
      outcome: "success",
      detail: { patientCount: visiblePatients.length },
    });
    for (const patient of visiblePatients)
      this.audit.append({
        actor: user,
        action: "patient:read",
        patientId: patient.id,
        purpose: activePurpose,
        outcome: "success",
        detail: { view: "role-minimized-snapshot" },
      });
    return clone({
      organization: {
        institutionId: siteConfiguration.institutionId,
        siteId: siteConfiguration.siteId,
        displayName: siteConfiguration.displayName,
        dataClass: this.currentDataClass,
        governedTopics: siteConfiguration.governedTopics,
      },
      currentUser: user,
      users: this.state.users.map((candidate) => ({
        ...candidate,
        wardIds: [],
        patientIds: [],
      })),
      patients: visiblePatients,
      tasks: visibleTasks,
      observations: clinical
        ? this.state.observations.filter((item) =>
            visibleIds.has(item.patientId),
          )
        : [],
      notes: clinical
        ? this.state.notes.filter((item) => visibleIds.has(item.patientId))
        : [],
      communications: clinical
        ? this.state.communications.filter((item) =>
            visibleIds.has(item.patientId),
          )
        : [],
      intake: this.state.intake.filter(
        (item) =>
          visibleIds.has(item.patientId) &&
          (item.ownerRole === user.role ||
            ["registered-nurse", "physician"].includes(user.role)) &&
          decide(
            user,
            "intake:read",
            activePurpose,
            this.patient(item.patientId),
          ).allow,
      ),
      roundActions: clinical
        ? this.state.roundActions.filter((item) =>
            visibleIds.has(item.patientId),
          )
        : [],
      providerHealth: ["it", "registered-nurse", "quality-safety"].includes(
        user.role,
      )
        ? this.currentHealth()
        : [],
      outbox: [
        "it",
        "registered-nurse",
        "physician",
        "quality-safety",
      ].includes(user.role)
        ? this.state.outbox
            .filter(
              (item) =>
                !["registered-nurse", "physician"].includes(user.role) ||
                visibleIds.has(item.patientId),
            )
            .map((item) =>
              ["registered-nurse", "physician"].includes(user.role)
                ? this.clinicalOutboxSummary(item)
                : this.outboxSummary(item),
            )
        : [],
      syncSummary: (() => {
        const privileged = ["it", "quality-safety"].includes(user.role);
        const relevant = this.state.outbox.filter(
          (item) => privileged || visibleIds.has(item.patientId),
        );
        return {
          unresolved: relevant.filter((item) => item.state !== "acknowledged")
            .length,
          conflicts: relevant.filter((item) =>
            ["conflict", "rejected"].includes(item.state),
          ).length,
        };
      })(),
      capabilityProfile: this.providerProfile,
      serverTime: new Date().toISOString(),
      aiEnabled: this.aiEnabled,
      workspace: {
        mode: "in-memory",
        ready: true,
        serverVersion: null,
        resourceCounts: {},
        message: "Deterministischer Referenzspeicher",
        checkedAt: new Date().toISOString(),
      },
      workspaceLinks: null,
    });
  }

  updateTask(
    userId: string,
    taskId: string,
    next: "accept" | "start" | "complete" | "delegate",
    input: {
      purpose?: Purpose | undefined;
      evidence?: string | undefined;
      delegateRole?: Role | undefined;
    },
  ): ClinicalTask {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const task = this.state.tasks.find((item) => item.id === taskId);
    if (!task)
      throw new DomainError("NOT_FOUND", "Aufgabe nicht gefunden.", 404);
    const patient = task.patientId ? this.patient(task.patientId) : undefined;
    if (patient && task.encounterId !== patient.encounterId)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Die Aufgabe gehört zu einem früheren Aufenthalt.",
        409,
      );
    if (
      ["transport", "service"].includes(user.role) &&
      purpose !== "operations"
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Minimierte nichtklinische Aufgaben erfordern den Betriebszweck.",
        403,
      );
    this.authorize(
      user,
      "task:update",
      purpose,
      ["transport", "service"].includes(user.role) ? undefined : patient,
    );
    if (!canSeeTask(user, patient, task.ownerRole))
      throw new DomainError(
        "AUTH_DENIED",
        "Aufgabe liegt ausserhalb des minimalen Rollenkontexts.",
        403,
      );
    if (next === "accept" && task.ownerRole !== user.role)
      throw new DomainError(
        "AUTH_DENIED",
        "Nur die zugewiesene Rolle darf diese Aufgabe annehmen.",
        403,
      );
    if (
      ["start", "complete", "delegate"].includes(next) &&
      task.ownerId &&
      task.ownerId !== user.id
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Nur die verantwortliche Person darf diese Aufgabe bearbeiten.",
        403,
      );
    if (
      next === "delegate" &&
      !["registered-nurse", "physician"].includes(user.role)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Delegation benötigt eine koordinierende klinische Rolle.",
        403,
      );
    if (
      next === "delegate" &&
      task.patientId &&
      ![
        "care-assistant",
        "registered-nurse",
        "physician",
        "pharmacy",
        "physiotherapy",
        "occupational-therapy",
      ].includes(input.delegateRole ?? "")
    )
      throw new DomainError(
        "VALIDATION",
        "Patientengebundene Aufgaben dürfen nicht an nichtklinische Rollen delegiert werden.",
        400,
      );

    if (next === "accept") {
      if (!["new", "escalated"].includes(task.state))
        throw new DomainError(
          "INVALID_STATE",
          "Nur neue oder eskalierte Aufgaben können angenommen werden.",
          409,
        );
      task.state = "accepted";
      task.ownerId = user.id;
      task.acknowledgedAt = new Date().toISOString();
    } else if (next === "start") {
      if (!["accepted", "waiting"].includes(task.state))
        throw new DomainError(
          "INVALID_STATE",
          "Aufgabe muss zuerst angenommen werden.",
          409,
        );
      task.state = "in-progress";
      task.ownerId ??= user.id;
    } else if (next === "complete") {
      if (!["accepted", "in-progress", "waiting"].includes(task.state))
        throw new DomainError(
          "INVALID_STATE",
          "Aufgabe ist nicht abschliessbar.",
          409,
        );
      if (!input.evidence?.trim())
        throw new DomainError(
          "VALIDATION",
          "Abschlussnachweis ist erforderlich.",
          400,
        );
      if (completionEvidenceIsIncomplete(input.evidence))
        throw new DomainError(
          "VALIDATION",
          "Der Nachweis beschreibt offene oder nicht durchgeführte Arbeit und kann diese Aufgabe nicht abschliessen.",
          422,
        );
      task.state = "completed";
      task.completionEvidence = input.evidence.trim();
      const roundAction = this.state.roundActions.find(
        (item) => item.taskId === task.id,
      );
      if (roundAction) roundAction.status = "completed";
    } else {
      if (!input.delegateRole)
        throw new DomainError("VALIDATION", "Zielrolle fehlt.", 400);
      task.ownerRole = input.delegateRole;
      task.ownerId = null;
      task.state = "new";
      task.acknowledgedAt = null;
    }
    task.source.version += 1;
    if (task.patientId && task.source.provider === "pflegehelfer")
      this.enqueue("task", task);
    this.audit.append({
      actor: user,
      action: `task:${next}`,
      patientId: task.patientId,
      purpose,
      outcome: "success",
      detail: { taskId: task.id, state: task.state },
    });
    return clone(task);
  }

  createTask(
    userId: string,
    input: {
      patientId?: string | null | undefined;
      encounterId?: string | null | undefined;
      title: string;
      reason: string;
      ownerRole: Role;
      priority: ClinicalTask["priority"];
      dueAt: string;
      purpose?: Purpose | undefined;
      governedClinicalWorkflow?: "physician-rounds" | undefined;
    },
  ): ClinicalTask {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const patient = input.patientId ? this.patient(input.patientId) : undefined;
    if (
      !input.governedClinicalWorkflow &&
      requiresDedicatedTaskWorkflow(`${input.title}. ${input.reason}`)
    )
      throw new DomainError(
        "VALIDATION",
        "Medikations-, Behandlungs- und Diagnostikaufträge müssen im dafür freigegebenen Fachworkflow angelegt werden.",
        422,
      );
    if (
      (patient && input.encounterId !== patient.encounterId) ||
      (!patient && input.encounterId)
    )
      throw new DomainError(
        "VERSION_CONFLICT",
        "Patient und Aufenthalt der Aufgabe stimmen nicht überein.",
        409,
      );
    this.authorize(user, "task:create", purpose, patient);
    if (
      patient &&
      ![
        "care-assistant",
        "registered-nurse",
        "physician",
        "pharmacy",
        "physiotherapy",
        "occupational-therapy",
      ].includes(input.ownerRole)
    )
      throw new DomainError(
        "VALIDATION",
        "Patientengebundene Aufgaben dürfen nicht an nichtklinische Rollen adressiert werden.",
        400,
      );
    const task: ClinicalTask = {
      id: `t-${randomUUID()}`,
      patientId: input.patientId ?? null,
      encounterId: patient?.encounterId ?? null,
      title: input.title.trim(),
      reason: input.reason.trim(),
      requesterId: user.id,
      ownerRole: input.ownerRole,
      ownerId: null,
      priority: input.priority,
      dueAt: input.dueAt,
      state: "new",
      acknowledgementRequired: true,
      acknowledgedAt: null,
      dependencies: [],
      comments: [],
      completionEvidence: null,
      escalation: "Nach Ablauf an zuständige Teamleitung",
      source: this.newSource("pflegehelfer", `Task/${randomUUID()}`),
    };
    this.enqueue("task", task);
    this.state.tasks.push(task);
    this.audit.append({
      actor: user,
      action: "task:create",
      patientId: task.patientId,
      purpose,
      outcome: "success",
      detail: { taskId: task.id, ownerRole: task.ownerRole },
    });
    return clone(task);
  }

  createObservationDraft(
    userId: string,
    input: {
      patientId: string;
      encounterId: string;
      code: Observation["code"];
      value: number;
      secondaryValue?: number | null | undefined;
      effectiveAt: string;
      approvalPolicy?: ApprovalPolicy | undefined;
      purpose?: Purpose | undefined;
    },
  ): Observation {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const patient = this.patient(input.patientId);
    if (input.encounterId !== patient.encounterId)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Der Aufenthalt hat sich geändert. Bitte Patientenkontext neu öffnen.",
        409,
      );
    this.authorize(user, "observation:draft", purpose, patient);
    this.validateObservation(
      input.code,
      input.value,
      input.secondaryValue ?? null,
    );
    const effectiveTime = Date.parse(input.effectiveAt);
    if (
      !Number.isFinite(effectiveTime) ||
      effectiveTime > Date.now() + 5 * 60_000
    )
      throw new DomainError(
        "VALIDATION",
        "Die Messzeit liegt in der Zukunft. Bitte geplante Messung und bereits erhobenen Wert trennen.",
        422,
      );
    const doubtful = observationNeedsHighAssurance({
      code: input.code,
      value: input.value,
      secondaryValue: input.secondaryValue ?? null,
    });
    const observation: Observation = {
      id: `o-${randomUUID()}`,
      patientId: patient.id,
      encounterId: patient.encounterId,
      code: input.code,
      label: labels[input.code],
      value: input.value,
      secondaryValue: input.secondaryValue ?? null,
      unit: units[input.code],
      effectiveAt: input.effectiveAt,
      performerId: user.id,
      deviceId: null,
      status: "draft",
      version: 1,
      basedOnVersion: patient.source.version,
      approvalPolicy:
        doubtful &&
        (input.approvalPolicy === undefined ||
          input.approvalPolicy === "standard")
          ? "high-assurance"
          : (input.approvalPolicy ?? "standard"),
      approvals: [],
      approvedAt: null,
      source: this.newSource("pflegehelfer", `Observation/${randomUUID()}`),
    };
    this.state.observations.push(observation);
    this.audit.append({
      actor: user,
      action: "observation:draft",
      patientId: patient.id,
      purpose,
      outcome: "success",
      detail: { observationId: observation.id, code: observation.code },
    });
    return clone(observation);
  }

  createNoteDraft(
    userId: string,
    input: {
      patientId: string;
      encounterId: string;
      transcript?: string | null | undefined;
      structuredText: string;
      approvalPolicy?: ApprovalPolicy | undefined;
      provider?: ProviderId | undefined;
      purpose?: Purpose | undefined;
    },
  ): ClinicalNote {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const patient = this.patient(input.patientId);
    if (input.encounterId !== patient.encounterId)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Der Aufenthalt hat sich geändert. Bitte Patientenkontext neu öffnen.",
        409,
      );
    this.authorize(user, "note:draft", purpose, patient);
    if (input.structuredText.trim().length < 10)
      throw new DomainError("VALIDATION", "Dokumentation ist zu kurz.", 400);
    const criticalEntities = (
      input.structuredText.match(
        /\b(?:\d+(?:[.,]\d+)?\s?(?:mg|ml|mmHg|%|°C|m|kg)|kein(?:e|en)?|links|rechts)\b/gi,
      ) ?? []
    ).map((value) => value.trim());
    const note: ClinicalNote = {
      id: `n-${randomUUID()}`,
      patientId: patient.id,
      encounterId: patient.encounterId,
      transcript: input.transcript?.trim() || null,
      structuredText: input.structuredText.trim(),
      criticalEntities,
      authorId: user.id,
      status: "draft",
      version: 1,
      basedOnVersion: patient.source.version,
      approvalPolicy: input.approvalPolicy ?? "sensitive",
      approvals: [],
      approvedAt: null,
      provider:
        input.provider ?? siteConfiguration.providerRoutes.careDocumentation,
      source: this.newSource("pflegehelfer", `ClinicalNote/${randomUUID()}`),
    };
    this.state.notes.push(note);
    this.audit.append({
      actor: user,
      action: "note:draft",
      patientId: patient.id,
      purpose,
      outcome: "success",
      detail: { noteId: note.id, criticalEntityCount: criticalEntities.length },
    });
    return clone(note);
  }

  approve(
    userId: string,
    type: "observation" | "note",
    id: string,
    input: ApprovalInput,
  ): Observation | ClinicalNote {
    return this.clinicalData.transaction(() =>
      this.approveInTransaction(userId, type, id, input),
    );
  }

  private approveInTransaction(
    userId: string,
    type: "observation" | "note",
    id: string,
    input: ApprovalInput,
  ): Observation | ClinicalNote {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const collection =
      type === "observation" ? this.state.observations : this.state.notes;
    const record = collection.find((item) => item.id === id);
    if (!record)
      throw new DomainError("NOT_FOUND", "Entwurf nicht gefunden.", 404);
    const patient = this.patient(record.patientId);
    if (record.encounterId !== patient.encounterId)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Der Entwurf gehört zu einem früheren Aufenthalt.",
        409,
      );
    this.authorize(
      user,
      type === "observation" ? "observation:approve" : "note:approve",
      purpose,
      patient,
    );
    if (record.version !== input.expectedVersion)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Der Entwurf wurde zwischenzeitlich geändert.",
        409,
      );
    if (record.basedOnVersion !== patient.source.version)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Der Patientenkontext hat sich seit dem Entwurf geändert. Bitte Änderung erneut prüfen.",
        409,
      );
    if (
      patient.mrn !== input.patientMrn ||
      patient.birthDate !== input.patientBirthDate
    )
      throw new DomainError(
        "VALIDATION",
        "Zwei-Identifikatoren-Prüfung fehlgeschlagen.",
        400,
      );
    if (!input.reviewedDiff)
      throw new DomainError(
        "VALIDATION",
        "Die strukturierte Änderung muss sichtbar geprüft werden.",
        400,
      );
    if (!["draft", "reviewed"].includes(record.status))
      throw new DomainError(
        "INVALID_STATE",
        "Dieser Datensatz ist nicht mehr im Freigabefluss.",
        409,
      );
    if (record.approvals.includes(user.id))
      throw new DomainError(
        "INVALID_STATE",
        "Dieselbe Identität darf nicht zweimal freigeben.",
        409,
      );

    const requiresIndependent = ["high-assurance", "four-eyes"].includes(
      record.approvalPolicy,
    );
    const authorId =
      "authorId" in record ? record.authorId : record.performerId;
    if (
      record.approvalPolicy !== "standard" &&
      record.approvals.length === 0 &&
      user.id !== authorId
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Sensible Entwürfe müssen zuerst durch die erfassende Person freigegeben werden.",
        403,
      );
    if (
      requiresIndependent &&
      record.approvals.length === 1 &&
      user.id === authorId
    ) {
      throw new DomainError(
        "AUTH_DENIED",
        "Zweite Freigabe benötigt eine unabhängige Identität.",
        403,
      );
    }
    if (requiresIndependent && record.approvals.length === 1) {
      const requiredQualification =
        type === "observation"
          ? "clinical-observation-independent-review"
          : "clinical-note-independent-review";
      if (!user.qualificationIds?.includes(requiredQualification))
        throw new DomainError(
          "AUTH_DENIED",
          "Die unabhängige Freigabe benötigt die dafür konfigurierte fachliche Qualifikation.",
          403,
        );
    }
    record.approvals.push(user.id);
    if (requiresIndependent && record.approvals.length < 2) {
      record.status = "reviewed";
    } else {
      record.status = "pending-provider";
      record.version += 1;
      record.approvedAt ??= new Date().toISOString();
      this.enqueue(type, record);
    }
    this.audit.append({
      actor: user,
      action: `${type}:approve`,
      patientId: patient.id,
      purpose,
      outcome: "success",
      detail: {
        id,
        policy: record.approvalPolicy,
        status: record.status,
        approvals: record.approvals.length,
      },
    });
    return clone(record);
  }

  createCommunication(
    userId: string,
    input: {
      patientId: string;
      encounterId: string;
      request: string;
      reason: string;
      recipientRole: Role;
      recipientId?: string | null | undefined;
      priority: Communication["priority"];
      dueAt: string;
      purpose?: Purpose | undefined;
    },
  ): Communication {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const patient = this.patient(input.patientId);
    if (input.encounterId !== patient.encounterId)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Der Aufenthalt hat sich geändert. Bitte Patientenkontext neu öffnen.",
        409,
      );
    this.authorize(user, "communication:create", purpose, patient);
    if (
      ![
        "registered-nurse",
        "physician",
        "pharmacy",
        "physiotherapy",
        "occupational-therapy",
      ].includes(input.recipientRole)
    )
      throw new DomainError(
        "VALIDATION",
        "Patientengebundene Kommunikation darf nur an Behandlungsteams adressiert werden.",
        400,
      );
    const recipient = input.recipientId ? this.user(input.recipientId) : null;
    if (recipient && recipient.role !== input.recipientRole)
      throw new DomainError(
        "VALIDATION",
        "Die gewählte Person gehört nicht zum adressierten Behandlungsteam.",
        400,
      );
    if (recipient && !recipient.patientIds.includes(patient.id))
      throw new DomainError(
        "AUTH_DENIED",
        "Die gewählte Person hat keine Behandlungsbeziehung zu diesem Fall.",
        403,
      );
    const communication: Communication = {
      id: `c-${randomUUID()}`,
      patientId: patient.id,
      encounterId: patient.encounterId,
      request: input.request.trim(),
      reason: input.reason.trim(),
      senderId: user.id,
      recipientRole: input.recipientRole,
      recipientId: recipient?.id ?? null,
      escalationRecipientRole: null,
      escalatedAt: null,
      priority: input.priority,
      dueAt: input.dueAt,
      state: "sent",
      acknowledgedBy: null,
      answeredBy: null,
      response: null,
      resultingTaskId: null,
      source: this.newSource("pflegehelfer", `Communication/${randomUUID()}`),
    };
    this.enqueue("communication", communication);
    this.state.communications.push(communication);
    this.audit.append({
      actor: user,
      action: "communication:create",
      patientId: patient.id,
      purpose,
      outcome: "success",
      detail: {
        communicationId: communication.id,
        recipientRole: communication.recipientRole,
        recipientMode: communication.recipientId ? "individual" : "role",
      },
    });
    return clone(communication);
  }

  transitionCommunication(
    userId: string,
    id: string,
    next: "acknowledge" | "answer" | "close",
    input: {
      response?: string | undefined;
      createTask?: boolean | undefined;
      purpose?: Purpose | undefined;
    },
  ): Communication {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const item = this.state.communications.find(
      (candidate) => candidate.id === id,
    );
    if (!item)
      throw new DomainError("NOT_FOUND", "Kommunikation nicht gefunden.", 404);
    const patient = this.patient(item.patientId);
    if (item.encounterId !== patient.encounterId)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Die Kommunikation gehört zu einem früheren Aufenthalt.",
        409,
      );
    this.authorize(user, "communication:respond", purpose, patient);
    const directRecipient =
      user.role === item.recipientRole &&
      (item.recipientId === null || user.id === item.recipientId);
    const escalationRecipient =
      item.escalatedAt !== null && item.escalationRecipientRole === user.role;
    if (next !== "close" && !directRecipient && !escalationRecipient)
      throw new DomainError(
        "AUTH_DENIED",
        "Nur die adressierte Person oder das adressierte Team darf antworten.",
        403,
      );
    if (
      next === "close" &&
      user.id !== item.senderId &&
      user.id !== item.answeredBy
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Nur die anfragende oder antwortende Person darf die Schleife schliessen.",
        403,
      );
    if (next === "acknowledge") {
      if (
        !["sent", "escalated"].includes(item.state) ||
        item.acknowledgedBy !== null
      )
        throw new DomainError("INVALID_STATE", "Bereits quittiert.", 409);
      item.state = "acknowledged";
      item.acknowledgedBy = user.id;
    }
    if (next === "answer") {
      if (
        !["sent", "acknowledged", "escalated"].includes(item.state) ||
        !input.response?.trim()
      )
        throw new DomainError(
          "VALIDATION",
          "Eine Antwort ist erforderlich.",
          400,
        );
      const responseOwner = item.acknowledgedBy ?? user.id;
      if (responseOwner !== user.id)
        throw new DomainError(
          "AUTH_DENIED",
          "Nur die Person, die die Anfrage übernommen hat, darf antworten.",
          403,
        );
      item.state = "answered";
      item.acknowledgedBy = responseOwner;
      item.answeredBy = user.id;
      item.response = input.response.trim();
      if (input.createTask)
        item.resultingTaskId = this.createTask(user.id, {
          patientId: patient.id,
          encounterId: patient.encounterId,
          title: "Folgeauftrag aus Antwort",
          reason: item.response,
          ownerRole: "registered-nurse",
          priority: item.priority,
          dueAt: item.dueAt,
          purpose,
        }).id;
    }
    if (next === "close") {
      if (item.state !== "answered")
        throw new DomainError(
          "INVALID_STATE",
          "Nur beantwortete Anfragen können geschlossen werden.",
          409,
        );
      item.state = "closed";
    }
    item.source.version += 1;
    if (item.source.provider === "pflegehelfer")
      this.enqueue("communication", item);
    this.audit.append({
      actor: user,
      action: `communication:${next}`,
      patientId: patient.id,
      purpose,
      outcome: "success",
      detail: { communicationId: item.id, state: item.state },
    });
    return clone(item);
  }

  reviewIntakeItem(
    userId: string,
    id: string,
    detail: string,
    purpose?: Purpose,
  ): IntakeItem {
    const user = this.user(userId);
    const activePurpose = purpose ?? user.defaultPurpose;
    const item = this.state.intake.find((candidate) => candidate.id === id);
    if (!item)
      throw new DomainError("NOT_FOUND", "Eintrittspunkt nicht gefunden.", 404);
    const patient = this.patient(item.patientId);
    this.authorize(user, "intake:update", activePurpose, patient);
    if (
      user.role !== item.ownerRole &&
      !["registered-nurse", "physician"].includes(user.role)
    ) {
      throw new DomainError(
        "AUTH_DENIED",
        "Nur die verantwortliche Rolle darf diesen Eintrittspunkt klären.",
        403,
      );
    }
    if (item.state === "complete" || item.state === "reviewed")
      throw new DomainError(
        "INVALID_STATE",
        "Eintrittspunkt ist bereits abgeschlossen.",
        409,
      );
    if (detail.trim().length < 10)
      throw new DomainError(
        "VALIDATION",
        "Eine nachvollziehbare Klärung ist erforderlich.",
        400,
      );
    const linkedTask = item.taskId
      ? this.state.tasks.find((task) => task.id === item.taskId)
      : undefined;
    if (
      linkedTask &&
      (linkedTask.ownerRole !== user.role ||
        (linkedTask.ownerId !== null && linkedTask.ownerId !== user.id))
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Der verknüpfte Eintrittsauftrag muss von seiner verantwortlichen Rolle und Person abgeschlossen werden.",
        403,
      );
    if (linkedTask?.state === "completed")
      throw new DomainError(
        "INVALID_STATE",
        "Der verknüpfte Eintrittsauftrag ist bereits abgeschlossen.",
        409,
      );
    item.state = "reviewed";
    item.detail = `${item.detail} Klärung: ${detail.trim()}`;
    if (linkedTask) {
      linkedTask.state = "completed";
      linkedTask.ownerId ??= user.id;
      linkedTask.acknowledgedAt ??= new Date().toISOString();
      linkedTask.completionEvidence = detail.trim();
      linkedTask.source.version += 1;
      this.audit.append({
        actor: user,
        action: "task:complete",
        patientId: patient.id,
        purpose: activePurpose,
        outcome: "success",
        detail: { taskId: linkedTask.id, viaIntakeItemId: item.id },
      });
    }
    this.audit.append({
      actor: user,
      action: "intake:review",
      patientId: patient.id,
      purpose: activePurpose,
      outcome: "success",
      detail: { intakeItemId: id },
    });
    return clone(item);
  }

  createRoundAction(
    userId: string,
    input: {
      patientId: string;
      actionKind: RoundAction["actionKind"];
      ownerRole: Role;
      deadline: string;
      targetSystem: ProviderId | "pflegehelfer";
      purpose?: Purpose | undefined;
    },
  ): RoundAction {
    const user = this.user(userId);
    const purpose = input.purpose ?? user.defaultPurpose;
    const patient = this.patient(input.patientId);
    this.authorize(user, "round:decide", purpose, patient);
    if (input.targetSystem !== "pflegehelfer")
      throw new DomainError(
        "EXTERNAL_VENDOR_GATE",
        "Visitenaufträge an Fremdsysteme benötigen einen verifizierten Vendor-Vertrag.",
        409,
      );
    if (
      ![
        "care-assistant",
        "registered-nurse",
        "physician",
        "pharmacy",
        "physiotherapy",
        "occupational-therapy",
      ].includes(input.ownerRole)
    )
      throw new DomainError(
        "VALIDATION",
        "Visitenaufträge dürfen nur an Versorgungsteams adressiert werden.",
        400,
      );
    const template = roundActionCatalog[input.actionKind];
    const task = this.createTask(user.id, {
      patientId: patient.id,
      encounterId: patient.encounterId,
      title: template.decision,
      reason: "Beschluss aus Visite",
      ownerRole: input.ownerRole,
      priority: "routine",
      dueAt: input.deadline,
      purpose,
      governedClinicalWorkflow: "physician-rounds",
    });
    const action: RoundAction = {
      id: `r-${randomUUID()}`,
      patientId: patient.id,
      actionKind: input.actionKind,
      decision: template.decision,
      category: template.category,
      ownerRole: input.ownerRole,
      deadline: input.deadline,
      requiredConfirmation: template.requiredConfirmation,
      targetSystem: input.targetSystem,
      status: "approved",
      createdBy: user.id,
      taskId: task.id,
    };
    this.state.roundActions.push(action);
    this.audit.append({
      actor: user,
      action: "round:decision",
      patientId: patient.id,
      purpose,
      outcome: "success",
      detail: { roundActionId: action.id, taskId: task.id },
    });
    return clone(action);
  }

  triggerNurseCall(userId: string, patientId: string): ClinicalTask {
    const user = this.user(userId);
    this.authorize(user, "provider:operate", user.defaultPurpose);
    const patient = this.patient(patientId);
    const task = this.createSystemTask({
      patientId,
      title: `Klingel ${patient.room}`,
      reason: "Gespiegeltes Ereignis der primären Rufanlage",
      ownerRole: "care-assistant",
      priority: "urgent",
      dueAt: new Date(Date.now() + 2 * 60_000).toISOString(),
      escalation:
        "Primäre Rufanlage bleibt massgebend; nach 2 Minuten an Pflegefachperson.",
    });
    this.audit.append({
      actor: user,
      action: "nurse-call:mirror",
      patientId,
      purpose: "operations",
      outcome: "success",
      detail: { taskId: task.id, primarySystemAuthoritative: true },
    });
    return clone(task);
  }

  runNurseCallEscalations(
    userId: string,
    now = new Date().toISOString(),
  ): ClinicalTask[] {
    const user = this.user(userId);
    this.authorize(user, "provider:operate", user.defaultPurpose);
    return this.escalateNurseCalls(user, "human", now, randomUUID());
  }

  runCommunicationEscalations(
    userId: string,
    now = new Date().toISOString(),
  ): Communication[] {
    const user = this.user(userId);
    this.authorize(user, "provider:operate", user.defaultPurpose);
    return this.escalateCommunications(user, "human", now, randomUUID());
  }

  runScheduledEscalations(now = new Date().toISOString()): {
    nurseCalls: ClinicalTask[];
    communications: Communication[];
  } {
    const correlationId = randomUUID();
    return {
      nurseCalls: this.escalateNurseCalls(
        deadlineEngineActor,
        "system",
        now,
        correlationId,
      ),
      communications: this.escalateCommunications(
        deadlineEngineActor,
        "system",
        now,
        correlationId,
      ),
    };
  }

  private escalateNurseCalls(
    actor: DemoUser,
    actorType: "human" | "system",
    now: string,
    correlationId: string,
  ): ClinicalTask[] {
    const deadline = Date.parse(now);
    if (!Number.isFinite(deadline))
      throw new DomainError("VALIDATION", "Ungültiger Prüfzeitpunkt.", 400);
    const escalated: ClinicalTask[] = [];
    for (const task of this.state.tasks) {
      if (
        task.source.provider !== "nurse-call" ||
        task.state !== "new" ||
        task.acknowledgedAt !== null ||
        Date.parse(task.dueAt) > deadline
      )
        continue;
      task.state = "escalated";
      task.ownerRole = "registered-nurse";
      task.ownerId = null;
      task.comments.push(
        "Deterministisch eskaliert; das primäre Rufsystem bleibt autoritativ.",
      );
      task.source.version += 1;
      this.audit.append({
        actor,
        actorType,
        action: "nurse-call:escalate",
        patientId: task.patientId,
        purpose: "operations",
        outcome: "success",
        detail: {
          taskId: task.id,
          primarySystemAuthoritative: true,
          rule: "nurse-call-unacknowledged-v1",
          correlationId,
        },
      });
      escalated.push(clone(task));
    }
    return escalated;
  }

  private escalateCommunications(
    actor: DemoUser,
    actorType: "human" | "system",
    now: string,
    correlationId: string,
  ): Communication[] {
    const deadline = Date.parse(now);
    if (!Number.isFinite(deadline))
      throw new DomainError("VALIDATION", "Ungültiger Prüfzeitpunkt.", 400);
    const escalated: Communication[] = [];
    for (const item of this.state.communications) {
      if (item.state !== "sent" || Date.parse(item.dueAt) > deadline) continue;
      item.state = "escalated";
      item.priority = "urgent";
      item.escalationRecipientRole = item.recipientRole;
      item.escalatedAt = now;
      item.source.version += 1;
      this.audit.append({
        actor,
        actorType,
        action: "communication:deadline-escalate",
        patientId: item.patientId,
        purpose: "operations",
        outcome: "success",
        detail: {
          communicationId: item.id,
          recipientMode: item.recipientId ? "individual" : "role",
          escalationRoute: `on-call:${item.recipientRole}`,
          rule: "communication-unacknowledged-due-v1",
          correlationId,
        },
      });
      escalated.push(clone(item));
    }
    return escalated;
  }

  setProviderMode(
    userId: string,
    provider: ProviderId,
    mode: ProviderSimulatorMode,
  ): ProviderHealth {
    const user = this.user(userId);
    this.authorize(user, "provider:operate", user.defaultPurpose);
    const registryHealth = this.providerRegistry.setSimulatorMode(
      provider,
      mode,
    );
    const health: ProviderHealth = {
      provider,
      status:
        registryHealth.status === "unavailable"
          ? "down"
          : registryHealth.status,
      latencyMs: registryHealth.latencyMs ?? 0,
      checkedAt: registryHealth.checkedAt,
      message: registryHealth.message,
    };
    this.state.providerHealth = this.state.providerHealth
      .filter((item) => item.provider !== provider)
      .concat(health);
    this.audit.append({
      actor: user,
      action: "provider:simulator-mode",
      patientId: null,
      purpose: "operations",
      outcome: "success",
      detail: { provider, mode },
    });
    return clone(health);
  }

  async flushOutbox(userId: string): Promise<OutboxSummary[]> {
    const user = this.user(userId);
    this.authorize(user, "provider:operate", user.defaultPurpose);
    for (const item of this.state.outbox.filter((candidate) =>
      ["pending", "processing"].includes(candidate.state),
    )) {
      item.attempts += 1;
      item.lastAttemptAt = new Date().toISOString();
      item.state = "processing";
      try {
        const command = this.providerCommand(item);
        const adapter = this.providerRegistry.adapterForOperation(
          item.provider,
          this.providerProfile,
          command.operation,
        );
        if (!adapter) throw new Error("PROVIDER_UNAVAILABLE");
        const receipt = item.receiptId
          ? await adapter.getCommandStatus(item.receiptId)
          : await adapter.executeCommand(await adapter.prepareCommand(command));
        item.receiptId = receipt.receiptId;
        item.providerVersion = receipt.providerVersion;
        item.errorCode = receipt.errorCode;
        item.errorClassification = receipt.errorClassification;
        item.conflictSnapshot =
          receipt.status === "conflict"
            ? {
                version: item.providerVersion ?? "unknown",
                summary: `${this.clinicalOutboxSummary(item).localSummary} (synthetischer Parallelstand im Provider)`,
              }
            : null;
        item.state =
          receipt.status === "acknowledged" ? "acknowledged" : receipt.status;
        this.updateAggregateSync(
          item,
          receipt.status === "acknowledged"
            ? "synced"
            : receipt.status === "pending"
              ? "pending-provider"
              : receipt.status,
        );
        this.audit.append({
          actor: user,
          action: "provider:command-result",
          patientId: item.patientId,
          purpose: "operations",
          outcome: receipt.status === "acknowledged" ? "success" : "failure",
          detail: {
            outboxId: item.id,
            provider: item.provider,
            status: receipt.status,
            receiptId: receipt.receiptId,
          },
        });
      } catch {
        item.state = "pending";
        item.errorCode = "PROVIDER_UNAVAILABLE";
        this.updateAggregateSync(item, "pending-provider");
        this.audit.append({
          actor: user,
          action: "provider:command-result",
          patientId: item.patientId,
          purpose: "operations",
          outcome: "failure",
          detail: {
            outboxId: item.id,
            provider: item.provider,
            status: "unavailable",
          },
        });
      }
    }
    return this.state.outbox.map((item) => this.outboxSummary(item));
  }

  hasPendingProviderWork(): boolean {
    return this.state.outbox.some((item) =>
      ["pending", "processing"].includes(item.state),
    );
  }

  providerSyncState(
    patientIds: readonly string[],
  ): "pending" | "simulated-acknowledged" | "external-gated" {
    const relevant = this.state.outbox.filter((item) =>
      patientIds.includes(item.patientId),
    );
    if (relevant.some((item) => ["pending", "processing"].includes(item.state)))
      return "pending";
    if (
      relevant.length > 0 &&
      relevant.every((item) => item.state === "acknowledged") &&
      this.providerProfile === "synthetic-simulator"
    )
      return "simulated-acknowledged";
    return "external-gated";
  }

  reconcileOutbox(
    userId: string,
    outboxId: string,
    input: {
      confirmedVersionComparison: boolean;
      expectedLocalVersion: number;
      expectedLocalHash: string;
      expectedProviderVersion: string | null;
      expectedProviderHash: string | null;
    },
  ): OutboxSummary {
    const user = this.user(userId);
    const item = this.state.outbox.find(
      (candidate) => candidate.id === outboxId,
    );
    if (!item)
      throw new DomainError("NOT_FOUND", "Outbox-Eintrag nicht gefunden.", 404);
    if (!input.confirmedVersionComparison)
      throw new DomainError(
        "VALIDATION",
        "Lokale und Provider-Version müssen sichtbar geprüft werden.",
        400,
      );
    const current = this.outboxSummary(item);
    if (
      input.expectedLocalVersion !== current.localVersion ||
      input.expectedLocalHash !== current.localHash ||
      input.expectedProviderVersion !== current.providerVersion ||
      input.expectedProviderHash !== current.providerHash
    )
      throw new DomainError(
        "INVALID_STATE",
        "Der angezeigte Vergleichsstand hat sich geändert; bitte neu laden und erneut prüfen.",
        409,
      );
    const clinicalRejection =
      item.state === "rejected" &&
      ["clinical-content", "mapping"].includes(item.errorClassification ?? "");
    if (item.state === "conflict" && !item.conflictSnapshot)
      throw new DomainError(
        "INVALID_STATE",
        "Der Provider-Konflikt enthält keinen vergleichbaren Stand.",
        409,
      );
    if (item.state === "conflict" || clinicalRejection) {
      if (!["registered-nurse", "physician"].includes(user.role))
        throw new DomainError(
          "AUTH_DENIED",
          "Klinische Konflikte benötigen eine berechtigte Fachperson.",
          403,
        );
      this.authorize(
        user,
        "patient:read",
        user.defaultPurpose,
        this.patient(item.patientId),
      );
    } else {
      this.authorize(user, "provider:operate", user.defaultPurpose);
    }
    if (item.state !== "conflict" && item.state !== "rejected")
      throw new DomainError(
        "INVALID_STATE",
        "Nur Konflikte oder Ablehnungen können neu eingereiht werden.",
        409,
      );
    const priorState = item.state;
    const priorError = item.errorCode;
    item.expectedProviderVersion = item.providerVersion;
    item.idempotencyKey = createHash("sha256")
      .update(
        `${item.idempotencyKey}:reconcile:${item.providerVersion ?? "unknown"}:${item.attempts}`,
      )
      .digest("hex");
    item.receiptId = null;
    item.state = "pending";
    item.errorCode = null;
    item.errorClassification = null;
    item.lastAttemptAt = null;
    this.updateAggregateSync(item, "pending-provider");
    this.audit.append({
      actor: user,
      action: "provider:reconciliation-decision",
      patientId: item.patientId,
      purpose: "operations",
      outcome: "success",
      detail: {
        outboxId: item.id,
        provider: item.provider,
        decision: "retry-local-after-version-review",
        priorState,
        priorError,
        expectedProviderVersion: item.expectedProviderVersion,
      },
    });
    return ["registered-nurse", "physician"].includes(user.role)
      ? this.clinicalOutboxSummary(item)
      : this.outboxSummary(item);
  }

  auditEvidence(userId: string): {
    valid: boolean;
    count: number;
    chainHeadHash: string;
    actionCounts: Record<string, number>;
  } {
    const user = this.user(userId);
    this.authorize(user, "audit:verify", user.defaultPurpose);
    const entries = this.audit.snapshot();
    const actionCounts: Record<string, number> = {};
    for (const entry of entries)
      actionCounts[entry.action] = (actionCounts[entry.action] ?? 0) + 1;
    return {
      valid: this.audit.verify(),
      count: entries.length,
      chainHeadHash: entries.at(-1)?.hash ?? "GENESIS",
      actionCounts,
    };
  }

  currentHealth(): ProviderHealth[] {
    return clone(this.state.providerHealth);
  }

  private enqueue(
    type: "observation" | "note" | "task" | "communication",
    record: Observation | ClinicalNote | ClinicalTask | Communication,
  ): void {
    if (record.patientId === null) return;
    const patientId = record.patientId;
    const provider =
      type === "observation"
        ? siteConfiguration.providerRoutes.observations
        : type === "note"
          ? (record as ClinicalNote).provider
          : siteConfiguration.providerRoutes.careDocumentation;
    const operation = {
      observation: "Observation.write",
      note: "NursingNote.write",
      task: "Task.write",
      communication: "Communication.write",
    }[type] as ProviderOperation;
    const capability = this.providerRegistry
      .manifest(provider, this.providerProfile)
      ?.capabilities.find((item) => item.operation === operation)?.support;
    const providerWriteAvailable =
      capability === "supported" || capability === "conditional";
    if (!providerWriteAvailable && (type === "observation" || type === "note"))
      (record as Observation | ClinicalNote).status = "external-gated";
    const version =
      "version" in record ? record.version : record.source.version;
    const key = idempotency(type, record.id, version);
    if (this.state.outbox.some((item) => item.idempotencyKey === key)) return;
    this.state.outbox.push({
      id: `out-${randomUUID()}`,
      aggregateType: type,
      aggregateId: record.id,
      patientId,
      provider,
      idempotencyKey: key,
      expectedProviderVersion: null,
      canonicalCommand: {
        kind:
          type === "observation"
            ? "observation.upsert"
            : type === "note"
              ? "nursing-note.upsert"
              : type === "task"
                ? "task.upsert"
                : "communication.upsert",
        resource: clone(record),
      },
      correlationId: randomUUID(),
      causationId: `${type}:${record.id}:approval:${version}`,
      attempts: 0,
      state: providerWriteAvailable ? "pending" : "external-gated",
      createdAt: new Date().toISOString(),
      lastAttemptAt: null,
      receiptId: null,
      providerVersion: null,
      errorCode: providerWriteAvailable ? null : "EXTERNAL_VENDOR_GATE",
      errorClassification: null,
      conflictSnapshot: null,
    });
  }

  private updateAggregateSync(item: OutboxItem, state: SyncState): void {
    if (item.aggregateType === "task" || item.aggregateType === "communication")
      return;
    const collection =
      item.aggregateType === "observation"
        ? this.state.observations
        : this.state.notes;
    const record = collection.find(
      (candidate) => candidate.id === item.aggregateId,
    );
    if (record) {
      record.status = state;
      record.source.syncedAt =
        state === "synced" ? new Date().toISOString() : null;
    }
  }

  private providerCommand(item: OutboxItem): CanonicalClinicalCommand {
    const resource = item.canonicalCommand.resource;
    return {
      commandId: item.id,
      operation:
        item.aggregateType === "observation"
          ? "Observation.write"
          : item.aggregateType === "note"
            ? "NursingNote.write"
            : item.aggregateType === "task"
              ? "Task.write"
              : "Communication.write",
      patientReference: `Patient/${item.patientId}`,
      resource: {
        resourceType:
          item.aggregateType === "observation"
            ? "Observation"
            : item.aggregateType === "note"
              ? "DocumentReference"
              : item.aggregateType === "task"
                ? "Task"
                : "Communication",
        id: item.aggregateId,
        body: clone(resource) as unknown as Readonly<Record<string, unknown>>,
      },
      expectedProviderVersion: item.expectedProviderVersion,
      mappingVersion: resource.source.mappingVersion,
      correlationId: item.correlationId,
      causationId: item.causationId,
      idempotencyKey: item.idempotencyKey,
      approvedAt:
        "approvedAt" in resource && resource.approvedAt
          ? resource.approvedAt
          : item.createdAt,
    };
  }

  private outboxSummary(item: OutboxItem): OutboxSummary {
    return {
      id: item.id,
      aggregateType: item.aggregateType,
      aggregateId: item.aggregateId,
      provider: item.provider,
      state: item.state,
      attempts: item.attempts,
      errorCode: item.errorCode,
      errorClassification: item.errorClassification,
      createdAt: item.createdAt,
      expectedProviderVersion: item.expectedProviderVersion,
      providerVersion: item.providerVersion,
      localVersion:
        "version" in item.canonicalCommand.resource
          ? item.canonicalCommand.resource.version
          : item.canonicalCommand.resource.source.version,
      localHash: createHash("sha256")
        .update(JSON.stringify(item.canonicalCommand.resource))
        .digest("hex"),
      providerHash: item.conflictSnapshot
        ? createHash("sha256")
            .update(JSON.stringify(item.conflictSnapshot))
            .digest("hex")
        : null,
    };
  }

  private clinicalOutboxSummary(item: OutboxItem): ClinicalOutboxSummary {
    const resource = item.canonicalCommand.resource;
    return {
      ...this.outboxSummary(item),
      patientId: item.patientId,
      localSummary:
        "label" in resource
          ? `${resource.label}: ${resource.value}${resource.secondaryValue !== null ? `/${resource.secondaryValue}` : ""} ${resource.unit}`
          : "structuredText" in resource
            ? resource.structuredText
            : "title" in resource
              ? resource.title
              : resource.request,
      conflictSnapshot: item.conflictSnapshot
        ? { ...item.conflictSnapshot }
        : null,
    };
  }

  private validateObservation(
    code: Observation["code"],
    value: number,
    secondaryValue: number | null,
  ): void {
    if (!Number.isFinite(value))
      throw new DomainError("VALIDATION", "Messwert muss endlich sein.", 400);
    const ranges: Record<Observation["code"], [number, number]> = {
      "blood-pressure": [1, 500],
      temperature: [-20, 60],
      "oxygen-saturation": [0, 100],
      pulse: [0, 500],
      weight: [0, 1000],
    };
    const [min, max] = ranges[code];
    if (value < min || value > max)
      throw new DomainError(
        "VALIDATION",
        "Messwert liegt ausserhalb der technisch plausiblen Grenze.",
        400,
      );
    if (
      code === "blood-pressure" &&
      (secondaryValue === null || secondaryValue < 0 || secondaryValue > 500)
    )
      throw new DomainError(
        "VALIDATION",
        "Blutdruck benötigt einen plausiblen systolischen und diastolischen Wert.",
        400,
      );
    if (code !== "blood-pressure" && secondaryValue !== null)
      throw new DomainError(
        "VALIDATION",
        "Ein zweiter Wert ist für diese Messung nicht zulässig.",
        400,
      );
  }

  private newSource(provider: ProviderId | "pflegehelfer", externalId: string) {
    const now = new Date().toISOString();
    return {
      provider,
      externalId,
      version: 1,
      mappingVersion: "demo-r4-ch-core-6.0.0-v1",
      effectiveAt: now,
      recordedAt: now,
      receivedAt: now,
      syncedAt: provider === "pflegehelfer" ? null : now,
    };
  }

  private createSystemTask(input: {
    patientId: string;
    title: string;
    reason: string;
    ownerRole: Role;
    priority: ClinicalTask["priority"];
    dueAt: string;
    escalation: string;
  }): ClinicalTask {
    const task: ClinicalTask = {
      id: `t-${randomUUID()}`,
      patientId: input.patientId,
      encounterId: this.patient(input.patientId).encounterId,
      title: input.title,
      reason: input.reason,
      requesterId: "system:nurse-call-adapter",
      ownerRole: input.ownerRole,
      ownerId: null,
      priority: input.priority,
      dueAt: input.dueAt,
      state: "new",
      acknowledgementRequired: true,
      acknowledgedAt: null,
      dependencies: [],
      comments: [],
      completionEvidence: null,
      escalation: input.escalation,
      source: this.newSource("nurse-call", `Bell/${randomUUID()}`),
    };
    this.state.tasks.push(task);
    return task;
  }
}

export function isDomainError(error: unknown): error is DomainErrorType {
  return error instanceof DomainError;
}
