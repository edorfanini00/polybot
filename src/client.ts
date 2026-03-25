// ============================================
// Polymarket Client Wrapper
// ============================================
// Wraps @polymarket/clob-client with typed helpers
// for market discovery, order management, and auth.

import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';
import { BotConfig, Market, MarketToken, OrderBook, MidpointInfo, ActiveOrder, RewardConfig } from './types';
import { logger } from './logger';

const COMPONENT = 'Client';

export class PolymarketClient {
  private client!: ClobClient;
  private config: BotConfig;
  private wallet: ethers.Wallet;
  private apiCreds: any = null;

  constructor(config: BotConfig) {
    this.config = config;
    this.wallet = new ethers.Wallet(config.privateKey);
    logger.info(COMPONENT, `Wallet address: ${this.wallet.address}`);
  }

  async initialize(): Promise<void> {
    logger.info(COMPONENT, 'Initializing Polymarket CLOB client...');

    // Step 1: Create client without credentials to derive API key
    const tempClient = new ClobClient(
      this.config.clobApiHost,
      this.config.chainId,
      this.wallet as any
    );

    // Step 2: Derive API credentials using EIP-712 signature
    try {
      this.apiCreds = await tempClient.deriveApiKey();
      logger.info(COMPONENT, 'API credentials derived successfully');
    } catch (err: any) {
      // If credentials already exist, try to get them
      if (err?.message?.includes('already')) {
        logger.info(COMPONENT, 'API key already exists, creating credentials...');
        this.apiCreds = await tempClient.createApiKey();
      } else {
        throw err;
      }
    }

    // Step 3: Create authenticated client
    this.client = new ClobClient(
      this.config.clobApiHost,
      this.config.chainId,
      this.wallet as any,
      this.apiCreds
    );

    logger.info(COMPONENT, '✅ Client initialized and authenticated');
  }

  // ── Market Discovery ──────────────────────────

