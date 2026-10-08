-- Assistant messages are durable history, never capability storage. Earlier
-- builds persisted the live response object inside content.response. Rebuild
-- that response from a strict capability-free projection and invalidate every
-- intent capability that existed before this upgrade; pending proposals can
-- only receive a fresh authority after current authorization/context checks.
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

-- See migration 022: this lets only the table owner perform the bounded
-- all-row upgrade while runtime principals remain governed by RLS.
ALTER TABLE assistant_messages NO FORCE ROW LEVEL SECURITY;
ALTER TABLE safety_authority NO FORCE ROW LEVEL SECURITY;

WITH sanitized AS (
  SELECT organization_id,
         thread_id,
         sequence,
         pg_temp.pfh_strip_archived_capabilities(
           jsonb_build_object(
             'id', content->'response'->'id',
             'classification', content->'response'->'classification',
             'runtime', content->'response'->'runtime',
             'patientContext', content->'response'->'patientContext',
             'components', COALESCE(
               (
                 SELECT jsonb_agg(component ORDER BY ordinal)
                 FROM jsonb_array_elements(
                   CASE
                     WHEN jsonb_typeof(content->'response'->'components') = 'array'
                       THEN content->'response'->'components'
                     ELSE '[]'::jsonb
                   END
                 ) WITH ORDINALITY AS item(component, ordinal)
                 WHERE component->>'type' <> 'DraftAction'
                   AND NOT component ? 'intentToken'
               ),
               '[]'::jsonb
             ),
             'evidence', COALESCE(content->'response'->'evidence', '[]'::jsonb),
             'warnings', COALESCE(content->'response'->'warnings', '[]'::jsonb)
           )
         ) || jsonb_build_object('openUi', '') AS archived_response
  FROM assistant_messages
  WHERE kind = 'assistant'
    AND jsonb_typeof(content->'response') = 'object'
)
UPDATE assistant_messages AS message
SET content = jsonb_set(message.content, '{response}', sanitized.archived_response)
FROM sanitized
WHERE message.organization_id = sanitized.organization_id
  AND message.thread_id = sanitized.thread_id
  AND message.sequence = sanitized.sequence;

-- Unknown legacy response shapes cannot be interpreted safely. Preserve the
-- surrounding turn/provenance, but replace the opaque value rather than
-- retaining serialized capability material in storage.
UPDATE assistant_messages
SET content = jsonb_set(
  pg_temp.pfh_strip_archived_capabilities(content),
  '{response}',
  jsonb_build_object(
    'components', jsonb_build_array(jsonb_build_object(
      'type', 'SafetyAlert',
      'severity', 'info',
      'message', 'Historische Antwort muss erneut geprüft werden.'
    )),
    'evidence', '[]'::jsonb,
    'warnings', '[]'::jsonb,
    'openUi', ''
  )
)
WHERE kind = 'assistant'
  AND content ? 'response'
  AND jsonb_typeof(content->'response') IS DISTINCT FROM 'object';

-- Also strip capability-shaped keys from the full retained turn envelope.
UPDATE assistant_messages
SET content = pg_temp.pfh_strip_archived_capabilities(content)
WHERE kind = 'assistant';

UPDATE safety_authority
SET consumed_at = COALESCE(consumed_at, clock_timestamp())
WHERE authority_type = 'intent'
  AND consumed_at IS NULL;

ALTER TABLE assistant_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE safety_authority FORCE ROW LEVEL SECURITY;

INSERT INTO pfh_schema_migrations (version)
VALUES (23)
ON CONFLICT DO NOTHING;
