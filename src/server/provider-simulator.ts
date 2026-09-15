import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  canonicalClinicalCommandSchema,
  providerIdSchema,
  providerRegistryFixtures,
  ProviderContractSimulator,
  type PreparedProviderCommand,
  type ProviderId,
  type ProviderSimulatorState,
} from "../core/provider-integration/index.js";

type PersistedState = {
  schemaVersion: 1;
  providers: Partial<Record<ProviderId, ProviderSimulatorState>>;
};

const preparedCommandSchema = z
  .object({
    provider: providerIdSchema,
    adapterVersion: z.string(),
    command: canonicalClinicalCommandSchema,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    preparedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const modeSchema = z.enum(["normal", "delay", "reject", "down", "conflict"]);

export async function createProviderSimulatorApp(options: {
  token: string;
  statePath: string;
  logger?: boolean;
}): Promise<FastifyInstance> {
  if (options.token.length < 32)
    throw new Error(
      "Provider simulator token must contain at least 32 characters.",
    );
  const simulators = new Map<ProviderId, ProviderContractSimulator>();
  for (const provider of providerIdSchema.options)
    simulators.set(
      provider,
      new ProviderContractSimulator(
        providerRegistryFixtures.simulatorManifest(provider),
      ),
    );
  try {
    const parsed = JSON.parse(
      await readFile(options.statePath, "utf8"),
    ) as PersistedState;
    if (parsed.schemaVersion !== 1) throw new Error("SIMULATOR_STATE_VERSION");
    for (const [provider, state] of Object.entries(parsed.providers))
      if (state && providerIdSchema.safeParse(provider).success)
        simulators.get(provider as ProviderId)!.restoreState(state);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
      throw error;
  }

  let persistence = Promise.resolve();
  function persist(): Promise<void> {
    const next = persistence.then(async () => {
      const payload: PersistedState = { schemaVersion: 1, providers: {} };
      for (const [provider, simulator] of simulators)
        payload.providers[provider] = simulator.exportState();
      await mkdir(dirname(options.statePath), { recursive: true });
      const temporary = `${options.statePath}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
      await rename(temporary, options.statePath);
    });
    persistence = next.catch(() => undefined);
    return next;
  }

  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
  });
  app.addHook("onRequest", async (request, reply) => {
    if (request.headers.authorization !== `Bearer ${options.token}`)
      return reply.code(401).send({ error: "AUTH_DENIED" });
  });
  const simulator = (provider: string): ProviderContractSimulator =>
    simulators.get(providerIdSchema.parse(provider))!;

  app.get("/health", () => ({ status: "ok", persistence: "file" }));
  app.get("/v1/providers/:provider/health", (request) =>
    simulator((request.params as { provider: string }).provider).health(),
  );
  app.get("/v1/providers/:provider/changes", (request) => {
    const { provider } = request.params as { provider: string };
    const { cursor } = z
      .object({ cursor: z.string().optional() })
      .parse(request.query);
    return simulator(provider).pullChanges(
      cursor ? { value: cursor } : undefined,
    );
  });
  app.post("/v1/providers/:provider/read", (request) => {
    const reference = z
      .object({ resourceType: z.string(), externalId: z.string() })
      .strict()
      .parse(request.body);
    return simulator((request.params as { provider: string }).provider).read(
      reference,
    );
  });
  app.post("/v1/providers/:provider/commands", async (request) => {
    const prepared: PreparedProviderCommand = preparedCommandSchema.parse(
      request.body,
    );
    const selected = simulator(
      (request.params as { provider: string }).provider,
    );
    const result = await selected.executeCommand(prepared);
    await persist();
    return result;
  });
  app.get("/v1/providers/:provider/commands/:receiptId", async (request) => {
    const { provider, receiptId } = request.params as {
      provider: string;
      receiptId: string;
    };
    const result = await simulator(provider).getCommandStatus(receiptId);
    await persist();
    return result;
  });
  app.post("/v1/providers/:provider/reconcile", async (request) => {
    const body = z
      .object({ receiptId: z.string(), idempotencyKey: z.string() })
      .strict()
      .parse(request.body);
    const result = await simulator(
      (request.params as { provider: string }).provider,
    ).reconcile(body);
    await persist();
    return result;
  });
  app.post("/v1/providers/:provider/mode", async (request) => {
    const selected = simulator(
      (request.params as { provider: string }).provider,
    );
    selected.setMode(
      modeSchema.parse((request.body as { mode?: unknown }).mode),
    );
    await persist();
    return selected.healthSnapshot();
  });
  app.post("/v1/providers/:provider/reset", async (request, reply) => {
    simulator((request.params as { provider: string }).provider).reset();
    await persist();
    return reply.code(204).send();
  });
  return app;
}

async function main(): Promise<void> {
  const token = process.env.PFH_PROVIDER_SIMULATOR_TOKEN;
  if (!token) throw new Error("PFH_PROVIDER_SIMULATOR_TOKEN is required.");
  const app = await createProviderSimulatorApp({
    token,
    statePath:
      process.env.PFH_PROVIDER_SIMULATOR_STATE_PATH ??
      "/tmp/pflegehelfer-provider-simulator/state.json",
    logger: true,
  });
  await app.listen({
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.PORT ?? "8787", 10),
  });
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) await main();
