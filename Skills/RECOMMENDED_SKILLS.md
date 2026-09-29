# Recommended Skills For This Repo

## Repo Profile

This repository is not a generic React app. It is a hybrid trading system with four coupled surfaces:

1. Frontend web app
2. Node market bridge
3. Headless trading runtime
4. MT4 exporter / execution EA

Core files:

- `src/components/TradingAssistant.tsx`
- `src/App.tsx`
- `mt5_bridge/server.mjs`
- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/MT4_Execution_EA.mq4`
- `scripts/start-app.ps1`
- `scripts/stop-app.ps1`
- `mt5_bridge/headless-config.json`

Primary workflows in this repo:

- start and stop local runtime
- inspect bridge health and MT4 data feeds
- tune auto-trading behavior
- validate broker symbol resolution
- diagnose order placement / protection logic
- adjust UI diagnostics to match runtime behavior
- manage manual-trade protection side effects

Because of that, the most useful skills for this repo are operational and diagnostic, not generic frontend-only skills.

## Priority Recommendations

### 1. `trading-app-runtime-ops`

Priority: `P1`

Use when working on:

- local startup / shutdown
- runtime verification
- bridge/frontend availability
- health checks after config changes

Why this skill matters:

- This repo is usually verified through the running app, not just static code.
- `app:up` / `app:down`, PID files, logs, and endpoint checks are part of normal work.
- A lot of regressions here are "runtime mismatch" problems, not compile errors.

Key files:

- `package.json`
- `scripts/start-app.ps1`
- `scripts/stop-app.ps1`
- `vite.config.ts`
- `mt5_bridge/server.mjs`

Validation commands:

- `npm.cmd run app:up`
- `npm.cmd run app:down`
- `Invoke-RestMethod http://localhost:3000/index.html`
- `Invoke-RestMethod http://localhost:8787/health`
- `Invoke-RestMethod http://localhost:8787/api/mt4/headless/status`

### 2. `mt4-bridge-diagnostics`

Priority: `P1`

Use when working on:

- MT4 export/import issues
- candle/tick/history/account mismatches
- symbol spec lookup issues
- pending/open order visibility problems

Why this skill matters:

- The bridge is the data backbone of the app.
- Many UI issues are actually CSV export or bridge parse issues.
- Broker-specific symbol naming is a repeated source of defects.

Key files:

- `mt5_bridge/server.mjs`
- `mt5_bridge/MT4_Execution_EA.mq4`
- `mt5_bridge/MT4_Candle_Exporter.mq4`
- `mt5_bridge/MT4_EXECUTION_EA_GUIDE.md`

Validation targets:

- `/api/mt4/candles`
- `/api/mt4/ticks`
- `/api/mt4/orders/open`
- `/api/mt4/history`
- `/api/mt4/headless/status`

### 3. `headless-trader-tuner`

Priority: `P1`

Use when working on:

- entry aggressiveness
- confidence thresholds
- managed symbol behavior
- market vs limit entry mode
- TP / SL behavior
- risk guard and lot sizing

Why this skill matters:

- Most strategy work lands in `headlessTrader.mjs` and `headless-config.json`.
- The repo repeatedly changes between conservative and aggressive behavior.
- Symbol profiles override global settings, so config intent and live execution can diverge.

Key files:

- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/headless-config.json`
- `src/components/TradingAssistant.tsx`

Expected checks:

- verify `getEffectiveAutoConfig()`
- verify `buildAutoOrderPlan()`
- verify `evaluateTradeCandidate()`
- verify `buildMissingProtectionPlan()`

### 4. `managed-symbol-policy-auditor`

Priority: `P1`

Use when working on:

- why GOLD or ETHUSD is blocked
- confidence / noise / confirmation gates
- mismatch between diagnostics panel and runtime executor
- symbol-specific overrides

Why this skill matters:

- The repo is now highly focused on `GOLD` and `ETHUSD`.
- The top-level config can differ from `symbolProfiles`.
- A lot of user-facing confusion comes from "card says X, runtime does Y".

Key files:

- `src/components/TradingAssistant.tsx`
- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/headless-config.json`

Questions this skill should answer quickly:

- What blocked the trade?
- Which config layer won?
- Was this a signal problem, confirmation problem, spread problem, cooldown problem, or policy problem?

### 5. `manual-trade-protect-manager`

Priority: `P2`

Use when working on:

- manual MT4 trade side effects
- auto-filled SL/TP
- break-even behavior
- protection acting on manual trades
- cooldown interaction with manual closes

Why this skill matters:

- Manual MT4 trading is common in this repo's real workflow.
- The app can manage manual trades after fill, which creates confusing behavior if undocumented.
- Many support questions here are about "the app did not place the trade, but it changed the trade".

Key files:

- `src/components/TradingAssistant.tsx`
- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/server.mjs`

Critical behaviors to track:

- missing SL/TP autofill
- break-even migration
- bias-flip lock
- cooldown from bot-tagged vs manual trades

### 6. `broker-symbol-resolution-auditor`

Priority: `P2`

Use when working on:

- `GOLD` vs `GOLDm#` mismatches
- displayed S/R not matching live price
- unresolved broker symbols
- symbol feed inconsistencies across candles/ticks/execution

Why this skill matters:

- This repo has broker-specific naming and multiple symbol resolution paths.
- A single mismatch can invalidate diagnostics, order plans, and SL/TP logic at once.

Key files:

- `mt5_bridge/server.mjs`
- `src/components/TradingAssistant.tsx`
- `src/utils/pairs.ts`

### 7. `frontend-trading-panel-editor`

Priority: `P2`

Use when working on:

- settings modal behavior
- strategy diagnostics UI
- panel labels vs runtime truth
- managed symbol settings UX

Why this skill matters:

- `TradingAssistant.tsx` is large and carries both UI and business logic.
- Small UI edits can easily drift away from runtime behavior.
- The app needs setup-aware diagnostics, not generic dashboard labels.

Key files:

- `src/components/TradingAssistant.tsx`
- `src/App.tsx`
- `src/components/PriceChart.tsx`

Validation:

- `npm.cmd run type-check`
- visual check in running app

### 8. `trade-history-and-policy-reviewer`

Priority: `P3`

Use when working on:

- close-source labeling
- history interpretation
- bot vs manual trade attribution
- policy-check detail trails

Why this skill matters:

- Users often infer wrong causes from history rows.
- Comments, tags, audit logs, and MT4 close reasons need cross-checking.

Key files:

- `src/App.tsx`
- `mt5_bridge/server.mjs`
- `mt5_bridge/headlessTrader.mjs`

## Suggested Skill Build Order

If these are converted into actual Codex skills, build them in this order:

1. `trading-app-runtime-ops`
2. `mt4-bridge-diagnostics`
3. `headless-trader-tuner`
4. `managed-symbol-policy-auditor`
5. `manual-trade-protect-manager`
6. `broker-symbol-resolution-auditor`
7. `frontend-trading-panel-editor`
8. `trade-history-and-policy-reviewer`

## Recommended Skill Triggers

Good trigger phrases for future skills:

- "restart the stack and verify runtime"
- "why is GOLD blocked"
- "why is ETH not trading"
- "bridge is not reading MT4 correctly"
- "panel and runtime do not match"
- "manual trade got modified"
- "GOLD symbol mismatch"
- "make the bot more aggressive"
- "why did cooldown restart"

## Recommendation

If only three skills are created for this repo, create these:

1. `trading-app-runtime-ops`
2. `mt4-bridge-diagnostics`
3. `headless-trader-tuner`

Those three would cover most real work in this codebase.
