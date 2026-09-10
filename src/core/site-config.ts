import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Role } from "./types.js";

export const actionSchema = z.enum([
  "patient:read",
  "patient:administrative-read",
  "task:read",
  "task:update",
  "task:create",
  "observation:draft",
  "observation:approve",
  "note:draft",
  "note:approve",
  "communication:read",
  "communication:create",
  "communication:respond",
  "handover:read",
  "handover:acknowledge",
  "round:read",
  "round:decide",
  "intake:read",
  "intake:update",
  "provider:operate",
  "audit:verify",
  "analytics:aggregate",
]);
export type Action = z.infer<typeof actionSchema>;

/** Site packs may narrow these centrally reviewed maxima, never expand them. */
export const ROLE_ACTION_CEILINGS: Record<Role, readonly Action[]> = {
  "care-assistant": [
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "observation:draft",
    "observation:approve",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "handover:acknowledge",
    "round:read",
  ],
  "registered-nurse": [
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "observation:draft",
    "observation:approve",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "handover:acknowledge",
    "round:read",
    "intake:read",
    "intake:update",
  ],
  physician: [
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "observation:draft",
    "observation:approve",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
    "intake:read",
    "intake:update",
  ],
  pharmacy: [
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
    "intake:read",
    "intake:update",
  ],
  physiotherapy: [
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
  ],
  "occupational-therapy": [
    "patient:read",
    "task:read",
    "task:update",
    "task:create",
    "note:draft",
    "note:approve",
    "communication:read",
    "communication:create",
    "communication:respond",
    "handover:read",
    "round:read",
    "round:decide",
  ],
  transport: ["task:read", "task:update"],
  service: ["task:read", "task:update"],
  administration: [
    "patient:administrative-read",
    "task:read",
    "task:update",
    "intake:read",
    "intake:update",
  ],
  management: ["analytics:aggregate"],
  hr: [],
  it: ["provider:operate", "audit:verify"],
  "quality-safety": ["audit:verify", "analytics:aggregate"],
};

export const qualificationSchema = z.enum([
  "clinical-observation-independent-review",
  "clinical-note-independent-review",
]);

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

const workflowStepSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{2,64}$/),
    kind: z.enum([
      "orientation",
      "context-selection",
      "work-queue",
      "documentation",
      "review",
      "handover",
      "reconciliation",
      "completion",
    ]),
    title: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(400),
  })
  .strict();

export const workflowDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    steps: z.array(workflowStepSchema).min(2).max(24),
  })
  .strict()
  .superRefine((definition, context) => {
    const ids = new Set<string>();
    for (const [index, step] of definition.steps.entries()) {
      if (ids.has(step.id))
        context.addIssue({
          code: "custom",
          path: ["steps", index, "id"],
          message: "Workflow step ids must be unique.",
        });
      ids.add(step.id);
    }
    if (definition.steps.at(-1)?.kind !== "completion")
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "A workflow must end with a completion step.",
      });
  });
export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;

const workflowSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    eligibleRoles: z.array(roleSchema).min(1),
    version: z.number().int().positive(),
    definition: workflowDefinitionSchema,
  })
  .strict();

