# Strategy Guide

Deep dive into how Polybot makes money.

## Overview

Polybot runs a **liquidity reward farming + market making** strategy on Polymarket's CLOB (Central Limit Order Book). It earns from two sources:

1. **Liquidity Rewards** — Polymarket pays daily USDC rewards to users who provide liquidity on sponsored markets
2. **Spread Capture** — By placing orders on both sides of the midpoint, the bot earns the bid-ask spread every time both sides fill

## How Liquidity Rewards Work

Polymarket sponsors certain markets with daily reward pools (e.g., $164/day). These rewards are distributed pro-rata to all liquidity providers based on:

- **Order size** — Larger orders earn more
- **Proximity to midpoint** — Orders closer to the current price earn more
- **Time in book** — Orders that stay live longer earn more
- **Both sides** — Providing liquidity on both YES and NO earns more

Polybot optimizes for all four factors.

## Order Placement Logic

Each strategy tick (every 15 seconds by default):

```
1. Get current midpoint price for each market
2. Check risk manager approval
3. Cancel stale orders (price drifted too far)
4. Place new orders:
   - BUY YES at midpoint - spread
   - SELL YES at midpoint + spread
   - (Optionally) BUY NO / SELL NO for the complementary side
5. Apply inventory skew adjustment if position is imbalanced
```

### Spread Configuration

The `SPREAD_FROM_MIDPOINT` setting controls how far from the midpoint orders are placed:

| Spread | Risk | Reward |
|---|---|---|
| 1¢ (`0.01`) | Higher fill rate, more adverse selection | Maximum reward points |
| 2¢ (`0.02`) | Balanced (recommended) | Good reward points |
| 3¢ (`0.03`) | Fewer fills, less risk | Fewer reward points |
| 5¢+ (`0.05`) | Rarely fills | Minimal rewards |

## Inventory Management

When fills are one-sided (e.g., only BUY orders fill), the bot accumulates inventory. Polybot handles this by:

1. **Skew Detection** — Tracks net position per market (long YES vs long NO)
2. **Price Adjustment** — Shifts quotes away from the overweight side to encourage rebalancing fills
3. **Position Limits** — Stops placing orders on the overweight side when `MAX_INVENTORY_PER_MARKET` is reached

## Market Selection

Not all markets are worth farming. Polybot ranks markets by:

```
Score = Daily Reward Pool / Estimated Competition
```

Good markets have:
- Daily reward pool > $50
- Reasonable liquidity (not too thin, not too deep)
- Midpoint between 0.15 and 0.85 (extreme prices have high adverse selection risk)
- Active trading volume

## Risk Scenarios

### Adverse Selection
If the true probability moves and your resting order fills at a stale price, you lose money. Mitigation:
- Keep spreads at 2¢+
- Cancel and re-quote every 15 seconds
- Use WebSocket for instant price updates

### Market Resolution
If a market resolves while you hold inventory, shares settle at $0 or $1. Mitigation:
- Avoid markets close to resolution
- Keep position sizes small
- Monitor through the dashboard

### API Downtime
If Polymarket's API goes down, the bot can't cancel orders. Mitigation:
- The bot auto-cancels all orders on shutdown (SIGINT/SIGTERM)
- Kill switch available from the dashboard
- Daily loss limit triggers automatic shutdown
