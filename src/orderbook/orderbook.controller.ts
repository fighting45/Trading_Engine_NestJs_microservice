import { Controller, Get, Query, ParseIntPipe, DefaultValuePipe } from '@nestjs/common';
import { OrderbookService } from './orderbook.service.js';
import type { OrderbookSnapshot } from '../common/types/order.types.js';

@Controller('orderbook')
export class OrderbookController {
  constructor(private readonly orderbook: OrderbookService) {}

  @Get('snapshot')
  async getSnapshot(
    @Query('depth', new DefaultValuePipe(50), ParseIntPipe) depth: number,
  ): Promise<OrderbookSnapshot> {
    return this.orderbook.getSnapshot(depth);
  }

  @Get('ticker')
  async getTicker(): Promise<{ bestBid: string | null; bestAsk: string | null; spread: string | null }> {
    const [bestBid, bestAsk] = await Promise.all([
      this.orderbook.getBestBid(),
      this.orderbook.getBestAsk(),
    ]);

    const spread =
      bestBid && bestAsk
        ? (parseFloat(bestAsk) - parseFloat(bestBid)).toFixed(8)
        : null;

    return { bestBid, bestAsk, spread };
  }
}
