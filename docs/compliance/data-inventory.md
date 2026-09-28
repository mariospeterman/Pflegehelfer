# Data inventory

| Class          | Examples                                  | Demo      | Production control                    |
| -------------- | ----------------------------------------- | --------- | ------------------------------------- |
| Identity       | staff ID, role, ward, relationship        | fictional | OIDC/Keycloak, least privilege        |
| Patient master | name, DOB, MRN, encounter, room           | fictional | FHIR R4 source, purpose limitation    |
| Clinical       | risks, goals, observations, notes         | fictional | encryption, source/version metadata   |
| Workflow       | tasks, messages, handovers, rounds        | fictional | authorization, retention, audit       |
| Operations     | provider health, outbox receipts          | synthetic | no clinical payload in metrics/logs   |
| Audit          | actor, purpose, action, patient reference | synthetic | append-only, access-controlled export |

No real patient or credential data is committed. Free text is sensitive in production and is redacted from application logs.
