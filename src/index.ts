// ============================================
// Polymarket Reward Farming Bot — Main Entry
// ============================================
// Orchestrates all components:
// 1. Load config & initialize client
// 2. Discover best sponsored markets
// 3. Start strategy loop (place/manage orders)
// 4. Monitor via WebSocket + dashboard
// 5. Graceful shutdown on SIGINT/SIGTERM

import 'dotenv/config';
import { loadConfig } from './config';
import { PolymarketClient } from './client';
import { MarketDiscovery } from './market-discovery';
import { Strategy } from './strategy';
import { RiskManager } from './risk-manager';
import { PolymarketWebSocket } from './websocket';
import { Monitor } from './monitor';
import { DashboardServer } from './server';
import { logger, setLogLevel } from './logger';
import { BotConfig } from './types';

const COMPONENT = 'Main';

// Strategy tick interval (how often we check/update orders)
const TICK_INTERVAL_MS = 15000;  // 15 seconds
// Market re-discovery interval (find new/better markets)
const REDISCOVERY_INTERVAL_MS = 3600000; // 1 hour

class Bot {
  private config!: BotConfig;
  private client!: PolymarketClient;
  private discovery!: MarketDiscovery;
  private strategy!: Strategy;
  private riskManager!: RiskManager;
  private webSocket!: PolymarketWebSocket;
  private monitor!: Monitor;
  private server!: DashboardServer;
  private tickTimer: NodeJS.Timeout | null = null;
  private rediscoveryTimer: NodeJS.Timeout | null = null;
  private running: boolean = false;

