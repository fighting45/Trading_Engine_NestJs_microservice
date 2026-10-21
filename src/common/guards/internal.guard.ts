import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class InternalGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const secret = (req.headers as unknown as Record<string, string>)[
      'x-internal-secret'
    ];

    if (secret !== this.config.get<string>('app.laravel.internalSecret')) {
      throw new UnauthorizedException('Invalid internal secret');
    }

    return true;
  }
}
