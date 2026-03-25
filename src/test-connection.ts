// ============================================
// Test Script — API Connection Check
// ============================================
// Verifies that we can connect to Polymarket
// APIs and fetch market data.

import 'dotenv/config';
import { logger, setLogLevel } from './logger';

const COMPONENT = 'Test';

async function testConnection(): Promise<void> {
  logger.banner('POLYMARKET CONNECTION TEST');
  setLogLevel('debug');

  // Test 1: Gamma API (public, no auth needed)
  logger.info(COMPONENT, '1️⃣ Testing Gamma API (market discovery)...');
  try {
    const response = await fetch('https://gamma-api.polymarket.com/markets?limit=3&active=true&closed=false');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const markets = (await response.json()) as any[];
    
    logger.info(COMPONENT, `✅ Gamma API: Found ${markets.length} markets`);
    for (const m of markets.slice(0, 3)) {
      logger.info(COMPONENT, `   → ${m.question?.slice(0, 60) || 'Unknown market'}...`);
    }
  } catch (err: any) {
    logger.error(COMPONENT, `❌ Gamma API failed: ${err.message}`);
  }

  // Test 2: CLOB API (public endpoints)
  logger.separator();
  logger.info(COMPONENT, '2️⃣ Testing CLOB API (order book)...');
  try {
    const response = await fetch('https://clob.polymarket.com/time');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const time = (await response.json()) as any;
    logger.info(COMPONENT, `✅ CLOB API: Server time = ${JSON.stringify(time)}`);
  } catch (err: any) {
    logger.error(COMPONENT, `❌ CLOB API failed: ${err.message}`);
  }

  // Test 3: Rewards API
  logger.separator();
  logger.info(COMPONENT, '3️⃣ Testing Rewards API (sponsored markets)...');
  try {
    const response = await fetch('https://clob.polymarket.com/rewards/markets/current');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rawRewards = (await response.json()) as any;
    
    const rewardList = Array.isArray(rawRewards) ? rawRewards : (rawRewards?.data || []);
    logger.info(COMPONENT, `✅ Rewards API: Found ${rewardList.length} reward configurations`);
    
    // Show top 5 by reward pool
    const sorted = rewardList
      .map((r: any) => ({
        id: r.condition_id || r.conditionId || 'unknown',
        daily: parseFloat(r.total_daily_rate || r.native_daily_rate || '0'),
      }))
      .filter((r: any) => r.daily > 0)
      .sort((a: any, b: any) => b.daily - a.daily)
      .slice(0, 5);

    for (const r of sorted) {
      logger.info(COMPONENT, `   → $${r.daily.toFixed(2)}/day | Market: ${r.id.slice(0, 20)}...`);
    }
  } catch (err: any) {
    logger.error(COMPONENT, `❌ Rewards API failed: ${err.message}`);
  }

  // Test 4: Check if private key is configured
  logger.separator();
  logger.info(COMPONENT, '4️⃣ Checking wallet configuration...');
  const pk = process.env.PRIVATE_KEY;
  if (!pk || pk.includes('your_')) {
    logger.warn(COMPONENT, '⚠️ No private key configured in .env');
    logger.info(COMPONENT, '   Copy .env.example to .env and add your private key to enable trading');
  } else {
    try {
      const { ethers } = await import('ethers');
      const wallet = new ethers.Wallet(pk);
      logger.info(COMPONENT, `✅ Wallet configured: ${wallet.address}`);
    } catch (err: any) {
      logger.error(COMPONENT, `❌ Invalid private key: ${err.message}`);
    }
  }

  logger.separator();
  logger.info(COMPONENT, '🏁 Connection test complete!');
}

testConnection().catch(console.error);
