export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus =
  | 'pending'
  | 'open'
  | 'partially_filled'
  | 'filled'
  | 'cancelled';

export interface Order {
  id: string;
  userId: string;
  pair: string;
  side: OrderSide;
  type: OrderType;
  price: string;   // decimal string — use Decimal.js for arithmetic
  quantity: string;
  filledQuantity: string;
  status: OrderStatus;
  createdAt: number; // unix ms — used for time priority
}

export interface Trade {
  id: string;
  pair: string;
  price: string;
  quantity: string;
  buyOrderId: string;
  sellOrderId: string;
  buyUserId: string;
  sellUserId: string;
  executedAt: number;
}

export interface OrderbookLevel {
  price: string;
  quantity: string;
}

export interface OrderbookSnapshot {
  pair: string;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  timestamp: number;
}
