import type { WorkflowState } from "./service.js";
import { siteConfiguration } from "./site-config.js";
import type { Role } from "./types.js";
import { baselineDemoScenario } from "./demo-scenario.js";

let activeState: WorkflowState | null = null;
let overriddenActors = new Set<string>();

/**
 * Installs only the materialized synthetic run's assignment/read model. Site
 * roles, shifts and permission ceilings remain owned by the published site
 * pack; a scenario can change who is assigned, never what a role may do.
 */
export function installDemoScenarioRuntime(state: WorkflowState): void {
  activeState = structuredClone(state);
  overriddenActors = new Set(
    state.users
      .filter((actor) => {
        const baseline = baselineDemoScenario.state.users.find(
          (candidate) => candidate.id === actor.id,
        );
        return (
          baseline !== undefined &&
          JSON.stringify(actor.patientIds) !==
            JSON.stringify(baseline.patientIds)
        );
      })
      .map((actor) => actor.id),
  );
}

export function activeStaffAssignment(actorId: string, role: Role) {
  const configured = siteConfiguration.staffAssignments.find(
    (candidate) => candidate.actorId === actorId && candidate.role === role,
  );
  if (!configured) return null;
  const actor = activeState?.users.find(
    (candidate) => candidate.id === actorId,
  );
  return {
    ...configured,
    patientIds:
      actor && overriddenActors.has(actorId)
        ? [...actor.patientIds]
        : [...configured.patientIds],
  };
}

export function activeNursingAssignment(patientId: string) {
  const configured = siteConfiguration.nursingAssignments.find(
    (candidate) => candidate.patientId === patientId,
  );
  if (configured) return configured;
  const task = activeState?.tasks.find(
    (candidate) =>
      candidate.patientId === patientId &&
      ["care-assistant", "registered-nurse"].includes(candidate.ownerRole) &&
      candidate.state !== "completed",
  );
  if (!task) return null;
  const due = new Intl.DateTimeFormat("de-CH", {
    timeZone: siteConfiguration.timeZone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(task.dueAt));
  return {
    patientId,
    title: task.title,
    reason: task.reason,
    window: `Bis ${due}`,
  };
}
