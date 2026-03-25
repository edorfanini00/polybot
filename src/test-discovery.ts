// ============================================
// Test Script — Market Discovery
// ============================================
// Discovers sponsored markets and shows the
// best opportunities without placing orders.

import 'dotenv/config';
import { logger, setLogLevel } from './logger';

const COMPONENT = 'Discovery Test';

async function testDiscovery(): Promise<void> {
  logger.banner('MARKET DISCOVERY TEST');
  setLogLevel('info');

  const minRewardPool = parseFloat(process.env.MIN_REWARD_POOL || '10');
  const capitalPerMarket = parseFloat(process.env.CAPITAL_PER_MARKET || '500');

  // Step 1: Fetch rewards
  logger.info(COMPONENT, '1️⃣ Fetching sponsored reward markets...');
  const rewardsResponse = await fetch('https://clob.polymarket.com/rewards/markets/current');
  if (!rewardsResponse.ok) {
    logger.error(COMPONENT, `Failed to fetch rewards: HTTP ${rewardsResponse.status}`);
    return;
  }

  const rewards = await rewardsResponse.json();
  const rewardList = Array.isArray(rewards) ? rewards : [];
  
  const significantRewards = rewardList
    .map((r: any) => ({
      conditionId: r.condition_id || r.conditionId || '',
      daily: parseFloat(r.rewards_daily_rate || r.rewardsDaily || '0'),
      endDate: r.end_date || r.endDate || '',
    }))
    .filter((r: any) => r.daily >= minRewardPool)
    .sort((a: any, b: any) => b.daily - a.daily);

  logger.info(COMPONENT, `Found ${significantRewards.length} markets with daily rewards >= $${minRewardPool}`);

  // Step 2: Enrich with market details
  logger.separator();
  logger.info(COMPONENT, '2️⃣ Enriching with market details...\n');

  let count = 0;
  for (const reward of significantRewards.slice(0, 10)) {
    count++;
    try {
      // Fetch market metadata
      const marketResponse = await fetch(
        `https://gamma-api.polymarket.com/markets?id=${reward.conditionId}`
      );
      
      let question = 'Unknown market';
      let tokens: any[] = [];
      
      if (marketResponse.ok) {
        const marketData = await marketResponse.json();
        const market = Array.isArray(marketData) ? marketData[0] : marketData;
        if (market) {
          question = market.question || question;
          tokens = market.tokens || [];
          
          // Try to parse clobTokenIds if tokens array is empty
          if (tokens.length === 0 && market.clobTokenIds) {
            try {
              const ids = typeof market.clobTokenIds === 'string' 
                ? JSON.parse(market.clobTokenIds) 
                : market.clobTokenIds;
              if (Array.isArray(ids) && ids.length >= 2) {
                tokens = [
                  { token_id: ids[0], outcome: 'Yes', price: '0.5' },
                  { token_id: ids[1], outcome: 'No', price: '0.5' },
                ];
              }
            } catch {}
          }
        }
      }

      // Fetch order book for first token to estimate competition
      let competition = 'Unknown';
      let midpoint = 'N/A';
      
      if (tokens.length > 0) {
        const tokenId = tokens[0].token_id || tokens[0].tokenId || '';
        if (tokenId) {
          try {
            const bookResponse = await fetch(
              `https://clob.polymarket.com/book?token_id=${tokenId}`
            );
            if (bookResponse.ok) {
              const book = (await bookResponse.json()) as any;
              if (book.bids?.length > 0 && book.asks?.length > 0) {
                const bestBid = parseFloat(book.bids[0].price);
                const bestAsk = parseFloat(book.asks[0].price);
                const mid = (bestBid + bestAsk) / 2;
                midpoint = `$${mid.toFixed(3)}`;
                
                // Count depth near midpoint
                let nearMid = 0;
                for (const b of book.bids) {
                  if (Math.abs(parseFloat(b.price) - mid) <= 0.05) {
                    nearMid += parseFloat(b.size);
                  }
                }
                for (const a of book.asks) {
                  if (Math.abs(parseFloat(a.price) - mid) <= 0.05) {
                    nearMid += parseFloat(a.size);
                  }
                }
                competition = `${nearMid.toFixed(0)} shares`;
              }
            }
          } catch {}
        }
      }

      // Estimate our share
      const competitionNum = parseFloat(competition) || 1000;
      const ourDepth = capitalPerMarket * 2;
      const estShare = (ourDepth / (competitionNum + ourDepth)) * reward.daily * 0.6 * 1.5;
      const estApr = (estShare / capitalPerMarket) * 365 * 100;

      console.log(`  #${count} ${question.slice(0, 60)}...`);
      logger.table({
        '    Reward Pool':    `$${reward.daily.toFixed(2)}/day`,
        '    Midpoint':       midpoint,
        '    Competition':    competition,
        '    Est. Our Daily': `$${estShare.toFixed(2)}`,
        '    Est. APR':       `${estApr.toFixed(1)}%`,
        '    Ends':           reward.endDate || 'Unknown',
      });
      console.log('');

      // Rate limit
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      logger.error(COMPONENT, `Error enriching market ${reward.conditionId}: ${err.message}`);
    }
  }

  logger.separator();
  logger.info(COMPONENT, '🏁 Discovery test complete!');
  logger.info(COMPONENT, 'To start farming, set up your .env file and run: npm run dev');
}

testDiscovery().catch(console.error);
