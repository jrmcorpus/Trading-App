# Native MT5 Migration Plan

## Phase 1: Adapter foundation

- Add a Python adapter with JSON input/output and read-only actions.
- Normalize MT5 named tuples and NumPy rows into the bridge's existing response shapes.
- Add fake-module unit tests.

Checkpoint: adapter tests pass; direct read-only MT5 probe returns connected terminal, candles, account, and ticks.

## Phase 2: Native bridge routing

- Add a native-mode switch and adapter runner in Node.
- Route account, positions, history, ticks, candles, symbols, and symbol resolution through MT5 in native mode.
- Keep MT4 endpoints as compatibility aliases and add `/api/mt5/*` equivalents.
- Expose connection freshness and trading-gate state in health.

Checkpoint: bridge API reads current MT5 state and no longer depends on stale MT4 CSV files in native mode.

## Phase 3: Guarded execution

- Map market, pending, close, and modify requests to MT5 trade actions.
- Apply symbol normalization, volume step/min/max, price precision, and filling-mode rules from MT5 symbol metadata.
- Run `order_check` before `order_send`; reject unless the explicit trading gate is enabled.
- Preserve the existing prepare/confirm and risk-policy workflow.

Checkpoint: fake execution tests cover all actions and real terminal verification stops before `order_send`.

## Phase 4: Headless and frontend compatibility

- Feed headless callbacks from the native MT5 adapters.
- Update health/status metadata and user-visible source labels/configuration without breaking existing routes.
- Add MT5 environment examples and migration documentation.

Checkpoint: app loads, type-checks, builds, and headless status reports MT5 mode.

## Phase 5: Final audit

- Run Python tests, type-check, build, lint where available, and read-only runtime probes.
- Inspect diffs for secrets and unintended changes.
- Review remaining MT4 references and clearly identify compatibility-only code.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| MT5 netting vs hedging account semantics | Close/modify may target the wrong position | Use explicit position ticket and returned symbol/type; test both shapes where possible |
| Broker-specific symbol suffixes | Orders/data fail to resolve | Resolve from `symbols_get()` and use exact MT5 broker symbol |
| Volume/price constraints | Server rejects orders | Normalize against `volume_min`, `volume_step`, `digits`, and tick metadata |
| Real-trading side effects | Financial loss | Default gate false, prepare/confirm, `order_check`, no live order in tests |
| Existing uncommitted user edits | Accidental overwrite | Patch only targeted additions and preserve current working tree |
