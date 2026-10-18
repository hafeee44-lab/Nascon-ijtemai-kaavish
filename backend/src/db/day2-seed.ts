import { sign } from '../common/canonical.js';
import { Db, Tx } from './db.service.js';

export const BASE = () => (process.env.PUBLIC_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');

// Part II §5.2 baseline: match-m1 live at 1–0, fixed QR short codes, the anonymous guest token
// and an empty member cart. Runs inside the same reset transaction as the Day 1 seed.
export async function seedDay2(db: Db, c: Tx) {
  const match = {
    match_id: 'match-m1', sport_id: 'football', league_id: 'league-alpha-1',
    home_team_id: 'club-alpha-1', away_team_id: 'club-alpha-2',
    kickoff: new Date().toISOString().slice(0, 10) + 'T09:00:00Z', venue: 'Lions Arena', pinned_product_id: 'prod-jersey-001',
  };
  await db.put('match', match.match_id, match, c);
  const league = await db.get('league', 'league-alpha-1', c);
  if (league && !league.fixtures.some((f: any) => f.match_id === match.match_id)) {
    league.fixtures.push({ match_id: match.match_id, home: match.home_team_id, away: match.away_team_id });
    await db.put('league', 'league-alpha-1', league, c);
  }
  const events: [string, string, Record<string, unknown>][] = [
    ['match-m1-e1', 'match_start', {}],
    ['match-m1-e2', 'score', { team_id: 'club-alpha-1', event_type: 'goal' }],
  ];
  let seq = 0;
  for (const [event_id, type, payload] of events) {
    seq++;
    await c.query(
      'INSERT INTO match_events(match_id, seq, event_id, type, payload, signature, request) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [match.match_id, seq, event_id, type, JSON.stringify(payload), sign(event_id, payload), JSON.stringify({ event_id, match_id: match.match_id, type, payload })],
    );
  }

  for (const [entity_id, code] of [['match-m1', 'm1-live'], ['player-alpha-1', 'p-alpha-1'], ['club-alpha-1', 'c-alpha-1']]) {
    await db.put('qr', entity_id, { entity_id, short_code: code, scan_count: 0 }, c);
    await db.put('qr_code', code, { short_code: code, entity_id }, c);
  }

  await db.put('guest_token', 'guest_anon_tok_7721', { guest_token: 'guest_anon_tok_7721', status: 'valid', role: 'guest', merged: null, linked_user_id: null }, c);
  await db.put('cart', 'player-alpha-1', { user_id: 'player-alpha-1', items: [] }, c);
  await db.put('scenario_player', 'player-alpha-1', { player_id: 'player-alpha-1', club_id: 'club-alpha-1', tenant_id: 'tenant-alpha', name: 'Ali Khan' }, c);
}
