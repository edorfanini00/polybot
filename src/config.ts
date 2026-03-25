// ============================================
// Configuration loader with validation
// ============================================

import 'dotenv/config';
import { BotConfig, LogLevel } from './types';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value || value === '' || value.includes('your_')) {
    throw new Error(`Missing required environment variable: ${key}. Copy .env.example to .env and fill in your values.`);
  }
  return value;
}

function optionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function numEnv(key: string, defaultValue: number): number {
  const val = process.env[key];
  if (!val) return defaultValue;
  const parsed = parseFloat(val);
  if (isNaN(parsed)) throw new Error(`Environment variable ${key} must be a number, got: ${val}`);
  return parsed;
}

function boolEnv(key: string, defaultValue: boolean): boolean {
  const val = process.env[key];
  if (!val) return defaultValue;
  return val.toLowerCase() === 'true' || val === '1';
}

export function loadConfig(): BotConfig {
  const config: BotConfig = {
    // API
    privateKey: requireEnv('PRIVATE_KEY'),
    clobApiHost: optionalEnv('CLOB_API_HOST', 'https://clob.polymarket.com'),
    gammaApiHost: optionalEnv('GAMMA_API_HOST', 'https://gamma-api.polymarket.com'),
    chainId: numEnv('CHAIN_ID', 137),

    // Strategy
    maxMarkets: numEnv('MAX_MARKETS', 5),
    capitalPerMarket: numEnv('CAPITAL_PER_MARKET', 500),
    spreadFromMidpoint: numEnv('SPREAD_FROM_MIDPOINT', 0.02),
    orderSize: numEnv('ORDER_SIZE', 50),
    minRewardPool: numEnv('MIN_REWARD_POOL', 50),

    // Risk
    maxInventoryPerMarket: numEnv('MAX_INVENTORY_PER_MARKET', 500),
    maxTotalExposure: numEnv('MAX_TOTAL_EXPOSURE', 5000),
    dailyLossLimit: numEnv('DAILY_LOSS_LIMIT', -100),
    fillCooldownMs: numEnv('FILL_COOLDOWN_MS', 5000),

    // Monitoring
    discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || undefined,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramChatId: process.env.TELEGRAM_CHAT_ID || undefined,
    dryRun: boolEnv('DRY_RUN', false),
    logLevel: (optionalEnv('LOG_LEVEL', 'info') as LogLevel),
  };

  // Validate
  if (config.spreadFromMidpoint < 0.005 || config.spreadFromMidpoint > 0.1) {
    throw new Error(`SPREAD_FROM_MIDPOINT must be between 0.005 and 0.1, got: ${config.spreadFromMidpoint}`);
  }
  if (config.orderSize < 1) {
    throw new Error(`ORDER_SIZE must be at least 1 USDC, got: ${config.orderSize}`);
  }
  if (config.capitalPerMarket < config.orderSize * 2) {
    throw new Error(`CAPITAL_PER_MARKET (${config.capitalPerMarket}) must be at least 2x ORDER_SIZE (${config.orderSize})`);
  }

  return config;
}
