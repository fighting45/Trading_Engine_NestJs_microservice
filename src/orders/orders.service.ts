import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v4 as uuidv4 } from 'uuid';
import { Decimal } from 'decimal.js';
import { OrderbookService } from '../orderbook/orderbook.service.js';
import { MatchingService } from '../matching/matching.service.js';
import { LaravelService } from '../laravel/laravel.service.js';
import type { Order, Trade } from '../common/types/order.types.js';
import type { PlaceOrderDto } from './dto/place-order.dto.js';

export interface PlaceOrderResult {
  order: Order;
  trades: Trade[];
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly pair: string;

  constructor(
    private readonly orderbook: OrderbookService,
    private readonly matching: MatchingService,
    private readonly laravel: LaravelService,
    private readonly config: ConfigService,
  ) {
    this.pair = this.config.get<string>('app.trading.pair')!;
  }

  async placeOrder(dto: PlaceOrderDto): Promise<PlaceOrderResult> {
    if (dto.type === 'limit' && !dto.price) {
      throw new BadRequestException('price is required for limit orders');
    }

    const qty = new Decimal(dto.quantity);
    if (qty.lte(0)) {
      throw new BadRequestException('quantity must be greater than 0');
    }

    if (dto.type === 'limit') {
      const price = new Decimal(dto.price!);
      if (price.lte(0)) {
        throw new BadRequestException('price must be greater than 0');
      }
    }

    const order: Order = {
      id: uuidv4(),
      userId: dto.userId,
      pair: this.pair,
      side: dto.side,
      type: dto.type,
      price: dto.type === 'limit' ? new Decimal(dto.price!).toFixed(8) : '0',
      quantity: qty.toFixed(8),
      filledQuantity: '0.00000000',
      status: 'pending',
      createdAt: Date.now(),
    };

    // Lock funds in Laravel before touching the book
    const lockAsset = dto.side === 'buy' ? 'USDT' : 'EXBT';
    const lockAmount =
      dto.side === 'buy' && dto.type === 'limit'
        ? new Decimal(order.price).times(order.quantity).toFixed(8)
        : order.quantity;

    await this.laravel.lockFunds({
      userId: order.userId,
      orderId: order.id,
      asset: lockAsset,
      amount: lockAmount,
    });

    try {
      // Run matching engine
      const { trades, finalOrder } = await this.matching.match(order);

      if (finalOrder.status === 'filled') {
        // Fully filled — nothing rests in the book
        this.logger.log(`Order ${order.id} fully filled in ${trades.length} trade(s)`);
        return { order: finalOrder, trades };
      }

      if (finalOrder.type === 'market') {
        // Market order couldn't be fully filled — unlock remainder and reject
        const unfilledQty = new Decimal(finalOrder.quantity)
          .minus(finalOrder.filledQuantity)
          .toFixed(8);
        const unlockAmount =
          dto.side === 'buy'
            ? new Decimal(finalOrder.price).times(unfilledQty).toFixed(8)
            : unfilledQty;

        await this.laravel.unlockFunds({
          userId: order.userId,
          orderId: order.id,
          asset: lockAsset,
          amount: unlockAmount,
        });

        return { order: { ...finalOrder, status: 'partially_filled' }, trades };
      }

      // Limit order — partially filled or untouched: add remainder to book
      const orderToRest: Order = { ...finalOrder, status: 'open' };
      await this.orderbook.addOrder(orderToRest);

      this.logger.log(
        `Order ${order.id} resting in book — filled: ${finalOrder.filledQuantity}/${finalOrder.quantity}`,
      );

      return { order: orderToRest, trades };
    } catch (err) {
      // If anything after lockFunds fails, unlock to avoid stuck funds
      await this.laravel
        .unlockFunds({
          userId: order.userId,
          orderId: order.id,
          asset: lockAsset,
          amount: lockAmount,
        })
        .catch((unlockErr: unknown) =>
          this.logger.error(
            `CRITICAL: failed to unlock funds for order ${order.id}`,
            unlockErr,
          ),
        );
      throw err;
    }
  }

  async cancelOrder(orderId: string, userId: string): Promise<Order> {
    const order = await this.orderbook.getOrder(orderId);

    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    if (order.userId !== userId) {
      throw new ForbiddenException('Cannot cancel another user\'s order');
    }

    if (order.status === 'filled' || order.status === 'cancelled') {
      throw new BadRequestException(`Order is already ${order.status}`);
    }

    // Remove from book first
    await this.orderbook.removeOrder(orderId, order.side, userId);

    // Unlock remaining (unfilled) funds
    const unfilledQty = new Decimal(order.quantity)
      .minus(order.filledQuantity)
      .toFixed(8);

    const lockAsset = order.side === 'buy' ? 'USDT' : 'EXBT';
    const unlockAmount =
      order.side === 'buy'
        ? new Decimal(order.price).times(unfilledQty).toFixed(8)
        : unfilledQty;

    await this.laravel.unlockFunds({
      userId,
      orderId,
      asset: lockAsset,
      amount: unlockAmount,
    });

    const cancelled: Order = { ...order, status: 'cancelled' };
    this.logger.log(`Order ${orderId} cancelled by user ${userId}`);
    return cancelled;
  }

  async getOrder(orderId: string): Promise<Order> {
    const order = await this.orderbook.getOrder(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    return order;
  }

  async getUserOrders(userId: string): Promise<Order[]> {
    return this.orderbook.getUserOrders(userId);
  }
}
