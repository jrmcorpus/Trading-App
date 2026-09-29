---
name: mt4-bridge-diagnostics
description: Diagnose MT4 bridge data and API problems for this repo. Use when candles, ticks, open positions, history, pending-order visibility, symbol resolution, or broker-specific MT4 exports do not match the web app or expected execution behavior.
---

# MT4 Bridge Diagnostics

Use this skill to isolate whether a problem comes from MT4 export, bridge parsing, symbol resolution, or frontend consumption.

## Workflow

1. Read [references/bridge-surface.md](references/bridge-surface.md) when you need the endpoint map and file ownership.
2. Start from the live bridge endpoints before editing code.
3. Compare the same symbol across:
   - candles
   - ticks
   - open positions
   - history
   - symbol specs
4. If values disagree, determine whether the mismatch is:
   - exporter-side
   - bridge parse / resolution
   - frontend display

## Core Rules

- Verify broker symbol family consistency first for metals and custom broker symbols like `GOLDm#`.
- Treat pending-order absence carefully: this repo historically exposes open positions, not all pending orders.
- When diagnosing a UI issue, confirm whether the bridge data itself is wrong before patching React code.
- Use exact endpoint output and exact symbol names in conclusions.

## Common Questions To Answer

- Are candles and ticks coming from the same broker symbol?
- Is the UI reading `GOLD`, `GOLD#`, or `GOLDm#`?
- Is a manual MT4 order missing because it is still pending?
- Is the bridge exporting only filled positions?
- Did the EA export the expected CSV files?

## Deliverable

Return:

- which bridge endpoint or export is wrong
- which symbol resolution path won
- whether the issue is MT4, bridge, or UI
- the narrowest file that should be patched
