#!/usr/bin/env bash
set -euo pipefail

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

valid="$tmp_dir/valid.json"
application_error="$tmp_dir/application-error.json"
missing_count="$tmp_dir/missing-count.json"
string_count="$tmp_dir/string-count.json"

printf '%s\n' '{"ok":true,"data":{"closed_count":2}}' > "$valid"
printf '%s\n' '{"ok":false,"error":"Authentication failed."}' > "$application_error"
printf '%s\n' '{"ok":true,"data":{}}' > "$missing_count"
printf '%s\n' '{"ok":true,"data":{"closed_count":"2"}}' > "$string_count"

assert_valid() {
  local file="$1"
  jq -e '.ok == true and (.data.closed_count | type == "number")' "$file" >/dev/null
}

assert_invalid() {
  local file="$1"
  if jq -e '.ok == true and (.data.closed_count | type == "number")' "$file" >/dev/null; then
    echo "Expected scheduler response to be rejected: $file" >&2
    exit 1
  fi
}

assert_valid "$valid"
assert_invalid "$application_error"
assert_invalid "$missing_count"
assert_invalid "$string_count"

echo "PASS: scheduler response envelope accepts only ok=true with numeric closed_count"
