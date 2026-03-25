# Architecture

Technical overview of how Polybot's components fit together.

## System Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     index.ts (Orchestrator)              │
│                                                          │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐            │
│  │ config.ts │  │ logger.ts │  │  types.ts  │            │
│  └──────────┘  └───────────┘  └────────────┘            │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              client.ts (API Wrapper)              │   │
│  │  • CLOB authentication (L1/L2 headers)           │   │
│  │  • Order signing & submission                     │   │
│  │  • Market data queries                            │   │
│  │  • Rewards API parsing                            │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐                 │
│  │ market-         │  │ strategy.ts    │                 │
│  │ discovery.ts    │  │ • Order engine │                 │
│  │ • Gamma API     │  │ • Tick loop    │                 │
│  │ • Rewards API   │  │ • Skew adjust  │                 │
│  │ • APR ranking   │  │ • Cancel/place │                 │
│  └────────────────┘  └────────────────┘                 │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐                 │
│  │ risk-manager.ts│  │ websocket.ts   │                 │
│  │ • Kill switch  │  │ • Price feeds  │                 │
│  │ • P&L tracking │  │ • Auto-reconnect│                │
│  │ • Position lim.│  │ • Fill events  │                 │
│  └────────────────┘  └────────────────┘                 │
│                                                          │
│  ┌────────────────┐  ┌────────────────┐                 │
│  │ monitor.ts     │  │ server.ts      │                 │
│  │ • Terminal UI  │  │ • Express API  │                 │
│  │ • Alerts       │  │ • Static files │                 │
│  └────────────────┘  └────────────────┘                 │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────┐
              │ public/index.html │
              │ React Dashboard   │
              └───────────────────┘
```

## Component Responsibilities

### `index.ts` — Orchestrator
Entry point. Initializes all components in sequence, starts the strategy loop, and handles graceful shutdown (SIGINT/SIGTERM cancel all orders).

### `client.ts` — API Wrapper
Wraps the `@polymarket/clob-client` SDK. Handles:
- L1 and L2 auth header generation
- Order creation and signing
- Market data fetching from CLOB and Gamma APIs
- Rewards data parsing from the Rewards API

### `market-discovery.ts` — Market Finder
Queries the Gamma API for active events, cross-references with the Rewards API to find sponsored markets, and ranks them by estimated APR.

### `strategy.ts` — Order Engine
Core trading logic. Each tick:
1. Checks risk manager approval
2. Fetches current midpoint
3. Cancels stale orders
4. Places new two-sided quotes
5. Applies inventory skew correction

### `risk-manager.ts` — Risk Controls
Tracks positions, P&L, and enforces limits:
- Daily loss limit → auto kill switch
- Per-market inventory limits
- Total exposure cap
- Fill cooldown timer

### `websocket.ts` — Real-time Data
Connects to Polymarket's WebSocket for:
- Real-time price updates (midpoint changes)
- Fill notifications
- Auto-reconnect on disconnect

### `monitor.ts` — Terminal Dashboard
Prints a formatted status table to the terminal every 30 seconds. Optionally sends alerts via Discord webhook or Telegram bot.

### `server.ts` — Express API
Embedded web server that exposes bot metrics via REST endpoints and serves the React dashboard from the `public/` directory.

### `serve-dashboard.ts` — Standalone Server
Lightweight Express server for previewing the dashboard without the full bot pipeline. Fetches live reward data from Polymarket APIs.

## Data Flow

```
Polymarket APIs ──► market-discovery.ts ──► strategy.ts ──► client.ts ──► Polymarket CLOB
                                              ▲                              │
                                              │                              ▼
                   websocket.ts ──────────────┘                    Order Book
                   (price updates)
                                              
strategy.ts ──► risk-manager.ts (check limits)
            ──► server.ts (expose metrics)
            ──► monitor.ts (terminal output)
```

## Shutdown Sequence

When `Ctrl+C` is pressed:

1. Stop strategy loop timer
2. Stop market re-discovery timer
3. Stop terminal monitor
4. Cancel all open orders via CLOB API
5. Disconnect WebSocket
6. Send shutdown alert (Discord/Telegram)
7. Print final P&L summary
8. Exit process
