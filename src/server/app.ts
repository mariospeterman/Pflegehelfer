import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Writable } from "node:stream";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AssistantService,
  toOpenUi,
  type AssistantResponse,
} from "../core/assistant-service.js";
import { fhirResourceId } from "../core/fhir-resource-set.js";
import { AsrGateway } from "../ai/asr-gateway.js";
import { TtsGateway } from "../ai/tts-gateway.js";
import { ModelGateway } from "../ai/model-gateway.js";
import { ApprovedKnowledgeService } from "../ai/approved-knowledge.js";
import {
  completionEvidenceIsGrounded,
  completionEvidenceIsIncomplete,
  assistantProposalSchema,
  requiresDedicatedClinicalWorkflow,
} from "../ai/assistant-proposal.js";
import { isDomainError, PflegehelferService } from "../core/service.js";
import { emptyWorkflowState } from "../core/service.js";
import { siteConfiguration } from "../core/site-config.js";
import { decide, type Action } from "../core/policy.js";
import { runtimeSitePack } from "../core/runtime-instructions.js";
import { InMemoryReferenceStatePort } from "../core/clinical-data-port.js";
import { DomainError, type Purpose } from "../core/types.js";
import type { AssistantComponent } from "../core/assistant.js";
import {
  createProductionProviderRegistry,
  createSyntheticProviderRegistry,
  ProviderDeliveryWorker,
  providerIntegrationRoutes,
  type ProviderDeliveryStore,
} from "../core/provider-integration/index.js";
import { ClinicalProjectionWorker } from "../core/clinical-projection-worker.js";
import {
  InMemoryClinicalWorkspace,
  type ClinicalWorkspace,
} from "../infrastructure/medplum-workspace.js";
import {
  InMemoryOperationalStore,
  type DurableVoiceAuthority,
  type OperationalStore,
} from "../infrastructure/operational-store.js";
import type { WorkdayCommand } from "../core/workday.js";
import type { RuntimeProfileConfiguration } from "./runtime-profile.js";

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
const providerSchema = z.enum([
  "wicare",
  "carecoach",
  "sap-vitals",
  "device-gateway",
  "nurse-call",
]);
const purposeSchema = z.enum([
  "direct-care",
  "operations",
  "administration",
  "quality-review",
]);
const prioritySchema = z.enum(["routine", "elevated", "urgent"]);
const taskBody = z.object({
  evidence: z.string().max(500).optional(),
  delegateRole: roleSchema.optional(),
  purpose: purposeSchema.optional(),
});
const taskCreateBody = z.object({
  patientId: z.string().nullable().optional(),
  encounterId: z.string().nullable().optional(),
  title: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(3).max(500),
  ownerRole: roleSchema,
  priority: prioritySchema,
  dueAt: z.iso.datetime(),
  purpose: purposeSchema.optional(),
});
const observationBody = z.object({
  patientId: z.string(),
  encounterId: z.string(),
  code: z.enum([
    "blood-pressure",
    "temperature",
    "oxygen-saturation",
    "pulse",
    "weight",
  ]),
  value: z.number(),
  secondaryValue: z.number().nullable().optional(),
  effectiveAt: z.iso.datetime(),
  purpose: purposeSchema.optional(),
});
const noteBody = z.object({
  patientId: z.string(),
  encounterId: z.string(),
  transcript: z.string().max(4000).nullable().optional(),
  structuredText: z.string().trim().min(10).max(8000),
  purpose: purposeSchema.optional(),
});
const approveBody = z.object({
  expectedVersion: z.number().int().positive(),
  patientMrn: z.string(),
  patientBirthDate: z.iso.date(),
  reviewedDiff: z.literal(true),
  purpose: purposeSchema.optional(),
});
const communicationBody = z.object({
  patientId: z.string(),
  encounterId: z.string(),
  request: z.string().trim().min(3).max(1000),
  reason: z.string().trim().min(3).max(1000),
  recipientRole: roleSchema,
  recipientId: z.string().nullable().optional(),
  priority: prioritySchema,
  dueAt: z.iso.datetime(),
  purpose: purposeSchema.optional(),
});
const communicationTransitionBody = z.object({
  response: z.string().trim().max(2000).optional(),
  createTask: z.boolean().optional(),
  purpose: purposeSchema.optional(),
});
const roundBody = z.object({
  patientId: z.string(),
  actionKind: z.enum([
    "mobility-followup",
    "vital-sign-followup",
    "wound-observation",
    "therapy-followup",
    "diagnostic-followup",
  ]),
  ownerRole: roleSchema,
  deadline: z.iso.datetime(),
  targetSystem: z.union([providerSchema, z.literal("pflegehelfer")]),
  purpose: purposeSchema.optional(),
});
const intakeReviewBody = z.object({
  detail: z.string().trim().min(10).max(1000),
  purpose: purposeSchema.optional(),
});
const reconciliationBody = z.object({
  confirmedVersionComparison: z.literal(true),
  expectedLocalVersion: z.number().int().positive(),
  expectedLocalHash: z.string().regex(/^[a-f0-9]{64}$/),
  expectedProviderVersion: z.string().min(1).max(200).nullable(),
  expectedProviderHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
});
const assistantQueryBody = z
  .object({
    prompt: z.string().trim().min(2).max(1200),
    patientId: z.string().nullable(),
    purpose: purposeSchema.optional(),
    inputModality: z.enum(["typed", "voice"]).default("typed"),
    voiceTranscriptConfirmed: z.boolean().optional(),
    voiceReceiptId: z.uuid().optional(),
    voiceConfirmedEntityIds: z.array(z.string().max(120)).max(64).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.inputModality === "voice" && !input.voiceTranscriptConfirmed)
      context.addIssue({
        code: "custom",
        path: ["voiceTranscriptConfirmed"],
        message: "Voice transcripts require explicit review.",
      });
    if (input.inputModality === "voice" && !input.voiceReceiptId)
      context.addIssue({
        code: "custom",
        path: ["voiceReceiptId"],
        message: "Voice input requires a server-issued transcription receipt.",
      });
  });
type AssistantQueryBody = z.infer<typeof assistantQueryBody>;
const assistantIntentBody = z
  .object({
    patientId: z.string(),
    encounterId: z.string(),
    purpose: purposeSchema,
    resourceVersion: z.number().int().nonnegative(),
    explicitlyConfirmed: z.literal(true),
    reviewedActionIds: z
      .array(z.string().regex(/^action-(?:[1-9]|1[0-2])$/))
      .max(12)
      .optional(),
  })
  .strict();

function archiveAssistantResponse(
  response: AssistantResponse,
): AssistantResponse {
  const hadAction = response.components.some(
    (component) => component.type === "DraftAction",
  );
  const components = response.components.filter(
    (component) => component.type !== "DraftAction",
  );
  if (hadAction)
    components.push({
      type: "SafetyAlert",
      severity: "info",
      message:
        "Diese frühere offene Änderung ist nicht mehr ausführbar. Bitte neu formulieren, damit Kontext und Version erneut geprüft werden.",
    });
  return {
    ...response,
    components,
    openUi: toOpenUi(components),
  };
}

