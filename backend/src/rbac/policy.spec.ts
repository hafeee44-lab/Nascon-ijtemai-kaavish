import jwt from 'jsonwebtoken';
import { DEMO_USERS } from '../db/seed.js';
import { AuthService } from './auth.service.js';
import { Action, can, Principal } from './policy.js';
import { RateLimiter } from './rate-limiter.js';

const P = Object.fromEntries(DEMO_USERS.map((u) => [u.role, { sub: u.user_id, ...u } as unknown as Principal]));
const roles = ['super_admin', 'league_organizer', 'club_manager', 'player', 'viewer'];
const alpha = 'tenant-alpha';
const beta = 'tenant-beta';

// Spec 5.13 expected matrix: A = allowed, D = denied (role order as above).
const cases: [Action, object, string][] = [
  ['tenants.create', {}, 'ADDDD'],
  ['league.fixtures.write', { tenant_id: alpha, league_id: 'league-alpha-1' }, 'AADDD'],
  ['league.fixtures.write', { tenant_id: alpha, league_id: 'league-alpha-2' }, 'ADDDD'],
  ['league.fixtures.write', { tenant_id: beta, league_id: 'league-beta-1' }, 'ADDDD'],
  ['club.roster.write', { tenant_id: alpha, club_id: 'club-alpha-1' }, 'ADADD'],
  ['club.products.write', { tenant_id: alpha, club_id: 'club-alpha-2' }, 'ADDDD'],
  ['club.roster.write', { tenant_id: beta, club_id: 'club-beta-1' }, 'ADDDD'],
  ['player.update', { tenant_id: alpha, club_id: 'club-alpha-1', player_id: 'player-alpha-1' }, 'ADAAD'],
  ['player.update', { tenant_id: alpha, club_id: 'club-alpha-2', player_id: 'player-alpha-2' }, 'ADDDD'],
  ['player.update', { tenant_id: beta, club_id: 'club-beta-1', player_id: 'player-beta-1' }, 'ADDDD'],
  ['club.read', { tenant_id: alpha, club_id: 'club-alpha-2' }, 'AAAAA'],
  ['club.read', { tenant_id: beta, club_id: 'club-beta-1' }, 'ADDDD'],
  ['platform.config.read', {}, 'ADDDD'],
];

describe('RBAC policy matrix (negative authorization tests for every role boundary)', () => {
  for (const [action, target, expected] of cases)
    roles.forEach((role, i) =>
      it(`${role} ${expected[i] === 'A' ? 'may' : 'may NOT'} ${action} ${JSON.stringify(target)}`, () => {
        expect(can(P[role], action, target)).toBe(expected[i] === 'A');
      }));
});

describe('JWT verification', () => {
  const auth = new AuthService({} as any);
  it('accepts its own tokens and rejects missing, tampered, alg:none and expired ones', () => {
    const tokens = auth.tokensForAllRoles();
    expect(auth.verify(`Bearer ${tokens.viewer}`).role).toBe('viewer');
    expect(() => auth.verify(undefined)).toThrow();
    expect(() => auth.verify(`Bearer ${tokens.super_admin.slice(0, -3)}abc`)).toThrow();
    const [, body] = tokens.super_admin.split('.');
    expect(() => auth.verify(`Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${body}.`)).toThrow();
    const expired = jwt.sign({ role: 'super_admin', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_SECRET || 'nascon-dev-jwt-secret-change-me');
    expect(() => auth.verify(`Bearer ${expired}`)).toThrow();
  });
});

describe('rate limiter', () => {
  it('allows 100 per rolling 10 s, then reports a retry delay, then recovers', () => {
    let t = 0;
    const rl = new RateLimiter(100, 10_000, () => t);
    for (let i = 0; i < 100; i++) expect(rl.hit('ip')).toBe(0);
    expect(rl.hit('ip')).toBeGreaterThan(0);
    t = 11_000;
    expect(rl.hit('ip')).toBe(0);
  });
});