export const siteConfigurationSchema = z
  .object({
    schemaVersion: z.literal(1),
    institutionId: z.string().regex(/^[a-z0-9-]+$/),
    siteId: z.string().regex(/^[a-z0-9-]+$/),
    displayName: z.string().trim().min(1).max(120),
    timeZone: z.string().regex(/^Europe\/[A-Za-z_-]+$/),
    sessionTtlHours: z.number().int().min(1).max(24),
    department: z
      .object({
        id: z.string().regex(/^[a-z0-9-]+$/),
        displayName: z.string().trim().min(1).max(120),
      })
      .strict(),
    activeShiftId: z.string().regex(/^[a-z0-9-]+$/),
    shifts: z.record(
      z.string().regex(/^[a-z0-9-]+$/),
      z
        .object({
          name: z.string().trim().min(1).max(80),
          startsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          endsAt: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
          nextResponsibleActorId: z.string().regex(/^[a-z0-9-]+$/),
        })
        .strict(),
    ),
    providerRoutes: z
      .object({
        patientRead: z.enum(["wicare", "carecoach"]),
        careDocumentation: z.enum(["wicare", "carecoach"]),
        observations: z.enum([
          "wicare",
          "carecoach",
          "sap-vitals",
          "device-gateway",
        ]),
        administration: z.enum(["wicare", "carecoach", "sap"]),
      })
      .strict(),
    staffAssignments: z.array(
      z
        .object({
          actorId: z.string().regex(/^[a-z0-9-]+$/),
          role: roleSchema,
          shiftId: z.string().regex(/^[a-z0-9-]+$/),
          patientIds: z
            .array(z.string().regex(/^[a-z0-9-]+$/))
            .min(1)
            .max(40),
        })
        .strict(),
    ),
    actorQualifications: z
      .record(
        z.string().regex(/^[a-z0-9-]+$/),
        z.array(qualificationSchema).max(20),
      )
      .default({}),
    roleProfiles: z.record(
      roleSchema,
      z
        .object({
          workflowId: z.string().regex(/^[a-z0-9-]+$/),
          actions: z.array(actionSchema),
        })
        .strict(),
    ),
    workflows: z.record(z.string().regex(/^[a-z0-9-]+$/), workflowSchema),
    nursingAssignments: z
      .array(
        z
          .object({
            patientId: z.string().regex(/^[a-z0-9-]+$/),
            title: z.string().trim().min(3).max(160),
            reason: z.string().trim().min(3).max(240),
            window: z.string().trim().min(3).max(40),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((configuration, context) => {
    if (!configuration.shifts[configuration.activeShiftId])
      context.addIssue({
        code: "custom",
        path: ["activeShiftId"],
        message: "Active shift must reference a configured shift.",
      });
    for (const [role, profile] of Object.entries(configuration.roleProfiles)) {
      const workflow = configuration.workflows[profile.workflowId];
      if (!workflow || !workflow.eligibleRoles.includes(role as Role))
        context.addIssue({
          code: "custom",
          path: ["roleProfiles", role, "workflowId"],
          message: "Role must reference an eligible published workflow.",
        });
      const ceiling = new Set(ROLE_ACTION_CEILINGS[role as Role]);
      for (const [index, action] of profile.actions.entries())
        if (!ceiling.has(action))
          context.addIssue({
            code: "custom",
            path: ["roleProfiles", role, "actions", index],
            message: `Site policy cannot grant ${action} to ${role}.`,
          });
    }
    const patientIds = configuration.nursingAssignments.map(
      (assignment) => assignment.patientId,
    );
    if (new Set(patientIds).size !== patientIds.length)
      context.addIssue({
        code: "custom",
        path: ["nursingAssignments"],
        message: "Nursing assignments must reference unique patients.",
      });
    const actorIds = configuration.staffAssignments.map(
      (assignment) => assignment.actorId,
    );
    if (new Set(actorIds).size !== actorIds.length)
      context.addIssue({
        code: "custom",
        path: ["staffAssignments"],
        message: "Staff assignments must reference unique actors.",
      });
    for (const [
      index,
      assignment,
    ] of configuration.staffAssignments.entries()) {
      if (!configuration.shifts[assignment.shiftId])
        context.addIssue({
          code: "custom",
          path: ["staffAssignments", index, "shiftId"],
          message: "Staff assignment must reference a configured shift.",
        });
      for (const patientId of assignment.patientIds)
        if (!patientIds.includes(patientId))
          context.addIssue({
            code: "custom",
            path: ["staffAssignments", index, "patientIds"],
            message:
              "Staff assignment patient must exist in nursing assignments.",
          });
    }
    for (const [shiftId, shift] of Object.entries(configuration.shifts))
      if (
        !configuration.staffAssignments.some(
          (assignment) => assignment.actorId === shift.nextResponsibleActorId,
        )
      )
        context.addIssue({
          code: "custom",
          path: ["shifts", shiftId, "nextResponsibleActorId"],
          message:
            "Next responsible actor must reference a configured staff assignment.",
        });
  });

export type SiteConfiguration = z.infer<typeof siteConfigurationSchema>;
export function parseSiteConfiguration(input: unknown): SiteConfiguration {
  return siteConfigurationSchema.parse(input);
}

const defaultSitePackPath = fileURLToPath(
  new URL("../../config/sites/tertianum-kronenhof.json", import.meta.url),
);
export const activeSitePackPath =
  process.env.PFH_SITE_PACK_PATH ?? defaultSitePackPath;
export const siteConfiguration = parseSiteConfiguration(
  JSON.parse(readFileSync(activeSitePackPath, "utf8")) as unknown,
);
export const nursingPatientIds = siteConfiguration.nursingAssignments.map(
  (assignment) => assignment.patientId,
);
