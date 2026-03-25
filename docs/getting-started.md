# Getting Started

Complete setup guide for running Polybot on your machine.

## Prerequisites

- **Node.js 22+** — [Download](https://nodejs.org/)
- **A Polymarket-compatible wallet** — You need an Ethereum private key with USDC on Polygon
- **USDC on Polygon** — Start with $50–100 for testing

## Installation

```bash
git clone https://github.com/edorfanini00/polybot.git
cd polybot
npm install
```

## Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` and set your private key:

```env
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE
```

> **Security**: Never commit your `.env` file. It's already in `.gitignore`.

## Verifying Your Setup

### 1. Test API Connectivity

Confirms the Polymarket CLOB, Gamma, and Rewards APIs are reachable:

```bash
npm run test:connection
```

Expected output:
```
✅ Gamma API: OK (fetched X events)
✅ CLOB API: OK (server time: ...)
✅ Rewards API: OK (X reward markets found)
```

### 2. Preview the Dashboard

Start the standalone dashboard without needing a wallet:

```bash
npm run dashboard
```

Open **http://localhost:3000** in your browser. You'll see demo data and live reward market info from Polymarket.

### 3. Scan Reward Markets

Find the best markets to farm:

```bash
npm run test:discovery
```

This queries the Rewards API and ranks all sponsored markets by estimated APR.

## First Run

### Dry Run (Recommended)

Run the bot without placing real orders to verify everything works:

```bash
DRY_RUN=true npm run dev
```

The bot will:
- Load your config
- Initialize the Polymarket client
- Discover the best reward markets
- Simulate order placement
- Start the web dashboard on port 3000

### Live Trading

Once you're comfortable with the dry run:

```bash
npm run dev
```

> **Start small.** Use `CAPITAL_PER_MARKET=100` and `MAX_MARKETS=2` initially.

## Stopping the Bot

Press `Ctrl+C`. The bot will:
1. Cancel all open orders
2. Disconnect the WebSocket
3. Print a final P&L summary
4. Exit cleanly

## Troubleshooting

| Problem | Solution |
|---|---|
| `PRIVATE_KEY is required` | Set `PRIVATE_KEY` in your `.env` file |
| `No profitable markets found` | Lower `MIN_REWARD_POOL` or increase `MAX_MARKETS` |
| `WebSocket connection failed` | Non-fatal. Bot falls back to polling. |
| Dashboard shows "Connection Error" | Wait 5–10 seconds for the server to initialize, then refresh |
