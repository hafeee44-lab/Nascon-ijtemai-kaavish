import { ApiError } from '../common/api-error.js';
import { doubleElim, seedOrder, singleElim } from './brackets.js';
import { roundRobin } from './round-robin.js';
import { swiss } from './swiss.js';

const teams = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

describe('round robin (circle method)', () => {
  for (const n of [2, 3, 4, 5, 8, 9, 15, 16]) {
    for (const legs of [1, 2]) {
      it(`n=${n} legs=${legs} satisfies every structural rule`, () => {
        const r = roundRobin(teams(n), { legs });
        const perLeg = n % 2 ? n : n - 1;
        expect(r.round_count).toBe(perLeg * legs);
        const pairCount = new Map<string, number>();
        const ordered = new Set<string>();
        for (const round of r.rounds) {
          expect(round.matches.length).toBe(Math.floor(n / 2));
          expect(round.byes.length).toBe(n % 2);
          const seen = round.matches.flatMap((m) => [m.home, m.away]).concat(round.byes);
          expect(new Set(seen).size).toBe(n);
          round.matches.forEach((m, i) => expect(m.match_id).toBe(`RR-L${m.leg}-R${round.round}-M${i + 1}`));
          for (const m of round.matches) {
            const k = [m.home, m.away].sort().join('|');
            pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
            ordered.add(`${m.home}>${m.away}`);
          }
        }
        expect(pairCount.size).toBe((n * (n - 1)) / 2);
        for (const c of pairCount.values()) expect(c).toBe(legs);
        if (legs === 2) expect(ordered.size).toBe(n * (n - 1));
        for (let leg = 1; leg <= legs; leg++) {
          for (const t of teams(n)) {
            const ms = r.rounds.flatMap((x) => x.matches).filter((m) => m.leg === leg);
            const h = ms.filter((m) => m.home === t).length;
            const a = ms.filter((m) => m.away === t).length;
            expect(Math.abs(h - a)).toBeLessThanOrEqual(1);
          }
        }
      });
    }
  }

  it('applies forfeit_remaining and void_all withdrawals', () => {
    const f = roundRobin(teams(5), { withdrawals: [{ team_id: 't3', after_round: 2 }] });
    const t3 = f.rounds.flatMap((r) => r.matches.map((m) => ({ ...m, round: r.round }))).filter((m) => m.home === 't3' || m.away === 't3');
    for (const m of t3) {
      if (m.round > 2) { expect(m.status).toBe('forfeit'); expect(m.awarded_to).toBe(m.home === 't3' ? m.away : m.home); }
      else expect(m.status).toBe('scheduled');
    }
    expect(f.summary.total).toBe(10);
    expect(f.summary.forfeit + f.summary.scheduled).toBe(10);
    const v = roundRobin(teams(5), { withdrawals: [{ team_id: 't3', after_round: 2 }], withdrawal_policy: 'void_all' });
    expect(v.summary.voided).toBe(4);
    expect(() => roundRobin(teams(5), { withdrawals: [{ team_id: 'zz', after_round: 1 }] })).toThrow(ApiError);
    expect(() => roundRobin(teams(5), { withdrawals: [{ team_id: 't1', after_round: 6 }] })).toThrow(ApiError);
  });
});

describe('swiss', () => {
  it('round 1 is exact', () => {
    const r = swiss(teams(5), { total_rounds: 3, round: 1 });
    expect(r.bye).toBe('t5');
    expect(r.pairings).toEqual([
      { match_id: 'SW-R1-M1', home: 't1', away: 't3' },
      { match_id: 'SW-R1-M2', home: 't2', away: 't4' },
    ]);
  });

  it('matches the spec example standings and avoids rematches', () => {
    const r = swiss(teams(5), {
      total_rounds: 3, round: 2,
      history: [{ round: 1, bye: 't5', matches: [{ home: 't1', away: 't3', result: 'home' }, { home: 't2', away: 't4', result: 'draw' }] }],
    });
    expect(r.standings.slice(0, 3)).toEqual([
      { rank: 1, team_id: 't1', score: 1, buchholz: 0 },
      { rank: 2, team_id: 't5', score: 1, buchholz: 0 },
      { rank: 3, team_id: 't2', score: 0.5, buchholz: 0.5 },
    ]);
    expect(r.bye).toBe('t3');
    const pairs = r.pairings.map((p) => [p.home, p.away].sort().join('|'));
    expect(pairs).not.toContain('t1|t3');
    expect(pairs).not.toContain('t2|t4');
  });

  it('reports NO_VALID_PAIRING when every pairing is a rematch', () => {
    const all = [['t1', 't2'], ['t3', 't4'], ['t1', 't3'], ['t2', 't4'], ['t1', 't4'], ['t2', 't3']];
    const history = [0, 1, 2].map((i) => ({ round: i + 1, bye: null, matches: all.slice(i * 2, i * 2 + 2).map(([home, away]) => ({ home, away, result: 'home' as const })) }));
    try {
      swiss(teams(4), { total_rounds: 3, round: 3, history: history.slice(0, 2) });
      swiss(teams(4), { total_rounds: 3, round: 3, history: [history[0], history[1]] });
    } catch {
      /* round 3 still has a valid pairing */
    }
    expect(() => swiss(teams(4), { total_rounds: 3, round: 4, history })).toThrow(ApiError);
  });
});

