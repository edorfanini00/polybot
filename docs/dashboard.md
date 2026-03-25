# Dashboard Guide

Polybot includes a real-time web dashboard for monitoring performance and controlling the bot.

## Starting the Dashboard

### Standalone Mode (No Wallet Required)

Preview the dashboard with demo data and live Polymarket reward data:

```bash
npm run dashboard
```

### With the Bot

When running the full bot, the dashboard starts automatically:

```bash
npm run dev
```

Both modes serve the dashboard at **http://localhost:3000**.

## Features

### Stats Overview

Five metric cards at the top of the dashboard:

| Metric | Description |
|---|---|
| **Daily P&L** | Profit/loss for the current day. Resets at midnight. |
| **All-Time P&L** | Cumulative profit/loss since the bot started. |
| **Active Markets** | Number of markets currently being farmed. |
| **Capital Deployed** | Total USDC allocated across all markets. |
| **Uptime** | How long the bot has been running, plus live order and fill counts. |

### Risk Manager / Kill Switch

The kill switch panel shows the current state of the risk manager:

- **Green shield** — System active. Orders are being placed normally.
- **Red shield** — Kill switch engaged. All orders cancelled, no new orders placed.

Click **Engage Kill Switch** to immediately cancel all orders and halt trading. Click **Resume Trading** to re-enable.

The kill switch also triggers automatically when:
- Daily P&L exceeds the configured loss limit
- An unrecoverable error occurs

### Market Cards

Each active market shows:

- **Market question** — The prediction being traded
- **Status badge** — Active or Paused
- **Reward Pool** — Daily USDC reward pool for this market
- **Midpoint** — Current midpoint price (probability)
- **Inventory Skew** — Visual bar showing position balance (Long NO ↔ Long YES)
- **Live Orders** — Number of open orders
- **Spread** — Current spread being quoted

### Auto-Refresh

The dashboard polls the API every 3 seconds. No manual refresh needed.

## REST API

The dashboard communicates with the bot via these endpoints:

### `GET /api/status`

Returns global bot metrics.

```json
{
  "uptime": 3600000,
  "isDryRun": true,
  "activeMarkets": 3,
  "liveOrders": 6,
  "capitalDeployed": "$1,500",
  "dailyPnl": 12.47,
  "allTimePnl": 145.22,
  "killSwitchActive": false,
  "fillsToday": 14
}
```

### `GET /api/markets`

Returns detailed data for each active market.

```json
[
  {
    "id": "0x...",
    "question": "Will Bitcoin exceed $150,000 by end of 2026?",
    "rewardPool": 164.25,
    "capital": 500,
    "midpoint": 0.623,
    "spread": 0.02,
    "paused": false,
    "inventorySkew": 0.15,
    "netInventory": 3,
    "liveOrders": [
      { "side": "BUY", "outcome": "Yes", "price": 0.613, "size": 50 }
    ],
    "fills": []
  }
]
```

### `POST /api/kill-switch`

Toggle the kill switch.

```json
// Request
{ "activate": true }

// Response
{ "success": true, "status": "activated" }
```
