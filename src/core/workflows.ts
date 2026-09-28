import { createHash } from "node:crypto";
import {
  siteConfiguration,
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "./site-config.js";
import type { Role } from "./types.js";

export { workflowDefinitionSchema, type WorkflowDefinition };

export interface WorkflowTemplateSeed {
  id: string;
  name: string;
  eligibleRoles: Role[];
  version: number;
  definition: WorkflowDefinition;
  definitionHash: string;
}

export function workflowForRole(role: Role): WorkflowTemplateSeed {
  const profile = siteConfiguration.roleProfiles[role];
  const configured = siteConfiguration.workflows[profile.workflowId];
  if (!configured) throw new Error(`WORKFLOW_NOT_CONFIGURED:${role}`);
  const definition = workflowDefinitionSchema.parse(configured.definition);
  return {
    id: profile.workflowId,
    name: configured.name,
    eligibleRoles: configured.eligibleRoles,
    version: configured.version,
    definition,
    definitionHash: createHash("sha256")
      .update(JSON.stringify(definition))
      .digest("hex"),
  };
}
