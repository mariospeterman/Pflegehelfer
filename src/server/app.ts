import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Writable } from "node:stream";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import { createUIMessageStream, pipeUIMessageStreamToResponse } from "ai";
import { z } from "zod";
import {
  archiveAssistantResponse,
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
import {
  isDomainError,
  PflegehelferService,
  type CommandReceipt,
  type CommandReceiptAuthorization,
  type ServiceCheckpoint,
} from "../core/service.js";
import { emptyWorkflowState } from "../core/service.js";
import { installDemoScenarioRuntime } from "../core/demo-scenario-runtime.js";
import {
  baselineDemoScenario,
  parseDemoScenarioRun,
  scenarioDigest,
  scenarioInventory,
  scenarioRunContentDigest,
} from "../core/demo-scenario.js";
import { siteConfiguration } from "../core/site-config.js";
import { decide, type Action } from "../core/policy.js";
import { runtimeSitePack } from "../core/runtime-instructions.js";
import { InMemoryReferenceStatePort } from "../core/clinical-data-port.js";
import { extractCriticalEntities } from "../core/critical-entities.js";
import {
  createVoiceTranscriptProvenance,
  transcriptHash,
  voiceTranscriptOriginalSchema,
  type VoiceTranscriptProvenance,
} from "../core/voice-provenance.js";
import { DomainError, type Purpose } from "../core/types.js";
import type { AssistantComponent } from "../core/assistant.js";
import {
  createProductionProviderRegistry,
  createSyntheticProviderRegistry,
  ProviderDeliveryWorker,
  providerIntegrationRoutes,
  type ProviderDeliveryAuthorization,
  type ProviderDeliveryStore,
  type ProviderOutboxJob,
} from "../core/provider-integration/index.js";
import { ClinicalProjectionWorker } from "../core/clinical-projection-worker.js";
import {
  InMemoryClinicalWorkspace,
  type ClinicalWorkspace,
} from "../infrastructure/medplum-workspace.js";
import {
  InMemoryOperationalStore,
  type AcceptedCommandAuthorization,
  type AssistantContextBinding,
  type AssistantRequestIdentity,
  type DurableVoiceAuthority,
  type IntentAuthorityWrite,
  type OperationalStore,
} from "../infrastructure/operational-store.js";
import { seedSyntheticDemoWorkspace } from "../infrastructure/demo-workspace.js";
import {
  documentInspectionFromEnvironment,
  type DocumentInspectionGateway,
} from "../infrastructure/document-inspection.js";
import {
  InMemoryDemoScenarioStore,
  type DemoScenarioStore,
} from "../infrastructure/demo-scenario-store.js";
import type { WorkdayCommand } from "../core/workday.js";
import {
  parseSourceReadSetV1,
  sourceReadSetMatches,
  type SourceReadSetV1,
} from "../core/source-read-set.js";
import type { RuntimeProfileConfiguration } from "./runtime-profile.js";
import { runtimeBuildInfo } from "./build-info.js";
import {
  buildOrganizationalValueReport,
  organizationalValueInputSchema,
} from "../core/organizational-value.js";
import {
  buildOrganizationStatement,
  loadOrganizationCommercialConfig,
  organizationCommercialConfigSchema,
  organizationStatementCsv,
  organizationStatementPeriodSchema,
  organizationUsageReceiptSchema,
} from "../core/organization-economics.js";
import {
  InMemoryCommercialStore,
  type CommercialStore,
} from "../infrastructure/commercial-store.js";
import {
  workspaceAudienceSchema,
  workspaceProfileFieldSchema,
  workspaceProjectLinkSchema,
  type WorkspaceAudience,
  type WorkspaceAttachment,
  type WorkspaceComment,
  type WorkspaceProfileProposal,
  type WorkspaceProject,
} from "../core/workspace.js";
import {
  oidcConfigurationFromEnvironment,
  PostgresOidcBff,
  type AuthenticatedIdentity,
  type IdentityAdapter,
} from "./oidc-bff.js";

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
const clinicalProjectionRetryBody = z
  .object({
    expectedErrorCode: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[A-Za-z0-9_.:-]+$/),
  })
  .strict();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

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
    prompt: z.string().trim().min(2).max(8_000),
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

