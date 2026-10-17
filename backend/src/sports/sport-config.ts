import { validationError } from '../common/api-error.js';
import { isBool, isInt, isObj, isStr } from '../common/validate.js';

export const TIE_BREAKS = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];
const MODELS = ['event', 'innings', 'round'];
const OVERTIME = ['none', 'extra_time', 'shootout', 'golden_score', 'super_over'];

export interface SportConfig {
  sport_id: string;
  name: string;
  scoring_model: 'event' | 'innings' | 'round';
  periods: Record<string, number>;
  scoring_events: Record<string, Record<string, any>>;
  draw_allowed: boolean;
  overtime: { policy: string; duration_minutes?: number };
  tie_break_order: string[];
  roster: { min_squad_size: number; max_squad_size: number; required_positions: Record<string, number> };
}

// Spec 5.6: validates and normalises a sport definition. Throws 400 with every bad field.
export function parseSport(b: any): SportConfig {
  if (!isObj(b)) throw validationError(['body']);
  const bad: string[] = [];
  if (!isStr(b.sport_id) || !/^[a-z0-9_-]{2,40}$/.test(b.sport_id)) bad.push('sport_id');
  if (!isStr(b.name) || b.name.length < 1 || b.name.length > 80) bad.push('name');
  const model = b.scoring_model;
  if (!MODELS.includes(model)) bad.push('scoring_model');

  const p = b.periods;
  const pos = (v: unknown) => isInt(v) && v >= 1;
  if (!isObj(p)) bad.push('periods');
  else if (model === 'event' && !(pos(p.count) && pos(p.duration_minutes))) bad.push('periods');
  else if (model === 'innings' && !['innings_per_team', 'overs_per_innings', 'balls_per_over', 'wickets_per_innings'].every((k) => pos(p[k]))) bad.push('periods');
  else if (model === 'round' && !(pos(p.best_of) && p.best_of % 2 === 1)) bad.push('periods');

  const se = b.scoring_events;
  if (!isObj(se) || Object.keys(se).length === 0) bad.push('scoring_events');
  else {
    for (const [k, v] of Object.entries(se)) {
      const keyOk = /^[a-z0-9_]{1,40}$/.test(k);
      let valOk = isObj(v);
      if (valOk && model === 'event') valOk = isInt(v.points) && v.points >= 1;
      if (valOk && model === 'innings') valOk = isInt(v.runs) && v.runs >= 0 && isBool(v.legal_ball) && isBool(v.wicket);
      if (valOk && model === 'round') valOk = isInt(v.rounds) && v.rounds >= 1;
      if (!keyOk || !valOk) {
        bad.push('scoring_events');
        break;
      }
    }
  }
  if (!isBool(b.draw_allowed)) bad.push('draw_allowed');

  const ot = b.overtime;
  if (!isObj(ot) || !OVERTIME.includes(ot.policy) || (ot.duration_minutes !== undefined && !(isInt(ot.duration_minutes) && ot.duration_minutes >= 0)))
    bad.push('overtime');

  let tbo = TIE_BREAKS;
  if (b.tie_break_order !== undefined) {
    const t = b.tie_break_order;
    if (!Array.isArray(t) || !t.every((x) => TIE_BREAKS.includes(x)) || new Set(t).size !== t.length) bad.push('tie_break_order');
    else tbo = t;
  }

  const r = b.roster;
  if (
    !isObj(r) || !isInt(r.min_squad_size) || r.min_squad_size < 1 || !isInt(r.max_squad_size) || r.max_squad_size < 1 ||
    r.min_squad_size > r.max_squad_size || !isObj(r.required_positions) ||
    !Object.values(r.required_positions).every((n) => isInt(n) && n >= 0)
  )
    bad.push('roster');

  if (bad.length) throw validationError(bad);

  const periods: Record<string, number> =
    model === 'event' ? { count: p.count, duration_minutes: p.duration_minutes }
    : model === 'innings' ? { innings_per_team: p.innings_per_team, overs_per_innings: p.overs_per_innings, balls_per_over: p.balls_per_over, wickets_per_innings: p.wickets_per_innings }
    : { best_of: p.best_of };
  const scoring_events: Record<string, Record<string, any>> = {};
  for (const [k, v] of Object.entries<any>(se)) {
    scoring_events[k] =
      model === 'event' ? { points: v.points } : model === 'innings' ? { runs: v.runs, legal_ball: v.legal_ball, wicket: v.wicket } : { rounds: v.rounds };
  }
  return {
    sport_id: b.sport_id,
    name: b.name,
    scoring_model: model,
    periods,
    scoring_events,
    draw_allowed: b.draw_allowed,
    overtime: ot.duration_minutes === undefined ? { policy: ot.policy } : { policy: ot.policy, duration_minutes: ot.duration_minutes },
    tie_break_order: tbo,
    roster: { min_squad_size: r.min_squad_size, max_squad_size: r.max_squad_size, required_positions: { ...r.required_positions } },
  };
}

// draw_lots is always the final criterion, even when omitted.
export function effectiveTieBreaks(order: string[] | undefined): string[] {
  const base = (order ?? TIE_BREAKS).filter((x) => x !== 'draw_lots');
  return [...base, 'draw_lots'];
}
