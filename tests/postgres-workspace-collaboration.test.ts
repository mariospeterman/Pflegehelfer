import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  WorkspaceAttachment,
  WorkspaceComment,
  WorkspaceProfileProposal,
} from "../src/core/workspace.js";
import { PostgresOperationalStore } from "../src/infrastructure/operational-store.js";

const databaseUrl = process.env.PFH_OPERATIONAL_DATABASE_URL;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

describe.runIf(Boolean(databaseUrl))(
  "PostgreSQL workspace collaboration",
  () => {
    it("restores scoped comments, attachment bytes, and reviewed profile fields after restart", async () => {
      const commentId = randomUUID();
      const attachmentId = randomUUID();
      const proposalId = randomUUID();
      const memberIds = ["u-nurse", "u-assistant"];
      const first = new PostgresOperationalStore(databaseUrl!);
      try {
        await first.initialize();
        await first.resetDemoState();
        const comment: WorkspaceComment = {
          id: commentId,
          patientId: "p-anna",
          authorId: "u-nurse",
          body: "Synthetischer PostgreSQL-Kommentar",
          audience: { kind: "patient-team", memberIds },
          recipientIds: ["u-assistant"],
          recipientRoleIds: ["care-assistant"],
          topicIds: ["mobilitaet"],
          parentId: null,
          createdAt: new Date().toISOString(),
          unread: false,
        };
        await first.createWorkspaceComment({
          record: comment,
          commandKey: `test-comment:${commentId}`,
          requestHash: hash("comment"),
        });
        const attachment: WorkspaceAttachment = {
          id: attachmentId,
          patientId: "p-anna",
          uploadedBy: "u-nurse",
          fileName: "synthetic.txt",
          mediaType: "text/plain",
          size: 4,
          sha256:
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          audience: { kind: "private", memberIds: ["u-nurse"] },
          topicIds: [],
          state: "available",
          createdAt: new Date().toISOString(),
          withdrawnAt: null,
        };
        await first.storeWorkspaceAttachment({
          record: attachment,
          bytes: Buffer.from("test"),
          commandKey: `test-attachment:${attachmentId}`,
          requestHash: hash("attachment"),
        });
        const proposal: WorkspaceProfileProposal = {
          id: proposalId,
          patientId: "p-anna",
          fieldKey: "care-preference",
          label: "Pflegepräferenz",
          currentValue: null,
          proposedValue: "Synthetische Präferenz",
          expectedVersion: 0,
          sourceLabel: "isolierter PostgreSQL-Test",
          audience: { kind: "patient-team", memberIds },
          actorId: "u-nurse",
          state: "pending",
          createdAt: new Date().toISOString(),
          acceptedAt: null,
        };
        await first.prepareWorkspaceProfileUpdate({
          proposal,
          commandKey: `test-profile-prepare:${proposalId}`,
          requestHash: hash("prepare"),
        });
        await expect(
          first.acceptWorkspaceProfileUpdate({
            actorId: "u-nurse",
            proposalId,
            visiblePatientIds: [],
            commandKey: `test-profile-denied:${proposalId}`,
            requestHash: hash("denied"),
          }),
        ).rejects.toMatchObject({ code: "NOT_FOUND" });
        await first.acceptWorkspaceProfileUpdate({
          actorId: "u-nurse",
          proposalId,
          visiblePatientIds: ["p-anna"],
          commandKey: `test-profile-accept:${proposalId}`,
          requestHash: hash("accept"),
        });
      } finally {
        await first.close();
      }

      const restored = new PostgresOperationalStore(databaseUrl!);
      try {
        await restored.initialize();
        await expect(
          restored.listWorkspaceComments({
            actorId: "u-assistant",
            visiblePatientIds: ["p-anna"],
          }),
        ).resolves.toEqual([
          expect.objectContaining({ id: commentId, unread: true }),
        ]);
        const restoredAttachment = await restored.loadWorkspaceAttachment(
          "u-nurse",
          attachmentId,
          ["p-anna"],
        );
        expect(restoredAttachment?.record).toMatchObject({
          id: attachmentId,
          sha256:
            "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
        });
        expect(Buffer.from(restoredAttachment?.bytes ?? [])).toEqual(
          Buffer.from("test"),
        );
        await expect(
          restored.listWorkspaceProfileFields(["p-anna"]),
        ).resolves.toEqual([
          expect.objectContaining({
            patientId: "p-anna",
            value: "Synthetische Präferenz",
            version: 1,
          }),
        ]);
      } finally {
        await restored.close();
      }
    });
  },
);
