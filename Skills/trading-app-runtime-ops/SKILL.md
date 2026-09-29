---
name: trading-app-runtime-ops
description: Operate and verify the local Trading-App runtime. Use when Codex needs to start or stop the app, confirm the frontend and MT4 bridge are healthy, check whether headless trading is running, inspect runtime drift after config changes, or validate that local changes are active in the live app instead of only on disk.
---

# Trading App Runtime Ops

Use this skill to manage the local runtime for this repo.

## Workflow

1. Read [references/runtime-checklist.md](references/runtime-checklist.md) when you need the full command and endpoint surface.
2. Prefer `npm.cmd run app:up` and `npm.cmd run app:down` over manual process management.
3. After any restart or config change, verify all three surfaces:
   - frontend
   - bridge
   - headless runtime
4. Report live status with exact endpoints and the current effective runtime state.

## Core Rules

- Treat runtime verification as mandatory after changing:
  - `src/components/TradingAssistant.tsx`
  - `mt5_bridge/server.mjs`
  - `mt5_bridge/headlessTrader.mjs`
  - `mt5_bridge/headless-config.json`
- Prefer endpoint truth over UI assumptions.
- If `app:up` needs escalation because of sandbox restrictions, request it and then verify the runtime after the command completes.
- When the frontend or bridge comes back with stale behavior, check whether local cached settings or headless config sync rewrote the intended values.

## Minimum Verification

Run enough checks to answer these questions:

- Is the frontend serving?
- Is the bridge healthy?
- Is headless auto enabled and running?
- Is headless protect enabled and running?
- Does the reported live config match the change that was just made?

## Deliverable

Return:

- whether the stack is up
- which endpoints were checked
- whether the live runtime matches the intended change
- any mismatch between code on disk and runtime state
