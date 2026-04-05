/**
 * Settings Debug & Verification Utility
 * Checks if settings are properly saved and applied in local storage
 */

export const SETTINGS_DEBUG_KEYS = {
  assistant: {
    autoTrade: "assistant.autoTrade",
    protect: "assistant.protect",
    profile: "assistant.profile",
    learning: "assistant.learning",
    orderForm: "assistant.orderForm",
    panels: "assistant.panels",
  },
  journal: {
    manualTrades: "journal.manualTrades.v1",
  },
};

export interface SettingsDebugReport {
  timestamp: string;
  storageAvailable: boolean;
  totalSize: number;
  settings: {
    key: string;
    exists: boolean;
    size: number;
    isValidJson: boolean;
    preview: string;
    error?: string;
  }[];
  warnings: string[];
  recommendations: string[];
}

/**
 * Generate a comprehensive debug report of all settings in localStorage
 */
export function generateSettingsDebugReport(): SettingsDebugReport {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const settings = [];
  let totalSize = 0;

  if (typeof window === "undefined") {
    return {
      timestamp: new Date().toISOString(),
      storageAvailable: false,
      totalSize: 0,
      settings: [],
      warnings: ["Window object not available (likely SSR context)"],
      recommendations: [],
    };
  }

  let storageAvailable = false;
  try {
    const testKey = "__storage_test__";
    window.localStorage.setItem(testKey, "test");
    window.localStorage.removeItem(testKey);
    storageAvailable = true;
  } catch (e) {
    warnings.push(
      `localStorage not available: ${e instanceof Error ? e.message : "Unknown error"}`
    );
  }

  if (!storageAvailable) {
    return {
      timestamp: new Date().toISOString(),
      storageAvailable: false,
      totalSize: 0,
      settings: [],
      warnings,
      recommendations: [
        "Enable localStorage in your browser",
        "Check if you're in private/incognito mode (might restrict storage)",
        "Verify browser storage quota is not exceeded",
      ],
    };
  }

  // Check all known settings keys
  const allKeys = Object.values(SETTINGS_DEBUG_KEYS).flatMap((category) =>
    Object.values(category)
  );

  for (const key of allKeys) {
    const value = window.localStorage.getItem(key);
    const size = value ? new TextEncoder().encode(value).length : 0;
    totalSize += size;

    let isValidJson = false;
    let preview = "";
    let error: string | undefined;

    if (value === null) {
      preview = "[NOT SET]";
    } else {
      try {
        const parsed = JSON.parse(value);
        isValidJson = true;
        preview = JSON.stringify(parsed, null, 2).substring(0, 150) + "...";
      } catch (e) {
        isValidJson = false;
        preview = value.substring(0, 100) + (value.length > 100 ? "..." : "");
        error = e instanceof Error ? e.message : "Invalid JSON";
        warnings.push(
          `⚠️ Setting "${key}" contains invalid JSON: ${error}`
        );
        recommendations.push(
          `Clear corrupted setting: localStorage.removeItem('${key}')`
        );
      }
    }

    settings.push({
      key,
      exists: value !== null,
      size,
      isValidJson,
      preview,
      error,
    });
  }

  // Check for any unexpected large items
  let unexpectedSize = 0;
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && !allKeys.includes(key)) {
      const value = window.localStorage.getItem(key);
      const size = value ? new TextEncoder().encode(value).length : 0;
      unexpectedSize += size;
      if (size > 10000) {
        warnings.push(
          `🔍 Unexpected large item in storage: "${key}" (${size} bytes)`
        );
      }
    }
  }

  // Generate recommendations
  const missingSettings = settings.filter((s) => !s.exists);
  if (missingSettings.length > 0) {
    recommendations.push(
      `ℹ️ ${missingSettings.length} settings not yet initialized (will be created on first use)`
    );
  }

  const invalidSettings = settings.filter((s) => !s.isValidJson && s.exists);
  if (invalidSettings.length > 0) {
    recommendations.push(
      `❌ Clear invalid settings: ${invalidSettings.map((s) => `localStorage.removeItem('${s.key}')`).join("; ")}`
    );
  }

  return {
    timestamp: new Date().toISOString(),
    storageAvailable,
    totalSize,
    settings,
    warnings,
    recommendations,
  };
}

/**
 * Print debug report to console in readable format
 */
