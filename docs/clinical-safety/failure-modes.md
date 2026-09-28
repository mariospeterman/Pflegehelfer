# Failure modes

Provider down retains a pending outbox item; rejection and conflict are explicit and require correction/reconciliation; delayed acknowledgement stays pending; duplicates reuse idempotency receipts. Network loss disables clinical writes and labels the shell offline. AI loss leaves all deterministic flows operational. Identity/policy/store failure must fail closed. Nurse-call loss never suppresses the primary alarm workflow. Clock drift, storage exhaustion, audit verification failure, and queue age require operational alerts and a controlled read-only/downtime transition.
