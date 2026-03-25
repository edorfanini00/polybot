// ============================================
// Risk Manager
// ============================================
// Monitors positions, enforces limits, and
// triggers kill switch when thresholds are hit.

import { BotConfig, ActiveOrder, FillEvent, Position, MarketAllocation } from './types';
import { logger } from './logger';

const COMPONENT = 'Risk';

export class RiskManager {
  private config: BotConfig;
  private dailyPnl: number = 0;
  private allTimePnl: number = 0;
  private fills: FillEvent[] = [];
  private lastFillTime: number = 0;
  private killSwitchActive: boolean = false;
  private dayStart: number;

  constructor(config: BotConfig) {
    this.config = config;
    this.dayStart = this.getDayStart();
  }

  /**
   * Check if we should place new orders for a market.
   * Returns { allowed: boolean, reason?: string }
   */
  checkOrderAllowed(allocation: MarketAllocation): { allowed: boolean; reason?: string } {
    // Kill switch
    if (this.killSwitchActive) {
      return { allowed: false, reason: '🛑 Kill switch is active' };
    }

    // Daily loss limit
    if (this.dailyPnl <= this.config.dailyLossLimit) {
      this.triggerKillSwitch('Daily loss limit exceeded');
      return { allowed: false, reason: `Daily P&L ($${this.dailyPnl.toFixed(2)}) below limit ($${this.config.dailyLossLimit})` };
    }

    // Market paused
    if (allocation.paused) {
      return { allowed: false, reason: 'Market is paused' };
    }

    // Fill cooldown
    const timeSinceLastFill = Date.now() - this.lastFillTime;
    if (timeSinceLastFill < this.config.fillCooldownMs) {
      return { allowed: false, reason: `Fill cooldown (${((this.config.fillCooldownMs - timeSinceLastFill) / 1000).toFixed(1)}s remaining)` };
    }

    // Per-market inventory limit
    const totalInventory = this.getMarketInventory(allocation);
    if (Math.abs(totalInventory) >= this.config.maxInventoryPerMarket) {
      return { allowed: false, reason: `Inventory limit reached (${totalInventory} shares)` };
    }

    // Total exposure limit
    const totalExposure = this.getTotalExposure([allocation]);
    if (totalExposure >= this.config.maxTotalExposure) {
      return { allowed: false, reason: `Total exposure limit ($${totalExposure.toFixed(2)})` };
    }

    return { allowed: true };
  }

  /**
   * Record a fill event and update P&L.
   */
  recordFill(fill: FillEvent): void {
    this.fills.push(fill);
    this.lastFillTime = fill.timestamp;

    // Simple P&L calc: for market making, we track the spread captured
    // In a binary market, if we buy YES at 0.48 and it's worth 0.50 midpoint, 
    // we have unrealized P&L of +0.02 per share
    logger.info(COMPONENT, `📝 Fill recorded: ${fill.side} ${fill.size} ${fill.outcome} @ $${fill.price.toFixed(4)}`);
    
    this.checkDayRollover();
  }

  /**
   * Update realized P&L (e.g., from spread capture or position close).
   */
  addToPnl(amount: number, reason: string): void {
    this.dailyPnl += amount;
    this.allTimePnl += amount;
    logger.info(COMPONENT, `💰 P&L update: ${amount >= 0 ? '+' : ''}$${amount.toFixed(4)} (${reason}) → Daily: $${this.dailyPnl.toFixed(2)} | All-Time: $${this.allTimePnl.toFixed(2)}`);
  }

  /**
   * Trigger the kill switch — cancel all orders.
   */
  triggerKillSwitch(reason: string): void {
    if (this.killSwitchActive) return;
    this.killSwitchActive = true;
    logger.error(COMPONENT, `🛑 KILL SWITCH ACTIVATED: ${reason}`);
    logger.error(COMPONENT, `Daily P&L: $${this.dailyPnl.toFixed(2)} | Fills today: ${this.fills.length}`);
  }

  /**
   * Reset kill switch (manual override).
   */
  resetKillSwitch(): void {
    this.killSwitchActive = false;
    logger.warn(COMPONENT, '⚠️ Kill switch has been reset');
  }

  isKillSwitchActive(): boolean {
    return this.killSwitchActive;
  }

  /**
   * Get inventory for a specific market (net position).
   * Positive = long YES, Negative = long NO.
   */
  getMarketInventory(allocation: MarketAllocation): number {
    let inventory = 0;
    for (const pos of allocation.positions) {
      if (pos.outcome === 'Yes') {
        inventory += pos.size;
      } else {
        inventory -= pos.size;
      }
    }
    return inventory;
  }

  /**
   * Calculate inventory skew ratio.
   * Returns 0 (balanced) to 1 (fully one-sided).
   */
  getInventorySkew(allocation: MarketAllocation): number {
    const inventory = this.getMarketInventory(allocation);
    if (this.config.maxInventoryPerMarket === 0) return 0;
    return Math.abs(inventory) / this.config.maxInventoryPerMarket;
  }

  /**
   * Get total capital exposure across all markets.
   */
  getTotalExposure(allocations: MarketAllocation[]): number {
    let total = 0;
    for (const alloc of allocations) {
      for (const pos of alloc.positions) {
        total += Math.abs(pos.size * pos.currentPrice);
      }
      for (const order of alloc.activeOrders) {
        if (order.status === 'LIVE') {
          total += (order.size - order.sizeMatched) * order.price;
        }
      }
    }
    return total;
  }

  getDailyPnl(): number {
    return this.dailyPnl;
  }

  getAllTimePnl(): number {
    return this.allTimePnl;
  }

  getFillCount(): number {
    return this.fills.length;
  }

  getStatus(): Record<string, any> {
    return {
      'Kill Switch': this.killSwitchActive ? '🛑 ACTIVE' : '✅ Off',
      'Daily P&L': `$${this.dailyPnl.toFixed(2)}`,
      'Loss Limit': `$${this.config.dailyLossLimit}`,
      'Fills Today': this.fills.length,
      'Last Fill': this.lastFillTime > 0 ? `${((Date.now() - this.lastFillTime) / 1000).toFixed(0)}s ago` : 'None',
    };
  }

  /**
   * Check if the day has rolled over and reset counters.
   */
  private checkDayRollover(): void {
    const currentDayStart = this.getDayStart();
    if (currentDayStart > this.dayStart) {
      logger.info(COMPONENT, '📅 New day detected — resetting daily P&L and fill counters');
      this.dailyPnl = 0;
      this.fills = [];
      this.dayStart = currentDayStart;
      
      // Reset kill switch for new day if it was loss-triggered
      if (this.killSwitchActive) {
        this.resetKillSwitch();
      }
    }
  }

  private getDayStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
}
