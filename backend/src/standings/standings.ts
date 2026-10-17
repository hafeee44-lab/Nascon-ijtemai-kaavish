import { lotsKey } from '../common/canonical.js';
import { effectiveTieBreaks, SportConfig } from '../sports/sport-config.js';

export interface League {
  league_id: string;
  sport_id: string;
  teams: string[];
  fixtures: { match_id: string; home: string; away: string }[];
  points: { win: number; draw: number; loss: number };
  tie_break_order: string[] | null;
  qualification: { spots: number };
  lots_seed: number;
}

// One played (completed, decided-or-drawn) fixture, reduced to what standings need.
export interface PlayedMatch {
  home: string;
  away: string;
  homeScore: number;
  awayScore: number;
  winner: string | null; // null = draw
  homeFairPlay: number;
  awayFairPlay: number;
  homeBalls: number | null;
  awayBalls: number | null;
  homeWickets: number | null;
  awayWickets: number | null;
}

interface Agg {
  played: number; won: number; drawn: number; lost: number; scored: number; conceded: number;
  points: number; fair_play: number;
  runsFor: number; runsAgainst: number; oversFaced: number; oversBowled: number;
}

const round3 = (x: number) => Math.round((x + Number.EPSILON) * 1000) / 1000;

function oversOf(sport: SportConfig, balls: number | null, wickets: number | null): number {
  const p = sport.periods;
  if (wickets !== null && wickets >= p.wickets_per_innings * p.innings_per_team) return p.overs_per_innings * p.innings_per_team;
  return (balls ?? 0) / p.balls_per_over;
}

function aggregate(sport: SportConfig, league: League, teams: string[], matches: PlayedMatch[]): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const t of teams)
    m.set(t, { played: 0, won: 0, drawn: 0, lost: 0, scored: 0, conceded: 0, points: 0, fair_play: 0, runsFor: 0, runsAgainst: 0, oversFaced: 0, oversBowled: 0 });
  const pts = league.points;
  for (const g of matches) {
    const sides: [string, number, number, number, number | null, number | null, number | null, number | null][] = [
      [g.home, g.homeScore, g.awayScore, g.homeFairPlay, g.homeBalls, g.homeWickets, g.awayBalls, g.awayWickets],
      [g.away, g.awayScore, g.homeScore, g.awayFairPlay, g.awayBalls, g.awayWickets, g.homeBalls, g.homeWickets],
    ];
    for (const [team, sc, con, fp, balls, wk, oBalls, oWk] of sides) {
      const a = m.get(team);
      if (!a) continue;
      a.played++;
      a.scored += sc;
      a.conceded += con;
      a.fair_play += fp;
      if (g.winner === null) { a.drawn++; a.points += pts.draw; }
      else if (g.winner === team) { a.won++; a.points += pts.win; }
      else { a.lost++; a.points += pts.loss; }
      if (sport.scoring_model === 'innings') {
        a.runsFor += sc;
        a.runsAgainst += con;
        a.oversFaced += oversOf(sport, balls, wk);
        a.oversBowled += oversOf(sport, oBalls, oWk);
      }
    }
  }
  return m;
}

function diffOf(sport: SportConfig, a: Agg): number {
  if (sport.scoring_model !== 'innings') return a.scored - a.conceded;
  const rf = a.oversFaced > 0 ? a.runsFor / a.oversFaced : 0;
  const ra = a.oversBowled > 0 ? a.runsAgainst / a.oversBowled : 0;
  return round3(rf - ra);
}

export function computeStandings(sport: SportConfig, league: League, matches: PlayedMatch[], remaining: Map<string, number>) {
  const all = aggregate(sport, league, league.teams, matches);
  const order = effectiveTieBreaks(league.tie_break_order ?? sport.tie_break_order);
  const resolvedBy = new Map<string, string | null>();

  const criterion = (c: string, group: string[]): Map<string, number | string> => {
    const vals = new Map<string, number | string>();
    if (c === 'h2h_points' || c === 'h2h_diff') {
      const set = new Set(group);
      const sub = aggregate(sport, league, group, matches.filter((g) => set.has(g.home) && set.has(g.away)));
      for (const t of group) vals.set(t, c === 'h2h_points' ? sub.get(t)!.points : diffOf(sport, sub.get(t)!));
    } else if (c === 'overall_diff') for (const t of group) vals.set(t, diffOf(sport, all.get(t)!));
    else if (c === 'scored') for (const t of group) vals.set(t, all.get(t)!.scored);
    else if (c === 'fair_play') for (const t of group) vals.set(t, all.get(t)!.fair_play);
    else for (const t of group) vals.set(t, lotsKey(league.lots_seed, league.league_id, t));
    return vals;
  };

  // Spec 5.10: split on the first criterion that differs; every tied sub-group restarts from the first criterion.
  const resolve = (group: string[]): string[] => {
    if (group.length < 2) return group;
    for (const c of order) {
      const vals = criterion(c, group);
      const distinct = [...new Set(vals.values())];
      if (distinct.length === 1) continue;
      // higher is better, except draw_lots where the smaller hash is best
      distinct.sort((x, y) => (c === 'draw_lots' ? (x < y ? -1 : 1) : (y as number) - (x as number)));
      const out: string[] = [];
      distinct.forEach((v, i) => {
        const sub = resolve(group.filter((t) => vals.get(t) === v));
        if (i > 0) resolvedBy.set(out[out.length - 1], c);
        out.push(...sub);
      });
      return out;
    }
    return group;
  };

  const byPoints = [...league.teams].sort((a, b) => all.get(b)!.points - all.get(a)!.points);
  const ordered: string[] = [];
  for (let i = 0; i < byPoints.length; ) {
    let j = i;
    while (j < byPoints.length && all.get(byPoints[j])!.points === all.get(byPoints[i])!.points) j++;
    ordered.push(...resolve(byPoints.slice(i, j)));
    i = j;
  }

  const W = league.points.win;
  const k = league.qualification.spots;
  const maxOf = (t: string) => all.get(t)!.points + W * (remaining.get(t) ?? 0);
  const status = (t: string) => {
    const others = league.teams.filter((x) => x !== t);
    const pts = all.get(t)!.points;
    if (others.filter((x) => maxOf(x) >= pts).length < k) return 'clinched';
    if (others.filter((x) => all.get(x)!.points > maxOf(t)).length >= k) return 'eliminated';
    return 'still_possible';
  };

  const table = ordered.map((t, i) => {
    const a = all.get(t)!;
    return {
      rank: i + 1, team_id: t, played: a.played, won: a.won, drawn: a.drawn, lost: a.lost,
      scored: a.scored, conceded: a.conceded, diff: diffOf(sport, a), points: a.points, fair_play: a.fair_play,
      status: status(t), resolved_by: resolvedBy.get(t) ?? null,
    };
  });

  const h2h: Record<string, Record<string, { played: number; points: number; scored: number; conceded: number }>> = {};
  for (const a of league.teams) {
    h2h[a] = {};
    for (const b of league.teams) {
      if (a === b) continue;
      const sub = aggregate(sport, league, [a], matches.filter((g) => (g.home === a && g.away === b) || (g.home === b && g.away === a)));
      const s = sub.get(a)!;
      h2h[a][b] = { played: s.played, points: s.points, scored: s.scored, conceded: s.conceded };
    }
  }
  return { table, h2h };
}
