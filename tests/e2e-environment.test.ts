import { describe, expect, it } from "vitest";
import { assertIsolatedE2eEnvironment } from "../tools/e2e-environment.js";

const validEnvironment = (): NodeJS.ProcessEnv => ({
  PFH_E2E_RUN_NONCE: "local-20261008-a1",
  PFH_COMPOSE_PROJECT: "pfh-e2e-local-20261008-a1",
  PFH_APP_HOST_PORT: "43173",
  PFH_OPERATIONAL_HOST_PORT: "44173",
  PFH_MEDPLUM_HOST_PORT: "45173",
  PFH_MEDPLUM_APP_HOST_PORT: "46173",
  PFH_PROVIDER_HOST_PORT: "47173",
  PFH_IDP_HOST_PORT: "48173",
  PFH_E2E_BASE_URL: "http://127.0.0.1:43173",
});

describe("real-stack E2E environment guard", () => {
  it("accepts one exact nonce-bound loopback namespace", () => {
    expect(assertIsolatedE2eEnvironment(validEnvironment())).toEqual({
      runNonce: "local-20261008-a1",
      composeProject: "pfh-e2e-local-20261008-a1",
      appHostPort: 43173,
      baseUrl: "http://127.0.0.1:43173",
      operationalHostPort: 44173,
      medplumHostPort: 45173,
      medplumAppHostPort: 46173,
      providerHostPort: 47173,
      idpHostPort: 48173,
    });
  });

  it("rejects a missing run nonce", () => {
    const environment = validEnvironment();
    delete environment.PFH_E2E_RUN_NONCE;
    expect(() => assertIsolatedE2eEnvironment(environment)).toThrow(
      "PFH_E2E_RUN_NONCE is required",
    );
  });

  it("rejects the showcase project and any project not bound to the nonce", () => {
    expect(() =>
      assertIsolatedE2eEnvironment({
        ...validEnvironment(),
        PFH_COMPOSE_PROJECT: "pflegehelfer",
      }),
    ).toThrow("never the showcase project");
    expect(() =>
      assertIsolatedE2eEnvironment({
        ...validEnvironment(),
        PFH_COMPOSE_PROJECT: "pfh-e2e-some-other-run",
      }),
    ).toThrow("must equal the nonce-bound project");
  });

  it("rejects every protected showcase port and a mismatched base URL", () => {
    expect(() =>
      assertIsolatedE2eEnvironment({
        ...validEnvironment(),
        PFH_APP_HOST_PORT: "4173",
        PFH_E2E_BASE_URL: "http://127.0.0.1:4173",
      }),
    ).toThrow("protected showcase service port");
    expect(() =>
      assertIsolatedE2eEnvironment({
        ...validEnvironment(),
        PFH_PROVIDER_HOST_PORT: "8787",
      }),
    ).toThrow("protected showcase service port");
    expect(() =>
      assertIsolatedE2eEnvironment({
        ...validEnvironment(),
        PFH_E2E_BASE_URL: "http://127.0.0.1:43174",
      }),
    ).toThrow("must match PFH_APP_HOST_PORT");
  });

  it("rejects collisions inside the supposedly isolated namespace", () => {
    expect(() =>
      assertIsolatedE2eEnvironment({
        ...validEnvironment(),
        PFH_MEDPLUM_HOST_PORT: "44173",
      }),
    ).toThrow("distinct host port");
  });
});
