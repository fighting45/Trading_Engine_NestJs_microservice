import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module.js';
import { RedisModule } from './redis/redis.module.js';
import { LaravelModule } from './laravel/laravel.module.js';
import { OrderbookModule } from './orderbook/orderbook.module.js';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    LaravelModule,
    OrderbookModule,
    // MatchingModule — next
    // OrdersModule   — next
    // WebsocketModule — next
  ],
})
export class AppModule {}
