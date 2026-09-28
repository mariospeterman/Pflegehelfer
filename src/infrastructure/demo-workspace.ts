import { createHash } from "node:crypto";
import { nursingPatientIds } from "../core/site-config.js";
import { baselineDemoScenario } from "../core/demo-scenario.js";
import type { DemoWorkspaceSnapshot } from "../core/workspace.js";
import type { OperationalStore } from "./operational-store.js";

const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function seedSyntheticDemoWorkspace(
  store: OperationalStore,
  workspace: DemoWorkspaceSnapshot = baselineDemoScenario.workspace,
): Promise<void> {
  const [comments, attachments, projects] = await Promise.all([
    store.listWorkspaceComments({
      actorId: "u-assistant",
      visiblePatientIds: nursingPatientIds,
    }),
    store.listWorkspaceAttachments({
      actorId: "u-assistant",
      visiblePatientIds: nursingPatientIds,
    }),
    store.listWorkspaceProjects("u-assistant"),
  ]);

  for (const record of workspace.comments)
    if (!comments.some((item) => item.id === record.id))
      await store.createWorkspaceComment({
        record,
        commandKey: `demo-seed-comment-${record.id}`,
        requestHash: requestHash(record),
      });

  for (const attachment of workspace.attachments)
    if (!attachments.some((item) => item.id === attachment.record.id))
      await store.storeWorkspaceAttachment({
        record: attachment.record,
        bytes: Buffer.from(attachment.contentBase64, "base64"),
        commandKey: `demo-seed-attachment-${attachment.record.id}`,
        requestHash: requestHash(attachment.record),
      });

  for (const record of workspace.projects)
    if (!projects.some((item) => item.id === record.id))
      await store.createWorkspaceProject({
        record,
        commandKey: `demo-seed-project-${record.id}`,
        requestHash: requestHash(record),
      });
}
