import type { SportConfig } from '../sports/sport-config.js';

export interface StoredEvent {
  seq: number;
  event_id: string;
  type: string;
  payload: Record<string, any>;
  signature: string;
}

export interface MatchInfo {
  match_id: string;
  sport_id: string;
  league_id: string | null;
  home_team_id: string;
  away_team_id: string;
}

export interface SideScore {
  team_id: string;
  score: number;
  wickets: number | null;
  balls: number | null;
  overs: string | null;
  fair_play: number;
}

export interface Projection {
  status: 'upcoming' | 'in_progress' | 'completed';
  outcome: 'pending' | 'home_win' | 'away_win' | 'draw' | 'undecided';
  winner_team_id: string | null;
  tiebreak_winner_team_id: string | null;
  home: SideScore;
  away: SideScore;
  version: number;
  compensatedBy: Map<string, string>;
}

// FR-1.1: the score is always rebuilt from the append-only log; compensated events and
// compensations are neutral. Everything sport-specific comes from the config.
export function project(sport: SportConfig, match: MatchInfo, events: StoredEvent[]): Projection {
  const compensatedBy = new Map<string, string>();
  for (const e of events) if (e.type === 'compensation') compensatedBy.set(e.payload.compensates, e.event_id);

  const innings = sport.scoring_model === 'innings';
  const side = (team_id: string): SideScore => ({
    team_id, score: 0, wickets: innings ? 0 : null, balls: innings ? 0 : null, overs: null, fair_play: 0,
  });
  const home = side(match.home_team_id);
  const away = side(match.away_team_id);
  let status: Projection['status'] = 'upcoming';
  let tiebreak: string | null = null;

  for (const e of events) {
    if (e.type === 'match_start') status = 'in_progress';
    else if (e.type === 'match_end') status = 'completed';
    if (compensatedBy.has(e.event_id) || e.type === 'compensation') continue;
    const s = e.payload?.team_id === home.team_id ? home : e.payload?.team_id === away.team_id ? away : null;
    if (e.type === 'score' && s) {
      const def = sport.scoring_events[e.payload.event_type];
      if (!def) continue;
      if (sport.scoring_model === 'event') s.score += def.points;
      else if (sport.scoring_model === 'round') s.score += def.rounds;
      else {
        s.score += def.runs;
        if (def.legal_ball) s.balls! += 1;
        if (def.wicket) s.wickets! += 1;
      }
    } else if (e.type === 'discipline' && s) s.fair_play += e.payload.points;
    else if (e.type === 'tiebreak_winner' && s) tiebreak = s.team_id;
  }
  if (innings) {
    const bpo = sport.periods.balls_per_over;
    for (const s of [home, away]) s.overs = `${Math.floor(s.balls! / bpo)}.${s.balls! % bpo}`;
  }

  let winner: string | null = null;
  if (home.score > away.score) winner = home.team_id;
  else if (away.score > home.score) winner = away.team_id;
  else if (tiebreak) winner = tiebreak;

  let outcome: Projection['outcome'] = 'pending';
  if (status === 'completed') {
    if (winner) outcome = winner === home.team_id ? 'home_win' : 'away_win';
    else outcome = sport.draw_allowed ? 'draw' : 'undecided';
  }
  return {
    status, outcome, winner_team_id: winner, tiebreak_winner_team_id: tiebreak, home, away,
    version: events.length, compensatedBy,
  };
}

// Config-driven limits: innings complete / series already decided (spec 5.9).
export function scoringLimit(sport: SportConfig, proj: Projection, teamId: string): string | null {
  const s = teamId === proj.home.team_id ? proj.home : proj.away;
  if (sport.scoring_model === 'innings') {
    const p = sport.periods;
    if (s.balls! >= p.innings_per_team * p.overs_per_innings * p.balls_per_over || s.wickets! >= p.innings_per_team * p.wickets_per_innings)
      return 'INNINGS_COMPLETE';
  }
  if (sport.scoring_model === 'round') {
    const need = (sport.periods.best_of + 1) / 2;
    if (proj.home.score >= need || proj.away.score >= need) return 'SERIES_ALREADY_DECIDED';
  }
  return null;
}
