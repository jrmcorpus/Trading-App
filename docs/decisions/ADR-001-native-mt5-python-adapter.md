# ADR-001: Use the Native MetaTrader 5 Python Adapter

## Status

Accepted for implementation

## Context

The app currently reads account, positions, history, ticks, and symbol metadata from MT4 `MQL4/Files` CSV files and sends orders through an MQL4 EA. The local machine already has a connected XM Global MT5 terminal and the official `MetaTrader5` Python package. The existing MT5 support is limited to a candle-fetching script.

The migration must support the existing web UI and headless risk workflow while removing dependence on stale MT4 files. Live order execution is a high-risk boundary and must remain explicitly gated.

## Decision

Use a small Python adapter around the official `MetaTrader5` package. Node remains responsible for HTTP input validation, risk policy, prepare/confirm tokens, and process lifecycle. Python owns terminal calls, MT5 data conversion, `order_check`, and gated `order_send` operations.

Keep the current `/api/mt4/*` paths as compatibility aliases while adding `/api/mt5/*` paths. Native mode becomes the selected runtime through `MT5_BRIDGE_MODE=native`; MT4 CSV code remains available for rollback during the migration.

## Alternatives Considered

### Port the current EA from MQL4 to MQL5

- Pros: terminal-local execution and continuous file export.
- Cons: requires a second implementation of account/position/order semantics, keeps the CSV protocol, and still needs netting/hedging-specific handling.
- Rejected for the first migration because the installed official Python integration already provides the required read and trade operations.

### Keep MT4 CSV files and only rename the UI

- Pros: smallest code change.
- Cons: does not connect the app to native MT5 and leaves stale-file failure modes.
- Rejected because it does not satisfy the migration objective.

## Consequences

- The bridge depends on a logged-in local MT5 terminal and the Python package.
- Adapter calls are process-boundary operations and require structured error handling.
- The app can use current MT5 data without an EA.
- The live trading flag must be enabled deliberately after demo/read-only validation.
- MT4 compatibility code can be removed later in a separate deprecation change.

## Source Basis

- MetaTrader 5 Python integration: https://www.mql5.com/en/docs/python_metatrader5
- `initialize`: https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- `order_check`: https://www.mql5.com/en/docs/python_metatrader5/mt5ordercheck_py
- `order_send`: https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py
