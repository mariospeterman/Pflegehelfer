import { createHash } from "node:crypto";
import type {
  WorkspaceAttachment,
  WorkspaceComment,
  WorkspaceProject,
} from "../core/workspace.js";
import { nursingPatientIds } from "../core/site-config.js";
import type { OperationalStore } from "./operational-store.js";

const demoTimestamp = "2026-09-05T07:35:00.000Z";

const directComment: WorkspaceComment = {
  id: "10000000-0000-4000-8000-000000000001",
  patientId: null,
  authorId: "u-nurse",
  body: "Frühdienst ist vollständig besetzt. Bitte zuerst die patientenweise Übergabe prüfen; melde Unterbrechungen direkt im laufenden Arbeitstag.",
  audience: { kind: "direct", memberIds: ["u-nurse", "u-assistant"] },
  recipientIds: ["u-assistant"],
  recipientRoleIds: [],
  topicIds: [],
  parentId: null,
  createdAt: demoTimestamp,
  unread: true,
};

const patientComment: WorkspaceComment = {
  id: "10000000-0000-4000-8000-000000000002",
  patientId: "p-anna",
  authorId: "u-physio",
  body: "@Lea: Bitte Anna vor der Therapie um 09:15 am Rollator mobilisieren. Bei erneutem Schwindel pausieren und Nora informieren.",
  audience: {
    kind: "patient-team",
    memberIds: ["u-assistant", "u-nurse", "u-nurse-evening", "u-physio"],
  },
  recipientIds: ["u-assistant", "u-nurse"],
  recipientRoleIds: ["care-assistant", "registered-nurse"],
  topicIds: ["mobilitaet"],
  parentId: null,
  createdAt: "2026-09-05T07:38:00.000Z",
  unread: true,
};

const checklistBytes = new TextEncoder().encode(
  [
    "SYNTHETISCHE DEMO — keine echten Patientendaten",
    "Frühdienst: Übergabe vollständig und patientenweise prüfen.",
    "Bei Abweichungen oder Unterbrechungen zuständige Pflegefachperson informieren.",
    "Nur tatsächlich ausgeführte Arbeit dokumentieren.",
  ].join("\n"),
);
const checklist: WorkspaceAttachment = {
  id: "20000000-0000-4000-8000-000000000001",
  patientId: null,
  uploadedBy: "u-assistant",
  fileName: "Fruehdienst-Checkliste-SYNTHETISCHE-DEMO.txt",
  mediaType: "text/plain",
  size: checklistBytes.byteLength,
  sha256: createHash("sha256").update(checklistBytes).digest("hex"),
  audience: { kind: "private", memberIds: ["u-assistant"] },
  topicIds: [],
  state: "available",
  createdAt: "2026-09-05T07:30:00.000Z",
  withdrawnAt: null,
};

const project: WorkspaceProject = {
  id: "30000000-0000-4000-8000-000000000001",
  title: "Morgenmobilisation koordinieren",
  purpose:
    "Synthetische Demo für die abgestimmte Vorbereitung der morgendlichen Mobilisation im Reha-Team.",
  ownerId: "u-assistant",
  memberIds: ["u-assistant", "u-nurse", "u-physio"],
  status: "active",
  links: [{ kind: "task", id: "t-mobilise-luca" }],
  version: 1,
  createdAt: "2026-09-05T07:25:00.000Z",
  updatedAt: "2026-09-05T07:25:00.000Z",
};

const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function seedSyntheticDemoWorkspace(
  store: OperationalStore,
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

  for (const record of [directComment, patientComment])
    if (!comments.some((item) => item.id === record.id))
      await store.createWorkspaceComment({
        record,
        commandKey: `demo-seed-comment-${record.id}`,
        requestHash: requestHash(record),
      });

  if (!attachments.some((item) => item.id === checklist.id))
    await store.storeWorkspaceAttachment({
      record: checklist,
      bytes: checklistBytes,
      commandKey: `demo-seed-attachment-${checklist.id}`,
      requestHash: requestHash(checklist),
    });

  if (!projects.some((item) => item.id === project.id))
    await store.createWorkspaceProject({
      record: project,
      commandKey: `demo-seed-project-${project.id}`,
      requestHash: requestHash(project),
    });
}
