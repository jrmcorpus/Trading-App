# Bridge Surface

## Main Files

- `mt5_bridge/server.mjs`
- `mt5_bridge/MT4_Execution_EA.mq4`
- `mt5_bridge/MT4_Candle_Exporter.mq4`
- `mt5_bridge/MT4_EXECUTION_EA_GUIDE.md`

## Main Endpoints

- `/health`
- `/api/mt4/candles`
- `/api/mt4/ticks`
- `/api/mt4/orders/open`
- `/api/mt4/history`
- `/api/mt4/headless/status`
- `/api/mt4/symbols`

## Common Diagnostic Sequence

1. Check `/health`
2. Check `/api/mt4/headless/status`
3. Compare `/api/mt4/candles?symbol=...`
4. Compare `/api/mt4/ticks?symbol=...`
5. Compare `/api/mt4/orders/open`
6. Compare `/api/mt4/history`

## Known Repo Behaviors

- Manual pending orders may not appear in the web app until filled.
- Bridge issues often show up as symbol family mismatches.
- The UI can appear wrong when candles and ticks resolve different broker symbols.
