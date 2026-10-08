export const retentionDataClasses = [
  "private-thread",
  "abandoned-draft",
  "assistant-request-archive",
  "voice-archive",
  "authority",
  "attachment-binary",
  "attachment-extracted-text",
  "reconciled-provider-payload",
  "audit",
  "backup",
] as const;

export type RetentionDataClass = (typeof retentionDataClasses)[number];

export interface RetentionRule {
  /**
   * A controller-approved duration. `null` deliberately means that this
   * implementation may not expire the class automatically.
   */
  retainForDays: number | null;
  actionAfterExpiry: "delete" | "redact-payload";
}

export interface RetentionPolicy {
  organizationId: string;
  version: string;
  effectiveAt: string;
  rules: Record<RetentionDataClass, RetentionRule>;
}

export interface RetentionRecord {
  organizationId: string;
  siteId: string;
  recordId: string;
  dataClass: RetentionDataClass;
  retentionAnchorAt: string;
  /** Reconciliation must be complete before provider payloads can expire. */
  reconciledAt?: string | null;
  /** Holds preserve evidence but never express read authorization. */
  activeHoldIds: readonly string[];
  /** Clinical FHIR records are outside this operational purge engine. */
  authoritativeClinicalRecord?: boolean;
}

export type RetentionDecision =
  | {
      decision: "retain";
      reason:
        | "policy-has-no-automatic-expiry"
        | "not-yet-expired"
        | "active-legal-hold"
        | "provider-delivery-not-reconciled";
      expiresAt: string | null;
    }
  | {
      decision: "delete" | "redact-payload";
      reason: "policy-expired";
      expiresAt: string;
    };

const dayMs = 24 * 60 * 60 * 1_000;

function finiteTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp))
    throw new Error(`RETENTION_INVALID_TIMESTAMP:${field}`);
  return timestamp;
}

export function validateRetentionPolicy(policy: RetentionPolicy): void {
  if (!policy.organizationId || !policy.version)
    throw new Error("RETENTION_POLICY_IDENTITY_MISSING");
  finiteTimestamp(policy.effectiveAt, "effectiveAt");
  for (const dataClass of retentionDataClasses) {
    const rule = policy.rules[dataClass];
    if (!rule) throw new Error(`RETENTION_RULE_MISSING:${dataClass}`);
    if (
      rule.retainForDays !== null &&
      (!Number.isInteger(rule.retainForDays) || rule.retainForDays < 0)
    )
      throw new Error(`RETENTION_DURATION_INVALID:${dataClass}`);
  }
}

/**
 * Produces a deterministic purge decision. The caller must still re-check the
 * same organization/site, policy version, hold set and current authorization
 * in the deleting transaction. This function intentionally has no notion of
 * read access: a legal hold cannot grant visibility to a record.
 */
export function decideRetention(
  record: RetentionRecord,
  policy: RetentionPolicy,
  now: Date,
): RetentionDecision {
  validateRetentionPolicy(policy);
  if (record.authoritativeClinicalRecord)
    throw new Error("RETENTION_CLINICAL_RECORD_OUT_OF_SCOPE");
  if (record.organizationId !== policy.organizationId)
    throw new Error("RETENTION_POLICY_SCOPE_MISMATCH");
  if (!Number.isFinite(now.getTime()))
    throw new Error("RETENTION_INVALID_TIMESTAMP:now");

  const rule = policy.rules[record.dataClass];
  if (rule.retainForDays === null)
    return {
      decision: "retain",
      reason: "policy-has-no-automatic-expiry",
      expiresAt: null,
    };

  const anchor = finiteTimestamp(record.retentionAnchorAt, "retentionAnchorAt");
  const expiresAtMs = anchor + rule.retainForDays * dayMs;
  const expiresAt = new Date(expiresAtMs).toISOString();
  if (record.activeHoldIds.length > 0)
    return {
      decision: "retain",
      reason: "active-legal-hold",
      expiresAt,
    };
  if (
    record.dataClass === "reconciled-provider-payload" &&
    !record.reconciledAt
  )
    return {
      decision: "retain",
      reason: "provider-delivery-not-reconciled",
      expiresAt,
    };
  if (record.reconciledAt) finiteTimestamp(record.reconciledAt, "reconciledAt");
  if (now.getTime() < expiresAtMs)
    return { decision: "retain", reason: "not-yet-expired", expiresAt };
  return {
    decision: rule.actionAfterExpiry,
    reason: "policy-expired",
    expiresAt,
  };
}
