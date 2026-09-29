# Runtime Checklist

## Main Commands

- `npm.cmd run app:up`
- `npm.cmd run app:down`
- `npm.cmd run type-check`

## Main Endpoints

- `http://localhost:3000/index.html`
- `http://localhost:8787/health`
- `http://localhost:8787/api/mt4/headless/status`
- `http://localhost:8787/api/mt4/orders/open`
- `http://localhost:8787/api/mt4/history`

## Repo Runtime Files

- `package.json`
- `scripts/start-app.ps1`
- `scripts/stop-app.ps1`
- `vite.config.ts`
- `mt5_bridge/server.mjs`
- `mt5_bridge/headlessTrader.mjs`
- `mt5_bridge/headless-config.json`

## Common Failure Patterns

### Frontend up, runtime stale

Usually caused by:

- headless config not reloaded
- browser/local storage state rewriting config
- frontend label mismatch with symbol profile behavior

### Bridge healthy, trading behavior unchanged

Check:

- `symbolProfiles` in `/api/mt4/headless/status`
- whether `getEffectiveAutoConfig()` uses the symbol profile you changed

### Restart succeeded but nothing changed

Check:

- local cached settings in the app
- whether startup sync rewrote `headless-config.json`
- whether the top-level `auto` block differs from `symbolProfiles`
