#!/bin/sh
set -eu

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" <<'SQL'
\getenv runtime_password PFH_RUNTIME_POSTGRES_PASSWORD
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pflegehelfer_runtime') THEN
    CREATE ROLE pflegehelfer_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE pflegehelfer_runtime PASSWORD :'runtime_password';
GRANT CONNECT ON DATABASE pflegehelfer TO pflegehelfer_runtime;
GRANT USAGE ON SCHEMA public TO pflegehelfer_runtime;
SQL
