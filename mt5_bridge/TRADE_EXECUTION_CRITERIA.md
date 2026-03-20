# Trade Execution Criteria (MT4 Bridge)

This document explains exactly how a trade is evaluated, blocked, and executed in this app.

## AI Watchlist Planner (News + Price Action)

`AI Watchlist Copilot` now ranks symbols using:

- Panel price action context (signal, confidence, win-rate, RSI, MA, ATR, RR).
- Current policy/eligibility state from diagnostics.
- External market news from `GET /api/mt4/market-intel`.

`/api/mt4/market-intel` aggregates legitimate sources per symbol:

- Yahoo Finance RSS (primary, no key required).
- Alpha Vantage `NEWS_SENTIMENT` (optional when key is configured).

If no news is available, copilot returns an error instead of producing a blind plan.

## 1) End-to-End Execution Flow

1. Panel analysis generates a signal (`BUY`, `SELL`, `HOLD`) and draft SL/TP.
2. `evaluateTradeCandidate(...)` in frontend evaluates strategy gates and lot sizing.
3. Frontend calls `POST /api/mt4/orders/policy-check` for bridge-level policy checks.
4. If eligible, frontend sends `POST /api/mt4/orders/prepare`.
5. Bridge re-validates request and enforces policy again.
6. Frontend sends `POST /api/mt4/orders/confirm` with `requestId + confirmToken`.
7. Bridge writes command CSV for EA.
8. EA reads command, normalizes lot, sends `OrderSend`, and writes result CSV.
9. Bridge returns execution result (`ok`/`error`, ticket/message).

## 2) Frontend Strategy Criteria (`evaluateTradeCandidate`)

A candidate is blocked if any of these fail:

- `No actionable signal` (missing signal/data or signal is `HOLD`).
- `Confidence < minConfidence`.
- `Win rate < minWinRate`.
- `requireStrongSignal` enabled and signal strength is not `STRONG`.
- Effective R:R invalid (`R:R unavailable`) or below `minRR`.
- Broker market session closed (`isBrokerSessionOpen` false for non-crypto).
- Outside configured auto-trade session window (`VITE_AUTO_SESSION_WINDOW_*`, default `20:00-00:00 Asia/Manila` when enabled).
- Current open count reached `maxOpenTrades`.
- Same symbol already open (normalized symbol prefix match).

## 3) Order Plan Criteria (`buildAutoOrderPlan`)

### Entry mode: `MARKET`
- Uses live entry (if available), else current price.
- SL/TP must produce valid direction and positive distances.

### Entry mode: `LIMIT_SR`
- Builds structure-based limit entry.
- Limit plan only valid if pending price is on correct side of live/current reference.
- If invalid and `allowMarketFallback=false`: blocked.
- If fallback enabled: switch to market with rebuilt SL/TP.

Fallback note can include:
- `confidence X% < fallbackMinConfidence`
- `R:R Y < (minRR + fallbackRrBuffer)`
- `R:R unavailable`

## 4) Dynamic Lot and Risk Criteria

If dynamic lot is enabled:

- Requires account risk base (`balance/equity`) and symbol spec (`tickValue`, `tickSize`).
- `riskAmount`:
  - `USD` mode: fixed `riskUsd`
  - `PCT` mode: `accountRiskBase * riskPct/100`
- `riskPerLot = (slDistance / tickSize) * tickValue`
- `rawLots = riskAmount / riskPerLot`

Block/fail conditions:
- Account snapshot unavailable.
- Symbol tick spec unavailable.
- Invalid SL distance.
- Invalid risk-per-lot.
- Lot calculation failed.
- Invalid lot size.

### Min-lot handling
If `rawLots < minLot`, system attempts to tighten SL so min lot can fit target risk:
- Computes required SL distance for `minLot`.
- If valid and tighter than current SL distance, SL is adjusted and note added:
  - `SL tightened for min lot (old -> new)`
- If still below min lot, candidate is blocked with:
  - `Risk lot {raw} below min {minLot} (risk $..., SL dist ...)`

### Hard risk block (optional)
If enabled, block when projected SL loss exceeds target risk by multiplier:
- `projectedRiskUsd > targetRiskUsd * riskGuardMult`

## 5) Bridge Policy Criteria (`/orders/policy-check` and `/orders/prepare`)

Bridge validates action/payload first:
- Action must be one of `PLACE`, `PENDING`, `CLOSE`, `MODIFY`.
- Symbol required and must be allowed.
- Side/orderType must be valid.
- Lots must be `> 0` and `<= MT4_MAX_LOT_PER_ORDER`.
- If `MT4_REQUIRE_SL_TP=true`, SL/TP are required.

For `PLACE`/`PENDING`, risk policy checks include:

- `max_open_trades`: current open positions `< MT4_MAX_OPEN_TRADES`
- `max_open_per_symbol`: symbol open count `< MT4_MAX_OPEN_PER_SYMBOL`
- `symbol_cooldown`:
  - Based on latest close time in history.
  - Uses MT4 account timestamp clock when available.
  - Pass if no recent close or cooldown expired.
- `daily_loss_limit`:
  - Computes today's closed PnL vs balance.
  - Pass if loss % `< MT4_DAILY_LOSS_LIMIT_PCT`.
- Entry reference:
  - `PLACE`: `live_reference_price` must be available.
  - `PENDING`: `pending_entry_price` must be valid.
