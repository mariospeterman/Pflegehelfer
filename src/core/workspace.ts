import { z } from "zod";

const idSchema = z.string().uuid();
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);

export const workspaceAudienceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("private"),
      memberIds: z.array(z.string().min(1).max(120)).length(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("patient-team"),
      memberIds: z.array(z.string().min(1).max(120)).max(40),
    })
    .strict(),
  z
    .object({
      kind: z.literal("direct"),
      memberIds: z.array(z.string().min(1).max(120)).min(2).max(2),
    })
    .strict(),
  z
    .object({
      kind: z.literal("department"),
      memberIds: z.array(z.string().min(1).max(120)).max(80),
    })
    .strict(),
]);

export type WorkspaceAudience = z.infer<typeof workspaceAudienceSchema>;

export const workspaceCommentSchema = z
  .object({
    id: idSchema,
    patientId: z.string().min(1).max(120).nullable(),
    authorId: z.string().min(1).max(120),
    body: boundedText(2000),
    audience: workspaceAudienceSchema,
    recipientIds: z.array(z.string().min(1).max(120)).max(12),
    recipientRoleIds: z.array(z.string().min(1).max(120)).max(12),
    topicIds: z.array(z.string().min(1).max(120)).max(12),
    parentId: idSchema.nullable(),
    createdAt: z.string().datetime(),
    unread: z.boolean(),
  })
  .strict();

export type WorkspaceComment = z.infer<typeof workspaceCommentSchema>;

export const workspaceAttachmentInspectionSchema = z
  .object({
    state: z.enum(["available", "unavailable", "failed"]),
    engine: z.enum(["none", "plain-text", "docling"]),
    engineVersion: z.string().max(120).nullable(),
    extractedText: z.string().max(100_000).nullable(),
    extractedTextSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    pageCount: z.number().int().positive().max(10_000).nullable(),
    inspectedAt: z.string().datetime(),
    message: z.string().min(1).max(500),
  })
  .strict();

export type WorkspaceAttachmentInspection = z.infer<
  typeof workspaceAttachmentInspectionSchema
>;

export const workspaceAttachmentSchema = z
  .object({
    id: idSchema,
    patientId: z.string().min(1).max(120).nullable(),
    uploadedBy: z.string().min(1).max(120),
    fileName: boundedText(180),
    mediaType: z.enum([
      "application/pdf",
      "image/png",
      "image/jpeg",
      "text/plain",
    ]),
    size: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    audience: workspaceAudienceSchema,
    topicIds: z.array(z.string().min(1).max(120)).max(12),
    state: z.enum(["available", "quarantined", "withdrawn"]),
    inspection: workspaceAttachmentInspectionSchema.optional(),
    createdAt: z.string().datetime(),
    withdrawnAt: z.string().datetime().nullable(),
  })
  .strict();

export type WorkspaceAttachment = z.infer<typeof workspaceAttachmentSchema>;

export const workspaceProjectLinkSchema = z
  .object({
    kind: z.enum(["task", "comment", "attachment"]),
    id: z.string().min(1).max(160),
  })
  .strict();

export const workspaceProjectSchema = z
  .object({
    id: idSchema,
    title: boundedText(160),
    purpose: boundedText(500),
    ownerId: z.string().min(1).max(120),
    memberIds: z.array(z.string().min(1).max(120)).min(1).max(40),
    status: z.enum(["active", "closed"]),
    links: z.array(workspaceProjectLinkSchema).max(200),
    version: z.number().int().positive(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type WorkspaceProject = z.infer<typeof workspaceProjectSchema>;
export type WorkspaceProjectLink = z.infer<typeof workspaceProjectLinkSchema>;

export const workspaceProfileFieldSchema = z
  .object({
    patientId: z.string().min(1).max(120),
    fieldKey: z.enum(["care-preference", "communication-preference"]),
    label: boundedText(120),
    value: boundedText(1000),
    version: z.number().int().positive(),
    sourceLabel: boundedText(240),
    updatedBy: z.string().min(1).max(120),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type WorkspaceProfileField = z.infer<typeof workspaceProfileFieldSchema>;

export const workspaceProfileProposalSchema = z
  .object({
    id: idSchema,
    patientId: z.string().min(1).max(120),
    fieldKey: workspaceProfileFieldSchema.shape.fieldKey,
    label: boundedText(120),
    currentValue: z.string().max(1000).nullable(),
    proposedValue: boundedText(1000),
    expectedVersion: z.number().int().nonnegative(),
    sourceLabel: boundedText(240),
    audience: workspaceAudienceSchema,
    actorId: z.string().min(1).max(120),
    state: z.enum(["pending", "accepted", "conflict", "discarded"]),
    createdAt: z.string().datetime(),
    acceptedAt: z.string().datetime().nullable(),
  })
  .strict();

export type WorkspaceProfileProposal = z.infer<
  typeof workspaceProfileProposalSchema
>;

export const demoWorkspaceSnapshotSchema = z
  .object({
    comments: z.array(workspaceCommentSchema).max(5_000),
    commentReads: z
      .array(
        z
          .object({
            commentId: idSchema,
            actorIds: z.array(z.string().min(1).max(120)).max(200),
          })
          .strict(),
      )
      .max(5_000),
    attachments: z
      .array(
        z
          .object({
            record: workspaceAttachmentSchema,
            contentBase64: z
              .string()
              .base64()
              .max(12 * 1024 * 1024),
          })
          .strict(),
      )
      .max(500),
    projects: z.array(workspaceProjectSchema).max(1_000),
    profileFields: z.array(workspaceProfileFieldSchema).max(5_000),
    profileProposals: z.array(workspaceProfileProposalSchema).max(5_000),
  })
  .strict();

export type DemoWorkspaceSnapshot = z.infer<typeof demoWorkspaceSnapshotSchema>;
