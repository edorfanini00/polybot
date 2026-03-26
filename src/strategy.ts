// ============================================
// Strategy Engine — Liquidity Reward Farming
// ============================================
// Core strategy: place two-sided limit orders
// near the adjusted midpoint on sponsored
// reward markets to earn daily rewards and
// capture bid-ask spread.

import { PolymarketClient } from './client';
import { RiskManager } from './risk-manager';
import { BotConfig, MarketAllocation, ActiveOrder, MidpointInfo, FillEvent, Position } from './types';
import { RankedMarket } from './market-discovery';
import { logger } from './logger';

const COMPONENT = 'Strategy';

export class Strategy {
  private client: PolymarketClient;
  private riskManager: RiskManager;
  private config: BotConfig;
  private allocations: Map<string, MarketAllocation> = new Map();
  private lastReconcileAt: number = 0;
  private reconcileIntervalMs: number = 60_000;
  private tokenToConditionId: Map<string, string> = new Map();

  constructor(client: PolymarketClient, riskManager: RiskManager, config: BotConfig) {
    this.client = client;
    this.riskManager = riskManager;
    this.config = config;
  }

  /**
   * Set up allocations for the selected markets.
   */
  initializeMarkets(rankedMarkets: RankedMarket[]): void {
    this.tokenToConditionId.clear();
    for (const rm of rankedMarkets) {
      const yesToken = rm.market.tokens.find(t => t.outcome === 'Yes') || rm.market.tokens[0];
      const noToken = rm.market.tokens.find(t => t.outcome === 'No') || rm.market.tokens[1];

      const allocation: MarketAllocation = {
        market: rm.market,
        yesTokenId: yesToken.tokenId,
        noTokenId: noToken.tokenId,
        capitalAllocated: this.config.capitalPerMarket,
        activeOrders: [],
        positions: [],
        midpoint: rm.midpoint,
        lastOrderUpdate: 0,
        paused: false,
      };

      this.allocations.set(rm.market.conditionId, allocation);
      // Used during exchange reconciliation to map token -> condition.
      this.tokenToConditionId.set(yesToken.tokenId, rm.market.conditionId);
      this.tokenToConditionId.set(noToken.tokenId, rm.market.conditionId);
      logger.info(COMPONENT, `Initialized market: ${rm.market.question.slice(0, 50)}...`);
    }
  }

  /**
   * Main strategy loop tick — called periodically.
   * For each active market:
   * 1. Fetch current midpoint
   * 2. Check if orders need updating
   * 3. Place/replace orders
   */
  async tick(): Promise<void> {
    if (this.riskManager.isKillSwitchActive()) {
      logger.warn(COMPONENT, '⏸️ Kill switch active — skipping tick');
      return;
    }

    for (const [conditionId, allocation] of this.allocations) {
      try {
        await this.tickMarket(conditionId, allocation);
      } catch (err: any) {
        logger.error(COMPONENT, `Error in market ${conditionId}: ${err.message}`);
      }
    }
  }

