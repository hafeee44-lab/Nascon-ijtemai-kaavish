import { BASE_SPORTS } from '../db/seed.js';
import type { SportConfig } from '../sports/sport-config.js';
import { computeStandings, League, PlayedMatch } from './standings.js';

const football = BASE_SPORTS.find((s) => s.sport_id === 'football') as unknown as SportConfig;
const cricket = BASE_SPORTS.find((s) => s.sport_id === 'cricket') as unknown as SportConfig;

const league = (teams: string[], spots = 2): League => ({
  league_id: 'lg-1', sport_id: 'football', teams, fixtures: [], points: { win: 3, draw: 1, loss: 0 },
  tie_break_order: null, qualification: { spots }, lots_seed: 42,
});
const g = (home: string, away: string, hs: number, as: number, extra: Partial<PlayedMatch> = {}): PlayedMatch => ({
  home, away, homeScore: hs, awayScore: as, winner: hs > as ? home : as > hs ? away : null,
  homeFairPlay: 0, awayFairPlay: 0, homeBalls: null, awayBalls: null, homeWickets: null, awayWickets: null, ...extra,
});
const rem = (o: Record<string, number>) => new Map(Object.entries(o));

describe('standings', () => {
  it('resolves a 3-way tie with the head-to-head mini-league', () => {
    const played = [g('t1', 't2', 2, 0), g('t2', 't3', 3, 1), g('t3', 't1', 1, 0), g('t1', 't4', 1, 0), g('t2', 't4', 1, 0), g('t3', 't4', 1, 0)];
    const { table, h2h } = computeStandings(football, league(['t1', 't2', 't3', 't4']), played, rem({}));
    expect(table.map((r) => r.team_id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(table.map((r) => r.resolved_by)).toEqual(['h2h_diff', 'h2h_diff', null, null]);
    expect(table[3].status).toBe('eliminated');
    expect(h2h.t1.t2).toEqual({ played: 1, points: 3, scored: 2, conceded: 0 });
    expect(h2h.t4.t1).toEqual({ played: 1, points: 0, scored: 0, conceded: 1 });
  });

  it('falls back to drawing of lots (spec test vector 2 order)', () => {
    const { table } = computeStandings(football, league(['t1', 't2', 't3'], 1), [], rem({ t1: 2, t2: 2, t3: 2 }));
    // keys: t1 061…, t3 c8f…, t2 e3e… → ascending
    expect(table.map((r) => r.team_id)).toEqual(['t1', 't3', 't2']);
    expect(table[0].resolved_by).toBe('draw_lots');
    expect(table.every((r) => r.status === 'still_possible')).toBe(true);
  });

  it('marks clinched / eliminated from maximum reachable points', () => {
    const played = [g('a', 'b', 1, 0), g('a', 'c', 1, 0), g('b', 'c', 0, 0)];
    const { table } = computeStandings(football, league(['a', 'b', 'c'], 1), played, rem({ a: 0, b: 1, c: 1 }));
    expect(table.find((r) => r.team_id === 'a')!.status).toBe('clinched');
    expect(table.find((r) => r.team_id === 'c')!.status).toBe('eliminated');
  });

  it('uses fair play and scored as later tie-breakers', () => {
    const lg = { ...league(['x', 'y']), tie_break_order: ['fair_play'] };
    const { table } = computeStandings(football, lg, [g('x', 'y', 1, 1, { homeFairPlay: -3 })], rem({}));
    expect(table.map((r) => r.team_id)).toEqual(['y', 'x']);
    expect(table[0].resolved_by).toBe('fair_play');
  });

  it('computes net run rate for innings sports (all-out counts full overs)', () => {
    const lg = { ...league(['p', 'q']), sport_id: 'cricket' };
    const played = [g('p', 'q', 120, 100, { homeBalls: 120, awayBalls: 60, homeWickets: 3, awayWickets: 10 })];
    const { table } = computeStandings(cricket, lg, played, rem({}));
    // p: 120/20 − 100/20 = 1.0 ; q all out → 20 overs: 100/20 − 120/20 = −1.0
    expect(table.map((r) => [r.team_id, r.diff])).toEqual([['p', 1], ['q', -1]]);
  });
});
