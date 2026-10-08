import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ProviderOutboxJob } from "../src/core/provider-integration/index.js";
import { runtimeSitePack } from "../src/core/runtime-instructions.js";
import { PflegehelferService } from "../src/core/service.js";
import { siteConfiguration } from "../src/core/site-config.js";
import { authorizeProviderDispatch } from "../src/server/app.js";

function job(
  envelopeOverrides: Record<string, unknown> = {},
): ProviderOutboxJob {
  const acceptedCommandId = randomUUID();
  const commandId = randomUUID();
  return {
    id: randomUUID(),
    provider: "device-gateway",
    profile: "synthetic-simulator",
    operation: "Observation.write",
    idempotencyKey: randomUUID(),
    attempts: 1,
    recoveredExpiredLease: false,
    latestReceiptId: null,
    acceptedCommandId,
    payload: {
      schemaVersion: 1,
      retrySafety: "reconcile-before-retry",
      command: {
        commandId,
        operation: "Observation.write",
        patientReference: "Patient/p-anna",
        encounterReference: "Encounter/enc-anna-2026",
        resource: {
          resourceType: "Observation",
          id: commandId,
          body: {
            patientId: "p-anna",
            encounterId: "enc-anna-2026",
            status: "final",
            valueQuantity: { value: 37.2, code: "Cel" },
          },
        },
        expectedProviderVersion: null,
        mappingVersion: "synthetic-v1",
        correlationId: randomUUID(),
        causationId: randomUUID(),
        idempotencyKey: randomUUID(),
        approvedAt: new Date().toISOString(),
      },
    },
    authorityEnvelope: {
      acceptedCommandId,
      organizationId: siteConfiguration.institutionId,
      siteId: siteConfiguration.siteId,
      departmentId: siteConfiguration.department.id,
      actorId: "u-nurse",
      actorRole: "registered-nurse",
      purpose: "direct-care",
      patientId: "p-anna",
      encounterId: "enc-anna-2026",
      policyVersion: runtimeSitePack.packDigest,
      actions: ["observation:approve"],
      ...envelopeOverrides,
    },
  };
}

describe("provider dispatch authorization", () => {
  it("requires the currently authorized encounter", () => {
    const service = new PflegehelferService();
    expect(
      authorizeProviderDispatch(service, runtimeSitePack.packDigest, job()),
    ).toEqual({ allowed: true });
    const checkpoint = service.checkpoint();
    checkpoint.state.patients.find(
      (patient) => patient.id === "p-anna",
    )!.encounterId = "enc-anna-follow-up";
    service.restoreCheckpoint(checkpoint);
    expect(
      authorizeProviderDispatch(service, runtimeSitePack.packDigest, job()),
    ).toEqual({
      allowed: false,
      reason: "encounter-relationship-revoked",
    });
  });

  it("requires the accepted envelope to include the dispatched action", () => {
    expect(
      authorizeProviderDispatch(
        new PflegehelferService(),
        runtimeSitePack.packDigest,
        job({ actions: ["patient:read"] }),
      ),
    ).toEqual({ allowed: false, reason: "permission-revoked" });
  });
});
