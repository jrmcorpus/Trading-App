/**
 * Settings Persistence Hook
 * Monitors settings changes and verifies they persist correctly
 */

import React, { useEffect, useRef, useState } from "react";
import { printSettingsDebugReport } from "../utils/debugSettings";

interface SettingsPersistenceStatus {
  isReady: boolean;
  hasErrors: boolean;
  errorCount: number;
  warnings: string[];
  lastVerifiedAt: string | null;
  settingsLoaded: {
    autoTrade: boolean;
    protect: boolean;
    profile: boolean;
    learning: boolean;
    orderForm: boolean;
    panels: boolean;
  };
}

/**
 * Hook to track settings persistence and verify they're being saved correctly
 */
export function useSettingsPersistence(): SettingsPersistenceStatus {
  const [status, setStatus] = useState<SettingsPersistenceStatus>({
    isReady: false,
    hasErrors: false,
    errorCount: 0,
    warnings: [],
    lastVerifiedAt: null,
    settingsLoaded: {
      autoTrade: false,
      protect: false,
      profile: false,
      learning: false,
      orderForm: false,
      panels: false,
    },
  });

  const checkIntervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Verify all settings exist and are valid
    const verifySettings = () => {
      const warnings: string[] = [];
      let errorCount = 0;
      const settingsLoaded = { ...status.settingsLoaded };

      const keys = [
        "assistant.autoTrade",
        "assistant.protect",
        "assistant.profile",
        "assistant.learning",
        "assistant.orderForm",
        "assistant.panels",
      ];

      for (const key of keys) {
        try {
          const value = window.localStorage.getItem(key);
          if (value !== null) {
            JSON.parse(value); // Verify it's valid JSON
            const shortKey = key.split(".")[1] as keyof typeof settingsLoaded;
            settingsLoaded[shortKey] = true;
          }
        } catch (e) {
          errorCount++;
          warnings.push(
            `Corrupted setting: ${key} - ${e instanceof Error ? e.message : "Invalid JSON"}`
          );
        }
      }

      // Check if localStorage itself is working
      try {
        const testKey = "__settings_test__";
        const testValue = Date.now().toString();
        window.localStorage.setItem(testKey, testValue);
        const retrieved = window.localStorage.getItem(testKey);
        if (retrieved !== testValue) {
          warnings.push("localStorage write/read mismatch detected");
          errorCount++;
        }
        window.localStorage.removeItem(testKey);
      } catch (e) {
        warnings.push(
          `localStorage not available: ${e instanceof Error ? e.message : "Unknown error"}`
        );
        errorCount++;
      }

      setStatus({
        isReady: true,
        hasErrors: errorCount > 0,
        errorCount,
        warnings,
        lastVerifiedAt: new Date().toISOString(),
        settingsLoaded,
      });
    };

    // Initial verification
    verifySettings();

    // Set up periodic checks every 5 seconds in development
    if (((import.meta) as any).env.MODE === "development") {
      checkIntervalRef.current = setInterval(verifySettings, 5000);
    }

    return () => {
      if (checkIntervalRef.current) {
        clearInterval(checkIntervalRef.current);
      }
    };
  }, []);

  return status;
}

/**
 * Debug component to display settings status
 * Add to your app to monitor settings persistence
 */
export function SettingsDebugPanel(): React.ReactNode {
  const status = useSettingsPersistence();
  const [isOpen, setIsOpen] = useState(false);

  if (((import.meta) as any).env.MODE !== "development") {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-3 py-2 rounded text-xs font-mono ${
          status.hasErrors
            ? "bg-red-600 hover:bg-red-700 text-white"
            : "bg-green-600 hover:bg-green-700 text-white"
        }`}
        title="Settings Debug Panel"
      >
        {status.hasErrors ? "WARN" : "OK"} Settings
      </button>

      {isOpen && (
        <div className="absolute bottom-12 right-0 bg-slate-900 border border-slate-700 rounded-lg p-4 w-96 max-h-96 overflow-y-auto text-xs font-mono text-slate-200 shadow-2xl">
          <div className="mb-3 pb-3 border-b border-slate-700">
            <div className="flex justify-between items-center gap-2">
              <h3 className="font-bold text-white">Settings Status</h3>
              <button
                onClick={() => {
                  printSettingsDebugReport();
                  console.log("Full report printed to console");
                }}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Details
              </button>
            </div>
          </div>

          <div className="space-y-1">
            <div>Ready: {status.isReady ? "YES" : "..."}</div>
            <div>
              Errors: {status.errorCount > 0 ? `FAIL ${status.errorCount}` : "OK"}
            </div>
            <div className="text-xs text-slate-400 mt-2">
              Last check:{" "}
              {status.lastVerifiedAt
                ? new Date(status.lastVerifiedAt).toLocaleTimeString()
                : "N/A"}
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-slate-700">
            <div className="font-bold mb-2 text-slate-300">Loaded Settings:</div>
            <div className="space-y-1">
              {Object.entries(status.settingsLoaded).map(([key, loaded]) => (
                <div key={key} className="text-xs">
                  {loaded ? "OK" : ".."} {key}
                </div>
              ))}
            </div>
          </div>

          {status.warnings.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <div className="font-bold mb-2 text-red-300">WARNINGS:</div>
              <div className="space-y-1 text-red-200">
                {status.warnings.map((w, i) => (
                  <div key={i} className="text-xs break-words">
                    - {w}
                  </div>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={() => window.location.reload()}
            className="mt-3 w-full px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-white"
          >
            Reload Page
          </button>
        </div>
      )}
    </div>
  );
}
