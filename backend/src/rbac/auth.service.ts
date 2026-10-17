import { Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ApiError } from '../common/api-error.js';
import { Db } from '../db/db.service.js';
import { DEMO_USERS, hashPassword } from '../db/seed.js';
import type { Principal } from './policy.js';

const secret = () => process.env.JWT_SECRET || 'nascon-dev-jwt-secret-change-me';

export const unauthenticated = (msg = 'Missing or invalid token.') => new ApiError(401, 'UNAUTHENTICATED', msg, {});

@Injectable()
export class AuthService {
  constructor(private readonly db: Db) {}

  issue(u: { user_id: string; role: string; tenant_id: string | null; league_ids: string[]; club_id: string | null; player_id: string | null }) {
    return jwt.sign(
      { sub: u.user_id, role: u.role, tenant_id: u.tenant_id, league_ids: u.league_ids, club_id: u.club_id, player_id: u.player_id },
      secret(),
      { algorithm: 'HS256', expiresIn: '8h' },
    );
  }

  // Only HS256 with a valid signature and unexpired exp is accepted (rejects alg:none and tampering).
  verify(header: string | undefined): Principal {
    if (!header || !header.startsWith('Bearer ')) throw unauthenticated();
    try {
      return jwt.verify(header.slice(7).trim(), secret(), { algorithms: ['HS256'] }) as Principal;
    } catch {
      throw unauthenticated();
    }
  }

  tokensForAllRoles() {
    const byRole = Object.fromEntries(DEMO_USERS.map((u) => [u.role, this.issue(u)]));
    return {
      super_admin: byRole.super_admin, league_organizer: byRole.league_organizer, club_manager: byRole.club_manager,
      player: byRole.player, viewer: byRole.viewer,
    };
  }

  async login(email: unknown, password: unknown) {
    if (typeof email !== 'string' || typeof password !== 'string') throw unauthenticated('Email or password is incorrect.');
    const u = await this.db.get('user', email.trim().toLowerCase());
    const given = Buffer.from(hashPassword(password), 'hex');
    if (!u || !timingSafeEqual(given, Buffer.from(u.password_hash, 'hex'))) throw unauthenticated('Email or password is incorrect.');
    return {
      token: this.issue(u),
      user: { user_id: u.user_id, email: u.email, role: u.role, tenant_id: u.tenant_id, league_ids: u.league_ids, club_id: u.club_id, player_id: u.player_id },
    };
  }
}
