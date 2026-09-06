# Operations guide

`pfhctl status`, `provider list`, `provider test`, `model list` and `demo reset` address the same BFF used by the PWA. Set `PFH_BASE_URL` to port 3000 in Vite development or 4173 for the built integrated demo.

Readiness verifies audit integrity and the Medplum workspace. AI and providers may degrade without disabling deterministic daily care workflows; their exact mode is visible in `/api/v1/ai/status` and the provider registry. A clinical persistence failure rolls the command back and returns an error—operators must not assume a UI click committed until the new state is visible.

For provider incidents, pause outbound processing, retain the canonical command and all receipts, compare origin/version/effective/recorded times, route the case to an authorised owner and record an explicit decision. Never silently overwrite a conflicting clinical value. The original nurse-call system continues independently.

For AI/voice incidents, disable the affected runtime and use fixed forms. Patient facts still come from deterministic FHIR queries. Invalid model schemas/citations fail closed. Raw audio is not retained; logs must never contain transcript, prompt, identifiers or credentials.

Upgrades require signed artifacts, database/FHIR/profile migration review, staging journeys, backup, rollback window and recorded evidence. Production recovery must restore PostgreSQL/Medplum, workflow checkpoint/outbox, configuration, audit archive and required keys, then reconcile resource counts and provider receipts before reopening writes.
