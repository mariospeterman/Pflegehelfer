import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";

// Regression: ISSUE-005 — a running shift changed identity at facility midnight
// Found by /qa on 2026-09-14
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-13.md

afterEach(() => vi.useRealTimers());

describe("workday identity across midnight", () => {
  it("keeps the shift key bound to the session start", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-13T21:59:55.000Z"));
    const store = new InMemoryOperationalStore();
    const beforeMidnight = await store.getWorkday(
      "u-assistant",
      "care-assistant",
    );

    vi.setSystemTime(new Date("2026-09-13T22:00:05.000Z"));
    const afterMidnight = await store.getWorkday(
      "u-assistant",
      "care-assistant",
    );

    expect(afterMidnight.sessionId).toBe(beforeMidnight.sessionId);
    expect(afterMidnight.handover.id).toBe(beforeMidnight.handover.id);
    expect(afterMidnight.handover.shiftKey).toBe(
      beforeMidnight.handover.shiftKey,
    );
    expect(afterMidnight.handover.shiftKey).toContain("2026-09-13");
  });
});
