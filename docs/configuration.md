# Configuration Reference

All configuration is managed through environment variables in the `.env` file.

## Required

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Ethereum private key for signing transactions. Must have USDC on Polygon. |

## API Endpoints

| Variable | Default | Description |
|---|---|---|
| `CLOB_API_HOST` | `https://clob.polymarket.com` | Polymarket CLOB API base URL |
| `GAMMA_API_HOST` | `https://gamma-api.polymarket.com` | Gamma market data API |
| `DATA_API_HOST` | `https://data-api.polymarket.com` | Polymarket data API |
| `WS_URL` | `wss://ws-subscriptions-clob.polymarket.com/ws/market` | WebSocket endpoint |
| `CHAIN_ID` | `137` | Polygon chain ID |

## Strategy Parameters

| Variable | Default | Description |
|---|---|---|
| `MAX_MARKETS` | `5` | Maximum number of markets to farm simultaneously |
| `CAPITAL_PER_MARKET` | `500` | USDC to allocate per market |
| `ORDER_SIZE` | `50` | Size of each individual limit order in USDC |
| `SPREAD_FROM_MIDPOINT` | `0.02` | Distance from midpoint for order placement (0.02 = 2¢) |
| `MIN_REWARD_POOL` | `50` | Minimum daily reward pool (USD) for a market to qualify |
| `TICK_INTERVAL_MS` | `15000` | How often the strategy loop runs (milliseconds) |
| `REDISCOVERY_INTERVAL_MS` | `3600000` | How often to re-scan for better markets (1 hour) |

## Risk Management

| Variable | Default | Description |
|---|---|---|
| `DAILY_LOSS_LIMIT` | `-50` | Daily P&L threshold that triggers the kill switch (negative number) |
| `MAX_INVENTORY_PER_MARKET` | `200` | Maximum shares of inventory per market before stopping orders on that side |
| `MAX_TOTAL_EXPOSURE` | `5000` | Maximum total capital at risk across all markets |
| `FILL_COOLDOWN_MS` | `2000` | Minimum time between fills before placing new orders |

## Operational

| Variable | Default | Description |
|---|---|---|
| `DRY_RUN` | `false` | Simulate order placement without real transactions |
| `LOG_LEVEL` | `info` | Logging verbosity: `debug`, `info`, `warn`, `error` |
| `DASHBOARD_PORT` | `3000` | Port for the web dashboard |

## Alerts (Optional)

| Variable | Default | Description |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | — | Discord webhook for alerts |
| `TELEGRAM_BOT_TOKEN` | — | Telegram bot token |
| `TELEGRAM_CHAT_ID` | — | Telegram chat ID for alerts |

## Example Configuration

```env
# === Core ===
PRIVATE_KEY=0x...

# === Strategy (conservative) ===
MAX_MARKETS=3
CAPITAL_PER_MARKET=200
ORDER_SIZE=25
SPREAD_FROM_MIDPOINT=0.02
MIN_REWARD_POOL=50

# === Risk ===
DAILY_LOSS_LIMIT=-25
MAX_INVENTORY_PER_MARKET=100

# === Mode ===
DRY_RUN=true
LOG_LEVEL=info
```
