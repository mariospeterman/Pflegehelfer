import { defineConfig, devices } from "@playwright/test";
import { assertIsolatedE2eEnvironment } from "./tools/e2e-environment.js";

const environment = assertIsolatedE2eEnvironment();

export default defineConfig({
  testDir: "./tests/e2e-real",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "artifacts/playwright-real-stack-report" },
    ],
  ],
  use: {
    baseURL: environment.baseUrl,
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "real-stack-write",
      // Playwright routing must own the exact response-loss request. Production
      // service-worker behavior is exercised independently below.
      use: { serviceWorkers: "block" },
    },
    {
      name: "real-stack-service-worker",
      use: { serviceWorkers: "allow" },
    },
  ],
});
