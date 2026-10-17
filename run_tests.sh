#!/usr/bin/env sh
# Runs all backend unit tests with line coverage.
set -e
cd "$(dirname "$0")/backend"
[ -d node_modules ] || npm ci --no-audit --no-fund
npx vitest run --coverage "$@"
