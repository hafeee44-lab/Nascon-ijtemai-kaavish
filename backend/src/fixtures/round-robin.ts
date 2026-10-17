import { validationError } from '../common/api-error.js';

export interface RRParams {
  legs?: number;
  withdrawals?: { team_id: string; after_round: number }[];
  withdrawal_policy?: 'void_all' | 'forfeit_remaining';
}

// FR-1.3 round robin via the circle method. For odd n the phantom "bye" slot is the fixed
// position, so every real team rotates through all positions and |home − away| ≤ 1 per leg.
export function roundRobin(teams: string[], params: RRParams = {}) {
  const legs = params.legs ?? 1;
  if (legs !== 1 && legs !== 2) throw validationError(['params.legs']);
  const policy = params.withdrawal_policy ?? 'forfeit_remaining';
  if (policy !== 'void_all' && policy !== 'forfeit_remaining') throw validationError(['params.withdrawal_policy']);
  const withdrawals = params.withdrawals ?? [];
  if (!Array.isArray(withdrawals)) throw validationError(['params.withdrawals']);

  const n = teams.length;
  const odd = n % 2 === 1;
  const arr: (string | null)[] = odd ? [null, ...teams] : [...teams];
  const m = arr.length;
  const perLeg = m - 1;
  const roundCount = perLeg * legs;

  const out: string[] = [];
  const wd = new Map<string, number>();
  for (const w of withdrawals) {
    if (typeof w !== 'object' || w === null || !teams.includes(w.team_id) || !Number.isInteger(w.after_round) || w.after_round < 0 || w.after_round > roundCount)
      throw validationError(['params.withdrawals']);
    wd.set(w.team_id, w.after_round);
  }
  void out;

  const leg1: { home: string; away: string }[][] = [];
  const byes1: string[][] = [];
  let rot = arr.slice(1);
  for (let r = 0; r < perLeg; r++) {
    const cur = [arr[0], ...rot];
    const games: { home: string; away: string }[] = [];
    const byes: string[] = [];
    for (let i = 0; i < m / 2; i++) {
      const a = cur[i];
      const b = cur[m - 1 - i];
      if (a === null || b === null) {
        byes.push((a ?? b)!);
        continue;
      }
      // fixed slot alternates; other pairs: left side at home
      if (i === 0 && r % 2 === 1) games.push({ home: b, away: a });
      else games.push({ home: a, away: b });
    }
    leg1.push(games);
    byes1.push(byes);
    rot = [rot[rot.length - 1], ...rot.slice(0, -1)];
  }

  const summary = { total: 0, scheduled: 0, forfeit: 0, voided: 0 };
  const rounds = [];
  for (let leg = 1; leg <= legs; leg++) {
    for (let r = 0; r < perLeg; r++) {
      const round = (leg - 1) * perLeg + r + 1;
      const matches = leg1[r].map((g, i) => {
        const [home, away] = leg === 1 ? [g.home, g.away] : [g.away, g.home];
        let status = 'scheduled';
        let awarded_to: string | null = null;
        const hw = wd.get(home);
        const aw = wd.get(away);
        if (policy === 'void_all') {
          if (hw !== undefined || aw !== undefined) status = 'voided';
        } else {
          const hOut = hw !== undefined && round > hw;
          const aOut = aw !== undefined && round > aw;
          if (hOut && aOut) status = 'voided';
          else if (hOut) { status = 'forfeit'; awarded_to = away; }
          else if (aOut) { status = 'forfeit'; awarded_to = home; }
        }
        summary.total++;
        summary[status as 'scheduled' | 'forfeit' | 'voided']++;
        return { match_id: `RR-L${leg}-R${round}-M${i + 1}`, leg, home, away, status, awarded_to };
      });
      rounds.push({ round, matches, byes: byes1[r] });
    }
  }
  return { format: 'round_robin', legs, team_count: n, round_count: roundCount, rounds, summary };
}
