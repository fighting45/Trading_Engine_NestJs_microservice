import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { Decimal } from 'decimal.js';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import type {
  Order,
  OrderSide,
  OrderbookLevel,
  OrderbookSnapshot,
} from '../common/types/order.types.js';

@Injectable()
export class OrderbookService implements OnModuleInit {
  private readonly logger = new Logger(OrderbookService.name);
  private readonly pair: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {
    this.pair = this.config.get<string>('app.trading.pair')!;
  }

  onModuleInit() {
    this.logger.log(`Orderbook ready — pair: ${this.pair}`);
  }

  // ─── Redis key helpers ──────────────────────────────────────────────────────

  private bidsKey() {
    return `book:${this.pair}:bids`;
  }

  private asksKey() {
    return `book:${this.pair}:asks`;
  }

  private orderKey(orderId: string) {
    return `order:${orderId}`;
  }

  private userOrdersKey(userId: string) {
    return `user:orders:${userId}`;
  }

  // ─── Write operations ───────────────────────────────────────────────────────

  async addOrder(order: Order): Promise<void> {
    const score = new Decimal(order.price).toNumber();
    const bookKey = order.side === 'buy' ? this.bidsKey() : this.asksKey();

    const pipeline = this.redis.pipeline();
    pipeline.zadd(bookKey, score, order.id);
    pipeline.hset(this.orderKey(order.id), {
      id: order.id,
      userId: order.userId,
      pair: order.pair,
      side: order.side,
      type: order.type,
      price: order.price,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      status: order.status,
      createdAt: order.createdAt.toString(),
    });
    pipeline.sadd(this.userOrdersKey(order.userId), order.id);
    await pipeline.exec();
  }

  async removeOrder(
    orderId: string,
    side: OrderSide,
    userId: string,
  ): Promise<void> {
    const bookKey = side === 'buy' ? this.bidsKey() : this.asksKey();

    const pipeline = this.redis.pipeline();
    pipeline.zrem(bookKey, orderId);
    pipeline.del(this.orderKey(orderId));
    pipeline.srem(this.userOrdersKey(userId), orderId);
    await pipeline.exec();
  }

  async updateFilledQuantity(
    orderId: string,
    filledQuantity: string,
    status: Order['status'],
  ): Promise<void> {
    await this.redis.hset(this.orderKey(orderId), { filledQuantity, status });
  }

  // ─── Read operations ────────────────────────────────────────────────────────

  async getOrder(orderId: string): Promise<Order | null> {
    const raw = await this.redis.hgetall(this.orderKey(orderId));
    if (!raw?.id) return null;
    return this.deserializeOrder(raw);
  }

  async getBestBid(): Promise<string | null> {
    // Highest score = highest price = best bid
    const [topId] = await this.redis.zrevrange(this.bidsKey(), 0, 0);
    if (!topId) return null;
    return this.redis.hget(this.orderKey(topId), 'price');
  }

  async getBestAsk(): Promise<string | null> {
    // Lowest score = lowest price = best ask
    const [topId] = await this.redis.zrange(this.asksKey(), '0', '0');
    if (!topId) return null;
    return this.redis.hget(this.orderKey(topId), 'price');
  }

  /**
   * Returns resting bids priced >= minPrice, best-price-first then time-priority.
   * Used by the matching engine.
   */
  async getMatchingBids(minPrice: string): Promise<Order[]> {
    const min = new Decimal(minPrice).toFixed(8);
    const ids = await this.redis.zrevrangebyscore(this.bidsKey(), '+inf', min);
    return this.fetchOrdersBatch(ids);
  }

  /**
   * Returns resting asks priced <= maxPrice, best-price-first then time-priority.
   * Used by the matching engine.
   */
  async getMatchingAsks(maxPrice: string): Promise<Order[]> {
    const max = new Decimal(maxPrice).toFixed(8);
    const ids = await this.redis.zrangebyscore(this.asksKey(), '-inf', max);
    return this.fetchOrdersBatch(ids);
  }

  async getSnapshot(depth?: number): Promise<OrderbookSnapshot> {
    const d = depth ?? this.config.get<number>('app.trading.orderbookDepth')!;
    const fetchLimit = d * 4; // overfetch to handle partially-filled orders

    const [bidIds, askIds] = await Promise.all([
      this.redis.zrevrange(this.bidsKey(), 0, fetchLimit - 1),
      this.redis.zrange(this.asksKey(), '0', String(fetchLimit - 1)),
    ]);

    const [bids, asks] = await Promise.all([
      this.aggregateLevels(bidIds, d),
      this.aggregateLevels(askIds, d),
    ]);

    return { pair: this.pair, bids, asks, timestamp: Date.now() };
  }

  async getUserOrders(userId: string): Promise<Order[]> {
    const ids = await this.redis.smembers(this.userOrdersKey(userId));
    if (!ids.length) return [];
    return this.fetchOrdersBatch(ids);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async fetchOrdersBatch(ids: string[]): Promise<Order[]> {
    if (!ids.length) return [];

    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.hgetall(this.orderKey(id));
    const results = await pipeline.exec();

    const orders: Order[] = [];
    for (const result of results ?? []) {
      const [err, raw] = result as [Error | null, Record<string, string>];
      if (err || !raw?.id) continue;
      orders.push(this.deserializeOrder(raw));
    }

    // Time priority within same price level
    return orders.sort((a, b) => a.createdAt - b.createdAt);
  }

  private async aggregateLevels(
    ids: string[],
    depth: number,
  ): Promise<OrderbookLevel[]> {
    if (!ids.length) return [];

    // Pipeline: fetch price, quantity, filledQuantity for each order
    const pipeline = this.redis.pipeline();
    for (const id of ids) {
      pipeline.hmget(this.orderKey(id), 'price', 'quantity', 'filledQuantity');
    }
    const results = await pipeline.exec();

    // Aggregate remaining qty by price level. Map preserves insertion order
    // which already matches Redis sort order (best price first).
    const levelMap = new Map<string, Decimal>();

    for (const result of results ?? []) {
      const [err, fields] = result as [
        Error | null,
        [string | null, string | null, string | null],
      ];
      if (err || !fields[0] || !fields[1]) continue;

      const price = new Decimal(fields[0]).toFixed(8);
      const remaining = new Decimal(fields[1]).minus(fields[2] ?? '0');
      if (remaining.lte(0)) continue;

      const current = levelMap.get(price) ?? new Decimal(0);
      levelMap.set(price, current.plus(remaining));

      if (levelMap.size >= depth) break;
    }

    return Array.from(levelMap.entries()).map(([price, quantity]) => ({
      price,
      quantity: quantity.toFixed(8),
    }));
  }

  private deserializeOrder(raw: Record<string, string>): Order {
    return {
      id: raw.id,
      userId: raw.userId,
      pair: raw.pair,
      side: raw.side as Order['side'],
      type: raw.type as Order['type'],
      price: raw.price,
      quantity: raw.quantity,
      filledQuantity: raw.filledQuantity ?? '0',
      status: raw.status as Order['status'],
      createdAt: parseInt(raw.createdAt, 10),
    };
  }
}
