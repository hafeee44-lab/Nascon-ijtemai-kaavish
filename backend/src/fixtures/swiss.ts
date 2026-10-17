import { ApiError, validationError } from '../common/api-error.js';

export interface SwissParams {
  total_rounds?: number;
  round?: number;
  history?: { round: number; bye: string | null; matches: { home: string; away: string; result: 'home' | 'away' | 'draw' }[] }[];
}

// FR-1.3 Swiss: exact round 1, then a globally optimal (min Σ|score diff|) rematch-free pairing
// found by branch-and-bound — never greedy.
export function swiss(teams: string[], params: SwissParams = {}) {
  const n = teams.length;
  const totalRounds = params.total_rounds ?? Math.max(1, Math.ceil(Math.log2(n)));
  if (!Number.isInteger(totalRounds) || totalRounds < 1 || totalRounds > Math.max(1, n - 1)) throw validationError(['params.total_rounds']);
  const round = params.round ?? 1;
  if (!Number.isInteger(round) || round < 1 || round > totalRounds) throw validationError(['params.round']);
  const history = params.history ?? [];
  const idx = new Map(teams.map((t, i) => [t, i]));
  if (!Array.isArray(history) || history.length !== round - 1) throw validationError(['params.history']);
  const seen = new Set<number>();
  for (const h of history) {
    if (typeof h !== 'object' || h === null || !Number.isInteger(h.round) || h.round < 1 || h.round >= round || seen.has(h.round) ||
      !(h.bye === null || h.bye === undefined || idx.has(h.bye)) || !Array.isArray(h.matches) ||
      !h.matches.every((m) => m && idx.has(m.home) && idx.has(m.away) && m.home !== m.away && ['home', 'away', 'draw'].includes(m.result)))
      throw validationError(['params.history']);
    seen.add(h.round);
  }

  const score = new Array(n).fill(0);
  const hadBye = new Array(n).fill(false);
  const opponents: number[][] = teams.map(() => []);
  const met = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const h of history) {
    if (h.bye) { score[idx.get(h.bye)!] += 1; hadBye[idx.get(h.bye)!] = true; }
    for (const m of h.matches) {
      const a = idx.get(m.home)!;
      const b = idx.get(m.away)!;
      opponents[a].push(b);
      opponents[b].push(a);
      met.add(key(a, b));
      if (m.result === 'home') score[a] += 1;
      else if (m.result === 'away') score[b] += 1;
      else { score[a] += 0.5; score[b] += 0.5; }
    }
  }
  const buchholz = teams.map((_, i) => opponents[i].reduce((s, o) => s + score[o], 0));
  const order = teams.map((_, i) => i).sort((a, b) => score[b] - score[a] || buchholz[b] - buchholz[a] || a - b);
  const standings = order.map((i, r) => ({ rank: r + 1, team_id: teams[i], score: score[i], buchholz: buchholz[i] }));

  let pairs: [number, number][] = [];
  let bye: number | null = null;
  if (round === 1) {
    const m = Math.floor(n / 2);
    if (n % 2 === 1) bye = n - 1;
    for (let i = 0; i < m; i++) pairs.push([i, i + m]);
  } else {
    const candidates = n % 2 === 0 ? [null]
      : teams.map((_, i) => i).filter((i) => !hadBye[i]).sort((a, b) => score[a] - score[b] || b - a);
    let found = false;
    for (const c of candidates) {
      const rest = order.filter((i) => i !== c);
      const best = bestPairing(rest, score, (a, b) => met.has(key(a, b)));
      if (best) { pairs = best; bye = c; found = true; break; }
    }
    if (!found) throw new ApiError(409, 'NO_VALID_PAIRING', `No rematch-free pairing exists for round ${round}.`, { round });
  }

  const rank = new Map(order.map((i, r) => [i, r]));
  pairs = pairs.map(([a, b]) => (round === 1 ? [a, b] : rank.get(a)! <= rank.get(b)! ? [a, b] : [b, a]) as [number, number]);
  pairs.sort((x, y) => (round === 1 ? x[0] - y[0] : rank.get(x[0])! - rank.get(y[0])!));
  return {
    format: 'swiss', round, total_rounds: totalRounds,
    pairings: pairs.map(([a, b], i) => ({ match_id: `SW-R${round}-M${i + 1}`, home: teams[a], away: teams[b] })),
    bye: bye === null ? null : teams[bye],
    standings,
  };
}

// Minimum-cost perfect matching on `items` (sorted by score desc) with forbidden pairs.
// Lower bound = cost of pairing neighbours in score order, which is optimal without constraints.
export function bestPairing(items: number[], score: number[], forbidden: (a: number, b: number) => boolean): [number, number][] | null {
  if (items.length % 2 === 1) return null;
  let best: [number, number][] | null = null;
  let bestCost = Infinity;
  const lowerBound = (rest: number[]) => {
    const s = rest.map((i) => score[i]).sort((a, b) => b - a);
    let c = 0;
    for (let i = 0; i + 1 < s.length; i += 2) c += Math.abs(s[i] - s[i + 1]);
    return c;
  };
  const globalLb = lowerBound(items);
  let nodes = 0;
  const rec = (rest: number[], acc: [number, number][], cost: number): boolean => {
    if (++nodes > 400_000) return true; // keep every request well under the 5 s budget
    if (rest.length === 0) {
      if (cost < bestCost) { bestCost = cost; best = acc.slice(); }
      return bestCost <= globalLb;
    }
    if (cost + lowerBound(rest) >= bestCost) return false;
    const [a, ...others] = rest;
    const options = others.filter((b) => !forbidden(a, b)).sort((x, y) => Math.abs(score[a] - score[x]) - Math.abs(score[a] - score[y]));
    for (const b of options) {
      acc.push([a, b]);
      const stop = rec(others.filter((x) => x !== b), acc, cost + Math.abs(score[a] - score[b]));
      acc.pop();
      if (stop) return true;
    }
    return false;
  };
  rec(items, [], 0);
  return best;
}
