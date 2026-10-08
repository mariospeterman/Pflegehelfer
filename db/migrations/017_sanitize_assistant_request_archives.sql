-- Assistant request receipts are durable historical records, not capability
-- stores. Migration 015 could contain a full DraftAction/OpenUI response. Strip
-- executable components and every serialized OpenUI program additively; the
-- application reconstructs token-free OpenUI from the retained components.
CREATE OR REPLACE FUNCTION pg_temp.pfh_strip_archived_capabilities(value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  kind text := jsonb_typeof(value);
  result jsonb;
BEGIN
  IF kind = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(entry.key,
                     pg_temp.pfh_strip_archived_capabilities(entry.value)),
                    '{}'::jsonb)
      INTO result
      FROM jsonb_each(value) AS entry
     WHERE entry.key !~* '(?:token|authority|capability|secret)'
       AND entry.key <> 'openUi';
    RETURN result;
  ELSIF kind = 'array' THEN
    SELECT COALESCE(jsonb_agg(
                     pg_temp.pfh_strip_archived_capabilities(item.value)
                     ORDER BY item.ordinality), '[]'::jsonb)
      INTO result
      FROM jsonb_array_elements(value) WITH ORDINALITY AS item(value, ordinality);
    RETURN result;
  END IF;
  RETURN value;
END;
$$;

-- Any migration-015 capability is invalid after upgrade. The proposal remains
-- as historical/pending lifecycle data and can only be resumed through a new,
-- currently authorized short-lived capability.
UPDATE safety_authority AS authority
SET consumed_at = COALESCE(authority.consumed_at, clock_timestamp())
FROM assistant_proposal_revisions AS proposal
JOIN assistant_request_claims AS claim
  ON claim.organization_id = proposal.organization_id
 AND claim.thread_id = proposal.thread_id
 AND claim.response->>'id' = proposal.source_response_id::text
WHERE authority.organization_id = proposal.organization_id
  AND authority.proposal_revision_id = proposal.id
  AND authority.authority_type = 'intent'
  AND claim.state = 'completed';

WITH sanitized AS (
  SELECT organization_id,
         site_id,
         actor_id,
         command_id,
         pg_temp.pfh_strip_archived_capabilities(COALESCE(
           (
             SELECT jsonb_agg(component ORDER BY ordinal)
             FROM jsonb_array_elements(
                    CASE
                      WHEN jsonb_typeof(response->'components') = 'array'
                        THEN response->'components'
                      ELSE '[]'::jsonb
                    END
                  ) WITH ORDINALITY AS item(component, ordinal)
             WHERE component->>'type' <> 'DraftAction'
               AND NOT component ? 'intentToken'
           ),
           '[]'::jsonb
         )) AS components
  FROM assistant_request_claims
  WHERE state = 'completed' AND response IS NOT NULL
)
UPDATE assistant_request_claims AS claim
SET response = pg_temp.pfh_strip_archived_capabilities(
                 jsonb_build_object(
                   'id', claim.response->'id',
                   'classification', claim.response->'classification',
                   'runtime', claim.response->'runtime',
                   'patientContext', claim.response->'patientContext',
                   'components', sanitized.components,
                   'evidence', COALESCE(claim.response->'evidence', '[]'::jsonb),
                   'warnings', COALESCE(claim.response->'warnings', '[]'::jsonb)
                 )
               ) || jsonb_build_object('openUi', ''),
    updated_at = clock_timestamp()
FROM sanitized
WHERE claim.organization_id = sanitized.organization_id
  AND claim.site_id = sanitized.site_id
  AND claim.actor_id = sanitized.actor_id
  AND claim.command_id = sanitized.command_id;

INSERT INTO pfh_schema_migrations (version)
VALUES (17)
ON CONFLICT DO NOTHING;
