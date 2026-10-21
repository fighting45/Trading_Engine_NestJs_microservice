import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import {
  OnModuleInit,
  OnModuleDestroy,
  Logger,
  Injectable,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { OrderbookService } from '../orderbook/orderbook.service.js';

type Channel = 'orderbook' | 'trades' | 'ticker';

@Injectable()
@WebSocketGateway({
  cors: { origin: '*', methods: ['GET', 'POST'] },
  namespace: '/market',
})
export class WebsocketGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  private readonly server: Server;

  private readonly logger = new Logger(WebsocketGateway.name);
  private subscriber!: Redis;
  private readonly pair: string;

  constructor(
    private readonly config: ConfigService,
    private readonly orderbook: OrderbookService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.pair = this.config.get<string>('app.trading.pair')!;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit() {
    // Dedicated subscriber connection — a Redis client in subscribe mode
    // cannot run regular commands, so this must be a separate instance.
    this.subscriber = new Redis({
      host: this.config.get<string>('app.redis.host'),
      port: this.config.get<number>('app.redis.port'),
      password: this.config.get<string>('app.redis.password'),
      db: this.config.get<number>('app.redis.db'),
    });

    await this.subscriber.subscribe(
      `trades:${this.pair}`,
      `orderbook:${this.pair}`,
      `ticker:${this.pair}`,
    );

    this.subscriber.on('message', (channel: string, message: string) => {
      void this.onRedisMessage(channel, message);
    });

    this.subscriber.on('error', (err: Error) =>
      this.logger.error('Subscriber error', err),
    );

    this.logger.log(`Subscribed to Redis channels for ${this.pair}`);
  }

  async onModuleDestroy() {
    await this.subscriber.quit();
  }

  afterInit() {
    this.logger.log('WebSocket gateway initialised at /market');
  }

  handleConnection(client: Socket) {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  // ─── Client events ──────────────────────────────────────────────────────────

  @SubscribeMessage('subscribe')
  async handleSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channel: Channel },
  ) {
    const room = this.roomKey(data.channel);
    await client.join(room);

    // Send current state immediately on subscribe
    switch (data.channel) {
      case 'orderbook': {
        const snapshot = await this.orderbook.getSnapshot();
        client.emit('orderbook', snapshot);
        break;
      }
      case 'ticker': {
        const ticker = await this.getCurrentTicker();
        if (ticker) client.emit('ticker', ticker);
        break;
      }
      // trades: no initial state — clients receive new trades as they happen
    }

    return { subscribed: data.channel };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { channel: Channel },
  ) {
    await client.leave(this.roomKey(data.channel));
    return { unsubscribed: data.channel };
  }

  // ─── Redis message handler ──────────────────────────────────────────────────

  private async onRedisMessage(channel: string, message: string) {
    if (channel === `trades:${this.pair}`) {
      this.server
        .to(this.roomKey('trades'))
        .emit('trade', JSON.parse(message) as unknown);
      return;
    }

    if (channel === `orderbook:${this.pair}`) {
      // Matching engine signals book changed → fetch fresh snapshot
      const snapshot = await this.orderbook.getSnapshot();
      this.server.to(this.roomKey('orderbook')).emit('orderbook', snapshot);
      return;
    }

    if (channel === `ticker:${this.pair}`) {
      this.server
        .to(this.roomKey('ticker'))
        .emit('ticker', JSON.parse(message) as unknown);
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private roomKey(channel: Channel): string {
    return `${channel}:${this.pair}`;
  }

  private async getCurrentTicker(): Promise<Record<string, string> | null> {
    const raw = await this.redis.hgetall(`ticker:${this.pair}`);
    return Object.keys(raw).length ? raw : null;
  }
}
