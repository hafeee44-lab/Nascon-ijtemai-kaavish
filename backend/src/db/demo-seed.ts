import { sign } from '../common/canonical.js';
import { Db, Tx } from './db.service.js';

// Demo content for the mobile desk check (spec 8): a real league owned by the demo organizer
// (league-alpha-1) and a roster scenario for the demo manager's club. All ids are demo-prefixed or
// the seeded scenario ids, so they never collide with grader-chosen ids.
const CLUBS = [
  { club_id: 'club-alpha-1', name: 'Alpha Lions', venue: { name: 'Lions Arena', lat: 33.6844, lng: 73.0479 }, social: { x: '@alphalions', instagram: '@alphalions' } },
  { club_id: 'club-alpha-2', name: 'Alpha Falcons', venue: { name: 'Falcon Park', lat: 33.6518, lng: 73.0812 }, social: { x: '@alphafalcons', instagram: '@alphafalcons' } },
  { club_id: 'club-alpha-3', name: 'Alpha Tigers', venue: { name: 'Tiger Ground', lat: 33.7104, lng: 73.0551 }, social: { x: '@alphatigers', instagram: '@alphatigers' } },
  { club_id: 'club-alpha-4', name: 'Alpha Wolves', venue: { name: 'Wolf Stadium', lat: 33.6402, lng: 72.9898 }, social: { x: '@alphawolves', instagram: '@alphawolves' } },
];

const FIXTURES: [string, string, string, string][] = [
  ['demo-m1', 'club-alpha-1', 'club-alpha-2', '2026-10-10T14:00:00Z'],
  ['demo-m2', 'club-alpha-3', 'club-alpha-4', '2026-10-10T17:00:00Z'],
  ['demo-m3', 'club-alpha-1', 'club-alpha-3', '2026-10-17T14:00:00Z'],
  ['demo-m4', 'club-alpha-2', 'club-alpha-4', '2026-10-17T17:00:00Z'],
  ['demo-m5', 'club-alpha-4', 'club-alpha-1', '2026-10-24T14:00:00Z'],
  ['demo-m6', 'club-alpha-2', 'club-alpha-3', '2026-10-24T17:00:00Z'],
];

const POSITIONS = ['gk', 'df', 'df', 'df', 'mf', 'mf', 'fw'];
const NAMES = ['Ali', 'Bilal', 'Hamza', 'Usman', 'Saad', 'Zain', 'Omar', 'Faris', 'Talha', 'Haris', 'Danish', 'Rayan', 'Ahmed', 'Yusuf'];

export async function seedDemo(db: Db, c: Tx) {
  for (const club of CLUBS) {
    const existing = (await db.get('club', club.club_id, c)) ?? {};
    await db.put('club', club.club_id, {
      ...existing, ...club, tenant_id: 'tenant-alpha',
      staff: [{ role: 'coach', name: 'Coach ' + club.name.split(' ')[1] }, { role: 'manager', name: 'Manager ' + club.name.split(' ')[1] }, { role: 'physio', name: 'Dr. Khan' }],
      history: [{ season: '2025', position: 1 + CLUBS.indexOf(club), points: 40 - 5 * CLUBS.indexOf(club) }],
    }, c);
  }

  await db.put('league', 'league-alpha-1', {
    league_id: 'league-alpha-1', name: 'Alpha Premier League', season: '2026', tenant_id: 'tenant-alpha', sport_id: 'football',
    teams: CLUBS.map((x) => x.club_id), fixtures: FIXTURES.map(([match_id, home, away]) => ({ match_id, home, away })),
    points: { win: 3, draw: 1, loss: 0 }, tie_break_order: null, qualification: { spots: 2 }, lots_seed: 42,
  }, c);
  for (const [match_id, home, away, kickoff] of FIXTURES)
    await db.put('match', match_id, {
      match_id, sport_id: 'football', league_id: 'league-alpha-1', home_team_id: home, away_team_id: away,
      kickoff, venue: CLUBS.find((x) => x.club_id === home)!.venue.name, pinned_product_id: 'prod-jersey-001',
    }, c);

  const logs: Record<string, [string, Record<string, unknown>][]> = {
    'demo-m1': [['match_start', {}], ['score', { team_id: 'club-alpha-1', event_type: 'goal' }], ['score', { team_id: 'club-alpha-2', event_type: 'goal' }],
      ['score', { team_id: 'club-alpha-1', event_type: 'goal' }], ['match_end', {}]],
    'demo-m2': [['match_start', {}], ['score', { team_id: 'club-alpha-4', event_type: 'goal' }], ['discipline', { team_id: 'club-alpha-3', points: -1 }], ['match_end', {}]],
    'demo-m3': [['match_start', {}], ['score', { team_id: 'club-alpha-3', event_type: 'goal' }]],
  };
  for (const [matchId, events] of Object.entries(logs)) {
    let seq = 0;
    for (const [type, payload] of events) {
      seq++;
      const event_id = `${matchId}-e${seq}`;
      const request = { event_id, match_id: matchId, type, payload };
      await c.query(
        'INSERT INTO match_events(match_id, seq, event_id, type, payload, signature, request) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [matchId, seq, event_id, type, JSON.stringify(payload), sign(event_id, payload), JSON.stringify(request)],
      );
    }
  }

  const players: Record<string, any> = {};
  CLUBS.slice(0, 2).forEach((club, ci) => {
    for (let i = 0; i < 7; i++) {
      const player_id = `demo-p${ci * 7 + i + 1}`;
      players[player_id] = {
        player_id, name: NAMES[ci * 7 + i], position: POSITIONS[i],
        reg: { player_id, league_id: 'demo-roster', squad_id: club.club_id, parent_squad_id: null, registration_type: 'initial', start_date: null, loan_end_date: null,
          role: i === 0 ? 'captain' : i === 1 ? 'vice_captain' : i < 5 ? 'starter' : 'substitute' },
      };
    }
  });
  await db.put('roster_league', 'demo-roster', {
    league: { league_id: 'demo-roster', tenant_id: 'tenant-alpha', sport_id: 'football', transfer_window: { open: '2026-01-01', close: '2026-12-31' }, max_squad_size: 25, required_positions: { gk: 1 } },
    squads: Object.fromEntries(CLUBS.map((x) => [x.club_id, { squad_id: x.club_id, club_id: x.club_id, tenant_id: 'tenant-alpha', name: x.name }])),
    players, matches_in_progress: [],
  }, c);
  for (const pid of Object.keys(players)) await db.put('roster_player', pid, { player_id: pid, league_id: 'demo-roster' }, c);
}
