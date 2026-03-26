// ============================================
// Express API Server for Dashboard
// ============================================

import express from 'express';
import cors from 'cors';
import path from 'path';
import { Strategy } from './strategy';
import { RiskManager } from './risk-manager';
import { PolymarketClient } from './client';
import { BotConfig } from './types';
import { logger } from './logger';

const COMPONENT = 'Server';

export class DashboardServer {
  private app: express.Application;
  private strategy: Strategy;
  private riskManager: RiskManager;
  private config: BotConfig;
  private polymarketClient: PolymarketClient;
  private startedAt: number;
  private port: number = 3000;

  constructor(strategy: Strategy, riskManager: RiskManager, config: BotConfig, polymarketClient: PolymarketClient) {
    this.app = express();
    this.strategy = strategy;
    this.riskManager = riskManager;
    this.config = config;
    this.polymarketClient = polymarketClient;
    this.startedAt = Date.now();

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    
    // Serve the standalone React frontend
    const publicPath = path.join(__dirname, '../../public');
    this.app.use(express.static(publicPath));
  }

  private setupRoutes() {
    // ── Global Stats ──
    this.app.get('/api/status', async (req, res) => {
      const stats = this.strategy.getStats();
      const risk = this.riskManager.getStatus();
      let usdcWalletBalance: number | null = null;
      try {
        usdcWalletBalance = await this.polymarketClient.fetchUsdcBalance();
      } catch {
        /* optional read */
      }

      const tradingAddress = this.polymarketClient.getTradingAddress();
      const signerAddress = this.polymarketClient.getWalletAddress();

      res.json({
        mode: 'live',
        uptime: Date.now() - this.startedAt,
        isDryRun: this.config.dryRun,
        activeMarkets: stats['Active Markets'],
        liveOrders: stats['Live Orders'],
        capitalDeployed: stats['Capital Deployed'],
        targetAllocationConfig: stats['Target allocation (config)'],
        tradingAddress,
        signerAddress,
        usdcWalletBalance,
        dailyPnl: this.riskManager.getDailyPnl(),
        allTimePnl: this.riskManager.getAllTimePnl(),
        killSwitchActive: this.riskManager.isKillSwitchActive(),
        fillsToday: this.riskManager.getFillCount(),
      });
    });

    // ── Active Markets ──
    this.app.get('/api/markets', (req, res) => {
      const allocations = Array.from(this.strategy.getAllocations().values());
      
      const marketData = allocations.map(alloc => {
        const liveBidUsdc = alloc.activeOrders
          .filter(o => o.status === 'LIVE' && o.side === 'BUY')
          .reduce((s, o) => s + o.size, 0);
        return {
        id: alloc.market.conditionId,
        question: alloc.market.question,
        rewardPool: alloc.market.rewardPool,
        capitalTarget: alloc.capitalAllocated,
        capitalLiveBidUsdc: liveBidUsdc,
        midpoint: alloc.midpoint?.mid || 0,
        spread: alloc.midpoint?.spread || 0,
        paused: alloc.paused,
        inventorySkew: this.riskManager.getInventorySkew(alloc),
        netInventory: this.riskManager.getMarketInventory(alloc),
        liveOrders: alloc.activeOrders.filter(o => o.status === 'LIVE').map(o => ({
          side: o.side,
          outcome: o.outcome,
          price: o.price,
          size: o.size,
        })),
        fills: alloc.activeOrders
          .filter(o => o.sizeMatched > 0)
          .map(o => ({
            side: o.side,
            outcome: o.outcome,
            price: o.price,
            sizeFilled: o.sizeMatched,
          }))
      };
      });

      res.json(marketData);
    });

    // ── Kill Switch Toggle ──
    this.app.post('/api/kill-switch', async (req, res) => {
      const { activate } = req.body;
      
      if (activate === true && !this.riskManager.isKillSwitchActive()) {
        this.riskManager.triggerKillSwitch('Triggered from Web Dashboard');
        await this.strategy.cancelAllOrders();
        res.json({ success: true, status: 'activated' });
      } 
      else if (activate === false && this.riskManager.isKillSwitchActive()) {
        this.riskManager.resetKillSwitch();
        // The strategy loop will naturally start placing orders again on next tick
        res.json({ success: true, status: 'deactivated' });
      } 
      else {
        res.json({ success: true, status: 'unchanged' });
      }
    });
  }

  start() {
    this.app.listen(this.port, () => {
      logger.info(COMPONENT, `🌐 Web Dashboard API running on http://localhost:${this.port}`);
    }).on('error', (err: any) => {
      logger.error(COMPONENT, `Failed to start dashboard server: ${err.message}`);
    });
  }
}
