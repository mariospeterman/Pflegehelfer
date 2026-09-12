import { describe, expect, it } from "vitest";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";

describe("audience-bound durable UI events", () => {
  it("replays by cursor without exposing another actor", async () => {
    const store = new InMemoryOperationalStore();
    const first = await store.appendUiInvalidation("u-assistant", {
      reason: "task-changed",
    });
    await store.appendUiInvalidation("u-nurse", { reason: "private-change" });
    const third = await store.appendUiInvalidation("u-assistant", {
      reason: "note-changed",
    });

    expect(await store.listUiEventsAfter("u-assistant", 0)).toMatchObject([
      { id: first, payload: { reason: "task-changed" } },
      { id: third, payload: { reason: "note-changed" } },
    ]);
    expect(await store.listUiEventsAfter("u-assistant", first)).toMatchObject([
      { id: third },
    ]);
    expect(await store.listUiEventsAfter("u-nurse", 0)).toHaveLength(1);
  });
});
