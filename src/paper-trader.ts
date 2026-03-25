// ============================================
// Paper Trading Engine
// ============================================
// Runs the full bot logic against REAL Polymarket
// data but simulates all order fills locally.
// No wallet or private key required.
//
// Usage: npm run paper

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';

const SPREAD = 0.02;
const ORDER_SIZE = 50;
const CAPITAL_PER_MARKET = 500;
const MAX_MARKETS = 5;
const TICK_INTERVAL = 15_000;     // 15s
const DISCOVERY_INTERVAL = 600_000; // 10 min
const FILL_PROBABILITY = 0.25;     // 25% chance per tick per order

// ── Types ──

interface PaperOrder {
  id: string;
  side: 'BUY' | 'SELL';
  outcome: 'Yes' | 'No';
  price: number;
  size: number;
  placedAt: number;
}

interface PaperMarket {
  conditionId: string;
  question: string;
  rewardPool: number;
  midpoint: number;
  orders: PaperOrder[];
  inventory: number;       // net YES shares (+long YES, -long NO)
  realizedPnl: number;
  fills: number;
  paused: boolean;
}

// ── State ──

let markets: PaperMarket[] = [];
let dailyPnl = 0;
let allTimePnl = 0;
let totalFills = 0;
let killSwitchActive = false;
const startedAt = Date.now();
let orderId = 0;

// ── Market Discovery ──

async function discoverMarkets(): Promise<void> {
  console.log('[Discovery] Scanning Polymarket for reward markets...');

  try {
    const rewardsRes = await fetch('https://clob.polymarket.com/rewards/markets/current');
    if (!rewardsRes.ok) throw new Error(`Rewards API: ${rewardsRes.status}`);

    const raw = await rewardsRes.json() as any;
    const data = Array.isArray(raw) ? raw : (raw?.data || []);

    const ranked = data
      .map((r: any) => ({
        conditionId: r.condition_id,
        daily: parseFloat(r.total_daily_rate || '0'),
      }))
      .filter((r: any) => r.daily > 30)
      .sort((a: any, b: any) => b.daily - a.daily)
      .slice(0, MAX_MARKETS);

    console.log(`[Discovery] Found ${data.length} reward markets, picking top ${ranked.length}`);

    const newMarkets: PaperMarket[] = [];

    for (const r of ranked) {
      // Reuse existing market state if we're re-discovering
      const existing = markets.find(m => m.conditionId === r.conditionId);
      if (existing) {
        existing.rewardPool = r.daily;
        newMarkets.push(existing);
        continue;
      }

      try {
        const mRes = await fetch(`https://gamma-api.polymarket.com/markets?condition_id=${r.conditionId}`);
        if (!mRes.ok) continue;
        const mData = (await mRes.json()) as any[];
        const m = mData[0];
        if (!m) continue;

        // Fetch real midpoint from CLOB
        let midpoint = 0.5;
        try {
          const bookRes = await fetch(`https://clob.polymarket.com/midpoint?token_id=${m.clobTokenIds?.[0] || ''}`);
          if (bookRes.ok) {
            const bookData = await bookRes.json() as any;
            midpoint = parseFloat(bookData?.mid || '0.5');
          }
        } catch {}

        newMarkets.push({
          conditionId: r.conditionId,
          question: m.question || 'Unknown Market',
          rewardPool: r.daily,
          midpoint: midpoint || 0.5,
          orders: [],
          inventory: 0,
          realizedPnl: 0,
          fills: 0,
          paused: false,
        });

        console.log(`  ✓ ${m.question?.slice(0, 60)} — $${r.daily.toFixed(0)}/day`);
      } catch {}

      await new Promise(r => setTimeout(r, 300));
    }

    markets = newMarkets;
    console.log(`[Discovery] Active: ${markets.length} markets\n`);
  } catch (err: any) {
    console.error(`[Discovery] Error: ${err.message}`);
  }
}

// ── Simulated Strategy Tick ──

