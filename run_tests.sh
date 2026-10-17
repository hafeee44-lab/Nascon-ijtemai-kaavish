#!/usr/bin/env sh
# Runs all backend unit tests with line coverage, then prints coverage per graded area
# (the same figures declared in COVERAGE.json). Uses local Node if present, else Docker.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
TEST_CMD="npx vitest run --coverage --coverage.reporter=text-summary --coverage.reporter=json-summary \
  --coverage.include='src/**/*.ts' --coverage.exclude='src/**/*.spec.ts' --coverage.exclude='src/test/**' $* \
  && echo 'Coverage per area:' && node scripts/coverage-areas.mjs"

if command -v npx >/dev/null 2>&1; then
  cd "$ROOT/backend"
  [ -d node_modules ] || npm ci --no-audit --no-fund
  sh -c "$TEST_CMD"
else
  docker run --rm -v "$ROOT/backend":/src:ro node:20-alpine sh -c \
    "cp -r /src /app && cd /app && rm -rf node_modules && npm ci --no-audit --no-fund >/dev/null && $TEST_CMD"
fi
