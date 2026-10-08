import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveAssistantResponse } from "../src/core/assistant-service.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";

describe("assistant request ownership fencing", () => {
  afterEach(() => vi.useRealTimers());

  it("fails closed for malformed legacy archives and nested capabilities", () => {
    const archived = archiveAssistantResponse({
      id: randomUUID(),
      classification: { intent: "draft-note" },
      runtime: { route: "assistant", label: "legacy", degraded: false },
      patientContext: null,
      components: [
        {
          type: "AssistantText",
          message: "Historischer Inhalt",
          metadata: { intentToken: randomUUID() },
        },
      ],
      evidence: [],
      warnings: [],
      openUi: `DraftActionCard("${randomUUID()}")`,
      legacy: { intentToken: randomUUID() },
    });
    expect(JSON.stringify(archived)).not.toMatch(/intentToken|DraftActionCard/);
    expect(archived.components).toEqual([
      expect.objectContaining({ type: "SafetyAlert" }),
    ]);
    expect(() =>
      archiveAssistantResponse({ id: "malformed", openUi: "token" }),
    ).not.toThrow();
  });

  it("prevents an expired holder from completing or releasing its replacement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T08:00:00.000Z"));
    const store = new InMemoryOperationalStore();
    const actorId = "u-nurse";
    const role = "registered-nurse" as const;
    await store.getOrStartSession(actorId, role);
    const context = await store.bindAssistantContext(
      actorId,
      role,
      randomUUID(),
      "p-anna",
      "enc-anna-2026",
    );
    const identity = {
      commandId: randomUUID(),
      requestHash: "a".repeat(64),
      actorId,
      role,
      context,
    };
    const first = await store.claimAssistantRequest(identity);
    expect(first).toMatchObject({ state: "claimed" });

    vi.advanceTimersByTime(30_001);
    const replacement = await store.claimAssistantRequest(identity);
    expect(replacement).toMatchObject({ state: "claimed" });
    expect(replacement.holderId).not.toBe(first.holderId);

    const turn = {
      id: randomUUID(),
      prompt: "Synthetische Anfrage",
      response: { components: [], openUi: "" },
      createdAt: new Date().toISOString(),
      inputModality: "typed" as const,
      originPatientId: context.patientId,
      originEncounterId: context.encounterId,
      originThreadId: context.threadId,
      originContextRevision: context.contextRevision,
    };
    await expect(
      store.appendConversationTurn(actorId, role, turn, context, {
        ...identity,
        holderId: first.holderId!,
        response: turn.response as never,
      }),
    ).rejects.toThrow("ASSISTANT_REQUEST_CLAIM_STALE");

    await store.releaseAssistantRequest(identity, first.holderId!);
    expect(
      await store.renewAssistantRequest(identity, replacement.holderId!),
    ).toBe(true);
    await store.appendConversationTurn(actorId, role, turn, context, {
      ...identity,
      holderId: replacement.holderId!,
      response: turn.response as never,
    });
    expect(await store.claimAssistantRequest(identity)).toMatchObject({
      state: "completed",
      response: {
        ...turn.response,
        openUi: "root = ClinicalStack([])",
      },
    });
  });

  it("retains logical identity after release and rejects a changed retry", async () => {
    const store = new InMemoryOperationalStore();
    const actorId = "u-nurse";
    const role = "registered-nurse" as const;
    await store.getOrStartSession(actorId, role);
    const context = await store.bindAssistantContext(
      actorId,
      role,
      randomUUID(),
      null,
    );
    const identity = {
      commandId: randomUUID(),
      requestHash: "b".repeat(64),
      actorId,
      role,
      context,
    };
    const claim = await store.claimAssistantRequest(identity);
    await store.releaseAssistantRequest(identity, claim.holderId!);

    expect(() =>
      store.claimAssistantRequest({ ...identity, requestHash: "c".repeat(64) }),
    ).toThrow("Befehls-ID wurde bereits");
    expect(await store.claimAssistantRequest(identity)).toMatchObject({
      state: "claimed",
    });
  });
});
