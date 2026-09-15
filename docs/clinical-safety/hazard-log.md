# Hazard log

| Hazard                          | Control                                                      | Verification                    | Residual owner     |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------- | ------------------ |
| Wrong patient                   | persistent banner, two identifiers, relationship policy      | unit/E2E                        | clinical safety    |
| Stale/duplicate write           | versions, idempotency, explicit conflict                     | workflow tests                  | integration owner  |
| Unreviewed draft becomes record | review checkbox, approval policy, outbox only after approval | workflow tests                  | clinical owner     |
| Medication changed in assistant | blocked/read-only boundary                                   | workflow test                   | medical governance |
| Nurse-call event missed         | primary system remains authoritative                         | simulator/test and downtime SOP | facility safety    |
| Provider outage hidden          | visible pending/rejected/conflict and health                 | simulator/E2E                   | operations         |
| AI hallucination                | disabled default, bounded schema, no direct write            | unit tests                      | AI/clinical owner  |
| Cross-patient disclosure        | ABAC/minimum views                                           | authorization/E2E               | privacy owner      |

This is a living engineering log, not a completed clinical risk-management file.
