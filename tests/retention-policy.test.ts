import { describe, expect, it } from "vitest";
import {
  decideRetention,
  retentionDataClasses,
  type RetentionPolicy,
  type RetentionRecord,
} from "../src/core/retention-policy.js";

const rules = Object.fromEntries(
  retentionDataClasses.map((dataClass) => [
    dataClass,
    {
      retainForDays: dataClass === "audit" ? null : 30,
      actionAfterExpiry:
        dataClass === "reconciled-provider-payload"
          ? "redact-payload"
          : "delete",
    },
  ]),
) as RetentionPolicy["rules"];

const policy: RetentionPolicy = {
  organizationId: "org-demo",
  version: "retention-v1",
  effectiveAt: "2026-01-01T00:00:00.000Z",
  rules,
};

const record = (overrides: Partial<RetentionRecord> = {}): RetentionRecord => ({
  organizationId: "org-demo",
  siteId: "site-main",
  recordId: "record-1",
  dataClass: "private-thread",
  retentionAnchorAt: "2026-01-01T00:00:00.000Z",
  activeHoldIds: [],
  ...overrides,
});

describe("retention policy", () => {
  it("requires an explicit controller rule for every operational class", () => {
    const incomplete = structuredClone(policy);
    delete (incomplete.rules as Partial<RetentionPolicy["rules"]>)[
      "voice-archive"
    ];
    expect(() =>
      decideRetention(record(), incomplete, new Date("2026-03-01T00:00:00Z")),
    ).toThrow("RETENTION_RULE_MISSING:voice-archive");
  });

  it("expires an operational record only after its configured duration", () => {
    expect(
      decideRetention(record(), policy, new Date("2026-01-30T23:59:59Z")),
    ).toMatchObject({ decision: "retain", reason: "not-yet-expired" });
    expect(
      decideRetention(record(), policy, new Date("2026-01-31T00:00:00Z")),
    ).toEqual({
      decision: "delete",
      reason: "policy-expired",
      expiresAt: "2026-01-31T00:00:00.000Z",
    });
  });

  it("retains held evidence without treating the hold as authorization", () => {
    const held = decideRetention(
      record({ activeHoldIds: ["hold-legal-1"] }),
      policy,
      new Date("2026-03-01T00:00:00Z"),
    );
    expect(held).toMatchObject({
      decision: "retain",
      reason: "active-legal-hold",
    });
    expect(held).not.toHaveProperty("readAllowed");
  });

  it("never removes an unreconciled provider payload", () => {
    expect(
      decideRetention(
        record({ dataClass: "reconciled-provider-payload" }),
        policy,
        new Date("2026-03-01T00:00:00Z"),
      ),
    ).toMatchObject({
      decision: "retain",
      reason: "provider-delivery-not-reconciled",
    });
    expect(
      decideRetention(
        record({
          dataClass: "reconciled-provider-payload",
          reconciledAt: "2026-01-02T00:00:00Z",
        }),
        policy,
        new Date("2026-03-01T00:00:00Z"),
      ),
    ).toMatchObject({ decision: "redact-payload" });
  });

  it("rejects tenant mismatch and authoritative FHIR records", () => {
    expect(() =>
      decideRetention(
        record({ organizationId: "org-other" }),
        policy,
        new Date(),
      ),
    ).toThrow("RETENTION_POLICY_SCOPE_MISMATCH");
    expect(() =>
      decideRetention(
        record({ authoritativeClinicalRecord: true }),
        policy,
        new Date(),
      ),
    ).toThrow("RETENTION_CLINICAL_RECORD_OUT_OF_SCOPE");
  });
});
