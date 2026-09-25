# Air-gap update

Build and scan in a controlled connected zone, then export immutable OCI images, Helm/config schemas, migrations, FHIR packages, SBOM, vulnerability/license reports, checksums/signatures, release notes, and rollback plan. Verify signatures/checksums on an offline staging cluster, run `pnpm verify:airgap` and acceptance tests, then promote through the internal registry. Model weights and licensed terminology are separate institution-approved imports and are never bundled by default.
