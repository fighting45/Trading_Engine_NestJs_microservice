import { Module } from '@nestjs/common';
import { OrderbookModule } from '../orderbook/orderbook.module.js';
import { LaravelModule } from '../laravel/laravel.module.js';
import { MatchingService } from './matching.service.js';

@Module({
  imports: [OrderbookModule, LaravelModule],
  providers: [MatchingService],
  exports: [MatchingService],
})
export class MatchingModule {}
