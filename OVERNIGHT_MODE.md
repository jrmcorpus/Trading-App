# Overnight Mode

This document explains how the current overnight mode works in `Trading-App`.

## Purpose

Overnight mode is a **managed auto-trading profile** designed to:

- scan for a filtered setup
- open a normal trade
- manage the trade with tighter overnight exit rules
- stop the session after repeated losses

It is not a separate broker order type. It is a layer on top of the normal bridge entry and position-management flow.

## Runtime Model

Overnight mode is primarily intended for the **headless bridge runtime**.

Main files:

- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/headless-config.json`
- `src/components/TradingAssistant.tsx`

The Trading Assistant UI can also mirror similar protect logic in browser mode, but the dedicated overnight preset is built around the **headless** path.

## Current Strategy Shape

The optimized preset is built around **gold only**:

- Watchlist symbol: `GOLD`
- Bias timeframe: `H4`
- Setup timeframe: `H1`
- Entry timeframe: `M5`
- Entry mode: `MARKET`
- Comment tag prefix: `gold-overnight-scalp`

Default optimized headless values live in `mt5_bridge/headlessTrader.mjs`. The saved `headless-config.json` may contain a partial snapshot, and the UI can sync updated values into the bridge at runtime.

## High-Level Flow

1. The headless scanner watches the overnight symbol list.
2. It checks trend alignment and signal quality.
3. It blocks bad conditions such as strong trend slope or high-impact news.
4. It opens a normal trade if the setup passes.
5. Overnight mode manages the open trade using floating PnL rules.
6. After a close, symbol cooldown applies before another entry is allowed.
7. Three consecutive managed losses disable the overnight session.

## Entry Rules

The optimized overnight preset uses these defaults:

- `minConfidence = 80`
- `minWinRate = 70`
- `minRR = 1.8`
- `cooldownMin = 15`
- `maxOpenTrades = 1`
- `requireStrong = true`
- `enforceSymbolCooldown = true`
- `riskMode = USD`
- `riskUsd = 1.0`
- `useDynamicLot = true`
- `riskGuardMult = 1.1`
- `minLot = 0.1`
- `lotStep = 0.01`

The trend stack is:

- `H4` for bias
- `H1` for setup
- `M5` for entry

In plain terms:

- `H4` decides the bigger direction
- `H1` confirms the setup quality
- `M5` is the actual trigger timeframe

If the stack does not align, the trade is skipped.

## Extra Overnight Filters

Overnight mode adds filters beyond the normal entry logic.

### MA200 Flat Filter

The strategy avoids taking overnight trades when the `MA200` slope is too strong.

Default:

- `ma200FlatFilterEnabled = true`
- `ma200FlatMaxAtrRatio = 0.09`

Intent:

- if the trend is too strong, skip the trade
- if the long trend is flatter/weaker, allow the scalp setup

### High-Impact News Filter

The strategy blocks new entries around major macro events.

Default:

- `highImpactNewsFilterEnabled = true`
- `highImpactNewsLookbackMin = 360`
- keywords: `NFP`, `CPI`, `FOMC`

Intent:

- avoid opening new overnight trades during major volatility events

## How Orders Are Opened

When a setup passes, the bridge places a **normal market order**.

Important:

- the broker ticket still gets a normal technical `SL` and `TP`
- overnight mode does **not** replace the ticket with a tiny broker TP
- instead, it watches floating PnL and can close earlier

So the visible MT4 `SL/TP` can be far away while overnight mode still exits much earlier.

## Overnight Exit Rules

The optimized default protect values are:

- `breakEvenEnabled = true`
- `breakEvenR = 1.0`
- `breakEvenProfitUsd = 0.30`
- `degradeCloseEnabled = true`
- `degradeMinConfidence = 82`
- `overnightEnabled = true`
- `overnightProfitUsd = 1.10`
- `overnightLossUsd = 1.20`

### Break-Even

When the trade reaches either:

- `+1R` by price movement
- or `+$0.30` floating profit while overnight mode is active

the bridge can move the stop to entry.

Intent:

- reduce the chance that a small winner turns into a larger loser

### Overnight Profit Target

If floating profit reaches:

- `+$1.10`

the bridge closes the trade early.

This is a floating USD target, not the visible broker TP.

### Overnight Loss Cap

If floating loss reaches:

- `-$1.20`

the bridge closes the trade early.

This is a floating USD loss cap, not the visible broker SL price.

### Degrade Close

If the protect logic sees a strong enough confidence deterioration and degrade-close is enabled, it can close the trade before the hard target or hard loss is reached.

Intent:

- exit weaker trades before they fully decay

## Cooldown Behavior

After a managed trade closes, the symbol enters cooldown.

Optimized preset:

- `15` minutes per symbol

During this cooldown:

- the bot will not open a new trade on that symbol
- after cooldown expires, it scans again for a fresh valid setup

## Consecutive Loss Stop

Overnight mode tracks managed trade history using the preset comment tag.

Rule:

- after `3` consecutive losing managed trades, overnight mode disables itself
- auto-trade is blocked for the overnight session

A win resets the loss streak back to `0`.

This behavior exists to stop repeated overnight damage during a bad market stretch.

## Comment Tags

Headless overnight trades use a comment like:

- `gold-overnight-scalp-M5`

This is useful for:

- confirming that headless overnight mode is the one placing trades
- separating headless trades from browser-driven trades
- tracking the loss-streak shutdown correctly

If you instead see comments like:

- `ai-auto-M5`
- `ai-auto-M15`

that means the **browser auto-trader** is placing the trades, not the dedicated headless overnight preset.

## Headless vs Browser

### Headless Mode

Recommended for overnight use:

- bridge-owned
- keeps running even if the main UI is closed
- uses the dedicated headless config and comment tags

### Browser Mode

Useful for supervised trading, but not ideal for overnight:

- depends on the browser session
- can place trades with `ai-auto-*` comments
- can create confusion if browser auto-trade is left enabled while headless is also configured

## Example Trade

Example `SELL` on gold:

- `H4 = SELL`
- `H1 = SELL`
- `M5 = SELL`
- MA200 slope is flat enough
- no `NFP/CPI/FOMC` news block is active

The bridge opens a normal sell order.

Possible path:

1. Trade opens with a normal technical `SL` and `TP`.
2. Floating PnL reaches `+$0.30`.
3. Stop may be moved to entry.
4. If price continues in favor and floating PnL reaches `+$1.10`, the bridge closes the trade.
5. If price instead reverses badly and floating PnL reaches `-$1.20`, the bridge closes the trade.
6. After close, a `15` minute cooldown starts.
7. If the next valid setup appears after cooldown, the bridge can trade again.

## Current Config Caveat

The saved `mt5_bridge/headless-config.json` is a runtime snapshot and may not contain every optimized default field explicitly.

Important:

- the bridge code in `mt5_bridge/headlessTrader.mjs` contains the default optimized overnight values
- the Trading Assistant can sync the full preset into the headless runtime
- if browser mode is active, you may see different trade comments and behavior

## How To Verify It Is Working

Check these items:

- runtime mode is `HEADLESS`
- overnight mode is enabled
- the symbol list is pinned to `GOLD`
- new overnight trades use `gold-overnight-scalp-*` comments
- cooldown applies after closes
- a win resets the loss streak
- `3` consecutive managed losses disable the session

## Related Files

- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/headless-config.json`
- `src/components/TradingAssistant.tsx`
- `MIGRATION.md`
