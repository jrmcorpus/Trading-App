# MT4 Execution EA Guide

This guide documents `mt5_bridge/MT4_Execution_EA.mq4`:
- what it does
- how to run it
- which rules can block trades
- what files/endpoints the app uses

## 1) What This Setup Can Do

`MT4_Execution_EA.mq4` is an all-in-one MT4 Expert Advisor for this app.

It can:
- Auto-trade using an internal strategy (when enabled)
- Enforce strict pre-trade risk policies
- Execute manual commands from app bridge (`PLACE`, `CLOSE`, `MODIFY`)
- Export market/account/trade data to CSV for the web app
- Emit policy diagnostics/events (`AUTO_BLOCK`, `AUTO_EXECUTED`, etc.)

It replaces `MT4_Candle_Exporter.mq4` for production use.  
Run one exporter/execution EA only to avoid file-write collisions.

## 2) Architecture

### MT4 side
- EA runs in terminal and writes CSV files into `MQL4/Files`.
- EA also reads command CSV from bridge for manual execution flow.

### Bridge side (`mt5_bridge/server.mjs`)
- Reads exported CSVs
- Serves data to frontend via REST endpoints
- Provides guarded manual order flow with `prepare` + `confirm`

### Frontend side
- Displays MT4 candles/ticks/account/history
- Shows policy checks and EA event feed
- Uses bridge endpoints under `/api/mt4/*`

## 3) Exported Files

Default filenames (configurable via EA inputs / env):
- `bridge_command.csv` (bridge -> EA command)
- `bridge_result.csv` (EA -> bridge result)
- `bridge_positions.csv`
- `bridge_account.csv`
- `bridge_history.csv`
- `bridge_ticks.csv`
- `bridge_policy.csv` (EA event/policy diagnostics)
- `<SYMBOL>_<TF>.csv` candles (e.g. `EURUSD_M15.csv`)

## 4) Strategy Logic (Auto Mode)

Auto mode is controlled by:
- `AutoTradeEnabled=true|false`

Signal timeframe/symbol:
- `StrategySymbol` (blank = chart symbol)
- `StrategyTimeframe` (`M1/M5/M15/M30/H1/H4/D1/W1/MN`)
- `WatchSymbolsCsv` (optional multi-symbol scan list, e.g. `BTCUSD#,GOLD#,EURUSD#`)
- `MaxNewTradesPerCycle` (max new orders per scan pass; default `1`)

Current signal model:
- Trend filter:
  - BUY: `EMA(Fast) > EMA(Slow)`
  - SELL: `EMA(Fast) < EMA(Slow)`
- Momentum filter:
  - BUY RSI range: `BuyRsiMin..BuyRsiMax`
  - SELL RSI range: `SellRsiMin..SellRsiMax`
- Trigger:
  - breakout over `SignalLookbackBars` bars
  - BUY: breaks lookback high
  - SELL: breaks lookback low
  - `UseCloseBreakout=true` uses close-breakout
  - `UseCloseBreakout=false` uses wick-breakout (more frequent)
- Stops/targets:
  - SL from ATR (`AtrStopMultiplier`)
  - TP from minimum R:R (`MinRR`)

Orders are evaluated on ticks, but decisioning is gated to once per new bar per symbol on selected strategy timeframe.

If `WatchSymbolsCsv` is set:
- EA scans each symbol in the CSV list
- applies full signal + policy checks per symbol
- can open up to `MaxNewTradesPerCycle` fresh orders per cycle

## 5) Trading Policy Enforcement

Before auto order execution, EA checks all below:

1. Session window
- Must be inside `TradeStartHour` to `TradeEndHour` (server time)

2. Spread guard
- Current spread must be `<= MaxSpreadPoints`

3. Max open exposure
- Total open trades `< MaxOpenTradesTotal`
- Per-symbol open trades `< MaxOpenTradesPerSymbol`

4. Daily drawdown guard
- Today realized loss % must be below `DailyLossLimitPct`

5. Cooldown per symbol
- Time since last close on symbol must exceed `CooldownMinutes`

