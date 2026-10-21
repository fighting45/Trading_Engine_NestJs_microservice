import { Module } from '@nestjs/common';
import { OrderbookService } from './orderbook.service.js';
import { OrderbookController } from './orderbook.controller.js';

@Module({
  controllers: [OrderbookController],
  providers: [OrderbookService],
  exports: [OrderbookService],
})
export class OrderbookModule {}
