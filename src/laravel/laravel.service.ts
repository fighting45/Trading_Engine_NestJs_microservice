import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface LockFundsDto {
  userId: string;
  orderId: string;
  asset: 'USDT' | 'EXBT';
  amount: string;
}

export interface SettleTradeDto {
  tradeId: string;
  buyUserId: string;
  sellUserId: string;
  exbtAmount: string;   // gross EXBT traded
  usdtAmount: string;   // gross USDT traded
  buyerFee: string;     // EXBT deducted from buyer's credit (charged to buyer)
  sellerFee: string;    // USDT deducted from seller's credit (charged to seller)
}

export interface UnlockFundsDto {
  userId: string;
  orderId: string;
  asset: 'USDT' | 'EXBT';
  amount: string;
}

@Injectable()
export class LaravelService {
  private readonly logger = new Logger(LaravelService.name);

  constructor(private readonly http: HttpService) {}

  async lockFunds(dto: LockFundsDto): Promise<void> {
    await firstValueFrom(
      this.http.post('/internal/trading/lock', dto),
    ).catch((err) => {
      this.logger.error('lockFunds failed', err?.response?.data ?? err.message);
      throw err;
    });
  }

  async unlockFunds(dto: UnlockFundsDto): Promise<void> {
    await firstValueFrom(
      this.http.post('/internal/trading/unlock', dto),
    ).catch((err) => {
      this.logger.error(
        'unlockFunds failed',
        err?.response?.data ?? err.message,
      );
      throw err;
    });
  }

  async settleTrade(dto: SettleTradeDto): Promise<void> {
    await firstValueFrom(
      this.http.post('/internal/trading/settle', dto),
    ).catch((err) => {
      this.logger.error(
        'settleTrade failed',
        err?.response?.data ?? err.message,
      );
      throw err;
    });
  }
}