export function printSettingsDebugReport(): void {
  const report = generateSettingsDebugReport();

  console.group("🔧 Trading App Settings Debug Report");
  console.log("Timestamp:", report.timestamp);
  console.log("Storage Available:", report.storageAvailable);
  console.log("Total Settings Size:", report.totalSize, "bytes");

  console.group("Settings Status");
  for (const setting of report.settings) {
    const status = setting.exists
      ? setting.isValidJson
        ? "✅"
        : "⚠️"
      : "ℹ️";
    console.log(
      `${status} ${setting.key} (${setting.size} bytes)`,
      setting.preview
    );
    if (setting.error) {
      console.error(`   Error: ${setting.error}`);
    }
  }
  console.groupEnd();

  if (report.warnings.length > 0) {
    console.group("⚠️ Warnings");
    report.warnings.forEach((w) => console.warn(w));
    console.groupEnd();
  }

  if (report.recommendations.length > 0) {
    console.group("💡 Recommendations");
    report.recommendations.forEach((r) => console.info(r));
    console.groupEnd();
  }

  console.groupEnd();
}

/**
 * Watch for real-time changes to a specific setting
 */
export function watchSetting(
  key: string,
  callback: (newValue: any, oldValue: any) => void
): () => void {
  if (typeof window === "undefined") return () => {};

  let lastValue = window.localStorage.getItem(key);

  const checkInterval = setInterval(() => {
    const currentValue = window.localStorage.getItem(key);
    if (currentValue !== lastValue) {
      try {
        const newValue = currentValue ? JSON.parse(currentValue) : null;
        const oldValue = lastValue ? JSON.parse(lastValue) : null;
        callback(newValue, oldValue);
        lastValue = currentValue;
      } catch (e) {
        console.error(`Failed to parse ${key}:`, e);
      }
    }
  }, 100);

  return () => clearInterval(checkInterval);
}

/**
 * Verify that a setting change was actually persisted
 */
export async function verifySetting(
  key: string,
  expectedValue: any
): Promise<boolean> {
  if (typeof window === "undefined") return false;

  // Check immediate
  const current = window.localStorage.getItem(key);
  const currentParsed = current ? JSON.parse(current) : null;

  if (JSON.stringify(currentParsed) === JSON.stringify(expectedValue)) {
    console.log(`✅ Setting "${key}" verified immediately`);
    return true;
  }

  console.warn(
    `⚠️ Setting "${key}" not verified immediately. Expected:`,
    expectedValue,
    "Got:",
    currentParsed
  );

  // Try waiting a bit for async updates
  await new Promise((resolve) => setTimeout(resolve, 100));

  const afterWait = window.localStorage.getItem(key);
  const afterWaitParsed = afterWait ? JSON.parse(afterWait) : null;

  if (JSON.stringify(afterWaitParsed) === JSON.stringify(expectedValue)) {
    console.log(`✅ Setting "${key}" verified after async wait`);
    return true;
  }

  console.error(
    `❌ Setting "${key}" verification FAILED. Expected:`,
    expectedValue,
    "Got:",
    afterWaitParsed
  );
  return false;
}

/**
 * Export all settings as a JSON bundle
 */
export function exportSettingsBundle(): Record<string, any> {
  if (typeof window === "undefined") return {};

  const allKeys = Object.values(SETTINGS_DEBUG_KEYS).flatMap((category) =>
    Object.values(category)
  );

  return Object.fromEntries(
    allKeys.map((key) => {
      const value = window.localStorage.getItem(key);
      return [key, value ? JSON.parse(value) : null];
    })
  );
}

/**
 * Clear all app settings from localStorage  (DESTRUCTIVE - use with caution!)
 */
export function clearAllSettings(): void {
  if (typeof window === "undefined") return;

  const allKeys = Object.values(SETTINGS_DEBUG_KEYS).flatMap((category) =>
    Object.values(category)
  );

  for (const key of allKeys) {
    window.localStorage.removeItem(key);
    console.log(`Cleared: ${key}`);
  }

  console.warn("✅ All settings cleared. Refresh the page to reset.");
}

// Auto-run debug report on module load in development
if (
  typeof window !== "undefined" &&
  import.meta.env.DEV &&
  (window as any).__ENABLE_SETTINGS_DEBUG__
) {
  console.log("🔧 Settings Debug Mode Enabled - Run printSettingsDebugReport() for full report");
}
