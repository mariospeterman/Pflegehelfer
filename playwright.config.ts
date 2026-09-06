import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // Journeys intentionally include repeated role reloads, persistence checks
  // and multi-client SSE cleanup; keep them bounded without making loaded CI
  // hosts race a generic 30-second wall-clock budget.
  timeout: 60_000,
  fullyParallel: false,
  // All journeys reset and mutate one shared clinical environment. Parallel
  // workers would make those deterministic workflow assertions race.
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "artifacts/playwright-report" }],
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    // Request interception is not reliable once a service worker owns a
    // request. A dedicated allow-context test exercises the production worker.
    serviceWorkers: "block",
    channel:
      process.env.PFH_PLAYWRIGHT_CHANNEL === "bundled" ? undefined : "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm demo:test-memory",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "mobile-360",
      use: {
        viewport: { width: 360, height: 800 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile-390",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "tablet",
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: "desktop-1024",
      use: { viewport: { width: 1024, height: 768 } },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
