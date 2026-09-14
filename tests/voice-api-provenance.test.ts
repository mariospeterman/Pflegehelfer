import { createHash, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { extractCriticalEntities } from "../src/core/critical-entities.js";
import { PflegehelferService } from "../src/core/service.js";
import {
  transcriptHash,
  voiceTranscriptOriginalSchema,
} from "../src/core/voice-provenance.js";
import {
  InMemoryOperationalStore,
  type DurableVoiceAuthority,
} from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const entityIds = (text: string) =>
  extractCriticalEntities(text)
    .map((entity) => `${entity.kind}:${entity.start}:${entity.end}`)
    .sort();

describe("voice transcript API provenance", () => {
  it("accepts an edited voice transcript only with reviewed offsets and keeps its ASR original", async () => {
    const actorId = "u-assistant";
    const tabId = randomUUID();
    const headers = {
      "x-demo-user": actorId,
      "x-pfh-client-context": tabId,
      "x-command-id": randomUUID(),
    };
    const service = new PflegehelferService();
    const store = new InMemoryOperationalStore();
    const app = buildApp(service, {
      demoMode: true,
      operationalStore: store,
    });
    apps.push(app);
    const selected = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/context",
      headers,
      payload: { patientId: "p-luca" },
    });
    expect(selected.statusCode).toBe(200);
    const context = await store.resolveAssistantContext(
      actorId,
      "care-assistant",
      tabId,
    );
    if (!context) throw new Error("Expected bound assistant context");

    const originalTranscript = "Luca mobilisiert, Puls 82 links.";
    const reviewedTranscript = "Luca vollständig mobilisiert, Puls 88 rechts.";
    const receiptId = randomUUID();
    const original = voiceTranscriptOriginalSchema.parse({
      transcript: originalTranscript,
      transcriptHash: transcriptHash(originalTranscript),
      capturedAt: "2026-09-14T08:00:00.000Z",
      source: {
        kind: "asr",
        mode: "local-openai",
        model: "whisper-large-v3-turbo@sha256:api-test",
        language: "de-CH",
        confidence: 0.72,
        confidenceState: "reported",
        audioRetained: false,
      },
    });
    const authority: DurableVoiceAuthority = {
      clientContextId: tabId,
      actorId,
      patientId: "p-luca",
      encounterId: context.encounterId,
      purpose: "direct-care",
      original,
      sessionId: context.sessionId,
      threadId: context.threadId,
      contextRevision: context.contextRevision,
      expiresAt: Date.now() + 60_000,
    };
    await store.storeVoiceAuthority(tokenHash(receiptId), authority);

    const staleConfirmation = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: { ...headers, "x-command-id": randomUUID() },
      payload: {
        patientId: "p-luca",
        prompt: reviewedTranscript,
        inputModality: "voice",
        voiceTranscriptConfirmed: true,
        voiceReceiptId: receiptId,
        voiceConfirmedEntityIds: entityIds(originalTranscript),
      },
    });
    expect(staleConfirmation.statusCode).toBe(403);

    const query = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/query",
      headers: { ...headers, "x-command-id": randomUUID() },
      payload: {
        patientId: "p-luca",
        prompt: reviewedTranscript,
        inputModality: "voice",
        voiceTranscriptConfirmed: true,
        voiceReceiptId: receiptId,
        voiceConfirmedEntityIds: entityIds(reviewedTranscript),
      },
    });
    expect(query.statusCode).toBe(200);
    const response = query.json<{
      patientContext: {
        patientId: string;
        encounterId: string;
        resourceVersion: number;
      };
      components: Array<{
        type: string;
        intentToken?: string;
        reviewItems?: Array<{ id: string }>;
      }>;
    }>();
    const review = response.components.find(
      (component) => component.type === "DraftAction",
    );
    expect(review?.intentToken).toBeTruthy();

    const accepted = await app.inject({
      method: "POST",
      url: `/api/v1/assistant/intents/${review!.intentToken}/execute`,
      headers: { ...headers, "x-command-id": randomUUID() },
      payload: {
        patientId: response.patientContext.patientId,
        encounterId: response.patientContext.encounterId,
        purpose: "direct-care",
        resourceVersion: response.patientContext.resourceVersion,
        explicitlyConfirmed: true,
        reviewedActionIds: review!.reviewItems!.map((item) => item.id),
      },
    });
    expect(accepted.statusCode).toBe(200);

    const note = service
      .snapshot(actorId, "direct-care")
      .notes.findLast((candidate) => candidate.authorId === actorId);
    expect(note).toMatchObject({
      transcript: originalTranscript,
      structuredText: reviewedTranscript,
      voiceTranscriptProvenance: [
        {
          original: {
            transcript: originalTranscript,
            source: {
              model: "whisper-large-v3-turbo@sha256:api-test",
              audioRetained: false,
            },
          },
          review: { transcript: reviewedTranscript, corrected: true },
        },
      ],
    });

    const conversation = await app.inject({
      method: "GET",
      url: "/api/v1/assistant/conversation",
      headers: { ...headers, "x-command-id": randomUUID() },
    });
    const turn = conversation
      .json<{
        turns: Array<{
          inputModality: string;
          voiceTranscriptProvenance?: unknown[];
        }>;
      }>()
      .turns.at(-1);
    expect(turn).toMatchObject({
      inputModality: "voice",
      voiceTranscriptProvenance: [
        {
          original: { transcript: originalTranscript },
          review: { transcript: reviewedTranscript, corrected: true },
        },
      ],
    });
    expect(JSON.stringify(turn)).not.toMatch(
      /audio(?:Bytes|Data|Content)|data:audio/i,
    );
  });
});
