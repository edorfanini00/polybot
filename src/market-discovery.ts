// ============================================
// Market Discovery Engine
// ============================================
// Finds the best sponsored markets to farm,
// ranks them by estimated APR, and selects
// which ones to allocate capital to.

import { PolymarketClient } from './client';
import { BotConfig, Market, MarketToken, RewardConfig, MidpointInfo } from './types';
import { logger } from './logger';

const COMPONENT = 'Discovery';

export interface RankedMarket {
  market: Market;
  rewardConfig: RewardConfig;
  midpoint: MidpointInfo | null;
  estimatedDailyReward: number;
  estimatedApr: number;
  competitionScore: number; // lower = less competition = better
  score: number;            // composite ranking score
}

export class MarketDiscovery {
  private client: PolymarketClient;
  private config: BotConfig;

  constructor(client: PolymarketClient, config: BotConfig) {
    this.client = client;
    this.config = config;
  }

  /**
   * Discover and rank the best markets for reward farming.
   * Returns up to config.maxMarkets sorted by composite score.
   */
  async discoverBestMarkets(): Promise<RankedMarket[]> {
    logger.info(COMPONENT, '🔍 Scanning for profitable sponsored markets...');

    // Step 1: Get all sponsored reward configs
    const rewards = await this.client.getSponsoredRewards();
    if (rewards.length === 0) {
      logger.warn(COMPONENT, 'No sponsored reward markets found. Consider lowering MIN_REWARD_POOL.');
      return [];
    }

    logger.info(COMPONENT, `Found ${rewards.length} sponsored markets to analyze`);

    // Step 2: Enrich each reward market with market data and order book info
    const rankedMarkets: RankedMarket[] = [];

    for (const reward of rewards) {
      try {
        // Fetch market details from Gamma API
        const marketData = await this.client.getMarketById(reward.conditionId);
        if (!marketData || marketData.closed || !marketData.active) {
          continue;
        }

        // Parse tokens
        const tokens = this.parseTokens(marketData);
        if (tokens.length < 2) continue;

        const market: Market = {
          conditionId: reward.conditionId,
          questionId: marketData.question_id || marketData.questionId || '',
          question: marketData.question || 'Unknown Market',
          slug: marketData.slug || '',
          active: true,
          closed: false,
          negRisk: Boolean(marketData.neg_risk ?? marketData.negRisk),
          tokens,
          rewardPool: reward.rewardsDaily,
          tags: marketData.tags || [],
          endDate: marketData.end_date_iso || reward.endDate,
        };

        // Get order book for the YES token to assess competition
        const yesToken = tokens.find(t => t.outcome === 'Yes') || tokens[0];
        const book = await this.client.getOrderBook(yesToken.tokenId);
        const midpoint = book ? this.client.getMidpoint(book) : null;

        // Calculate competition score (total depth near midpoint)
        const competitionScore = this.calculateCompetition(book, midpoint);

        // Estimate our share of daily rewards
        const estimatedDailyReward = this.estimateDailyReward(
          reward.rewardsDaily,
          competitionScore,
          this.config.capitalPerMarket
        );

        // Calculate APR
        const estimatedApr = (estimatedDailyReward / this.config.capitalPerMarket) * 365 * 100;

        // Composite score: high reward, low competition
        const score = estimatedDailyReward * 100 - competitionScore * 0.1;

        rankedMarkets.push({
          market,
          rewardConfig: reward,
          midpoint,
          estimatedDailyReward,
          estimatedApr,
          competitionScore,
          score,
        });

        // Small delay to avoid rate limiting
        await sleep(200);
      } catch (err: any) {
        logger.debug(COMPONENT, `Skipping market ${reward.conditionId}: ${err.message}`);
      }
    }

    // Step 3: Sort by score (highest first) and take top N
    rankedMarkets.sort((a, b) => b.score - a.score);
    const selected = rankedMarkets.slice(0, this.config.maxMarkets);

    // Log results
    logger.info(COMPONENT, `\n📊 Top ${selected.length} markets for reward farming:\n`);
    for (let i = 0; i < selected.length; i++) {
      const m = selected[i];
      logger.info(COMPONENT, `  #${i + 1}: ${m.market.question.slice(0, 60)}...`);
      logger.table({
        '    Daily Reward Pool': `$${m.rewardConfig.rewardsDaily.toFixed(2)}`,
        '    Est. Our Daily':    `$${m.estimatedDailyReward.toFixed(2)}`,
        '    Est. APR':          `${m.estimatedApr.toFixed(1)}%`,
        '    Competition':       m.competitionScore.toFixed(0),
        '    Midpoint':          m.midpoint ? `$${m.midpoint.mid.toFixed(3)} (spread: ${(m.midpoint.spread * 100).toFixed(1)}¢)` : 'N/A',
      });
      logger.separator();
    }

    return selected;
  }

  /**
   * Calculate competition score based on order book depth near midpoint.
   * Higher score = more competing liquidity = smaller share of rewards.
   */
  private calculateCompetition(book: any, midpoint: MidpointInfo | null): number {
    if (!book || !midpoint) return 100;

    let totalNearMid = 0;
    const threshold = 0.05; // Count depth within 5 cents of midpoint

    for (const bid of (book.bids || [])) {
      const price = parseFloat(bid.price);
      const size = parseFloat(bid.size);
      if (Math.abs(price - midpoint.mid) <= threshold) {
        totalNearMid += size;
      }
    }

    for (const ask of (book.asks || [])) {
      const price = parseFloat(ask.price);
      const size = parseFloat(ask.size);
      if (Math.abs(price - midpoint.mid) <= threshold) {
        totalNearMid += size;
      }
    }

    return totalNearMid;
  }

  /**
   * Estimate our share of daily rewards based on:
   * - Total reward pool size
   * - Existing competition (depth near midpoint)
   * - Our capital allocation
   * 
   * Uses a simplified model of Polymarket's quadratic scoring.
   */
  private estimateDailyReward(
    dailyPool: number,
    competition: number,
    ourCapital: number
  ): number {
    // Our effective depth (both sides, so multiply by 2)
    const ourDepth = ourCapital * 2;

    // Total depth including us
    const totalDepth = competition + ourDepth;

    if (totalDepth === 0) return dailyPool;

    // Our share = our depth / total depth
    // Apply a discount factor because we won't be perfectly positioned
    const positioningDiscount = 0.6; // We capture ~60% of theoretical max

    // Two-sided bonus (3x for quoting both sides)
    const twoSidedMultiplier = 1.5; // We'll get some of the 3x bonus

    const ourShare = (ourDepth / totalDepth) * dailyPool * positioningDiscount * twoSidedMultiplier;

    return Math.max(0, ourShare);
  }

  private parseTokens(marketData: any): MarketToken[] {
    const tokens: MarketToken[] = [];

    // Handle different API response formats
    if (marketData.tokens && Array.isArray(marketData.tokens)) {
      for (const t of marketData.tokens) {
        tokens.push({
          tokenId: t.token_id || t.tokenId || '',
          outcome: t.outcome || 'Unknown',
          price: parseFloat(t.price || '0.5'),
        });
      }
    } else if (marketData.clobTokenIds) {
      // Alternative format with separate token IDs
      const ids = typeof marketData.clobTokenIds === 'string'
        ? JSON.parse(marketData.clobTokenIds)
        : marketData.clobTokenIds;

      if (Array.isArray(ids) && ids.length >= 2) {
        tokens.push({ tokenId: ids[0], outcome: 'Yes', price: 0.5 });
        tokens.push({ tokenId: ids[1], outcome: 'No', price: 0.5 });
      }
    }

    return tokens;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
