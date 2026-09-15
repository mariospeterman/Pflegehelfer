import { describe, expect, it } from "vitest";
import {
  bindVoiceTranscriptProvenance,
  deterministicAssistantProposal,
  reviseAssistantProposal,
  verifyProposalSourceRecords,
} from "../src/ai/assistant-proposal.js";
import { ModelGateway } from "../src/ai/model-gateway.js";
import {
  AssistantService,
  type AssistantResponse,
} from "../src/core/assistant-service.js";
import type { IntentExecutionContext } from "../src/core/assistant.js";
import { PflegehelferService } from "../src/core/service.js";
import {
  createVoiceTranscriptProvenance,
  parseVoiceTranscriptProvenance,
  transcriptHash,
} from "../src/core/voice-provenance.js";

const originalTranscript = "Luca mobilisiert, etwa 250 ml getrunken.";
const reviewedTranscript = "Luca mobilisiert, etwa 150 ml getrunken.";

function provenance() {
  return createVoiceTranscriptProvenance({
    original: {
      transcript: originalTranscript,
      transcriptHash: transcriptHash(originalTranscript),
      capturedAt: "2026-09-14T08:00:00.000Z",
      source: {
        kind: "asr",
        mode: "local-openai",
        model: "whisper-large-v3-turbo@sha256:synthetic",
        language: "de-CH",
        confidence: 0.82,
        confidenceState: "reported",
        audioRetained: false,
      },
    },
    reviewedTranscript,
    reviewedAt: "2026-09-14T08:01:00.000Z",
  });
}

function draftAction(response: AssistantResponse) {
  const component = response.components.find(
    (candidate) => candidate.type === "DraftAction",
  );
  if (!component || component.type !== "DraftAction")
    throw new Error("Expected a bounded draft action");
  return component;
}

