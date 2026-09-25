# Data flow

```mermaid
flowchart LR
  Staff["Authorised staff / managed device"] -->|OIDC + purpose| BFF["Pflegehelfer BFF"]
  BFF --> Policy["RBAC/ABAC policy"]
  Policy --> Domain["Deterministic domain services"]
  Domain --> Clinical["ClinicalDataPort / FHIR R4 store"]
  Domain --> Audit["Append-only audit"]
  Domain --> Outbox["Transactional outbox"]
  Outbox --> Adapters["Capability-gated adapters"]
  Adapters --> Sources["WiCare / careCoach / SAP / devices"]
  Domain --> AI["Optional local AI gateway"]
  AI -->|schema-valid drafts only| Domain
```

The browser receives role- and purpose-specific view models, never provider credentials. Production data stays inside the controlled environment except through approved integration paths.
