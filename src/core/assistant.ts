import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DomainError,
  type DemoUser,
  type Purpose,
  type Role,
} from "./types.js";

const boundedText = z.string().trim().min(1).max(1200);
const recordId = z.string().regex(/^[A-Za-z0-9.-]{1,64}$/);

export const assistantComponentSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("AssistantText"),
      message: boundedText,
    })
    .strict(),
  z
    .object({
      type: z.literal("PatientPicker"),
      title: z.string().trim().min(1).max(120),
      message: boundedText,
      patients: z
        .array(
          z
            .object({
              id: recordId,
              label: z.string().trim().min(1).max(120),
              secondary: z.string().trim().min(1).max(120),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  z
    .object({
      type: z.literal("PatientSummary"),
      patientId: recordId,
      title: z.string().trim().min(1).max(120),
      narrative: boundedText,
      sections: z
        .array(
          z
            .object({
              id: recordId,
              label: z.string().trim().min(1).max(80),
              items: z.array(z.string().trim().min(1).max(500)).max(12),
              state: z.enum([
                "confirmed",
                "unknown",
                "not-supplied",
                "stale",
                "conflict",
                "restricted",
                "explicit-negative",
              ]),
              sourceLabel: z.string().trim().min(1).max(180),
              effectiveAt: z.string().datetime().nullable(),
            })
            .strict(),
        )
        .min(1)
        .max(12),
      sourceLabel: z.string().trim().min(1).max(180),
    })
    .strict(),
  z
    .object({
      type: z.literal("TaskList"),
      title: z.string().trim().min(1).max(120),
      summary: boundedText,
      count: z.number().int().min(0).max(50),
      sourceLabel: z.string().trim().min(1).max(180),
    })
    .strict(),
  z
    .object({
      type: z.literal("VitalTrend"),
      patientId: recordId,
      label: z.string().trim().min(1).max(80),
      value: z.string().trim().min(1).max(80),
      points: z
        .array(
          z
            .object({
              id: recordId,
              value: z.number(),
              secondaryValue: z.number().nullable(),
              unit: z.enum(["mmHg", "°C", "%", "/min", "kg"]),
              effectiveAt: z.string().datetime(),
              status: z.enum([
                "approved",
                "draft",
                "pending-review",
                "corrected",
              ]),
            })
            .strict(),
        )
        .max(12),
      sourceLabel: z.string().trim().min(1).max(180),
    })
    .strict(),
  z
    .object({
      type: z.literal("HandoverChecklist"),
      title: z.string().trim().min(1).max(120),
      summary: boundedText,
      openCount: z.number().int().min(0).max(100),
      sourceLabel: z.string().trim().min(1).max(180),
    })
    .strict(),
  z
    .object({
      type: z.literal("TeamInbox"),
      title: z.string().trim().min(1).max(120),
      summary: boundedText,
      count: z.number().int().min(0).max(100),
      sourceLabel: z.string().trim().min(1).max(180),
      items: z
        .array(
          z
            .object({
              id: recordId,
              patientId: recordId,
              patientLabel: z.string().trim().min(1).max(120),
              recipientLabel: z.string().trim().min(1).max(120),
              request: z.string().trim().min(1).max(500),
              reason: z.string().trim().min(1).max(1000),
              priority: z.enum(["routine", "elevated", "urgent"]),
              state: z.enum([
                "sent",
                "acknowledged",
                "answered",
                "closed",
                "escalated",
              ]),
              response: z.string().trim().max(1000),
              canAcknowledge: z.boolean(),
              canAnswer: z.boolean(),
              canClose: z.boolean(),
            })
            .strict(),
        )
        .max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal("SyncSummary"),
      title: z.string().trim().min(1).max(120),
      summary: boundedText,
      pending: z.number().int().min(0).max(1000),
      conflicts: z.number().int().min(0).max(1000),
      sourceLabel: z.string().trim().min(1).max(180),
    })
    .strict(),
  z
    .object({
      type: z.literal("DraftAction"),
      kind: z.enum([
        "nursing-note",
        "physician-question",
        "task",
        "care-update",
      ]),
      title: z.string().trim().min(1).max(120),
      preview: boundedText,
      actionLabel: z.string().trim().min(1).max(80),
      intentToken: z.uuid(),
      sourceLabel: z.string().trim().min(1).max(180),
      reviewItems: z
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
        .min(1)
        .max(12)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("MedicationReadOnly"),
      patientId: recordId,
      summary: boundedText,
      sourceLabel: z.string().trim().min(1).max(180),
    })
    .strict(),
  z
    .object({
      type: z.literal("SafetyAlert"),
      severity: z.enum(["info", "warning"]),
      message: boundedText,
    })
    .strict(),
  z
    .object({
      type: z.literal("KnowledgeAnswer"),
      title: z.string().trim().min(1).max(120),
      answer: z.string().trim().min(1).max(2400),
      sourceLabel: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("UnknownState"),
      message: boundedText,
    })
    .strict(),
]);

export type AssistantComponent = z.infer<typeof assistantComponentSchema>;

export function validateAssistantComponents(
  input: unknown,
): AssistantComponent[] {
  const result = z.array(assistantComponentSchema).max(12).safeParse(input);
  if (!result.success)
    throw new DomainError(
      "VALIDATION",
      "Unbekannte oder nicht freigegebene Generative-UI-Komponente.",
      400,
    );
  return result.data;
}

export type AssistantIntentCommand =
  "note:draft" | "communication:draft" | "task:draft" | "care-update:draft";

export interface BoundIntentInput {
  command: AssistantIntentCommand;
  patientId: string;
  encounterId: string;
  purpose: Purpose;
  resourceVersion: number;
  payload: Record<string, string>;
  ttlMs?: number;
}

interface IntentRecord extends Omit<BoundIntentInput, "ttlMs"> {
  actorId: string;
  actorRole: Role;
  expiresAt: number;
}

export type DurableIntentRecord = IntentRecord;

export interface IntentExecutionContext {
  patientId: string;
  encounterId: string;
  purpose: Purpose;
  resourceVersion: number;
  explicitlyConfirmed: boolean;
  reviewedActionIds?: string[];
}

/**
 * Server-side one-use intent registry. Tokens contain no identifiers and every
 * security-relevant context value is bound and rechecked on consumption.
 */
export class OpaqueIntentBroker {
  private readonly intents = new Map<string, IntentRecord>();

  issue(actor: DemoUser, input: BoundIntentInput): string {
    if (!actor.patientIds.includes(input.patientId))
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzaktion liegt ausserhalb des Behandlungskontexts.",
        403,
      );
    const token = randomUUID();
    this.intents.set(token, {
      actorId: actor.id,
      actorRole: actor.role,
      command: input.command,
      patientId: input.patientId,
      encounterId: input.encounterId,
      purpose: input.purpose,
      resourceVersion: input.resourceVersion,
      payload: structuredClone(input.payload),
      expiresAt: Date.now() + (input.ttlMs ?? 120_000),
    });
    return token;
  }

  revoke(token: string): void {
    this.intents.delete(token);
  }

  revokeActor(actorId: string): void {
    for (const [token, record] of this.intents)
      if (record.actorId === actorId) this.intents.delete(token);
  }

  durableRecord(token: string): DurableIntentRecord | null {
    const record = this.intents.get(token);
    return record && record.expiresAt >= Date.now()
      ? structuredClone(record)
      : null;
  }

  restore(token: string, record: DurableIntentRecord): void {
    if (record.expiresAt < Date.now())
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzaktion ist ungültig oder abgelaufen.",
        403,
      );
    this.intents.set(token, structuredClone(record));
  }

  consume(
    token: string,
    actor: DemoUser,
    context: IntentExecutionContext,
  ): Omit<IntentRecord, "actorId" | "actorRole" | "expiresAt"> {
    const record = this.intents.get(token);
    if (!record || record.expiresAt < Date.now())
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzaktion ist ungültig oder abgelaufen.",
        403,
      );
    if (
      record.actorId !== actor.id ||
      record.actorRole !== actor.role ||
      !context.explicitlyConfirmed ||
      record.patientId !== context.patientId ||
      record.encounterId !== context.encounterId ||
      record.purpose !== context.purpose ||
      record.resourceVersion !== context.resourceVersion
    )
      throw new DomainError(
        "AUTH_DENIED",
        "Assistenzaktion stimmt nicht mit Identität, Kontext oder Version überein.",
        403,
      );
    return {
      command: record.command,
      patientId: record.patientId,
      encounterId: record.encounterId,
      purpose: record.purpose,
      resourceVersion: record.resourceVersion,
      payload: structuredClone(record.payload),
    };
  }

  /**
   * Invalid or stale confirmations must not let another caller burn a valid
   * review token. The command gateway removes authority only after the
   * validated operation has completed successfully.
   */
  finalize(token: string): void {
    this.intents.delete(token);
  }
}
