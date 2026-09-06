# ADR-0001: Modular monolith with explicit ports

- Status: Accepted
- Date: 2026-09-05

## Context

The architecture names many logical services, but the upstream repository contains no implementation and explicitly warns against premature microservices. A demo must be reproducible without operating a hospital-scale infrastructure estate.

## Decision

Implement the deterministic core as a strict-TypeScript modular monolith with explicit ports for identity, policy, clinical data, workflow, audit/events, provider adapters and AI. Deploy the API/worker together in the reference environment. Keep AI as a separate runtime boundary and keep Medplum, Keycloak, OPA, Flowable, NATS and PostgreSQL replaceable through adapters.

Automated tests may use in-process implementations, but the normal showcase runtime uses self-hosted Medplum and the same authorization, command, approval, idempotency, audit and reconciliation contracts used by production adapters.

## Consequences

- Complete vertical slices can run locally and offline.
- Logical boundaries remain extractable if scale, runtime, security or failure isolation justifies it.
- In-memory storage is an explicitly named test fixture, not a product or persistence claim.
- Production deployment must select durable port implementations and prove backup/restore and failover.
