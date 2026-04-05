# Settings Persistence & Debug Guide

## Overview

This guide will help you verify that your Trading App settings are being properly saved to local storage and are effective.

## Quick Start - Verify Settings Now

### 1. Open Browser Console
- Press **F12** or **Ctrl+Shift+I** to open Developer Tools
- Go to the **Console** tab

### 2. Run Quick Check
Paste this in the console:
```javascript
import { quickSettingsCheck } from './src/__tests__/settingsTests.ts'
await quickSettingsCheck()
```

This will print a quick report showing:
- ✅/❌ localStorage availability
- ✅/❌ Settings validity
- ℹ️ Number of settings initialized

### 3. View Full Settings Report
Paste this in the console:
```javascript
import { printSettingsDebugReport } from './src/utils/debugSettings.ts'
printSettingsDebugReport()
```

This will print a detailed report of ALL settings with:
- 📊 Settings Status (exists, size, valid JSON)
- ⚠️ Warnings (any corrupted data)
- 💡 Recommendations (what to fix)

## Complete Test Suite

### Run Full Tests
To run comprehensive tests of the localStorage system:

```javascript
import { runSettingsTests } from './src/__tests__/settingsTests.ts'
await runSettingsTests()
```

This will execute 12 tests covering:
- ✅ localStorage availability
- ✅ Write/read operations
- ✅ Persistence across operations
- ✅ JSON parsing
- ✅ Large values
- ✅ Concurrent operations
- And more...

## Monitoring Settings in Real-Time

### Add Debug Panel to App
Import the debug panel in your main App.tsx:

```tsx
import { SettingsDebugPanel } from "./hooks/useSettingsPersistence";

export function App() {
  return (
    <>
      {/* Your existing components */}
      <SettingsDebugPanel />
    </>
  );
}
```

This adds a floating debug panel in the bottom-right corner (development mode only) that shows:
- 📌 Settings status indicator (✅ green / ⚠️ red)
- 📊 Individual setting load status
- 💡 Real-time verification results
- 🔍 Quick access to full debug report

### Watch Specific Settings
Monitor changes to a specific setting in the console:

```javascript
import { watchSetting } from './src/utils/debugSettings.ts'

// Watch autoTrade setting for changes
const unwatch = watchSetting('assistant.autoTrade', (newValue, oldValue) => {
  console.log('autoTrade changed:', { oldValue, newValue })
})

// Stop watching when done
unwatch()
```

## Verify Individual Settings

### Check if a Setting was Applied
```javascript
import { verifySetting } from './src/utils/debugSettings.ts'

// Example: Verify autoTrade was saved with specific values
const expectedValue = {
  enabled: true,
  minConfidence: 65,
  minWinRate: 65,
}

const isVerified = await verifySetting('assistant.autoTrade', expectedValue)
console.log(isVerified ? '✅ Setting applied' : '❌ Setting NOT applied')
```

### Export All Settings
Backup or inspect all settings:
```javascript
import { exportSettingsBundle } from './src/utils/debugSettings.ts'

const allSettings = exportSettingsBundle()
console.log(allSettings)

// Save to file
const blob = new Blob([JSON.stringify(allSettings, null, 2)], { type: 'application/json' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'settings-backup.json'
a.click()
```

## Troubleshooting

### ❌ Settings Not Persisting?

**Issue**: Changes to settings aren't being saved

**Check 1: localStorage is enabled**
```javascript
try {
  localStorage.setItem('test', 'value')
  localStorage.removeItem('test')
  console.log('✅ localStorage works')
} catch (e) {
  console.error('❌ localStorage disabled:', e)
}
```

**Check 2: Not in Private/Incognito mode**
- Some browsers restrict storage in private mode
- Try normal browsing mode

**Check 3: Browser storage quota**
```javascript
// Check available quota (Chrome/Edge)
const estimate = await navigator.storage.estimate()
console.log(`Used: ${(estimate.usage / 1e6).toFixed(2)}MB / Available: ${(estimate.quota / 1e6).toFixed(2)}MB`)
```

**Check 4: Clear corrupted settings**
```javascript
// ⚠️ WARNING: This clears all settings!
import { clearAllSettings } from './src/utils/debugSettings.ts'
clearAllSettings()
// Then reload the page
location.reload()
```

