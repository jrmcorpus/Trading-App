# Tuning Map

## Main Execution Files

- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/headless-config.json`
- `src/components/TradingAssistant.tsx`

## Runtime Hotspots

- `getEffectiveAutoConfig()`
- `getEffectiveProtectConfig()`
- `generateTradeSignal()`
- `buildAutoOrderPlan()`
- `evaluateTradeCandidate()`
- `buildMissingProtectionPlan()`

## Validation

- `npm.cmd run type-check`
- `node --check mt5_bridge/headlessTrader.mjs`
- `npm.cmd run app:down`
- `npm.cmd run app:up`
- `Invoke-RestMethod http://localhost:8787/api/mt4/headless/status`

## Common Drift Pattern

Code can look updated while runtime stays old because:

- `headless-config.json` still has stale values
- startup sync writes old local settings back into config
- top-level `auto` block differs from `symbolProfiles`
- UI diagnostics were patched but runtime logic was not
