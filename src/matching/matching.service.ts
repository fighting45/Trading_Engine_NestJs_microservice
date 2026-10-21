import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module.js';
import { OrderbookService } from '../orderbook/orderbook.service.js';
import { LaravelService } from '../laravel/laravel.service.js';
import type { Order, Trade, OrderStatus } from '../common/types/order.types.js';

export interface MatchResult {
  trades: Trade[];
  finalOrder: Order;
}

const TICKER_KEY = (pair: string) => `ticker:${pair}`;
const CH_TRADES = (pair: string) => `trades:${pair}`;
const CH_ORDERBOOK = (pair: string) => `orderbook:${pair}`;
const CH_TICKER = (pair: string) => `ticker:${pair}`;

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);
  private readonly makerFeeRate: Decimal;
  private readonly takerFeeRate: Decimal;

  // Per-pair promise chain — ensures one order is fully matched before the next
  // starts. Safe for single-instance; replace with Redis MULTI/EXEC for multi-instance.
  private readonly locks = new Map<string, Promise<void>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly orderbook: OrderbookService,
    private readonly laravel: LaravelService,
    private readonly config: ConfigService,
  ) {
    this.makerFeeRate = new Decimal(
      this.config.get<string>('app.trading.makerFeeRate')!,
    );
    this.takerFeeRate = new Decimal(
      this.config.get<string>('app.trading.takerFeeRate')!,
    );
  }

  async match(incomingOrder: Order): Promise<MatchResult> {
    return this.withLock(incomingOrder.pair, () => this.doMatch(incomingOrder));
  }

  // ─── Core matching ──────────────────────────────────────────────────────────

  private async doMatch(order: Order): Promise<MatchResult> {
    const trades: Trade[] = [];
    let remaining = new Decimal(order.quantity).minus(order.filledQuantity);

    const restingOrders =
      order.side === 'buy'
        ? await this.orderbook.getMatchingAsks(
            order.type === 'market' ? '999999999' : order.price,
          )
        : await this.orderbook.getMatchingBids(
            order.type === 'market' ? '0' : order.price,
          );

    const sorted = this.sortResting(restingOrders, order.side);

    for (const resting of sorted) {
      if (remaining.lte(0)) break;

      const restingRemaining = new Decimal(resting.quantity).minus(
        resting.filledQuantity,
      );
      if (restingRemaining.lte(0)) continue;

      const fillQty   = Decimal.min(remaining, restingRemaining);
      const tradePrice = new Decimal(resting.price); // maker price always wins
      const grossUsdt  = fillQty.times(tradePrice);

      // ── Fee calculation ──────────────────────────────────────────────────────
      // Incoming order = taker. Resting order = maker.
      // Buyer fee: charged in EXBT (deducted from EXBT the buyer receives).
      // Seller fee: charged in USDT (deducted from USDT the seller receives).

      const isBuyerTaker = order.side === 'buy';

      const buyerFeeRate  = isBuyerTaker ? this.takerFeeRate : this.makerFeeRate;
      const sellerFeeRate = isBuyerTaker ? this.makerFeeRate : this.takerFeeRate;

      const buyerFee  = fillQty.times(buyerFeeRate);   // in EXBT
      const sellerFee = grossUsdt.times(sellerFeeRate); // in USDT

      const trade: Trade = {
        id: uuidv4(),
        pair: order.pair,
        price: tradePrice.toFixed(8),
        quantity: fillQty.toFixed(8),
        buyOrderId:  order.side === 'buy'  ? order.id  : resting.id,
        sellOrderId: order.side === 'sell' ? order.id  : resting.id,
        buyUserId:   order.side === 'buy'  ? order.userId  : resting.userId,
        sellUserId:  order.side === 'sell' ? order.userId  : resting.userId,
        buyerFee:  buyerFee.toFixed(8),
        sellerFee: sellerFee.toFixed(8),
        executedAt: Date.now(),
      };

      // Update resting order in book
      const newRestingFilled = new Decimal(resting.filledQuantity)
        .plus(fillQty)
        .toFixed(8);
      const restingFullyFilled = restingRemaining.eq(fillQty);
      const restingStatus: OrderStatus = restingFullyFilled
        ? 'filled'
        : 'partially_filled';

      await this.orderbook.updateFilledQuantity(
        resting.id,
        newRestingFilled,
        restingStatus,
      );

      if (restingFullyFilled) {
        await this.orderbook.removeOrder(resting.id, resting.side, resting.userId);
      }

      // Settle via Laravel (net amounts — Laravel applies fees from locked funds)
      await this.laravel.settleTrade({
        tradeId:   trade.id,
        buyUserId:  trade.buyUserId,
        sellUserId: trade.sellUserId,
        exbtAmount: fillQty.toFixed(8),
        usdtAmount: grossUsdt.toFixed(8),
        buyerFee:   trade.buyerFee,
        sellerFee:  trade.sellerFee,
      });

      remaining = remaining.minus(fillQty);
      trades.push(trade);

      this.logger.debug(
        `Trade ${trade.id}: ${fillQty.toFixed(8)} EXBT @ ${tradePrice.toFixed(8)} USDT` +
        ` | buyerFee=${trade.buyerFee} EXBT sellerFee=${trade.sellerFee} USDT`,
      );
    }

    // Build final incoming order state
    const totalFilled = new Decimal(order.quantity).minus(remaining);
    let finalStatus: OrderStatus;

    if (remaining.lte(0)) {
      finalStatus = 'filled';
    } else if (totalFilled.gt(0)) {
      finalStatus = 'partially_filled';
    } else {
      finalStatus = 'open';
    }

    const finalOrder: Order = {
      ...order,
      filledQuantity: totalFilled.toFixed(8),
      status: finalStatus,
    };

    if (trades.length) {
      await this.publishTradeEvents(trades, finalOrder);
    }

    return { trades, finalOrder };
  }

  // ─── Event publishing ───────────────────────────────────────────────────────

  private async publishTradeEvents(
    trades: Trade[],
    finalOrder: Order,
  ): Promise<void> {
    const lastTrade = trades[trades.length - 1];
    const pair = finalOrder.pair;

    const pipeline = this.redis.pipeline();

    pipeline.hset(TICKER_KEY(pair), {
      lastPrice: lastTrade.price,
      lastQty:   lastTrade.quantity,
      updatedAt: Date.now().toString(),
    });

    for (const trade of trades) {
      pipeline.publish(CH_TRADES(pair), JSON.stringify(trade));
    }
    pipeline.publish(CH_ORDERBOOK(pair), '1');
    pipeline.publish(CH_TICKER(pair), JSON.stringify({
      lastPrice: lastTrade.price,
      lastQty:   lastTrade.quantity,
    }));

    await pipeline.exec();
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private sortResting(orders: Order[], incomingSide: Order['side']): Order[] {
    return [...orders].sort((a, b) => {
      const priceCmp =
        incomingSide === 'buy'
          ? new Decimal(a.price).comparedTo(b.price) // asks: lowest first
          : new Decimal(b.price).comparedTo(a.price); // bids: highest first

      if (priceCmp !== 0) return priceCmp;
      return a.createdAt - b.createdAt; // time priority
    });
  }

  private withLock<T>(pair: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(pair) ?? Promise.resolve();
    let release!: () => void;
    const acquired = new Promise<void>((r) => {
      release = r;
    });
    this.locks.set(pair, acquired);

    return prev.then(async () => {
      try {
        return await fn();
      } finally {
        release();
      }
    });
  }
}
