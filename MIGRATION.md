# Migration Guide

Use this guide to move `Trading-App` to another PC and make it behave like the original machine.

## What Must Transfer

You need more than just the Git repo.

Copy or prepare these items from the old PC:

- The Git repo: `Trading-App`
- Your local environment file: `.env.local`
- Your exported settings bundle: `trading-settings-bundle-*.json`
- Your MT4 setup:
  - same broker/account login
  - same EA/exporter attached in MT4
  - same bridge output folder pattern under `MQL4\Files`

## Why This Is Needed

This app stores state in multiple places:

- Git repo: source code only
- `.env.local`: machine-specific config such as `MT4_BRIDGE_FILES_DIR`
- Browser local storage: Trading Assistant settings
- `mt5_bridge/headless-config.json`: headless trader config
- MT4 `MQL4\Files`: live bridge CSV files

Cloning the repo alone will not restore the full working setup.

## New PC Setup

1. Install prerequisites

- Install Node.js 18+
- Install Git
- Install MT4

2. Clone and install

```powershell
git clone https://github.com/jrmcorpus/Trading-App.git
cd Trading-App
npm install
```

3. Copy your local environment file

- Copy `.env.local` from the old PC into the repo root on the new PC

4. Update the MT4 bridge path

In `.env.local`, set the correct MT4 files directory for the new PC:

```env
MT4_BRIDGE_FILES_DIR=C:\Users\<NEW-PC-USER>\AppData\Roaming\MetaQuotes\Terminal\<TERMINAL_ID>\MQL4\Files
```

Keep the rest of the symbol mapping and trading settings unless your broker setup changed.

5. Set up MT4 on the new PC

- Log into the same broker/account
- Compile and attach `mt5_bridge/MT4_Execution_EA.mq4`
- Confirm MT4 is writing bridge files into the `MQL4\Files` folder

Expected files include:

- `bridge_positions.csv`
- `bridge_history.csv`
- `bridge_account.csv`
- `bridge_symbols.csv`
- `bridge_policy.csv`

6. Start the app

```powershell
npm run app:up
```

This starts:

- the local MT4 bridge
- the Vite app

7. Import your saved app settings

- Open the app in the browser
- Go to `Trading Assistant`
- Click `Import Settings`
- Select your exported `trading-settings-bundle-*.json`

This restores browser-side Trading Assistant settings and syncs bundled headless config back into the bridge.

## Verify Everything

Check these before using auto-trade:

- The app loads normally
- MT4 bridge is connected
- Account data and positions appear
- Gold symbol mapping is correct, for example `GOLDm#`
- The watchlist and Trading Assistant settings match the old PC
- The intended runtime mode is selected

If you want headless-only overnight trading:

- runtime should be `HEADLESS`
- browser auto-trade should be off
- new managed trades should use the headless comment tag, not `ai-auto-*`

## Common Problems

### App opens but no MT4 data

Usually one of these:

- `MT4_BRIDGE_FILES_DIR` is wrong
- MT4 is not running
- the EA is not attached
- MT4 is writing to a different terminal folder than expected

### Settings look wrong after clone

Usually one of these:

- you did not import the settings bundle
- browser local storage is empty on the new PC
- old cached browser settings were restored instead of the intended preset

### Trades use the wrong mode

If you see comments like `ai-auto-M5` or `ai-auto-M15`, the browser auto-trader is active.

If you want headless overnight mode, switch to `HEADLESS` and verify new trades use the headless comment tag.

## Recommended Transfer Checklist

Before leaving the old PC:

- Export Trading Assistant settings
- Save a copy of `.env.local`
- Confirm MT4 broker symbol names and suffixes

After setting up the new PC:

- Import the settings bundle
- Verify `.env.local`
- Verify MT4 bridge files are updating
- Run one manual connectivity check before enabling automation
