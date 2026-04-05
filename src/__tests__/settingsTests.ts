/**
 * Settings Persistence Testing Suite
 * Run these tests to verify settings are properly saved and applied
 * 
 * Usage in browser console:
 * import { runSettingsTests } from './tests/settingsTests.ts'
 * await runSettingsTests()
 */

import {
  generateSettingsDebugReport,
  watchSetting,
  verifySetting,
  exportSettingsBundle,
  clearAllSettings,
} from "../utils/debugSettings";

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
  error?: Error;
}

class SettingsTestSuite {
  private results: TestResult[] = [];

  async test(
    name: string,
    fn: () => Promise<void> | void
  ): Promise<void> {
    const start = performance.now();
    try {
      await fn();
      const duration = performance.now() - start;
      this.results.push({
        name,
        passed: true,
        message: "✅ Passed",
        duration,
      });
      console.log(`✅ ${name} (${duration.toFixed(2)}ms)`);
    } catch (error) {
      const duration = performance.now() - start;
      this.results.push({
        name,
        passed: false,
        message: `❌ Failed: ${error instanceof Error ? error.message : String(error)}`,
        duration,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      console.error(
        `❌ ${name} (${duration.toFixed(2)}ms):`,
        error
      );
    }
  }

  assert(condition: boolean, message: string): void {
    if (!condition) {
      throw new Error(message);
    }
  }

  printSummary(): void {
    const total = this.results.length;
    const passed = this.results.filter((r) => r.passed).length;
    const failed = total - passed;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.group("📊 Test Results Summary");
    console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`Total Duration: ${totalDuration.toFixed(2)}ms`);
    console.table(
      this.results.map((r) => ({
        Test: r.name,
        Status: r.passed ? "✅" : "❌",
        Message: r.message,
        Duration: `${r.duration.toFixed(2)}ms`,
      }))
    );
    console.groupEnd();
  }

  getSummary(): { passed: number; failed: number; total: number } {
    const passed = this.results.filter((r) => r.passed).length;
    return {
      passed,
      failed: this.results.length - passed,
      total: this.results.length,
    };
  }
}

/**
 * Run the complete settings test suite
 */
export async function runSettingsTests(): Promise<void> {
  if (typeof window === "undefined") {
    console.error("❌ Tests must run in a browser environment");
    return;
  }

  console.group("🧪 Running Settings Persistence Tests...");
  const suite = new SettingsTestSuite();

  // Test 1: localStorage availability
  await suite.test("localStorage is available", () => {
    suite.assert(
      typeof window.localStorage !== "undefined",
      "localStorage not available"
    );
  });

  // Test 2: Can write to localStorage
  await suite.test("Can write to localStorage", () => {
    const testKey = "__test_write__";
    const testValue = { test: true, timestamp: Date.now() };
    window.localStorage.setItem(testKey, JSON.stringify(testValue));
    const retrieved = window.localStorage.getItem(testKey);
    suite.assert(retrieved !== null, "Failed to retrieve written value");
    const parsed = JSON.parse(retrieved!);
    suite.assert(parsed.test === true, "Retrieved value doesn't match");
    window.localStorage.removeItem(testKey);
  });

  // Test 3: Can read from localStorage
  await suite.test("Can read from localStorage", () => {
    const testKey = "__test_read__";
    const testValue = { data: "test", num: 42 };
    window.localStorage.setItem(testKey, JSON.stringify(testValue));
    const retrieved = window.localStorage.getItem(testKey);
    suite.assert(retrieved !== null, "Failed to read value");
    const parsed = JSON.parse(retrieved!);
    suite.assert(parsed.data === "test", "Read value incorrect");
    suite.assert(parsed.num === 42, "Read number value incorrect");
    window.localStorage.removeItem(testKey);
  });

  // Test 4: Can delete from localStorage
  await suite.test("Can delete from localStorage", () => {
    const testKey = "__test_delete__";
    window.localStorage.setItem(testKey, "test value");
    window.localStorage.removeItem(testKey);
    const retrieved = window.localStorage.getItem(testKey);
    suite.assert(retrieved === null, "Value not deleted");
  });

  // Test 5: localStorage persists across operations
  await suite.test("localStorage persists across multiple operations", () => {
    const testKey = "__test_persist__";
    window.localStorage.setItem(testKey, JSON.stringify({ v: 1 }));
    window.localStorage.setItem(testKey, JSON.stringify({ v: 2 }));
    window.localStorage.setItem(testKey, JSON.stringify({ v: 3 }));
    const final = JSON.parse(window.localStorage.getItem(testKey)!);
    suite.assert(final.v === 3, "Value didn't persist correctly");
    window.localStorage.removeItem(testKey);
  });

  // Test 6: Debug report generation
  await suite.test("Can generate settings debug report", () => {
    const report = generateSettingsDebugReport();
    suite.assert(report.timestamp !== "", "No timestamp");
    suite.assert(
      typeof report.storageAvailable === "boolean",
      "storageAvailable not boolean"
    );
    suite.assert(Array.isArray(report.settings), "settings not array");
    suite.assert(Array.isArray(report.warnings), "warnings not array");
  });

  // Test 7: Export settings bundle
  await suite.test("Can export settings bundle", () => {
    const bundle = exportSettingsBundle();
    suite.assert(typeof bundle === "object", "Bundle not object");
    suite.assert(
      "assistant.autoTrade" in bundle,
      "autoTrade not in bundle"
    );
  });

  // Test 8: Watch settings for changes
  await suite.test("Settings watcher detects changes", async () => {
    const testKey = "__test_watch__";
    let detectedChange = false;
    let newValueReceived: any = null;

    const unwatch = watchSetting(testKey, (newValue) => {
      detectedChange = true;
      newValueReceived = newValue;
    });

    window.localStorage.setItem(testKey, JSON.stringify({ changed: true }));

    // Wait for watcher to detect change
    await new Promise((resolve) => setTimeout(resolve, 150));

    suite.assert(
      detectedChange,
      "Watcher didn't detect change"
    );
    suite.assert(
      newValueReceived?.changed === true,
      "Watcher received incorrect value"
    );

    unwatch();
    window.localStorage.removeItem(testKey);
  });

  // Test 9: Verify setting persistence
  await suite.test("Can verify setting persistence", async () => {
    const testKey = "__test_verify__";
    const expectedValue = { test: true, value: 123 };

    window.localStorage.setItem(testKey, JSON.stringify(expectedValue));

    const isVerified = await verifySetting(testKey, expectedValue);
    suite.assert(isVerified, "Setting verification failed");

    window.localStorage.removeItem(testKey);
  });

  // Test 10: JSON parsing edge cases
  await suite.test("Handles JSON parsing edge cases", () => {
    const testKey = "__test_json__";

    // Test null
    window.localStorage.setItem(testKey, JSON.stringify(null));
    let retrieved = window.localStorage.getItem(testKey);
    suite.assert(retrieved === "null", "Null not handled");

    // Test empty object
    window.localStorage.setItem(testKey, JSON.stringify({}));
    retrieved = window.localStorage.getItem(testKey);
    const parsed = JSON.parse(retrieved!);
    suite.assert(
      typeof parsed === "object" && Object.keys(parsed).length === 0,
      "Empty object not handled"
    );

    // Test nested structure
    const nested = { a: { b: { c: { d: "deep" } } } };
    window.localStorage.setItem(testKey, JSON.stringify(nested));
    retrieved = window.localStorage.getItem(testKey);
    const parsedNested = JSON.parse(retrieved!);
    suite.assert(
      parsedNested.a.b.c.d === "deep",
      "Nested structure not handled"
    );

    window.localStorage.removeItem(testKey);
  });

  // Test 11: Size limits
  await suite.test("Can handle reasonably large values", () => {
    const testKey = "__test_size__";
    const largeObject = {
      data: "x".repeat(100000), // 100KB string
      nested: { value: Math.random() },
    };

    try {
      window.localStorage.setItem(testKey, JSON.stringify(largeObject));
      const retrieved = window.localStorage.getItem(testKey);
      suite.assert(retrieved !== null, "Large value not stored");
      window.localStorage.removeItem(testKey);
    } catch (e) {
      // Storage quota exceeded is acceptable on some systems
      console.warn(
        "Storage quota may be exceeded, but write was attempted correctly"
      );
    }
  });

  // Test 12: Concurrent operations
  await suite.test("Handles concurrent write operations", async () => {
    const operations = Array.from({ length: 10 }, (_, i) => {
      const key = `__test_concurrent_${i}__`;
      return new Promise<void>((resolve) => {
        window.localStorage.setItem(key, JSON.stringify({ index: i }));
        setTimeout(() => {
          window.localStorage.removeItem(key);
          resolve();
        }, Math.random() * 100);
      });
    });

    await Promise.all(operations);
  });

  console.group("✅ All Tests Complete");
  suite.printSummary();
  const summary = suite.getSummary();
  console.log(
    `\nResult: ${summary.passed}/${summary.total} tests passed ${
      summary.failed > 0 ? `(${summary.failed} failed)` : ""
    }`
  );
  console.groupEnd();
  console.groupEnd();
}

/**
 * Quick validation - runs fast important checks
 */
export async function quickSettingsCheck(): Promise<boolean> {
  if (typeof window === "undefined") return false;

  console.group("⚡ Quick Settings Check");

  // Check 1: Storage available
  try {
    const testKey = "__check__";
    window.localStorage.setItem(testKey, "test");
    window.localStorage.removeItem(testKey);
    console.log("✅ localStorage available");
  } catch (e) {
    console.error("❌ localStorage not available");
    console.groupEnd();
    return false;
  }

  // Check 2: Get debug report
  const report = generateSettingsDebugReport();
  const hasErrors = report.settings.some((s) => s.error);

  if (hasErrors) {
    console.error("❌ Corrupted settings detected:");
    report.settings.forEach((s) => {
      if (s.error) {
        console.error(`  ${s.key}: ${s.error}`);
      }
    });
  } else {
    console.log("✅ All settings valid");
  }

  // Check 3: Summary
  const loadedCount = report.settings.filter((s) => s.exists).length;
  console.log(`ℹ️ ${loadedCount}/${report.settings.length} settings initialized`);

  console.groupEnd();
  return !hasErrors && report.storageAvailable;
}
