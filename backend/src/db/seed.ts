import { scryptSync } from 'node:crypto';
import { seedDay2 } from './day2-seed.js';
import { seedDemo } from './demo-seed.js';
import { Db, Tx } from './db.service.js';

const FULL_TIE_BREAK = ['h2h_points', 'h2h_diff', 'overall_diff', 'scored', 'fair_play', 'draw_lots'];

// Baseline sports (spec 5.5), stored as ordinary data in the same shape as POST /audit/v1/sports.
export const BASE_SPORTS = [
  {
    sport_id: 'football', name: 'Football', scoring_model: 'event',
    periods: { count: 2, duration_minutes: 45 },
    scoring_events: { goal: { points: 1 } },
    draw_allowed: true, overtime: { policy: 'none' }, tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 11, max_squad_size: 25, required_positions: { gk: 1 } },
  },
  {
    sport_id: 'basketball', name: 'Basketball', scoring_model: 'event',
    periods: { count: 4, duration_minutes: 12 },
    scoring_events: { free_throw: { points: 1 }, two_pointer: { points: 2 }, three_pointer: { points: 3 } },
    draw_allowed: false, overtime: { policy: 'extra_time', duration_minutes: 5 }, tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 5, max_squad_size: 15, required_positions: {} },
  },
  {
    sport_id: 'cricket', name: 'Cricket', scoring_model: 'innings',
    periods: { innings_per_team: 1, overs_per_innings: 20, balls_per_over: 6, wickets_per_innings: 10 },
    scoring_events: {
      dot_ball: { runs: 0, legal_ball: true, wicket: false },
      single: { runs: 1, legal_ball: true, wicket: false },
      two: { runs: 2, legal_ball: true, wicket: false },
      four: { runs: 4, legal_ball: true, wicket: false },
      six: { runs: 6, legal_ball: true, wicket: false },
      wide: { runs: 1, legal_ball: false, wicket: false },
      no_ball: { runs: 1, legal_ball: false, wicket: false },
      wicket: { runs: 0, legal_ball: true, wicket: true },
    },
    draw_allowed: true, overtime: { policy: 'super_over' }, tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 11, max_squad_size: 18, required_positions: { wicketkeeper: 1 } },
  },
  {
    sport_id: 'esports', name: 'Esports', scoring_model: 'round',
    periods: { best_of: 3 },
    scoring_events: { round_win: { rounds: 1 } },
    draw_allowed: false, overtime: { policy: 'none' }, tie_break_order: FULL_TIE_BREAK,
    roster: { min_squad_size: 5, max_squad_size: 8, required_positions: {} },
  },
];

export const DEMO_PASSWORD = 'Nascon@26';

export function hashPassword(pw: string): string {
  return scryptSync(pw, 'nascon-demo-users', 32).toString('hex');
}

// Spec 8.3 demo accounts, bound to the RBAC scenario of 5.5/5.13.
export const DEMO_USERS = [
  { user_id: 'user-admin', email: 'admin@nascon.test', role: 'super_admin', tenant_id: null, league_ids: [], club_id: null, player_id: null },
  { user_id: 'user-organizer', email: 'organizer@nascon.test', role: 'league_organizer', tenant_id: 'tenant-alpha', league_ids: ['league-alpha-1'], club_id: null, player_id: null },
  { user_id: 'user-manager', email: 'manager@nascon.test', role: 'club_manager', tenant_id: 'tenant-alpha', league_ids: [], club_id: 'club-alpha-1', player_id: null },
  { user_id: 'user-player', email: 'player@nascon.test', role: 'player', tenant_id: 'tenant-alpha', league_ids: [], club_id: 'club-alpha-1', player_id: 'player-alpha-1' },
  { user_id: 'user-viewer', email: 'viewer@nascon.test', role: 'viewer', tenant_id: 'tenant-alpha', league_ids: [], club_id: null, player_id: null },
];

export async function resetAll(db: Db, seed: number, stock: Record<string, number>) {
  await db.tx(async (c: Tx) => {
    await c.query('TRUNCATE docs, match_events, inventory, roster_audit, meta, qr_telemetry, dlq, chat_messages, follows, inventory_audit, variant_prices RESTART IDENTITY');
    for (const s of BASE_SPORTS) await db.put('sport', s.sport_id, s, c);
    await db.put('tenant', 'tenant-alpha', { tenant_id: 'tenant-alpha', name: 'Alpha Sports', logo_url: null, colors: { primary: '#1d4ed8', secondary: '#f59e0b' } }, c);
    await db.put('tenant', 'tenant-beta', { tenant_id: 'tenant-beta', name: 'Beta Athletics', logo_url: null, colors: { primary: '#047857', secondary: '#e11d48' } }, c);

    for (const [id, tenant] of [['league-alpha-1', 'tenant-alpha'], ['league-alpha-2', 'tenant-alpha'], ['league-beta-1', 'tenant-beta']])
      await db.put('scenario_league', id, { league_id: id, tenant_id: tenant, sport_id: 'football' }, c);
    for (const [id, tenant] of [['club-alpha-1', 'tenant-alpha'], ['club-alpha-2', 'tenant-alpha'], ['club-beta-1', 'tenant-beta']])
      await db.put('club', id, { club_id: id, tenant_id: tenant, name: id }, c);
    for (const [id, club, tenant] of [['player-alpha-1', 'club-alpha-1', 'tenant-alpha'], ['player-alpha-2', 'club-alpha-2', 'tenant-alpha'], ['player-beta-1', 'club-beta-1', 'tenant-beta'], ['player-beta-2', 'club-beta-1', 'tenant-beta']])
      await db.put('scenario_player', id, { player_id: id, club_id: club, tenant_id: tenant }, c);

    const pw = hashPassword(DEMO_PASSWORD);
    for (const u of DEMO_USERS) await db.put('user', u.email, { ...u, password_hash: pw }, c);

    await db.put('product', 'prod-jersey-001', {
      product_id: 'prod-jersey-001', tenant_id: 'tenant-alpha', club_id: 'club-alpha-1',
      name: 'Alpha Home Jersey', category: 'apparel',
      variants: [
        { variant_id: 'var-jersey-001-M', size: 'M', color: 'blue', price_minor: 450000, currency: 'PKR' },
        { variant_id: 'var-jersey-001-L', size: 'L', color: 'blue', price_minor: 450000, currency: 'PKR' },
      ],
    }, c);
    for (const [variant, qty] of Object.entries(stock)) {
      await db.put('variant', variant, { variant_id: variant, product_id: 'prod-jersey-001', price_minor: 450000, currency: 'PKR' }, c);
      await c.query('INSERT INTO inventory(variant_id, stock, reserved) VALUES ($1,$2,0)', [variant, qty]);
    }
    await db.put('discount', 'WELCOME10', { code: 'WELCOME10', percent: 10 }, c);

    await seedDemo(db, c);
    await seedDay2(db, c);
    await c.query(`INSERT INTO meta(key,value) VALUES ('seed',$1),('seeded','true')`, [JSON.stringify(seed)]);
  });
}

export async function lastSeed(db: Db): Promise<number> {
  const r = await db.query(`SELECT value FROM meta WHERE key='seed'`);
  return r.rows[0]?.value ?? 42;
}