export function authorizeProviderDispatch(
  service: PflegehelferService,
  policyVersion: string,
  job: Readonly<ProviderOutboxJob>,
): ProviderDeliveryAuthorization {
  const envelope = job.authorityEnvelope;
  if (
    !job.acceptedCommandId ||
    !envelope ||
    envelope.acceptedCommandId !== job.acceptedCommandId ||
    envelope.organizationId !== siteConfiguration.institutionId ||
    envelope.siteId !== siteConfiguration.siteId ||
    envelope.departmentId !== siteConfiguration.department.id ||
    envelope.patientId !==
      job.payload.command.patientReference.slice("Patient/".length) ||
    envelope.encounterId !==
      job.payload.command.encounterReference.slice("Encounter/".length)
  )
    return { allowed: false, reason: "acceptance-envelope-invalid" };
  try {
    const currentActor = service.user(String(envelope.actorId));
    if (currentActor.role !== envelope.actorRole)
      return { allowed: false, reason: "actor-role-revoked" };
    if (envelope.policyVersion !== policyVersion)
      return { allowed: false, reason: "policy-version-revoked" };
    const patient = service
      .snapshot(currentActor.id, String(envelope.purpose) as Purpose)
      .patients.find((candidate) => candidate.id === envelope.patientId);
    if (!patient)
      return { allowed: false, reason: "care-relationship-revoked" };
    if (patient.encounterId !== envelope.encounterId)
      return { allowed: false, reason: "encounter-relationship-revoked" };
    const actionByOperation: Record<string, Action> = {
      "Observation.write": "observation:approve",
      "NursingNote.write": "note:approve",
      "Task.write": "task:update",
      "Communication.write": "communication:create",
    };
    const action = actionByOperation[job.operation];
    if (
      !action ||
      !Array.isArray(envelope.actions) ||
      !envelope.actions.includes(action) ||
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
}

export function buildApp(
  providedService?: PflegehelferService,
  options: {
    demoMode?: boolean;
    workspace?: ClinicalWorkspace;
    operationalStore?: OperationalStore;
    commercialStore?: CommercialStore;
    scenarioStore?: DemoScenarioStore;
    documentInspection?: DocumentInspectionGateway;
    modelGateway?: ModelGateway;
    runtime?: RuntimeProfileConfiguration;
    loggerStream?: Writable;
    loggerLevel?: string;
    identity?: IdentityAdapter;
  } = {},
): FastifyInstance {
  // PIDs are namespace-local and routinely collide across replicas. Bind all
  // queue holders created by this process to one boot-unique generation.
  const workerGeneration = randomUUID();
  const demoMode = options.demoMode ?? process.env.PFH_DEMO_MODE === "true";
  const workspace = options.workspace ?? new InMemoryClinicalWorkspace();
  const operationalStore =
    options.operationalStore ?? new InMemoryOperationalStore();
  const commercialStore =
    options.commercialStore ?? new InMemoryCommercialStore();
  const scenarioStore =
    options.scenarioStore ?? new InMemoryDemoScenarioStore();
  const documentInspection =
    options.documentInspection ?? documentInspectionFromEnvironment();
  const commercialSeed = loadOrganizationCommercialConfig();
  if (commercialSeed.organizationId !== siteConfiguration.institutionId)
    throw new Error("COMMERCIAL_CONFIGURATION_SCOPE_MISMATCH");
  let commercialInitialization: Promise<void> | null = null;
  const ensureCommercialReady = () => {
    commercialInitialization ??= commercialStore
      .initialize(commercialSeed)
      .catch((error: unknown) => {
        commercialInitialization = null;
        throw error;
      });
    return commercialInitialization;
  };
  let scenarioInitialization: Promise<void> | null = null;
  const ensureScenarioReady = () => {
    if (!demoMode) return Promise.resolve();
    scenarioInitialization ??= scenarioStore
      .initialize()
      .then(() => undefined)
      .catch((error: unknown) => {
        scenarioInitialization = null;
        throw error;
      });
    return scenarioInitialization;
  };
  const runtime =
    options.runtime ??
    ({
      profile: demoMode ? "memory-demo" : "production",
      demoMode,
      storageMode: workspace.mode,
      persistenceMode: operationalStore.mode,
      providerMode: demoMode ? "in-process-simulator" : "production",
    } satisfies RuntimeProfileConfiguration);
  const oidcConfiguration = options.identity
    ? null
    : oidcConfigurationFromEnvironment(
        process.env,
        siteConfiguration.institutionId,
      );
  const identity =
    options.identity ??
    (oidcConfiguration ? new PostgresOidcBff(oidcConfiguration) : null);
  let identityInitialization: Promise<void> | null = null;
  const ensureIdentityReady = () => {
    if (!identity) return Promise.resolve();
    identityInitialization ??= identity.initialize().catch((error: unknown) => {
      identityInitialization = null;
      throw error;
    });
    return identityInitialization;
  };
  const authenticatedIdentities = new WeakMap<
    FastifyRequest,
    AuthenticatedIdentity
  >();
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
  if (demoMode) installDemoScenarioRuntime(service.checkpoint().state);
  const models =
    options.modelGateway ??
    new ModelGateway(process.env, {
      canStartNewInference: async () => {
        await ensureCommercialReady();
        const period = new Date().toISOString().slice(0, 7);
        const configuration = await commercialStore.getConfiguration(
          siteConfiguration.institutionId,
        );
        const statement = buildOrganizationStatement(
          configuration,
          await commercialStore.listUsage(
            siteConfiguration.institutionId,
            period,
          ),
          period,
        );
        return statement.budget.newInference === "paused"
          ? {
              allowed: false,
              reason: "organization-ai-spending-limit-reached",
            }
          : { allowed: true, reason: "organization-ai-budget-available" };
      },
      recordProviderUsage: async (receipt) => {
        await ensureCommercialReady();
        await commercialStore.recordUsage({
          ...receipt,
          organizationId: siteConfiguration.institutionId,
        });
      },
    });
  const asr = new AsrGateway();
  const tts = new TtsGateway();
  const knowledge = new ApprovedKnowledgeService();
  let durableResources = service.fhirResources();
  const assistant = new AssistantService(service, models, knowledge, {
    getSyncStatus: async () => {
      const diagnostics = await operationalStore.deliveryDiagnostics();
      const capturedAt = new Date().toISOString();
      const version = createHash("sha256")
        .update(JSON.stringify(diagnostics))
        .digest("hex");
      return {
        referenceId: `OperationalDeliveryDiagnostics/${version}`,
        sourceVersion: version,
        freshness: capturedAt,
        complete: true,
        data: {
          acceptedCommands: diagnostics.acceptedCommands,
          clinicalProjections: diagnostics.clinicalProjections,
          providerDeliveries: diagnostics.providerDeliveries,
        },
      };
    },
    captureSourceReadSet: async (sourceReadSet) => {
      try {
        return await workspace.captureSourceReadSet(
          sourceReadSet,
          durableResources,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          (error.message.startsWith("SOURCE_READ_") ||
            error.message.startsWith("MEDPLUM_RESOURCE_VERSION_MISSING"))
        )
          throw new DomainError(
            "VERSION_CONFLICT",
            "Die autorisierte Quelle hat sich während der Prüfung geändert. Bitte die aktualisierten Angaben erneut prüfen.",
            409,
          );
        throw error;
      }
    },
  });
  const effectiveDataClass = () =>
    service.dataClass() === "synthetic-demo" &&
    service.providerProfile === "synthetic-simulator"
      ? ("synthetic-demo" as const)
      : ("institution-local" as const);
  const assistantWorkingContext = async (
    actorId: string,
    assistantContext: AssistantContextBinding,
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
        assistantContext.patientId,
        assistantContext,
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
      sessionId: assistantContext.sessionId,
      threadId: assistantContext.threadId,
      contextRevision: assistantContext.contextRevision,
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
            id: workday.handover.id,
            version: workday.handover.version,
            contentHash: workday.handover.contentHash,
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
            items: workday.handover.items.map((item) => {
              const plan = workday.plan.find(
                (candidate) => candidate.patientId === item.patientId,
              );
              return {
                patientId: item.patientId,
                encounterId: item.encounterId,
                currentImportant: item.currentImportant,
                recentChanges: item.recentChanges,
                nextSteps: [
                  ...(plan ? [`${plan.title} · ${plan.reason}`] : []),
                  ...item.openQuestions,
                ],
              };
            }),
          }
        : null,
    };
  };
  let persistenceQueue: Promise<void> = Promise.resolve();
  let assistantAuditQueue: Promise<void> = Promise.resolve();
  let eventRevision = 0;
  const voiceReceipts = new Map<string, DurableVoiceAuthority>();
  const revokeVoiceReceipts = (actorId: string) => {
    for (const [receiptId, receipt] of voiceReceipts)
      if (receipt.actorId === actorId) voiceReceipts.delete(receiptId);
  };
  const revokeClientVoiceReceipts = (
    actorId: string,
    clientContextId: string,
  ) => {
    for (const [receiptId, receipt] of voiceReceipts)
      if (
        receipt.actorId === actorId &&
        receipt.clientContextId === clientContextId
      )
        voiceReceipts.delete(receiptId);
  };
  const authorityHash = (token: string) =>
    createHash("sha256").update(token).digest("hex");
  const collectResponseAuthorities = async (
    response: AssistantResponse,
    context: AssistantContextBinding,
  ): Promise<IntentAuthorityWrite[]> => {
    const authorities: IntentAuthorityWrite[] = [];
    for (const component of response.components) {
      if (component.type !== "DraftAction") continue;
      const record = assistant.durableIntentRecord(component.intentToken);
      if (!record)
        throw new DomainError(
          "INVALID_STATE",
          "Die geprüfte Aktion konnte nicht dauerhaft gebunden werden.",
          503,
        );
      const sourceReadSet = await workspace.captureSourceReadSet(
        parseSourceReadSetV1(record.sourceReadSet),
        durableResources,
      );
      authorities.push({
        tokenHash: authorityHash(component.intentToken),
        record: { ...record, sourceReadSet },
        sessionId: context.sessionId,
        threadId: context.threadId,
        contextRevision: context.contextRevision,
        responseId: response.id,
        reviewItems: component.reviewItems ?? [],
        clientContextId: context.clientContextId,
      });
    }
    return authorities;
  };
  const consumeValidatedVoiceReceipt = async (
    actorId: string,
    body: AssistantQueryBody,
    context: AssistantContextBinding,
    commandId: string,
  ): Promise<{
    provenance: VoiceTranscriptProvenance;
    receiptId: string;
    tokenHash: string;
  } | null> => {
    if (body.inputModality !== "voice") return null;
    const receiptId = body.voiceReceiptId ?? "";
    const tokenHash = authorityHash(receiptId);
    const receipt = await operationalStore.loadVoiceAuthority(tokenHash);
    const purpose = body.purpose ?? "direct-care";
    const confirmed = [...(body.voiceConfirmedEntityIds ?? [])].sort();
    const original = voiceTranscriptOriginalSchema.safeParse(receipt?.original);
    const expected = extractCriticalEntities(body.prompt)
      .map((entity) => `${entity.kind}:${entity.start}:${entity.end}`)
      .sort();
    if (
      !receipt ||
      !original.success ||
      receipt.expiresAt < Date.now() ||
      receipt.actorId !== actorId ||
      receipt.patientId !== body.patientId ||
      receipt.encounterId !== context.encounterId ||
      receipt.purpose !== purpose ||
      receipt.clientContextId !== context.clientContextId ||
      receipt.sessionId !== context.sessionId ||
      receipt.threadId !== context.threadId ||
      receipt.contextRevision !== context.contextRevision ||
      JSON.stringify(confirmed) !== JSON.stringify(expected)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Sprachtranskript ist abgelaufen, verändert oder nicht an diesen Kontext gebunden.",
        403,
      );
    if (!(await operationalStore.claimVoiceAuthority(tokenHash, commandId)))
      throw new DomainError(
        "AUTH_DENIED",
        "Sprachtranskript ist bereits an eine andere Anfrage gebunden oder abgelaufen.",
        403,
      );
    return {
      provenance: createVoiceTranscriptProvenance({
        original: original.data,
        reviewedTranscript: body.prompt,
      }),
      receiptId,
      tokenHash,
    };
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
  const assistantRequestIdentity = (
    request: FastifyRequest,
    actorId: string,
    role: Parameters<OperationalStore["getOrStartSession"]>[1],
    context: AssistantContextBinding,
    body: AssistantQueryBody,
  ): AssistantRequestIdentity => {
    const commandId = request.headers["x-command-id"];
    if (typeof commandId !== "string" || !z.uuid().safeParse(commandId).success)
      throw new DomainError(
        "VALIDATION",
        "Assistenzanfragen benötigen eine stabile Befehls-ID.",
        400,
      );
    return {
      commandId,
      requestHash: createHash("sha256")
        .update(
          canonicalJson({
            actorId,
            role,
            context,
            body,
          }),
        )
        .digest("hex"),
      actorId,
      role,
      context,
    };
  };
  const startAssistantRequestLease = (
    identity: AssistantRequestIdentity,
    holderId: string,
    controller: AbortController,
  ) => {
    let stopped = false;
    let renewal = Promise.resolve();
    const timer = setInterval(() => {
      renewal = renewal
        .then(async () => {
          if (stopped) return;
          if (
            !(await operationalStore.renewAssistantRequest(identity, holderId))
          )
            controller.abort("assistant-request-lease-lost");
        })
        .catch(() =>
          controller.abort("assistant-request-lease-renewal-failed"),
        );
    }, 10_000);
    timer.unref();
    return async () => {
      stopped = true;
      clearInterval(timer);
      await renewal;
    };
  };
  const committedCommandKeys = new Set(service.commandReceiptKeys());
  const receiptActionsForAudit = (
    entries: readonly { action: string; outcome?: string }[],
  ): Action[] => {
    const actions = new Set<Action>(["patient:read"]);
    for (const entry of entries) {
      if (entry.action === "task:create") actions.add("task:create");
      else if (entry.action.startsWith("task:")) actions.add("task:update");
      else if (entry.action === "observation:draft")
        actions.add("observation:draft");
      else if (entry.action.startsWith("observation:"))
        actions.add("observation:approve");
      else if (entry.action === "note:draft") actions.add("note:draft");
      else if (entry.action.startsWith("note:")) actions.add("note:approve");
      else if (entry.action === "communication:create")
        actions.add("communication:create");
      else if (entry.action.startsWith("communication:"))
        actions.add("communication:respond");
      else if (entry.action.startsWith("intake:")) actions.add("intake:update");
      else if (entry.action.startsWith("round:")) actions.add("round:decide");
      else if (entry.action === "assistant:workflow-interrupted")
        actions.add("task:update");
      else if (
        [
          "assistant:plan-executed",
          "assistant:communication-handoff",
          "assistant:task-handoff",
        ].includes(entry.action)
      ) {
        // These entries summarize an already mapped action set or return a
        // non-executable handoff. They do not add authority by themselves.
      } else if (
        entry.outcome === "success" &&
        !["patient:read", "snapshot:read"].includes(entry.action)
      )
        throw new Error(
          `COMMAND_RECEIPT_AUDIT_ACTION_UNMAPPED:${entry.action}`,
        );
    }
    return [...actions];
  };
  const assertPatientReceiptReadable = (
    actorId: string,
    purpose: Purpose,
    patientId: string,
    encounterId: string,
  ) => {
    const snapshot = service.snapshot(actorId, purpose);
    const patient = snapshot.patients.find(
      (candidate) => candidate.id === patientId,
    );
    if (!patient || patient.encounterId !== encounterId)
      throw new DomainError(
        "AUTH_DENIED",
        "Die aktuelle Patienten- oder Fallbeziehung für diesen Beleg fehlt.",
        403,
      );
  };
  const assertAcceptedReceiptReadable = async (
    actorId: string,
    authorization: AcceptedCommandAuthorization,
  ) => {
    const actor = service.user(actorId);
    if (
      authorization.actorId !== actorId ||
      authorization.actorRole !== actor.role ||
      authorization.siteId !== siteConfiguration.siteId ||
      authorization.departmentId !== siteConfiguration.department.id
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Die aktuelle Leseberechtigung für diesen Beleg fehlt.",
        403,
      );
    if (
      !(await operationalStore.isAcceptedCommandReceiptCurrent(authorization))
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Sitzung, Gespräch oder Zielgruppe dieses Belegs ist nicht mehr aktuell freigegeben.",
        403,
      );
    assertPatientReceiptReadable(
      actorId,
      authorization.purpose,
      authorization.patientId,
      authorization.encounterId,
    );
    const patient = service
      .snapshot(actorId, authorization.purpose)
      .patients.find((candidate) => candidate.id === authorization.patientId);
    if (
      !patient ||
      authorization.actions.length === 0 ||
      authorization.actions.some(
        (action) =>
          !decide(actor, action, authorization.purpose, patient).allow,
      )
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Die aktuelle Rollen- oder Vorgangsberechtigung für diesen Beleg fehlt.",
        403,
      );
  };
  const commandReceiptAuthorization = (
    request: FastifyRequest,
    before: ServiceCheckpoint,
    result: unknown,
  ): CommandReceiptAuthorization => {
    const actorId = userId(request);
    const actor = service.user(actorId);
    const route = request.routeOptions.url;
    if (!route) throw new Error("COMMAND_RECEIPT_ROUTE_MISSING");
    const body =
      request.body && typeof request.body === "object"
        ? (request.body as Record<string, unknown>)
        : {};
    const params =
      request.params && typeof request.params === "object"
        ? (request.params as Record<string, unknown>)
        : {};
    const states = [before.state, service.checkpoint().state];
    const targetId = typeof params.id === "string" ? params.id : null;
    const routeTargets = (
      state: ServiceCheckpoint["state"],
    ): Array<{
      id: string;
      patientId: string | null;
      encounterId?: string | null;
    }> => {
      if (route === "/api/v1/tasks/:id/:transition") return state.tasks;
      if (route === "/api/v1/communications/:id/:transition")
        return state.communications;
      if (route === "/api/v1/intake/:id/review") return state.intake;
      if (route === "/api/v1/:type/:id/approve")
        return params.type === "observation"
          ? state.observations
          : params.type === "note"
            ? state.notes
            : [];
      return [];
    };
    const target = targetId
      ? states
          .flatMap(routeTargets)
          .find((candidate) => candidate.id === targetId)
      : undefined;
    const patientId =
      typeof body.patientId === "string"
        ? body.patientId
        : target && "patientId" in target
          ? target.patientId
          : null;
    const patient = patientId
      ? states
          .flatMap((state) => state.patients)
          .find((candidate) => candidate.id === patientId)
      : undefined;
    const encounterId =
      typeof body.encounterId === "string"
        ? body.encounterId
        : target && "encounterId" in target
          ? target.encounterId
          : (patient?.encounterId ?? null);
    const purpose = purposeSchema.parse(body.purpose ?? actor.defaultPurpose);
    const patientScopes = new Map<
      string,
      { patientId: string; encounterId: string }
    >();
    const addPatientScope = (
      candidatePatientId: unknown,
      candidateEncounterId: unknown,
    ) => {
      if (typeof candidatePatientId !== "string") return;
      const resolvedEncounterId =
        typeof candidateEncounterId === "string"
          ? candidateEncounterId
          : states
              .flatMap((state) => state.patients)
              .find((candidate) => candidate.id === candidatePatientId)
              ?.encounterId;
      if (resolvedEncounterId)
        patientScopes.set(`${candidatePatientId}\0${resolvedEncounterId}`, {
          patientId: candidatePatientId,
          encounterId: resolvedEncounterId,
        });
    };
    addPatientScope(patientId, encounterId);
    if (result && typeof result === "object") {
      const resultRecord = result as Record<string, unknown>;
      addPatientScope(resultRecord.patientId, resultRecord.encounterId);
      if (typeof resultRecord.activePatientId === "string") {
        const activePatient = states
          .flatMap((state) => state.patients)
          .find((candidate) => candidate.id === resultRecord.activePatientId);
        addPatientScope(activePatient?.id, activePatient?.encounterId);
      }
    }
    let workdayAuthority: CommandReceiptAuthorization["workdayAuthority"] =
      null;
    if (route === "/api/v1/workday" && result && typeof result === "object") {
      const workday = result as Record<string, unknown>;
      const handover =
        workday.handover && typeof workday.handover === "object"
          ? (workday.handover as Record<string, unknown>)
          : null;
      for (const item of Array.isArray(handover?.items)
        ? (handover.items as unknown[])
        : [])
        if (item && typeof item === "object") {
          const scoped = item as Record<string, unknown>;
          addPatientScope(scoped.patientId, scoped.encounterId);
        }
      const workdayScopedItems: unknown[] = [];
      for (const collection of [
        handover?.patientIds,
        workday.plan,
        workday.incomingTransfers,
        workday.outgoingTransfers,
      ])
        if (Array.isArray(collection))
          workdayScopedItems.push(...(collection as unknown[]));
      for (const scopedItem of workdayScopedItems) {
        if (typeof scopedItem === "string") addPatientScope(scopedItem, null);
        else if (scopedItem && typeof scopedItem === "object") {
          const scoped = scopedItem as Record<string, unknown>;
          addPatientScope(scoped.patientId, scoped.encounterId);
        }
      }
      for (const episode of Array.isArray(workday.episodes)
        ? workday.episodes
        : [])
        if (episode && typeof episode === "object") {
          const scoped = episode as Record<string, unknown>;
          addPatientScope(scoped.patientId, scoped.encounterId);
        }
      if (
        typeof workday.sessionId !== "string" ||
        typeof handover?.id !== "string" ||
        typeof handover.version !== "number" ||
        typeof handover.contentHash !== "string"
      )
        throw new Error("COMMAND_RECEIPT_WORKDAY_AUTHORITY_MISSING");
      workdayAuthority = {
        sessionId: workday.sessionId,
        handoverId: handover.id,
        handoverVersion: handover.version,
        handoverContentHash: handover.contentHash,
      };
    }
    let actions: Action[];
    if (route === "/api/v1/tasks") actions = ["task:create"];
    else if (route === "/api/v1/tasks/:id/:transition")
      actions = ["task:update"];
    else if (route === "/api/v1/observations/drafts")
      actions = ["observation:draft"];
    else if (route === "/api/v1/notes/drafts") actions = ["note:draft"];
    else if (route === "/api/v1/:type/:id/approve")
      actions = [
        params.type === "observation" ? "observation:approve" : "note:approve",
      ];
    else if (route === "/api/v1/communications")
      actions = ["communication:create"];
    else if (route === "/api/v1/communications/:id/:transition")
      actions = ["communication:respond"];
    else if (route === "/api/v1/intake/:id/review") actions = ["intake:update"];
    else if (route === "/api/v1/round-actions") actions = ["round:decide"];
    else if (route === "/api/v1/assistant/intents/:token/execute")
      actions = receiptActionsForAudit(
        service.audit.snapshot().slice(before.audit.length),
      );
    else if (route === "/api/v1/workday") actions = ["task:update"];
    else if (route === "/api/v1/assistant/conversation/clear")
      actions = ["patient:read"];
    else if (
      route.startsWith("/api/v1/admin/demo/") ||
      route.startsWith("/api/v1/simulators/") ||
      route === "/api/v1/demo/reset" ||
      route === "/api/v1/outbox/process" ||
      route === "/api/v1/outbox/:outboxId/reconcile"
    )
      actions = ["provider:operate"];
    else throw new Error(`COMMAND_RECEIPT_AUTHORIZATION_UNMAPPED:${route}`);
    return {
      actorId,
      actorRole: actor.role,
      siteId: siteConfiguration.siteId,
      departmentId: siteConfiguration.department.id,
      route,
      purpose,
      actions,
      patientId,
      encounterId,
      patientScopes: [...patientScopes.values()],
      workdayAuthority,
    };
  };
  const assertCommandReceiptReadable = async (
    request: FastifyRequest,
    receipt: CommandReceipt,
  ) => {
    const actorId = userId(request);
    const actor = service.user(actorId);
    const authorization = receipt.authorization;
    if (
      authorization.actorId !== actorId ||
      authorization.actorRole !== actor.role ||
      authorization.siteId !== siteConfiguration.siteId ||
      authorization.departmentId !== siteConfiguration.department.id ||
      authorization.route !== request.routeOptions.url ||
      authorization.actions.length === 0
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Die aktuelle Rollen- oder Vorgangsberechtigung für diesen Beleg fehlt.",
        403,
      );
    const snapshot = service.snapshot(actorId, authorization.purpose);
    if (
      authorization.actions.some(
        (action) => !decide(actor, action, authorization.purpose).allow,
      )
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Die aktuelle Rollen- oder Vorgangsberechtigung für diesen Beleg fehlt.",
        403,
      );
    const scopes =
      authorization.patientScopes.length > 0
        ? authorization.patientScopes
        : authorization.patientId && authorization.encounterId
          ? [
              {
                patientId: authorization.patientId,
                encounterId: authorization.encounterId,
              },
            ]
          : [];
    for (const scope of scopes) {
      const patient = snapshot.patients.find(
        (candidate) => candidate.id === scope.patientId,
      );
      if (!patient || patient.encounterId !== scope.encounterId)
        throw new DomainError(
          "AUTH_DENIED",
          "Die aktuelle Patienten- oder Fallbeziehung für diesen Beleg fehlt.",
          403,
        );
      if (
        authorization.actions.some(
          (action) =>
            !decide(actor, action, authorization.purpose, patient).allow,
        )
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Die aktuelle Rollen- oder Vorgangsberechtigung für diesen Beleg fehlt.",
          403,
        );
    }
    if (authorization.workdayAuthority) {
      const current = await operationalStore.getWorkday(actorId, actor.role);
      const authority = authorization.workdayAuthority;
      if (
        current.sessionId !== authority.sessionId ||
        current.handover.id !== authority.handoverId ||
        current.handover.version !== authority.handoverVersion ||
        current.handover.contentHash !== authority.handoverContentHash
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Arbeitstag- oder Übergabeautorität dieses Belegs ist nicht mehr aktuell.",
          403,
        );
    }
  };
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
        if (!request)
          throw new DomainError(
            "AUTH_DENIED",
            "Der Beleg kann ohne gebundenen Anfragekontext nicht gelesen werden.",
            403,
          );
        await assertCommandReceiptReadable(request, committed);
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
            authorization: commandReceiptAuthorization(
              request!,
              before,
              result,
            ),
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
            if (!request)
              throw new DomainError(
                "AUTH_DENIED",
                "Der Beleg kann ohne gebundenen Anfragekontext nicht gelesen werden.",
                403,
              );
            await assertCommandReceiptReadable(request, recovered);
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
    if (identity) {
      const authenticated = authenticatedIdentities.get(request);
      if (!authenticated)
        throw new DomainError("AUTH_DENIED", "Anmeldung erforderlich.", 401);
      return authenticated.actorId;
    }
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
  const assistantClientContextId = (request: FastifyRequest): string => {
    const explicit = request.headers["x-pfh-client-context"];
    if (explicit !== undefined) return z.uuid().parse(explicit);
    // Backward-compatible single-client binding for non-browser API callers.
    // The PWA always supplies an independently generated per-document UUID.
    const digest = createHash("sha256")
      .update(`implicit-assistant-context:${userId(request)}`)
      .digest("hex");
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  };
  const requireAssistantContext = async (
    request: FastifyRequest,
  ): Promise<AssistantContextBinding> => {
    const actorId = userId(request);
    const actor = service.user(actorId);
    const clientContextId = assistantClientContextId(request);
    let context = await operationalStore.resolveAssistantContext(
      actorId,
      actor.role,
      clientContextId,
    );
    if (!context && request.headers["x-pfh-client-context"] === undefined) {
      const session = await operationalStore.getOrStartSession(
        actorId,
        actor.role,
      );
      context = await operationalStore.bindAssistantContext(
        actorId,
        actor.role,
        clientContextId,
        session.patientId,
        session.encounterId,
      );
    }
    if (!context)
      throw new DomainError(
        "AUTH_DENIED",
        "Browserkontext ist ungültig oder abgelaufen. Bitte Patientenkontext erneut öffnen.",
        403,
      );
    return context;
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
  const syntheticIdpProxyBase =
    demoMode && process.env.PFH_TEST_IDP_PROXY_BASE_URL
      ? z
          .url()
          .parse(process.env.PFH_TEST_IDP_PROXY_BASE_URL)
          .replace(/\/+$/u, "")
      : null;
  if (syntheticIdpProxyBase)
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_request, body, done) => {
        done(
          null,
          Object.fromEntries(
            new URLSearchParams(
              typeof body === "string" ? body : body.toString("utf8"),
            ),
          ),
        );
      },
    );
  void app.register(fastifyMultipart, {
    limits: { files: 1, fields: 0, fileSize: 8 * 1024 * 1024 },
  });
  let drainBackgroundWorkers = () => Promise.resolve();
  {
    let shuttingDown = false;
    const configuredInterval = Number(
      process.env.PFH_ESCALATION_INTERVAL_MS ?? "5000",
    );
    const intervalMs = Number.isFinite(configuredInterval)
      ? Math.max(1000, configuredInterval)
      : 5000;
    let escalationSweep: Promise<void> | null = null;
    const escalationTimer = demoMode
      ? setInterval(() => {
          if (shuttingDown || escalationSweep) return;
          escalationSweep = (async () => {
            if (!(await operationalStore.health())) return;
            await persist(
              () => {
                const now = new Date().toISOString();
                service.runScheduledEscalations(now);
              },
              undefined,
              200,
              true,
            );
          })()
            .catch((error: unknown) => {
              app.log.error(
                {
                  errorType:
                    error instanceof Error
                      ? error.constructor.name
                      : "UnknownError",
                },
                "deterministic deadline sweep failed",
              );
            })
            .finally(() => {
              escalationSweep = null;
            });
        }, intervalMs)
      : null;
    escalationTimer?.unref();
    let providerWorkerSweep: Promise<void> | null = null;
    const configuredProviderWorkerInterval = Number(
      process.env.PFH_PROVIDER_WORKER_INTERVAL_MS ?? "2000",
    );
    const providerWorkerInterval = Number.isFinite(
      configuredProviderWorkerInterval,
    )
      ? Math.max(1000, configuredProviderWorkerInterval)
      : 2000;
    const relationalProviderWorker =
      runtime.profile !== "memory-demo"
        ? new ProviderDeliveryWorker(
            operationalStore as OperationalStore & ProviderDeliveryStore,
            service.providerRegistry,
            {
              workerId: `api-provider-${workerGeneration}`,
              profile: service.providerProfile,
              batchSize: 1,
              authorizeDelivery: (job) =>
                authorizeProviderDispatch(
                  service,
                  runtimeSitePack.packDigest,
                  job,
                ),
            },
          )
        : null;
    const clinicalProjectionWorker =
      runtime.profile !== "memory-demo"
        ? new ClinicalProjectionWorker(operationalStore, workspace, {
            workerId: `api-medplum-${workerGeneration}`,
          })
        : null;
    const providerWorkerTimer = setInterval(() => {
      if (shuttingDown || providerWorkerSweep) return;
      providerWorkerSweep = (async () => {
        if (!(await operationalStore.health())) return;
        if (relationalProviderWorker) {
          const workerResults = await Promise.allSettled([
            clinicalProjectionWorker!.runOnce(),
            relationalProviderWorker.runOnce(),
          ]);
          const failure = workerResults.find(
            (result): result is PromiseRejectedResult =>
              result.status === "rejected",
          );
          if (failure)
            throw failure.reason instanceof Error
              ? failure.reason
              : new Error("DELIVERY_WORKER_FAILED");
        } else if (service.hasPendingProviderWork())
          await persist(
            () => service.flushOutbox("u-it"),
            undefined,
            200,
            true,
          );
      })()
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
          providerWorkerSweep = null;
        });
    }, providerWorkerInterval);
    providerWorkerTimer.unref();
    drainBackgroundWorkers = async () => {
      shuttingDown = true;
      if (escalationTimer) clearInterval(escalationTimer);
      clearInterval(providerWorkerTimer);
      const activeSweeps = [escalationSweep, providerWorkerSweep].filter(
        (sweep): sweep is Promise<void> => sweep !== null,
      );
      if (activeSweeps.length === 0) return;
      const configuredGrace = Number(
        process.env.PFH_WORKER_SHUTDOWN_GRACE_MS ?? "30000",
      );
      const graceMs = Number.isFinite(configuredGrace)
        ? Math.min(60_000, Math.max(1_000, configuredGrace))
        : 30_000;
      let graceExpired = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([
        Promise.allSettled(activeSweeps),
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            graceExpired = true;
            resolve();
          }, graceMs);
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (graceExpired)
        app.log.warn(
          { graceMs },
          "delivery worker shutdown grace expired; recovery must reconcile the durable receipt state",
        );
    };
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

  app.addHook("preHandler", async (request) => {
    if (!identity) return;
    const route = request.routeOptions.url;
    // The immutable PWA shell and synthetic IdP proxy are public bootstrap
    // surfaces. Patient/workflow data remains exclusively below /api/v1/.
    if (!request.url.startsWith("/api/v1/")) return;
    if (
      route === "/health" ||
      route === "/ready" ||
      route === "/api/v1/build-info" ||
      route === "/api/v1/auth/login" ||
      route === "/api/v1/auth/callback" ||
      route === "/api/v1/auth/logout/callback"
    )
      return;
    await ensureIdentityReady();
    const authenticated = await identity.authenticate(request.headers.cookie);
    if (!authenticated)
      throw new DomainError("AUTH_DENIED", "Anmeldung erforderlich.", 401);
    if (authenticated.organizationId !== siteConfiguration.institutionId)
      throw new DomainError(
        "AUTH_DENIED",
        "Die Anmeldung gehört nicht zu dieser Institution.",
        403,
      );
    try {
      service.user(authenticated.actorId);
      identity.assertRequestIntegrity({
        identity: authenticated,
        method: request.method,
        origin:
          typeof request.headers.origin === "string"
            ? request.headers.origin
            : undefined,
        csrfHeader:
          typeof request.headers["x-csrf-token"] === "string"
            ? request.headers["x-csrf-token"]
            : undefined,
      });
    } catch {
      throw new DomainError(
        "AUTH_DENIED",
        "Anmeldung oder Anfrageschutz ist ungültig.",
        403,
      );
    }
    authenticatedIdentities.set(request, authenticated);
  });

  app.addHook("preHandler", async (request, reply) => {
    const route = request.routeOptions.url;
    if (request.method !== "POST" || !route?.startsWith("/api/v1/")) return;
    if (
      route.startsWith("/api/v1/auth/") ||
      route === "/api/v1/assistant/transcribe" ||
      route === "/api/v1/assistant/query" ||
      route === "/api/v1/analytics/organizational-value/report"
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
    // v2 receipts deliberately do not alias the unsafe legacy key format.
    // Every mutation binds its concrete target path as well as tenant/site,
    // actor, operation and normalized content. A UUID replay against another
    // target must conflict instead of returning the first target's receipt.
    const key = `${siteConfiguration.institutionId}:${siteConfiguration.siteId}:${actorId}:v2:${request.method}:${route}:${commandId}`;
    const requestHashInput = canonicalJson({
      organizationId: siteConfiguration.institutionId,
      siteId: siteConfiguration.siteId,
      actorId,
      method: request.method,
      route,
      path: request.url.split("?", 1)[0],
      body: request.body ?? null,
      ...(route === "/api/v1/workspace/attachments"
        ? { contentHash: request.headers["x-content-sha256"] ?? null }
        : {}),
    });
    const requestHash = createHash("sha256")
      .update(requestHashInput)
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
    if (route === "/api/v1/assistant/intents/:token/execute") {
      const accepted = await operationalStore.loadAcceptedCommandReceipt(
        key,
        requestHash,
      );
      if (accepted) {
        await assertAcceptedReceiptReadable(actorId, accepted.authorization);
        return reply.code(accepted.statusCode).send(accepted.payload);
      }
      if (cached) {
        await assertCommandReceiptReadable(request, cached);
        return reply
          .code(cached.statusCode)
          .type("application/json; charset=utf-8")
          .send(cached.payload);
      }
    }
    requestCommandKeys.set(request, { key, requestHash });
  });

  app.get("/health", () => ({
    status: "ok",
    service: "pflegehelfer-api",
    time: new Date().toISOString(),
  }));
  if (syntheticIdpProxyBase) {
    const proxySyntheticIdp = async (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const incoming = new URL(request.url, "http://pflegehelfer.invalid");
      const relative = incoming.pathname.replace(/^\/synthetic-idp/u, "");
      if (
        ![
          "/.well-known/openid-configuration",
          "/authorize",
          "/token",
          "/jwks",
          "/logout",
        ].includes(relative)
      )
        return reply.code(404).send({ error: "NOT_FOUND" });
      const target = new URL(`${syntheticIdpProxyBase}${relative}`);
      target.search = incoming.search;
      const upstream = await fetch(target, {
        method: request.method,
        ...(request.method === "POST"
          ? {
              headers: { "content-type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams(request.body as Record<string, string>),
            }
          : {}),
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      const location = upstream.headers.get("location");
      if (location) void reply.header("location", location);
      void reply
        .code(upstream.status)
        .type(
          upstream.headers.get("content-type") ?? "application/octet-stream",
        );
      return reply.send(Buffer.from(await upstream.arrayBuffer()));
    };
    app.route({
      method: ["GET", "POST"],
      url: "/synthetic-idp/*",
      handler: proxySyntheticIdp,
    });
  }
  app.get("/api/v1/build-info", () => runtimeBuildInfo());
  app.get("/api/v1/auth/login", async (request, reply) => {
    if (!identity)
      throw new DomainError(
        "AUTH_DENIED",
        "OIDC-Anmeldung ist nicht konfiguriert.",
        503,
      );
    await ensureIdentityReady();
    const query = z
      .object({ returnTo: z.string().max(500).optional() })
      .strict()
      .parse(request.query);
    const result = await identity.beginLogin(query.returnTo);
    return reply
      .header("set-cookie", result.cookies)
      .redirect(result.redirectTo, 302);
  });
  app.get("/api/v1/auth/callback", async (request, reply) => {
    if (!identity)
      throw new DomainError(
        "AUTH_DENIED",
        "OIDC-Anmeldung ist nicht konfiguriert.",
        503,
      );
    await ensureIdentityReady();
    const query = z
      .object({
        code: z.string().min(1).max(4_000),
        state: z.string().min(32).max(240),
      })
      .strict()
      .parse(request.query);
    const result = await identity.completeLogin(
      query.code,
      query.state,
      request.headers.cookie,
    );
    return reply
      .header("set-cookie", result.cookies)
      .redirect(result.redirectTo, 303);
  });
  app.get("/api/v1/auth/session", (request) => {
    const actor = service.user(userId(request));
    return { authenticated: true, actorId: actor.id, role: actor.role };
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    if (!identity) return reply.code(204).send();
    const result = await identity.logout(request.headers.cookie);
    return reply
      .header("set-cookie", result.cookies)
      .header("cache-control", "no-store")
      .send({
        localLogout: true,
        federatedLogout: result.mode === "federated-redirect",
        redirectTo: result.redirectTo,
      });
  });
  app.get("/api/v1/auth/logout/callback", async (request, reply) => {
    if (!identity)
      return reply.header("cache-control", "no-store").redirect("/", 303);
    const { state } = z
      .object({ state: z.string().min(32).max(240) })
      .strict()
      .parse(request.query);
    try {
      const result = await identity.completeLogout(
        state,
        request.headers.cookie,
      );
      return reply
        .header("set-cookie", result.cookies)
        .header("cache-control", "no-store")
        .redirect(result.redirectTo, 303);
    } catch {
      throw new DomainError(
        "AUTH_DENIED",
        "Abmeldebestätigung ist ungültig oder abgelaufen.",
        400,
      );
    }
  });
  type WorkspaceReadinessStatus = Awaited<ReturnType<typeof workspace.status>>;
  type ProviderReadinessStatus = Awaited<
    ReturnType<typeof service.providerRegistry.status>
  >;
  let workspaceProviderReadinessProbe: Promise<
    [WorkspaceReadinessStatus, ProviderReadinessStatus]
  > | null = null;
  const probeWorkspaceAndProviders = () => {
    workspaceProviderReadinessProbe ??= Promise.all([
      workspace.status(),
      service.providerRegistry.status(service.providerProfile),
    ]).finally(() => {
      workspaceProviderReadinessProbe = null;
    });
    return workspaceProviderReadinessProbe;
  };
  app.get("/ready", async (_request, reply) => {
    const auditValid = service.audit.verify();
    const readinessDeadline = new Error("READINESS_DEADLINE_EXCEEDED");
    const configuredDeadline = Number(
      process.env.PFH_READINESS_DEADLINE_MS ?? "5000",
    );
    const deadlineAt =
      Date.now() +
      (Number.isFinite(configuredDeadline)
        ? Math.min(15_000, Math.max(1_000, configuredDeadline))
        : 5_000);
    const bounded = async <T>(operation: Promise<T>): Promise<T> => {
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) throw readinessDeadline;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let result: { kind: "value"; value: T } | { kind: "deadline" };
      try {
        result = await Promise.race([
          operation.then((value) => ({ kind: "value" as const, value })),
          new Promise<{ kind: "deadline" }>((resolve) => {
            timer = setTimeout(
              () => resolve({ kind: "deadline" }),
              remainingMs,
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      if (result.kind === "deadline") throw readinessDeadline;
      return result.value;
    };
    try {
      const [operationalReady, commercialStoreReady, scenarioStoreReady] =
        await bounded(
          Promise.all([
            operationalStore.health(),
            commercialStore.health(),
            scenarioStore.health(),
          ]),
        );
      if (!operationalReady)
        return reply.code(503).send({
          status: "not-ready",
          reason: "operational-store-unavailable",
          auditValid,
        });
      if (!commercialStoreReady || !scenarioStoreReady)
        return reply.code(503).send({
          status: "not-ready",
          reason: "supporting-store-unavailable",
          auditValid,
        });
      let identityReady = true;
      try {
        await bounded(ensureIdentityReady());
        identityReady = identity ? await bounded(identity.health()) : true;
      } catch (error) {
        if (error === readinessDeadline) throw error;
        identityReady = false;
      }
      if (!identityReady)
        return reply.code(503).send({
          status: "not-ready",
          reason: "identity-store-unavailable",
          auditValid,
        });
      try {
        await bounded(
          Promise.all([
            persistenceQueue,
            assistantAuditQueue,
            ensureCommercialReady(),
            ensureScenarioReady(),
          ]),
        );
      } catch (error) {
        if (error === readinessDeadline) throw error;
        return reply.code(503).send({
          status: "not-ready",
          reason: "runtime-initialization-unavailable",
          auditValid,
        });
      }
      const [workspaceStatus, providers] = await bounded(
        probeWorkspaceAndProviders(),
      );
      const actualProfileMatches =
        workspace.mode === runtime.storageMode &&
        operationalStore.mode === runtime.persistenceMode;
      if (!actualProfileMatches)
        return reply.code(503).send({
          status: "not-ready",
          reason: "runtime-profile-mismatch",
          profile: runtime.profile,
        });
      if (!demoMode && !identity)
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
    } catch (error) {
      if (error !== readinessDeadline) throw error;
      return reply.code(503).send({
        status: "not-ready",
        reason: "readiness-deadline-exceeded",
        auditValid,
      });
    }
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
      build: runtimeBuildInfo(),
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
        documents: documentInspection.status(),
      },
    };
  });

  app.post("/api/v1/analytics/organizational-value/report", (request) => {
    const actor = service.user(userId(request));
    const authorization = decide(
      actor,
      "analytics:aggregate",
      actor.defaultPurpose,
    );
    if (!authorization.allow)
      throw new DomainError(
        "AUTH_DENIED",
        "Der Organisationswert-Bericht ist für diese Rolle nicht freigegeben.",
        403,
      );
    const input = organizationalValueInputSchema.parse(request.body);
    if (
      input.definition.organizationId !== siteConfiguration.institutionId ||
      input.definition.wardId !== siteConfiguration.department.id
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Die Auswertung gehört nicht zur aktiven Institution und Abteilung.",
        403,
      );
    return buildOrganizationalValueReport(input);
  });

  const requireOrganizationEconomicsRole = (
    request: FastifyRequest,
    writable = false,
  ) => {
    const actor = service.user(userId(request));
    const allowed = writable
      ? ["management", "it"]
      : ["management", "it", "quality-safety"];
    if (!allowed.includes(actor.role))
      throw new DomainError(
        "AUTH_DENIED",
        "Organisationsvertrag und Nutzungskosten sind für diese Rolle nicht freigegeben.",
        403,
      );
    return actor;
  };

  app.get("/api/v1/admin/organization-economics", async (request) => {
    requireOrganizationEconomicsRole(request);
    await ensureCommercialReady();
    const query = z
      .object({ period: organizationStatementPeriodSchema.optional() })
      .strict()
      .parse(request.query);
    const period = query.period ?? new Date().toISOString().slice(0, 7);
    const configuration = await commercialStore.getConfiguration(
      siteConfiguration.institutionId,
    );
    const receipts = await commercialStore.listUsage(
      siteConfiguration.institutionId,
      period,
    );
    return {
      configuration,
      statement: buildOrganizationStatement(configuration, receipts, period),
    };
  });

  app.get(
    "/api/v1/admin/organization-economics/statement.csv",
    async (request, reply) => {
      requireOrganizationEconomicsRole(request);
      await ensureCommercialReady();
      const query = z
        .object({ period: organizationStatementPeriodSchema.optional() })
        .strict()
        .parse(request.query);
      const period = query.period ?? new Date().toISOString().slice(0, 7);
      const configuration = await commercialStore.getConfiguration(
        siteConfiguration.institutionId,
      );
      const receipts = await commercialStore.listUsage(
        siteConfiguration.institutionId,
        period,
      );
      const statement = buildOrganizationStatement(
        configuration,
        receipts,
        period,
      );
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header(
          "content-disposition",
          `attachment; filename="pflegehelfer-organization-statement-${period}.csv"`,
        )
        .send(organizationStatementCsv(statement));
    },
  );

  app.post(
    "/api/v1/admin/organization-economics/configuration",
    async (request) => {
      requireOrganizationEconomicsRole(request, true);
      await ensureCommercialReady();
      const body = z
        .object({
          expectedVersion: z.number().int().positive(),
          configuration: organizationCommercialConfigSchema,
        })
        .strict()
        .parse(request.body);
      if (body.configuration.organizationId !== siteConfiguration.institutionId)
        throw new DomainError(
          "AUTH_DENIED",
          "Die Vertragskonfiguration gehört nicht zur aktiven Institution.",
          403,
        );
      try {
        return await commercialStore.updateConfiguration(
          body.configuration,
          body.expectedVersion,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "COMMERCIAL_CONFIGURATION_VERSION_CONFLICT"
        )
          throw new DomainError(
            "VERSION_CONFLICT",
            "Die Organisationskonfiguration wurde zwischenzeitlich geändert.",
            409,
          );
        throw error;
      }
    },
  );

  app.post(
    "/api/v1/admin/organization-economics/usage-receipts",
    async (request, reply) => {
      const actor = requireOrganizationEconomicsRole(request, true);
      if (actor.role !== "it")
        throw new DomainError(
          "AUTH_DENIED",
          "Nur IT darf Provider-Nutzungsbelege importieren.",
          403,
        );
      await ensureCommercialReady();
      const receipt = organizationUsageReceiptSchema.parse(request.body);
      if (receipt.organizationId !== siteConfiguration.institutionId)
        throw new DomainError(
          "AUTH_DENIED",
          "Der Nutzungsbeleg gehört nicht zur aktiven Institution.",
          403,
        );
      const inserted = await commercialStore.recordUsage(receipt);
      return reply.code(inserted ? 201 : 200).send({ inserted, receipt });
    },
  );

  app.get(
    "/api/v1/operations/clinical-projections/manual-head",
    async (request) => {
      await persistenceQueue;
      const actor = service.user(userId(request));
      if (actor.role !== "it")
        throw new DomainError(
          "AUTH_DENIED",
          "Nur IT darf manuelle klinische Projektionen einsehen.",
          403,
        );
      return { hold: await operationalStore.manualClinicalProjectionHead() };
    },
  );

  app.post(
    "/api/v1/operations/clinical-projections/:jobId/retry",
    async (request) => {
      const actor = service.user(userId(request));
      if (actor.role !== "it")
        throw new DomainError(
          "AUTH_DENIED",
          "Nur IT darf eine klinische Projektion erneut einreihen.",
          403,
        );
      const { jobId } = z
        .object({ jobId: z.uuid() })
        .strict()
        .parse(request.params);
      const { expectedErrorCode } = clinicalProjectionRetryBody.parse(
        request.body,
      );
      const command = requestCommandKeys.get(request);
      if (!command)
        throw new DomainError(
          "INVALID_STATE",
          "Für die Betriebsfreigabe fehlt die Befehlsbindung.",
          409,
        );
      const pending = persistenceQueue.then(async () => {
        const auditLength = service.audit.length;
        const auditEntry = service.audit.append({
          actor,
          action: "clinical-projection:retry",
          patientId: null,
          purpose: "operations",
          outcome: "success",
          detail: { jobId, errorCode: expectedErrorCode },
        });
        try {
          const receipt =
            await operationalStore.recoverManualClinicalProjection({
              actorId: actor.id,
              actorRole: actor.role,
              jobId,
              expectedErrorCode,
              commandKey: command.key,
              requestHash: command.requestHash,
              auditEntry,
            });
          if (receipt.replayed) service.audit.truncate(auditLength);
          publishInvalidation();
          return { ...receipt, replayed: false };
        } catch (error) {
          service.audit.truncate(auditLength);
          throw error;
        }
      });
      persistenceQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  );

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

  const workspaceAccess = (request: FastifyRequest) => {
    const actor = service.user(userId(request));
    const snapshot = service.snapshot(actor.id, actor.defaultPurpose);
    return { actor, snapshot };
  };
  const workspaceCommand = (request: FastifyRequest) => {
    const command = requestCommandKeys.get(request);
    if (!command)
      throw new DomainError(
        "INVALID_STATE",
        "Für diese Änderung fehlt die Befehlsbindung.",
        409,
      );
    return { commandKey: command.key, requestHash: command.requestHash };
  };
  const requireWorkspacePatient = (
    snapshot: ReturnType<PflegehelferService["snapshot"]>,
    patientId: string,
  ) => {
    const patient = snapshot.patients.find((item) => item.id === patientId);
    if (!patient)
      throw new DomainError(
        "AUTH_DENIED",
        "Dieser Patientenkontext ist nicht freigegeben.",
        403,
      );
    return patient;
  };
  const patientTeamMemberIds = (
    patientId: string,
    users: ReturnType<PflegehelferService["snapshot"]>["users"],
  ) =>
    users
      .filter((candidate) => {
        try {
          return service
            .snapshot(candidate.id, candidate.defaultPurpose)
            .patients.some((patient) => patient.id === patientId);
        } catch {
          return false;
        }
      })
      .map((candidate) => candidate.id);
  const validateTopicIds = (topicIds: readonly string[]) => {
    const governed = new Set(
      siteConfiguration.governedTopics.map((topic) => topic.id),
    );
    if (topicIds.some((topicId) => !governed.has(topicId)))
      throw new DomainError(
        "VALIDATION",
        "Mindestens ein Thema ist nicht freigegeben.",
        400,
      );
  };
  const invalidateWorkspace = async (
    actorIds: readonly string[],
    payload: Record<string, unknown>,
  ) => {
    await Promise.all(
      [...new Set(actorIds)].map((actorId) =>
        operationalStore.appendUiInvalidation(actorId, payload),
      ),
    );
    publishInvalidation();
  };

  app.get("/api/v1/status", async (request) => {
    const { actor, snapshot } = workspaceAccess(request);
    const session = await operationalStore.getOrStartSession(
      actor.id,
      actor.role,
    );
    const [postgresqlReady, medplum, model, providers, delivery] =
      await Promise.all([
        operationalStore.health(),
        workspace.status(),
        models.status(),
        service.providerRegistry.status(service.providerProfile),
        operationalStore.deliveryDiagnostics(),
      ]);
    return {
      capturedAt: new Date().toISOString(),
      api: { reachable: true, authenticated: true },
      session: {
        state: session.status,
        actorId: actor.id,
        role: actor.role,
        startedAt: session.startedAt,
        expiresAt: new Date(
          new Date(session.startedAt).getTime() +
            siteConfiguration.sessionTtlHours * 60 * 60_000,
        ).toISOString(),
      },
      stores: { postgresql: { ready: postgresqlReady }, medplum },
      ai: { model, asr: asr.status(), tts: tts.status() },
      delivery,
      providers: providers.map((provider) => ({
        provider: provider.provider,
        profile: provider.profile,
        operationalStatus: provider.operationalStatus,
        health: provider.health?.status ?? null,
      })),
      visibleProviderHealth: snapshot.providerHealth,
    };
  });

  app.get("/api/v1/workspace/comments", async (request) => {
    const { actor, snapshot } = workspaceAccess(request);
    const query = z
      .object({
        patientId: z.string().min(1).max(120).optional(),
        topicId: z.string().min(1).max(120).optional(),
        scope: z.enum(["all", "direct"]).default("all"),
      })
      .strict()
      .parse(request.query);
    if (query.patientId) requireWorkspacePatient(snapshot, query.patientId);
    if (query.topicId) validateTopicIds([query.topicId]);
    const comments = await operationalStore.listWorkspaceComments({
      actorId: actor.id,
      visiblePatientIds: snapshot.patients.map((patient) => patient.id),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.scope === "direct" ? { patientId: null } : {}),
      ...(query.topicId ? { topicId: query.topicId } : {}),
    });
    return { comments };
  });

  app.get("/api/v1/workspace/team-members", (request) => {
    const { snapshot } = workspaceAccess(request);
    const query = z
      .object({ patientId: z.string().min(1).max(120) })
      .strict()
      .parse(request.query);
    requireWorkspacePatient(snapshot, query.patientId);
    const memberIds = new Set(
      patientTeamMemberIds(query.patientId, snapshot.users),
    );
    return {
      members: snapshot.users
        .filter((candidate) => memberIds.has(candidate.id))
        .map((candidate) => ({
          id: candidate.id,
          displayName: candidate.displayName,
          role: candidate.role,
        })),
    };
  });

  app.post("/api/v1/workspace/comments", async (request, reply) => {
    const { actor, snapshot } = workspaceAccess(request);
    const command = workspaceCommand(request);
    const body = z
      .object({
        patientId: z.string().min(1).max(120).nullable(),
        audienceKind: z.enum(["patient-team", "direct"]),
        body: z.string().trim().min(1).max(2000),
        recipientIds: z.array(z.string().min(1).max(120)).max(12).default([]),
        recipientRoleIds: z.array(roleSchema).max(12).default([]),
        topicIds: z.array(z.string().min(1).max(120)).max(12).default([]),
        parentId: z.uuid().nullable().default(null),
      })
      .strict()
      .parse(request.body);
    validateTopicIds(body.topicIds);
    let audience: WorkspaceAudience;
    if (body.audienceKind === "patient-team") {
      if (!body.patientId)
        throw new DomainError(
          "VALIDATION",
          "Ein Behandlungsteam-Kommentar benötigt einen Patientenkontext.",
          400,
        );
      requireWorkspacePatient(snapshot, body.patientId);
      const memberIds = patientTeamMemberIds(body.patientId, snapshot.users);
      if (
        body.recipientIds.some(
          (recipientId) => !memberIds.includes(recipientId),
        )
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Mindestens eine erwähnte Person hat keinen Zugriff auf diesen Kontext.",
          403,
        );
      const memberRoles = new Set(
        snapshot.users
          .filter((candidate) => memberIds.includes(candidate.id))
          .map((candidate) => candidate.role),
      );
      if (
        body.recipientRoleIds.some(
          (recipientRole) => !memberRoles.has(recipientRole),
        )
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Mindestens eine erwähnte Rolle gehört nicht zum freigegebenen Behandlungsteam.",
          403,
        );
      audience = workspaceAudienceSchema.parse({
        kind: "patient-team",
        memberIds,
      });
    } else {
      if (body.patientId !== null || body.recipientIds.length !== 1)
        throw new DomainError(
          "VALIDATION",
          "Eine Direktnachricht benötigt genau eine ausgewählte Person und keinen Patientenkontext.",
          400,
        );
      const recipient = snapshot.users.find(
        (candidate) => candidate.id === body.recipientIds[0],
      );
      if (!recipient || recipient.id === actor.id)
        throw new DomainError(
          "AUTH_DENIED",
          "Diese Person ist für eine Direktnachricht nicht auswählbar.",
          403,
        );
      audience = workspaceAudienceSchema.parse({
        kind: "direct",
        memberIds: [actor.id, recipient.id],
      });
    }
    const createdAt = new Date().toISOString();
    const record: WorkspaceComment = {
      id: randomUUID(),
      patientId: body.patientId,
      authorId: actor.id,
      body: body.body,
      audience,
      recipientIds: body.recipientIds,
      recipientRoleIds: body.recipientRoleIds,
      topicIds: body.topicIds,
      parentId: body.parentId,
      createdAt,
      unread: false,
    };
    const result = await operationalStore.createWorkspaceComment({
      record,
      ...command,
    });
    await invalidateWorkspace(audience.memberIds, {
      kind: "workspace-comment",
      commentId: result.value.id,
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.post("/api/v1/workspace/comments/:commentId/read", async (request) => {
    const { actor, snapshot } = workspaceAccess(request);
    const { commentId } = z
      .object({ commentId: z.uuid() })
      .strict()
      .parse(request.params);
    const visible = await operationalStore.listWorkspaceComments({
      actorId: actor.id,
      visiblePatientIds: snapshot.patients.map((patient) => patient.id),
    });
    if (!visible.some((comment) => comment.id === commentId))
      throw new DomainError("NOT_FOUND", "Kommentar nicht gefunden.", 404);
    await operationalStore.markWorkspaceCommentRead(actor.id, commentId);
    return { commentId, read: true };
  });

  app.get("/api/v1/workspace/attachments", async (request) => {
    const { actor, snapshot } = workspaceAccess(request);
    const query = z
      .object({
        patientId: z.string().min(1).max(120).optional(),
        topicId: z.string().min(1).max(120).optional(),
      })
      .strict()
      .parse(request.query);
    if (query.patientId) requireWorkspacePatient(snapshot, query.patientId);
    if (query.topicId) validateTopicIds([query.topicId]);
    const attachments = await operationalStore.listWorkspaceAttachments({
      actorId: actor.id,
      visiblePatientIds: snapshot.patients.map((patient) => patient.id),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.topicId ? { topicId: query.topicId } : {}),
    });
    return { attachments };
  });

  app.post("/api/v1/workspace/attachments", async (request, reply) => {
    const { actor, snapshot } = workspaceAccess(request);
    const command = workspaceCommand(request);
    const query = z
      .object({
        patientId: z.string().min(1).max(120).optional(),
        audienceKind: z.enum(["private", "patient-team"]).default("private"),
        topicIds: z.string().max(500).optional(),
      })
      .strict()
      .parse(request.query);
    const topicIds = query.topicIds
      ? query.topicIds.split(",").filter(Boolean)
      : [];
    validateTopicIds(topicIds);
    if (query.patientId) requireWorkspacePatient(snapshot, query.patientId);
    if (query.audienceKind === "patient-team" && !query.patientId)
      throw new DomainError(
        "VALIDATION",
        "Eine Teamdatei benötigt einen Patientenkontext.",
        400,
      );
    const file = await request.file();
    if (!file)
      throw new DomainError("VALIDATION", "Keine Datei ausgewählt.", 400);
    const bytes = await file.toBuffer();
    try {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      if (request.headers["x-content-sha256"] !== sha256)
        throw new DomainError(
          "VALIDATION",
          "Dateiinhalt stimmt nicht mit der gebundenen Prüfsumme überein.",
          400,
        );
      const signatureMatches =
        (file.mimetype === "application/pdf" &&
          bytes.subarray(0, 5).toString("ascii") === "%PDF-") ||
        (file.mimetype === "image/png" &&
          bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
        (file.mimetype === "image/jpeg" &&
          bytes[0] === 0xff &&
          bytes[1] === 0xd8 &&
          bytes[2] === 0xff) ||
        (file.mimetype === "text/plain" && !bytes.includes(0));
      if (!signatureMatches)
        throw new DomainError(
          "VALIDATION",
          "Dateityp und Inhaltssignatur stimmen nicht überein.",
          400,
        );
      const mediaType = z
        .enum(["application/pdf", "image/png", "image/jpeg", "text/plain"])
        .parse(file.mimetype);
      const memberIds =
        query.audienceKind === "patient-team"
          ? patientTeamMemberIds(query.patientId!, snapshot.users)
          : [actor.id];
      const audience = workspaceAudienceSchema.parse({
        kind: query.audienceKind,
        memberIds,
      });
      const safeName =
        file.filename.split(/[\\/]/).at(-1)?.slice(0, 180) || "Datei";
      const inspection = await documentInspection.inspect({
        bytes,
        fileName: safeName,
        mediaType,
        expectedSha256: sha256,
      });
      const record: WorkspaceAttachment = {
        id: randomUUID(),
        patientId: query.patientId ?? null,
        uploadedBy: actor.id,
        fileName: safeName,
        mediaType,
        size: bytes.byteLength,
        sha256,
        audience,
        topicIds,
        state: inspection.state === "available" ? "available" : "quarantined",
        createdAt: new Date().toISOString(),
        withdrawnAt: null,
        inspection,
      };
      const result = await operationalStore.storeWorkspaceAttachment({
        record,
        bytes,
        ...command,
      });
      await invalidateWorkspace(memberIds, {
        kind: "workspace-attachment",
        attachmentId: result.value.id,
      });
      return reply.code(result.replayed ? 200 : 201).send(result);
    } finally {
      bytes.fill(0);
    }
  });

  app.get(
    "/api/v1/workspace/attachments/:attachmentId/content",
    async (request, reply) => {
      const { actor, snapshot } = workspaceAccess(request);
      const { attachmentId } = z
        .object({ attachmentId: z.uuid() })
        .strict()
        .parse(request.params);
      const content = await operationalStore.loadWorkspaceAttachment(
        actor.id,
        attachmentId,
        snapshot.patients.map((patient) => patient.id),
      );
      if (!content || content.record.state !== "available")
        throw new DomainError("NOT_FOUND", "Datei nicht gefunden.", 404);
      return reply
        .header("content-type", content.record.mediaType)
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff")
        .header(
          "content-disposition",
          `inline; filename*=UTF-8''${encodeURIComponent(content.record.fileName)}`,
        )
        .send(Buffer.from(content.bytes));
    },
  );

  app.post(
    "/api/v1/workspace/attachments/:attachmentId/withdraw",
    async (request) => {
      const { actor, snapshot } = workspaceAccess(request);
      const command = workspaceCommand(request);
      const { attachmentId } = z
        .object({ attachmentId: z.uuid() })
        .strict()
        .parse(request.params);
      const visible = await operationalStore.loadWorkspaceAttachment(
        actor.id,
        attachmentId,
        snapshot.patients.map((patient) => patient.id),
      );
      if (!visible)
        throw new DomainError("NOT_FOUND", "Datei nicht gefunden.", 404);
      const result = await operationalStore.withdrawWorkspaceAttachment({
        actorId: actor.id,
        attachmentId,
        ...command,
      });
      await invalidateWorkspace(result.value.audience.memberIds, {
        kind: "workspace-attachment-withdrawn",
        attachmentId,
      });
      return result;
    },
  );

  app.get("/api/v1/workspace/projects", async (request) => {
    const { actor, snapshot } = workspaceAccess(request);
    const projects = await operationalStore.listWorkspaceProjects(actor.id);
    const allowedTaskIds = new Set(snapshot.tasks.map((task) => task.id));
    const comments = await operationalStore.listWorkspaceComments({
      actorId: actor.id,
      visiblePatientIds: snapshot.patients.map((patient) => patient.id),
    });
    const allowedCommentIds = new Set(comments.map((comment) => comment.id));
    const attachments = await operationalStore.listWorkspaceAttachments({
      actorId: actor.id,
      visiblePatientIds: snapshot.patients.map((patient) => patient.id),
    });
    const allowedAttachmentIds = new Set(
      attachments
        .filter((attachment) => attachment.state === "available")
        .map((attachment) => attachment.id),
    );
    return {
      projects: projects.map((project) => ({
        ...project,
        links: project.links.filter((link) =>
          link.kind === "task"
            ? allowedTaskIds.has(link.id)
            : link.kind === "comment"
              ? allowedCommentIds.has(link.id)
              : allowedAttachmentIds.has(link.id),
        ),
      })),
    };
  });

  app.post("/api/v1/workspace/projects", async (request, reply) => {
    const { actor, snapshot } = workspaceAccess(request);
    const command = workspaceCommand(request);
    const body = z
      .object({
        title: z.string().trim().min(3).max(160),
        purpose: z.string().trim().min(3).max(500),
        memberIds: z.array(z.string().min(1).max(120)).max(40),
      })
      .strict()
      .parse(request.body);
    const directoryIds = new Set(snapshot.users.map((user) => user.id));
    if (body.memberIds.some((memberId) => !directoryIds.has(memberId)))
      throw new DomainError(
        "AUTH_DENIED",
        "Mindestens ein Projektmitglied ist nicht freigegeben.",
        403,
      );
    const memberIds = [...new Set([actor.id, ...body.memberIds])];
    const now = new Date().toISOString();
    const record: WorkspaceProject = {
      id: randomUUID(),
      title: body.title,
      purpose: body.purpose,
      ownerId: actor.id,
      memberIds,
      status: "active",
      links: [],
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const result = await operationalStore.createWorkspaceProject({
      record,
      ...command,
    });
    await invalidateWorkspace(memberIds, {
      kind: "workspace-project",
      projectId: record.id,
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.post("/api/v1/workspace/projects/:projectId/links", async (request) => {
    const { actor, snapshot } = workspaceAccess(request);
    const command = workspaceCommand(request);
    const { projectId } = z
      .object({ projectId: z.uuid() })
      .strict()
      .parse(request.params);
    const body = z
      .object({
        expectedVersion: z.number().int().positive(),
        link: workspaceProjectLinkSchema,
      })
      .strict()
      .parse(request.body);
    let linkAllowed = false;
    if (body.link.kind === "task")
      linkAllowed = snapshot.tasks.some((task) => task.id === body.link.id);
    if (body.link.kind === "comment")
      linkAllowed = (
        await operationalStore.listWorkspaceComments({
          actorId: actor.id,
          visiblePatientIds: snapshot.patients.map((patient) => patient.id),
        })
      ).some((comment) => comment.id === body.link.id);
    if (body.link.kind === "attachment")
      linkAllowed = Boolean(
        await operationalStore.loadWorkspaceAttachment(
          actor.id,
          body.link.id,
          snapshot.patients.map((patient) => patient.id),
        ),
      );
    if (!linkAllowed)
      throw new DomainError(
        "AUTH_DENIED",
        "Der verknüpfte Datensatz ist nicht freigegeben.",
        403,
      );
    const result = await operationalStore.linkWorkspaceProject({
      actorId: actor.id,
      projectId,
      expectedVersion: body.expectedVersion,
      link: body.link,
      ...command,
    });
    await invalidateWorkspace(result.value.memberIds, {
      kind: "workspace-project-linked",
      projectId,
    });
    return result;
  });

  app.get("/api/v1/workspace/profile", async (request) => {
    const { snapshot } = workspaceAccess(request);
    const query = z
      .object({ patientId: z.string().min(1).max(120) })
      .strict()
      .parse(request.query);
    requireWorkspacePatient(snapshot, query.patientId);
    const fields = await operationalStore.listWorkspaceProfileFields([
      query.patientId,
    ]);
    return { fields };
  });

  app.post("/api/v1/workspace/profile/prepare", async (request, reply) => {
    const { actor, snapshot } = workspaceAccess(request);
    if (!["registered-nurse", "administration"].includes(actor.role))
      throw new DomainError(
        "AUTH_DENIED",
        "Profiländerungen sind für diese Rolle nicht freigegeben.",
        403,
      );
    const command = workspaceCommand(request);
    const body = z
      .object({
        patientId: z.string().min(1).max(120),
        fieldKey: workspaceProfileFieldSchema.shape.fieldKey,
        label: z.string().trim().min(1).max(120),
        proposedValue: z.string().trim().min(1).max(1000),
        expectedVersion: z.number().int().nonnegative(),
        sourceLabel: z.string().trim().min(1).max(240),
      })
      .strict()
      .parse(request.body);
    requireWorkspacePatient(snapshot, body.patientId);
    const current = (
      await operationalStore.listWorkspaceProfileFields([body.patientId])
    ).find((field) => field.fieldKey === body.fieldKey);
    if ((current?.version ?? 0) !== body.expectedVersion)
      throw new DomainError(
        "VERSION_CONFLICT",
        "Das Profil wurde zwischenzeitlich geändert.",
        409,
      );
    const audience = workspaceAudienceSchema.parse({
      kind: "patient-team",
      memberIds: patientTeamMemberIds(body.patientId, snapshot.users),
    });
    const proposal: WorkspaceProfileProposal = {
      id: randomUUID(),
      patientId: body.patientId,
      fieldKey: body.fieldKey,
      label: body.label,
      currentValue: current?.value ?? null,
      proposedValue: body.proposedValue,
      expectedVersion: body.expectedVersion,
      sourceLabel: body.sourceLabel,
      audience,
      actorId: actor.id,
      state: "pending",
      createdAt: new Date().toISOString(),
      acceptedAt: null,
    };
    const result = await operationalStore.prepareWorkspaceProfileUpdate({
      proposal,
      ...command,
    });
    return reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.post("/api/v1/workspace/profile/:proposalId/accept", async (request) => {
    const { actor, snapshot } = workspaceAccess(request);
    if (!["registered-nurse", "administration"].includes(actor.role))
      throw new DomainError(
        "AUTH_DENIED",
        "Profiländerungen sind für diese Rolle nicht freigegeben.",
        403,
      );
    const command = workspaceCommand(request);
    const { proposalId } = z
      .object({ proposalId: z.uuid() })
      .strict()
      .parse(request.params);
    const result = await operationalStore.acceptWorkspaceProfileUpdate({
      actorId: actor.id,
      proposalId,
      visiblePatientIds: snapshot.patients.map((patient) => patient.id),
      ...command,
    });
    const auditEntry = service.audit.append({
      actor,
      action: "workspace-profile:update",
      patientId: result.value.field.patientId,
      purpose: actor.defaultPurpose,
      outcome: "success",
      detail: {
        fieldKey: result.value.field.fieldKey,
        version: result.value.field.version,
        proposalId,
      },
    });
    await operationalStore.appendAudit(auditEntry);
    await invalidateWorkspace(result.value.proposal.audience.memberIds, {
      kind: "workspace-profile-updated",
      patientId: result.value.field.patientId,
      fieldKey: result.value.field.fieldKey,
    });
    return result;
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
    let replayUnavailable = false;
    const flush = async () => {
      if (flushing || reply.raw.destroyed) return;
      flushing = true;
      try {
        if (!(await operationalStore.health())) {
          if (!replayUnavailable)
            app.log.warn(
              "SSE replay paused while operational store is unavailable",
            );
          replayUnavailable = true;
          return;
        }
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
        if (replayUnavailable)
          app.log.info("SSE replay resumed after operational store recovery");
        replayUnavailable = false;
      } catch (error) {
        if (!replayUnavailable)
          app.log.warn(
            {
              errorType:
                error instanceof Error
                  ? error.constructor.name
                  : "UnknownError",
            },
            "SSE replay paused after operational store query failure",
          );
        replayUnavailable = true;
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
    // Force a fresh authenticated HTTP request before a BFF session can
    // remain visually trusted indefinitely after server-side revocation.
    const maximumStreamAge = setTimeout(() => {
      if (!reply.raw.destroyed) reply.raw.end();
    }, 55_000);
    maximumStreamAge.unref();
    const cleanup = () => {
      clearInterval(heartbeat);
      clearInterval(replayPoll);
      clearTimeout(maximumStreamAge);
      eventSubscribers.delete(send);
    };
    request.raw.on("close", cleanup);
    reply.raw.on("close", cleanup);
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
    const context = await requireAssistantContext(request);
    if (!context.patientId || !context.encounterId) return { pending: null };
    const patient = service
      .snapshot(actorId, actor.defaultPurpose)
      .patients.find(
        (candidate) =>
          candidate.id === context.patientId &&
          candidate.encounterId === context.encounterId,
      );
    if (!patient) return { pending: null };
    const pending = await operationalStore.loadPendingIntentReview(
      actorId,
      patient.id,
      patient.encounterId,
      context.threadId,
    );
    if (!pending) return { pending: null };
    // A durable proposal is not an executable authority. Resolve its archived
    // source turn through the currently authorized conversation before issuing
    // a fresh, short-lived capability for the review UI.
    const sourceTurn = (
      await operationalStore.loadConversation(
        actorId,
        actor.role,
        patient.id,
        context,
      )
    ).find((turn) => turn.id === pending.responseId);
    const archived = sourceTurn?.response
      ? archiveAssistantResponse(sourceTurn.response)
      : null;
    if (!archived) return { pending: null };
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
      const isCommunication = freshRecord.command === "communication:draft";
      const recipientLabel =
        freshRecord.payload.recipientLabel ??
        freshRecord.payload.recipientRole ??
        "freigegebenes Teammitglied";
      component = {
        type: "DraftAction",
        kind,
        title: isCommunication
          ? `Nachricht an ${recipientLabel} · ${patient.displayName}`
          : `Offene Prüfung · ${patient.displayName}`,
        preview: (
          freshRecord.payload.structuredText ??
          freshRecord.payload.request ??
          freshRecord.payload.title ??
          "Offener Entwurf"
        ).slice(0, 1200),
        actionLabel: isCommunication
          ? "Frage prüfen und senden"
          : "Erneut prüfen und übernehmen",
        intentToken,
        sourceLabel:
          "Gespeicherter Entwurf · nach Aktualisierung erneut autorisiert",
        ...(reviewItems.length > 0 ? { reviewItems } : {}),
      };
    }
    await operationalStore.storeIntentAuthority({
      tokenHash: authorityHash(intentToken),
      record: freshRecord,
      sessionId: context.sessionId,
      threadId: context.threadId,
      contextRevision: context.contextRevision,
      responseId: pending.responseId,
      reviewItems,
      clientContextId: context.clientContextId,
    });
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
    const context = await requireAssistantContext(request);
    const authorizedPatients = new Map(
      service
        .snapshot(actorId, actor.defaultPurpose)
        .patients.map((patient) => [patient.id, patient.encounterId]),
    );
    if (
      context.patientId &&
      authorizedPatients.get(context.patientId) !== context.encounterId
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Browserkontext ist für diese Rolle nicht mehr freigegeben.",
        403,
      );
    const conversations = (
      await operationalStore.listConversations(actorId, actor.role)
    )
      .filter(
        (conversation) =>
          conversation.patientId === null ||
          authorizedPatients.get(conversation.patientId) ===
            conversation.encounterId,
      )
      .map((conversation) => ({
        ...conversation,
        active: conversation.id === context.threadId,
      }));
    return {
      turns: await operationalStore.loadConversation(
        actorId,
        actor.role,
        context.patientId,
        context,
      ),
      conversations,
      expiresAt: new Date(
        Date.now() + siteConfiguration.sessionTtlHours * 60 * 60_000,
      ).toISOString(),
      context,
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
    const authorizedPatients = new Map(
      service
        .snapshot(actorId, actor.defaultPurpose)
        .patients.map((patient) => [patient.id, patient]),
    );
    const referencedPatientIds = new Set([
      ...workday.handover.patientIds,
      ...workday.plan.map((item) => item.patientId),
      ...workday.episodes.map((item) => item.patientId),
      ...workday.incomingTransfers.map((item) => item.patientId),
      ...workday.outgoingTransfers.map((item) => item.patientId),
    ]);
    if (
      [...referencedPatientIds].some(
        (patientId) => !authorizedPatients.has(patientId),
      )
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Ein Patientenkontext der Übergabe ist nicht mehr freigegeben.",
        403,
      );
    if (workday.handover.clinicalBound) {
      const encounterBindings = new Map<string, Set<string>>();
      const bindEncounter = (patientId: string, encounterId: string | null) => {
        if (!encounterId) return;
        const bindings = encounterBindings.get(patientId) ?? new Set<string>();
        bindings.add(encounterId);
        encounterBindings.set(patientId, bindings);
      };
      for (const item of workday.handover.items)
        bindEncounter(item.patientId, item.encounterId);
      for (const episode of workday.episodes)
        bindEncounter(episode.patientId, episode.encounterId);
      if (
        [...referencedPatientIds].some((patientId) => {
          const currentEncounterId =
            authorizedPatients.get(patientId)?.encounterId;
          const boundEncounters = encounterBindings.get(patientId);
          return (
            !currentEncounterId ||
            !boundEncounters ||
            boundEncounters.size !== 1 ||
            !boundEncounters.has(currentEncounterId)
          );
        })
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Ein Fallkontext der Übergabe ist nicht mehr aktuell freigegeben.",
          403,
        );
      return presentWorkday(workday);
    }
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
    const clientContextId = assistantClientContextId(request);
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
    revokeClientVoiceReceipts(actorId, clientContextId);
    await operationalStore.suspendAssistantContextAuthorities(
      actorId,
      clientContextId,
    );
    const transition = operationalStore.bindAssistantContext(
      actorId,
      actor.role,
      clientContextId,
      body.patientId,
      selectedPatient?.encounterId ?? null,
    );
    const transitionKey = `${actorId}:${clientContextId}`;
    contextTransitions.set(transitionKey, transition);
    try {
      return await transition;
    } finally {
      if (contextTransitions.get(transitionKey) === transition)
        contextTransitions.delete(transitionKey);
    }
  });

  app.post("/api/v1/assistant/conversation/clear", async (request) => {
    const actorId = userId(request);
    const actor = service.user(actorId);
    const context = await requireAssistantContext(request);
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
    await operationalStore.clearConversation(actorId, actor.role, context);
    return { cleared: true, expiresAt: null };
  });

  app.post("/api/v1/assistant/transcribe", async (request) => {
    await persistenceQueue;
    const assistantContext = await requireAssistantContext(request);
    const context = z
      .object({
        patientId: z.string().nullable(),
        purpose: purposeSchema.default("direct-care"),
      })
      .parse({
        patientId: assistantContext.patientId,
        purpose: request.headers["x-pfh-purpose"],
      });
    const actorId = userId(request);
    const actor = service.user(actorId);
    const selectedPatient = context.patientId
      ? service
          .snapshot(actorId, context.purpose)
          .patients.find((patient) => patient.id === context.patientId)
      : null;
    if (
      assistantContext.patientId !== context.patientId ||
      assistantContext.encounterId !== (selectedPatient?.encounterId ?? null)
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
      const capturedAt = new Date().toISOString();
      const original = voiceTranscriptOriginalSchema.parse({
        transcript: transcription.text,
        transcriptHash: transcriptHash(transcription.text),
        capturedAt,
        source: {
          kind: "asr",
          mode: asr.mode,
          model: transcription.model,
          language: transcription.language,
          confidence: transcription.confidence,
          confidenceState: transcription.confidenceState,
          audioRetained: false,
        },
      });
      const voiceAuthority: DurableVoiceAuthority = {
        clientContextId: assistantContext.clientContextId,
        actorId,
        patientId: context.patientId,
        encounterId: assistantContext.encounterId,
        purpose: context.purpose,
        original,
        sessionId: assistantContext.sessionId,
        threadId: assistantContext.threadId,
        contextRevision: assistantContext.contextRevision,
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
    let disconnected = false;
    let generatedResponse: AssistantResponse | null = null;
    let revocation = Promise.resolve();
    let requestCommitted = false;
    const transportDisconnected = () =>
      request.raw.aborted ||
      reply.raw.destroyed ||
      request.raw.socket.destroyed;
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
      if (completed && !disconnected) return revocation;
      disconnected = true;
      inferenceController.abort("client-disconnected");
      if (requestCommitted) return revocation;
      return revokeAuthorities();
    };
    const abortInference = () => void revokeAfterDisconnect();
    const finishResponse = () => {
      // Node's `finish` event is the positive proof that the response was
      // handed to the transport. A short-lived client may already have a
      // destroyed socket at this point; treating that as an abort revokes a
      // valid review immediately after a normal HTTP response.
      if (disconnected || transportDisconnected()) {
        void revokeAfterDisconnect();
        return;
      }
      completed = true;
      request.raw.removeListener("aborted", abortInference);
      reply.raw.removeListener("close", abortInference);
    };
    request.raw.once("aborted", abortInference);
    reply.raw.once("close", abortInference);
    reply.raw.once("finish", finishResponse);
    const actor = service.user(actorId);
    const clientContextId = assistantClientContextId(request);
    await contextTransitions.get(`${actorId}:${clientContextId}`);
    const context = await requireAssistantContext(request);
    const selectedPatient = body.patientId
      ? service
          .snapshot(actorId, body.purpose ?? actor.defaultPurpose)
          .patients.find((patient) => patient.id === body.patientId)
      : null;
    if (
      context.patientId !== body.patientId ||
      context.encounterId !== (selectedPatient?.encounterId ?? null)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzanfrage stimmt nicht mit dem bewusst gewählten Patientenkontext überein.",
        403,
      );
    const requestIdentity = assistantRequestIdentity(
      request,
      actorId,
      actor.role,
      context,
      body,
    );
    const claim = await operationalStore.claimAssistantRequest(requestIdentity);
    if (claim.state === "in-progress")
      throw new DomainError(
        "INVALID_STATE",
        "Diese Assistenzanfrage wird bereits verarbeitet.",
        409,
      );
    if (claim.state === "completed" && claim.response) return claim.response;
    const holderId = claim.holderId;
    if (!holderId) throw new Error("ASSISTANT_REQUEST_HOLDER_MISSING");
    const stopLease = startAssistantRequestLease(
      requestIdentity,
      holderId,
      inferenceController,
    );
    try {
      const voiceAuthorization = await consumeValidatedVoiceReceipt(
        actorId,
        body,
        context,
        requestIdentity.commandId,
      );
      const voiceTranscriptProvenance = voiceAuthorization?.provenance ?? null;
      const previousCarePlan =
        context.patientId && context.encounterId
          ? await operationalStore.loadPendingCarePlan(
              actorId,
              context.patientId,
              context.encounterId,
              context.threadId,
            )
          : null;
      const workingContext = await assistantWorkingContext(
        actorId,
        context,
        previousCarePlan,
      );
      const response = await runAssistantQuery(() =>
        assistant.query(userId(request), {
          prompt: body.prompt,
          patientId: body.patientId,
          inputModality: body.inputModality,
          voiceTranscriptConfirmed: body.voiceTranscriptConfirmed ?? false,
          ...(voiceTranscriptProvenance ? { voiceTranscriptProvenance } : {}),
          signal: inferenceController.signal,
          workingContext,
          ...(body.purpose ? { purpose: body.purpose } : {}),
        }),
      );
      generatedResponse = response;
      if (inferenceController.signal.aborted || transportDisconnected()) {
        await revokeAfterDisconnect();
        throw new DomainError(
          "INVALID_STATE",
          "Assistenzanfrage wurde abgebrochen.",
          499,
        );
      }
      const authorities = await collectResponseAuthorities(response, context);
      if (inferenceController.signal.aborted || transportDisconnected()) {
        await revokeAfterDisconnect();
        throw new DomainError(
          "INVALID_STATE",
          "Assistenzanfrage wurde abgebrochen.",
          499,
        );
      }
      await operationalStore.appendConversationTurn(
        actorId,
        actor.role,
        {
          id: response.id,
          prompt: body.prompt,
          response: archiveAssistantResponse(response),
          createdAt: new Date().toISOString(),
          inputModality: body.inputModality,
          ...(voiceTranscriptProvenance
            ? { voiceTranscriptProvenance: [voiceTranscriptProvenance] }
            : {}),
          originPatientId: body.patientId,
          originEncounterId: context.encounterId,
          originThreadId: context.threadId,
          originContextRevision: context.contextRevision,
        },
        context,
        {
          ...requestIdentity,
          holderId,
          response: archiveAssistantResponse(response),
          authorities,
          ...(voiceAuthorization
            ? { voiceTokenHash: voiceAuthorization.tokenHash }
            : {}),
        },
      );
      requestCommitted = true;
      if (voiceAuthorization)
        voiceReceipts.delete(voiceAuthorization.receiptId);
      if (inferenceController.signal.aborted || transportDisconnected()) {
        await revokeAfterDisconnect();
        throw new DomainError(
          "INVALID_STATE",
          "Assistenzanfrage wurde abgebrochen.",
          499,
        );
      }
      return response;
    } catch (error) {
      if (!requestCommitted) {
        await revokeAuthorities();
        await operationalStore.releaseAssistantRequest(
          requestIdentity,
          holderId,
        );
      }
      throw error;
    } finally {
      await stopLease();
    }
  });

  app.post("/api/v1/assistant/query/stream", async (request, reply) => {
    const body = assistantQueryBody.parse(request.body);
    const actorId = userId(request);
    const inferenceController = new AbortController();
    let completed = false;
    let disconnected = false;
    let streamedResponse: AssistantResponse | null = null;
    let revocation = Promise.resolve();
    let requestCommitted = false;
    const transportDisconnected = () =>
      request.raw.aborted ||
      reply.raw.destroyed ||
      request.raw.socket.destroyed;
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
      if (completed && !disconnected) return revocation;
      disconnected = true;
      inferenceController.abort("client-disconnected");
      if (requestCommitted) return revocation;
      return revokeAuthorities();
    };
    const abortInference = () => void revokeAfterDisconnect();
    const finishResponse = () => {
      if (disconnected || transportDisconnected()) {
        void revokeAfterDisconnect();
        return;
      }
      completed = true;
      request.raw.removeListener("aborted", abortInference);
      reply.raw.removeListener("close", abortInference);
    };
    request.raw.once("aborted", abortInference);
    reply.raw.once("close", abortInference);
    reply.raw.once("finish", finishResponse);
    const actor = service.user(actorId);
    const clientContextId = assistantClientContextId(request);
    await contextTransitions.get(`${actorId}:${clientContextId}`);
    const context = await requireAssistantContext(request);
    const selectedPatient = body.patientId
      ? service
          .snapshot(actorId, body.purpose ?? actor.defaultPurpose)
          .patients.find((patient) => patient.id === body.patientId)
      : null;
    if (
      context.patientId !== body.patientId ||
      context.encounterId !== (selectedPatient?.encounterId ?? null)
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzanfrage stimmt nicht mit dem bewusst gewählten Patientenkontext überein.",
        403,
      );
    const requestIdentity = assistantRequestIdentity(
      request,
      actorId,
      actor.role,
      context,
      body,
    );
    const claim = await operationalStore.claimAssistantRequest(requestIdentity);
    if (claim.state === "in-progress")
      throw new DomainError(
        "INVALID_STATE",
        "Diese Assistenzanfrage wird bereits verarbeitet.",
        409,
      );
    const replayedResponse = claim.response ?? null;
    requestCommitted = claim.state === "completed";
    const holderId = claim.holderId ?? null;
    if (!replayedResponse && !holderId)
      throw new Error("ASSISTANT_REQUEST_HOLDER_MISSING");
    const stopLease = holderId
      ? startAssistantRequestLease(
          requestIdentity,
          holderId,
          inferenceController,
        )
      : () => Promise.resolve();
    let voiceAuthorization: {
      provenance: VoiceTranscriptProvenance;
      receiptId: string;
      tokenHash: string;
    } | null = null;
    let voiceTranscriptProvenance: VoiceTranscriptProvenance | null = null;
    let workingContext: Awaited<
      ReturnType<typeof assistantWorkingContext>
    > | null = null;
    try {
      if (!replayedResponse) {
        voiceAuthorization = await consumeValidatedVoiceReceipt(
          actorId,
          body,
          context,
          requestIdentity.commandId,
        );
        voiceTranscriptProvenance = voiceAuthorization?.provenance ?? null;
        const previousCarePlan =
          context.patientId && context.encounterId
            ? await operationalStore.loadPendingCarePlan(
                actorId,
                context.patientId,
                context.encounterId,
                context.threadId,
              )
            : null;
        workingContext = await assistantWorkingContext(
          actorId,
          context,
          previousCarePlan,
        );
      }
    } catch (error) {
      if (!requestCommitted)
        await operationalStore.releaseAssistantRequest(
          requestIdentity,
          holderId!,
        );
      await stopLease();
      throw error;
    }
    const uiStream = createUIMessageStream({
      generateId: () => randomUUID(),
      execute: async ({ writer }) => {
        const streamId = randomUUID();
        let progressSequence = 0;
        let previousProgress = "";
        const emitMessage = (id: string, openUi: string) => {
          writer.write({ type: "start-step" });
          writer.write({ type: "text-start", id });
          for (const [index, line] of openUi.split("\n").entries())
            writer.write({
              type: "text-delta",
              id,
              delta: `${index === 0 ? "" : "\n"}${line}`,
            });
          writer.write({ type: "text-end", id });
          writer.write({ type: "finish-step" });
        };
        const emitProgress = (message: string) => {
          if (message === previousProgress) return;
          previousProgress = message;
          progressSequence += 1;
          emitMessage(
            `progress-${streamId}-${progressSequence}`,
            toOpenUi([{ type: "AssistantText", message }]),
          );
        };

        writer.write({ type: "start", messageId: streamId });
        emitProgress("Ich prüfe den freigegebenen Gesprächskontext …");
        try {
          const response =
            replayedResponse ??
            (await runAssistantQuery(() =>
              assistant.query(actorId, {
                prompt: body.prompt,
                patientId: body.patientId,
                inputModality: body.inputModality,
                voiceTranscriptConfirmed:
                  body.voiceTranscriptConfirmed ?? false,
                ...(voiceTranscriptProvenance
                  ? { voiceTranscriptProvenance }
                  : {}),
                signal: inferenceController.signal,
                workingContext: workingContext!,
                onProgress: ({ stage, toolName }) => {
                  if (stage === "tool")
                    emitProgress(
                      toolName === "prepare_clinical_draft"
                        ? "Ich bereite die Angaben für deine Prüfung vor …"
                        : "Ich lese die autorisierten Angaben …",
                    );
                  if (stage === "validation")
                    emitProgress("Ich gleiche Antwort und Quellen ab …");
                },
                ...(body.purpose ? { purpose: body.purpose } : {}),
              }),
            ));
          if (!replayedResponse) streamedResponse = response;
          if (inferenceController.signal.aborted || transportDisconnected()) {
            await revokeAfterDisconnect();
            if (!requestCommitted)
              await operationalStore.releaseAssistantRequest(
                requestIdentity,
                holderId!,
              );
            return;
          }
          if (!replayedResponse)
            emitProgress(
              response.components.some(
                (component) => component.type === "DraftAction",
              )
                ? "Die Prüfung ist abgeschlossen; ich sichere den neuesten Entwurf …"
                : "Die Prüfung ist abgeschlossen; ich sichere die Antwort …",
            );
          const authorities = replayedResponse
            ? []
            : await collectResponseAuthorities(response, context);
          if (inferenceController.signal.aborted || transportDisconnected()) {
            await revokeAfterDisconnect();
            if (!requestCommitted)
              await operationalStore.releaseAssistantRequest(
                requestIdentity,
                holderId!,
              );
            return;
          }
          if (!replayedResponse)
            await operationalStore.appendConversationTurn(
              actorId,
              actor.role,
              {
                id: response.id,
                prompt: body.prompt,
                response: archiveAssistantResponse(response),
                createdAt: new Date().toISOString(),
                inputModality: body.inputModality,
                ...(voiceTranscriptProvenance
                  ? { voiceTranscriptProvenance: [voiceTranscriptProvenance] }
                  : {}),
                originPatientId: body.patientId,
                originEncounterId: context.encounterId,
                originThreadId: context.threadId,
                originContextRevision: context.contextRevision,
              },
              context,
              {
                ...requestIdentity,
                holderId: holderId!,
                response: archiveAssistantResponse(response),
                authorities,
                ...(voiceAuthorization
                  ? { voiceTokenHash: voiceAuthorization.tokenHash }
                  : {}),
              },
            );
          requestCommitted = true;
          if (voiceAuthorization)
            voiceReceipts.delete(voiceAuthorization.receiptId);
          if (inferenceController.signal.aborted || transportDisconnected()) {
            await revokeAfterDisconnect();
            return;
          }
          // A DraftAction is emitted only after validation, durable proposal
          // preparation and server-owned conversation persistence succeed.
          emitMessage(`openui-${response.id}`, response.openUi);
          writer.write({ type: "finish", finishReason: "stop" });
        } catch (error) {
          if (!requestCommitted) {
            if (!replayedResponse) await revokeAuthorities();
            await operationalStore.releaseAssistantRequest(
              requestIdentity,
              holderId!,
            );
          }
          throw error;
        } finally {
          await stopLease();
        }
      },
      onError: () =>
        "Die Assistenzantwort konnte nicht sicher übertragen werden.",
    });
    reply.hijack();
    await pipeUIMessageStreamToResponse({
      response: reply.raw,
      stream: uiStream,
      headers: {
        "cache-control": "no-store, no-transform",
        "x-content-type-options": "nosniff",
      },
    });
  });
  app.post("/api/v1/assistant/intents/:token/execute", async (request) => {
    const { token } = z.object({ token: z.uuid() }).parse(request.params);
    const execution = assistantIntentBody.parse(request.body);
    const actorId = userId(request);
    const actor = service.user(actorId);
    const context = await requireAssistantContext(request);
    if (
      context.patientId !== execution.patientId ||
      context.encounterId !== execution.encounterId
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
      sessionId: context.sessionId,
      threadId: context.threadId,
      contextRevision: context.contextRevision,
      patientId: execution.patientId,
      encounterId: execution.encounterId,
      clientContextId: context.clientContextId,
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
    const reviewedSourceReadSet = parseSourceReadSetV1(
      durableIntent.sourceReadSet,
    );
    const rejectStaleIntent = async (message: string): Promise<never> => {
      await operationalStore.supersedeIntentAuthority(tokenHash);
      throw new DomainError("VERSION_CONFLICT", message, 409);
    };
    if (reviewedSourceReadSet.policyVersion !== runtimeSitePack.packDigest)
      return rejectStaleIntent(
        "Richtlinie oder Arbeitsablauf wurde seit dem Entwurf geändert. Bitte erneut prüfen.",
      );
    let currentSourceReadSet: SourceReadSetV1;
    try {
      currentSourceReadSet =
        workspace.mode === "medplum"
          ? await workspace.refreshSourceReadSet(
              reviewedSourceReadSet,
              durableResources,
            )
          : assistant.refreshMemorySourceReadSet(
              actorId,
              reviewedSourceReadSet,
            );
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("SOURCE_READ_") ||
          error.message.startsWith("MEDPLUM_RESOURCE_VERSION_MISSING"))
      )
        return rejectStaleIntent(
          "Die gelesenen Quelldaten sind nicht mehr vollständig verfügbar. Bitte erneut prüfen.",
        );
      throw error;
    }
    if (!sourceReadSetMatches(reviewedSourceReadSet, currentSourceReadSet))
      return rejectStaleIntent(
        "Die gelesenen Quelldaten haben sich seit dem Entwurf geändert. Bitte erneut prüfen.",
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
    let atomicWorkdayCommand: Extract<
      WorkdayCommand,
      { type: "interrupt-and-start" }
    > | null = null;
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
      const command = {
        type: "interrupt-and-start" as const,
        episodeId: active.id,
        patientId: target.id,
        encounterId: target.encounterId,
        title: `Spontaner Besuch · Zimmer ${target.room}`,
      };
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
      if (runtime.profile === "integrated-demo") {
        atomicWorkdayCommand = command;
        return { workflowChanged: true, activePatientId: target.id };
      }
      const next = await operationalStore.applyWorkdayCommand(
        actorId,
        actor.role,
        command,
      );
      return {
        workday: next,
        workflowChanged: true,
        activePatientId: target.id,
      };
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
          if (!workspace.loadResourceVersions)
            throw new Error("CLINICAL_VERSION_READ_NOT_AVAILABLE");
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
            const clinicalReferences = [
              ...changedResources.map(
                (resource) => `${resource.resourceType}/${resource.id}`,
              ),
              ...removedReferences,
            ];
            const changedResourceVersions =
              await workspace.loadResourceVersions(clinicalReferences);
            const clinicalExpectedVersions = {
              ...changedResourceVersions,
            };
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
            const acceptedAuditEntries = service.audit.slice(beforeAuditLength);
            const receipt = await operationalStore.acceptIntentCommand({
              tokenHash,
              actorId,
              actorRole: actor.role,
              purpose: execution.purpose,
              patientId: execution.patientId,
              encounterId: execution.encounterId,
              clientContextId: context.clientContextId,
              sessionId: context.sessionId,
              threadId: context.threadId,
              contextRevision: context.contextRevision,
              resourceVersion: execution.resourceVersion,
              commandKey: command.key,
              requestHash: command.requestHash,
              statusCode: 200,
              resultPayload: result,
              selectedActionIds: execution.reviewedActionIds ?? [],
              authorizationActions:
                receiptActionsForAudit(acceptedAuditEntries),
              policyVersion: runtimeSitePack.packDigest,
              sourceReadSet: reviewedSourceReadSet,
              auditEntries: acceptedAuditEntries,
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
              ...(atomicWorkdayCommand
                ? { workdayCommand: atomicWorkdayCommand }
                : {}),
              providerCommands,
            });
            committedCommandKeys.add(command.key);
            service.recordCommandReceipt({
              key: command.key,
              requestHash: command.requestHash,
              statusCode: receipt.statusCode,
              payload: JSON.stringify(receipt.payload),
              authorization: commandReceiptAuthorization(
                request,
                beforeCheckpoint,
                receipt.payload,
              ),
            });
            service.retireAcceptedProviderCommands(
              providerCommands.map((pending) => pending.command.idempotencyKey),
            );
            durableResources = nextResources;
            publishInvalidation();
            return receipt.payload;
          } catch (error) {
            service.restoreCheckpoint(beforeCheckpoint);
            if (!(isDomainError(error) && error.code === "VERSION_CONFLICT"))
              assistant.restoreDurableIntent(token, durableIntent);
            throw error;
          }
        });
      } else {
        executedResult = await persist(executeAuthorizedIntent, request);
      }
    } catch (error) {
      if (isDomainError(error) && error.code === "VERSION_CONFLICT")
        await operationalStore.supersedeIntentAuthority(tokenHash);
      else {
        if (runtime.profile !== "integrated-demo")
          await operationalStore.releaseIntentAuthority(tokenHash);
        assistant.restoreDurableIntent(token, durableIntent);
      }
      throw error;
    }
    if (
      runtime.profile !== "integrated-demo" &&
      executedResult &&
      typeof executedResult === "object" &&
      ("bundle" in executedResult || "itemStates" in executedResult)
    )
      await operationalStore.markIntentConversationAccepted(tokenHash);
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
    const requireDemoAdministrator = (request: FastifyRequest) => {
      const operator = service.user(userId(request));
      if (operator.role !== "it")
        throw new DomainError(
          "AUTH_DENIED",
          "Nur die Demo-IT-Rolle darf Szenarien verwalten.",
          403,
        );
      return operator;
    };
    const scenarioSource = (externalId: string, occurredAt: string) => ({
      provider: "pflegehelfer" as const,
      externalId,
      version: 1,
      mappingVersion: "demo-scenario-v1",
      effectiveAt: occurredAt,
      recordedAt: occurredAt,
      receivedAt: occurredAt,
      syncedAt: occurredAt,
    });
    const persistScenarioState = async () => {
      const state = service.checkpoint().state;
      installDemoScenarioRuntime(state);
      return scenarioStore.updateActiveState(
        state,
        await operationalStore.exportDemoWorkspace(),
      );
    };
    const patientFixtureSchema = z
      .object({
        id: z.string().regex(/^p-[a-z0-9-]{2,70}$/),
        displayName: z.string().trim().min(3).max(120),
        birthDate: z.iso.date(),
        mrn: z.string().trim().min(3).max(80),
        room: z.string().trim().min(1).max(40),
        encounterId: z.string().regex(/^enc-[a-z0-9-]{2,90}$/),
        allergyStatus: z.enum(["confirmed", "explicit-negative", "unknown"]),
        allergies: z.array(z.string().trim().min(1).max(240)).max(20),
        risks: z.array(z.string().trim().min(1).max(240)).max(20),
        diagnoses: z.array(z.string().trim().min(1).max(240)).max(20),
        careGoals: z.array(z.string().trim().min(1).max(240)).max(20),
        medicationSummary: z.array(z.string().trim().min(1).max(320)).max(20),
        carePreferences: z
          .array(z.string().trim().min(1).max(240))
          .max(20)
          .default([]),
        communicationPreferences: z
          .array(z.string().trim().min(1).max(240))
          .max(20)
          .default([]),
        dailyRoutine: z
          .array(z.string().trim().min(1).max(240))
          .max(20)
          .default([]),
      })
      .strict();
    const staffFixtureSchema = z
      .object({
        id: z.string().regex(/^u-[a-z0-9-]{2,70}$/),
        displayName: z.string().trim().min(3).max(120),
        role: roleSchema,
        patientIds: z.array(z.string().regex(/^p-[a-z0-9-]{2,70}$/)).max(100),
        managedDevice: z.boolean().default(true),
        professionalTitle: z.string().trim().min(3).max(160),
        languages: z.array(z.string().trim().min(2).max(80)).min(1).max(12),
        responsibilities: z
          .array(z.string().trim().min(2).max(240))
          .min(1)
          .max(24),
      })
      .strict();
    const taskFixtureSchema = z
      .object({
        id: z.string().regex(/^t-[a-z0-9-]{2,90}$/),
        patientId: z.string().regex(/^p-[a-z0-9-]{2,70}$/),
        title: z.string().trim().min(3).max(200),
        reason: z.string().trim().min(3).max(500),
        ownerRole: roleSchema,
        ownerId: z
          .string()
          .regex(/^u-[a-z0-9-]{2,70}$/)
          .nullable(),
        priority: z.enum(["routine", "elevated", "urgent"]),
        dueAt: z.iso.datetime({ offset: true }),
        escalation: z.string().trim().min(3).max(500),
      })
      .strict();

    app.get("/api/v1/admin/demo", async (request) => {
      requireDemoAdministrator(request);
      await ensureScenarioReady();
      const run = await persistScenarioState();
      return {
        run: {
          runId: run.runId,
          scenarioId: run.scenarioId,
          scenarioVersion: run.scenarioVersion,
          label: run.label,
          sourceRunId: run.sourceRunId,
          clock: run.clock,
          digest: scenarioRunContentDigest(run),
          inventory: scenarioInventory(run.state),
          createdAt: run.createdAt,
          updatedAt: run.updatedAt,
        },
        runs: await scenarioStore.list(),
      };
    });

    app.get("/api/v1/admin/demo/export", async (request, reply) => {
      requireDemoAdministrator(request);
      await ensureScenarioReady();
      const run = await persistScenarioState();
      const bundle = {
        schemaVersion: 1,
        kind: "pflegehelfer-synthetic-scenario",
        exportedAt: new Date().toISOString(),
        build: runtimeBuildInfo(),
        run,
        digest: scenarioDigest(run),
      };
      return reply
        .header(
          "content-disposition",
          `attachment; filename="pflegehelfer-${run.scenarioId}-${run.runId}.json"`,
        )
        .header("cache-control", "no-store")
        .send(bundle);
    });

    app.post("/api/v1/admin/demo/import", async (request, reply) => {
      requireDemoAdministrator(request);
      await ensureScenarioReady();
      const body = z
        .object({
          schemaVersion: z.literal(1),
          kind: z.literal("pflegehelfer-synthetic-scenario"),
          exportedAt: z.iso.datetime({ offset: true }),
          build: z.unknown(),
          run: z.unknown(),
          digest: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict()
        .parse(request.body);
      const run = parseDemoScenarioRun(body.run);
      if (scenarioDigest(run) !== body.digest)
        throw new DomainError(
          "INVALID_STATE",
          "Szenarioexport hat eine ungültige Prüfsumme.",
          409,
        );
      const imported = await scenarioStore.importRun(run);
      return reply.code(201).send({
        runId: imported.runId,
        status: "imported-inactive",
        digest: scenarioRunContentDigest(imported),
        inventory: scenarioInventory(imported.state),
      });
    });

    app.post("/api/v1/admin/demo/runs", async (request, reply) => {
      requireDemoAdministrator(request);
      await ensureScenarioReady();
      await persistScenarioState();
      const body = z
        .object({
          source: z.enum(["baseline", "current"]),
          label: z.string().trim().min(3).max(160),
          clockMode: z.enum(["frozen", "start-today"]),
        })
        .strict()
        .parse(request.body);
      const run = await scenarioStore.clone({
        source: body.source,
        label: body.label,
        mode: body.clockMode,
      });
      return reply.code(201).send({
        runId: run.runId,
        status: "created-inactive",
        digest: scenarioRunContentDigest(run),
        inventory: scenarioInventory(run.state),
      });
    });

    app.post("/api/v1/admin/demo/patients", async (request, reply) => {
      const operator = requireDemoAdministrator(request);
      const body = patientFixtureSchema.parse(request.body);
      const active = await scenarioStore.active();
      const occurredAt =
        active.clock.mode === "frozen"
          ? active.clock.anchor
          : new Date().toISOString();
      const result = await persist(
        () => {
          const checkpoint = service.checkpoint();
          if (
            checkpoint.state.patients.some(
              (item) => item.id === body.id || item.mrn === body.mrn,
            )
          )
            throw new DomainError(
              "INVALID_STATE",
              "Patienten-ID oder Fallnummer existiert bereits.",
              409,
            );
          const patient = {
            ...body,
            wardId: siteConfiguration.department.id,
            source: scenarioSource(
              `scenario/${active.runId}/patient/${body.id}`,
              occurredAt,
            ),
          };
          checkpoint.state.patients.push(patient);
          service.restoreCheckpoint(checkpoint);
          service.audit.append({
            actor: operator,
            action: "demo-scenario:patient-added",
            patientId: patient.id,
            purpose: "operations",
            outcome: "success",
            detail: { runId: active.runId },
          });
          return patient;
        },
        request,
        201,
        true,
      );
      await persistScenarioState();
      return reply.code(201).send(result);
    });

    app.post("/api/v1/admin/demo/staff", async (request, reply) => {
      const operator = requireDemoAdministrator(request);
      const body = staffFixtureSchema.parse(request.body);
      const result = await persist(
        () => {
          const checkpoint = service.checkpoint();
          if (checkpoint.state.users.some((item) => item.id === body.id))
            throw new DomainError(
              "INVALID_STATE",
              "Mitarbeitenden-ID existiert bereits.",
              409,
            );
          const visiblePatients = new Set(
            checkpoint.state.patients.map((item) => item.id),
          );
          if (
            body.patientIds.some((patientId) => !visiblePatients.has(patientId))
          )
            throw new DomainError(
              "INVALID_STATE",
              "Eine Zuweisung verweist auf eine unbekannte Person.",
              409,
            );
          const user = {
            id: body.id,
            displayName: body.displayName,
            role: body.role,
            wardIds: [siteConfiguration.department.id],
            patientIds: body.patientIds,
            managedDevice: body.managedDevice,
            defaultPurpose:
              body.role === "administration"
                ? ("administration" as const)
                : [
                      "management",
                      "hr",
                      "it",
                      "quality-safety",
                      "service",
                      "transport",
                    ].includes(body.role)
                  ? ("operations" as const)
                  : ("direct-care" as const),
            directoryProfile: {
              professionalTitle: body.professionalTitle,
              team: "Interprofessionelles Team Rehabilitation",
              station: "Station Rehabilitation Nord",
              workEmail: `${body.id.slice(2)}@pflegezentrum.example.invalid`,
              workPhone: "+41 44 555 01 99",
              languages: body.languages,
              responsibilities: body.responsibilities,
            },
          };
          checkpoint.state.users.push(user);
          service.restoreCheckpoint(checkpoint);
          service.audit.append({
            actor: operator,
            action: "demo-scenario:staff-added",
            patientId: null,
            purpose: "operations",
            outcome: "success",
            detail: { staffId: user.id },
          });
          return user;
        },
        request,
        201,
        true,
      );
      await persistScenarioState();
      return reply.code(201).send(result);
    });

    app.post("/api/v1/admin/demo/tasks", async (request, reply) => {
      const operator = requireDemoAdministrator(request);
      const body = taskFixtureSchema.parse(request.body);
      const active = await scenarioStore.active();
      const occurredAt =
        active.clock.mode === "frozen"
          ? active.clock.anchor
          : new Date().toISOString();
      const result = await persist(
        () => {
          const checkpoint = service.checkpoint();
          const patient = checkpoint.state.patients.find(
            (item) => item.id === body.patientId,
          );
          if (!patient)
            throw new DomainError(
              "NOT_FOUND",
              "Synthetische Person wurde nicht gefunden.",
              404,
            );
          if (checkpoint.state.tasks.some((item) => item.id === body.id))
            throw new DomainError(
              "INVALID_STATE",
              "Aufgaben-ID existiert bereits.",
              409,
            );
          if (
            body.ownerId &&
            !checkpoint.state.users.some(
              (item) =>
                item.id === body.ownerId && item.role === body.ownerRole,
            )
          )
            throw new DomainError(
              "INVALID_STATE",
              "Verantwortliche Person und Rolle stimmen nicht überein.",
              409,
            );
          const task = {
            ...body,
            encounterId: patient.encounterId,
            requesterId: operator.id,
            state: "new" as const,
            acknowledgementRequired: true,
            acknowledgedAt: null,
            dependencies: [],
            comments: [],
            completionEvidence: null,
            source: scenarioSource(
              `scenario/${active.runId}/task/${body.id}`,
              occurredAt,
            ),
          };
          checkpoint.state.tasks.push(task);
          service.restoreCheckpoint(checkpoint);
          service.audit.append({
            actor: operator,
            action: "demo-scenario:task-added",
            patientId: patient.id,
            purpose: "operations",
            outcome: "success",
            detail: { taskId: task.id },
          });
          return task;
        },
        request,
        201,
        true,
      );
      await persistScenarioState();
      return reply.code(201).send(result);
    });

    app.post("/api/v1/admin/demo/task-assignment", async (request, reply) => {
      const operator = requireDemoAdministrator(request);
      const body = z
        .object({
          task: taskFixtureSchema.omit({ dueAt: true }),
          dueOffsetMinutes: z
            .number()
            .int()
            .min(1)
            .max(7 * 24 * 60),
          actorId: z.string().regex(/^u-[a-z0-9-]{2,70}$/),
          patientIds: z.array(z.string().regex(/^p-[a-z0-9-]{2,70}$/)).max(100),
        })
        .strict()
        .parse(request.body);
      const active = await scenarioStore.active();
      const occurredAt =
        active.clock.mode === "frozen"
          ? active.clock.anchor
          : new Date().toISOString();
      const result = await persist(
        () => {
          const checkpoint = service.checkpoint();
          const patient = checkpoint.state.patients.find(
            (item) => item.id === body.task.patientId,
          );
          const actor = checkpoint.state.users.find(
            (item) => item.id === body.actorId,
          );
          if (!patient || !actor)
            throw new DomainError(
              "NOT_FOUND",
              "Synthetische Person oder Mitarbeitende wurde nicht gefunden.",
              404,
            );
          if (checkpoint.state.tasks.some((item) => item.id === body.task.id))
            throw new DomainError(
              "INVALID_STATE",
              "Aufgaben-ID existiert bereits.",
              409,
            );
          const knownPatients = new Set(
            checkpoint.state.patients.map((item) => item.id),
          );
          if (
            body.patientIds.some(
              (patientId) => !knownPatients.has(patientId),
            ) ||
            (body.task.ownerId &&
              !checkpoint.state.users.some(
                (item) =>
                  item.id === body.task.ownerId &&
                  item.role === body.task.ownerRole,
              ))
          )
            throw new DomainError(
              "INVALID_STATE",
              "Aufgabenverantwortung oder Zuweisung ist ungültig.",
              409,
            );
          const task = {
            ...body.task,
            encounterId: patient.encounterId,
            requesterId: operator.id,
            dueAt: new Date(
              Date.parse(occurredAt) + body.dueOffsetMinutes * 60_000,
            ).toISOString(),
            state: "new" as const,
            acknowledgementRequired: true,
            acknowledgedAt: null,
            dependencies: [],
            comments: [],
            completionEvidence: null,
            source: scenarioSource(
              `scenario/${active.runId}/task/${body.task.id}`,
              occurredAt,
            ),
          };
          checkpoint.state.tasks.push(task);
          actor.patientIds = [
            ...new Set([...actor.patientIds, ...body.patientIds]),
          ];
          service.restoreCheckpoint(checkpoint);
          service.audit.append({
            actor: operator,
            action: "demo-scenario:task-assignment-added",
            patientId: patient.id,
            purpose: "operations",
            outcome: "success",
            detail: {
              taskId: task.id,
              actorId: actor.id,
              patientCount: actor.patientIds.length,
            },
          });
          return { task, actorId: actor.id, patientIds: actor.patientIds };
        },
        request,
        201,
        true,
      );
      await persistScenarioState();
      return reply.code(201).send(result);
    });

    app.post("/api/v1/admin/demo/assignments", async (request) => {
      const operator = requireDemoAdministrator(request);
      const body = z
        .object({
          actorId: z.string().regex(/^u-[a-z0-9-]{2,70}$/),
          patientIds: z.array(z.string().regex(/^p-[a-z0-9-]{2,70}$/)).max(100),
        })
        .strict()
        .parse(request.body);
      const result = await persist(
        () => {
          const checkpoint = service.checkpoint();
          const actor = checkpoint.state.users.find(
            (item) => item.id === body.actorId,
          );
          if (!actor)
            throw new DomainError(
              "NOT_FOUND",
              "Mitarbeitende Person wurde nicht gefunden.",
              404,
            );
          const patientIds = new Set(
            checkpoint.state.patients.map((item) => item.id),
          );
          if (body.patientIds.some((patientId) => !patientIds.has(patientId)))
            throw new DomainError(
              "INVALID_STATE",
              "Eine Zuweisung verweist auf eine unbekannte Person.",
              409,
            );
          actor.patientIds = [...new Set(body.patientIds)];
          service.restoreCheckpoint(checkpoint);
          service.audit.append({
            actor: operator,
            action: "demo-scenario:assignment-updated",
            patientId: null,
            purpose: "operations",
            outcome: "success",
            detail: {
              actorId: actor.id,
              patientCount: actor.patientIds.length,
            },
          });
          return { actorId: actor.id, patientIds: actor.patientIds };
        },
        request,
        200,
        true,
      );
      await persistScenarioState();
      return result;
    });

    app.post("/api/v1/admin/demo/events/:eventId", async (request, reply) => {
      requireDemoAdministrator(request);
      const { eventId } = z
        .object({ eventId: z.string().regex(/^[a-z0-9:-]{2,120}$/) })
        .strict()
        .parse(request.params);
      const event = baselineDemoScenario.predefinedEvents.find(
        (candidate) => candidate.id === eventId,
      );
      if (!event)
        throw new DomainError(
          "NOT_FOUND",
          "Kontrolliertes Szenarioereignis wurde nicht gefunden.",
          404,
        );
      const result = await persist(
        () => service.triggerNurseCall(userId(request), event.patientId),
        request,
        201,
        true,
      );
      return reply.code(201).send({ event, result });
    });

    app.get("/api/v1/admin/demo/runs/:runId/reset-preview", async (request) => {
      requireDemoAdministrator(request);
      const { runId } = z.object({ runId: z.uuid() }).parse(request.params);
      const [current, target] = await Promise.all([
        persistScenarioState(),
        scenarioStore.get(runId),
      ]);
      if (!target)
        throw new DomainError(
          "NOT_FOUND",
          "Szenariolauf wurde nicht gefunden.",
          404,
        );
      const confirmationDigest = scenarioDigest({
        currentRunId: current.runId,
        currentDigest: scenarioRunContentDigest(current),
        targetRunId: target.runId,
        targetDigest: scenarioRunContentDigest(target),
      });
      return {
        current: {
          runId: current.runId,
          digest: scenarioRunContentDigest(current),
          inventory: scenarioInventory(current.state),
        },
        target: {
          runId: target.runId,
          digest: scenarioRunContentDigest(target),
          inventory: scenarioInventory(target.state),
        },
        confirmationDigest,
        activation: "stopped-runtime-restore-required",
        message:
          "Die Vorschau verändert nichts. Aktivierung bleibt gesperrt, bis der vollständige PostgreSQL-, Medplum-, Datei- und Provider-Restore im gestoppten isolierten Lauf ausgeführt wird.",
      };
    });

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
      if (runtime.profile !== "memory-demo")
        return reply.code(409).send({
          error: "ISOLATED_RESET_REQUIRED",
          message:
            "Der breite Reset ist nur im isolierten Speichertest erlaubt. Verwende Demo verwalten für Export, Arbeitskopie und eine geprüfte Reset-Vorschau; der laufende integrierte Demonstrator bleibt unverändert.",
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
      await seedSyntheticDemoWorkspace(operationalStore);
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
    await drainBackgroundWorkers();
    await Promise.all([
      operationalStore.close(),
      commercialStore.close(),
      scenarioStore.close(),
      identity?.close?.() ?? Promise.resolve(),
    ]);
  });

  return app;
}
