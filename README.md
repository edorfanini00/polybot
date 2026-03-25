# Polybot

Automated liquidity reward farming & market making engine for [Polymarket](https://polymarket.com).

Polybot discovers the highest-paying sponsored reward markets, places two-sided limit orders near the midpoint, and captures both the bid-ask spread and daily liquidity rewards — 24/7, fully automated.

## How It Works

1. **Market Discovery** — Scans 500+ sponsored markets via the Gamma & Rewards APIs and ranks them by daily reward pool and estimated APR.
2. **Two-Sided Quoting** — Places matching BUY and SELL limit orders at a configurable spread from the midpoint, earning the spread on every fill.
3. **Reward Farming** — Sponsored markets pay daily USDC rewards to liquidity providers. Polybot ensures orders stay live and eligible.
4. **Risk Management** — Position limits, inventory skew control, daily P&L limits, fill cooldowns, and a remote kill switch.
5. **Web Dashboard** — Monitor P&L, active markets, and toggle the kill switch from your browser.

## Quick Start

```bash
# Clone
git clone https://github.com/edorfanini00/polybot.git && cd polybot

# Install
npm install

# Configure
cp .env.example .env
# Edit .env with your private key and settings

# Preview dashboard (no wallet needed)
npm run dashboard

# Run bot (dry run)
DRY_RUN=true npm run dev

# Run bot (live)
npm run dev
```

## Dashboard

Run `npm run dashboard` and open **http://localhost:3000**.

The dashboard shows real-time stats including Daily & All-Time P&L, active markets with reward pools and midpoint prices, inventory skew visualization, and a remote kill switch.

## Scripts

| Command | Description |
|---|---|
| `npm run dashboard` | Preview dashboard standalone |
| `npm run dev` | Start the full bot + dashboard |
| `npm run test:connection` | Verify Polymarket API connectivity |
| `npm run test:discovery` | Scan and rank reward markets |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled build |

## Configuration

All settings live in `.env`. See `.env.example` for the full list.

| Variable | Default | Description |
|---|---|---|
| `PRIVATE_KEY` | — | Ethereum private key (required) |
| `DRY_RUN` | `false` | Simulate without placing real orders |
| `MAX_MARKETS` | `5` | Number of markets to farm simultaneously |
| `CAPITAL_PER_MARKET` | `500` | USDC allocated per market |
| `ORDER_SIZE` | `50` | Size of each limit order |
| `SPREAD_FROM_MIDPOINT` | `0.02` | Spread from midpoint (2¢) |
| `MIN_REWARD_POOL` | `50` | Minimum daily reward pool to qualify |
| `DAILY_LOSS_LIMIT` | `-50` | Kill switch trigger threshold |

## Architecture

```
src/
├── index.ts              # Main orchestrator & strategy loop
├── client.ts             # Polymarket CLOB API wrapper
├── market-discovery.ts   # Finds & ranks sponsored markets
├── strategy.ts           # Two-sided order placement engine
├── risk-manager.ts       # Position limits, kill switch, P&L
├── websocket.ts          # Real-time price feed
├── monitor.ts            # Terminal dashboard & alerts
├── server.ts             # Express API for web dashboard
├── serve-dashboard.ts    # Standalone dashboard server
├── config.ts             # Environment variable loader
├── logger.ts             # Color-coded logging
└── types.ts              # TypeScript interfaces
public/
└── index.html            # React dashboard (standalone)
```

## Tech Stack

- **Runtime**: Node.js 22+, TypeScript 5.6
- **Trading**: `@polymarket/clob-client`, `ethers` v6
- **APIs**: Polymarket CLOB, Gamma, Rewards
- **Dashboard**: Express, React (Babel standalone)

## Risk Disclaimer

This software is provided as-is. Trading on prediction markets involves risk of loss. Always start with `DRY_RUN=true` and small capital. Never risk more than you can afford to lose.

## License

MIT
