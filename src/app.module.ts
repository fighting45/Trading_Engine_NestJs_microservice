import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { RedisModule } from './redis/redis.module.js';
import { LaravelModule } from './laravel/laravel.module.js';
import { OrderbookModule } from './orderbook/orderbook.module.js';
import { MatchingModule } from './matching/matching.module.js';
import { OrdersModule } from './orders/orders.module.js';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    LaravelModule,
    OrderbookModule,
    MatchingModule,
    OrdersModule,
    // WebsocketModule — next
  ],
})
export class AppModule {}
