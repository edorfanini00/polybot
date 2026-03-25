// ============================================
// Monitor — Dashboard & Alerts
// ============================================
// Displays real-time bot status in the console
// and sends alerts via Discord/Telegram.

import { Strategy } from './strategy';
import { RiskManager } from './risk-manager';
import { BotConfig } from './types';
import { logger } from './logger';

const COMPONENT = 'Monitor';

export class Monitor {
  private strategy: Strategy;
  private riskManager: RiskManager;
  private config: BotConfig;
  private startedAt: number;
  private totalRewardsEstimated: number = 0;
  private dashboardInterval: NodeJS.Timeout | null = null;

  constructor(strategy: Strategy, riskManager: RiskManager, config: BotConfig) {
    this.strategy = strategy;
    this.riskManager = riskManager;
    this.config = config;
    this.startedAt = Date.now();
  }

  /**
   * Start the monitoring dashboard (prints every N seconds).
   */
  startDashboard(intervalMs: number = 30000): void {
    this.printDashboard(); // Print immediately
    this.dashboardInterval = setInterval(() => {
      this.printDashboard();
    }, intervalMs);
  }

  /**
   * Stop the monitoring dashboard.
   */
  stopDashboard(): void {
    if (this.dashboardInterval) {
      clearInterval(this.dashboardInterval);
      this.dashboardInterval = null;
    }
  }

  /**
   * Print the current status dashboard.
   */
  printDashboard(): void {
    const uptime = this.formatUptime(Date.now() - this.startedAt);
    const strategyStats = this.strategy.getStats();
    const riskStatus = this.riskManager.getStatus();
    const allocations = this.strategy.getAllocations();

    console.log('\n');
    logger.banner('POLYMARKET REWARD FARMING BOT');
    
    // Status overview
    console.log('  📊 STATUS');
    logger.table({
      'Mode': this.config.dryRun ? '🧪 DRY RUN' : '💰 LIVE',
      'Uptime': uptime,
      ...strategyStats,
    });

    console.log('');
    
    // Risk status
    console.log('  ⚡ RISK');
    logger.table(riskStatus);

    console.log('');

    // Per-market status
    console.log('  📈 MARKETS');
    for (const [conditionId, alloc] of allocations) {
      const liveOrders = alloc.activeOrders.filter(o => o.status === 'LIVE').length;
      const mid = alloc.midpoint ? `$${alloc.midpoint.mid.toFixed(3)}` : 'N/A';
      const reward = alloc.market.rewardPool ? `$${alloc.market.rewardPool.toFixed(0)}/day` : 'N/A';
      
      console.log(`\n    ${alloc.paused ? '⏸️' : '🟢'} ${alloc.market.question.slice(0, 55)}...`);
      logger.table({
        '      Midpoint': mid,
        '      Orders': `${liveOrders} live`,
        '      Reward Pool': reward,
        '      Capital': `$${alloc.capitalAllocated}`,
      });
    }

    console.log('');
    logger.separator();
  }

  /**
   * Send an alert via configured channels.
   */
  async sendAlert(message: string, level: 'info' | 'warning' | 'critical' = 'info'): Promise<void> {
    const emoji = level === 'critical' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';
    const fullMessage = `${emoji} **Polymarket Bot** | ${message}`;

    // Discord webhook
    if (this.config.discordWebhookUrl) {
      try {
        await fetch(this.config.discordWebhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: fullMessage }),
        });
      } catch (err: any) {
        logger.error(COMPONENT, `Discord alert failed: ${err.message}`);
      }
    }

    // Telegram
    if (this.config.telegramBotToken && this.config.telegramChatId) {
      try {
        await fetch(
          `https://api.telegram.org/bot${this.config.telegramBotToken}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: this.config.telegramChatId,
              text: fullMessage,
              parse_mode: 'Markdown',
            }),
          }
        );
      } catch (err: any) {
        logger.error(COMPONENT, `Telegram alert failed: ${err.message}`);
      }
    }
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m ${seconds % 60}s`;
  }
}
