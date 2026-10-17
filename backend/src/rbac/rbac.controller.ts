import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiError, notFound } from '../common/api-error.js';
import { Db } from '../db/db.service.js';
import { AuthService } from './auth.service.js';
import { Action, can, Target } from './policy.js';
import { RateLimiter } from './rate-limiter.js';

const forbidden = () => new ApiError(403, 'FORBIDDEN', 'You are not allowed to perform this action.', {});

@Controller()
export class RbacController {
  private readonly limiter = new RateLimiter(100, 10_000);

  constructor(private readonly db: Db, private readonly auth: AuthService) {}

  @Post('audit/v1/rbac-matrix')
  @HttpCode(200)
  matrix() {
    return {
      tokens: this.auth.tokensForAllRoles(),
      context: {
        tenant_id: 'tenant-alpha', foreign_tenant_id: 'tenant-beta',
        own_league_id: 'league-alpha-1', other_league_id: 'league-alpha-2', foreign_league_id: 'league-beta-1',
        own_club_id: 'club-alpha-1', other_club_id: 'club-alpha-2', foreign_club_id: 'club-beta-1',
        own_player_id: 'player-alpha-1', other_player_id: 'player-alpha-2', foreign_player_id: 'player-beta-1',
      },
    };
  }

  // Authorization runs first: 401 (token) → 404 (unknown id) → 403 (policy).
  private async probe(authz: string | undefined, action: Action, target: () => Promise<Target>) {
    const principal = this.auth.verify(authz);
    if (!can(principal, action, await target())) throw forbidden();
    return { authorized: true };
  }

  private async league(id: string): Promise<Target> {
    const l = await this.db.get('scenario_league', id);
    if (!l) throw notFound('LEAGUE_NOT_FOUND', `League ${id} does not exist.`, { league_id: id });
    return { tenant_id: l.tenant_id, league_id: id };
  }

  private async club(id: string): Promise<Target> {
    const c = await this.db.get('club', id);
    if (!c) throw notFound('CLUB_NOT_FOUND', `Club ${id} does not exist.`, { club_id: id });
    return { tenant_id: c.tenant_id, club_id: id };
  }

  private async player(id: string): Promise<Target> {
    const p = await this.db.get('scenario_player', id);
    if (!p) throw notFound('PLAYER_NOT_FOUND', `Player ${id} does not exist.`, { player_id: id });
    return { tenant_id: p.tenant_id, club_id: p.club_id, player_id: id };
  }

  @Post('audit/v1/rbac/tenants')
  @HttpCode(200)
  p1(@Headers('authorization') a: string) {
    return this.probe(a, 'tenants.create', async () => ({}));
  }

  @Post('audit/v1/rbac/leagues/:id/fixtures')
  @HttpCode(200)
  p2(@Headers('authorization') a: string, @Param('id') id: string) {
    return this.probe(a, 'league.fixtures.write', () => this.league(id));
  }

  @Post('audit/v1/rbac/clubs/:id/roster')
  @HttpCode(200)
  p3(@Headers('authorization') a: string, @Param('id') id: string) {
    return this.probe(a, 'club.roster.write', () => this.club(id));
  }

  @Post('audit/v1/rbac/clubs/:id/products')
  @HttpCode(200)
  p4(@Headers('authorization') a: string, @Param('id') id: string) {
    return this.probe(a, 'club.products.write', () => this.club(id));
  }

  @Patch('audit/v1/rbac/players/:id')
  @HttpCode(200)
  p5(@Headers('authorization') a: string, @Param('id') id: string) {
    return this.probe(a, 'player.update', () => this.player(id));
  }

  @Get('audit/v1/rbac/clubs/:id')
  p6(@Headers('authorization') a: string, @Param('id') id: string) {
    return this.probe(a, 'club.read', () => this.club(id));
  }

  @Get('audit/v1/rbac/platform/config')
  p7(@Headers('authorization') a: string) {
    return this.probe(a, 'platform.config.read', async () => ({}));
  }

  // NFR-5 rate-limit probe: 100 requests per rolling 10 s per client IP.
  @Get('api/v1/ping')
  ping(@Req() req: Request, @Res() res: Response) {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const wait = this.limiter.hit(ip);
    if (wait > 0) {
      res.setHeader('Retry-After', String(Math.ceil(wait / 1000)));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again shortly.', details: {} } });
    }
    return res.status(200).json({ pong: true });
  }

  @Post('api/v1/auth/login')
  @HttpCode(200)
  login(@Body() b: any) {
    return this.auth.login(b?.email, b?.password);
  }
}
