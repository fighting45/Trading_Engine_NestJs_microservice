import {
  IsEnum,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsString,
  ValidateIf,
} from 'class-validator';
import type { OrderSide, OrderType } from '../../common/types/order.types.js';

export class PlaceOrderDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsEnum(['buy', 'sell'])
  side: OrderSide;

  @IsEnum(['limit', 'market'])
  type: OrderType;

  @IsNumberString()
  quantity: string;

  // Required for limit orders only
  @ValidateIf((o: PlaceOrderDto) => o.type === 'limit')
  @IsNumberString()
  @IsNotEmpty()
  price?: string;
}