- `sl_tp_direction`: BUY requires `sl < entry < tp`; SELL requires `tp < entry < sl`.
- `sl_tp_distance`: both risk and reward distances must be `> 0`.
- `min_rr`: computed RR must be `>= MT4_MIN_RR`.

`pass=true` means all bridge policy checks passed. Frontend can still mark trade ineligible due to strategy gates.

## 6) Prepare/Confirm Criteria

`/orders/prepare`:
- Re-validates request.
- Resolves executable symbol from MT4 symbol feed.
- Enforces policy checks.
- Stores pending request with TTL and returns `requestId + confirmToken`.

`/orders/confirm`:
- Requires valid `requestId` and `confirmToken`.
- Fails if not found, expired, or token mismatch.
- Executes by writing command file and waiting for EA result.

## 7) EA Execution Criteria (`MT4_Execution_EA.mq4`)

Before `OrderSend`, EA validates/normalizes lots:
- `requestedLots > 0`
- Reads broker `MODE_MINLOT`, `MODE_MAXLOT`, `MODE_LOTSTEP`
- Floors to lot step and normalizes decimals.
- Caps at max lot.
- Rejects if stepped lot `< broker min lot`.

If rejected, result message returns lot reason.
If accepted, EA calls `OrderSend` and returns:
- Success: `OrderSend OK` (+ optional normalization note)
- Failure: `OrderSend failed #<error>`

## 8) Why Trade Can Be Blocked Even If `PASS min_rr`

`PASS min_rr` only means RR threshold passed in bridge policy.
Trade can still be blocked by other criteria, for example:
- frontend confidence/win-rate/strong-signal gates,
- symbol cooldown,
- daily loss limit,
- dynamic lot below min lot after SL tightening,
- hard risk block,
- market session closed,
- existing open position constraints.

## 9) Common Error Mapping

- `OrderSend failed #131`: invalid trade volume (lot size vs broker min/step/max), typically at EA execution layer.
- `Cooldown active (...)`: latest close still within symbol cooldown seconds.
- `Daily loss limit (...)`: today's closed loss exceeds configured percent.
- `R:R unavailable`: invalid entry/SL/TP distances.
- `Risk lot ... below min ...`: computed risk-based lot cannot satisfy broker min lot even after SL tighten logic.

## 10) Source of Runtime Settings

Frontend trading settings feed these checks:
- min confidence / win rate / min RR
- max open trades
- symbol cooldown enable + minutes
- daily loss enforcement
- hard risk block + multiplier
- entry mode + market fallback
- dynamic lot (risk mode, risk amount, min lot, lot step, bot lot cap)
- optional local session gate:
  - `VITE_AUTO_SESSION_WINDOW_ENABLED`
  - `VITE_AUTO_SESSION_WINDOW_TZ`
  - `VITE_AUTO_SESSION_WINDOW_START`
  - `VITE_AUTO_SESSION_WINDOW_END`
  - `VITE_AUTO_SESSION_WINDOW_INCLUDE_CRYPTO`
- optional frontend allowlist mirror for config audit:
  - `VITE_MT4_ALLOWED_SYMBOLS`

Bridge env/limits feed these checks:
- `MT4_MAX_LOT_PER_ORDER`
- `MT4_REQUIRE_SL_TP`
- `MT4_ALLOWED_SYMBOLS`
- `MT4_MAX_OPEN_TRADES`
- `MT4_MAX_OPEN_PER_SYMBOL`
- `MT4_MIN_RR`
- `MT4_SYMBOL_COOLDOWN_SEC`
- `MT4_DAILY_LOSS_LIMIT_PCT`
- `MT4_CONFIRM_TTL_MS`

## 11) Symbol-Specific Adjustments (Auto-applied)

The app now applies symbol-specific execution presets for safer defaults. These are used on top of your global settings.

- FX majors (e.g., `EURUSD`, `GBPUSD`, `AUDUSD`):
  - min SL floor: `30` points
  - spread/slippage guard multiplier: `1.0x / 1.0x`
- JPY crosses (`GBPJPY`, `EURJPY`, `AUDJPY`):
  - min SL floor: `45` points
  - spread/slippage guard multiplier: `1.5x / 1.5x`
- `GBPNZD`:
  - min SL floor: `70` points
  - spread/slippage guard multiplier: `2.0x / 2.0x`
- `GOLD` (`XAU`):
  - min SL floor: `60` points
  - spread/slippage guard multiplier: `1.25x / 1.2x`
- `SILVER` (`XAG`):
  - min SL floor: `90` points
  - spread/slippage guard multiplier: `1.6x / 1.5x`
- Crypto (`BTCUSD`, `ETHUSD`, `SOLUSD`):
  - min SL floor: `120` points
  - spread/slippage guard multiplier: `2.5x / 2.2x`
- `XRPUSD`:
  - min SL floor: `60` points
  - spread/slippage guard multiplier: `2.0x / 2.0x`
- `US30CASH`:
  - min SL floor: `120` points
  - spread/slippage guard multiplier: `0.5x / 0.65x`
  - point/pip model is index-aware (`1 point` basis)

### Notes

- Final spread/slippage limits are computed from global values:
  - `VITE_AUTO_MAX_SPREAD_POINTS * spreadMult`
  - `VITE_AUTO_MAX_SLIPPAGE_POINTS * slippageMult`
- For each symbol, effective min SL points is:
  - `max(autoMinSlPoints, symbolPresetMinSlPoints)`
