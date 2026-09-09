import type { Resource } from "@medplum/fhirtypes";
import { afterEach, describe, expect, it } from "vitest";
import type { CommandReceipt, ServiceCheckpoint } from "../src/core/service.js";
import { PflegehelferService } from "../src/core/service.js";
import type {
  ClinicalWorkspace,
  ClinicalWorkspaceStatus,
} from "../src/infrastructure/medplum-workspace.js";
import { buildApp } from "../src/server/app.js";

class ResetRecordingWorkspace implements ClinicalWorkspace {
  readonly mode = "medplum" as const;
  synchronizedResources: Resource[] = [];

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  synchronize(
    resources: Resource[],
    _checkpoint?: ServiceCheckpoint,
    _removedReferences?: string[],
    _commandReceipt?: CommandReceipt,
  ): Promise<void> {
    this.synchronizedResources = resources;
    if (resources.length > 500)
      return Promise.reject(
        new Error("MEDPLUM_TRANSACTION_ENTRY_LIMIT_EXCEEDED"),
      );
    return Promise.resolve();
  }

  loadCheckpoint(): Promise<ServiceCheckpoint | null> {
    return Promise.resolve(null);
  }

  loadCommandReceipt(): Promise<CommandReceipt | null> {
    return Promise.resolve(null);
  }

  status(): Promise<ClinicalWorkspaceStatus> {
    return Promise.resolve({
      mode: "medplum",
      ready: true,
      serverVersion: "test",
      resourceCounts: {},
      message: "test",
      checkedAt: "2026-09-09T12:00:00.000Z",
    });
  }

  detailUrl(): string | null {
    return null;
  }
}

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe("durable synthetic demo reset", () => {
  // Regression: ISSUE-RESET-001 — reset rewrote retained evidence and exceeded
  // Medplum's transaction entry limit after a legacy classification change.
  // Found by /qa on 2026-09-09.
  // Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-09-09.md
  it("preserves accepted audit evidence while resetting the active projection", async () => {
    const service = new PflegehelferService();
    for (let index = 0; index < 520; index += 1) {
      service.audit.append({
        actor: service.user("u-it"),
        action: "test:retained-evidence",
        patientId: null,
        purpose: "operations",
        outcome: "success",
        detail: { index },
      });
    }
    const legacyCheckpoint = service.checkpoint();
    legacyCheckpoint.dataClass = "institution-local";
    service.restoreCheckpoint(legacyCheckpoint);
    const retainedEvidence = new Set(
      service
        .fhirResources()
        .filter(
          (resource) =>
            resource.resourceType === "AuditEvent" ||
            resource.resourceType === "Provenance",
        )
        .map((resource) => `${resource.resourceType}/${resource.id}`),
    );

    const workspace = new ResetRecordingWorkspace();
    const app = buildApp(service, {
      demoMode: true,
      workspace,
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/demo/reset",
      headers: {
        "x-demo-user": "u-it",
        "x-command-id": "00000000-0000-4000-8000-000000009001",
      },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "reset" });
    expect(workspace.synchronizedResources.length).toBeLessThan(500);
    expect(
      workspace.synchronizedResources.filter(
        (resource) => resource.resourceType === "AuditEvent",
      ),
    ).toHaveLength(1);
    expect(
      workspace.synchronizedResources.some((resource) =>
        retainedEvidence.has(`${resource.resourceType}/${resource.id}`),
      ),
    ).toBe(false);
  });
});