describe('elimination brackets', () => {
  it('builds the recursive seed order', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('single elim n=6 matches the spec example', () => {
    const r = singleElim(teams(6), {});
    expect(r.bracket_size).toBe(8);
    const r1 = r.rounds[0].matches;
    expect(r1[0]).toMatchObject({ match_id: 'R1M1', home: 't1', away: null, bye: true, winner: 't1', winner_to: { match_id: 'R2M1', slot: 'home' } });
    expect(r1[1]).toMatchObject({ match_id: 'R1M2', home: 't4', away: 't5', home_seed: 4, away_seed: 5, bye: false, winner_to: { match_id: 'R2M1', slot: 'away' } });
    expect(r.rounds[1].matches[0].home).toBe('t1');
    expect(r.rounds[2].matches[0].winner_to).toBeNull();
    const after = singleElim(teams(6), { results: [{ match_id: 'R1M2', winner: 't4' }], third_place_match: true });
    expect(after.rounds[1].matches[0]).toMatchObject({ home: 't1', away: 't4' });
    expect(after.rounds[2].matches.find((m) => m.match_id === 'TP')).toBeTruthy();
    expect(() => singleElim(teams(6), { results: [{ match_id: 'R1M2', winner: 't1' }] })).toThrow(ApiError);
    expect(() => singleElim(teams(6), { results: [{ match_id: 'R9M9', winner: 't1' }] })).toThrow(ApiError);
  });

  it('double elim has exact ids, counts and a single source per slot', () => {
    for (const n of [3, 4, 6, 8, 13, 16]) {
      const r = doubleElim(teams(n), { bracket_reset: true });
      const B = r.bracket_size;
      const k = Math.log2(B);
      expect(r.winners.length).toBe(k);
      r.winners.forEach((x, i) => expect(x.matches.length).toBe(B / 2 ** (i + 1)));
      expect(r.losers.length).toBe(2 * (k - 1));
      expect(r.losers.flatMap((x) => x.matches).length).toBe(B - 2);
      const all = [...r.winners, ...r.losers].flatMap((x) => x.matches).concat(r.grand_final);
      const fed = new Map<string, number>();
      for (const m of all) {
        for (const l of [m.winner_to, m.loser_to]) if (l) fed.set(`${l.match_id}.${l.slot}`, (fed.get(`${l.match_id}.${l.slot}`) ?? 0) + 1);
        if (m.bracket === 'winners') expect(m.loser_to).not.toBeNull();
        if (m.bracket === 'losers') expect(m.loser_to).toBeNull();
      }
      for (const v of fed.values()) expect(v).toBe(1);
      for (const m of all) if (!m.match_id.startsWith('WR1')) {
        expect(fed.get(`${m.match_id}.home`)).toBe(1);
        expect(fed.get(`${m.match_id}.away`)).toBe(1);
      }
    }
  });

  it('grand final reset is required only when the losers champion wins GF1', () => {
    const play = (gf1Winner: 'home' | 'away') => {
      const res: { match_id: string; winner: string }[] = [];
      let r = doubleElim(teams(4), { bracket_reset: true });
      const step = () => {
        for (const m of [...r.winners, ...r.losers].flatMap((x) => x.matches).concat([r.grand_final[0]])) {
          if (m.home && m.away && !m.winner && !res.find((x) => x.match_id === m.match_id)) {
            res.push({ match_id: m.match_id, winner: m.match_id === 'GF1' ? (m as any)[gf1Winner] : m.home });
            r = doubleElim(teams(4), { bracket_reset: true, results: res });
            return true;
          }
        }
        return false;
      };
      while (step());
      return r.grand_final[1];
    };
    expect(play('away').required).toBe(true);
    expect(play('home').required).toBe(false);
    expect(doubleElim(teams(4), { bracket_reset: true }).grand_final[1].required).toBeNull();
  });
});
