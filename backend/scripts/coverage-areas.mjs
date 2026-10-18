// Prints line coverage per graded backend area (the figures declared in COVERAGE.json).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const AREAS = {
  fixtures: ['src/fixtures/round-robin.ts', 'src/fixtures/swiss.ts', 'src/fixtures/brackets.ts'],
  scoring: ['src/scoring/projection.ts', 'src/sports/sport-config.ts', 'src/common/canonical.ts'],
  standings: ['src/standings/standings.ts'],
  store: ['src/store/receipt-pdf.ts', 'src/store/store.service.ts', 'src/store/order-status.ts'],
  roster: ['src/roster/roster.service.ts'],
  rbac: ['src/rbac/policy.ts', 'src/rbac/rate-limiter.ts', 'src/rbac/auth.service.ts'],
};

// Day 2 modules (COVERAGE_DAY2.json).
const AREAS_DAY2 = {
  streaming: ['src/streaming/stream-keys.ts', 'src/streaming/players.ts', 'src/streaming/media-bridge.ts'],
  costream: ['src/costream/costream.ts'],
  qr_guest: ['src/qr_guest/qr.ts', 'src/qr_guest/guest.ts', 'src/qr_guest/guest-guard.ts'],
  moderation_dlq: ['src/moderation_dlq/moderation.ts', 'src/moderation_dlq/moderation.service.ts'],
  observability: ['src/observability/metrics.ts', 'src/queue/redis-ping.ts'],
};

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const measure = (areas) => {
const out = {};
for (const [area, files] of Object.entries(areas)) {
  let covered = 0;
  let total = 0;
  for (const f of files) {
    const s = summary[resolve(f)];
    if (!s) continue;
    covered += s.lines.covered;
    total += s.lines.total;
  }
  out[area] = total ? Math.round((1000 * covered) / total) / 10 : 0;
}
return out;
};
console.log('Day 1:', JSON.stringify(measure(AREAS)));
console.log('Day 2:', JSON.stringify(measure(AREAS_DAY2)));
