// ============================================
// Configuration loader with validation
// ============================================

import 'dotenv/config';
import { getAddress, isAddress } from 'ethers';
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

/** CLOB order signature: null=AUTO, 0 EOA, 1 Magic proxy, 2 Gnosis Safe */
function clobSignatureTypeEnv(): number | null {
  const rawEnv = process.env.POLY_SIGNATURE_TYPE ?? process.env.CLOB_SIGNATURE_TYPE;
  if (rawEnv === undefined || rawEnv.trim() === '') return null;
  const raw = rawEnv.trim().toUpperCase();
  if (raw === 'AUTO') return null;
  if (raw === '0' || raw === 'EOA') return 0;
  if (raw === '1' || raw === 'POLY_PROXY' || raw === 'PROXY') return 1;
  if (raw === '2' || raw === 'POLY_GNOSIS_SAFE' || raw === 'GNOSIS' || raw === 'SAFE') return 2;
  const n = parseInt(raw, 10);
  if (n === 0 || n === 1 || n === 2) return n;
  throw new Error(
    `POLY_SIGNATURE_TYPE must be AUTO, 0/EOA, 1/POLY_PROXY, or 2/POLY_GNOSIS_SAFE, got: ${rawEnv}`
  );
}

function optionalAddressEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  if (!v) return undefined;
  if (!isAddress(v)) throw new Error(`${key} must be a valid Ethereum address, got: ${v}`);
  return getAddress(v);
}

export function loadConfig(): BotConfig {
  const sigType = clobSignatureTypeEnv();
  const config: BotConfig = {
    // API
    privateKey: requireEnv('PRIVATE_KEY'),
    clobApiHost: optionalEnv('CLOB_API_HOST', 'https://clob.polymarket.com'),
    gammaApiHost: optionalEnv('GAMMA_API_HOST', 'https://gamma-api.polymarket.com'),
    chainId: numEnv('CHAIN_ID', 137),
    clobSignatureType: sigType,
    funderAddress:
      sigType === null || sigType === 0 ? undefined : optionalAddressEnv('FUNDER_ADDRESS'),
    polygonRpcUrl: optionalEnv('POLYGON_RPC_URL', 'https://polygon-bor-rpc.publicnode.com').trim(),

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

  if (sigType === 1 || sigType === 2) {
    if (!config.funderAddress) {
      throw new Error(
        'FUNDER_ADDRESS is required when POLY_SIGNATURE_TYPE is 1 (POLY_PROXY) or 2 (POLY_GNOSIS_SAFE). Use the Polymarket profile / proxy wallet address that holds your balance.'
      );
    }
  }
  if (config.chainId !== 137 && sigType === null) {
    throw new Error('POLY_SIGNATURE_TYPE=AUTO (default) is only supported on Polygon mainnet (CHAIN_ID=137). Set POLY_SIGNATURE_TYPE explicitly for other chains.');
  }

  return config;
}
