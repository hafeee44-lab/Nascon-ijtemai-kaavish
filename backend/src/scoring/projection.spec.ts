import { BASE_SPORTS } from '../db/seed.js';
import { parseSport, effectiveTieBreaks } from '../sports/sport-config.js';
import type { SportConfig } from '../sports/sport-config.js';
import { project, scoringLimit, StoredEvent } from './projection.js';

const sport = (id: string) => BASE_SPORTS.find((s) => s.sport_id === id) as unknown as SportConfig;
const match = (sport_id: string) => ({ match_id: 'm1', sport_id, league_id: null, home_team_id: 'h', away_team_id: 'a' });
let n = 0;
const ev = (type: string, payload: Record<string, any> = {}): StoredEvent => ({ seq: ++n, event_id: `e${n}`, type, payload, signature: 'x' });

describe('event-sourced projection', () => {
  beforeEach(() => { n = 0; });

  it('scores event-model sports from config and treats compensations as neutral', () => {
    const events = [ev('match_init'), ev('match_start'), ev('score', { team_id: 'h', event_type: 'three_pointer' }),
      ev('score', { team_id: 'a', event_type: 'two_pointer' }), ev('discipline', { team_id: 'a', points: -2 }), ev('match_end')];
    let p = project(sport('basketball'), match('basketball'), events);
    expect([p.status, p.outcome, p.home.score, p.away.score, p.away.fair_play, p.winner_team_id]).toEqual(['completed', 'home_win', 3, 2, -2, 'h']);
    events.push(ev('compensation', { compensates: 'e3', reason: 'review' }));
    p = project(sport('basketball'), match('basketball'), events);
    expect([p.home.score, p.outcome, p.compensatedBy.get('e3')]).toEqual([0, 'away_win', 'e7']);
  });

  it('handles innings model: runs, wickets, legal balls, overs string and limits', () => {
    const cfg = parseSport({ sport_id: 'mini', name: 'Mini', scoring_model: 'innings', draw_allowed: true, overtime: { policy: 'none' },
      periods: { innings_per_team: 1, overs_per_innings: 1, balls_per_over: 6, wickets_per_innings: 2 },
      scoring_events: { run: { runs: 1, legal_ball: true, wicket: false }, wide: { runs: 1, legal_ball: false, wicket: false }, out: { runs: 0, legal_ball: true, wicket: true } },
      roster: { min_squad_size: 1, max_squad_size: 5, required_positions: {} } });
    const events = [ev('match_start'), ev('score', { team_id: 'h', event_type: 'run' }), ev('score', { team_id: 'h', event_type: 'wide' }),
      ev('score', { team_id: 'h', event_type: 'out' })];
    let p = project(cfg, match('mini'), events);
    expect([p.home.score, p.home.wickets, p.home.balls, p.home.overs]).toEqual([2, 1, 2, '0.2']);
    expect(scoringLimit(cfg, p, 'h')).toBeNull();
    events.push(ev('score', { team_id: 'h', event_type: 'out' }));
    p = project(cfg, match('mini'), events);
    expect(scoringLimit(cfg, p, 'h')).toBe('INNINGS_COMPLETE');
  });

  it('round model: series decided, tie-break winner and undecided outcome', () => {
    const esports = sport('esports');
    let p = project(esports, match('esports'), [ev('match_start'), ev('score', { team_id: 'a', event_type: 'round_win' }), ev('score', { team_id: 'a', event_type: 'round_win' })]);
    expect(scoringLimit(esports, p, 'h')).toBe('SERIES_ALREADY_DECIDED');
    n = 0;
    const tb = [ev('match_start'), ev('tiebreak_winner', { team_id: 'h' }), ev('match_end')];
    p = project(esports, match('esports'), tb);
    expect([p.outcome, p.winner_team_id, p.tiebreak_winner_team_id]).toEqual(['home_win', 'h', 'h']);
    tb.push(ev('compensation', { compensates: 'e2' }));
    p = project(esports, match('esports'), tb);
    expect(p.outcome).toBe('undecided');
    p = project(sport('football'), match('football'), [ev('match_start'), ev('match_end')]);
    expect(p.outcome).toBe('draw');
  });

  it('validates mystery sports and defaults tie-breaks', () => {
    expect(() => parseSport({ sport_id: 'X!', name: '', scoring_model: 'bad' })).toThrow();
    expect(() => parseSport({ sport_id: 'ok', name: 'Ok', scoring_model: 'round', periods: { best_of: 2 }, scoring_events: { w: { rounds: 1 } },
      draw_allowed: false, overtime: { policy: 'none' }, roster: { min_squad_size: 1, max_squad_size: 2, required_positions: {} } })).toThrow();
    const ok = parseSport({ sport_id: 'kabaddi', name: 'Kabaddi', scoring_model: 'event', periods: { count: 2, duration_minutes: 20 },
      scoring_events: { raid_point: { points: 1 } }, draw_allowed: false, overtime: { policy: 'golden_score', duration_minutes: 5 },
      tie_break_order: ['scored'], roster: { min_squad_size: 7, max_squad_size: 12, required_positions: { raider: 2 } } });
    expect(ok.tie_break_order).toEqual(['scored']);
    expect(effectiveTieBreaks(ok.tie_break_order)).toEqual(['scored', 'draw_lots']);
    expect(() => parseSport({ ...ok, tie_break_order: ['scored', 'scored'] })).toThrow();
  });
});