  /**
   * Process a single market: check midpoint, update orders.
   */
  private async tickMarket(conditionId: string, allocation: MarketAllocation): Promise<void> {
    // Check risk limits
    const riskCheck = this.riskManager.checkOrderAllowed(allocation);
    if (!riskCheck.allowed) {
      logger.debug(COMPONENT, `Skipping ${conditionId.slice(0, 8)}...: ${riskCheck.reason}`);
      return;
    }

    // Fetch current order book for YES token
    const book = await this.client.getOrderBook(allocation.yesTokenId);
    if (!book) {
      logger.debug(COMPONENT, `No order book data for ${conditionId.slice(0, 8)}...`);
      return;
    }

    const newMidpoint = this.client.getMidpoint(book);
    if (!newMidpoint) {
      logger.debug(COMPONENT, `Cannot determine midpoint for ${conditionId.slice(0, 8)}...`);
      return;
    }

    // Check if midpoint has moved enough to warrant order update
    const midpointMoved = allocation.midpoint
      ? Math.abs(newMidpoint.mid - allocation.midpoint.mid) > 0.005 // More than 0.5 cent change
      : true;

    const hasNoOrders = allocation.activeOrders.filter(o => o.status === 'LIVE').length === 0;
    const timeSinceUpdate = Date.now() - allocation.lastOrderUpdate;
    const needsRefresh = timeSinceUpdate > 60000; // Refresh every 60s to maintain reward eligibility

    if (midpointMoved || hasNoOrders || needsRefresh) {
      allocation.midpoint = newMidpoint;

      // Cancel existing orders first
      await this.cancelMarketOrders(allocation);

      // Place new two-sided orders
      await this.placeOrders(allocation, newMidpoint);

      allocation.lastOrderUpdate = Date.now();
    }
  }

  /**
   * Place two-sided limit orders around the midpoint.
   * 
   * For YES token:
   *   BUY  at midpoint - spread (bid)
   *   SELL at midpoint + spread (ask)
   * 
   * For NO token:
   *   BUY  at (1 - midpoint) - spread (bid on the inverse)
   *   SELL at (1 - midpoint) + spread (ask on the inverse)
   */
  private async placeOrders(allocation: MarketAllocation, midpoint: MidpointInfo): Promise<void> {
    const spread = this.config.spreadFromMidpoint;
    const orderSize = this.config.orderSize;
    const negRisk = Boolean(allocation.market.negRisk);

    // Adjust spread based on inventory skew
    const skew = this.riskManager.getInventorySkew(allocation);
    const skewAdjustment = skew * 0.01; // Widen spread by up to 1 cent when skewed

    // ── YES Token Orders ──
    const yesBidPrice = midpoint.mid - spread - skewAdjustment;
    const yesAskPrice = midpoint.mid + spread + skewAdjustment;
    const yesInventory = this.getTokenInventory(allocation, allocation.yesTokenId);
    const noInventory = this.getTokenInventory(allocation, allocation.noTokenId);

    // Only place bid if price is reasonable (0.05–0.95 range)
    if (yesBidPrice >= 0.05 && yesBidPrice <= 0.95) {
      const orderId = await this.client.placeLimitOrder(
        allocation.yesTokenId,
        yesBidPrice,
        orderSize,
        'BUY',
        negRisk
      );
      if (orderId) {
        allocation.activeOrders.push({
          orderId,
          marketConditionId: allocation.market.conditionId,
          tokenId: allocation.yesTokenId,
          side: 'BUY',
          price: yesBidPrice,
          size: orderSize,
          sizeMatched: 0,
          status: 'LIVE',
          createdAt: Date.now(),
          outcome: 'Yes',
        });
      }
    }

    if (yesAskPrice >= 0.05 && yesAskPrice <= 0.95 && yesInventory >= orderSize) {
      const orderId = await this.client.placeLimitOrder(
        allocation.yesTokenId,
        yesAskPrice,
        orderSize,
        'SELL',
        negRisk
      );
      if (orderId) {
        allocation.activeOrders.push({
          orderId,
          marketConditionId: allocation.market.conditionId,
          tokenId: allocation.yesTokenId,
          side: 'SELL',
          price: yesAskPrice,
          size: orderSize,
          sizeMatched: 0,
          status: 'LIVE',
          createdAt: Date.now(),
          outcome: 'Yes',
        });
      }
    }

    // ── NO Token Orders ──
    // In a binary market, NO price = 1 - YES price
    const noMid = 1 - midpoint.mid;
    const noBidPrice = noMid - spread - skewAdjustment;
    const noAskPrice = noMid + spread + skewAdjustment;

    if (noBidPrice >= 0.05 && noBidPrice <= 0.95) {
      const orderId = await this.client.placeLimitOrder(
        allocation.noTokenId,
        noBidPrice,
        orderSize,
        'BUY',
        negRisk
      );
      if (orderId) {
        allocation.activeOrders.push({
          orderId,
          marketConditionId: allocation.market.conditionId,
          tokenId: allocation.noTokenId,
          side: 'BUY',
          price: noBidPrice,
          size: orderSize,
          sizeMatched: 0,
          status: 'LIVE',
          createdAt: Date.now(),
          outcome: 'No',
        });
      }
    }

    if (noAskPrice >= 0.05 && noAskPrice <= 0.95 && noInventory >= orderSize) {
      const orderId = await this.client.placeLimitOrder(
        allocation.noTokenId,
        noAskPrice,
        orderSize,
        'SELL',
        negRisk
      );
      if (orderId) {
        allocation.activeOrders.push({
          orderId,
          marketConditionId: allocation.market.conditionId,
          tokenId: allocation.noTokenId,
          side: 'SELL',
          price: noAskPrice,
          size: orderSize,
          sizeMatched: 0,
          status: 'LIVE',
          createdAt: Date.now(),
          outcome: 'No',
        });
      }
    }

    const liveOrders = allocation.activeOrders.filter(o => o.status === 'LIVE');
    logger.info(COMPONENT, `📌 Placed ${liveOrders.length} orders on ${allocation.market.question.slice(0, 40)}... | Mid: $${midpoint.mid.toFixed(3)}`);
  }