describe("durable voice transcript provenance", () => {
  it("keeps immutable ASR capture separate from the reviewed correction", () => {
    const base = deterministicAssistantProposal(reviewedTranscript, {
      inputTimestamp: "2026-09-14T08:01:00.000Z",
    });
    if (!base) throw new Error("Expected proposal");
    const bound = bindVoiceTranscriptProvenance(base, provenance());

    expect(() => verifyProposalSourceRecords(bound)).not.toThrow();
    expect(bound.inputModality).toBe("voice");
    expect(bound.voiceTranscriptProvenance).toEqual([provenance()]);
    expect(bound.sourceRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modality: "voice",
          origin: "asr-original",
          text: originalTranscript,
        }),
        expect.objectContaining({
          modality: "voice",
          origin: "voice-review",
          text: reviewedTranscript,
        }),
      ]),
    );
    const reviewedSource = bound.sourceRecords?.find(
      (source) => source.origin === "voice-review",
    );
    expect(
      bound.actions.every((action) =>
        action.sourceRecordIds?.includes(reviewedSource!.id),
      ),
    ).toBe(true);
    expect(JSON.stringify(bound)).not.toMatch(
      /audio(?:Bytes|Data|Content)|data:audio/i,
    );
  });

  it("carries original, review and model provenance into the accepted note", async () => {
    const clinical = new PflegehelferService();
    const assistant = new AssistantService(
      clinical,
      new ModelGateway({ PFH_AI_MODE: "deterministic" }),
    );
    const response = await assistant.query("u-assistant", {
      patientId: "p-luca",
      purpose: "direct-care",
      prompt: reviewedTranscript,
      inputModality: "voice",
      voiceTranscriptConfirmed: true,
      voiceTranscriptProvenance: provenance(),
    });
    const draft = draftAction(response);
    expect(draft.kind).toBe("care-update");
    const context: IntentExecutionContext = {
      patientId: response.patientContext!.patientId,
      encounterId: response.patientContext!.encounterId,
      purpose: "direct-care",
      resourceVersion: response.patientContext!.resourceVersion,
      explicitlyConfirmed: true,
      reviewedActionIds: draft.reviewItems!.map((item) => item.id),
    };
    assistant.executeIntent("u-assistant", draft.intentToken, context);

    const accepted = clinical
      .snapshot("u-assistant", "direct-care")
      .notes.findLast((note) => note.authorId === "u-assistant");
    expect(accepted).toMatchObject({
      transcript: originalTranscript,
      structuredText: reviewedTranscript,
      voiceTranscriptProvenance: [
        {
          original: {
            transcript: originalTranscript,
            source: {
              kind: "asr",
              model: "whisper-large-v3-turbo@sha256:synthetic",
              audioRetained: false,
            },
          },
          review: {
            revision: 1,
            transcript: reviewedTranscript,
            corrected: true,
          },
        },
      ],
    });
  });

  it("retains each voice capture across a later corrected transcript", () => {
    const first = deterministicAssistantProposal(reviewedTranscript, {
      inputTimestamp: "2026-09-14T08:01:00.000Z",
    });
    if (!first) throw new Error("Expected proposal");
    const boundFirst = bindVoiceTranscriptProvenance(first, provenance());
    const secondOriginal = "Korrektur: eher 180 ml.";
    const secondReview = "Korrektur: eher 100 ml.";
    const revised = reviseAssistantProposal(boundFirst, secondReview, {
      inputTimestamp: "2026-09-14T08:06:00.000Z",
      inputModality: "voice",
    });
    if (!revised) throw new Error("Expected revision");
    const boundSecond = bindVoiceTranscriptProvenance(
      revised,
      createVoiceTranscriptProvenance({
        original: {
          transcript: secondOriginal,
          transcriptHash: transcriptHash(secondOriginal),
          capturedAt: "2026-09-14T08:05:00.000Z",
          source: {
            kind: "asr",
            mode: "local-openai",
            model: "whisper-large-v3-turbo@sha256:next",
            language: "de-CH",
            confidence: null,
            confidenceState: "unknown",
            audioRetained: false,
          },
        },
        reviewedTranscript: secondReview,
        reviewedAt: "2026-09-14T08:06:00.000Z",
      }),
    );

    expect(() => verifyProposalSourceRecords(boundSecond)).not.toThrow();
    expect(boundSecond.voiceTranscriptProvenance).toHaveLength(2);
    expect(
      boundSecond.voiceTranscriptProvenance?.map(
        (item) => item.original.source.model,
      ),
    ).toEqual([
      "whisper-large-v3-turbo@sha256:synthetic",
      "whisper-large-v3-turbo@sha256:next",
    ]);
    expect(
      boundSecond.sourceRecords?.filter(
        (source) => source.origin === "asr-original",
      ),
    ).toHaveLength(2);
  });

  it("does not discard the voice source when a typed correction replaces the work", () => {
    const first = deterministicAssistantProposal(reviewedTranscript, {
      inputTimestamp: "2026-09-14T08:01:00.000Z",
    });
    if (!first) throw new Error("Expected proposal");
    const bound = bindVoiceTranscriptProvenance(first, provenance());
    const replacement = reviseAssistantProposal(
      bound,
      "Nur Morgenpflege erledigt, Mobilisation später.",
      {
        inputTimestamp: "2026-09-14T08:10:00.000Z",
        inputModality: "typed",
      },
    );

    expect(() => verifyProposalSourceRecords(replacement)).not.toThrow();
    expect(replacement?.inputModality).toBe("typed");
    expect(replacement?.voiceTranscriptProvenance).toEqual([provenance()]);
    expect(
      replacement?.sourceRecords?.some(
        (source) =>
          source.origin === "asr-original" &&
          source.text === originalTranscript,
      ),
    ).toBe(true);
  });

  it("rejects tampered transcript lineage and voice input without lineage", async () => {
    const voice = provenance();
    expect(() =>
      parseVoiceTranscriptProvenance({
        ...voice,
        review: { ...voice.review, transcript: "Manipuliert" },
      }),
    ).toThrow();

    await expect(
      new AssistantService(
        new PflegehelferService(),
        new ModelGateway({ PFH_AI_MODE: "deterministic" }),
      ).query("u-assistant", {
        patientId: "p-luca",
        purpose: "direct-care",
        prompt: reviewedTranscript,
        inputModality: "voice",
        voiceTranscriptConfirmed: true,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
