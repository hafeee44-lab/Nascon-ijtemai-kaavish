import { validationError } from '../common/api-error.js';

// FR-1.3 single and double elimination. Every match slot has one source (a seed, or the
// winner/loser of another match); teams, byes and results are propagated through that graph.

type Source = { kind: 'seed'; seed: number } | { kind: 'winner' | 'loser'; match_id: string };
type Link = { match_id: string; slot: 'home' | 'away' } | null;

interface Node {
  match_id: string; bracket: string; round: number; index: number;
  src: { home: Source | null; away: Source | null };
  winner_to: Link; loser_to: Link;
  conditional?: boolean;
}

interface State { home: string | null; away: string | null; winner: string | null; loser: string | null; bye: boolean; dead: boolean }

export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const k2 = order.length * 2;
    order = order.flatMap((s) => [s, k2 + 1 - s]);
  }
  return order.slice(0, size);
}

const nextPow2 = (n: number) => {
  let b = 1;
  while (b < n) b *= 2;
  return Math.max(2, b);
};

class Bracket {
  nodes = new Map<string, Node>();
  state = new Map<string, State>();
  constructor(private teams: string[]) {}

  add(node: Node) {
    this.nodes.set(node.match_id, node);
  }

  link(from: string, kind: 'winner' | 'loser', to: string, slot: 'home' | 'away') {
    const f = this.nodes.get(from)!;
    if (kind === 'winner') f.winner_to = { match_id: to, slot };
    else f.loser_to = { match_id: to, slot };
    this.nodes.get(to)!.src[slot] = { kind, match_id: from };
  }

  private slotValue(src: Source | null): { team: string | null; dead: boolean } {
    if (!src) return { team: null, dead: false };
    if (src.kind === 'seed') return src.seed <= this.teams.length ? { team: this.teams[src.seed - 1], dead: false } : { team: null, dead: true };
    const s = this.state.get(src.match_id);
    if (!s) return { team: null, dead: false };
    if (src.kind === 'winner') return { team: s.winner, dead: s.dead };
    // a bye or dead match never produces a loser
    return { team: s.loser, dead: s.dead || (s.bye && !!s.winner) };
  }

  // Recompute every match from sources + recorded results until stable.
  propagate(results: Map<string, string>) {
    for (let pass = 0; pass < this.nodes.size + 2; pass++) {
      let changed = false;
      for (const n of this.nodes.values()) {
        if (n.conditional) continue;
        const h = this.slotValue(n.src.home);
        const a = this.slotValue(n.src.away);
        const st: State = { home: h.team, away: a.team, winner: null, loser: null, bye: false, dead: false };
        if (h.dead && a.dead) st.dead = true;
        else if (h.dead && a.team) { st.bye = true; st.winner = a.team; }
        else if (a.dead && h.team) { st.bye = true; st.winner = h.team; }
        else if (h.team && a.team && results.has(n.match_id)) {
          st.winner = results.get(n.match_id)!;
          st.loser = st.winner === h.team ? a.team : h.team;
        }
        const prev = this.state.get(n.match_id);
        if (!prev || JSON.stringify(prev) !== JSON.stringify(st)) { this.state.set(n.match_id, st); changed = true; }
      }
      if (!changed) break;
    }
  }

  applyResults(results: unknown) {
    if (results !== undefined && !Array.isArray(results)) throw validationError(['params.results']);
    const applied = new Map<string, string>();
    this.propagate(applied);
    for (const r of (results as any[]) ?? []) {
      if (typeof r !== 'object' || r === null || typeof r.match_id !== 'string' || typeof r.winner !== 'string') throw validationError(['params.results']);
      const node = this.nodes.get(r.match_id);
      if (!node) throw validationError(['params.results'], `Unknown match ${r.match_id}.`);
      if (node.conditional) {
        applied.set(r.match_id, r.winner);
        continue;
      }
      const st = this.state.get(r.match_id)!;
      if (st.bye || !st.home || !st.away || (r.winner !== st.home && r.winner !== st.away))
        throw validationError(['params.results'], `${r.winner} is not a participant of ${r.match_id}.`);
      applied.set(r.match_id, r.winner);
      this.propagate(applied);
    }
    return applied;
  }

  seedOf(team: string | null) {
    return team === null ? null : this.teams.indexOf(team) + 1;
  }

  render(n: Node) {
    const st = this.state.get(n.match_id) ?? { home: null, away: null, winner: null, loser: null, bye: false, dead: false };
    return {
      match_id: n.match_id, bracket: n.bracket, round: n.round, index: n.index,
      home: st.home, away: st.away, home_seed: this.seedOf(st.home), away_seed: this.seedOf(st.away),
      bye: st.bye || st.dead, winner: st.winner, loser: st.loser, winner_to: n.winner_to, loser_to: n.loser_to,
    };
  }
}

function buildWinners(b: Bracket, B: number, prefix: string, bracket: string) {
  const k = Math.log2(B);
  const order = seedOrder(B);
  const id = (r: number, i: number) => `${prefix}${r}M${i}`;
  for (let r = 1; r <= k; r++) {
    for (let i = 1; i <= B / 2 ** r; i++) {
      b.add({
        match_id: id(r, i), bracket, round: r, index: i, winner_to: null, loser_to: null,
        src: r === 1 ? { home: { kind: 'seed', seed: Math.min(order[2 * i - 2], order[2 * i - 1]) }, away: { kind: 'seed', seed: Math.max(order[2 * i - 2], order[2 * i - 1]) } }
          : { home: null, away: null },
      });
    }
  }
  for (let r = 1; r < k; r++)
    for (let i = 1; i <= B / 2 ** r; i++) b.link(id(r, i), 'winner', id(r + 1, Math.ceil(i / 2)), i % 2 === 1 ? 'home' : 'away');
  return { k, id };
}

