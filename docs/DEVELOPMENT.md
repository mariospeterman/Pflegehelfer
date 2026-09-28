# Development guide

Node 24 and pnpm 11 are pinned by `package.json`. Docker supplies Medplum 5.1.37, Redis 7, Medplum's PostgreSQL database and a separate PostgreSQL 16 operational database for workflow sessions, assistant threads, audit, events and provider synchronization state. Create ignored local configuration with `pnpm demo:env`, start infrastructure with `pnpm dev:infra`, then use `pnpm dev`.

The normal runtime is integrated. `demo:test-memory` and `dev:api:test-memory` exist only as deterministic automated-test servers; do not use them as product demonstrations or persistence evidence.

Architecture dependencies point inward: PWA/BFF → domain services and ports; Medplum, PostgreSQL, model, ASR and providers are adapters. OpenUI programs contain only references to registered components. Every generated action is an opaque intent resolved and re-authorised by the server. PostgreSQL owns resumable workflow and conversation state; Medplum owns canonical FHIR clinical resources. Clinical mutations are serialized and rolled back if the FHIR transaction fails.

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

Operator contract probes:

```bash
pnpm pfhctl site validate
pnpm pfhctl model list
pnpm pfhctl model test
PFH_ASR_TEST_AUDIO=/absolute/path/to/synthetic-test.wav pnpm pfhctl asr test
pnpm pfhctl tts test
PFH_DEMO_MODE=true pnpm pfhctl migrations status
```

`model list` reports configuration/connectivity. `model test` performs a real, non-writing synthetic structured-inference call. `asr test` refuses to run without an explicitly supplied synthetic audio fixture. Neither command is clinical model validation by itself.

Never add vendor URLs, payloads or authentication from inference. Add a capability gate, simulator scenario and contract test until official schemas and a sandbox are supplied.

## Local and hosted synthetic model profiles

`.env.demo` is ignored and generated with mode `0600`. The production-shaped default is an OpenAI-compatible local endpoint (`PFH_AI_MODE=local-openai`, typically Ollama or vLLM). Outside demo mode, fast, deep, ASR and TTS local runtimes each require their reviewed immutable SHA-256 model digest (`PFH_LLM_MODEL_DIGEST`, `PFH_DEEP_LLM_MODEL_DIGEST`, `PFH_ASR_MODEL_DIGEST`, `PFH_TTS_MODEL_DIGEST`); local endpoints reject redirects and link-local/public origins. For a synthetic hosted developer run only, set all four modes to `hosted-test`, set `PFH_ALLOW_EXTERNAL_AI=true`, keep `PFH_LLM_DATA_CLASSIFICATION=synthetic-only`, and add `OPENAI_API_KEY` locally. The recommended editable defaults are `gpt-5.6-terra` for the fast router/composer, `gpt-5.6-sol` for the bounded approved-knowledge selector, `gpt-4o-transcribe` for speech-to-text and `gpt-4o-mini-tts` for the optional synthetic speech test. Connectivity is never acceptance: each audio adapter becomes `accepted` only after its real non-writing contract test passes.

No real patient data may use `hosted-test`. A missing key leaves deterministic clinical workflows active and reports voice/model unavailability honestly. Restart the API after changing the environment; `/api/v1/ai/status` reports the effective profile without exposing secrets.
