#!/usr/bin/env sh
# Runs all backend unit tests with line coverage, then prints coverage per graded area
# (the same figures declared in COVERAGE.json).
set -e
cd "$(dirname "$0")/backend"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx vitest run --coverage --coverage.reporter=text-summary --coverage.reporter=json-summary \
  --coverage.include='src/**/*.ts' --coverage.exclude='src/**/*.spec.ts' --coverage.exclude='src/test/**' "$@"
echo "Coverage per area:"
node scripts/coverage-areas.mjs
