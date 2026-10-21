/**
 * WebSocket test client.
 * Connects to /market, subscribes to all channels, then fires orders
 * so you can watch the live events arrive.
 *
 * Run: node ws-test.mjs
 */

import { io } from 'socket.io-client';

const ENGINE_URL  = 'http://localhost:3001/market';
const ORDERS_URL  = 'http://localhost:3001/orders';
const SECRET      = 'test-secret';

// ── helpers ──────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString().slice(11, 23);
const log = (tag, data) =>
  console.log(`[${ts()}] ${tag}\n${JSON.stringify(data, null, 2)}\n`);

async function placeOrder(payload) {
  const res = await fetch(ORDERS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': SECRET,
    },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── connect ───────────────────────────────────────────────────────────────────

console.log('Connecting to', ENGINE_URL, '...\n');

const socket = io(ENGINE_URL, { transports: ['websocket'] });

socket.on('connect', async () => {
  console.log(`✓ Connected  id=${socket.id}\n`);

  // Subscribe to all three channels
  socket.emit('subscribe', { channel: 'orderbook' });
  socket.emit('subscribe', { channel: 'trades'    });
  socket.emit('subscribe', { channel: 'ticker'    });

  await sleep(500); // let initial snapshots arrive

  console.log('─'.repeat(60));
  console.log('Placing orders — watch events below...');
  console.log('─'.repeat(60) + '\n');

  // ── Test 1: two limit orders that rest (no match) ──────────────────────────
  await placeOrder({ userId:'user1', side:'buy',  type:'limit', price:'4.00', quantity:'50' });
  await placeOrder({ userId:'user2', side:'sell', type:'limit', price:'4.50', quantity:'30' });
  await sleep(300);

  // ── Test 2: matching sell — triggers trade + orderbook + ticker events ─────
  console.log('>>> Placing matching sell (50 EXBT @ 4.00)...\n');
  await placeOrder({ userId:'user2', side:'sell', type:'limit', price:'4.00', quantity:'50' });
  await sleep(500);

  // ── Test 3: market buy — sweeps the resting ask ───────────────────────────
  console.log('>>> Placing market buy (20 EXBT)...\n');
  await placeOrder({ userId:'user3', side:'buy', type:'market', quantity:'20' });
  await sleep(500);

  console.log('─'.repeat(60));
  console.log('Done. Press Ctrl-C to exit.');
});

// ── incoming events ───────────────────────────────────────────────────────────

socket.on('orderbook', (data) => log('📖 ORDERBOOK', data));
socket.on('trade',     (data) => log('💰 TRADE    ', data));
socket.on('ticker',    (data) => log('📈 TICKER   ', data));

socket.on('disconnect', (reason) => console.log('Disconnected:', reason));
socket.on('connect_error', (err)  => console.error('Connection error:', err.message));