export function singleElim(teams: string[], params: { third_place_match?: boolean; results?: unknown } = {}) {
  const B = nextPow2(teams.length);
  const b = new Bracket(teams);
  const { k, id } = buildWinners(b, B, 'R', 'main');
  const third = params.third_place_match === true && k >= 2;
  if (third) {
    b.add({ match_id: 'TP', bracket: 'third_place', round: k, index: 2, src: { home: null, away: null }, winner_to: null, loser_to: null });
    b.link(id(k - 1, 1), 'loser', 'TP', 'home');
    b.link(id(k - 1, 2), 'loser', 'TP', 'away');
  }
  b.applyResults(params.results);
  const rounds = [];
  for (let r = 1; r <= k; r++) {
    const matches = [...b.nodes.values()].filter((n) => n.bracket === 'main' && n.round === r).map((n) => b.render(n));
    if (r === k && third) matches.push(b.render(b.nodes.get('TP')!));
    rounds.push({ round: r, matches });
  }
  return { format: 'single_elim', bracket_size: B, rounds };
}

export function doubleElim(teams: string[], params: { bracket_reset?: boolean; results?: unknown } = {}) {
  const B = nextPow2(teams.length);
  const reset = params.bracket_reset === true;
  const b = new Bracket(teams);
  const { k, id: wr } = buildWinners(b, B, 'WR', 'winners');
  const lr = (r: number, i: number) => `LR${r}M${i}`;
  const lRounds = 2 * (k - 1);
  for (let r = 1; r <= lRounds; r++) {
    const j = Math.ceil(r / 2);
    for (let i = 1; i <= B / 2 ** (j + 1); i++)
      b.add({ match_id: lr(r, i), bracket: 'losers', round: r, index: i, src: { home: null, away: null }, winner_to: null, loser_to: null });
  }
  b.add({ match_id: 'GF1', bracket: 'grand_final', round: 1, index: 1, src: { home: null, away: null }, winner_to: null, loser_to: null });
  if (reset) b.add({ match_id: 'GF2', bracket: 'grand_final', round: 2, index: 1, src: { home: null, away: null }, winner_to: null, loser_to: null, conditional: true });

  // WR1 losers meet in LR1; WRr (r ≥ 2) losers drop into LR(2r−2) as the away side.
  for (let i = 1; i <= B / 2; i++) b.link(wr(1, i), 'loser', lr(1, Math.ceil(i / 2)), i % 2 === 1 ? 'home' : 'away');
  for (let r = 2; r <= k; r++) for (let i = 1; i <= B / 2 ** r; i++) b.link(wr(r, i), 'loser', lr(2 * r - 2, i), 'away');
  for (let r = 1; r <= lRounds; r++) {
    const count = B / 2 ** (Math.ceil(r / 2) + 1);
    for (let i = 1; i <= count; i++) {
      if (r === lRounds) b.link(lr(r, i), 'winner', 'GF1', 'away');
      else if (r % 2 === 1) b.link(lr(r, i), 'winner', lr(r + 1, i), 'home');
      else b.link(lr(r, i), 'winner', lr(r + 1, Math.ceil(i / 2)), i % 2 === 1 ? 'home' : 'away');
    }
  }
  b.link(wr(k, 1), 'winner', 'GF1', 'home');
  if (reset) {
    b.link('GF1', 'winner', 'GF2', 'home');
    b.link('GF1', 'loser', 'GF2', 'away');
  }
  const applied = b.applyResults(params.results);

  const render = (bracket: string, rounds: number) =>
    Array.from({ length: rounds }, (_, r) => ({
      round: r + 1,
      matches: [...b.nodes.values()].filter((n) => n.bracket === bracket && n.round === r + 1).map((n) => b.render(n)),
    }));
  const gf1 = b.render(b.nodes.get('GF1')!);
  const grand_final: any[] = [{ ...gf1, conditional: false, required: true }];
  if (reset) {
    const gf1Done = gf1.winner !== null;
    const required = gf1Done ? gf1.winner === gf1.away : null;
    const g2 = b.nodes.get('GF2')!;
    const res = applied.get('GF2') ?? null;
    const home = gf1Done ? gf1.winner : null;
    const away = gf1Done ? gf1.loser : null;
    grand_final.push({
      match_id: 'GF2', bracket: 'grand_final', round: 2, index: 1, home, away,
      home_seed: b.seedOf(home), away_seed: b.seedOf(away), bye: false,
      winner: required && res && (res === home || res === away) ? res : null,
      loser: required && res && (res === home || res === away) ? (res === home ? away : home) : null,
      winner_to: g2.winner_to, loser_to: g2.loser_to, conditional: true, required,
    });
  }
  return { format: 'double_elim', bracket_size: B, bracket_reset: reset, winners: render('winners', k), losers: render('losers', lRounds), grand_final };
}
