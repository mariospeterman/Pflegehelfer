# ADR-0003: FHIR R4 with explicit Swiss profile promotion

- Status: Accepted
- Date: 2026-09-05

## Context

The architecture calls CH Core 7.0.0-ballot the current published version. Official history also lists 6.0.0 as the current non-ballot STU 6 release. Automatically following a ballot would be unsafe.

## Decision

Use FHIR R4 4.0.1-compatible canonical structures. Track CH Core 6.0.0 as the non-ballot production reference and pin 7.0.0-ballot only in the staging compatibility matrix. Promote a new implementation-guide package only after validation fixtures, terminology availability, migration impact and institution approval are recorded.

## Consequences

- Ballot features cannot silently enter production.
- Every resource records mapping/profile version.
- Licensed terminology packages remain externally supplied and checksum-verified.
