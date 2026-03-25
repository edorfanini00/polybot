// ============================================
// WebSocket Client for Real-Time Market Data
// ============================================
// Subscribes to price updates for active markets
// and triggers strategy re-evaluation on changes.

import WebSocket from 'ws';
import { BotConfig } from './types';
import { logger } from './logger';

const COMPONENT = 'WebSocket';

export type PriceUpdateHandler = (conditionId: string, newMid: number) => void;
export type FillHandler = (data: any) => void;

export class PolymarketWebSocket {
  private config: BotConfig;
  private ws: WebSocket | null = null;
  private subscribedAssets: Set<string> = new Set();
  private onPriceUpdate: PriceUpdateHandler | null = null;
  private onFill: FillHandler | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 10;
  private reconnectDelay: number = 5000;
  private isClosing: boolean = false;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(config: BotConfig) {
    this.config = config;
  }

  /**
   * Set up event handlers.
   */
  onPriceChange(handler: PriceUpdateHandler): void {
    this.onPriceUpdate = handler;
  }

  onOrderFill(handler: FillHandler): void {
    this.onFill = handler;
  }

  /**
   * Connect to Polymarket WebSocket.
   */
  async connect(): Promise<void> {
    const wsUrl = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
    logger.info(COMPONENT, `Connecting to ${wsUrl}...`);

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.on('open', () => {
        logger.info(COMPONENT, '✅ WebSocket connected');
        this.reconnectAttempts = 0;

        // Start ping to keep alive
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 30000);

        // Re-subscribe to any previously subscribed assets
        for (const assetId of this.subscribedAssets) {
          this.sendSubscription(assetId);
        }

        resolve();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        logger.warn(COMPONENT, `WebSocket closed: ${code} ${reason.toString()}`);
        this.clearPing();
        if (!this.isClosing) {
          this.reconnect();
        }
      });

      this.ws.on('error', (err: Error) => {
        logger.error(COMPONENT, `WebSocket error: ${err.message}`);
        if (this.reconnectAttempts === 0) {
          // Only reject on initial connection
          reject(err);
        }
      });

      this.ws.on('pong', () => {
        logger.debug(COMPONENT, 'Pong received');
      });
    });
  }

  /**
   * Subscribe to price updates for a specific token/asset.
   */
  subscribe(assetId: string): void {
    this.subscribedAssets.add(assetId);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscription(assetId);
    }
  }

  /**
   * Subscribe to multiple assets.
   */
  subscribeAll(assetIds: string[]): void {
    for (const id of assetIds) {
      this.subscribe(id);
    }
  }

  /**
   * Disconnect gracefully.
   */
  disconnect(): void {
    this.isClosing = true;
    this.clearPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    logger.info(COMPONENT, 'WebSocket disconnected');
  }

  private sendSubscription(assetId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const msg = JSON.stringify({
      type: 'market',
      assets_id: assetId,
    });

    this.ws.send(msg);
    logger.debug(COMPONENT, `Subscribed to asset: ${assetId.slice(0, 12)}...`);
  }

  private handleMessage(raw: string): void {
    try {
      const data = JSON.parse(raw);

      // Handle different message types
      if (data.type === 'price_change' || data.event_type === 'price_change') {
        const assetId = data.asset_id || data.market;
        const price = parseFloat(data.price || data.mid || '0');
        
        if (assetId && price > 0 && this.onPriceUpdate) {
          this.onPriceUpdate(assetId, price);
        }
      } else if (data.type === 'trade' || data.event_type === 'last_trade_price') {
        // Trade occurred — could indicate a fill
        if (this.onFill) {
          this.onFill(data);
        }
      } else if (data.type === 'book' || data.event_type === 'book') {
        // Order book update
        const assetId = data.asset_id || data.market;
        if (data.bids && data.asks && data.bids.length > 0 && data.asks.length > 0) {
          const bestBid = parseFloat(data.bids[0][0] || data.bids[0].price || '0');
          const bestAsk = parseFloat(data.asks[0][0] || data.asks[0].price || '0');
          const mid = (bestBid + bestAsk) / 2;
          
          if (assetId && mid > 0 && this.onPriceUpdate) {
            this.onPriceUpdate(assetId, mid);
          }
        }
      }
    } catch (err) {
      // Ignore parse errors for non-JSON messages
      logger.debug(COMPONENT, `Non-JSON message: ${raw.slice(0, 100)}`);
    }
  }

  private async reconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(COMPONENT, `Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;
    logger.info(COMPONENT, `Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    await new Promise(resolve => setTimeout(resolve, delay));

    try {
      await this.connect();
    } catch (err: any) {
      logger.error(COMPONENT, `Reconnect failed: ${err.message}`);
      this.reconnect();
    }
  }

  private clearPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }
}
