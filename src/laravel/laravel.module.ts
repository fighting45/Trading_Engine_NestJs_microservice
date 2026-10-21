import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LaravelService } from './laravel.service.js';

@Module({
  imports: [
    HttpModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseURL: config.get<string>('app.laravel.baseUrl'),
        headers: {
          'x-internal-secret': config.get<string>(
            'app.laravel.internalSecret',
          ),
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }),
    }),
  ],
  providers: [LaravelService],
  exports: [LaravelService],
})
export class LaravelModule {}
