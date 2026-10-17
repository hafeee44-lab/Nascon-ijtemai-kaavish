import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RosterService } from './roster.service.js';

@Controller('audit/v1/roster')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Post('setup')
  @HttpCode(201)
  setup(@Body() body: any) {
    return this.roster.setup(body);
  }

  @Post('transfer')
  async transfer(@Body() body: any, @Res() res: Response) {
    const r = await this.roster.transfer(body);
    res.status(r.status).json(r.body);
  }

  @Get('history/:playerId')
  history(@Param('playerId') playerId: string, @Query('as_of') asOf?: string) {
    return this.roster.history(playerId, asOf);
  }
}
