#!/usr/bin/env bash
# Regenerates src/shared/thoriumEventNames.ts from the sibling thorium repo's schema.
set -euo pipefail
S="${1:-../thorium/src/schema.graphql}"
OUT="src/shared/thoriumEventNames.ts"
{
  echo "/** Generated from thorium/src/schema.graphql (Mutation names). Regenerate with scripts/gen-thorium-events.sh */"
  echo "export const THORIUM_EVENT_NAMES: string[] = ["
  awk '/^type Mutation \{/,/^}/ { if (match($0, /^  [A-Za-z_][A-Za-z0-9_]*/)) print substr($0, 3, RLENGTH-2) }' "$S" \
    | grep -v '^_' | sort -u | sed "s/.*/  '&',/"
  echo "]"
} > "$OUT"
echo "wrote $OUT ($(grep -c "'" "$OUT") names)"
