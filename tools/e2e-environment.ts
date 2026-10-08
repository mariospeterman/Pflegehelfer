export interface IsolatedE2eEnvironment {
  runNonce: string;
  composeProject: string;
  appHostPort: number;
  baseUrl: string;
  operationalHostPort: number;
  medplumHostPort: number;
  medplumAppHostPort: number;
  providerHostPort: number;
  idpHostPort: number;
}

const noncePattern = /^[a-z0-9](?:[a-z0-9-]{5,62}[a-z0-9])$/;

export function assertIsolatedE2eEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): IsolatedE2eEnvironment {
  const runNonce = environment.PFH_E2E_RUN_NONCE?.trim();
  if (!runNonce || !noncePattern.test(runNonce))
    throw new Error(
      "PFH_E2E_RUN_NONCE is required and must be a 7-64 character lowercase run identifier.",
    );

  const expectedProject = `pfh-e2e-${runNonce}`;
  const composeProject = environment.PFH_COMPOSE_PROJECT?.trim();
  if (!composeProject || composeProject === "pflegehelfer")
    throw new Error(
      "PFH_COMPOSE_PROJECT must identify an isolated E2E project, never the showcase project.",
    );
  if (composeProject !== expectedProject)
    throw new Error(
      `PFH_COMPOSE_PROJECT must equal the nonce-bound project ${expectedProject}.`,
    );

  const port = (name: string): number => {
    const value = Number(environment[name]);
    if (!Number.isInteger(value) || value < 1024 || value > 65_535)
      throw new Error(`${name} must be an explicit user port.`);
    return value;
  };
  const appHostPort = port("PFH_APP_HOST_PORT");
  const operationalHostPort = port("PFH_OPERATIONAL_HOST_PORT");
  const medplumHostPort = port("PFH_MEDPLUM_HOST_PORT");
  const medplumAppHostPort = port("PFH_MEDPLUM_APP_HOST_PORT");
  const providerHostPort = port("PFH_PROVIDER_HOST_PORT");
  const idpHostPort = port("PFH_IDP_HOST_PORT");
  const ports = [
    appHostPort,
    operationalHostPort,
    medplumHostPort,
    medplumAppHostPort,
    providerHostPort,
    idpHostPort,
  ];
  if (new Set(ports).size !== ports.length)
    throw new Error(
      "Every isolated E2E service requires a distinct host port.",
    );
  const protectedPorts = new Set([4173, 5434, 8103, 3001, 8787, 9000]);
  if (ports.some((value) => protectedPorts.has(value)))
    throw new Error(
      "Isolated E2E ports must not reuse a protected showcase service port.",
    );

  const configuredBaseUrl = environment.PFH_E2E_BASE_URL?.trim();
  if (!configuredBaseUrl)
    throw new Error("PFH_E2E_BASE_URL is required for real-stack Playwright.");
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(configuredBaseUrl);
  } catch {
    throw new Error("PFH_E2E_BASE_URL must be an absolute URL.");
  }
  if (
    parsedBaseUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname) ||
    parsedBaseUrl.pathname !== "/" ||
    parsedBaseUrl.search ||
    parsedBaseUrl.hash
  )
    throw new Error(
      "PFH_E2E_BASE_URL must be a plain loopback HTTP origin without path, query or fragment.",
    );
  if (Number(parsedBaseUrl.port) !== appHostPort)
    throw new Error(
      "PFH_E2E_BASE_URL port must match PFH_APP_HOST_PORT exactly.",
    );

  return {
    runNonce,
    composeProject,
    appHostPort,
    baseUrl: parsedBaseUrl.origin,
    operationalHostPort,
    medplumHostPort,
    medplumAppHostPort,
    providerHostPort,
    idpHostPort,
  };
}
