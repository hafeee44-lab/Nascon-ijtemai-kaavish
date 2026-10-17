import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { validationError } from '../common/api-error.js';
import { Db } from '../db/db.service.js';
import { resetAll } from '../db/seed.js';

const DEFAULT_STOCK = { 'var-jersey-001-M': 1, 'var-jersey-001-L': 5 };

@Controller()
export class CoreController {
  constructor(private readonly db: Db) {}

  // Spec 5.4: 200 only when the DB is reachable and baseline data is seeded.
  @Get('health')
  async health(@Res() res: Response) {
    try {
      const r = await this.db.query(`SELECT value FROM meta WHERE key='seeded'`);
      if (r.rows.length) return res.status(200).json({ status: 'ok' });
    } catch {
      /* not ready */
    }
    return res.status(503).json({ error: { code: 'NOT_READY', message: 'Starting up.', details: {} } });
  }

  // Spec 5.5: wipe everything and re-create the identical baseline.
  @Post('audit/v1/reset')
  @HttpCode(200)
  async reset(@Body() body: any) {
    body = body ?? {};
    const seed = body.seed ?? 42;
    if (!Number.isInteger(seed)) throw validationError(['seed']);
    const stock: Record<string, number> = { ...DEFAULT_STOCK };
    if (body.stock !== undefined) {
      if (typeof body.stock !== 'object' || body.stock === null || Array.isArray(body.stock)) throw validationError(['stock']);
      for (const [k, v] of Object.entries(body.stock)) {
        if (!Number.isInteger(v) || (v as number) < 0) throw validationError(['stock']);
        stock[k] = v as number;
      }
    }
    await resetAll(this.db, seed, stock);
    return {
      status: 'reset_complete',
      seed,
      sports: ['football', 'basketball', 'cricket', 'esports'],
      tenants: ['tenant-alpha', 'tenant-beta'],
      stock,
    };
  }
}
