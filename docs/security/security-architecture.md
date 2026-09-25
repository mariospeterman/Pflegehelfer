# Security architecture

Authentication terminates at the BFF; production uses institutional OIDC with short sessions and MFA policy. Authorization is deny-by-default RBAC+ABAC using role, purpose, managed device, ward, and treatment relationship. Provider and FHIR credentials are server-side only. Clinical writes pass schema validation, policy, state/version rules, approval, audit, and transactional outbox. Logs and metrics exclude bodies and patient labels. Network policy should default-deny, permitting only identity, data, policy, telemetry, and explicitly approved provider endpoints.
