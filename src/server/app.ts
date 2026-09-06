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
import { ModelGateway } from "../ai/model-gateway.js";
import { ApprovedKnowledgeService } from "../ai/approved-knowledge.js";
import { isDomainError, PflegehelferService } from "../core/service.js";
import { DomainError } from "../core/types.js";
import {
  createProductionProviderRegistry,
  createSyntheticProviderRegistry,
  providerIntegrationRoutes,
} from "../core/provider-integration/index.js";
import {
  InMemoryClinicalWorkspace,
  type ClinicalWorkspace,
} from "../infrastructure/medplum-workspace.js";
import {
  InMemoryOperationalStore,
  type OperationalStore,
} from "../infrastructure/operational-store.js";

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
  title: z.string().trim().min(3).max(120),
  reason: z.string().trim().min(3).max(500),
  ownerRole: roleSchema,
  priority: prioritySchema,
  dueAt: z.iso.datetime(),
  purpose: purposeSchema.optional(),
});
const observationBody = z.object({
  patientId: z.string(),
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
const assistantIntentBody = z
  .object({
    patientId: z.string(),
    encounterId: z.string(),
    purpose: purposeSchema,
    resourceVersion: z.number().int().nonnegative(),
    explicitlyConfirmed: z.literal(true),
    reviewedActionIds: z
      .array(z.string().regex(/^action-[1-6]$/))
      .max(6)
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
        "Dieser frühere Vorschlag ist nicht mehr ausführbar. Bitte neu formulieren, damit Kontext und Version erneut geprüft werden.",
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
    loggerStream?: Writable;
    loggerLevel?: string;
  } = {},
): FastifyInstance {
  const demoMode = options.demoMode ?? process.env.PFH_DEMO_MODE === "true";
  const service =
    providedService ??
    new PflegehelferService(
      undefined,
      demoMode
        ? createSyntheticProviderRegistry()
        : createProductionProviderRegistry(),
      demoMode ? "synthetic-simulator" : "production",
    );
  const workspace = options.workspace ?? new InMemoryClinicalWorkspace();
  const operationalStore =
    options.operationalStore ?? new InMemoryOperationalStore();
  const models = new ModelGateway();
  const asr = new AsrGateway();
  const knowledge = new ApprovedKnowledgeService();
  const assistant = new AssistantService(service, models, knowledge);
  let durableResources = service.fhirResources();
  let persistenceQueue: Promise<void> = Promise.resolve();
  let eventRevision = 0;
  const voiceReceipts = new Map<
    string,
    {
      actorId: string;
      patientId: string;
      purpose: z.infer<typeof purposeSchema>;
      textHash: string;
      model: string;
      entityIds: string[];
      expiresAt: number;
    }
  >();
  const eventSubscribers = new Set<(revision: number) => void>();
  const publishInvalidation = () => {
    eventRevision += 1;
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
          return (
            previousByReference.get(reference) !== JSON.stringify(resource)
          );
        });
        const removedReferences = [...previousByReference.keys()].filter(
          (reference) => !nextReferences.has(reference),
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
        if (request?.method === "POST" || (publishChange && stateChanged))
          publishInvalidation();
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
  if (demoMode) {
    const configuredInterval = Number(
      process.env.PFH_ESCALATION_INTERVAL_MS ?? "5000",
    );
    const intervalMs = Number.isFinite(configuredInterval)
      ? Math.max(1000, configuredInterval)
      : 5000;
    const escalationTimer = setInterval(() => {
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
              error instanceof Error ? error.constructor.name : "UnknownError",
          },
          "deterministic deadline sweep failed",
        );
      });
    }, intervalMs);
    escalationTimer.unref();
    app.addHook("onClose", (_instance, done) => {
      clearInterval(escalationTimer);
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
    request.log.error({ err: error }, "unhandled request error");
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
    const actor = request.headers["x-demo-user"] ?? "production-identity";
    const key = `${String(actor)}:${request.method}:${request.url}:${commandId}`;
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
    requestCommandKeys.set(request, { key, requestHash });
  });

  app.get("/health", () => ({
    status: "ok",
    service: "pflegehelfer-api",
    time: new Date().toISOString(),
  }));
  app.get("/ready", async (_request, reply) => {
    await persistenceQueue;
    const auditValid = service.audit.verify();
    const [workspaceStatus, operationalReady] = await Promise.all([
      workspace.status(),
      operationalStore.health(),
    ]);
    if (!demoMode)
      return reply.code(503).send({
        status: "not-ready",
        reason: "production-identity-adapter-not-configured",
        aiRequired: false,
        providersRequired: false,
        auditValid,
      });
    if (!workspaceStatus.ready)
      return reply.code(503).send({
        status: "not-ready",
        reason: "clinical-workspace-unavailable",
        aiRequired: false,
        providersRequired: false,
        auditValid,
        workspace: workspaceStatus,
      });
    if (!operationalReady)
      return reply.code(503).send({
        status: "not-ready",
        reason: "operational-store-unavailable",
        aiRequired: false,
        providersRequired: false,
        auditValid,
      });
    return {
      status: auditValid ? "ready" : "not-ready",
      aiRequired: false,
      providersRequired: false,
      auditValid,
      workspace: workspaceStatus,
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
    const canUseDetailedWorkspace = [
      "registered-nurse",
      "physician",
      "it",
      "quality-safety",
    ].includes(snapshot.currentUser.role);
    return {
      ...snapshot,
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
    userId(request);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    reply.raw.write(
      `event: connected\ndata: {"revision":${eventRevision}}\n\n`,
    );
    const send = (revision: number) => {
      if (!reply.raw.destroyed)
        reply.raw.write(
          `id: ${revision}\nevent: snapshot-invalidated\ndata: {"revision":${revision}}\n\n`,
        );
    };
    const lastEventId = Number(request.headers["last-event-id"] ?? 0);
    if (Number.isFinite(lastEventId) && lastEventId < eventRevision)
      send(eventRevision);
    eventSubscribers.add(send);
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
    }, 20_000);
    heartbeat.unref();
    request.raw.on("close", () => {
      clearInterval(heartbeat);
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
      clinicalCoreRequiresAi: false,
    };
  });

  app.get("/api/v1/assistant/conversation", async (request) => {
    await persistenceQueue;
    const actorId = userId(request);
    const actor = service.user(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    return {
      turns: await operationalStore.loadConversation(actorId, actor.role),
      expiresAt: new Date(Date.now() + 12 * 60 * 60_000).toISOString(),
      session,
    };
  });

  app.get("/api/v1/working-session", async (request) => {
    await persistenceQueue;
    const actorId = userId(request);
    const actor = service.user(actorId);
    return operationalStore.getOrStartSession(actorId, actor.role);
  });

  app.post("/api/v1/assistant/context", async (request) => {
    const actorId = userId(request);
    const actor = service.user(actorId);
    const body = z
      .object({ patientId: z.string().nullable() })
      .strict()
      .parse(request.body);
    if (body.patientId) {
      const allowed = service
        .snapshot(actorId, actor.defaultPurpose)
        .patients.some((patient) => patient.id === body.patientId);
      if (!allowed)
        throw new DomainError(
          "AUTH_DENIED",
          "Patientenkontext ist für diese Rolle nicht freigegeben.",
          403,
        );
    }
    assistant.revokeActorIntents(actorId);
    return operationalStore.changePatientContext(
      actorId,
      actor.role,
      body.patientId,
    );
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
        patientId: z.string(),
        purpose: purposeSchema.default("direct-care"),
      })
      .parse({
        patientId: request.headers["x-pfh-patient-context"],
        purpose: request.headers["x-pfh-purpose"],
      });
    const actorId = userId(request);
    const actor = service.user(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    if (session.patientId !== context.patientId)
      throw new DomainError(
        "AUTH_DENIED",
        "Sprachaufnahme gehört nicht zum aktuellen Patientenkontext.",
        403,
      );
    const snapshot = service.snapshot(actorId, context.purpose);
    if (!snapshot.patients.some((patient) => patient.id === context.patientId))
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
      const transcription = await asr.transcribe(bytes, file.mimetype);
      const receiptId = randomUUID();
      voiceReceipts.set(receiptId, {
        actorId,
        patientId: context.patientId,
        purpose: context.purpose,
        textHash: createHash("sha256").update(transcription.text).digest("hex"),
        model: transcription.model,
        entityIds: transcription.criticalEntities.map(
          (entity) => `${entity.kind}:${entity.start}:${entity.end}`,
        ),
        expiresAt: Date.now() + 5 * 60_000,
      });
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

  app.post("/api/v1/assistant/query", async (request) => {
    const body = assistantQueryBody.parse(request.body);
    const actorId = userId(request);
    const actor = service.user(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    if (session.patientId !== body.patientId)
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzanfrage stimmt nicht mit dem bewusst gewählten Patientenkontext überein.",
        403,
      );
    if (body.inputModality === "voice") {
      const receipt = voiceReceipts.get(body.voiceReceiptId ?? "");
      // Receipts are one-use and fail closed, including after a downstream
      // failure, so a transcript can never be replayed into another context.
      if (body.voiceReceiptId) voiceReceipts.delete(body.voiceReceiptId);
      const purpose = body.purpose ?? "direct-care";
      const textHash = createHash("sha256").update(body.prompt).digest("hex");
      const confirmedEntityIds = [
        ...(body.voiceConfirmedEntityIds ?? []),
      ].sort();
      const expectedEntityIds = [...(receipt?.entityIds ?? [])].sort();
      if (
        !receipt ||
        receipt.expiresAt < Date.now() ||
        receipt.actorId !== actorId ||
        receipt.patientId !== body.patientId ||
        receipt.purpose !== purpose ||
        receipt.textHash !== textHash ||
        JSON.stringify(confirmedEntityIds) !== JSON.stringify(expectedEntityIds)
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Sprachtranskript ist abgelaufen, verändert oder nicht an diesen Kontext gebunden.",
          403,
        );
    }
    const response = await persist(() =>
      assistant.query(userId(request), {
        prompt: body.prompt,
        patientId: body.patientId,
        inputModality: body.inputModality,
        voiceTranscriptConfirmed: body.voiceTranscriptConfirmed ?? false,
        ...(body.purpose ? { purpose: body.purpose } : {}),
      }),
    );
    await operationalStore.appendConversationTurn(actorId, actor.role, {
      id: response.id,
      prompt: body.prompt,
      response: archiveAssistantResponse(response),
      createdAt: new Date().toISOString(),
      inputModality: body.inputModality,
    });
    return response;
  });

  app.post("/api/v1/assistant/query/stream", async (request, reply) => {
    const body = assistantQueryBody.parse(request.body);
    const actorId = userId(request);
    const actor = service.user(actorId);
    const session = await operationalStore.getOrStartSession(
      actorId,
      actor.role,
    );
    if (session.patientId !== body.patientId)
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzanfrage stimmt nicht mit dem bewusst gewählten Patientenkontext überein.",
        403,
      );
    if (body.inputModality === "voice") {
      const receipt = voiceReceipts.get(body.voiceReceiptId ?? "");
      if (body.voiceReceiptId) voiceReceipts.delete(body.voiceReceiptId);
      const purpose = body.purpose ?? "direct-care";
      const textHash = createHash("sha256").update(body.prompt).digest("hex");
      const confirmed = [...(body.voiceConfirmedEntityIds ?? [])].sort();
      const expected = [...(receipt?.entityIds ?? [])].sort();
      if (
        !receipt ||
        receipt.expiresAt < Date.now() ||
        receipt.actorId !== actorId ||
        receipt.patientId !== body.patientId ||
        receipt.purpose !== purpose ||
        receipt.textHash !== textHash ||
        JSON.stringify(confirmed) !== JSON.stringify(expected)
      )
        throw new DomainError(
          "AUTH_DENIED",
          "Sprachtranskript ist abgelaufen, verändert oder nicht an diesen Kontext gebunden.",
          403,
        );
    }

    const response = await persist(() =>
      assistant.query(actorId, {
        prompt: body.prompt,
        patientId: body.patientId,
        inputModality: body.inputModality,
        voiceTranscriptConfirmed: body.voiceTranscriptConfirmed ?? false,
        ...(body.purpose ? { purpose: body.purpose } : {}),
      }),
    );
    let completed = false;
    request.raw.once("close", () => {
      if (!completed) assistant.revokeResponseIntents(response);
    });
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
    // frame exposes the live proposal only after its thread record is durable.
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
      });
    } catch {
      assistant.revokeResponseIntents(response);
      write({
        type: "error",
        message:
          "Der Gesprächszustand konnte nicht sicher gespeichert werden. Es wurde keine Aktion freigeschaltet.",
      });
      reply.raw.end();
      return;
    }
    write({ type: "complete", response });
    completed = true;
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
    if (session.patientId !== execution.patientId)
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
    return persist(
      () =>
        assistant.executeIntent(actorId, token, {
          patientId: execution.patientId,
          encounterId: execution.encounterId,
          purpose: execution.purpose,
          resourceVersion: execution.resourceVersion,
          explicitlyConfirmed: execution.explicitlyConfirmed,
          ...(execution.reviewedActionIds
            ? { reviewedActionIds: execution.reviewedActionIds }
            : {}),
        }),
      request,
    );
  });

  app.post("/api/v1/tasks", async (request, reply) => {
    const result = await persist(
      () =>
        service.createTask(userId(request), taskCreateBody.parse(request.body)),
      request,
      201,
    );
    return reply.code(201).send(result);
  });
  app.post("/api/v1/tasks/:id/:transition", async (request) => {
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
    reply
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
    reply
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
    const params = z
      .object({ type: z.enum(["observation", "note"]), id: z.string() })
      .parse(request.params);
    return persist(
      () =>
        service.approve(
          userId(request),
          params.type,
          params.id,
          approveBody.parse(request.body),
        ),
      request,
    );
  });
  app.post("/api/v1/communications", async (request, reply) =>
    reply
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
  app.post("/api/v1/handovers/:id/acknowledge", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ purpose: purposeSchema.optional() })
      .parse(request.body ?? {});
    return persist(
      () =>
        service.acknowledgeHandover(userId(request), params.id, body.purpose),
      request,
    );
  });
  app.post("/api/v1/handovers/:id/sign", async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z
      .object({ purpose: purposeSchema.optional() })
      .parse(request.body ?? {});
    return persist(
      () => service.signHandover(userId(request), params.id, body.purpose),
      request,
    );
  });
  app.post("/api/v1/intake/:id/review", async (request) => {
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
    reply
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
      const result = await persist(() => {
        service.reset({
          resetAudit: workspace.mode === "in-memory",
          actor: operator,
        });
        return { status: "reset" };
      }, request);
      await operationalStore.resetDemoState();
      for (const user of service.checkpoint().state.users)
        assistant.revokeActorIntents(user.id);
      return result;
    });
  }
  app.post("/api/v1/outbox/process", async (request) =>
    persist(() => service.flushOutbox(userId(request)), request),
  );
  app.post("/api/v1/outbox/:outboxId/reconcile", async (request) => {
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