6. SL/TP structure validity
- BUY requires `SL < entry < TP`
- SELL requires `TP < entry < SL`

7. Minimum reward:risk
- Computed RR must be `>= MinRR`

8. Risk-based lot sizing
- Lot calculated from:
  - `RiskPerTradePct`
  - stop distance
  - broker tick value/tick size
- Result normalized to broker lot min/max/step

If any rule fails, no order is sent and event is logged as `AUTO_BLOCK`.

## 6) Event Types (bridge_policy.csv)

Common events:
- `EA_ONLINE`
- `EA_OFFLINE`
- `AUTO_SKIP` (no setup)
- `AUTO_BLOCK` (policy prevented trade)
- `AUTO_EXECUTED`
- `AUTO_ERROR`
- `MANUAL_PLACE`
- `MANUAL_CLOSE`
- `MANUAL_MODIFY`

Severity field:
- `INFO`
- `WARN`
- `ERR`

## 7) Bridge Endpoints Used

Read data:
- `GET /api/mt4/candles`
- `GET /api/mt4/ticks`
- `GET /api/mt4/account`
- `GET /api/mt4/history`
- `GET /api/mt4/orders/open`
- `GET /api/mt4/policy-events`

Manual trading flow:
- `POST /api/mt4/orders/prepare`
- `POST /api/mt4/orders/confirm`
- `POST /api/mt4/orders/policy-check`

## 8) Required Environment Keys

In `.env.local`:
- `MT4_BRIDGE_FILES_DIR=...\\MQL4\\Files`
- `MT4_BRIDGE_POLICY_FILE=bridge_policy.csv`
- optional policy keys on bridge side:
  - `MT4_MAX_OPEN_TRADES`
  - `MT4_MAX_OPEN_PER_SYMBOL`
  - `MT4_MIN_RR`
  - `MT4_SYMBOL_COOLDOWN_SEC`
  - `MT4_DAILY_LOSS_LIMIT_PCT`

Note:
- EA policy and bridge policy both exist.  
- Keep them aligned to avoid confusion (recommended same limits).

## 9) Recommended Safe Defaults

For small/micro accounts:
- `AutoTradeEnabled=false` while validating
- `RiskPerTradePct=0.25..0.50`
- `MinRR=2.0`
- `MaxOpenTradesTotal=2..3`
- `MaxOpenTradesPerSymbol=1`
- `DailyLossLimitPct=2.0..3.0`
- `CooldownMinutes>=20`

## 10) Runbook

1. Compile and attach `MT4_Execution_EA.mq4` to one chart in MT4
2. Enable AutoTrading in MT4
3. Verify CSV files appear in `MQL4/Files`
4. Start bridge: `npm run market-bridge`
5. Start app: `npm run dev`
6. Confirm:
- chart shows `Source MT4`
- Assistant panel shows EA event feed
- Account/history sync updates

### Multi-symbol overnight mode

Recommended inputs:
- `AutoTradeEnabled=true`
- `WatchSymbolsCsv=BTCUSD#,GOLD#,EURUSD#` (use exact broker names)
- `StrategyTimeframe=M15` or `H1`
- `MaxNewTradesPerCycle=1` (safer)
- keep strict risk limits (`RiskPerTradePct`, `DailyLossLimitPct`, etc.)

Higher-frequency demo profile (still risk-guarded):
- `SignalLookbackBars=2`
- `UseCloseBreakout=false`
- `BuyRsiMin=38`
- `BuyRsiMax=78`
- `SellRsiMin=22`
- `SellRsiMax=62`
- Keep: `RiskPerTradePct<=0.50`, `MinRR>=2.0`, `MaxOpenTradesPerSymbol=1`

Notes:
- When `WatchSymbolsCsv` is set, `StrategySymbol` is only a fallback.
- Keep MT4 terminal running and PC awake overnight.

## 11) Important Constraints

- Use **one** EA writer for bridge files (do not run candle exporter in parallel).
- Strategy is deterministic rule-based (not LLM execution).
- AI in app should be treated as advisory unless you intentionally wire it into execution criteria.
- This is not guaranteed profitable and must be forward-tested and demo-tested first.
