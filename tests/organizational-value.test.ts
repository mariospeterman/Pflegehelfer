import { afterEach, describe, expect, it } from "vitest";
import {
  buildOrganizationalValueReport,
  type OrganizationalValueInput,
} from "../src/core/organizational-value.js";
import { buildApp } from "../src/server/app.js";

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

function input(
  observations: OrganizationalValueInput["observations"],
  comparisonDataClass: OrganizationalValueInput["definition"]["comparisonDataClass"] = "observed",
): OrganizationalValueInput {
  return {
    definition: {
      id: "rehab-ward-loop",
      version: 1,
      organizationId: "org-demo",
      wardId: "rehab-2",
      workflowId: "nursing-day",
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-30T23:59:59.000Z",
      ownerRole: "quality-safety",
      reviewDecisionAt: "2026-10-05T09:00:00.000Z",
      baselineAlternativeId: "current-process",
      targetAlternativeId: "pflegehelfer",
      comparisonDataClass,
      exclusions: ["Training shifts are reported separately."],
      targets: {
        minimumEligibleActivities: 10,
        minimumReleasedMinutesPerActivity: 1,
        maximumDeliveryFailureRate: 0.05,
        maximumFaithfulnessErrorRate: 0.02,
      },
    },
    alternatives: [
      {
        id: "current-process",
        label: "Current licensed ward process",
        kind: "current-process",
        availability: "measured",
        basis: "Institution-declared current modules and configured workflow.",
      },
      {
        id: "improved-incumbent",
        label: "Improved incumbent configuration",
        kind: "improved-incumbent",
        availability: "available-not-measured",
        basis:
          "Feasible configuration and training alternative; no result supplied.",
      },
      {
        id: "approved-general-assistant",
        label: "Approved general assistant and available connectors",
        kind: "approved-general-assistant",
        availability: "unavailable",
        basis:
          "No institution-approved workspace was available for this period.",
      },
      {
        id: "pflegehelfer",
        label: "Pflegehelfer ward loop",
        kind: "pflegehelfer",
        availability: "measured",
        basis: "Same eligible work and declared outcome definitions.",
      },
    ],
    observations,
  };
}

function effortObservation(
  id: string,
  alternativeId: "current-process" | "pflegehelfer",
  total: {
    capture: number;
    review: number;
    correction: number;
    failedAttempts: number;
    downstreamReconciliation: number;
  },
  dataClass: "observed" | "synthetic" = "observed",
): OrganizationalValueInput["observations"][number] {
  return {
    id,
    alternativeId,
    dataClass,
    observedAt: "2026-09-20T12:00:00.000Z",
    eligibleActivities: 10,
    administrativeMinutes: total,
    repeatedEntries: alternativeId === "current-process" ? 8 : 2,
    responsibilityTransfers: {
      eligible: 10,
      acceptedInWindow: alternativeId === "current-process" ? 7 : 9,
      unresolved: alternativeId === "current-process" ? 3 : 1,
      missingOwner: 0,
      missingWindow: alternativeId === "current-process" ? 1 : 0,
    },
    deliveries: {
      eligible: 10,
      verified: alternativeId === "current-process" ? 9 : 8,
      rejected: alternativeId === "current-process" ? 0 : 1,
      pending: 1,
      uncertain: 0,
      oldestPendingMinutes: 45,
    },
    faithfulnessReview: {
      reviewedRecords: 10,
      unsupportedAdditions: 0,
      omissions: alternativeId === "current-process" ? 0 : 1,
      wrongSubjectTimeOrStatus: 0,
      factualCorrections: alternativeId === "current-process" ? 1 : 2,
      stylisticEdits: 2,
    },
    usefulness: {
      invited: 10,
      responses: 6,
      scoreTotal: 20,
      scoreMaximum: 5,
    },
    serviceCost: {
      amount: alternativeId === "current-process" ? 80 : 120,
      currency: "CHF",
    },
  };
}

