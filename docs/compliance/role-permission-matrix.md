# Role and permission matrix

| Role                         | Patient clinical context           | Operational actions                                                               |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------------------------------- |
| Care assistant               | assigned ward + relationship       | tasks, draft/approve permitted observations/notes, messages, acknowledge handover |
| Registered nurse             | assigned ward + relationship       | care-assistant scope plus intake, handover sign, clinical response                |
| Physician/pharmacy/therapies | assigned patients                  | discipline tasks, communication, rounds; no medication orders in Pflegehelfer     |
| Transport/service            | minimum task context               | own task queue only; service receives no patient context                          |
| Administration               | demographic/minimised ward context | admission items only, administrative purpose                                      |
| Management                   | no individual clinical records     | aggregate process signals only                                                    |
| HR                           | none                               | none in clinical boundary                                                         |
| IT                           | none                               | provider simulators/health and audit evidence                                     |
| Quality/safety               | no routine patient view            | controlled aggregate/audit review                                                 |

Every clinical access additionally requires purpose, managed device, ward, and active patient relationship. The executable policy is `src/core/policy.ts` and its isolation tests are authoritative engineering evidence.
