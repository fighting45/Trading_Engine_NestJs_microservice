import {
  Controller,
  Post,
  Delete,
  Get,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard } from '../common/guards/internal.guard.js';
import { OrdersService } from './orders.service.js';
import { PlaceOrderDto } from './dto/place-order.dto.js';
import { CancelOrderDto } from './dto/cancel-order.dto.js';

// All routes here are called by Laravel (internal), never directly by frontend
@Controller('orders')
@UseGuards(InternalGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  placeOrder(@Body() dto: PlaceOrderDto) {
    return this.orders.placeOrder(dto);
  }

  @Delete(':orderId')
  cancelOrder(
    @Param('orderId') orderId: string,
    @Body() dto: CancelOrderDto,
  ) {
    return this.orders.cancelOrder(orderId, dto.userId);
  }

  @Get(':orderId')
  getOrder(@Param('orderId') orderId: string) {
    return this.orders.getOrder(orderId);
  }

  @Get()
  getUserOrders(@Query('userId') userId: string) {
    return this.orders.getUserOrders(userId);
  }
}