function strategyTick(): void {
  if (killSwitchActive) return;

  for (const market of markets) {
    if (market.paused) continue;

    // Simulate small midpoint drift (real-world noise)
    const drift = (Math.random() - 0.5) * 0.008;
    market.midpoint = Math.max(0.05, Math.min(0.95, market.midpoint + drift));

    // Check existing orders for simulated fills
    const filledOrders: PaperOrder[] = [];
    for (const order of market.orders) {
      const shouldFill = Math.random() < FILL_PROBABILITY;
      if (!shouldFill) continue;

      // Simulate fill
      if (order.side === 'BUY') {
        market.inventory += order.size;
        const spreadCapture = market.midpoint - order.price;
        const pnl = spreadCapture * order.size;
        market.realizedPnl += pnl;
        dailyPnl += pnl;
        allTimePnl += pnl;
      } else {
        market.inventory -= order.size;
        const spreadCapture = order.price - market.midpoint;
        const pnl = spreadCapture * order.size;
        market.realizedPnl += pnl;
        dailyPnl += pnl;
        allTimePnl += pnl;
      }

      market.fills++;
      totalFills++;
      filledOrders.push(order);

      console.log(`  [Fill] ${order.side} ${order.size} ${order.outcome} @ $${order.price.toFixed(3)} on "${market.question.slice(0, 40)}..."`);
    }

    // Remove filled orders
    market.orders = market.orders.filter(o => !filledOrders.includes(o));

    // Place new two-sided orders if we have room
    const buyOrders = market.orders.filter(o => o.side === 'BUY');
    const sellOrders = market.orders.filter(o => o.side === 'SELL');

    // Inventory skew adjustment
    const skewAdj = (market.inventory / 200) * 0.005;

    if (buyOrders.length === 0 && Math.abs(market.inventory) < 200) {
      market.orders.push({
        id: `paper-${++orderId}`,
        side: 'BUY',
        outcome: 'Yes',
        price: +(market.midpoint - SPREAD - skewAdj).toFixed(4),
        size: ORDER_SIZE,
        placedAt: Date.now(),
      });
    }

    if (sellOrders.length === 0 && Math.abs(market.inventory) < 200) {
      market.orders.push({
        id: `paper-${++orderId}`,
        side: 'SELL',
        outcome: 'Yes',
        price: +(market.midpoint + SPREAD + skewAdj).toFixed(4),
        size: ORDER_SIZE,
        placedAt: Date.now(),
      });
    }
  }
}

// ── Express Dashboard Server ──

function startServer(): void {
  const app = express();
  app.use(cors());
  app.use(express.json());

  const publicPath = path.join(__dirname, '../public');
  app.use(express.static(publicPath));

  app.get('/api/status', (_req, res) => {
    const totalCapital = markets.length * CAPITAL_PER_MARKET;
    res.json({
      mode: 'paper',
      uptime: Date.now() - startedAt,
      isDryRun: true,
      activeMarkets: markets.length,
      liveOrders: markets.reduce((n, m) => n + m.orders.length, 0),
      capitalDeployed: `$${totalCapital.toLocaleString()}`,
      dailyPnl: +dailyPnl.toFixed(2),
      allTimePnl: +allTimePnl.toFixed(2),
      killSwitchActive,
      fillsToday: totalFills,
    });
  });

  app.get('/api/markets', (_req, res) => {
    res.json(markets.map(m => ({
      id: m.conditionId,
      question: m.question,
      rewardPool: m.rewardPool,
      capital: CAPITAL_PER_MARKET,
      midpoint: m.midpoint,
      spread: SPREAD,
      paused: m.paused,
      inventorySkew: Math.min(1, Math.abs(m.inventory) / 200),
      netInventory: m.inventory,
      liveOrders: m.orders.map(o => ({
        side: o.side,
        outcome: o.outcome,
        price: o.price,
        size: o.size,
      })),
      fills: [],
    })));
  });

  app.post('/api/kill-switch', (req, res) => {
    const { activate } = req.body;
    if (activate && !killSwitchActive) {
      killSwitchActive = true;
      // Cancel all paper orders
      for (const m of markets) m.orders = [];
      console.log('\n  🛑 Kill switch ACTIVATED — all paper orders cancelled\n');
      res.json({ success: true, status: 'activated' });
    } else if (!activate && killSwitchActive) {
      killSwitchActive = false;
      console.log('\n  ✅ Kill switch DEACTIVATED — paper trading resumed\n');
      res.json({ success: true, status: 'deactivated' });
    } else {
      res.json({ success: true, status: 'unchanged' });
    }
  });

  const PORT = 3000;
  app.listen(PORT, () => {
    console.log(`  🌐 Dashboard: http://localhost:${PORT}\n`);
  });
}

// ── Main ──

async function main(): Promise<void> {
  console.log('\n  ════════════════════════════════════════');
  console.log('  📄 POLYBOT — PAPER TRADING MODE');
  console.log('  ════════════════════════════════════════');
  console.log('  No wallet required. Using real market data.');
  console.log('  Simulating fills locally.\n');

  // Start dashboard immediately
  startServer();

  // Discover markets
  await discoverMarkets();

  // Strategy loop
  console.log(`  ⏱  Strategy tick every ${TICK_INTERVAL / 1000}s\n`);
  setInterval(strategyTick, TICK_INTERVAL);

  // Re-discover markets periodically
  setInterval(discoverMarkets, DISCOVERY_INTERVAL);

  // Initial tick
  strategyTick();

  // P&L summary every 60s
  setInterval(() => {
    console.log(`\n  ── Paper P&L ── Daily: $${dailyPnl.toFixed(2)} | All-Time: $${allTimePnl.toFixed(2)} | Fills: ${totalFills} | Markets: ${markets.length}`);
  }, 60_000);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  👋 Paper trading stopped.\n');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
