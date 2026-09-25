import { describe, expect, it, vi } from "vitest";
import { createAssistantContextBindingCoordinator } from "../src/pwa/assistant-context.js";

describe("assistant context binding coordinator", () => {
  it("shares one in-flight binding for concurrent startup loads", async () => {
    const coordinator = createAssistantContextBindingCoordinator();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bind = vi.fn(() => blocked);
    const scope = { userId: "u-assistant", patientId: null };

    const first = coordinator.ensure(scope, bind);
    const second = coordinator.ensure(scope, bind);
    expect(bind).toHaveBeenCalledTimes(1);

    release();
    await Promise.all([first, second]);
    await coordinator.ensure(scope, bind);
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it("does not let a completed stale binding replace a newer scope", async () => {
    const coordinator = createAssistantContextBindingCoordinator();
    let releaseOld!: () => void;
    const oldBinding = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
    const oldRequest = coordinator.ensure(
      { userId: "u-assistant", patientId: "p-anna" },
      () => oldBinding,
    );

    coordinator.reset();
    const currentScope = { userId: "u-nurse", patientId: null };
    const currentBind = vi.fn(() => Promise.resolve());
    await coordinator.ensure(currentScope, currentBind);

    releaseOld();
    await oldRequest;
    await coordinator.ensure(currentScope, currentBind);
    expect(currentBind).toHaveBeenCalledTimes(1);
  });
});
