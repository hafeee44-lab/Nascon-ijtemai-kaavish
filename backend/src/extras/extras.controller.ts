import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { CostreamService } from '../costream/costream.js';
import { ModerationService } from '../moderation_dlq/moderation.service.js';
import { AuthService } from '../rbac/auth.service.js';
import { ExtrasService } from './extras.service.js';

@Controller('api/v1')
export class ExtrasController {
  constructor(
    private readonly auth: AuthService, private readonly extras: ExtrasService,
    private readonly costream: CostreamService, private readonly mod: ModerationService,
  ) {}

  @Get('athletes/:id')
  athlete(@Param('id') id: string) {
    return this.extras.athlete(id);
  }

  @Post('variants/:id/price')
  @HttpCode(201)
  schedulePrice(@Headers('authorization') a: string, @Param('id') id: string, @Body() b: any) {
    return this.extras.schedulePrice(this.auth.verify(a), id, b);
  }

  @Get('variants/:id/price')
  prices(@Param('id') id: string) {
    return this.extras.prices(id);
  }

  @Get('inventory/:id/audit')
  audit(@Headers('authorization') a: string, @Param('id') id: string) {
    return this.extras.inventoryAudit(this.auth.verify(a), id);
  }

  @Get('orders')
  orders(@Headers('authorization') a: string) {
    return this.extras.orders(this.auth.verify(a));
  }

  @Post('costream/:id/invites')
  @HttpCode(201)
  invite(@Headers('authorization') a: string, @Param('id') id: string, @Body() b: any) {
    return this.costream.invite(this.auth.verify(a), id, b);
  }

  @Post('costream/:id/join')
  @HttpCode(200)
  join(@Headers('authorization') a: string, @Param('id') id: string, @Body() b: any) {
    this.auth.verify(a);
    return this.costream.join(id, b);
  }

  @Post('costream/:id/control')
  @HttpCode(200)
  control(@Headers('authorization') a: string, @Param('id') id: string, @Body() b: any) {
    return this.costream.control(this.auth.verify(a), id, b);
  }

  @Post('chat/:room/moderation')
  @HttpCode(200)
  moderate(@Headers('authorization') a: string, @Param('room') room: string, @Body() b: any) {
    return this.mod.act(this.auth.verify(a), room, b);
  }
}
