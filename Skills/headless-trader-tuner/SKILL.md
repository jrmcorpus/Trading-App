---
name: headless-trader-tuner
description: Tune the headless trading behavior for this repo. Use when Codex needs to make GOLD or ETHUSD trade more or less aggressively, change confidence gates, remove or restore win-rate checks, switch market versus limit execution, change TP or SL behavior, or reconcile symbol profile settings with actual runtime execution.
---

# Headless Trader Tuner

Use this skill to change actual managed trading behavior, not just UI labels.

## Workflow

1. Read [references/tuning-map.md](references/tuning-map.md) for the important files and execution hotspots.
2. Verify the live `symbolProfiles` from `/api/mt4/headless/status` before editing.
3. Patch both sides when needed:
   - frontend sync and diagnostics in `TradingAssistant.tsx`
   - runtime execution in `headlessTrader.mjs`
4. If config persistence matters, patch `headless-config.json` too.
5. Run validation and restart the stack.
6. Re-check live `symbolProfiles` and runtime status after restart.

## Core Rules

- Treat `getEffectiveAutoConfig()` as authoritative for execution.
- Prefer symbol-profile tuning over top-level `auto` assumptions.
- If a behavior changes in runtime, keep diagnostics in sync so the UI does not mislead.
- Distinguish between:
  - hunting logic
  - order plan generation
  - execution payload
  - post-entry protection

## Typical Tuning Levers

- `minConfidence`
- `minWinRate`
- `minRR`
- `requireStrong`
- `entryMode`
- `allowMarketFallback`
- `riskUsd`
- `minSlPoints`
- `atrBufferMult`
- break-even and protection thresholds

## Deliverable

Return:

- what was changed
- whether the change affects GOLD, ETHUSD, or both
- how hunting changed
- how execution changed
- how closing/protection changed
- whether the live runtime now reflects the intended symbol profile