  /**
   * Cancel all active orders for a market.
   */
  private async cancelMarketOrders(allocation: MarketAllocation): Promise<void> {
    const liveOrders = allocation.activeOrders.filter(o => o.status === 'LIVE');
    if (liveOrders.length === 0) return;

    for (const order of liveOrders) {
      await this.client.cancelOrder(order.orderId);
      order.status = 'CANCELLED';
    }

    // Clean up old cancelled orders (keep last 50 for history)
    allocation.activeOrders = allocation.activeOrders
      .filter(o => o.status === 'LIVE')
      .concat(allocation.activeOrders.filter(o => o.status !== 'LIVE').slice(-50));

    logger.debug(COMPONENT, `Cancelled ${liveOrders.length} orders for ${allocation.market.conditionId.slice(0, 8)}...`);
  }

  /**
   * Cancel ALL orders across all markets (emergency).
   */
  async cancelAllOrders(): Promise<void> {
    logger.warn(COMPONENT, '🛑 Cancelling all orders across all markets...');
    await this.client.cancelAllOrders();

    for (const [, allocation] of this.allocations) {
      for (const order of allocation.activeOrders) {
        order.status = 'CANCELLED';
      }
    }
  }

  /**
   * Process a fill event from the WebSocket.
   */
  handleFill(fill: FillEvent): void {
    const allocation = this.allocations.get(fill.marketConditionId);
    if (!allocation) return;

    // Update order status
    const order = allocation.activeOrders.find(o => o.orderId === fill.orderId);
    if (order) {
      order.sizeMatched += fill.size;
      if (order.sizeMatched >= order.size) {
        order.status = 'MATCHED';
      }
    }

    // Track the fill in risk manager
    this.riskManager.recordFill(fill);

    // Calculate immediate spread P&L
    // If we bought YES at 0.48 and midpoint is 0.50, we made 0.02 per share
    if (allocation.midpoint) {
      const spreadCapture = fill.side === 'BUY'
        ? (allocation.midpoint.mid - fill.price) * fill.size
        : (fill.price - allocation.midpoint.mid) * fill.size;

      if (spreadCapture > 0) {
        this.riskManager.addToPnl(spreadCapture, `Spread capture on ${fill.outcome}`);
      }
    }
  }

