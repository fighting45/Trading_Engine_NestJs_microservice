/**
 * Mock Laravel internal API for local testing.
 * Simulates lock / unlock / settle with in-memory balances.
 * Run: node mock-laravel.mjs
 */

import { createServer } from 'http';

const SECRET = 'test-secret';

// In-memory ledger: { userId: { USDT: { available, locked }, EXBT: { available, locked } } }
const ledger = {};

function getBalance(userId, asset) {
  if (!ledger[userId]) ledger[userId] = {};
  if (!ledger[userId][asset]) ledger[userId][asset] = { available: 100000, locked: 0 };
  return ledger[userId][asset];
}

const settledTrades = new Set();

function respond(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(JSON.parse(data || '{}')));
  });
}

const server = createServer(async (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (secret !== SECRET) {
    return respond(res, 401, { message: 'Unauthorized' });
  }

  const body = await readBody(req);
  const url = req.url;

  // ── POST /internal/trading/lock ─────────────────────────────────────────────
  if (url === '/internal/trading/lock' && req.method === 'POST') {
    const { userId, orderId, asset, amount } = body;
    const bal = getBalance(userId, asset);
    const amt = parseFloat(amount);

    if (bal.available < amt) {
      console.log(`[LOCK FAILED] user=${userId} asset=${asset} need=${amt} have=${bal.available}`);
      return respond(res, 422, { message: 'Insufficient balance' });
    }

    bal.available -= amt;
    bal.locked    += amt;

    console.log(`[LOCK]   user=${userId} order=${orderId} ${asset} ${amt.toFixed(8)}  | avail=${bal.available.toFixed(2)} locked=${bal.locked.toFixed(2)}`);
    return respond(res, 200, { success: true });
  }

  // ── POST /internal/trading/unlock ───────────────────────────────────────────
  if (url === '/internal/trading/unlock' && req.method === 'POST') {
    const { userId, orderId, asset, amount } = body;
    const bal = getBalance(userId, asset);
    const amt = parseFloat(amount);

    bal.locked    -= amt;
    bal.available += amt;

    console.log(`[UNLOCK] user=${userId} order=${orderId} ${asset} ${amt.toFixed(8)}  | avail=${bal.available.toFixed(2)} locked=${bal.locked.toFixed(2)}`);
    return respond(res, 200, { success: true });
  }

  // ── POST /internal/trading/settle ───────────────────────────────────────────
  if (url === '/internal/trading/settle' && req.method === 'POST') {
    const { tradeId, buyUserId, sellUserId, exbtAmount, usdtAmount, buyerFee, sellerFee } = body;

    // Idempotency guard
    if (settledTrades.has(tradeId)) {
      console.log(`[SETTLE] duplicate tradeId=${tradeId} — ignored`);
      return respond(res, 200, { success: true, duplicate: true });
    }
    settledTrades.add(tradeId);

    const exbt       = parseFloat(exbtAmount);
    const usdt       = parseFloat(usdtAmount);
    const bFee       = parseFloat(buyerFee  ?? '0'); // EXBT fee
    const sFee       = parseFloat(sellerFee ?? '0'); // USDT fee

    // Buyer: deduct locked USDT (full gross), credit EXBT net of fee
    const buyerUsdt = getBalance(buyUserId, 'USDT');
    const buyerExbt = getBalance(buyUserId, 'EXBT');
    buyerUsdt.locked    -= usdt;
    buyerExbt.available += (exbt - bFee);  // net EXBT after buyer fee

    // Seller: deduct locked EXBT (full gross), credit USDT net of fee
    const sellerExbt = getBalance(sellUserId, 'EXBT');
    const sellerUsdt = getBalance(sellUserId, 'USDT');
    sellerExbt.locked    -= exbt;
    sellerUsdt.available += (usdt - sFee); // net USDT after seller fee

    const price = exbt > 0 ? (usdt / exbt).toFixed(8) : '0';
    console.log(`[SETTLE] trade=${tradeId}  ${exbt.toFixed(8)} EXBT @ ${price} USDT`);
    console.log(`         fees  buyerFee=${bFee.toFixed(8)} EXBT  sellerFee=${sFee.toFixed(8)} USDT`);
    console.log(`         buyer=${buyUserId}   USDT locked=${buyerUsdt.locked.toFixed(4)}  EXBT avail=${buyerExbt.available.toFixed(4)}`);
    console.log(`         seller=${sellUserId}  EXBT locked=${sellerExbt.locked.toFixed(4)} USDT avail=${sellerUsdt.available.toFixed(4)}`);

    return respond(res, 200, { success: true });
  }

  // ── GET /internal/balances/:userId ──────────────────────────────────────────
  if (url?.startsWith('/internal/balances/') && req.method === 'GET') {
    const userId = url.split('/')[3];
    respond(res, 200, ledger[userId] ?? {});
    return;
  }

  respond(res, 404, { message: 'Not found' });
});

server.listen(4000, () => {
  console.log('Mock Laravel running on http://localhost:4000');
  console.log('Every user starts with 100,000 USDT and 100,000 EXBT\n');
});
