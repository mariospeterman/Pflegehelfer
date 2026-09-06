import { createHash } from "node:crypto";
import { z } from "zod";
import type { Role } from "./types.js";

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

const nursingSteps: WorkflowDefinition["steps"] = [
  { id: "handover", kind: "handover", title: "Übergabe", prompt: "Übergabe" },
  {
    id: "prioritize",
    kind: "work-queue",
    title: "Priorisieren",
    prompt: "Was ist heute wichtig?",
  },
  {
    id: "patient",
    kind: "context-selection",
    title: "Patient wählen",
    prompt: "Patientenkontext wählen",
  },
  {
    id: "work",
    kind: "work-queue",
    title: "Arbeit durchführen",
    prompt: "Was ist noch offen?",
  },
  {
    id: "document",
    kind: "documentation",
    title: "Dokumentieren",
    prompt: "Was soll ich dokumentieren?",
  },
  {
    id: "communicate",
    kind: "work-queue",
    title: "Kommunizieren",
    prompt: "Welche Teamfragen sind offen?",
  },
  {
    id: "review",
    kind: "review",
    title: "Prüfen",
    prompt: "Welche Entwürfe warten auf Prüfung?",
  },
  {
    id: "prepare-handover",
    kind: "handover",
    title: "Übergabe vorbereiten",
    prompt: "Übergabe vorbereiten",
  },
  {
    id: "reconcile",
    kind: "reconciliation",
    title: "Synchronisation prüfen",
    prompt: "Was wartet auf Synchronisation?",
  },
  {
    id: "complete",
    kind: "completion",
    title: "Arbeitstag abschliessen",
    prompt: "Arbeitstag abschliessen",
  },
];

const physicianSteps: WorkflowDefinition["steps"] = [
  {
    id: "questions",
    kind: "work-queue",
    title: "Anfragen",
    prompt: "Welche Teamfragen sind offen?",
  },
  {
    id: "patient",
    kind: "context-selection",
    title: "Patient wählen",
    prompt: "Patientenkontext wählen",
  },
  {
    id: "evidence",
    kind: "orientation",
    title: "Evidenz prüfen",
    prompt: "Patientenprofil und letzte Vitalwerte",
  },
  {
    id: "decision",
    kind: "review",
    title: "Antwort oder Folgeauftrag",
    prompt: "Antwort vorbereiten",
  },
  {
    id: "complete",
    kind: "completion",
    title: "Runde abschliessen",
    prompt: "Runde abschliessen",
  },
];

const compactSteps: WorkflowDefinition["steps"] = [
  {
    id: "orientation",
    kind: "orientation",
    title: "Orientierung",
    prompt: "Was ist heute wichtig?",
  },
  {
    id: "assigned-work",
    kind: "work-queue",
    title: "Zugewiesene Arbeit",
    prompt: "Meine offenen Aufgaben",
  },
  {
    id: "complete",
    kind: "completion",
    title: "Abschliessen",
    prompt: "Arbeit abschliessen",
  },
];

export interface WorkflowTemplateSeed {
  id: string;
  name: string;
  eligibleRoles: Role[];
  version: number;
  definition: WorkflowDefinition;
  definitionHash: string;
}

export function workflowForRole(role: Role): WorkflowTemplateSeed {
  const definition = workflowDefinitionSchema.parse({
    schemaVersion: 1,
    steps:
      role === "physician"
        ? physicianSteps
        : ["care-assistant", "registered-nurse"].includes(role)
          ? nursingSteps
          : compactSteps,
  });
  const id =
    role === "physician"
      ? "physician-rounds"
      : ["care-assistant", "registered-nurse"].includes(role)
        ? "nursing-day"
        : `role-${role}`;
  return {
    id,
    name:
      role === "physician"
        ? "Ärztliche Runde"
        : ["care-assistant", "registered-nurse"].includes(role)
          ? "Pflegetag"
          : `${role} Arbeitsablauf`,
    eligibleRoles: ["care-assistant", "registered-nurse"].includes(role)
      ? ["care-assistant", "registered-nurse"]
      : [role],
    version: 1,
    definition,
    definitionHash: createHash("sha256")
      .update(JSON.stringify(definition))
      .digest("hex"),
  };
}
