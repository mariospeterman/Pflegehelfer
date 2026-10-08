import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryCommercialStore } from "../src/infrastructure/commercial-store.js";
import { InMemoryDemoScenarioStore } from "../src/infrastructure/demo-scenario-store.js";
import { InMemoryOperationalStore } from "../src/infrastructure/operational-store.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let complete!: () => void;
  const promise = new Promise<void>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

class FailOnceCommercialStore extends InMemoryCommercialStore {
  attempts = 0;

  override async initialize(
    configuration: Parameters<InMemoryCommercialStore["initialize"]>[0],
  ): Promise<void> {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error("database in recovery");
    await super.initialize(configuration);
  }
}

class FailOnceScenarioStore extends InMemoryDemoScenarioStore {
  attempts = 0;

  override async initialize(): ReturnType<
    InMemoryDemoScenarioStore["initialize"]
  > {
    this.attempts += 1;
    if (this.attempts === 1) throw new Error("database in recovery");
    return super.initialize();
  }
}

describe("application database recovery orchestration", () => {
  it("retries commercial initialization after a transient failure", async () => {
    const commercialStore = new FailOnceCommercialStore();
    const app = buildApp(undefined, { demoMode: true, commercialStore });
    apps.push(app);

    const unavailable = await app.inject({ method: "GET", url: "/ready" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      reason: "runtime-initialization-unavailable",
    });

    const recovered = await app.inject({ method: "GET", url: "/ready" });
    expect(recovered.statusCode).toBe(200);
    expect(commercialStore.attempts).toBe(2);
  });

  it("retries scenario initialization after a transient failure", async () => {
    const scenarioStore = new FailOnceScenarioStore();
    const app = buildApp(undefined, { demoMode: true, scenarioStore });
    apps.push(app);

    const unavailable = await app.inject({ method: "GET", url: "/ready" });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toMatchObject({
      reason: "runtime-initialization-unavailable",
    });

    const recovered = await app.inject({ method: "GET", url: "/ready" });
    expect(recovered.statusCode).toBe(200);
    expect(scenarioStore.attempts).toBe(2);
  });

  it("bounds the complete readiness assessment", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PFH_READINESS_DEADLINE_MS", "1000");
    class NeverReadyCommercialStore extends InMemoryCommercialStore {
      override initialize(): Promise<void> {
        return new Promise(() => undefined);
      }
    }
    const app = buildApp(undefined, {
      demoMode: true,
      commercialStore: new NeverReadyCommercialStore(),
    });
    apps.push(app);
    await app.ready();

    const responsePromise = app.inject({ method: "GET", url: "/ready" });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_000);
    const response = await responsePromise;
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      reason: "readiness-deadline-exceeded",
    });
  });

  it("drains active database-gated sweeps before closing stores", async () => {
    vi.useFakeTimers();
    vi.stubEnv("PFH_ESCALATION_INTERVAL_MS", "1000");
    vi.stubEnv("PFH_PROVIDER_WORKER_INTERVAL_MS", "1000");
    const healthEntered = deferred();
    const healthRelease = deferred();
    class BlockingOperationalStore extends InMemoryOperationalStore {
      closed = false;

      override async health(): Promise<boolean> {
        healthEntered.resolve();
        await healthRelease.promise;
        return true;
      }

      override close(): Promise<void> {
        this.closed = true;
        return Promise.resolve();
      }
    }
    const operationalStore = new BlockingOperationalStore();
    const app = buildApp(undefined, { demoMode: true, operationalStore });
    await app.ready();
    await vi.advanceTimersByTimeAsync(1_000);
    await healthEntered.promise;

    let closeCompleted = false;
    const closing = app.close().then(() => {
      closeCompleted = true;
    });
    await Promise.resolve();
    expect(operationalStore.closed).toBe(false);
    expect(closeCompleted).toBe(false);

    healthRelease.resolve();
    await closing;
    expect(operationalStore.closed).toBe(true);
  });
});
