import { describe, expect, it, vi } from "vitest";
import {
  resolveIntentExecutionAttempt,
  type IntentExecutionAttempt,
} from "../src/pwa/conversation/intent-execution-retry.js";

describe("assistant intent execution retry identity", () => {
  it("reuses the command id only for the exact same reviewed selection", () => {
    const attempts = new Map<string, IntentExecutionAttempt>();
    const createCommandId = vi.fn(() => "command-1");
    expect(
      resolveIntentExecutionAttempt(
        attempts,
        "intent-1",
        ["action-1", "action-2"],
        createCommandId,
      ),
    ).toEqual({ commandId: "command-1" });
    expect(
      resolveIntentExecutionAttempt(
        attempts,
        "intent-1",
        ["action-1", "action-2"],
        createCommandId,
      ),
    ).toEqual({ commandId: "command-1" });
    expect(createCommandId).toHaveBeenCalledTimes(1);
  });

  it("blocks a changed selection after an uncertain attempt", () => {
    const attempts = new Map<string, IntentExecutionAttempt>();
    resolveIntentExecutionAttempt(
      attempts,
      "intent-1",
      ["action-1"],
      () => "command-1",
    );
    expect(
      resolveIntentExecutionAttempt(
        attempts,
        "intent-1",
        ["action-1", "action-2"],
        () => "command-2",
      ),
    ).toEqual({ conflict: true });
  });
});