export function buildApp(
  providedService?: PflegehelferService,
  options: {
    demoMode?: boolean;
    workspace?: ClinicalWorkspace;
    operationalStore?: OperationalStore;
    modelGateway?: ModelGateway;
    runtime?: RuntimeProfileConfiguration;
    loggerStream?: Writable;
    loggerLevel?: string;
  } = {},
): FastifyInstance {
  const demoMode = options.demoMode ?? process.env.PFH_DEMO_MODE === "true";
  const workspace = options.workspace ?? new InMemoryClinicalWorkspace();
  const operationalStore =
    options.operationalStore ?? new InMemoryOperationalStore();
  const runtime =
    options.runtime ??
    ({
      profile: demoMode ? "memory-demo" : "production",
      demoMode,
      storageMode: workspace.mode,
      persistenceMode: operationalStore.mode,
      providerMode: demoMode ? "in-process-simulator" : "production",
    } satisfies RuntimeProfileConfiguration);
  const service =
    providedService ??
    new PflegehelferService(
      demoMode
        ? undefined
        : new InMemoryReferenceStatePort(emptyWorkflowState()),
      demoMode
        ? createSyntheticProviderRegistry()
        : createProductionProviderRegistry(),
      demoMode ? "synthetic-simulator" : "production",
    );
  const models = options.modelGateway ?? new ModelGateway();
  const asr = new AsrGateway();
  const tts = new TtsGateway();
  const knowledge = new ApprovedKnowledgeService();
  const assistant = new AssistantService(service, models, knowledge);
  const effectiveDataClass = () =>
    service.dataClass() === "synthetic-demo" &&
    service.providerProfile === "synthetic-simulator"
      ? ("synthetic-demo" as const)
      : ("institution-local" as const);
  const assistantWorkingContext = async (
    actorId: string,
    previousCarePlan: string | null = null,
  ) => {
    const actor = service.user(actorId);
    const configuredWorkflowId =
      siteConfiguration.roleProfiles[actor.role]?.workflowId ?? null;
    const staffAssignment = siteConfiguration.staffAssignments.find(
      (assignment) => assignment.actorId === actorId,
    );
    const runtimeRole = staffAssignment?.roleProfileId
      ? runtimeSitePack.roles[staffAssignment.roleProfileId]
      : null;
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    const recentTurns = (
      await operationalStore.loadConversation(
        actorId,
        actor.role,
        session.patientId,
      )
    ).slice(-4);
    const recentPrompts = recentTurns.map((turn) => turn.prompt);
    const recentConversation = recentTurns.flatMap((turn) => {
      const response = turn.response as Partial<AssistantResponse> | null;
      const assistantSummary = (response?.components ?? [])
        .flatMap((component) => {
          if (component.type === "AssistantText") return [component.message];
          if (component.type === "DraftAction") return [component.preview];
          return [];
        })
        .join(" · ")
        .slice(0, 400);
      return [
        { role: "user" as const, text: turn.prompt },
        ...(assistantSummary
          ? [{ role: "assistant" as const, text: assistantSummary }]
          : []),
      ];
    });
    const workday = ["care-assistant", "registered-nurse"].includes(actor.role)
      ? await operationalStore.getWorkday(actorId, actor.role)
      : null;
    return {
      organizationId: siteConfiguration.institutionId,
      sessionId: session.id,
      threadId: session.threadId,
      contextRevision: session.contextRevision,
      departmentId: siteConfiguration.department.id,
      stationId: staffAssignment?.stationId ?? null,
      roleProfileId: runtimeRole?.id ?? null,
      workflowId: configuredWorkflowId,
      currentStepId: session.currentStepId,
      activeEpisodeTitle: workday?.activeEpisode?.title ?? null,
      activeEpisodePatientId: workday?.activeEpisode?.patientId ?? null,
      resumableEpisodePatientId: workday?.resumableEpisode?.patientId ?? null,
      recentPrompts,
      recentConversation,
      previousCarePlan,
      organizationLabel: siteConfiguration.displayName,
      actorRole: actor.role,
      dataClass: effectiveDataClass(),
      workdayHandover: workday
        ? {
            shiftKey: workday.handover.shiftKey,
            status: workday.handover.status,
            acknowledgedCount: workday.handover.acknowledgedPatientIds.length,
            assignedCount: workday.handover.patientIds.length,
            openCount:
              workday.plan.filter((item) => item.status !== "completed")
                .length +
              workday.incomingTransfers.filter(
                (item) => item.state === "pending",
              ).length,
            summary: [
              `${workday.handover.acknowledgedPatientIds.length}/${workday.handover.patientIds.length} Patientenkontexte geprüft`,
              ...workday.plan.map(
                (item) =>
                  `${item.title}: ${
                    {
                      planned: "geplant",
                      active: "in Arbeit",
                      paused: "offen/übergeben",
                      completed: "abgeschlossen",
                    }[item.status]
                  }`,
              ),
              ...workday.incomingTransfers
                .filter((item) => item.state === "pending")
                .map((item) => `Eingehende Verantwortung: ${item.reason}`),
            ].join(" · "),
          }
        : null,
    };
  };
  let durableResources = service.fhirResources();
  let persistenceQueue: Promise<void> = Promise.resolve();
  let assistantAuditQueue: Promise<void> = Promise.resolve();
  let eventRevision = 0;
  const voiceReceipts = new Map<string, DurableVoiceAuthority>();
  const revokeVoiceReceipts = (actorId: string) => {
    for (const [receiptId, receipt] of voiceReceipts)
      if (receipt.actorId === actorId) voiceReceipts.delete(receiptId);
  };
  const authorityHash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  const persistResponseAuthorities = async (
    response: AssistantResponse,
    session: {
      id: string;
      threadId: string;
      contextRevision: number;
      encounterId: string | null;
    },
  ) => {
    for (const component of response.components) {
      if (component.type !== "DraftAction") continue;
      const record = assistant.durableIntentRecord(component.intentToken);
      if (!record)
        throw new DomainError(
          "INVALID_STATE",
          "Die geprüfte Aktion konnte nicht dauerhaft gebunden werden.",
          503,
        );
      await operationalStore.storeIntentAuthority({
        tokenHash: authorityHash(component.intentToken),
        record,
        sessionId: session.id,
        threadId: session.threadId,
        contextRevision: session.contextRevision,
        responseId: response.id,
        reviewItems: component.reviewItems ?? [],
      });
    }
  };
  const consumeValidatedVoiceReceipt = async (
    actorId: string,
    body: AssistantQueryBody,
    session: {
      id: string;
      threadId: string;
      contextRevision: number;
      encounterId: string | null;
    },
  ): Promise<string | null> => {
    if (body.inputModality !== "voice") return null;
    const receiptId = body.voiceReceiptId ?? "";
    const tokenHash = authorityHash(receiptId);
    const receipt =
      voiceReceipts.get(receiptId) ??
      (await operationalStore.loadVoiceAuthority(tokenHash));
    const purpose = body.purpose ?? "direct-care";
    const textHash = createHash("sha256").update(body.prompt).digest("hex");
    const confirmed = [...(body.voiceConfirmedEntityIds ?? [])].sort();
    const expected = [...(receipt?.entityIds ?? [])].sort();
    if (
      !receipt ||
      receipt.expiresAt < Date.now() ||
      receipt.actorId !== actorId ||
      receipt.patientId !== body.patientId ||
      receipt.encounterId !== session.encounterId ||
      receipt.purpose !== purpose ||
      receipt.sessionId !== session.id ||
      receipt.threadId !== session.threadId ||
      receipt.contextRevision !== session.contextRevision ||
      receipt.textHash !== textHash ||
      JSON.stringify(confirmed) !== JSON.stringify(expected)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Sprachtranskript ist abgelaufen, verändert oder nicht an diesen Kontext gebunden.",
        403,
      );
    if (!(await operationalStore.consumeVoiceAuthority(tokenHash)))
      throw new DomainError(
        "AUTH_DENIED",
        "Sprachtranskript wurde bereits verwendet.",
        403,
      );
    voiceReceipts.delete(receiptId);
    return receiptId;
  };
  const eventSubscribers = new Set<(revision: number) => void>();
  const contextTransitions = new Map<string, Promise<unknown>>();
  const publishInvalidation = (durableRevision?: number) => {
    eventRevision = durableRevision
      ? Math.max(eventRevision + 1, durableRevision)
      : eventRevision + 1;
    for (const subscriber of eventSubscribers) subscriber(eventRevision);
  };
  const requestCommandKeys = new WeakMap<
    object,
    { key: string; requestHash: string }
  >();
  const committedCommandKeys = new Set(service.commandReceiptKeys());
  const persist = <T>(
    operation: () => T | Promise<T>,
    request?: FastifyRequest,
    statusCode = 200,
    publishChange = false,
  ): Promise<T> => {
    const pending = persistenceQueue.then(async () => {
      const command = request ? requestCommandKeys.get(request) : undefined;
      let committed =
        command && committedCommandKeys.has(command.key)
          ? service.commandReceipt(command.key)
          : null;
      if (command && !committed) {
        // A bounded hot-cache insertion can evict a previously committed
        // receipt. Treat the durable Binary as authoritative rather than
        // leaving the auxiliary committed-key index stale.
        committedCommandKeys.delete(command.key);
        const durableReceipt = await workspace.loadCommandReceipt(command.key);
        if (durableReceipt) {
          service.recordCommandReceipt(durableReceipt);
          committedCommandKeys.add(command.key);
          committed = durableReceipt;
        }
      }
      if (command && committed) {
        if (committed.requestHash !== command.requestHash)
          throw new DomainError(
            "INVALID_STATE",
            "Befehls-ID wurde bereits mit einem anderen Inhalt verwendet.",
            409,
          );
        return JSON.parse(committed.payload) as T;
      }
      const before = service.checkpoint();
      let writeAttempted = false;
      try {
        const result = await operation();
        const payload = JSON.stringify(result);
        let stagedReceipt: Parameters<ClinicalWorkspace["synchronize"]>[3];
        if (command && payload !== undefined)
          stagedReceipt = {
            ...command,
            statusCode,
            payload,
          };
        if (stagedReceipt) service.recordCommandReceipt(stagedReceipt);
        const nextCheckpoint = service.checkpoint();
        const nextResources = service.fhirResources();
        const stateChanged =
          JSON.stringify(nextCheckpoint) !== JSON.stringify(before);
        if (!stateChanged && !stagedReceipt) return result;
        const previousByReference = new Map(
          durableResources.map((resource) => [
            `${resource.resourceType}/${resource.id}`,
            JSON.stringify(resource),
          ]),
        );
        const nextReferences = new Set(
          nextResources.map(
            (resource) => `${resource.resourceType}/${resource.id}`,
          ),
        );
        const changedResources = nextResources.filter((resource) => {
          const reference = `${resource.resourceType}/${resource.id}`;
          // AuditEvent and Provenance are append-only evidence. A reset can
          // legitimately change the current data-classification projection
          // (for example after repairing a legacy demo checkpoint), but it
          // must never rewrite evidence that Medplum already accepted.
          if (
            (resource.resourceType === "AuditEvent" ||
              resource.resourceType === "Provenance") &&
            previousByReference.has(reference)
          )
            return false;
          return (
            previousByReference.get(reference) !== JSON.stringify(resource)
          );
        });
        const removedReferences = [...previousByReference.keys()].filter(
          (reference) =>
            !reference.startsWith("Provenance/") &&
            !nextReferences.has(reference),
        );
        writeAttempted = true;
        await workspace.synchronize(
          changedResources,
          nextCheckpoint,
          removedReferences,
          stagedReceipt,
        );
        committedCommandKeys.clear();
        for (const key of service.commandReceiptKeys())
          committedCommandKeys.add(key);
        durableResources = nextResources;
        if (request?.method === "POST") {
          const revision = await operationalStore.appendUiInvalidation(
            userId(request),
            { requestId: request.id },
          );
          publishInvalidation(revision);
        } else if (publishChange && stateChanged) publishInvalidation();
        return result;
      } catch (error) {
        const rejectedEntries = service.audit
          .snapshot()
          .slice(before.audit.length)
          .filter(
            (entry) =>
              entry.outcome === "denied" || entry.outcome === "failure",
          );
        service.restoreCheckpoint(before);
        if (writeAttempted) {
          try {
            const latest = await workspace.loadCheckpoint();
            if (latest) {
              service.restoreCheckpoint(latest);
              durableResources = service.fhirResources();
              committedCommandKeys.clear();
              for (const key of service.commandReceiptKeys())
                committedCommandKeys.add(key);
            }
          } catch {
            // Keep the last locally verified checkpoint while the workspace is
            // unavailable. Readiness exposes the outage and the write failed.
          }
        }
        if (command) {
          const recovered =
            service.commandReceipt(command.key) ??
            (await workspace.loadCommandReceipt(command.key));
          if (recovered && recovered.requestHash === command.requestHash) {
            service.recordCommandReceipt(recovered);
            committedCommandKeys.add(command.key);
            if (request?.method === "POST") publishInvalidation();
            return JSON.parse(recovered.payload) as T;
          }
        }
        for (const entry of rejectedEntries) {
          service.audit.append({
            actor: service.user(entry.actorId),
            action: entry.action,
            patientId: entry.patientId,
            purpose: entry.purpose,
            outcome: entry.outcome,
            detail: entry.detail,
            occurredAt: entry.occurredAt,
          });
        }
        if (writeAttempted && request) {
          const actorId = userId(request);
          service.audit.append({
            actor: service.user(actorId),
            action: "persistence:command-rejected",
            patientId: null,
            purpose: "operations",
            outcome: "failure",
            detail: { reason: "atomic-workspace-write-failed" },
          });
        }
        if (rejectedEntries.length && !writeAttempted) {
          try {
            await workspace.synchronize([], service.checkpoint());
          } catch {
            // The in-process audit remains chained and is retried with the next
            // successful checkpoint. The original clinical error wins.
          }
        }
        throw error;
      }
    });
    persistenceQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const userId = (request: FastifyRequest): string => {
    if (!demoMode)
      throw new DomainError(
        "AUTH_DENIED",
        "Produktionsidentität ist nicht konfiguriert; Demo-Header sind deaktiviert.",
        503,
      );
    const value = request.headers["x-demo-user"];
    if (typeof value !== "string" || value.length > 80) return "u-assistant";
    return value;
  };
  const requireMigratedClinicalMutation = (): void => {
    if (runtime.profile === "integrated-demo")
      throw new DomainError(
        "INVALID_STATE",
        "Diese Detailaktion ist im integrierten Profil nur über die geprüfte Assistenzfreigabe verfügbar.",
        409,
      );
  };
  const persistReadAudit = <T>(operation: () => T): Promise<T> => {
    const pending = persistenceQueue.then(async () => {
      const beforeAuditLength = service.audit.length;
      try {
        const result = operation();
        const entries = service.audit.snapshot().slice(beforeAuditLength);
        for (const entry of entries) await operationalStore.appendAudit(entry);
        // Operational PostgreSQL is authoritative for access events. Track the
        // equivalent FHIR projection as already accounted for so the next
        // clinical mutation does not batch historical read events back into a
        // Medplum transaction.
        durableResources = [
          ...durableResources,
          ...service.fhirAuditResourcesSince(beforeAuditLength),
        ];
        return result;
      } catch (error) {
        service.audit.truncate(beforeAuditLength);
        throw error;
      }
    });
    persistenceQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const runAssistantQuery = async <T>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    // Model/ASR latency must never occupy the global clinical-write queue.
    // The generated query audit is copied to the operational audit chain on a
    // separate queue; the unique hash index makes overlapping concurrent
    // slices idempotent.
    const beforeAuditLength = service.audit.length;
    const result = await operation();
    const entries = service.audit.slice(beforeAuditLength);
    const pending = assistantAuditQueue.then(async () => {
      for (const entry of entries) await operationalStore.appendAudit(entry);
      const resourcesByReference = new Map(
        durableResources.map((resource) => [
          `${resource.resourceType}/${resource.id}`,
          resource,
        ]),
      );
      for (const resource of service.fhirAuditResourcesSince(beforeAuditLength))
        resourcesByReference.set(
          `${resource.resourceType}/${resource.id}`,
          resource,
        );
      durableResources = [...resourcesByReference.values()];
    });
    assistantAuditQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    await pending;
    return result;
  };
  const runSerializedMutation = <T>(
    operation: () => Promise<T>,
  ): Promise<T> => {
    const pending = persistenceQueue.then(operation);
    persistenceQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  const app = Fastify({
    logger: {
      level:
        options.loggerLevel ??
        (process.env.NODE_ENV === "test"
          ? "silent"
          : (process.env.LOG_LEVEL ?? "info")),
      ...(options.loggerStream ? { stream: options.loggerStream } : {}),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.x-demo-user",
          "req.headers.x-pfh-patient-context",
          "req.headers.x-pfh-purpose",
          "body.patientId",
          "body.recipientId",
          "body.patientMrn",
          "body.patientBirthDate",
          "body.structuredText",
          "body.transcript",
          "body.request",
          "body.reason",
          "body.response",
          "body.prompt",
        ],
        censor: "[REDACTED]",
      },
      serializers: {
        req: (request: FastifyRequest) => ({
          id: request.id,
          method: request.method,
          route: request.routeOptions?.url ?? "unresolved",
        }),
      },
    },
    bodyLimit: 64 * 1024,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
  });
  void app.register(fastifyMultipart, {
    limits: { files: 1, fields: 0, fileSize: 8 * 1024 * 1024 },
  });
  {
    const configuredInterval = Number(
      process.env.PFH_ESCALATION_INTERVAL_MS ?? "5000",
    );
    const intervalMs = Number.isFinite(configuredInterval)
      ? Math.max(1000, configuredInterval)
      : 5000;
    const escalationTimer = demoMode
      ? setInterval(() => {
          void persist(
            () => {
              const now = new Date().toISOString();
              service.runScheduledEscalations(now);
            },
            undefined,
            200,
            true,
          ).catch((error: unknown) => {
            app.log.error(
              {
                errorType:
                  error instanceof Error
                    ? error.constructor.name
                    : "UnknownError",
              },
              "deterministic deadline sweep failed",
            );
          });
        }, intervalMs)
      : null;
    escalationTimer?.unref();
    let providerWorkerRunning = false;
    const providerWorkerInterval = Math.max(
      1000,
      Number(process.env.PFH_PROVIDER_WORKER_INTERVAL_MS ?? "2000"),
    );
    const relationalProviderWorker =
      runtime.profile !== "memory-demo"
        ? new ProviderDeliveryWorker(
            operationalStore as OperationalStore & ProviderDeliveryStore,
            service.providerRegistry,
            {
              workerId: `api-provider-${process.pid}`,
              profile: service.providerProfile,
              authorizeDelivery: (job) => {
                const envelope = job.authorityEnvelope;
                if (
                  !job.acceptedCommandId ||
                  !envelope ||
                  envelope.acceptedCommandId !== job.acceptedCommandId ||
                  envelope.organizationId !== siteConfiguration.institutionId ||
                  envelope.siteId !== siteConfiguration.siteId ||
                  envelope.departmentId !== siteConfiguration.department.id ||
                  envelope.patientId !==
                    job.payload.command.patientReference.slice(
                      "Patient/".length,
                    ) ||
                  envelope.encounterId !==
                    job.payload.command.encounterReference.slice(
                      "Encounter/".length,
                    )
                )
                  return {
                    allowed: false,
                    reason: "acceptance-envelope-invalid",
                  };
                try {
                  const currentActor = service.user(String(envelope.actorId));
                  if (currentActor.role !== envelope.actorRole)
                    return { allowed: false, reason: "actor-role-revoked" };
                  if (envelope.policyVersion !== runtimeSitePack.packDigest)
                    return { allowed: false, reason: "policy-version-revoked" };
                  const patient = service
                    .snapshot(
                      currentActor.id,
                      String(envelope.purpose) as Purpose,
                    )
                    .patients.find(
                      (candidate) => candidate.id === envelope.patientId,
                    );
                  if (!patient)
                    return {
                      allowed: false,
                      reason: "care-relationship-revoked",
                    };
                  const actionByOperation: Record<string, Action> = {
                    "Observation.write": "observation:approve",
                    "NursingNote.write": "note:approve",
                    "Task.write": "task:update",
                    "Communication.write": "communication:create",
                  };
                  const action = actionByOperation[job.operation];
                  if (
                    !action ||
                    !decide(
                      currentActor,
                      action,
                      String(envelope.purpose) as Purpose,
                      patient,
                    ).allow
                  )
                    return { allowed: false, reason: "permission-revoked" };
                } catch {
                  return { allowed: false, reason: "actor-revoked" };
                }
                return { allowed: true };
              },
            },
          )
        : null;
    const clinicalProjectionWorker =
      runtime.profile !== "memory-demo"
        ? new ClinicalProjectionWorker(operationalStore, workspace, {
            workerId: `api-medplum-${process.pid}`,
          })
        : null;
    const providerWorkerTimer = setInterval(() => {
      if (providerWorkerRunning) return;
      providerWorkerRunning = true;
      const work = relationalProviderWorker
        ? Promise.all([
            clinicalProjectionWorker!.runOnce(),
            relationalProviderWorker.runOnce(),
          ])
        : service.hasPendingProviderWork()
          ? persist(() => service.flushOutbox("u-it"), undefined, 200, true)
          : Promise.resolve();
      void work
        .catch((error: unknown) => {
          app.log.error(
            {
              errorType:
                error instanceof Error
                  ? error.constructor.name
                  : "UnknownError",
            },
            "delivery worker sweep failed",
          );
        })
        .finally(() => {
          providerWorkerRunning = false;
        });
    }, providerWorkerInterval);
    providerWorkerTimer.unref();
    app.addHook("onClose", (_instance, done) => {
      if (escalationTimer) clearInterval(escalationTimer);
      clearInterval(providerWorkerTimer);
      done();
    });
  }
  void app.register(providerIntegrationRoutes, {
    registry: service.providerRegistry,
    authorize: async (request, action) => {
      await persistenceQueue;
      const actor = service.user(userId(request));
      const allowed = ["registered-nurse", "physician", "it", "quality-safety"];
      if (!allowed.includes(actor.role))
        throw new DomainError(
          "AUTH_DENIED",
          `Provider-Integrationsaktion ${action} ist für diese Rolle nicht freigegeben.`,
          403,
        );
    },
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    void reply
      .header("X-Content-Type-Options", "nosniff")
      .header("X-Frame-Options", "DENY")
      .header("Referrer-Policy", "no-referrer")
      .header(
        "Permissions-Policy",
        "camera=(), geolocation=(), payment=(), usb=(), microphone=(self)",
      )
      .header(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      )
      .header("Cache-Control", "no-store");
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (isDomainError(error)) {
      request.log.warn(
        { code: error.code, statusCode: error.statusCode },
        "domain request rejected",
      );
      void reply.code(error.statusCode).send({
        error: error.code,
        message: error.message,
        requestId: request.id,
      });
      return;
    }
    if (error instanceof z.ZodError) {
      request.log.warn(
        { issueCount: error.issues.length },
        "schema request rejected",
      );
      void reply.code(400).send({
        error: "VALIDATION",
        message: "Ungültige Eingabe.",
        requestId: request.id,
        fields: error.issues.map((issue) => issue.path.join(".")),
      });
      return;
    }
    request.log.error(
      {
        errorType: error instanceof Error ? error.name : typeof error,
        ...(demoMode && error instanceof Error
          ? { syntheticDemoError: error.message.slice(0, 240) }
          : {}),
        requestId: request.id,
      },
      "unhandled request error",
    );
    void reply.code(500).send({
      error: "INTERNAL",
      message: "Interner Fehler.",
      requestId: request.id,
    });
  });

  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method !== "POST" || !route?.startsWith("/api/v1/")) return;
    if (
      route === "/api/v1/assistant/transcribe" ||
      route === "/api/v1/assistant/query"
    )
      return;
    const commandId = request.headers["x-command-id"];
    if (typeof commandId !== "string" || !z.uuid().safeParse(commandId).success)
      throw new DomainError(
        "VALIDATION",
        "Mutierende Aufrufe benötigen eine eindeutige Befehls-ID.",
        400,
      );
    const actorId = userId(request);
    service.user(actorId);
    const key = `${actorId}:${request.method}:${route}:${commandId}`;
    const requestHash = createHash("sha256")
      .update(JSON.stringify(request.body ?? null))
      .digest("hex");
    const cached = committedCommandKeys.has(key)
      ? service.commandReceipt(key)
      : null;
    if (cached && cached.requestHash !== requestHash)
      throw new DomainError(
        "INVALID_STATE",
        "Befehls-ID wurde bereits mit einem anderen Inhalt verwendet.",
        409,
      );
    if (cached)
      return reply
        .code(cached.statusCode)
        .type("application/json; charset=utf-8")
        .send(cached.payload);
    const accepted = await operationalStore.loadAcceptedCommandReceipt(
      key,
      requestHash,
    );
    if (accepted) return reply.code(accepted.statusCode).send(accepted.payload);
    requestCommandKeys.set(request, { key, requestHash });
  });

  app.get("/health", () => ({
    status: "ok",
    service: "pflegehelfer-api",
    time: new Date().toISOString(),
  }));
  app.get("/ready", async (_request, reply) => {
    await Promise.all([persistenceQueue, assistantAuditQueue]);
    const auditValid = service.audit.verify();
    const [workspaceStatus, operationalReady, providers] = await Promise.all([
      workspace.status(),
      operationalStore.health(),
      service.providerRegistry.status(service.providerProfile),
    ]);
    const actualProfileMatches =
      workspace.mode === runtime.storageMode &&
      operationalStore.mode === runtime.persistenceMode;
    if (!actualProfileMatches)
      return reply.code(503).send({
        status: "not-ready",
        reason: "runtime-profile-mismatch",
        profile: runtime.profile,
      });
    if (!demoMode)
      return reply.code(503).send({
        status: "not-ready",
        reason: "production-identity-adapter-not-configured",
        auditValid,
      });
    if (!workspaceStatus.ready)
      return reply.code(503).send({
        status: "not-ready",
        reason: "clinical-workspace-unavailable",
        auditValid,
      });
    if (!operationalReady)
      return reply.code(503).send({
        status: "not-ready",
        reason: "operational-store-unavailable",
        auditValid,
      });
    if (
      runtime.profile === "integrated-demo" &&
      (providers.length === 0 ||
        providers.some(
          (provider) =>
            provider.operationalStatus !== "SIMULATED" ||
            provider.health?.status !== "available",
        ))
    )
      return reply.code(503).send({
        status: "not-ready",
        reason: "provider-simulator-unavailable",
        auditValid,
      });
    if (!auditValid)
      return reply.code(503).send({
        status: "not-ready",
        reason: "audit-chain-invalid",
        auditValid,
      });
    return {
      status: "ready",
      profile: runtime.profile,
      durability:
        runtime.profile === "memory-demo" ? "memory-only" : "persistent",
      auditValid,
    };
  });

  app.get("/api/v1/diagnostics", async (request) => {
    await Promise.all([persistenceQueue, assistantAuditQueue]);
    const actor = service.user(userId(request));
    if (!["it", "quality-safety"].includes(actor.role))
      throw new DomainError(
        "AUTH_DENIED",
        "Komponentendiagnostik ist nur für IT oder Qualität freigegeben.",
        403,
      );
    const [medplum, postgresqlReady, providers, llm, delivery] =
      await Promise.all([
        workspace.status(),
        operationalStore.health(),
        service.providerRegistry.status(service.providerProfile),
        models.status(),
        operationalStore.deliveryDiagnostics(),
      ]);
    return {
      profile: runtime.profile,
      profileMatchesRuntime:
        workspace.mode === runtime.storageMode &&
        operationalStore.mode === runtime.persistenceMode,
      components: {
        postgresql: {
          mode: operationalStore.mode,
          ready: postgresqlReady,
        },
        medplum,
        providerWorker: {
          mode:
            runtime.profile === "integrated-demo"
              ? "relational-leased"
              : "memory-demo-checkpoint",
          ready:
            runtime.profile === "integrated-demo"
              ? postgresqlReady && medplum.ready
              : runtime.profile === "memory-demo",
          message:
            runtime.profile === "integrated-demo"
              ? "Atomare lokale Annahme mit getrennten Medplum- und Provider-Leases."
              : "Expliziter Memory-Demo-Pfad; keine persistente Zustellung.",
          queues: delivery,
        },
        providers: providers.map((provider) => ({
          provider: provider.provider,
          profile: provider.profile,
          status: provider.operationalStatus,
          health: provider.health?.status ?? null,
        })),
        model: llm,
        asr: asr.status(),
        tts: tts.status(),
      },
    };
  });

  app.get("/api/v1/snapshot", async (request) => {
    await persistenceQueue;
    const query = z
      .object({ purpose: purposeSchema.optional() })
      .parse(request.query);
    const actorId = userId(request);
    // Access events are part of the clinical audit trail. Commit the small
    // read-audit delta before returning so idle clients cannot accumulate an
    // unbounded in-memory batch that later breaks an unrelated clinical write.
    const snapshot = await persistReadAudit(() =>
      service.snapshot(actorId, query.purpose),
    );
    const workspaceStatus = await workspace.status();
    const deliveryDiagnostics = await operationalStore.deliveryDiagnostics();
    const syncSummary =
      runtime.profile === "integrated-demo"
        ? await operationalStore.providerDeliverySummary(
            snapshot.patients.map((patient) => patient.id),
          )
        : snapshot.syncSummary;
    const canUseDetailedWorkspace = [
      "registered-nurse",
      "physician",
      "it",
      "quality-safety",
    ].includes(snapshot.currentUser.role);
    return {
      ...snapshot,
      // The integrated profile's relational outbox is authoritative. The
      // checkpoint outbox remains an internal command-construction detail and
      // must never leak stale delivery state back into the live read model.
      syncSummary,
      deliveryDiagnostics,
      workspace: workspaceStatus,
      workspaceLinks:
        canUseDetailedWorkspace &&
        workspaceStatus.ready &&
        workspace.detailUrl()
          ? {
              home: workspace.detailUrl()!,
              patients: Object.fromEntries(
                snapshot.patients.map((patient) => [
                  patient.id,
                  workspace.detailUrl(
                    `Patient/${fhirResourceId("Patient", patient.id)}`,
                  )!,
                ]),
              ),
            }
          : null,
    };
  });

  app.get("/api/v1/events", async (request, reply) => {
    await persistenceQueue;
    const actorId = userId(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    let cursor = Number(request.headers["last-event-id"] ?? 0);
    if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
    reply.raw.write(`event: connected\ndata: {"cursor":${cursor}}\n\n`);
    let flushing = false;
    const flush = async () => {
      if (flushing || reply.raw.destroyed) return;
      flushing = true;
      try {
        const events = await operationalStore.listUiEventsAfter(
          actorId,
          cursor,
        );
        for (const event of events) {
          if (reply.raw.destroyed) break;
          cursor = event.id;
          reply.raw.write(
            `id: ${event.id}\nevent: ${event.eventType}\ndata: ${JSON.stringify({ revision: event.id })}\n\n`,
          );
        }
      } finally {
        flushing = false;
      }
    };
    const send = () => void flush();
    await flush();
    eventSubscribers.add(send);
    const replayPoll = setInterval(() => void flush(), 3000);
    replayPoll.unref();
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
    }, 20_000);
    heartbeat.unref();
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      clearInterval(replayPoll);
      eventSubscribers.delete(send);
    });
  });

  app.get("/api/v1/fhir/status", async (request) => {
    await persistenceQueue;
    const actor = service.user(userId(request));
    if (
      !["registered-nurse", "physician", "it", "quality-safety"].includes(
        actor.role,
      )
    )
      throw new DomainError(
        "AUTH_DENIED",
        "FHIR-Betriebsstatus ist für diese Rolle nicht freigegeben.",
        403,
      );
    return workspace.status();
  });

  app.get("/api/v1/ai/status", async (request) => {
    await persistenceQueue;
    const actor = service.user(userId(request));
    return {
      actorRole: actor.role,
      llm: await models.status(),
      deepLlmAndKnowledge: knowledge.status(),
      asr: asr.status(),
      tts: tts.status(),
      clinicalCoreRequiresAi: false,
    };
  });

  app.post("/api/v1/ai/model-test", async (request) => {
    await persistenceQueue;
    const actor = service.user(userId(request));
    if (!["it", "quality-safety"].includes(actor.role))
      throw new DomainError(
        "AUTH_DENIED",
        "Der Modell-Funktionstest ist nur für IT oder Qualität freigegeben.",
        403,
      );
    return models.testSynthetic();
  });

  app.post("/api/v1/ai/tts-test", async (request) => {
    await persistenceQueue;
    const actor = service.user(userId(request));
    if (!["it", "quality-safety"].includes(actor.role))
      throw new DomainError(
        "AUTH_DENIED",
        "Der Sprach-Funktionstest ist nur für IT oder Qualität freigegeben.",
        403,
      );
    const startedAt = Date.now();
    const result = await tts.synthesize(
      "Synthetischer Pflegehelfer-Test. Keine Patientendaten.",
      "synthetic-demo",
    );
    return {
      ready: true,
      model: result.model,
      voice: result.voice,
      latencyMs: Date.now() - startedAt,
      audioBytes: result.audio.byteLength,
      audioRetained: result.audioRetained,
      status: tts.status(),
    };
  });

  app.post("/api/v1/assistant/speech", async (request, reply) => {
    await persistenceQueue;
    service.user(userId(request));
    const body = z
      .object({ text: z.string().trim().min(1).max(2400) })
      .strict()
      .parse(request.body);
    const result = await tts.synthesize(body.text, effectiveDataClass());
    return reply
      .header("content-type", result.contentType)
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .send(Buffer.from(result.audio));
  });

  app.post("/api/v1/assistant/pending-review", async (request) => {
    await persistenceQueue;
    const actorId = userId(request);
    const actor = service.user(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    if (!session.patientId || !session.encounterId) return { pending: null };
    const patient = service
      .snapshot(actorId, actor.defaultPurpose)
      .patients.find(
        (candidate) =>
          candidate.id === session.patientId &&
          candidate.encounterId === session.encounterId,
      );
    if (!patient) return { pending: null };
    const pending = await operationalStore.loadPendingIntentReview(
      actorId,
      patient.id,
      patient.encounterId,
      session.threadId,
    );
    if (!pending) return { pending: null };
    const intentToken = assistant.reissueDurableIntent(actorId, pending.record);
    const freshRecord = assistant.durableIntentRecord(intentToken)!;
    const reviewItems = z
      .array(
        z
          .object({
            id: z.string().regex(/^action-(?:[1-9]|1[0-2])$/),
            label: z.string().trim().min(1).max(1400),
            kind: z.enum([
              "note",
              "observation",
              "communication",
              "task",
              "workflow",
            ]),
          })
          .strict(),
      )
      .max(12)
      .parse(pending.reviewItems);
    let component: AssistantComponent;
    if (freshRecord.command === "care-update:draft") {
      const plan = assistantProposalSchema.parse(
        JSON.parse(freshRecord.payload.plan ?? "null"),
      );
      component = {
        type: "DraftAction",
        kind: "care-update",
        title: `Offene Prüfung · ${patient.displayName}`,
        preview: reviewItems
          .map((item) => item.label)
          .join("\n")
          .slice(0, 1200),
        actionLabel: "Auswahl bestätigen",
        intentToken,
        sourceLabel: `${plan.sourceRecords?.length ?? 0} gebundene Eingabe${(plan.sourceRecords?.length ?? 0) === 1 ? "" : "n"} · nach Aktualisierung erneut autorisiert`,
        reviewItems,
      };
    } else {
      const kind =
        freshRecord.command === "note:draft"
          ? "nursing-note"
          : freshRecord.command === "communication:draft"
            ? "physician-question"
            : "task";
      component = {
        type: "DraftAction",
        kind,
        title: `Offene Prüfung · ${patient.displayName}`,
        preview: (
          freshRecord.payload.structuredText ??
          freshRecord.payload.request ??
          freshRecord.payload.title ??
          "Offener Entwurf"
        ).slice(0, 1200),
        actionLabel: "Erneut prüfen und übernehmen",
        intentToken,
        sourceLabel:
          "Gespeicherter Entwurf · nach Aktualisierung erneut autorisiert",
        ...(reviewItems.length > 0 ? { reviewItems } : {}),
      };
    }
    await operationalStore.storeIntentAuthority({
      tokenHash: authorityHash(intentToken),
      record: freshRecord,
      sessionId: session.id,
      threadId: session.threadId,
      contextRevision: session.contextRevision,
      responseId: pending.responseId,
      reviewItems,
    });
    const sourceTurn = (
      await operationalStore.loadConversation(actorId, actor.role, patient.id)
    ).find((turn) => turn.id === pending.responseId);
    const archived = sourceTurn?.response as AssistantResponse | undefined;
    if (!archived) return { pending: null };
    const components = [
      ...archived.components.filter(
        (item) =>
          item.type !== "DraftAction" &&
          !(
            item.type === "SafetyAlert" &&
            item.message.startsWith("Diese frühere offene Änderung")
          ),
      ),
      component,
    ];
    return {
      pending: {
        responseId: pending.responseId,
        response: {
          ...archived,
          components,
          openUi: toOpenUi(components),
        },
      },
    };
  });

  app.get("/api/v1/assistant/conversation", async (request) => {
    await persistenceQueue;
    const actorId = userId(request);
    const actor = service.user(actorId);
    let session = await operationalStore.getOrStartSession(actorId, actor.role);
    const authorizedPatients = new Map(
      service
        .snapshot(actorId, actor.defaultPurpose)
        .patients.map((patient) => [patient.id, patient.encounterId]),
    );
    if (
      session.patientId &&
      authorizedPatients.get(session.patientId) !== session.encounterId
    ) {
      assistant.revokeActorIntents(actorId);
      revokeVoiceReceipts(actorId);
      await operationalStore.revokeActorAuthorities(actorId);
      session = await operationalStore.changePatientContext(
        actorId,
        actor.role,
        null,
        null,
      );
    }
    const conversations = (
      await operationalStore.listConversations(actorId, actor.role)
    ).filter(
      (conversation) =>
        conversation.patientId === null ||
        authorizedPatients.get(conversation.patientId) ===
          conversation.encounterId,
    );
    return {
      turns: await operationalStore.loadConversation(actorId, actor.role),
      conversations,
      expiresAt: new Date(
        Date.now() + siteConfiguration.sessionTtlHours * 60 * 60_000,
      ).toISOString(),
      session,
    };
  });

  app.get("/api/v1/working-session", async (request) => {
    await persistenceQueue;
    const actorId = userId(request);
    const actor = service.user(actorId);
    return operationalStore.getOrStartSession(actorId, actor.role);
  });

  const boundClinicalWorkday = async (actorId: string) => {
    const actor = service.user(actorId);
    const presentRecipientLabels = (value: string) =>
      value.replace(
        /Rückfrage an (u-[^:]+):/g,
        (_match, recipientId: string) => {
          try {
            return `Rückfrage an ${service.user(recipientId).displayName}:`;
          } catch {
            return "Rückfrage an zuständige Person:";
          }
        },
      );
    const presentWorkday = (
      value: Awaited<ReturnType<OperationalStore["getWorkday"]>>,
    ) => ({
      ...value,
      handover: {
        ...value.handover,
        items: value.handover.items.map((item) => ({
          ...item,
          openQuestions: item.openQuestions.map(presentRecipientLabels),
        })),
      },
    });
    let workday = await operationalStore.getWorkday(actorId, actor.role);
    if (workday.handover.clinicalBound) return presentWorkday(workday);
    const snapshot = service.snapshot(actorId, actor.defaultPurpose);
    const patientById = new Map(
      snapshot.patients.map((patient) => [patient.id, patient]),
    );
    const clinicalTime = (value: string) =>
      new Intl.DateTimeFormat("de-CH", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: siteConfiguration.timeZone,
      }).format(new Date(value));
    const items = workday.handover.patientIds.map((patientId) => {
      const patient = patientById.get(patientId);
      if (!patient)
        throw new DomainError(
          "AUTH_DENIED",
          "Der zugewiesene Patientenkontext ist für diese Rolle nicht freigegeben.",
          403,
        );
      const latestObservation = snapshot.observations
        .filter(
          (item) =>
            item.patientId === patientId &&
            item.encounterId === patient.encounterId,
        )
        .sort((left, right) =>
          right.effectiveAt.localeCompare(left.effectiveAt),
        )[0];
      const latestNote = snapshot.notes
        .filter(
          (item) =>
            item.patientId === patientId &&
            item.encounterId === patient.encounterId,
        )
        .sort((left, right) =>
          (right.approvedAt ?? right.source.effectiveAt).localeCompare(
            left.approvedAt ?? left.source.effectiveAt,
          ),
        )[0];
      const observationText = latestObservation
        ? `${latestObservation.label}: ${latestObservation.value}${
            latestObservation.secondaryValue === null
              ? ""
              : `/${latestObservation.secondaryValue}`
          } ${latestObservation.unit} (${clinicalTime(latestObservation.effectiveAt)})`
        : null;
      const currentImportant = [
        ...patient.risks.map((risk) => `Risiko: ${risk}`),
        patient.allergyStatus === "confirmed"
          ? `Allergien: ${patient.allergies.join(", ")}`
          : patient.allergyStatus === "explicit-negative"
            ? "Allergien: keine bekannten"
            : "Allergiestatus: ungeklärt",
      ];
      const openTasks = snapshot.tasks
        .filter(
          (task) =>
            task.patientId === patientId &&
            task.encounterId === patient.encounterId &&
            task.state !== "completed",
        )
        .map(
          (task) =>
            `Aufgabe: ${task.title} (${
              {
                new: "neu",
                accepted: "angenommen",
                "in-progress": "in Arbeit",
                waiting: "wartet",
                escalated: "eskaliert",
                completed: "erledigt",
              }[task.state]
            })`,
        );
      const openCommunications = snapshot.communications
        .filter(
          (item) =>
            item.patientId === patientId &&
            item.encounterId === patient.encounterId &&
            item.state !== "closed",
        )
        .map((item) => {
          const recipient = item.recipientId
            ? service.user(item.recipientId).displayName
            : {
                "care-assistant": "Pflegeassistenz-Dienst",
                "registered-nurse": "Pflegefachdienst",
                physician: "Ärztlicher Dienst",
                pharmacy: "Apotheke",
                physiotherapy: "Physiotherapie",
                "occupational-therapy": "Ergotherapie",
                transport: "Transportdienst",
                service: "Service",
                administration: "Administration",
                management: "Management",
                hr: "Personal",
                it: "IT",
                "quality-safety": "Qualität & Sicherheit",
              }[item.recipientRole];
          return `Rückfrage an ${recipient}: ${item.request} (${
            {
              sent: "gesendet",
              acknowledged: "bestätigt",
              answered: "beantwortet",
              closed: "geschlossen",
              escalated: "eskaliert",
            }[item.state]
          })`;
        });
      return {
        patientId,
        encounterId: patient.encounterId,
        currentImportant,
        recentChanges: [
          ...(observationText ? [observationText] : []),
          ...(latestNote
            ? [
                `Dokumentation (${clinicalTime(latestNote.approvedAt ?? latestNote.source.effectiveAt)}): ${latestNote.structuredText}`,
              ]
            : []),
        ],
        openQuestions: [...openTasks, ...openCommunications],
      };
    });
    workday = await operationalStore.bindHandoverClinicalSnapshot(
      actorId,
      actor.role,
      workday.handover.id,
      workday.handover.version,
      items,
    );
    return presentWorkday(workday);
  };

  app.get("/api/v1/workday", async (request) => {
    await persistenceQueue;
    const actorId = userId(request);
    const actor = service.user(actorId);
    if (!["care-assistant", "registered-nurse"].includes(actor.role))
      throw new DomainError(
        "AUTH_DENIED",
        "Der klinische Arbeitstag ist nur für zugewiesene Pflegerollen verfügbar.",
        403,
      );
    const workday = await boundClinicalWorkday(actorId);
    const providerState =
      runtime.profile === "integrated-demo"
        ? await operationalStore.providerDeliveryState(
            workday.handover.patientIds,
          )
        : service.providerSyncState(workday.handover.patientIds);
    return {
      ...workday,
      providerState,
    };
  });

  app.post("/api/v1/workday", async (request) => {
    await persistenceQueue;
    const actorId = userId(request);
    const actor = service.user(actorId);
    const command = z
      .discriminatedUnion("type", [
        z
          .object({
            type: z.literal("acknowledge-handover"),
            handoverId: z.string().uuid(),
            patientId: z.string(),
            version: z.number().int().positive(),
          })
          .strict(),
        z
          .object({
            type: z.literal("start-episode"),
            patientId: z.string(),
            encounterId: z.string(),
            kind: z.enum(["planned", "spontaneous", "alarm"]),
            title: z.string().trim().min(3).max(160),
          })
          .strict(),
        z
          .object({
            type: z.literal("pause-episode"),
            episodeId: z.string().uuid(),
            reason: z.enum(["pause", "interruption"]),
            draftText: z.string().max(1200).optional(),
          })
          .strict(),
        z
          .object({
            type: z.literal("interrupt-and-start"),
            episodeId: z.string().uuid(),
            patientId: z.string(),
            encounterId: z.string(),
            title: z.string().trim().min(3).max(160),
            pausedDraftText: z.string().max(1200).optional(),
          })
          .strict(),
        z
          .object({
            type: z.literal("resume-episode"),
            episodeId: z.string().uuid(),
          })
          .strict(),
        z
          .object({
            type: z.literal("save-episode-draft"),
            episodeId: z.string().uuid(),
            draftText: z.string().max(1200),
          })
          .strict(),
        z
          .object({
            type: z.literal("defer-responsibility"),
            patientId: z.string(),
            encounterId: z.string(),
            reason: z.string().trim().min(3).max(500),
            receivingActorId: z.string().trim().min(3).max(80),
          })
          .strict(),
        z
          .object({
            type: z.literal("acknowledge-transfer"),
            transferId: z.string().uuid(),
          })
          .strict(),
        z
          .object({
            type: z.literal("complete-episode"),
            episodeId: z.string().uuid(),
            evidence: z.string().trim().min(10).max(1200),
          })
          .strict(),
        z.object({ type: z.literal("close-shift") }).strict(),
      ])
      .parse(request.body) as WorkdayCommand;
    if (command.type === "acknowledge-handover")
      await boundClinicalWorkday(actorId);
    if ("patientId" in command) {
      const allowedPatient = service
        .snapshot(actorId, actor.defaultPurpose)
        .patients.find((patient) => patient.id === command.patientId);
      if (!allowedPatient)
        throw new DomainError(
          "AUTH_DENIED",
          "Arbeitstag-Aktion liegt ausserhalb des freigegebenen Patientenkontexts.",
          403,
        );
      if (
        "encounterId" in command &&
        command.encounterId !== allowedPatient.encounterId
      )
        throw new DomainError(
          "VALIDATION",
          "Der Fallbezug stimmt nicht mit dem freigegebenen Patientenkontext überein.",
          422,
        );
    }
    if (
      command.type === "defer-responsibility" &&
      (() => {
        const assignment = siteConfiguration.staffAssignments.find(
          (item) => item.actorId === actorId && item.role === actor.role,
        );
        const expectedRecipient = assignment
          ? siteConfiguration.shifts[assignment.shiftId]?.nextResponsibleActorId
          : null;
        return command.receivingActorId !== expectedRecipient;
      })()
    )
      throw new DomainError(
        "VALIDATION",
        "Die übernehmende Verantwortung stimmt nicht mit dem freigegebenen nächsten Dienst überein.",
        422,
      );
    if (command.type === "complete-episode") {
      const workday = await operationalStore.getWorkday(actorId, actor.role);
      const episode = workday.episodes.find(
        (candidate) => candidate.id === command.episodeId,
      );
      if (!episode)
        throw new DomainError(
          "INVALID_STATE",
          "Die Arbeitsepisode ist nicht mehr verfügbar.",
          409,
        );
      if (episode.state !== "active")
        throw new DomainError(
          "INVALID_STATE",
          "Nur eine aktive Arbeitsepisode kann abgeschlossen werden.",
          409,
        );
      if (requiresDedicatedClinicalWorkflow(command.evidence))
        throw new DomainError(
          "VALIDATION",
          "Medikations-, Behandlungs- oder Diagnostikangaben müssen im dafür vorgesehenen sicheren Ablauf geprüft werden.",
          422,
        );
      if (completionEvidenceIsIncomplete(command.evidence))
        throw new DomainError(
          "VALIDATION",
          "Die Angaben beschreiben offene oder nicht durchgeführte Arbeit. Bitte Episode unterbrechen oder Verantwortung sichtbar weitergeben.",
          422,
        );
      if (!completionEvidenceIsGrounded(command.evidence, episode.title))
        throw new DomainError(
          "VALIDATION",
          "Der Abschluss muss sichere, aktuelle und zum Auftrag passende durchgeführte Arbeit beschreiben. Messwerte bitte zuerst im Gespräch prüfen.",
          422,
        );
    }
    return persist(async () => {
      try {
        const result = await operationalStore.applyWorkdayCommand(
          actorId,
          actor.role,
          command,
        );
        if (command.type === "complete-episode") {
          const episode = result.episodes.find(
            (candidate) => candidate.id === command.episodeId,
          );
          if (!episode)
            throw new DomainError(
              "INVALID_STATE",
              "Die abgeschlossene Arbeitsepisode ist nicht mehr verfügbar.",
              409,
            );
          service.runAtomically(() => {
            const patient = service
              .snapshot(actorId, actor.defaultPurpose)
              .patients.find((candidate) => candidate.id === episode.patientId);
            if (!patient)
              throw new DomainError(
                "AUTH_DENIED",
                "Der Patientenkontext der Arbeitsepisode ist nicht freigegeben.",
                403,
              );
            const draft = service.createNoteDraft(actorId, {
              patientId: patient.id,
              encounterId: patient.encounterId,
              structuredText: command.evidence,
              purpose: actor.defaultPurpose,
            });
            service.approve(actorId, "note", draft.id, {
              expectedVersion: draft.version,
              patientMrn: patient.mrn,
              patientBirthDate: patient.birthDate,
              reviewedDiff: true,
              purpose: actor.defaultPurpose,
            });
          });
        }
        if (
          ["start-episode", "interrupt-and-start", "resume-episode"].includes(
            command.type,
          )
        ) {
          assistant.revokeActorIntents(actorId);
          revokeVoiceReceipts(actorId);
          await operationalStore.revokeActorAuthorities(actorId);
        }
        publishInvalidation();
        return {
          ...result,
          providerState:
            runtime.profile === "integrated-demo"
              ? await operationalStore.providerDeliveryState(
                  result.handover.patientIds,
                )
              : service.providerSyncState(result.handover.patientIds),
        };
      } catch (error) {
        throw new DomainError(
          "INVALID_STATE",
          error instanceof Error
            ? error.message
            : "Arbeitstag-Aktion fehlgeschlagen.",
          409,
        );
      }
    }, request);
  });

  app.post("/api/v1/assistant/context", async (request) => {
    const actorId = userId(request);
    const actor = service.user(actorId);
    const body = z
      .object({ patientId: z.string().nullable() })
      .strict()
      .parse(request.body);
    const selectedPatient = body.patientId
      ? service
          .snapshot(actorId, actor.defaultPurpose)
          .patients.find((patient) => patient.id === body.patientId)
      : undefined;
    if (body.patientId) {
      if (!selectedPatient)
        throw new DomainError(
          "AUTH_DENIED",
          "Patientenkontext ist für diese Rolle nicht freigegeben.",
          403,
        );
    }
    assistant.revokeActorIntents(actorId);
    revokeVoiceReceipts(actorId);
    await operationalStore.revokeActorAuthorities(actorId);
    const transition = operationalStore.changePatientContext(
      actorId,
      actor.role,
      body.patientId,
      selectedPatient?.encounterId ?? null,
    );
    contextTransitions.set(actorId, transition);
    try {
      return await transition;
    } finally {
      if (contextTransitions.get(actorId) === transition)
        contextTransitions.delete(actorId);
    }
  });

  app.post("/api/v1/assistant/conversation/clear", async (request) => {
    const actorId = userId(request);
    const actor = service.user(actorId);
    await persist(
      () =>
        service.audit.append({
          actor,
          action: "assistant:conversation-cleared",
          patientId: null,
          purpose: actor.defaultPurpose,
          outcome: "success",
          detail: { retentionClass: "shift-session" },
        }),
      request,
    );
    await operationalStore.clearConversation(actorId, actor.role);
    return { cleared: true, expiresAt: null };
  });

  app.post("/api/v1/assistant/transcribe", async (request) => {
    await persistenceQueue;
    const context = z
      .object({
        patientId: z.string().nullable(),
        purpose: purposeSchema.default("direct-care"),
      })
      .parse({
        patientId:
          typeof request.headers["x-pfh-patient-context"] === "string"
            ? request.headers["x-pfh-patient-context"]
            : null,
        purpose: request.headers["x-pfh-purpose"],
      });
    const actorId = userId(request);
    const actor = service.user(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    const selectedPatient = context.patientId
      ? service
          .snapshot(actorId, context.purpose)
          .patients.find((patient) => patient.id === context.patientId)
      : null;
    if (
      session.patientId !== context.patientId ||
      session.encounterId !== (selectedPatient?.encounterId ?? null)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Sprachaufnahme gehört nicht zum aktuellen Patientenkontext.",
        403,
      );
    if (context.patientId && !selectedPatient)
      throw new DomainError(
        "AUTH_DENIED",
        "Sprachaufnahme liegt ausserhalb des freigegebenen Patientenkontexts.",
        403,
      );
    const file = await request.file();
    if (
      !file ||
      ![
        "audio/webm",
        "audio/ogg",
        "audio/wav",
        "audio/mpeg",
        "audio/mp4",
      ].includes(file.mimetype)
    )
      throw new DomainError(
        "VALIDATION",
        "Es wird genau eine unterstützte Audiodatei erwartet.",
        400,
      );
    const fileBuffer = await file.toBuffer();
    const bytes = new Uint8Array(
      fileBuffer.buffer,
      fileBuffer.byteOffset,
      fileBuffer.byteLength,
    );
    try {
      const transcription = await asr.transcribe(
        bytes,
        file.mimetype,
        effectiveDataClass(),
      );
      const receiptId = randomUUID();
      const voiceAuthority: DurableVoiceAuthority = {
        actorId,
        patientId: context.patientId,
        encounterId: session.encounterId,
        purpose: context.purpose,
        textHash: createHash("sha256").update(transcription.text).digest("hex"),
        model: transcription.model,
        entityIds: transcription.criticalEntities.map(
          (entity) => `${entity.kind}:${entity.start}:${entity.end}`,
        ),
        sessionId: session.id,
        threadId: session.threadId,
        contextRevision: session.contextRevision,
        expiresAt: Date.now() + 5 * 60_000,
      };
      voiceReceipts.set(receiptId, voiceAuthority);
      await operationalStore.storeVoiceAuthority(
        authorityHash(receiptId),
        voiceAuthority,
      );
      return persist(() => {
        service.audit.append({
          actor,
          action: "assistant:voice-transcribed",
          patientId: context.patientId,
          purpose: context.purpose,
          outcome: "success",
          detail: { asrMode: asr.mode, model: asr.model, audioRetained: false },
        });
        return { transcription, voiceReceiptId: receiptId, asr: asr.status() };
      });
    } finally {
      fileBuffer.fill(0);
    }
  });

  app.post("/api/v1/assistant/query", async (request, reply) => {
    const body = assistantQueryBody.parse(request.body);
    const actorId = userId(request);
    const inferenceController = new AbortController();
    let completed = false;
    let generatedResponse: AssistantResponse | null = null;
    let revocation = Promise.resolve();
    const revokeAuthorities = () => {
      if (generatedResponse) assistant.revokeResponseIntents(generatedResponse);
      const responseId = generatedResponse?.id;
      if (responseId)
        revocation = revocation.then(() =>
          operationalStore.revokeResponseAuthorities(actorId, responseId),
        );
      return revocation;
    };
    const revokeAfterDisconnect = () => {
      if (completed) return revocation;
      inferenceController.abort("client-disconnected");
      return revokeAuthorities();
    };
    const abortInference = () => void revokeAfterDisconnect();
    const finishResponse = () => {
      // Node's `finish` event is the positive proof that the response was
      // handed to the transport. A short-lived client may already have a
      // destroyed socket at this point; treating that as an abort revokes a
      // valid review immediately after a normal HTTP response.
      completed = true;
      request.raw.removeListener("aborted", abortInference);
      reply.raw.removeListener("close", abortInference);
    };
    request.raw.once("aborted", abortInference);
    reply.raw.once("close", abortInference);
    reply.raw.once("finish", finishResponse);
    const actor = service.user(actorId);
    await contextTransitions.get(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    const selectedPatient = body.patientId
      ? service
          .snapshot(actorId, body.purpose ?? actor.defaultPurpose)
          .patients.find((patient) => patient.id === body.patientId)
      : null;
    if (
      session.patientId !== body.patientId ||
      session.encounterId !== (selectedPatient?.encounterId ?? null)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzanfrage stimmt nicht mit dem bewusst gewählten Patientenkontext überein.",
        403,
      );
    const voiceReceiptId = await consumeValidatedVoiceReceipt(
      actorId,
      body,
      session,
    );
    const previousCarePlan =
      session.patientId && session.encounterId
        ? await operationalStore.loadPendingCarePlan(
            actorId,
            session.patientId,
            session.encounterId,
            session.threadId,
          )
        : null;
    const workingContext = await assistantWorkingContext(
      actorId,
      previousCarePlan,
    );
    const response = await runAssistantQuery(() =>
      assistant.query(userId(request), {
        prompt: body.prompt,
        patientId: body.patientId,
        inputModality: body.inputModality,
        voiceTranscriptConfirmed: body.voiceTranscriptConfirmed ?? false,
        signal: inferenceController.signal,
        workingContext,
        ...(body.purpose ? { purpose: body.purpose } : {}),
      }),
    );
    generatedResponse = response;
    if (inferenceController.signal.aborted) {
      await revokeAfterDisconnect();
      throw new DomainError(
        "INVALID_STATE",
        "Assistenzanfrage wurde abgebrochen.",
        499,
      );
    }
    await persistResponseAuthorities(response, session);
    if (inferenceController.signal.aborted) {
      await revokeAfterDisconnect();
      throw new DomainError(
        "INVALID_STATE",
        "Assistenzanfrage wurde abgebrochen.",
        499,
      );
    }
    try {
      await operationalStore.appendConversationTurn(actorId, actor.role, {
        id: response.id,
        prompt: body.prompt,
        response: archiveAssistantResponse(response),
        createdAt: new Date().toISOString(),
        inputModality: body.inputModality,
        originPatientId: body.patientId,
        originEncounterId: session.encounterId,
        originThreadId: session.threadId,
        originContextRevision: session.contextRevision,
      });
    } catch (error) {
      await revokeAuthorities();
      throw error;
    }
    if (inferenceController.signal.aborted) {
      await revokeAfterDisconnect();
      throw new DomainError(
        "INVALID_STATE",
        "Assistenzanfrage wurde abgebrochen.",
        499,
      );
    }
    void voiceReceiptId;
    return response;
  });

  app.post("/api/v1/assistant/query/stream", async (request, reply) => {
    const body = assistantQueryBody.parse(request.body);
    const actorId = userId(request);
    const inferenceController = new AbortController();
    let completed = false;
    let streamedResponse: AssistantResponse | null = null;
    let revocation = Promise.resolve();
    const revokeAuthorities = () => {
      if (streamedResponse) assistant.revokeResponseIntents(streamedResponse);
      const responseId = streamedResponse?.id;
      if (responseId)
        revocation = revocation.then(() =>
          operationalStore.revokeResponseAuthorities(actorId, responseId),
        );
      return revocation;
    };
    const revokeAfterDisconnect = () => {
      if (completed) return revocation;
      inferenceController.abort("client-disconnected");
      return revokeAuthorities();
    };
    const abortInference = () => void revokeAfterDisconnect();
    const finishResponse = () => {
      completed = true;
      request.raw.removeListener("aborted", abortInference);
      reply.raw.removeListener("close", abortInference);
    };
    request.raw.once("aborted", abortInference);
    reply.raw.once("close", abortInference);
    reply.raw.once("finish", finishResponse);
    const actor = service.user(actorId);
    await contextTransitions.get(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    const selectedPatient = body.patientId
      ? service
          .snapshot(actorId, body.purpose ?? actor.defaultPurpose)
          .patients.find((patient) => patient.id === body.patientId)
      : null;
    if (
      session.patientId !== body.patientId ||
      session.encounterId !== (selectedPatient?.encounterId ?? null)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzanfrage stimmt nicht mit dem bewusst gewählten Patientenkontext überein.",
        403,
      );
    const voiceReceiptId = await consumeValidatedVoiceReceipt(
      actorId,
      body,
      session,
    );

    const previousCarePlan =
      session.patientId && session.encounterId
        ? await operationalStore.loadPendingCarePlan(
            actorId,
            session.patientId,
            session.encounterId,
            session.threadId,
          )
        : null;
    const workingContext = await assistantWorkingContext(
      actorId,
      previousCarePlan,
    );
    const response = await runAssistantQuery(() =>
      assistant.query(actorId, {
        prompt: body.prompt,
        patientId: body.patientId,
        inputModality: body.inputModality,
        voiceTranscriptConfirmed: body.voiceTranscriptConfirmed ?? false,
        signal: inferenceController.signal,
        workingContext,
        ...(body.purpose ? { purpose: body.purpose } : {}),
      }),
    );
    streamedResponse = response;
    if (inferenceController.signal.aborted) {
      await revokeAfterDisconnect();
      return reply.code(499).send({
        error: "INVALID_STATE",
        message: "Assistenzanfrage wurde abgebrochen.",
        requestId: request.id,
      });
    }
    await persistResponseAuthorities(response, session);
    if (inferenceController.signal.aborted) {
      await revokeAfterDisconnect();
      return reply.code(499).send({
        error: "INVALID_STATE",
        message: "Assistenzanfrage wurde abgebrochen.",
        requestId: request.id,
      });
    }
    reply.hijack();
    reply.raw.statusCode = 200;
    reply.raw.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    reply.raw.setHeader("cache-control", "no-store, no-transform");
    reply.raw.setHeader("x-content-type-options", "nosniff");
    const write = (frame: unknown) =>
      reply.raw.write(`${JSON.stringify(frame)}\n`);
    write({
      type: "start",
      response: { ...response, components: [], openUi: "" },
    });
    // Partial presentation never carries executable authority. The complete
    // frame exposes the live review authority only after its thread record is durable.
    const lines = archiveAssistantResponse(response).openUi.split("\n");
    for (const [index, line] of lines.entries()) {
      write({
        type: "openui",
        chunk: `${index === 0 ? "" : "\n"}${line}`,
      });
    }
    try {
      await operationalStore.appendConversationTurn(actorId, actor.role, {
        id: response.id,
        prompt: body.prompt,
        response: archiveAssistantResponse(response),
        createdAt: new Date().toISOString(),
        inputModality: body.inputModality,
        originPatientId: body.patientId,
        originEncounterId: session.encounterId,
        originThreadId: session.threadId,
        originContextRevision: session.contextRevision,
      });
    } catch {
      await revokeAuthorities();
      write({
        type: "error",
        message:
          "Der Gesprächszustand konnte nicht sicher gespeichert werden. Es wurde keine Aktion freigeschaltet.",
      });
      reply.raw.end();
      return;
    }
    if (inferenceController.signal.aborted) {
      await revokeAfterDisconnect();
      reply.raw.end();
      return;
    }
    void voiceReceiptId;
    write({ type: "complete", response });
    reply.raw.end();
  });
  app.post("/api/v1/assistant/intents/:token/execute", async (request) => {
    const { token } = z.object({ token: z.uuid() }).parse(request.params);
    const execution = assistantIntentBody.parse(request.body);
    const actorId = userId(request);
    const actor = service.user(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    if (
      session.patientId !== execution.patientId ||
      session.encounterId !== execution.encounterId
    )
      return persist(() => {
        service.audit.append({
          actor,
          action: "assistant:intent-rejected",
          patientId: execution.patientId,
          purpose: execution.purpose,
          outcome: "denied",
          detail: { reason: "active-patient-context-mismatch" },
        });
        throw new DomainError(
          "AUTH_DENIED",
          "Assistenzaktion gehört nicht zum aktuellen Patientenkontext.",
          403,
        );
      }, request);
    const tokenHash = authorityHash(token);
    const durableIntent = await operationalStore.loadIntentAuthority({
      tokenHash,
      actorId,
      sessionId: session.id,
      threadId: session.threadId,
      contextRevision: session.contextRevision,
      patientId: execution.patientId,
      encounterId: execution.encounterId,
    });
    if (
      !durableIntent ||
      durableIntent.encounterId !== execution.encounterId ||
      durableIntent.purpose !== execution.purpose ||
      durableIntent.resourceVersion !== execution.resourceVersion
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzaktion ist ungültig, abgelaufen oder bereits verwendet.",
        403,
      );
    if (
      runtime.profile !== "integrated-demo" &&
      !(await operationalStore.consumeIntentAuthority(tokenHash))
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzaktion wurde bereits verwendet.",
        403,
      );
    assistant.restoreDurableIntent(token, durableIntent);
    let executedResult: unknown;
    const executeAuthorizedIntent = async () => {
      const result = assistant.executeIntent(actorId, token, {
        patientId: execution.patientId,
        encounterId: execution.encounterId,
        purpose: execution.purpose,
        resourceVersion: execution.resourceVersion,
        explicitlyConfirmed: execution.explicitlyConfirmed,
        ...(execution.reviewedActionIds
          ? { reviewedActionIds: execution.reviewedActionIds }
          : {}),
      });
      if (
        !result ||
        typeof result !== "object" ||
        !("workflowActions" in result)
      )
        return result;
      const workflowActions = (
        result as {
          workflowActions: Array<{
            operation: "pause-current-and-start-room";
            targetRoom: string;
            reason: string;
          }>;
        }
      ).workflowActions;
      const workflowAction = workflowActions[0];
      if (
        workflowActions.length !== 1 ||
        !workflowAction ||
        workflowAction.operation !== "pause-current-and-start-room"
      )
        throw new DomainError(
          "VALIDATION",
          "Der Ablaufwechsel ist nicht eindeutig.",
          400,
        );
      const workday = await operationalStore.getWorkday(actorId, actor.role);
      const active = workday.activeEpisode;
      if (
        !active ||
        active.patientId !== execution.patientId ||
        active.encounterId !== execution.encounterId
      )
        throw new DomainError(
          "VERSION_CONFLICT",
          "Die aktive Arbeit hat sich geändert. Bitte den Wechsel neu formulieren.",
          409,
        );
      const target = service
        .snapshot(actorId, execution.purpose)
        .patients.find((patient) => patient.room === workflowAction.targetRoom);
      if (!target || target.id === active.patientId)
        throw new DomainError(
          "VALIDATION",
          `Zimmer ${workflowAction.targetRoom} ist im freigegebenen Arbeitskontext nicht eindeutig verfügbar.`,
          400,
        );
      if (runtime.profile === "integrated-demo")
        throw new DomainError(
          "INVALID_STATE",
          "Der Ablaufwechsel benötigt atomare Arbeitsplan-Unterstützung und wurde nicht übernommen.",
          409,
        );
      const next = await operationalStore.applyWorkdayCommand(
        actorId,
        actor.role,
        {
          type: "interrupt-and-start",
          episodeId: active.id,
          patientId: target.id,
          encounterId: target.encounterId,
          title: `Spontaner Besuch · Zimmer ${target.room}`,
        },
      );
      service.audit.append({
        actor,
        action: "assistant:workflow-interrupted",
        patientId: target.id,
        purpose: execution.purpose,
        outcome: "success",
        detail: {
          pausedEpisodeId: active.id,
          targetRoom: target.room,
          requestedByUser: true,
        },
      });
      return { workday: next, workflowChanged: true };
    };
    try {
      if (runtime.profile === "integrated-demo") {
        executedResult = await runSerializedMutation(async () => {
          const command = requestCommandKeys.get(request);
          if (!command)
            throw new DomainError(
              "VALIDATION",
              "Lokale Annahme benötigt eine eindeutige Befehls-ID.",
              400,
            );
          const beforeCheckpoint = service.checkpoint();
          const beforeResources = service.fhirResources();
          const beforeAuditLength = service.audit.length;
          const priorProviderKeys = new Set(
            service
              .pendingProviderCommands()
              .map((pending) => pending.command.idempotencyKey),
          );
          try {
            const result = await executeAuthorizedIntent();
            const nextResources = service.fhirResources();
            const previousByReference = new Map(
              beforeResources.map((resource) => [
                `${resource.resourceType}/${resource.id}`,
                JSON.stringify(resource),
              ]),
            );
            const nextReferences = new Set(
              nextResources.map(
                (resource) => `${resource.resourceType}/${resource.id}`,
              ),
            );
            const changedResources = nextResources.filter(
              (resource) =>
                previousByReference.get(
                  `${resource.resourceType}/${resource.id}`,
                ) !== JSON.stringify(resource),
            );
            const removedReferences = [...previousByReference.keys()].filter(
              (reference) =>
                !reference.startsWith("Provenance/") &&
                !nextReferences.has(reference),
            );
            if (!workspace.loadResourceVersions)
              throw new Error("CLINICAL_VERSION_READ_NOT_AVAILABLE");
            const clinicalReferences = [
              ...changedResources.map(
                (resource) => `${resource.resourceType}/${resource.id}`,
              ),
              ...removedReferences,
            ];
            const clinicalExpectedVersions =
              await workspace.loadResourceVersions(clinicalReferences);
            const providerCommands = service
              .pendingProviderCommands()
              .filter(
                (pending) =>
                  !priorProviderKeys.has(pending.command.idempotencyKey),
              );
            const acceptedCheckpoint = service.checkpoint();
            acceptedCheckpoint.state.outbox =
              acceptedCheckpoint.state.outbox.filter(
                (pending) =>
                  !providerCommands.some(
                    (accepted) =>
                      accepted.command.idempotencyKey ===
                      pending.idempotencyKey,
                  ),
              );
            const receipt = await operationalStore.acceptIntentCommand({
              tokenHash,
              actorId,
              actorRole: actor.role,
              purpose: execution.purpose,
              patientId: execution.patientId,
              encounterId: execution.encounterId,
              sessionId: session.id,
              threadId: session.threadId,
              contextRevision: session.contextRevision,
              resourceVersion: execution.resourceVersion,
              commandKey: command.key,
              requestHash: command.requestHash,
              statusCode: 200,
              resultPayload: result,
              selectedActionIds: execution.reviewedActionIds ?? [],
              policyVersion: runtimeSitePack.packDigest,
              sourceReadSet: [
                {
                  reference: `Patient/${fhirResourceId("Patient", execution.patientId)}`,
                  version: execution.resourceVersion,
                },
                {
                  reference: `Encounter/${fhirResourceId("Encounter", execution.encounterId)}`,
                  version: execution.resourceVersion,
                },
              ],
              auditEntries: service.audit.slice(beforeAuditLength),
              clinicalResources: changedResources,
              removedReferences,
              clinicalExpectedVersions,
              checkpoint: acceptedCheckpoint,
              ...(result &&
              typeof result === "object" &&
              "episodeEvidence" in result &&
              typeof result.episodeEvidence === "string"
                ? { episodeEvidence: result.episodeEvidence }
                : {}),
              providerCommands,
            });
            committedCommandKeys.add(command.key);
            service.recordCommandReceipt({
              key: command.key,
              requestHash: command.requestHash,
              statusCode: receipt.statusCode,
              payload: JSON.stringify(receipt.payload),
            });
            service.retireAcceptedProviderCommands(
              providerCommands.map((pending) => pending.command.idempotencyKey),
            );
            durableResources = nextResources;
            publishInvalidation();
            return receipt.payload;
          } catch (error) {
            service.restoreCheckpoint(beforeCheckpoint);
            assistant.restoreDurableIntent(token, durableIntent);
            throw error;
          }
        });
      } else {
        executedResult = await persist(executeAuthorizedIntent, request);
      }
    } catch (error) {
      if (runtime.profile !== "integrated-demo")
        await operationalStore.releaseIntentAuthority(tokenHash);
      assistant.restoreDurableIntent(token, durableIntent);
      throw error;
    }
    // The integrated profile stores episode evidence in the same PostgreSQL
    // acceptance transaction. This fallback exists only for the explicit
    // memory demo path.
    if (
      runtime.profile !== "integrated-demo" &&
      executedResult &&
      typeof executedResult === "object" &&
      "episodeEvidence" in executedResult &&
      typeof executedResult.episodeEvidence === "string"
    ) {
      try {
        const workday = await operationalStore.getWorkday(actorId, actor.role);
        const active = workday.activeEpisode;
        if (
          active &&
          active.patientId === execution.patientId &&
          active.encounterId === execution.encounterId
        ) {
          const existing = active.draftText?.trim() ?? "";
          const addition = executedResult.episodeEvidence.trim();
          const draftText = existing.includes(addition)
            ? existing
            : [existing, addition].filter(Boolean).join("\n").slice(0, 1200);
          await operationalStore.applyWorkdayCommand(actorId, actor.role, {
            type: "save-episode-draft",
            episodeId: active.id,
            draftText,
          });
          publishInvalidation();
        }
      } catch {
        // The clinical command is already durably accepted. A convenience
        // draft failure must not reopen one-use authority or report rollback.
        app.log.warn(
          { actorId },
          "accepted assistant evidence could not be copied to work episode",
        );
      }
    }
    return executedResult;
  });

  app.post("/api/v1/tasks", async (request, reply) => {
    requireMigratedClinicalMutation();
    const result = await persist(
      () =>
        service.createTask(userId(request), taskCreateBody.parse(request.body)),
      request,
      201,
    );
    return reply.code(201).send(result);
  });
  app.post("/api/v1/tasks/:id/:transition", async (request) => {
    requireMigratedClinicalMutation();
    const params = z
      .object({
        id: z.string(),
        transition: z.enum(["accept", "start", "complete", "delegate"]),
      })
      .parse(request.params);
    return persist(
      () =>
        service.updateTask(
          userId(request),
          params.id,
          params.transition,
          taskBody.parse(request.body),
        ),
      request,
    );
  });
  app.post("/api/v1/observations/drafts", async (request, reply) =>
    (requireMigratedClinicalMutation(), reply)
      .code(201)
      .send(
        await persist(
          () =>
            service.createObservationDraft(
              userId(request),
              observationBody.parse(request.body),
            ),
          request,
          201,
        ),
      ),
  );
  app.post("/api/v1/notes/drafts", async (request, reply) =>
    (requireMigratedClinicalMutation(), reply)
      .code(201)
      .send(
        await persist(
          () =>
            service.createNoteDraft(
              userId(request),
              noteBody.parse(request.body),
            ),
          request,
          201,
        ),
      ),
  );
  app.post("/api/v1/:type/:id/approve", async (request) => {
    requireMigratedClinicalMutation();
    const params = z
      .object({ type: z.enum(["observation", "note"]), id: z.string() })
      .parse(request.params);
    const actorId = userId(request);
    const actor = service.user(actorId);
    const record =
      params.type === "observation"
        ? service
            .snapshot(actorId, actor.defaultPurpose)
            .observations.find((item) => item.id === params.id)
        : service
            .snapshot(actorId, actor.defaultPurpose)
            .notes.find((item) => item.id === params.id);
    if (!record)
      throw new DomainError(
        "NOT_FOUND",
        "Klinischer Entwurf nicht gefunden.",
        404,
      );
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    if (
      session.patientId !== record.patientId ||
      session.encounterId !== record.encounterId
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Freigabe erfordert den bewusst gewählten passenden Patientenkontext.",
        403,
      );
    return persist(
      () =>
        service.approve(
          actorId,
          params.type,
          params.id,
          approveBody.parse(request.body),
        ),
      request,
    );
  });
  app.post("/api/v1/communications", async (request, reply) =>
    (requireMigratedClinicalMutation(), reply)
      .code(201)
      .send(
        await persist(
          () =>
            service.createCommunication(
              userId(request),
              communicationBody.parse(request.body),
            ),
          request,
          201,
        ),
      ),
  );
  app.post("/api/v1/communications/:id/:transition", async (request) => {
    requireMigratedClinicalMutation();
    const params = z
      .object({
        id: z.string(),
        transition: z.enum(["acknowledge", "answer", "close"]),
      })
      .parse(request.params);
    return persist(
      () =>
        service.transitionCommunication(
          userId(request),
          params.id,
          params.transition,
          communicationTransitionBody.parse(request.body),
        ),
      request,
    );
  });
  app.post("/api/v1/intake/:id/review", async (request) => {
    requireMigratedClinicalMutation();
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = intakeReviewBody.parse(request.body);
    return persist(
      () =>
        service.reviewIntakeItem(
          userId(request),
          params.id,
          body.detail,
          body.purpose,
        ),
      request,
    );
  });
  app.post("/api/v1/round-actions", async (request, reply) =>
    (requireMigratedClinicalMutation(), reply)
      .code(201)
      .send(
        await persist(
          () =>
            service.createRoundAction(
              userId(request),
              roundBody.parse(request.body),
            ),
          request,
          201,
        ),
      ),
  );
  if (demoMode) {
    app.post("/api/v1/simulators/nurse-call", async (request, reply) => {
      const { patientId } = z
        .object({ patientId: z.string() })
        .parse(request.body);
      return reply
        .code(201)
        .send(
          await persist(
            () => service.triggerNurseCall(userId(request), patientId),
            request,
            201,
          ),
        );
    });
    app.post(
      "/api/v1/simulators/nurse-call/escalations/run",
      async (request) => {
        const { advanceMinutes } = z
          .object({ advanceMinutes: z.number().min(0).max(60).default(0) })
          .parse(request.body ?? {});
        return persist(
          () =>
            service.runNurseCallEscalations(
              userId(request),
              new Date(Date.now() + advanceMinutes * 60_000).toISOString(),
            ),
          request,
        );
      },
    );
    app.post(
      "/api/v1/simulators/communications/escalations/run",
      async (request) => {
        const { advanceMinutes } = z
          .object({
            advanceMinutes: z
              .number()
              .min(0)
              .max(24 * 60)
              .default(0),
          })
          .parse(request.body ?? {});
        return persist(
          () =>
            service.runCommunicationEscalations(
              userId(request),
              new Date(Date.now() + advanceMinutes * 60_000).toISOString(),
            ),
          request,
        );
      },
    );
    app.post(
      "/api/v1/simulators/providers/:provider/:mode",
      async (request) => {
        const params = z
          .object({
            provider: providerSchema,
            mode: z.enum(["normal", "delay", "reject", "down", "conflict"]),
          })
          .parse(request.params);
        return persist(
          () =>
            service.setProviderMode(
              userId(request),
              params.provider,
              params.mode,
            ),
          request,
        );
      },
    );
    app.post("/api/v1/demo/reset", async (request, reply) => {
      const operator = service.user(userId(request));
      if (operator.role !== "it")
        return reply.code(403).send({
          error: "AUTH_DENIED",
          message: "Nur der Demo-IT-Operator darf zurücksetzen.",
          requestId: request.id,
        });
      const result = await persist(async () => {
        await service.reset({
          resetAudit: workspace.mode === "in-memory",
          actor: operator,
        });
        return { status: "reset" };
      }, request);
      await operationalStore.resetDemoState();
      for (const user of service.checkpoint().state.users) {
        assistant.revokeActorIntents(user.id);
        await operationalStore.revokeActorAuthorities(user.id);
      }
      return result;
    });
  }
  app.post("/api/v1/outbox/process", async (request) => {
    if (runtime.profile === "integrated-demo")
      throw new DomainError(
        "INVALID_STATE",
        "Die integrierte Zustellung läuft automatisch über die relationale Warteschlange.",
        409,
      );
    return persist(() => service.flushOutbox(userId(request)), request);
  });
  app.post("/api/v1/outbox/:outboxId/reconcile", async (request) => {
    if (runtime.profile === "integrated-demo")
      throw new DomainError(
        "INVALID_STATE",
        "Der frühere Checkpoint-Abgleich ist im integrierten Profil deaktiviert.",
        409,
      );
    const { outboxId } = z
      .object({ outboxId: z.string() })
      .parse(request.params);
    return persist(
      () =>
        service.reconcileOutbox(
          userId(request),
          outboxId,
          reconciliationBody.parse(request.body),
        ),
      request,
    );
  });
  app.get("/api/v1/audit/evidence", async (request) => {
    await persistenceQueue;
    return service.auditEvidence(userId(request));
  });

  const pwaRoot = resolve(process.cwd(), "dist/pwa");
  if (existsSync(pwaRoot)) {
    void app.register(fastifyStatic, { root: pwaRoot, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/"))
        return reply.sendFile("index.html");
      return reply.code(404).send({
        error: "NOT_FOUND",
        message: "Route nicht gefunden.",
        requestId: request.id,
      });
    });
  }

  app.addHook("onClose", async () => {
    await operationalStore.close();
  });

  return app;
}
