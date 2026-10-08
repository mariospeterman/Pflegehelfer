import { createHash } from "node:crypto";
import { z } from "zod";
import type { Purpose } from "./types.js";

const clinicalReference = z
  .string()
  .regex(
    /^(?:Patient|Encounter|Task|Observation|Communication)\/[A-Za-z0-9.-]{1,200}$/,
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const scalar = z.union([
  z.string().max(2_400),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const sourceReadClaimSchema = z
  .object({ path: z.string().trim().min(1).max(240), value: scalar })
  .strict();

export const sourceReadResourceSchema = z
  .object({
    reference: clinicalReference,
    logicalReference: clinicalReference,
    version: z.string().trim().min(1).max(240),
    patientId: z.string().trim().min(1).max(200).optional(),
    encounterId: z.string().trim().min(1).max(200).optional(),
    claims: z.array(sourceReadClaimSchema).max(200),
  })
  .strict();

export const sourceReadSelectorSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9._-]{2,120}$/),
    resourceType: z.enum(["Task", "Observation", "Communication"]),
    predicate: z.enum([
      "task-open",
      "observation-accepted",
      "communication-open",
    ]),
    patientId: z.string().trim().min(1).max(200),
    encounterId: z.string().trim().min(1).max(200),
    order: z.enum(["due-asc", "effective-desc", "recorded-desc"]),
    limit: z.number().int().min(1).max(100),
    totalCount: z.number().int().min(0).max(10_000),
    complete: z.boolean(),
    absenceObserved: z.boolean(),
    membershipReferences: z.array(clinicalReference).max(1_000),
    selectedReferences: z.array(clinicalReference).max(100),
    claims: z.array(sourceReadClaimSchema).max(100),
  })
  .strict();

const sourceReadSetContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidenceAuthority: z.enum([
      "fhir-meta-versionId",
      "memory-demo-not-fhir-evident",
    ]),
    capturedAt: z.iso.datetime({ offset: true }),
    purpose: z.enum([
      "direct-care",
      "operations",
      "administration",
      "quality-review",
      "emergency",
    ]) satisfies z.ZodType<Purpose>,
    policyVersion: z.string().trim().min(1).max(200),
    patientId: z.string().trim().min(1).max(200),
    encounterId: z.string().trim().min(1).max(200),
    resources: z.array(sourceReadResourceSchema).min(2).max(1_000),
    selectors: z.array(sourceReadSelectorSchema).max(20),
  })
  .strict();

export const sourceReadSetV1Schema = sourceReadSetContentSchema
  .extend({ digest })
  .strict();

export type SourceReadClaim = z.infer<typeof sourceReadClaimSchema>;
export type SourceReadResource = z.infer<typeof sourceReadResourceSchema>;
export type SourceReadSelector = z.infer<typeof sourceReadSelectorSchema>;
export type SourceReadSetV1 = z.infer<typeof sourceReadSetV1Schema>;
export type SourceReadSetContent = z.infer<typeof sourceReadSetContentSchema>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

const compareClaims = (left: SourceReadClaim, right: SourceReadClaim) =>
  left.path.localeCompare(right.path) ||
  canonicalJson(left.value).localeCompare(canonicalJson(right.value));

/**
 * The digest intentionally excludes capture time. A re-read at approval is
 * current exactly when versions, claims, selector membership and policy are
 * identical; the two timestamps remain separately auditable.
 */
export function sourceReadSetDigest(
  input: Omit<SourceReadSetContent, "capturedAt">,
): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function buildSourceReadSetV1(
  input: SourceReadSetContent,
): SourceReadSetV1 {
  const parsed = sourceReadSetContentSchema.parse(input);
  const byReference = new Map<string, SourceReadResource>();
  for (const resource of parsed.resources) {
    const prior = byReference.get(resource.reference);
    if (prior && prior.version !== resource.version)
      throw new Error(`SOURCE_READ_VERSION_CONFLICT:${resource.reference}`);
    const claims = [...(prior?.claims ?? []), ...resource.claims]
      .filter(
        (claim, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.path === claim.path &&
              canonicalJson(candidate.value) === canonicalJson(claim.value),
          ) === index,
      )
      .toSorted(compareClaims);
    byReference.set(resource.reference, {
      ...(prior ?? resource),
      ...resource,
      claims,
    });
  }
  const resources = [...byReference.values()].toSorted((left, right) =>
    left.reference.localeCompare(right.reference),
  );
  const selectors = parsed.selectors
    .map((selector) => ({
      ...selector,
      membershipReferences: [...new Set(selector.membershipReferences)].sort(),
      selectedReferences: [...new Set(selector.selectedReferences)],
      claims: [...selector.claims].toSorted(compareClaims),
    }))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const normalized: SourceReadSetContent = {
    ...parsed,
    resources,
    selectors,
  };
  const digestInput: Omit<SourceReadSetContent, "capturedAt"> = {
    schemaVersion: normalized.schemaVersion,
    evidenceAuthority: normalized.evidenceAuthority,
    purpose: normalized.purpose,
    policyVersion: normalized.policyVersion,
    patientId: normalized.patientId,
    encounterId: normalized.encounterId,
    resources: normalized.resources,
    selectors: normalized.selectors,
  };
  return {
    ...normalized,
    digest: sourceReadSetDigest(digestInput),
  };
}

export function parseSourceReadSetV1(input: unknown): SourceReadSetV1 {
  const parsed = sourceReadSetV1Schema.parse(input);
  const content: SourceReadSetContent = {
    schemaVersion: parsed.schemaVersion,
    evidenceAuthority: parsed.evidenceAuthority,
    capturedAt: parsed.capturedAt,
    purpose: parsed.purpose,
    policyVersion: parsed.policyVersion,
    patientId: parsed.patientId,
    encounterId: parsed.encounterId,
    resources: parsed.resources,
    selectors: parsed.selectors,
  };
  const rebuilt = buildSourceReadSetV1(content);
  if (rebuilt.digest !== parsed.digest)
    throw new Error("SOURCE_READ_SET_DIGEST_MISMATCH");
  return rebuilt;
}

export function sourceReadSetMatches(
  reviewed: SourceReadSetV1,
  current: SourceReadSetV1,
): boolean {
  return (
    reviewed.schemaVersion === current.schemaVersion &&
    reviewed.evidenceAuthority === current.evidenceAuthority &&
    reviewed.digest === current.digest
  );
}