  async getActiveMarkets(limit: number = 100, offset: number = 0): Promise<any[]> {
    try {
      const response = await fetch(
        `${this.config.gammaApiHost}/markets?limit=${limit}&offset=${offset}&active=true&closed=false`
      );
      if (!response.ok) throw new Error(`Gamma API error: ${response.status}`);
      const data = (await response.json()) as any[];
      return data;
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to fetch active markets: ${err.message}`);
      return [];
    }
  }

  async getMarketById(conditionId: string): Promise<any> {
    try {
      const response = await fetch(
        `${this.config.gammaApiHost}/markets?id=${conditionId}`
      );
      if (!response.ok) throw new Error(`Gamma API error: ${response.status}`);
      const data = (await response.json()) as any[];
      return data[0] || null;
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to fetch market ${conditionId}: ${err.message}`);
      return null;
    }
  }

  // ── Reward Discovery ──────────────────────────

  async getSponsoredRewards(): Promise<RewardConfig[]> {
    try {
      const response = await fetch(
        `${this.config.clobApiHost}/rewards/markets/current`
      );
      if (!response.ok) throw new Error(`Rewards API error: ${response.status}`);
      const rawData = await response.json() as any;

      // API returns { data: [...] } wrapper
      const dataArray = Array.isArray(rawData) ? rawData : (rawData?.data || []);

      // Filter for markets with meaningful reward pools
      const rewards: RewardConfig[] = [];
      for (const item of dataArray) {
        // total_daily_rate includes both native + sponsored rewards
        const daily = parseFloat(item.total_daily_rate || item.native_daily_rate || '0');
        if (daily >= this.config.minRewardPool) {
          // Extract end date from rewards_config array
          let endDate = '';
          let startDate = '';
          if (item.rewards_config && Array.isArray(item.rewards_config) && item.rewards_config.length > 0) {
            endDate = item.rewards_config[0].end_date || '';
            startDate = item.rewards_config[0].start_date || '';
          }

          rewards.push({
            conditionId: item.condition_id || item.conditionId,
            rewardsDaily: daily,
            startDate,
            endDate,
            sponsored: daily > (parseFloat(item.native_daily_rate || '0')),
          });
        }
      }

      logger.info(COMPONENT, `Found ${rewards.length} sponsored markets with daily rewards >= $${this.config.minRewardPool}`);
      return rewards;
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to fetch sponsored rewards: ${err.message}`);
      return [];
    }
  }

  async getUserRewardPercentages(): Promise<Record<string, number>> {
    try {
      const response = await fetch(
        `${this.config.clobApiHost}/rewards/user/percentages`,
        {
          headers: this.getAuthHeaders(),
        }
      );
      if (!response.ok) return {};
      return (await response.json()) as Record<string, number>;
    } catch {
      return {};
    }
  }

  // ── Order Book ────────────────────────────────

  async getOrderBook(tokenId: string): Promise<OrderBook | null> {
    try {
      const book = await this.client.getOrderBook(tokenId);
      return book as any;
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to fetch order book for ${tokenId}: ${err.message}`);
      return null;
    }
  }

  getMidpoint(book: OrderBook): MidpointInfo | null {
    if (!book.bids.length || !book.asks.length) return null;

    const bestBid = parseFloat(book.bids[0].price);
    const bestAsk = parseFloat(book.asks[0].price);
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;

    return { mid, bestBid, bestAsk, spread };
  }

  async getMidpointPrice(tokenId: string): Promise<number | null> {
    try {
      const midpoint = await this.client.getMidpoint(tokenId);
      return typeof midpoint === 'number' ? midpoint : parseFloat(midpoint as any);
    } catch {
      return null;
    }
  }

  // ── Order Management ──────────────────────────

  async placeLimitOrder(
    tokenId: string,
    price: number,
    size: number,
    side: 'BUY' | 'SELL',
    negRisk: boolean = false
  ): Promise<string | null> {
    if (this.config.dryRun) {
      const fakeId = `dry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      logger.info(COMPONENT, `[DRY RUN] Would place ${side} order: ${size} @ $${price.toFixed(4)} → ${fakeId}`);
      return fakeId;
    }

    try {
      // Round price to nearest tick (0.01)
      const roundedPrice = Math.round(price * 100) / 100;
      
      // Clamp price between 0.01 and 0.99
      const clampedPrice = Math.max(0.01, Math.min(0.99, roundedPrice));

      const sideEnum = side === 'BUY' ? 0 : 1; // BUY=0, SELL=1 in the SDK
      
      const order = await this.client.createAndPostOrder({
        tokenID: tokenId,
        price: clampedPrice,
        size: size,
        side: sideEnum as any,
      }, {
        tickSize: '0.01',
        negRisk: negRisk,
      });

      const orderId = (order as any)?.orderID || (order as any)?.id || 'unknown';
      logger.debug(COMPONENT, `Placed ${side} order: ${size} @ $${clampedPrice.toFixed(2)} → ${orderId}`);
      return orderId;
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to place ${side} order: ${err.message}`);
      return null;
    }
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    if (this.config.dryRun) {
      logger.info(COMPONENT, `[DRY RUN] Would cancel order: ${orderId}`);
      return true;
    }

    try {
      await this.client.cancelOrder({ orderID: orderId } as any);
      logger.debug(COMPONENT, `Cancelled order: ${orderId}`);
      return true;
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to cancel order ${orderId}: ${err.message}`);
      return false;
    }
  }

  async cancelAllOrders(): Promise<boolean> {
    if (this.config.dryRun) {
      logger.info(COMPONENT, `[DRY RUN] Would cancel all orders`);
      return true;
    }

    try {
      await this.client.cancelAll();
      logger.info(COMPONENT, '🛑 Cancelled ALL orders');
      return true;
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to cancel all orders: ${err.message}`);
      return false;
    }
  }

  async getOpenOrders(): Promise<any[]> {
    try {
      const orders = await this.client.getOpenOrders();
      return Array.isArray(orders) ? orders : [];
    } catch (err: any) {
      logger.error(COMPONENT, `Failed to fetch open orders: ${err.message}`);
      return [];
    }
  }

  // ── Positions ─────────────────────────────────

  async getPositions(): Promise<any[]> {
    try {
      // The data API provides position info
      const response = await fetch(
        `https://data-api.polymarket.com/positions?user=${this.wallet.address}`,
      );
      if (!response.ok) return [];
      return (await response.json()) as any[];
    } catch {
      return [];
    }
  }

  // ── Helpers ───────────────────────────────────

  getWalletAddress(): string {
    return this.wallet.address;
  }

  getWebSocketUrl(): string {
    return 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.apiCreds) return {};
    return {
      'POLY_API_KEY': this.apiCreds.apiKey || '',
      'POLY_SECRET': this.apiCreds.secret || '',
      'POLY_PASSPHRASE': this.apiCreds.passphrase || '',
    };
  }
}
