import pg from "pg";
import { z } from "zod";

const { Pool } = pg;

const provisionedMembershipSchema = z
  .object({
    organizationId: z.string().regex(/^[a-z0-9-]{2,120}$/),
    issuer: z.url().transform((value) => value.replace(/\/+$/u, "")),
    subject: z.string().min(1).max(240),
    actorId: z.string().regex(/^[a-z0-9:-]{2,80}$/),
    membershipVersion: z.number().int().positive().max(2_147_483_647),
    policyVersion: z.string().min(1).max(160),
    active: z.boolean().default(true),
  })
  .strict();

export type ProvisionedOidcMembership = z.infer<
  typeof provisionedMembershipSchema
>;

const provisioningSchema = z.array(provisionedMembershipSchema).max(500);

export function parseOidcMembershipProvisioning(
  encoded: string | undefined,
): ProvisionedOidcMembership[] {
  if (!encoded) return [];
  let value: unknown;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error("OIDC_MEMBERSHIP_PROVISIONING_JSON_INVALID");
  }
  return provisioningSchema.parse(value);
}

/**
 * Owner-only deployment operation. The runtime role has SELECT permission on
 * memberships but cannot create, change, reactivate or revoke them.
 */
export async function provisionOidcMemberships(
  databaseUrl: string,
  memberships: readonly ProvisionedOidcMembership[],
): Promise<void> {
  if (memberships.length === 0) return;
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    query_timeout: 10_000,
    statement_timeout: 10_000,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const membership of memberships) {
      const existing = await client.query<{
        actor_id: string;
        membership_version: string;
        policy_version: string;
        active: boolean;
      }>(
        `SELECT actor_id,membership_version::text,policy_version,active
         FROM oidc_principal_memberships
         WHERE organization_id=$1 AND issuer=$2 AND subject=$3
         FOR UPDATE`,
        [membership.organizationId, membership.issuer, membership.subject],
      );
      const prior = existing.rows[0];
      const priorVersion = prior ? Number(prior.membership_version) : 0;
      const authorizationChanged = Boolean(
        prior &&
        (prior.actor_id !== membership.actorId ||
          prior.policy_version !== membership.policyVersion ||
          prior.active !== membership.active),
      );
      const effectiveVersion = prior
        ? authorizationChanged
          ? Math.max(priorVersion + 1, membership.membershipVersion)
          : Math.max(priorVersion, membership.membershipVersion)
        : membership.membershipVersion;
      await client.query(
        `INSERT INTO oidc_principal_memberships
           (organization_id,issuer,subject,actor_id,membership_version,
            policy_version,active,revoked_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,
           CASE WHEN $7 THEN NULL ELSE clock_timestamp() END)
         ON CONFLICT (organization_id,issuer,subject) DO UPDATE
         SET actor_id=EXCLUDED.actor_id,
             membership_version=EXCLUDED.membership_version,
             policy_version=EXCLUDED.policy_version,
             active=EXCLUDED.active,
             configured_at=clock_timestamp(),
             revoked_at=CASE WHEN EXCLUDED.active THEN NULL
                             ELSE clock_timestamp() END`,
        [
          membership.organizationId,
          membership.issuer,
          membership.subject,
          membership.actorId,
          effectiveVersion,
          membership.policyVersion,
          membership.active,
        ],
      );
      if (prior && effectiveVersion !== priorVersion)
        await client.query(
          `UPDATE oidc_sessions
           SET revoked_at=COALESCE(revoked_at,clock_timestamp()),
               revocation_reason=COALESCE(revocation_reason,'membership-revision')
           WHERE organization_id=$1 AND issuer=$2 AND subject=$3
             AND revoked_at IS NULL`,
          [membership.organizationId, membership.issuer, membership.subject],
        );
      // A deactivate/reactivate cycle, actor reassignment or policy change
      // always advances the server-owned revision even when the deployment
      // input repeats an old value. Old sessions are also terminally marked;
      // they can therefore never become valid again after later provisioning.
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
