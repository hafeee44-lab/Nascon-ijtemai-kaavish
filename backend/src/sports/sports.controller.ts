import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { conflict } from '../common/api-error.js';
import { Db } from '../db/db.service.js';
import { parseSport } from './sport-config.js';

@Controller('audit/v1')
export class SportsController {
  constructor(private readonly db: Db) {}

  // FR-1.1 / spec 5.6: a "mystery sport" is pure data, usable immediately everywhere.
  @Post('sports')
  @HttpCode(201)
  async create(@Body() body: any) {
    const config = parseSport(body);
    const r = await this.db.query(
      `INSERT INTO docs(kind,id,data) VALUES('sport',$1,$2) ON CONFLICT DO NOTHING RETURNING id`,
      [config.sport_id, JSON.stringify(config)],
    );
    if (!r.rowCount) throw conflict('SPORT_EXISTS', `Sport ${config.sport_id} already exists.`, { sport_id: config.sport_id });
    return { sport_id: config.sport_id, status: 'created', config };
  }
}
