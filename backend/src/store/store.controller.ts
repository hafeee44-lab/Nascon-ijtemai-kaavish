import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { StoreService } from './store.service.js';

@Controller('audit/v1')
export class StoreController {
  constructor(private readonly store: StoreService) {}

  @Post('checkout')
  async checkout(@Body() body: any, @Res() res: Response) {
    const r = await this.store.checkout(body);
    res.status(r.status).json(r.body);
  }

  @Get('inventory/:variantId')
  inventory(@Param('variantId') variantId: string) {
    return this.store.inventory(variantId);
  }
}
