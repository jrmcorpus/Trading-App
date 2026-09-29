# Native MT5 Migration Specification

## Objective

Replace the app's MT4 CSV/EA runtime dependency with the local native MetaTrader 5 Python integration while preserving the existing web app's risk-policy and prepare/confirm workflow.

The migrated bridge must provide live MT5 market data, account state, open positions, trade history, symbol specifications, and guarded order execution for market, pending, close, and stop-loss/take-profit modification requests.

## Assumptions

- The intended terminal is the installed XM Global MT5 terminal on the local Windows machine.
- The Python `MetaTrader5` package is available in the configured `MT5_BRIDGE_PYTHON` interpreter.
- The existing web application remains the client and the Node bridge remains the HTTP boundary.
- Existing UI route names may remain as compatibility aliases during migration; the data source and execution engine must be native MT5.
- No real order is submitted during implementation or automated verification.

## Safety Contract

- Native MT5 trading is disabled unless `MT5_TRADING_ENABLED=true` is explicitly configured.
- Every order still passes existing symbol, lot, SL/TP, RR, cooldown, open-trade, and daily-loss policy checks.
- The adapter must call MT5 `order_check` before `order_send`.
- Adapter errors must return structured, sanitized JSON and must not expose Python tracebacks or credentials.
- Tests use fakes and read-only terminal probes; they never call `order_send` against the connected account.

## Interface

The bridge exposes the existing compatibility routes and native aliases:

- `GET /health` and `GET /api/mt5/health`
- `GET /api/mt5/candles`
- `GET /api/mt5/account`
- `GET /api/mt5/orders/open`
- `GET /api/mt5/history`
- `GET /api/mt5/ticks`
- `GET /api/mt5/symbols`
- `POST /api/mt5/orders/prepare`
- `POST /api/mt5/orders/policy-check`
- `POST /api/mt5/orders/confirm`

The existing `/api/mt4/*` routes remain aliases during the migration so current UI code and headless workflows do not break. Their responses are sourced from MT5 when `MT5_BRIDGE_MODE=native`.

## Project Structure

- `mt5_bridge/mt5_adapter.py` — isolated Python adapter for terminal reads and guarded trade operations.
- `mt5_bridge/fetch_mt5_rates.py` — retained candle compatibility wrapper, fixed for current named-tuple/NumPy rows.
- `mt5_bridge/server.mjs` — Node HTTP, risk-policy, confirmation, and adapter process boundary.
- `src/` — existing React UI; route aliases preserve current consumers during the first migration slice.
- `docs/decisions/ADR-001-native-mt5-python-adapter.md` — architecture rationale.

## Testing Strategy

- Python `unittest` tests cover request validation, symbol/timeframe mapping, named-tuple serialization, history grouping, and order request construction with a fake MT5 module.
- Node type-check/build validates the bridge-facing frontend contract.
- Read-only integration probes validate MT5 initialization, terminal connectivity, account data, symbols, ticks, and candles.
- Order execution is verified only with fake adapter responses and `order_check`; no live `order_send` call is used in development verification.

## Commands

```text
python -m unittest discover -s mt5_bridge -p "test_*.py"
npm run type-check
npm run build
npm run app:up
```

## Success Criteria

- The bridge health response identifies native MT5 mode and terminal connectivity.
- Account, positions, history, ticks, candles, and symbol specifications come from MT5 rather than MT4 files.
- The existing prepare/confirm flow can construct native MT5 market, pending, close, and modify requests.
- Native execution is blocked by default and can only be enabled explicitly.
- The frontend continues to load and the headless runtime receives MT5-backed callbacks.
- Automated tests and type/build checks pass.

## Boundaries

- Always: preserve existing user edits, validate all request inputs, enforce risk policy, and keep live trading gated.
- Ask first: changing the connected account, broker terminal path, risk limits, or enabling the live-trading flag.
- Never: commit `.env.local`, print credentials, bypass `order_check`, or submit an unrequested real trade.