describe("organizational value report", () => {
  it("shows an unknown baseline as not measured and never mixes evidence classes", () => {
    const report = buildOrganizationalValueReport(
      input([
        effortObservation(
          "current-observed",
          "current-process",
          {
            capture: 50,
            review: 20,
            correction: 10,
            failedAttempts: 5,
            downstreamReconciliation: 15,
          },
          "observed",
        ),
        effortObservation(
          "pflegehelfer-synthetic",
          "pflegehelfer",
          {
            capture: 30,
            review: 15,
            correction: 5,
            failedAttempts: 5,
            downstreamReconciliation: 5,
          },
          "synthetic",
        ),
      ]),
    );

    expect(report.comparison).toMatchObject({
      status: "not-measured",
      direction: "unknown",
      releasedAdministrativeMinutesPerActivity: null,
      opportunityValue: null,
    });
    expect(report.decision).toBe("continue-measuring");
    expect(report.measurements.map(({ dataClass }) => dataClass)).toEqual([
      "observed",
      "synthetic",
    ]);
  });

  it("includes review, failures and downstream reconciliation and allows a negative result", () => {
    const report = buildOrganizationalValueReport(
      input([
        effortObservation("current", "current-process", {
          capture: 45,
          review: 15,
          correction: 5,
          failedAttempts: 5,
          downstreamReconciliation: 10,
        }),
        effortObservation("target", "pflegehelfer", {
          capture: 35,
          review: 20,
          correction: 10,
          failedAttempts: 15,
          downstreamReconciliation: 20,
        }),
      ]),
    );

    expect(report.comparison).toMatchObject({
      status: "measured",
      baselineMinutesPerActivity: 8,
      targetMinutesPerActivity: 10,
      releasedAdministrativeMinutesPerActivity: -2,
      direction: "negative",
    });
    expect(report.decision).toBe("do-not-roll-out");
    const target = report.measurements.find(
      ({ alternativeId, dataClass }) =>
        alternativeId === "pflegehelfer" && dataClass === "observed",
    )!;
    expect(target.administrativeEffort).toMatchObject({
      status: "measured",
      value: {
        totalMinutes: 100,
        reviewMinutes: 20,
        failedAttemptMinutes: 15,
        downstreamReconciliationMinutes: 20,
      },
    });
    expect(target.responsibilityTransfer).toMatchObject({
      status: "measured",
      value: {
        acceptedInWindow: 9,
        unresolved: 1,
        missingOwner: 0,
        missingWindow: 0,
        unclassified: 0,
      },
    });
    expect(target.deliveryCompleteness).toMatchObject({
      status: "measured",
      value: {
        verified: 8,
        rejected: 1,
        pending: 1,
        uncertain: 0,
        oldestPendingMinutes: 45,
      },
    });
    expect(report.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "improved-incumbent",
          availability: "available-not-measured",
        }),
        expect.objectContaining({
          id: "approved-general-assistant",
          availability: "unavailable",
        }),
      ]),
    );
  });

  it("deduplicates identical retries and rejects changed retry content", () => {
    const observation = effortObservation("retry-safe", "current-process", {
      capture: 50,
      review: 10,
      correction: 0,
      failedAttempts: 0,
      downstreamReconciliation: 0,
    });
    const report = buildOrganizationalValueReport(
      input([observation, structuredClone(observation)]),
    );
    expect(report.measurements[0]).toMatchObject({ observationCount: 1 });

    const changed = structuredClone(observation);
    changed.administrativeMinutes!.review = 11;
    expect(() =>
      buildOrganizationalValueReport(input([observation, changed])),
    ).toThrow("retried with different content");
  });

  it("requires aggregate-analytics authorization and active institution scope", async () => {
    const payload = input([
      effortObservation("current", "current-process", {
        capture: 50,
        review: 10,
        correction: 0,
        failedAttempts: 0,
        downstreamReconciliation: 0,
      }),
    ]);
    const app = buildApp(undefined, { demoMode: true });
    apps.push(app);
    const allowed = await app.inject({
      method: "POST",
      url: "/api/v1/analytics/organizational-value/report",
      headers: { "x-demo-user": "u-manager" },
      payload,
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      comparison: { status: "not-measured" },
      decision: "continue-measuring",
    });

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/analytics/organizational-value/report",
      headers: { "x-demo-user": "u-nurse" },
      payload,
    });
    expect(denied.statusCode).toBe(403);

    const crossTenant = structuredClone(payload);
    crossTenant.definition.organizationId = "other-institution";
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/analytics/organizational-value/report",
      headers: { "x-demo-user": "u-manager" },
      payload: crossTenant,
    });
    expect(rejected.statusCode).toBe(403);

    const conflictingRetry = structuredClone(payload);
    conflictingRetry.observations.push(
      structuredClone(conflictingRetry.observations[0]!),
    );
    conflictingRetry.observations[1]!.administrativeMinutes!.review = 99;
    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/analytics/organizational-value/report",
      headers: { "x-demo-user": "u-manager" },
      payload: conflictingRetry,
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      error: "VALIDATION",
      fields: ["observations.1.id"],
    });
  });
});
