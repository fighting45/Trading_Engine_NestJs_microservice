import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redis = new Redis({
          host: config.get('app.redis.host'),
          port: config.get('app.redis.port'),
          password: config.get('app.redis.password'),
          db: config.get('app.redis.db'),
          lazyConnect: false,
        });

        redis.on('connect', () => console.log('Redis connected'));
        redis.on('error', (err: Error) => console.error('Redis error', err));

        return redis;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
