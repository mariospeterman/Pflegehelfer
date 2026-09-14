import { createHash } from "node:crypto";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const voiceTranscriptOriginalSchema = z
  .object({
    transcript: z.string().trim().min(1).max(8000),
    transcriptHash: sha256Schema,
    capturedAt: z.string().datetime(),
    source: z
      .object({
        kind: z.literal("asr"),
        mode: z.enum(["browser-demo", "hosted-test", "local-openai"]),
        model: z.string().trim().min(1).max(200),
        language: z.string().trim().min(1).max(20),
        confidence: z.number().min(0).max(1).nullable(),
        confidenceState: z.enum(["reported", "unknown"]),
        audioRetained: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const voiceTranscriptProvenanceSchema = z
  .object({
    original: voiceTranscriptOriginalSchema,
    review: z
      .object({
        revision: z.literal(1),
        transcript: z.string().trim().min(1).max(1200),
        transcriptHash: sha256Schema,
        reviewedAt: z.string().datetime(),
        corrected: z.boolean(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const originalHash = transcriptHash(value.original.transcript);
    const reviewedHash = transcriptHash(value.review.transcript);
    if (originalHash !== value.original.transcriptHash)
      context.addIssue({
        code: "custom",
        path: ["original", "transcriptHash"],
        message: "Original ASR transcript hash does not match.",
      });
    if (reviewedHash !== value.review.transcriptHash)
      context.addIssue({
        code: "custom",
        path: ["review", "transcriptHash"],
        message: "Reviewed transcript hash does not match.",
      });
    if (
      value.review.corrected !==
      (value.original.transcript !== value.review.transcript)
    )
      context.addIssue({
        code: "custom",
        path: ["review", "corrected"],
        message: "Transcript correction flag does not match the revision.",
      });
  });

export type VoiceTranscriptOriginal = z.infer<
  typeof voiceTranscriptOriginalSchema
>;
export type VoiceTranscriptProvenance = z.infer<
  typeof voiceTranscriptProvenanceSchema
>;

export function transcriptHash(transcript: string): string {
  return createHash("sha256").update(transcript).digest("hex");
}

export function createVoiceTranscriptProvenance(input: {
  original: VoiceTranscriptOriginal;
  reviewedTranscript: string;
  reviewedAt?: string;
}): VoiceTranscriptProvenance {
  const reviewedTranscript = input.reviewedTranscript.trim();
  return voiceTranscriptProvenanceSchema.parse({
    original: input.original,
    review: {
      revision: 1,
      transcript: reviewedTranscript,
      transcriptHash: transcriptHash(reviewedTranscript),
      reviewedAt: input.reviewedAt ?? new Date().toISOString(),
      corrected: input.original.transcript !== reviewedTranscript,
    },
  });
}

export function parseVoiceTranscriptProvenance(
  input: unknown,
): VoiceTranscriptProvenance {
  return voiceTranscriptProvenanceSchema.parse(input);
}
