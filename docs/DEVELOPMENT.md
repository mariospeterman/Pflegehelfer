# Development guide

Node 24 and pnpm 11 are pinned by `package.json`. Docker supplies Medplum 5.1.37, PostgreSQL 16 and Redis 7. Create ignored local configuration with `pnpm demo:env`, start infrastructure with `pnpm dev:infra`, then use `pnpm dev`.

The normal runtime is integrated. `demo:test-memory` and `dev:api:test-memory` exist only as deterministic automated-test servers; do not use them as product demonstrations or persistence evidence.

Architecture dependencies point inward: PWA/BFF → domain services and ports; Medplum, model, ASR and providers are adapters. OpenUI programs contain only references to registered components. Every generated action is an opaque intent resolved and re-authorised by the server. Clinical mutations are serialized, checkpointed and rolled back if the FHIR transaction fails.

Targeted loop:

```bash
pnpm exec vitest run tests/workflows.test.ts tests/persistence.test.ts
pnpm typecheck
pnpm verify:e2e -- --project=desktop
```

Full gates:

```bash
pnpm verify
pnpm verify:e2e
pnpm verify:security
pnpm verify:ops
```

Never add vendor URLs, payloads or authentication from inference. Add a capability gate, simulator scenario and contract test until official schemas and a sandbox are supplied.
