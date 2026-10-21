import { Module } from '@nestjs/common';
import { OrderbookModule } from '../orderbook/orderbook.module.js';
import { WebsocketGateway } from './websocket.gateway.js';

@Module({
  imports: [OrderbookModule],
  providers: [WebsocketGateway],
})
export class WebsocketModule {}
