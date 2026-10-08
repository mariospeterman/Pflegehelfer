import { assertIsolatedE2eEnvironment } from "./e2e-environment.js";

const environment = assertIsolatedE2eEnvironment();
console.log(
  `isolated E2E environment: ${environment.composeProject} at ${environment.baseUrl}`,
);
