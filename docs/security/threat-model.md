# Threat model

Primary threats are stolen sessions/devices, excessive role access, wrong-patient actions, forged/stale provider updates, prompt/model injection, free-text leakage, dependency compromise, offline data residue, malicious insiders, and availability loss. Trust boundaries exist at browser/BFF, identity/policy, clinical store, AI gateway, and every provider adapter.

Implemented mitigations include purpose/relationship/device authorization, minimum views, two identifiers and visible review for approval, optimistic versions, idempotent outbox, explicit conflicts, deep hash-chained audit, body limits/schema validation, redacted logs, CSP/no-store headers, no browser credentials, AI-disabled mode, bounded components, opaque one-use intents, non-root/read-only containers, pinned lockfile, and simulators for failure paths. Residual production risks require SSO/PKI, durable stores, WAF/network policy, key management, SIEM, backup, penetration test, DPIA, and vendor assurance.