  async start(): Promise<void> {
    try {
      // ── Step 1: Load Configuration ──
      logger.banner('POLYMARKET REWARD FARMING BOT');
      logger.info(COMPONENT, 'Loading configuration...');
      this.config = loadConfig();
      setLogLevel(this.config.logLevel);

      if (this.config.dryRun) {
        logger.warn(COMPONENT, '🧪 DRY RUN MODE — No real orders will be placed');
      }

      logger.info(COMPONENT, 'Configuration loaded:');
      logger.table({
        'Max Markets': this.config.maxMarkets,
        'Capital/Market': `$${this.config.capitalPerMarket}`,
        'Order Size': `$${this.config.orderSize}`,
        'Spread': `${(this.config.spreadFromMidpoint * 100).toFixed(1)}¢`,
        'Min Reward Pool': `$${this.config.minRewardPool}/day`,
        'Daily Loss Limit': `$${this.config.dailyLossLimit}`,
        'Mode': this.config.dryRun ? 'DRY RUN' : 'LIVE',
      });

      // ── Step 2: Initialize Polymarket Client ──
      logger.separator();
      this.client = new PolymarketClient(this.config);
      await this.client.initialize();

      // ── Step 3: Initialize Components ──
      this.riskManager = new RiskManager(this.config);
      this.discovery = new MarketDiscovery(this.client, this.config);
      this.strategy = new Strategy(this.client, this.riskManager, this.config);

      // ── Step 4: Discover Best Markets ──
      logger.separator();
      const bestMarkets = await this.discovery.discoverBestMarkets();
      
      if (bestMarkets.length === 0) {
        logger.error(COMPONENT, 'No profitable markets found. Try lowering MIN_REWARD_POOL or increasing MAX_MARKETS.');
        logger.info(COMPONENT, 'Exiting...');
        process.exit(1);
      }

      // ── Step 5: Initialize Strategy ──
      this.strategy.initializeMarkets(bestMarkets);

      // ── Step 6: Connect WebSocket ──
      logger.separator();
      this.webSocket = new PolymarketWebSocket(this.config);
      
      this.webSocket.onPriceChange((assetId, newMid) => {
        this.strategy.handleMidpointUpdate(assetId, newMid);
      });

      try {
        await this.webSocket.connect();

        // Subscribe to all active token pairs
        for (const rm of bestMarkets) {
          for (const token of rm.market.tokens) {
            this.webSocket.subscribe(token.tokenId);
          }
        }
      } catch (err: any) {
        logger.warn(COMPONENT, `WebSocket connection failed: ${err.message}. Continuing with polling only.`);
      }

      // ── Step 7: Start Strategy Loop ──
      logger.separator();
      logger.info(COMPONENT, `🚀 Starting strategy loop (tick every ${TICK_INTERVAL_MS / 1000}s)...`);
      this.running = true;

      // Initial tick
      await this.strategy.tick();

      // Periodic ticks
      this.tickTimer = setInterval(async () => {
        if (!this.running) return;
        try {
          await this.strategy.tick();
        } catch (err: any) {
          logger.error(COMPONENT, `Strategy tick error: ${err.message}`);
        }
      }, TICK_INTERVAL_MS);

      // Periodic market re-discovery
      this.rediscoveryTimer = setInterval(async () => {
        if (!this.running) return;
        logger.info(COMPONENT, '🔄 Re-evaluating markets...');
        try {
          const newMarkets = await this.discovery.discoverBestMarkets();
          if (newMarkets.length > 0) {
            // Cancel all existing, reinitialize with new selection
            await this.strategy.cancelAllOrders();
            this.strategy.initializeMarkets(newMarkets);
            logger.info(COMPONENT, `Switched to ${newMarkets.length} new markets`);
          }
        } catch (err: any) {
          logger.error(COMPONENT, `Market rediscovery error: ${err.message}`);
        }
      }, REDISCOVERY_INTERVAL_MS);

      // ── Step 8: Start Monitor & Server ──
      this.monitor = new Monitor(this.strategy, this.riskManager, this.config);
      this.monitor.startDashboard(30000); // Terminal output every 30s
      
      this.server = new DashboardServer(this.strategy, this.riskManager, this.config);
      this.server.start();

      // Send startup alert
      await this.monitor.sendAlert(
        `Bot started! Farming ${bestMarkets.length} markets with $${this.config.capitalPerMarket * bestMarkets.length} total capital.`,
        'info'
      );

      // ── Step 9: Handle Shutdown ──
      this.setupShutdown();

      logger.info(COMPONENT, '✅ Bot is running. Press Ctrl+C to stop.');
      logger.info(COMPONENT, `Dashboard updates every 30 seconds. Strategy ticks every ${TICK_INTERVAL_MS / 1000}s.`);

    } catch (err: any) {
      logger.error(COMPONENT, `Fatal startup error: ${err.message}`);
      console.error(err);
      process.exit(1);
    }
  }

  private setupShutdown(): void {
    const shutdown = async (signal: string) => {
      logger.warn(COMPONENT, `\n📛 Received ${signal}, shutting down gracefully...`);
      this.running = false;

      // Stop timers
      if (this.tickTimer) clearInterval(this.tickTimer);
      if (this.rediscoveryTimer) clearInterval(this.rediscoveryTimer);

      // Stop monitor
      if (this.monitor) this.monitor.stopDashboard();

      // Cancel all orders
      try {
        logger.info(COMPONENT, 'Cancelling all open orders...');
        await this.strategy.cancelAllOrders();
        logger.info(COMPONENT, '✅ All orders cancelled');
      } catch (err: any) {
        logger.error(COMPONENT, `Error cancelling orders: ${err.message}`);
      }

      // Disconnect WebSocket
      if (this.webSocket) this.webSocket.disconnect();

      // Send shutdown alert
      if (this.monitor) {
        await this.monitor.sendAlert('Bot stopped. All orders cancelled.', 'warning');
      }

      // Final dashboard
      if (this.monitor) this.monitor.printDashboard();

      logger.info(COMPONENT, '👋 Goodbye!');
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      logger.error(COMPONENT, `Uncaught exception: ${err.message}`);
      console.error(err);
      shutdown('uncaughtException');
    });
  }
}

// ── Run ──
const bot = new Bot();
bot.start().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});
