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

const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
const out = {};
for (const [area, files] of Object.entries(AREAS)) {
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
console.log(JSON.stringify(out));
