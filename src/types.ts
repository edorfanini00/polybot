// ============================================
// Type Definitions for the Polymarket Bot
// ============================================

export interface BotConfig {
  // API
  privateKey: string;
  clobApiHost: string;
  gammaApiHost: string;
  chainId: number;

  // Strategy
  maxMarkets: number;
  capitalPerMarket: number;
  spreadFromMidpoint: number;
  orderSize: number;
  minRewardPool: number;

  // Risk
  maxInventoryPerMarket: number;
  maxTotalExposure: number;
  dailyLossLimit: number;
  fillCooldownMs: number;

  // Monitoring
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  dryRun: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface Market {
  conditionId: string;
  questionId: string;
  question: string;
  slug: string;
  active: boolean;
  closed: boolean;
  tokens: MarketToken[];
  rewardPool?: number;
  estimatedApr?: number;
  tags?: string[];
  endDate?: string;
}

export interface MarketToken {
  tokenId: string;
  outcome: string; // "Yes" or "No"
  price: number;
  winner?: boolean;
}

export interface OrderBookEntry {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  assetId: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  hash: string;
  timestamp: string;
}

export interface MidpointInfo {
  mid: number;
  bestBid: number;
  bestAsk: number;
  spread: number;
}

export interface ActiveOrder {
  orderId: string;
  marketConditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  sizeMatched: number;
  status: 'LIVE' | 'MATCHED' | 'CANCELLED';
  createdAt: number;
  outcome: string;
}

export interface Position {
  conditionId: string;
  tokenId: string;
  outcome: string;
  size: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnl: number;
}

export interface MarketAllocation {
  market: Market;
  yesTokenId: string;
  noTokenId: string;
  capitalAllocated: number;
  activeOrders: ActiveOrder[];
  positions: Position[];
  midpoint: MidpointInfo | null;
  lastOrderUpdate: number;
  paused: boolean;
}

export interface RewardConfig {
  conditionId: string;
  rewardsDaily: number;
  startDate: string;
  endDate: string;
  sponsored: boolean;
}

export interface FillEvent {
  orderId: string;
  marketConditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  timestamp: number;
  outcome: string;
}

export interface DailyPnL {
  date: string;
  realizedPnl: number;
  unrealizedPnl: number;
  rewardsEarned: number;
  totalPnl: number;
  fills: FillEvent[];
}

export interface BotStatus {
  running: boolean;
  startedAt: number;
  marketsActive: number;
  totalCapitalDeployed: number;
  totalOrdersActive: number;
  dailyPnl: number;
  totalRewardsEarned: number;
  lastUpdate: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