  /**
   * Handle midpoint update from WebSocket.
   */
  handleMidpointUpdate(conditionId: string, newMid: number): void {
    const allocation = this.allocations.get(conditionId);
    if (!allocation || !allocation.midpoint) return;

    const oldMid = allocation.midpoint.mid;
    const diff = Math.abs(newMid - oldMid);

    // Only trigger rebalance if significant move
    if (diff > this.config.spreadFromMidpoint * 0.5) {
      logger.info(COMPONENT, `⚡ Midpoint shifted: $${oldMid.toFixed(3)} → $${newMid.toFixed(3)} (${(diff * 100).toFixed(1)}¢)`);
      allocation.midpoint.mid = newMid;
      // The next tick will detect the change and rebalance orders
    }
  }

  /**
   * Get all active allocations for monitoring.
   */
  getAllocations(): Map<string, MarketAllocation> {
    return this.allocations;
  }

  /**
   * USDC committed in live BUY orders (synced with exchange via reconcile).
   * SELL orders lock outcome tokens, not USDC — not included here.
   */
  getLiveBuyUsdcTotal(): number {
    let sum = 0;
    for (const [, alloc] of this.allocations) {
      for (const o of alloc.activeOrders) {
        if (o.status === 'LIVE' && o.side === 'BUY') sum += o.size;
      }
    }
    return sum;
  }

  /**
   * Get summary stats for monitoring.
   */
  getStats(): Record<string, any> {
    let totalOrders = 0;
    let targetCapital = 0;

    for (const [, alloc] of this.allocations) {
      totalOrders += alloc.activeOrders.filter(o => o.status === 'LIVE').length;
      targetCapital += alloc.capitalAllocated;
    }

    const liveBuyUsdc = this.getLiveBuyUsdcTotal();

    return {
      'Active Markets': this.allocations.size,
      'Live Orders': totalOrders,
      'Capital Deployed': `$${liveBuyUsdc.toFixed(2)}`,
      'Target allocation (config)': `$${targetCapital.toFixed(2)}`,
    };
  }

  private updatePositionFromFill(allocation: MarketAllocation, fill: FillEvent): void {
    const signedSize = fill.side === 'BUY' ? fill.size : -fill.size;
    let position = allocation.positions.find(p => p.tokenId === fill.tokenId);

    if (!position) {
      position = {
        conditionId: allocation.market.conditionId,
        tokenId: fill.tokenId,
        outcome: fill.outcome,
        size: 0,
        averagePrice: fill.price,
        currentPrice: allocation.midpoint?.mid ?? fill.price,
        unrealizedPnl: 0,
      };
      allocation.positions.push(position);
    }

    const prevSize = position.size;
    const nextSize = prevSize + signedSize;

    if (nextSize === 0) {
      position.size = 0;
      position.unrealizedPnl = 0;
      position.currentPrice = allocation.midpoint?.mid ?? fill.price;
      return;
    }

    if ((prevSize >= 0 && signedSize >= 0) || (prevSize <= 0 && signedSize <= 0) || prevSize === 0) {
      const weightedNotional = (Math.abs(prevSize) * position.averagePrice) + (Math.abs(signedSize) * fill.price);
      position.averagePrice = weightedNotional / Math.abs(nextSize);
    }

    position.size = nextSize;
    position.currentPrice = allocation.midpoint?.mid ?? fill.price;
    position.unrealizedPnl = (position.currentPrice - position.averagePrice) * position.size;
  }

  async reconcileWithExchange(force: boolean = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastReconcileAt < this.reconcileIntervalMs) return;
    this.lastReconcileAt = now;

