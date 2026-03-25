// ============================================
// Standalone Dashboard Server
// ============================================
// Run this to view the dashboard without
// starting the full trading bot.
// Usage: npx tsx src/serve-dashboard.ts

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
const publicPath = path.join(__dirname, '../public');
app.use(express.static(publicPath));

// Demo data
const startedAt = Date.now();

app.get('/api/status', (_req, res) => {
  res.json({
    uptime: Date.now() - startedAt,
    isDryRun: true,
    activeMarkets: 3,
    liveOrders: 6,
    capitalDeployed: '$1,500',
    dailyPnl: 12.47,
    killSwitchActive: false,
    fillsToday: 14,
  });
});

app.get('/api/markets', async (_req, res) => {
  // Fetch real reward data from Polymarket
  let realMarkets: any[] = [];
  try {
    const rewardsRes = await fetch('https://clob.polymarket.com/rewards/markets/current');
    if (rewardsRes.ok) {
      const raw = await rewardsRes.json() as any;
      const data = Array.isArray(raw) ? raw : (raw?.data || []);
      const top3 = data
        .map((r: any) => ({
          conditionId: r.condition_id,
          daily: parseFloat(r.total_daily_rate || '0'),
        }))
        .filter((r: any) => r.daily > 50)
        .sort((a: any, b: any) => b.daily - a.daily)
        .slice(0, 3);

      // Enrich with names from Gamma API
      for (const r of top3) {
        try {
          const mRes = await fetch(`https://gamma-api.polymarket.com/markets?id=${r.conditionId}`);
          if (mRes.ok) {
            const mData = (await mRes.json()) as any[];
            const m = mData[0];
            if (m) {
              realMarkets.push({
                id: r.conditionId,
                question: m.question || 'Unknown Market',
                rewardPool: r.daily,
                capital: 500,
                midpoint: 0.5 + (Math.random() * 0.3 - 0.15),
                spread: 0.02,
                paused: false,
                inventorySkew: Math.random() * 0.4,
                netInventory: Math.floor(Math.random() * 20 - 10),
                liveOrders: [
                  { side: 'BUY', outcome: 'Yes', price: 0.48, size: 50 },
                  { side: 'SELL', outcome: 'Yes', price: 0.52, size: 50 },
                ],
                fills: [],
              });
            }
          }
        } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
    }
  } catch {}

  // Fallback demo data if API fails
  if (realMarkets.length === 0) {
    realMarkets = [
      {
        id: 'demo-1',
        question: 'Will Bitcoin exceed $150,000 by end of 2026?',
        rewardPool: 164.25,
        capital: 500,
        midpoint: 0.623,
        spread: 0.02,
        paused: false,
        inventorySkew: 0.15,
        netInventory: 3,
        liveOrders: [
          { side: 'BUY', outcome: 'Yes', price: 0.613, size: 50 },
          { side: 'SELL', outcome: 'Yes', price: 0.633, size: 50 },
        ],
        fills: [],
      },
      {
        id: 'demo-2',
        question: 'Will the Fed cut rates before July 2026?',
        rewardPool: 128.52,
        capital: 500,
        midpoint: 0.421,
        spread: 0.02,
        paused: false,
        inventorySkew: 0.35,
        netInventory: -7,
        liveOrders: [
          { side: 'BUY', outcome: 'Yes', price: 0.411, size: 50 },
          { side: 'SELL', outcome: 'Yes', price: 0.431, size: 50 },
        ],
        fills: [],
      },
      {
        id: 'demo-3',
        question: 'Russia-Ukraine Ceasefire before GTA VI?',
        rewardPool: 114.00,
        capital: 500,
        midpoint: 0.287,
        spread: 0.02,
        paused: false,
        inventorySkew: 0.08,
        netInventory: 1,
        liveOrders: [
          { side: 'BUY', outcome: 'Yes', price: 0.277, size: 50 },
          { side: 'SELL', outcome: 'Yes', price: 0.297, size: 50 },
        ],
        fills: [],
      },
    ];
  }

  res.json(realMarkets);
});

app.post('/api/kill-switch', (_req, res) => {
  res.json({ success: true, status: 'demo_mode' });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`\n  🌐 Polybot Dashboard running at: http://localhost:${PORT}\n`);
  console.log(`  This is the standalone dashboard preview.`);
  console.log(`  To connect to the live bot, run: npm run dev\n`);
});
