import { registerAs } from '@nestjs/config';

export const appConfig = registerAs('app', () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  corsOrigin: process.env.CORS_ORIGIN?.split(',') ?? ['*'],

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0', 10),
  },

  laravel: {
    baseUrl: process.env.LARAVEL_BASE_URL ?? 'http://localhost:8000',
    internalSecret: process.env.LARAVEL_INTERNAL_SECRET ?? '',
  },

  trading: {
    pair: process.env.TRADING_PAIR ?? 'EXBT/USDT',
    orderbookDepth: parseInt(process.env.ORDERBOOK_DEPTH ?? '50', 10),
    makerFeeRate: process.env.MAKER_FEE_RATE ?? '0.001',  // 0.1%
    takerFeeRate: process.env.TAKER_FEE_RATE ?? '0.0015', // 0.15%
  },
}));
