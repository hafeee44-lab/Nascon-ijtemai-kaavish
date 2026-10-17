import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { EventsService } from './events.service.js';

@Controller('audit/v1')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post('events')
  async append(@Body() body: any, @Res() res: Response) {
    const r = await this.events.append(body);
    res.status(r.status).json(r.body);
  }

  @Get('score/:matchId')
  score(@Param('matchId') matchId: string) {
    return this.events.score(matchId);
  }
}