### ⚠️ Corrupted Settings?

**Issue**: Settings exist but contain invalid data

The debug report will show warnings like:
```
⚠️ Setting "assistant.autoTrade" contains invalid JSON: Unexpected token
```

**Fix**: Clear the corrupt setting
```javascript
// Option 1: Clear one setting
localStorage.removeItem('assistant.autoTrade')

// Option 2: Clear all and reload
import { clearAllSettings } from './src/utils/debugSettings.ts'
clearAllSettings()
location.reload()
```

### 📊 Settings Aren't Loading?

**Issue**: Settings show as "not initialized"

This is normal on first load. Settings are created when:
1. You visit the Trading Assistant panel
2. You save a trade
3. You change any settings

**Check**: Are they loading after first interaction?
```javascript
// Run this after using the app for a bit
import { printSettingsDebugReport } from './src/utils/debugSettings.ts'
printSettingsDebugReport()
```

## Understanding Settings Structure

### Storage Keys

```
assistant.autoTrade      → Auto-trading settings
assistant.protect        → Trade protection settings  
assistant.profile        → Account profile (MICRO/STANDARD)
assistant.learning       → Adaptive learning settings
assistant.orderForm      → Last used order form values
assistant.panels         → Chart panel preferences

journal.manualTrades.v1  → Manual trade journal
```

### Example Setting Values

**autoTrade**:
```json
{
  "enabled": true,
  "minConfidence": 65,
  "minWinRate": 65,
  "minRR": 1.8,
  "cooldownMin": 15,
  "maxOpenTrades": 2
}
```

**protect**:
```json
{
  "enabled": true,
  "timeframe": "H4",
  "overnightEnabled": true,
  "overnightProfitUsd": 50,
  "overnightLossUsd": -25
}
```

## Settings Size & Limits

| Setting | Typical Size | Max Size |
|---------|--------------|----------|
| autoTrade | 500-2KB | 10KB |
| protect | 1-2KB | 10KB |
| orderForm | 200-500B | 5KB |
| panels | 100B | 1KB |
| manualTrades | Varies | 5MB |

**Total typical usage**: 10-50KB
**Browser localStorage limit**: Usually 5-10MB per domain

## Forcing Settings to Sync

If settings appear to be stuck:

```javascript
// Force a hard reset of all settings
const hardReset = () => {
  const keys = [
    'assistant.autoTrade',
    'assistant.protect',
    'assistant.profile',
    'assistant.learning',
    'assistant.orderForm',
    'assistant.panels',
  ]
  
  keys.forEach(key => {
    localStorage.removeItem(key)
    console.log(`Cleared: ${key}`)
  })
  
  // Reload to reinitialize
  setTimeout(() => window.location.reload(), 500)
}

hardReset()
```

## Advanced: Custom Monitoring

### Set Up Continuous Monitoring
```javascript
import { watchSetting } from './src/utils/debugSettings.ts'

// Monitor all settings
const unwatchers = [
  watchSetting('assistant.autoTrade', (val) => {
    console.log('[autoTrade update]', val)
  }),
  watchSetting('assistant.protect', (val) => {
    console.log('[protect update]', val)
  }),
]

// Stop all when done
// unwatchers.forEach(fn => fn())
```

### Log Settings Every 10 Seconds
```javascript
setInterval(() => {
  import('./src/utils/debugSettings.ts').then(m => {
    const report = m.generateSettingsDebugReport()
    console.clear()
    console.log('Settings Health Check:', new Date().toLocaleTimeString())
    console.table(report.settings)
    if (report.warnings.length) console.warn('Warnings:', report.warnings)
  })
}, 10000)
```

## Still Having Issues?

1. **Open Console** (F12 → Console tab)
2. **Run Quick Check**:
   ```javascript
   import { quickSettingsCheck } from './src/__tests__/settingsTests.ts'
   await quickSettingsCheck()
   ```
3. **Check output** for ❌ errors
4. **Share the error** in your bug report

## Summary

Your settings are stored in browser localStorage with these utilities:
- ✅ **Auto-save** - Changes save automatically
- ✅ **Auto-load** - Settings load on page refresh
- ✅ **Verification** - Tools to confirm persistence
- ✅ **Recovery** - Tools to fix corrupted data

Use the debug tools above to verify everything is working correctly!
