#!/usr/bin/env bash
set -euo pipefail

# Negative preflight tests. This script MUST run only against the disposable
# PostgreSQL service created by GitHub Actions; it creates/drops temporary DBs.
MIGRATION="supabase/migrations/20261016160000_fix_manual_session_close_updated_at.sql"
SETUP="tests/sql/session-auto-close-setup.sql"
created_dbs=()
cleanup() {
  for db in "${created_dbs[@]}"; do
    dropdb --if-exists "$db" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

new_db() {
  local case_name="$1"
  DB="preflight_${case_name}_$$"
  createdb "$DB"
  created_dbs+=("$DB")
  psql -X -v ON_ERROR_STOP=1 -d "$DB" -f "$SETUP" >/dev/null
}

definition() {
  psql -X -v ON_ERROR_STOP=1 -At -d "$1" -c \
    "SELECT COALESCE(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.ylp_close_session_v1(text)')), 'MISSING')"
}

expect_refusal_without_change() {
  local case_name="$1"
  local db="$2"
  local before after log_file
  log_file="/tmp/preflight-${case_name}-$$.log"
  before="$(definition "$db")"
  if psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$MIGRATION" >"$log_file" 2>&1; then
    cat "$log_file"
    rm -f "$log_file"
    echo "FAIL: migration unexpectedly accepted case '$case_name'" >&2
    return 1
  fi
  if ! grep -Eqi 'Preflight failed|Preflight stopped' "$log_file"; then
    cat "$log_file"
    rm -f "$log_file"
    echo "FAIL: case '$case_name' failed for an unexpected reason" >&2
    return 1
  fi
  rm -f "$log_file"
  after="$(definition "$db")"
  if [[ "$before" != "$after" ]]; then
    echo "FAIL: migration changed the function definition for rejected case '$case_name'" >&2
    return 1
  fi
  echo "PASS: '$case_name' was rejected without changing the function definition"
}

new_db missing_rpc
db="$DB"
psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'DROP FUNCTION public.ylp_close_session_v1(text)' >/dev/null
expect_refusal_without_change missing_rpc "$db"

new_db owner_mismatch
db="$DB"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL' >/dev/null
GRANT CREATE ON SCHEMA public TO service_role;
ALTER FUNCTION public.ylp_close_session_v1(text) OWNER TO service_role;
REVOKE CREATE ON SCHEMA public FROM service_role;
SQL
expect_refusal_without_change owner_mismatch "$db"

new_db search_path_mismatch
db="$DB"
psql -X -v ON_ERROR_STOP=1 -d "$db" -c 'ALTER FUNCTION public.ylp_close_session_v1(text) SET search_path TO public' >/dev/null
expect_refusal_without_change search_path_mismatch "$db"

new_db body_mismatch
db="$DB"
psql -X -v ON_ERROR_STOP=1 -d "$db" <<'SQL' >/dev/null
CREATE OR REPLACE FUNCTION public.ylp_close_session_v1(p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
BEGIN
  RETURN pg_catalog.jsonb_build_object('ok', false, 'code', 'unexpected_body');
END;
$function$;
SQL
expect_refusal_without_change body_mismatch "$db"

new_db already_fixed
db="$DB"
psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$MIGRATION" >/dev/null
expect_refusal_without_change already_fixed "$db"

echo 'PASS: all manual-close migration negative preflight cases'
