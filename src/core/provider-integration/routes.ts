import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { DomainError } from "../types.js";
import { providerIdSchema, providerProfileSchema } from "./contract.js";
import type { ProviderRegistry } from "./registry.js";

export type ProviderIntegrationAction = "provider-registry:read";

export interface ProviderIntegrationRouteOptions {
  registry: ProviderRegistry;
  authorize: (
    request: FastifyRequest,
    action: ProviderIntegrationAction,
  ) => void | Promise<void>;
}

const registryQuerySchema = z
  .object({ profile: providerProfileSchema.optional() })
  .strict();
/**
 * Purpose-specific provider registry endpoints. The host BFF
 * supplies identity/policy authorization; this plugin never trusts demo headers.
 * Reconciliation intentionally lives only in the patient-scoped workflow
 * service, so there is no second, divergent or non-durable workbench.
 */
export const providerIntegrationRoutes: FastifyPluginAsync<
  ProviderIntegrationRouteOptions
> = (app, options) => {
  app.get("/api/v1/providers/registry", async (request) => {
    await options.authorize(request, "provider-registry:read");
    const query = registryQuerySchema.parse(request.query);
    return {
      contractVersion: "1.0.0",
      providers: await options.registry.status(query.profile),
    };
  });

  app.get("/api/v1/providers/registry/:provider/:profile", async (request) => {
    await options.authorize(request, "provider-registry:read");
    const params = z
      .object({ provider: providerIdSchema, profile: providerProfileSchema })
      .strict()
      .parse(request.params);
    const status = await options.registry.get(params.provider, params.profile);
    if (!status)
      throw new DomainError(
        "NOT_FOUND",
        "Providerprofil wurde nicht gefunden.",
        404,
      );
    return status;
  });

  return Promise.resolve();
};
