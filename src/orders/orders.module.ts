import { Module } from '@nestjs/common';
import { OrderbookModule } from '../orderbook/orderbook.module.js';
import { MatchingModule } from '../matching/matching.module.js';
import { LaravelModule } from '../laravel/laravel.module.js';
import { OrdersService } from './orders.service.js';
import { OrdersController } from './orders.controller.js';

@Module({
  imports: [OrderbookModule, MatchingModule, LaravelModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