    try {
      await this.reconcileOpenOrders();
      await this.reconcilePositions();
      this.syncUnrealizedPnl();
    } catch (err: any) {
      logger.warn(COMPONENT, `State reconciliation failed: ${err.message}`);
    }
  }

  private async reconcileOpenOrders(): Promise<void> {
    const remoteOpenOrders = await this.client.getOpenOrders();
    const remoteById = new Map<string, any>();
    for (const raw of remoteOpenOrders) {
      const id = String(raw.orderID || raw.id || raw.orderId || '');
      if (!id) continue;
      remoteById.set(id, raw);
    }
    const remoteIds = new Set<string>(
      Array.from(remoteById.keys())
    );

    for (const [, allocation] of this.allocations) {
      for (const order of allocation.activeOrders) {
        if (order.status === 'LIVE') {
          const remote = remoteById.get(order.orderId);
          if (remote) {
            const sizeMatched = this.toNumber(
              remote.sizeMatched ?? remote.size_matched ?? remote.filled_size ?? remote.filledSize,
              order.sizeMatched
            );
            order.sizeMatched = Math.min(order.size, Math.max(order.sizeMatched, sizeMatched));
          }
        }

        if (order.status === 'LIVE' && !remoteIds.has(order.orderId)) {
          order.status = order.sizeMatched > 0 ? 'MATCHED' : 'CANCELLED';
        }
      }
    }
  }

  private async reconcilePositions(): Promise<void> {
    const positions = await this.client.getPositions();
    if (!Array.isArray(positions)) return;

    const byCondition = new Map<string, Position[]>();

    for (const raw of positions) {
      const tokenId = String(raw.tokenId || raw.token_id || raw.asset || raw.asset_id || '');
      const conditionIdFromPayload = String(raw.conditionId || raw.condition_id || raw.market_id || raw.marketId || '');
      const conditionId = conditionIdFromPayload || this.tokenToConditionId.get(tokenId) || '';
      const size = this.toNumber(raw.size ?? raw.position ?? raw.balance ?? raw.amount);
      if (!conditionId || !tokenId || size === 0) continue;

      const currentPrice = this.toNumber(raw.currentPrice ?? raw.current_price ?? raw.mark_price ?? raw.price, 0.5);
      const averagePrice = this.toNumber(raw.averagePrice ?? raw.average_price ?? raw.avg_price ?? raw.avgPrice, currentPrice);
      const outcome = String(raw.outcome || raw.side || this.getOutcomeForToken(conditionId, tokenId));

      const parsed: Position = {
        conditionId,
        tokenId,
        outcome,
        size,
        averagePrice,
        currentPrice,
        unrealizedPnl: (currentPrice - averagePrice) * size,
      };

      const existing = byCondition.get(conditionId) || [];
      existing.push(parsed);
      byCondition.set(conditionId, existing);
    }

    for (const [conditionId, allocation] of this.allocations) {
      allocation.positions = byCondition.get(conditionId) || [];
    }
  }

  private syncUnrealizedPnl(): void {
    let totalUnrealized = 0;
    for (const [, allocation] of this.allocations) {
      for (const pos of allocation.positions) {
        if (allocation.midpoint) {
          if (pos.tokenId === allocation.yesTokenId) {
            pos.currentPrice = allocation.midpoint.mid;
          } else if (pos.tokenId === allocation.noTokenId) {
            pos.currentPrice = 1 - allocation.midpoint.mid;
          }
        }
        pos.unrealizedPnl = (pos.currentPrice - pos.averagePrice) * pos.size;
        totalUnrealized += pos.unrealizedPnl;
      }
    }
    this.riskManager.setUnrealizedPnl(totalUnrealized);
  }

  private toNumber(value: unknown, fallback: number = 0): number {
    const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : fallback;
  }

  private getTokenInventory(allocation: MarketAllocation, tokenId: string): number {
    const pos = allocation.positions.find(p => p.tokenId === tokenId);
    return pos ? Math.max(0, pos.size) : 0;
  }

  private getOutcomeForToken(conditionId: string, tokenId: string): string {
    const alloc = this.allocations.get(conditionId);
    if (!alloc) return 'Unknown';
    if (tokenId === alloc.yesTokenId) return 'Yes';
    if (tokenId === alloc.noTokenId) return 'No';
    return 'Unknown';
  }
}
