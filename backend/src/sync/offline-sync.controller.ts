import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { OfflineSyncService } from './offline-sync.service.js';

@Controller('audit/v1')
export class OfflineSyncController {
  constructor(private readonly sync: OfflineSyncService) {}

  @Post('offline-sync')
  @HttpCode(200)
  run(@Body() body: any) {
    return this.sync.sync(body);
  }
}
