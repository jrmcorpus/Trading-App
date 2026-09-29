import fs from "node:fs";
import fsPromises from "node:fs/promises";
import { randomUUID } from "node:crypto";

const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"];
const CRYPTO_ASSETS = ["BTCUSD", "ETHUSD", "XRPUSD", "LTCUSD", "BNBUSD", "ADAUSD", "DOGEUSD", "SOLUSD"];
const DEFAULT_WATCHLIST = [
  { symbol: "GOLD", timeframe: "M5" },
  { symbol: "ETHUSD", timeframe: "M15" },
];
const DEFAULT_AUTO_CONFIG = {
  enabled: true,
  sideFilter: "BOTH",
  minConfidence: 30,
  minWinRate: 0,
  minRR: 1.0,
  maxSpreadPoints: 80,
  cooldownMin: 60,
  maxOpenTrades: 2,
  requireStrong: true,
  enforceTrendStack: false,
  enforceSymbolCooldown: true,
  enforceDailyLossLimit: true,
  enforceHardRiskBlock: true,
  strategyMode: "SCALP_M15",
  scalpAggressive: true,
  sessionGateEnabled: true,
  biasTimeframe: "H4",
  setupTimeframe: "H1",
  entryTimeframe: "M5",
  reentryMode: "OFF",
  timeframeOverride: "PANEL",
  entryMode: "MARKET",
  allowMarketFallback: true,
  fallbackMinConfidence: 30,
  fallbackRrBuffer: 0.2,
  botLots: 0.1,
  riskMode: "USD",
  useDynamicLot: true,
  riskPct: 1.0,
  riskUsd: 1.0,
  riskGuardMult: 1.1,
  minSlPoints: 30,
  atrBufferMult: 0.25,
  minLot: 0.1,
  lotStep: 0.01,
  adaptiveLearningEnabled: false,
  learnedBlockedSymbols: [],
  learnedBlockedSessions: [],
  commentTag: "managed-dual-core",
  ma200FlatFilterEnabled: true,
  ma200FlatMaxAtrRatio: 0.09,
  highImpactNewsFilterEnabled: true,
  highImpactNewsLookbackMin: 360,
  highImpactNewsKeywords: ["NFP", "CPI", "FOMC"],
};
const DEFAULT_PROTECT_CONFIG = {
  enabled: true,
  timeframe: "M15",
  atrPeriod: 14,
  atrMult: 2.0,
  lookback: 14,
  minStopPoints: 30,
  graceMin: 1,
  breakEvenEnabled: true,
  breakEvenR: 1.0,
  breakEvenProfitUsd: 0.3,
  degradeCloseEnabled: false,
  degradeMinConfidence: 82,
  biasFlipProfitLockEnabled: true,
  biasFlipTpProgressPct: 35,
  overnightProfitRetraceLockEnabled: true,
  overnightProfitRetraceArmUsd: 0.8,
  overnightProfitRetraceCloseUsd: 0.4,
  overnightEnabled: false,
  overnightProfitUsd: 1.1,
  overnightLossUsd: 1.2,
};
const DEFAULT_SYMBOL_PROFILES = [
  {
    symbol: "GOLD",
    auto: {
      enabled: true,
      sideFilter: "BOTH",
      minConfidence: 30,
      minWinRate: 0,
      minRR: 1.0,
      cooldownMin: 60,
      maxOpenTrades: 2,
      requireStrong: false,
      enforceTrendStack: false,
      strategyMode: "SCALP_M15",
      scalpAggressive: true,
      sessionGateEnabled: true,
      entryTimeframe: "M5",
      entryMode: "MARKET",
      commentTag: "gold-overnight-scalp",
    },
    protect: {
      enabled: true,
      overnightEnabled: false,
      degradeCloseEnabled: false,
      overnightProfitUsd: 1.1,
      overnightLossUsd: 1.2,
    },
  },
  {
    symbol: "ETHUSD",
    auto: {
      enabled: true,
      sideFilter: "BOTH",
      minConfidence: 30,
      minWinRate: 0,
      minRR: 1.0,
      cooldownMin: 45,
      maxOpenTrades: 2,
      requireStrong: false,
      enforceTrendStack: false,
      strategyMode: "SCALP_M15",
      scalpAggressive: true,
      sessionGateEnabled: true,
      entryTimeframe: "M15",
      entryMode: "MARKET",
      commentTag: "eth-trend-pullback",
    },
    protect: {
      enabled: true,
      degradeCloseEnabled: false,
      overnightEnabled: false,
    },
  },
];
const MANAGED_PROTECT_MAX_RISK_USD = 2;
const AGGRESSIVE_AUTO_TP_TARGET_USD = 1;
const ADAPTIVE_SESSIONS = ["ASIA", "LONDON", "OVERLAP", "NEW_YORK", "QUIET"];
const MAX_RUNTIME_LOGS = 200;
const MAX_AUDIT_LOGS = 500;
const OVERNIGHT_MAX_CONSECUTIVE_LOSSES = 3;
const HIGH_IMPACT_NEWS_CACHE_MS = 5 * 60 * 1000;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const computeMoneyPerPricePerLot = (tickValue, tickSize, point, lotSize) => {
  if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(tickSize) && tickSize > 0) {
    return tickValue / tickSize;
  }
  if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(point) && point > 0) {
    return tickValue / point;
  }
  return Number.isFinite(lotSize) && lotSize > 0 ? lotSize : 0;
};

const parseNumber = (value, fallback, min, max) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return clamp(numeric, min, max);
};

const parseInteger = (value, fallback, min, max) => Math.round(parseNumber(value, fallback, min, max));

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled", "active"].includes(normalized)) return true;
    if (["0", "false", "no", "off", "disabled", "inactive"].includes(normalized)) return false;
  }
  return fallback;
};

const parseUtcMinutes = (value, fallback) => {
  if (!value) return fallback;
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return hours * 60 + minutes;
};

const minuteInWindow = (minute, start, end) => {
  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
};

const getMinuteInTimeZone = (nowMs, timeZone) => {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(nowMs));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minute = Number(parts.find((part) => part.type === "minute")?.value);
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return hour * 60 + minute;
    }
  } catch {
    // ignore invalid timezone and fall back to UTC
  }
  const fallback = new Date(nowMs);
  return fallback.getUTCHours() * 60 + fallback.getUTCMinutes();
};

const getWatchIntervalMs = (timeframe) => {
  switch (String(timeframe || "").toUpperCase()) {
    case "M1":
      return 1500;
    case "M5":
      return 2000;
    case "M15":
      return 2500;
    case "M30":
      return 3000;
    case "H1":
      return 3500;
    case "H4":
      return 4000;
    case "D1":
      return 5000;
    case "W1":
      return 6000;
    case "MN":
      return 7000;
    default:
      return 2500;
  }
};
const AUTO_BIAS_TIMEFRAME = "H4";
const AUTO_SETUP_TIMEFRAME = "H1";
const getTrendFilterFrames = (entryTimeframe) => [String(entryTimeframe || "").toUpperCase() === "M5" ? "M5" : "M15", AUTO_SETUP_TIMEFRAME, AUTO_BIAS_TIMEFRAME];

const normalizeSymbol = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const toSymbolKey = (value) => normalizeSymbol(value).replace(/M$/, "");
const symbolsMatch = (left, right) => {
  const leftKey = toSymbolKey(left);
  const rightKey = toSymbolKey(right);
  if (!leftKey || !rightKey) return false;
  return leftKey === rightKey || leftKey.startsWith(rightKey) || rightKey.startsWith(leftKey);
};
const isCryptoSymbol = (value) => CRYPTO_ASSETS.some((asset) => normalizeSymbol(asset) === normalizeSymbol(value));
const toChartTimeframe = (value, fallback = "D1") => {
  const normalized = String(value || "").toUpperCase();
  return TIMEFRAMES.includes(normalized) ? normalized : fallback;
};

const sanitizeSymbol = (value) => String(value || "").trim().toUpperCase().replace(/[^A-Z0-9/#._-]/g, "");

const sanitizeWatchlist = (value, fallback = DEFAULT_WATCHLIST) => {
  const items = Array.isArray(value) ? value : fallback;
  const next = items
    .map((item, index) => {
      const symbol = sanitizeSymbol(item?.symbol);
      if (!symbol) return null;
      return {
        symbol,
        timeframe: toChartTimeframe(item?.timeframe, fallback[index]?.timeframe || "D1"),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
  return next.length ? next : fallback.map((item) => ({ ...item }));
};

const sanitizeAutoConfig = (value = {}, fallback = DEFAULT_AUTO_CONFIG) => ({
  enabled: parseBoolean(value.enabled, fallback.enabled),
  sideFilter: ["BUY_ONLY", "SELL_ONLY", "BOTH"].includes(String(value.sideFilter || "").toUpperCase())
    ? String(value.sideFilter).toUpperCase()
    : fallback.sideFilter,
  minConfidence: parseNumber(value.minConfidence, fallback.minConfidence, 0, 100),
  minWinRate: parseNumber(value.minWinRate, fallback.minWinRate, 0, 100),
  minRR: parseNumber(value.minRR, fallback.minRR, 0.5, 20),
  cooldownMin: parseInteger(value.cooldownMin, fallback.cooldownMin, 1, 1440),
  maxOpenTrades: parseInteger(value.maxOpenTrades, fallback.maxOpenTrades, 1, 50),
  requireStrong: parseBoolean(value.requireStrong, fallback.requireStrong),
  enforceTrendStack: parseBoolean(value.enforceTrendStack, fallback.enforceTrendStack),
  enforceSymbolCooldown: parseBoolean(value.enforceSymbolCooldown, fallback.enforceSymbolCooldown),
  enforceDailyLossLimit: parseBoolean(value.enforceDailyLossLimit, fallback.enforceDailyLossLimit),
  enforceHardRiskBlock: parseBoolean(value.enforceHardRiskBlock, fallback.enforceHardRiskBlock),
  strategyMode: String(value.strategyMode || fallback.strategyMode).toUpperCase() === "SCALP_M15" ? "SCALP_M15" : "CLASSIC_STACK",
  scalpAggressive: parseBoolean(value.scalpAggressive, fallback.scalpAggressive),
  sessionGateEnabled: parseBoolean(value.sessionGateEnabled, fallback.sessionGateEnabled),
  biasTimeframe: AUTO_BIAS_TIMEFRAME,
  setupTimeframe: AUTO_SETUP_TIMEFRAME,
  entryTimeframe:
    String(
      value.entryTimeframe ||
        (String(value.trendAlignment || "").toUpperCase() === "M5_H1_H4" ? "M5" : "") ||
        fallback.entryTimeframe
    ).toUpperCase() === "M5"
      ? "M5"
      : "M15",
  reentryMode: ["OFF", "BALANCED", "STRICT"].includes(String(value.reentryMode || "").toUpperCase())
    ? String(value.reentryMode).toUpperCase()
    : fallback.reentryMode,
  timeframeOverride:
    String(value.timeframeOverride || fallback.timeframeOverride).toUpperCase() === "PANEL"
      ? "PANEL"
      : toChartTimeframe(value.timeframeOverride, fallback.timeframeOverride),
  entryMode: String(value.entryMode || fallback.entryMode).toUpperCase() === "LIMIT_SR" ? "LIMIT_SR" : "MARKET",
  allowMarketFallback: parseBoolean(value.allowMarketFallback, fallback.allowMarketFallback),
  fallbackMinConfidence: parseNumber(value.fallbackMinConfidence, fallback.fallbackMinConfidence, 0, 100),
  fallbackRrBuffer: parseNumber(value.fallbackRrBuffer, fallback.fallbackRrBuffer, 0, 10),
  botLots: parseNumber(value.botLots, fallback.botLots, 0.001, 1000),
  riskMode: String(value.riskMode || fallback.riskMode).toUpperCase() === "USD" ? "USD" : "PCT",
  useDynamicLot: parseBoolean(value.useDynamicLot, fallback.useDynamicLot),
  riskPct: parseNumber(value.riskPct, fallback.riskPct, 0.01, 100),
  riskUsd: parseNumber(value.riskUsd, fallback.riskUsd, 0.01, 1000000),
  riskGuardMult: parseNumber(value.riskGuardMult, fallback.riskGuardMult, 1, 20),
  maxSpreadPoints: parseNumber(value.maxSpreadPoints, fallback.maxSpreadPoints, 1, 100000),
  minSlPoints: parseNumber(value.minSlPoints, fallback.minSlPoints, 1, 100000),
  atrBufferMult: parseNumber(value.atrBufferMult, fallback.atrBufferMult, 0, 10),
  minLot: parseNumber(value.minLot, fallback.minLot, 0.001, 1000),
  lotStep: parseNumber(value.lotStep, fallback.lotStep, 0.001, 1000),
  adaptiveLearningEnabled: parseBoolean(value.adaptiveLearningEnabled, fallback.adaptiveLearningEnabled),
  learnedBlockedSymbols: Array.isArray(value.learnedBlockedSymbols)
    ? value.learnedBlockedSymbols.map(normalizeSymbol).filter(Boolean).slice(0, 50)
    : fallback.learnedBlockedSymbols,
  learnedBlockedSessions: Array.isArray(value.learnedBlockedSessions)
    ? value.learnedBlockedSessions
        .map((item) => String(item || "").toUpperCase())
        .filter((item) => ADAPTIVE_SESSIONS.includes(item))
        .slice(0, ADAPTIVE_SESSIONS.length)
    : fallback.learnedBlockedSessions,
  commentTag:
    String(value.commentTag || fallback.commentTag || "headless-auto").trim().slice(0, 40) || "headless-auto",
  ma200FlatFilterEnabled: parseBoolean(value.ma200FlatFilterEnabled, fallback.ma200FlatFilterEnabled),
  ma200FlatMaxAtrRatio: parseNumber(value.ma200FlatMaxAtrRatio, fallback.ma200FlatMaxAtrRatio, 0.001, 10),
  highImpactNewsFilterEnabled: parseBoolean(
    value.highImpactNewsFilterEnabled,
    fallback.highImpactNewsFilterEnabled
  ),
  highImpactNewsLookbackMin: parseInteger(
    value.highImpactNewsLookbackMin,
    fallback.highImpactNewsLookbackMin,
    1,
    1440
  ),
  highImpactNewsKeywords: Array.isArray(value.highImpactNewsKeywords)
    ? value.highImpactNewsKeywords
        .map((item) => String(item || "").trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 10)
    : fallback.highImpactNewsKeywords,
});

const sanitizeProtectConfig = (value = {}, fallback = DEFAULT_PROTECT_CONFIG) => ({
  enabled: parseBoolean(value.enabled, fallback.enabled),
  timeframe: toChartTimeframe(value.timeframe, fallback.timeframe),
  atrPeriod: parseInteger(value.atrPeriod, fallback.atrPeriod, 2, 200),
  atrMult: parseNumber(value.atrMult, fallback.atrMult, 0.5, 20),
  lookback: parseInteger(value.lookback, fallback.lookback, 3, 200),
  minStopPoints: parseNumber(value.minStopPoints, fallback.minStopPoints, 0, 100000),
  graceMin: parseInteger(value.graceMin, fallback.graceMin, 0, 1440),
  breakEvenEnabled: parseBoolean(value.breakEvenEnabled, fallback.breakEvenEnabled),
  breakEvenR: parseNumber(value.breakEvenR, fallback.breakEvenR, 0.1, 20),
  breakEvenProfitUsd: parseNumber(value.breakEvenProfitUsd, fallback.breakEvenProfitUsd, 0.01, 1000000),
  degradeCloseEnabled: parseBoolean(value.degradeCloseEnabled, fallback.degradeCloseEnabled),
  degradeMinConfidence: parseNumber(value.degradeMinConfidence, fallback.degradeMinConfidence, 0, 100),
  biasFlipProfitLockEnabled: parseBoolean(value.biasFlipProfitLockEnabled, fallback.biasFlipProfitLockEnabled),
  biasFlipTpProgressPct: parseNumber(value.biasFlipTpProgressPct, fallback.biasFlipTpProgressPct, 1, 100),
  overnightProfitRetraceLockEnabled: parseBoolean(
    value.overnightProfitRetraceLockEnabled,
    fallback.overnightProfitRetraceLockEnabled
  ),
  overnightProfitRetraceArmUsd: parseNumber(
    value.overnightProfitRetraceArmUsd,
    fallback.overnightProfitRetraceArmUsd,
    0.01,
    1000000
  ),
  overnightProfitRetraceCloseUsd: parseNumber(
    value.overnightProfitRetraceCloseUsd,
    fallback.overnightProfitRetraceCloseUsd,
    0.01,
    1000000
  ),
  overnightEnabled: parseBoolean(value.overnightEnabled, fallback.overnightEnabled),
  overnightProfitUsd: parseNumber(value.overnightProfitUsd, fallback.overnightProfitUsd, 0.01, 1000000),
  overnightLossUsd: parseNumber(value.overnightLossUsd, fallback.overnightLossUsd, 0.01, 1000000),
});

const sanitizeSymbolProfiles = (value, defaults) => {
  if (!Array.isArray(value)) {
    return Array.isArray(defaults)
      ? defaults.map((item) => ({
          symbol: sanitizeSymbol(item?.symbol),
          ...(item?.auto ? { auto: sanitizeAutoConfig(item.auto, DEFAULT_AUTO_CONFIG) } : {}),
          ...(item?.protect ? { protect: sanitizeProtectConfig(item.protect, DEFAULT_PROTECT_CONFIG) } : {}),
        }))
      : [];
  }

  const seen = new Set();
  return value
    .map((item) => {
      const symbol = sanitizeSymbol(item?.symbol);
      const key = toSymbolKey(symbol);
      if (!symbol || !key || seen.has(key)) return null;
      seen.add(key);
      return {
        symbol,
        ...(item?.auto ? { auto: sanitizeAutoConfig(item.auto, DEFAULT_AUTO_CONFIG) } : {}),
        ...(item?.protect ? { protect: sanitizeProtectConfig(item.protect, DEFAULT_PROTECT_CONFIG) } : {}),
      };
    })
    .filter(Boolean)
    .slice(0, 12);
};

const sanitizeConfig = (value = {}, defaults) => ({
  version: 1,
  mode: "HEADLESS",
  watchlist: sanitizeWatchlist(value.watchlist, defaults.watchlist),
  auto: sanitizeAutoConfig(value.auto, defaults.auto),
  protect: sanitizeProtectConfig(value.protect, defaults.protect),
  symbolProfiles: sanitizeSymbolProfiles(value.symbolProfiles, defaults.symbolProfiles),
});

const average = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const sma = (values, period) => {
  if (values.length < period) return null;
  return average(values.slice(-period));
};

const emaSeries = (values, period) => {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const result = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i += 1) {
    const next = i === 0 ? values[i] : values[i] * k + prev * (1 - k);
    result.push(next);
    prev = next;
  }
  return result;
};

const computeRsi = (closes, period = 14) => {
  if (closes.length <= period) return 50;
  const gains = [];
  const losses = [];
  for (let i = 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  const avgGain = average(gains.slice(-period));
  const avgLoss = average(losses.slice(-period));
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

const computeAtr = (candles, period = 14) => {
  if (candles.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    trs.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }
  return average(trs.slice(-period));
};

const getPointSizeForSymbol = (symbol, price) => {
  const normalized = normalizeSymbol(symbol);
  if (normalized.endsWith("JPY")) return 0.001;
  if (normalized.includes("XAU") || normalized.includes("GOLD")) return 0.01;
  if (normalized.includes("XAG") || normalized.includes("SILVER")) return 0.001;
  if (normalized.includes("US30")) return 0.1;
  if (isCryptoSymbol(symbol)) return 0.01;
  if (Number.isFinite(Number(price)) && Number(price) >= 1000) return 0.1;
  return 0.00001;
};

const getSymbolExecutionPreset = (symbol) => {
  const normalized = normalizeSymbol(symbol);
  if (normalized.includes("US30")) return { minSlPoints: 120, spreadMult: 0.5, slippageMult: 0.65 };
  if (normalized.includes("GBPNZD")) return { minSlPoints: 70, spreadMult: 2.0, slippageMult: 2.0 };
  if (normalized.endsWith("JPY")) return { minSlPoints: 45, spreadMult: 1.5, slippageMult: 1.5 };
  if (normalized.includes("XAU") || normalized.includes("GOLD")) {
    return { minSlPoints: 60, spreadMult: 1.25, slippageMult: 1.2 };
  }
  if (normalized.includes("XAG") || normalized.includes("SILVER")) {
    return { minSlPoints: 90, spreadMult: 1.6, slippageMult: 1.5 };
  }
  if (isCryptoSymbol(normalized)) {
    if (normalized.includes("XRP")) return { minSlPoints: 60, spreadMult: 2.0, slippageMult: 2.0 };
    return { minSlPoints: 120, spreadMult: 2.5, slippageMult: 2.2 };
  }
  return { minSlPoints: 30, spreadMult: 1.0, slippageMult: 1.0 };
};

const computeEffectiveRR = (side, entry, sl, tp) => {
  const riskDistance = side === "BUY" ? entry - sl : sl - entry;
  const rewardDistance = side === "BUY" ? tp - entry : entry - tp;
  if (!Number.isFinite(riskDistance) || !Number.isFinite(rewardDistance) || riskDistance <= 0 || rewardDistance <= 0) {
    return Number.NaN;
  }
  return rewardDistance / riskDistance;
};

const calculateWinRate = (data, signal, noiseProfile = null) => {
  if (signal === "HOLD") {
    return clamp(40 - Math.round((noiseProfile?.noiseScore || 0) * 0.2), 15, 45);
  }
  let winRate = 50;
  if (signal === "BUY" && data.rsi < 40) winRate += 15;
  else if (signal === "SELL" && data.rsi > 60) winRate += 15;
  if (data.movingAverage50 > data.movingAverage200) {
    if (signal === "BUY") winRate += 10;
  } else if (signal === "SELL") {
    winRate += 10;
  }
  if (signal === "BUY" && data.macd.histogram > 0) winRate += 8;
  else if (signal === "SELL" && data.macd.histogram < 0) winRate += 8;
  return clamp(winRate - (noiseProfile?.winRatePenalty || 0), 20, 95);
};

const buildSignalNoiseProfile = (data) => {
  const point = getPointSizeForSymbol(data.symbol, data.current);
  const atrValue =
    Number.isFinite(data.atr) && data.atr > 0 ? data.atr : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
  const safeAtr = Math.max(atrValue, point * 5, Math.abs(data.current) * 0.00001, 1e-9);
  const maGapRatio = Math.abs(data.movingAverage50 - data.movingAverage200) / safeAtr;
  const macdRatio = Math.abs(data.macd.histogram) / safeAtr;
  const rsiDistance = Math.abs(data.rsi - 50);
  const rangeToAtr = Math.abs(data.high - data.low) / safeAtr;
  const impulseRatio = Math.abs(data.change) / safeAtr;

  let score = 0;
  if (maGapRatio < 0.2) score += 28;
  else if (maGapRatio < 0.35) score += 18;

  if (macdRatio < 0.035) score += 24;
  else if (macdRatio < 0.07) score += 14;

  if (rsiDistance < 4) score += 22;
  else if (rsiDistance < 8) score += 12;

  if (rangeToAtr < 2.5) score += 18;
  else if (rangeToAtr < 4) score += 10;

  if (impulseRatio < 0.12) score += 8;

  const noiseScore = clamp(score, 0, 100);
  const noiseState = noiseScore >= 55 ? "HIGH" : noiseScore >= 30 ? "MEDIUM" : "LOW";

  return {
    noiseScore,
    noiseState,
    confidencePenalty: noiseState === "HIGH" ? Math.round(noiseScore * 0.45) : Math.round(noiseScore * 0.3),
    winRatePenalty: noiseState === "HIGH" ? Math.round(noiseScore * 0.28) : Math.round(noiseScore * 0.2),
  };
};

const classifyAdaptiveSession = (timeMs) => {
  const hour = new Date(timeMs).getUTCHours();
  if (hour < 8) return "ASIA";
  if (hour < 13) return "LONDON";
  if (hour < 17) return "OVERLAP";
  if (hour < 22) return "NEW_YORK";
  return "QUIET";
};

const formatNumericPrice = (symbol, value) => Number(value).toFixed(isCryptoSymbol(symbol) ? 2 : 5);

export const createHeadlessTrader = async (options) => {
  const {
    configPath,
    env = process.env,
    readMt4Candles,
    readMt4Ticks,
    readMt4History,
    fetchMarketIntelForSymbols,
    readMt4AccountSnapshot,
    listOpenPositions,
    readMt4SymbolSpecs,
    resolveExecutableSymbol,
    validateAllowedSymbol,
    validateOrderRequest,
    evaluatePlaceRiskPolicy,
    executeMt4Command,
  } = options;

  const defaultAutoMaxSpreadPoints = Math.max(
    1,
    Number(env.AUTO_MAX_SPREAD_POINTS ?? env.VITE_AUTO_MAX_SPREAD_POINTS ?? env.VITE_AUTO_GOLD_MAX_SPREAD_POINTS ?? 80)
  );
  const autoMaxSlippagePoints = Math.max(
    1,
    Number(
      env.AUTO_MAX_SLIPPAGE_POINTS ??
        env.VITE_AUTO_MAX_SLIPPAGE_POINTS ??
        env.VITE_AUTO_GOLD_MAX_SLIPPAGE_POINTS ??
        120
    )
  );
  const brokerWeekOpenUtcMin = parseUtcMinutes(env.BROKER_WEEK_OPEN_UTC ?? env.VITE_BROKER_WEEK_OPEN_UTC, 22 * 60 + 5);
  const brokerWeekCloseUtcMin = parseUtcMinutes(
    env.BROKER_WEEK_CLOSE_UTC ?? env.VITE_BROKER_WEEK_CLOSE_UTC,
    21 * 60 + 55
  );
  const brokerDailyBreakStartUtcMin = parseUtcMinutes(
    env.BROKER_DAILY_BREAK_START_UTC ?? env.VITE_BROKER_DAILY_BREAK_START_UTC,
    21 * 60 + 55
  );
  const brokerDailyBreakEndUtcMin = parseUtcMinutes(
    env.BROKER_DAILY_BREAK_END_UTC ?? env.VITE_BROKER_DAILY_BREAK_END_UTC,
    22 * 60 + 5
  );
  const autoSessionWindowEnabled = parseBoolean(
    env.AUTO_SESSION_WINDOW_ENABLED ?? env.VITE_AUTO_SESSION_WINDOW_ENABLED,
    false
  );
  const autoSessionWindowTz = String(env.AUTO_SESSION_WINDOW_TZ ?? env.VITE_AUTO_SESSION_WINDOW_TZ ?? "Asia/Manila").trim();
  const autoSessionWindowStartMin = parseUtcMinutes(
    env.AUTO_SESSION_WINDOW_START ?? env.VITE_AUTO_SESSION_WINDOW_START,
    20 * 60
  );
  const autoSessionWindowEndMin = parseUtcMinutes(
    env.AUTO_SESSION_WINDOW_END ?? env.VITE_AUTO_SESSION_WINDOW_END,
    0
  );
  const autoSessionWindowIncludeCrypto = parseBoolean(
    env.AUTO_SESSION_WINDOW_INCLUDE_CRYPTO ?? env.VITE_AUTO_SESSION_WINDOW_INCLUDE_CRYPTO,
    false
  );

  const runtimeDefaults = {
    watchlist: DEFAULT_WATCHLIST,
    auto: {
      ...DEFAULT_AUTO_CONFIG,
      minLot: parseNumber(env.MT4_MIN_LOT ?? env.VITE_MT4_MIN_LOT, DEFAULT_AUTO_CONFIG.minLot, 0.001, 1000),
      lotStep: parseNumber(
        env.MT4_LOT_STEP ?? env.VITE_MT4_LOT_STEP,
        DEFAULT_AUTO_CONFIG.lotStep,
        0.001,
        1000
      ),
    },
    protect: DEFAULT_PROTECT_CONFIG,
    symbolProfiles: DEFAULT_SYMBOL_PROFILES,
  };

  const state = {
    config: sanitizeConfig({}, runtimeDefaults),
    autoBusy: false,
    protectBusy: false,
    commandBusy: false,
    autoTimer: null,
    protectTimer: null,
    lastAutoRunAtMs: 0,
    lastAutoCompletedAtMs: 0,
    lastProtectRunAtMs: 0,
    lastProtectCompletedAtMs: 0,
    autoStatus: "Headless auto-trade idle",
    protectStatus: "Headless protect idle",
    logs: [],
    auditLogs: [],
    overnightLossGuard: {
      initialized: false,
      active: false,
      consecutiveLosses: 0,
      stopReason: "",
      stoppedAtMs: 0,
      lastTradeTicket: 0,
      lastTradeProfit: 0,
      processedTradeKeys: new Set(),
    },
    overnightProfitRetraceState: new Map(),
    highImpactNewsCache: new Map(),
  };

  const pushLog = (level, message) => {
    state.logs = [{ ts: Date.now(), level, message }, ...state.logs].slice(0, MAX_RUNTIME_LOGS);
  };

  const pushAudit = (symbol, stage, details) => {
    state.auditLogs = [{ ts: Date.now(), symbol, stage, details }, ...state.auditLogs].slice(0, MAX_AUDIT_LOGS);
  };

  const persistConfig = async () => {
    const dir = configPath.replace(/[\\/][^\\/]+$/, "");
    if (dir) {
      await fsPromises.mkdir(dir, { recursive: true });
    }
    await fsPromises.writeFile(configPath, JSON.stringify(state.config, null, 2), "utf8");
  };

  const getSymbolProfile = (symbol, config = state.config) =>
    (Array.isArray(config?.symbolProfiles) ? config.symbolProfiles : []).find((profile) => symbolsMatch(profile?.symbol, symbol)) || null;

  const getEffectiveAutoConfig = (symbol, config = state.config) => {
    const profile = getSymbolProfile(symbol, config);
    if (!profile?.auto) {
      return config.auto;
    }
    const effective = sanitizeAutoConfig({ ...config.auto, ...profile.auto }, config.auto);
    if (!config.auto.enabled) {
      return { ...effective, enabled: false };
    }
    return effective;
  };

  const getEffectiveProtectConfig = (symbol, config = state.config) => {
    const profile = getSymbolProfile(symbol, config);
    if (!profile?.protect) {
      return config.protect;
    }
    const effective = sanitizeProtectConfig({ ...config.protect, ...profile.protect }, config.protect);
    return {
      ...effective,
      enabled: config.protect.enabled ? effective.enabled : false,
      overnightEnabled: config.protect.overnightEnabled ? effective.overnightEnabled : false,
    };
  };

  const hasAnyAutoEnabled = (config = state.config) =>
    Boolean(config.auto.enabled && config.watchlist.some((item) => getEffectiveAutoConfig(item.symbol, config).enabled));

  const hasAnyProtectEnabled = (config = state.config) =>
    config.watchlist.some((item) => {
      const protectConfig = getEffectiveProtectConfig(item.symbol, config);
      return protectConfig.enabled || protectConfig.overnightEnabled;
    });

  const collectManagedTradeCommentPrefixes = ({ overnightOnly = false, config = state.config } = {}) => {
    const prefixes = new Set();
    for (const item of Array.isArray(config.watchlist) ? config.watchlist : []) {
      const autoConfig = getEffectiveAutoConfig(item.symbol, config);
      const protectConfig = getEffectiveProtectConfig(item.symbol, config);
      if (!autoConfig.enabled && !(overnightOnly && protectConfig.overnightEnabled)) continue;
      if (overnightOnly && !protectConfig.overnightEnabled) continue;
      const prefix = String(autoConfig.commentTag || "").trim();
      if (prefix) {
        prefixes.add(prefix);
      }
    }
    return Array.from(prefixes);
  };

  const buildManagedTradeKey = (trade) =>
    [Number(trade?.ticket || 0), Number(trade?.closeTime || 0), Number(trade?.profit || 0)].join("|");

  const trimProcessedTradeKeys = () => {
    while (state.overnightLossGuard.processedTradeKeys.size > 1000) {
      const first = state.overnightLossGuard.processedTradeKeys.values().next().value;
      if (first === undefined) break;
      state.overnightLossGuard.processedTradeKeys.delete(first);
    }
  };

  const resetOvernightLossGuard = async ({ markCurrentHistoryProcessed = false, resetLosses = true } = {}) => {
    state.overnightLossGuard.active = false;
    state.overnightLossGuard.stopReason = "";
    state.overnightLossGuard.stoppedAtMs = 0;
    if (resetLosses) {
      state.overnightLossGuard.consecutiveLosses = 0;
    }
    if (markCurrentHistoryProcessed && typeof readMt4History === "function") {
      try {
        const historyResult = await readMt4History();
        if (historyResult.ok && Array.isArray(historyResult.trades)) {
          const prefixes = collectManagedTradeCommentPrefixes({ overnightOnly: true });
          state.overnightLossGuard.processedTradeKeys = new Set(
            historyResult.trades
              .filter((trade) =>
                prefixes.some((prefix) => String(trade?.comment || "").startsWith(prefix))
              )
              .map((trade) => buildManagedTradeKey(trade))
          );
          trimProcessedTradeKeys();
          state.overnightLossGuard.initialized = true;
          return;
        }
      } catch {
        // ignore history reset errors
      }
    }
    if (markCurrentHistoryProcessed) {
      state.overnightLossGuard.processedTradeKeys = new Set();
      state.overnightLossGuard.initialized = false;
    }
  };

  const applyTradeOutcomeToLossGuard = (trade) => {
    const profit = Number(trade?.profit || 0);
    state.overnightLossGuard.lastTradeTicket = Number(trade?.ticket || 0);
    state.overnightLossGuard.lastTradeProfit = profit;
    if (profit < 0) {
      state.overnightLossGuard.consecutiveLosses += 1;
    } else {
      state.overnightLossGuard.consecutiveLosses = 0;
    }
  };

  const activateOvernightLossStop = async (trade) => {
    const profit = Number(trade?.profit || 0);
    const symbol = String(trade?.symbol || "trade");
    const ticket = Number(trade?.ticket || 0);
    const reason = `${symbol} #${ticket || "?"} closed at $${profit.toFixed(2)}. Loss streak reached ${state.overnightLossGuard.consecutiveLosses}/${OVERNIGHT_MAX_CONSECUTIVE_LOSSES}`;
    state.overnightLossGuard.active = true;
    state.overnightLossGuard.stopReason = reason;
    state.overnightLossGuard.stoppedAtMs = Date.now();
    const matchedProfile = getSymbolProfile(symbol);
    if (matchedProfile) {
      state.config = sanitizeConfig(
        {
          ...state.config,
          symbolProfiles: state.config.symbolProfiles.map((profile) =>
            symbolsMatch(profile.symbol, symbol)
              ? {
                  ...profile,
                  auto: { ...(profile.auto || {}), enabled: false },
                  protect: { ...(profile.protect || {}), overnightEnabled: false },
                }
              : profile
          ),
        },
        runtimeDefaults
      );
    } else {
      state.config = sanitizeConfig(
        {
          ...state.config,
          auto: { ...state.config.auto, enabled: false },
          protect: { ...state.config.protect, overnightEnabled: false },
        },
        runtimeDefaults
      );
    }
    await persistConfig();
    await refreshTimers();
    state.autoStatus = matchedProfile
      ? `Headless auto-trade blocked for ${matchedProfile.symbol}: ${reason}`
      : `Headless auto-trade blocked: ${reason}`;
    state.protectStatus = matchedProfile
      ? `Overnight mode disabled for ${matchedProfile.symbol} after ${OVERNIGHT_MAX_CONSECUTIVE_LOSSES} consecutive losses`
      : `Overnight mode disabled after ${OVERNIGHT_MAX_CONSECUTIVE_LOSSES} consecutive losses`;
    pushLog("WARN", state.autoStatus);
    pushLog("WARN", state.protectStatus);
  };

  const syncOvernightLossGuard = async () => {
    if (typeof readMt4History !== "function") return;
    const prefixes = collectManagedTradeCommentPrefixes({ overnightOnly: true });
    if (!prefixes.length) {
      state.overnightLossGuard.processedTradeKeys = new Set();
      state.overnightLossGuard.consecutiveLosses = 0;
      state.overnightLossGuard.initialized = true;
      return;
    }
    const historyResult = await readMt4History();
    if (!historyResult.ok || !Array.isArray(historyResult.trades)) return;

    const managedTrades = historyResult.trades
      .filter(
        (trade) =>
          Number(trade?.closeTime || 0) > 0 &&
          prefixes.some((prefix) => String(trade?.comment || "").startsWith(prefix))
      )
      .sort((a, b) => {
        const closeDiff = Number(a.closeTime || 0) - Number(b.closeTime || 0);
        if (closeDiff !== 0) return closeDiff;
        return Number(a.ticket || 0) - Number(b.ticket || 0);
      });

    if (!state.overnightLossGuard.initialized) {
      state.overnightLossGuard.processedTradeKeys = new Set();
      state.overnightLossGuard.consecutiveLosses = 0;
      for (const trade of managedTrades) {
        state.overnightLossGuard.processedTradeKeys.add(buildManagedTradeKey(trade));
        applyTradeOutcomeToLossGuard(trade);
      }
      trimProcessedTradeKeys();
      state.overnightLossGuard.initialized = true;
      if (
        state.overnightLossGuard.consecutiveLosses >= OVERNIGHT_MAX_CONSECUTIVE_LOSSES &&
        hasAnyAutoEnabled() &&
        hasAnyProtectEnabled()
      ) {
        await activateOvernightLossStop(managedTrades[managedTrades.length - 1]);
      }
      return;
    }

    for (const trade of managedTrades) {
      const tradeKey = buildManagedTradeKey(trade);
      if (state.overnightLossGuard.processedTradeKeys.has(tradeKey)) continue;
      state.overnightLossGuard.processedTradeKeys.add(tradeKey);
      trimProcessedTradeKeys();
      applyTradeOutcomeToLossGuard(trade);
      if (Number(trade?.profit || 0) < 0) {
        pushLog(
          "WARN",
          `Managed overnight trade loss ${state.overnightLossGuard.consecutiveLosses}/${OVERNIGHT_MAX_CONSECUTIVE_LOSSES}: ${trade.symbol} #${trade.ticket} ($${Number(trade.profit || 0).toFixed(2)})`
        );
      } else {
        pushLog(
          "INFO",
          `Managed overnight trade win/reset: ${trade.symbol} #${trade.ticket} ($${Number(trade.profit || 0).toFixed(2)})`
        );
      }
      if (
        !state.overnightLossGuard.active &&
        state.overnightLossGuard.consecutiveLosses >= OVERNIGHT_MAX_CONSECUTIVE_LOSSES &&
        hasAnyAutoEnabled() &&
        hasAnyProtectEnabled()
      ) {
        await activateOvernightLossStop(trade);
        return;
      }
    }
  };

  const loadConfig = async () => {
    try {
      if (!fs.existsSync(configPath)) {
        state.config = sanitizeConfig({}, runtimeDefaults);
        return;
      }
      const raw = await fsPromises.readFile(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const sanitized = sanitizeConfig(parsed, runtimeDefaults);
      state.config = sanitized;
      if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
        await persistConfig();
      }
    } catch {
      state.config = sanitizeConfig({}, runtimeDefaults);
    }
  };

  const getMinSlPointsForSymbol = (symbol, autoConfig = state.config.auto) => {
    const configured = Math.max(1, Number(autoConfig.minSlPoints) || DEFAULT_AUTO_CONFIG.minSlPoints);
    return Math.max(configured, getSymbolExecutionPreset(symbol).minSlPoints);
  };

  const getSpreadGuardPointsForSymbol = (symbol, autoConfig = state.config.auto) =>
    Math.max(
      1,
      (Math.max(1, Number(autoConfig.maxSpreadPoints) || defaultAutoMaxSpreadPoints)) *
        getSymbolExecutionPreset(symbol).spreadMult
    );

  const getSlippageGuardPointsForSymbol = (symbol) =>
    Math.max(1, autoMaxSlippagePoints * getSymbolExecutionPreset(symbol).slippageMult);

  const isAutoSessionWindowOpen = (symbol, autoConfig = state.config.auto, nowMs = Date.now()) => {
    if (autoConfig.sessionGateEnabled === false) return true;
    if (!autoSessionWindowEnabled) return true;
    if (isCryptoSymbol(symbol) && !autoSessionWindowIncludeCrypto) return true;
    const localMinute = getMinuteInTimeZone(nowMs, autoSessionWindowTz);
    return minuteInWindow(localMinute, autoSessionWindowStartMin, autoSessionWindowEndMin);
  };

  const isBrokerSessionOpen = (symbol, nowMs = Date.now()) => {
    if (isCryptoSymbol(symbol)) return true;
    const now = new Date(nowMs);
    const utcDay = now.getUTCDay();
    const utcMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (utcDay === 6) return false;
    if (utcDay === 0) return utcMinute >= brokerWeekOpenUtcMin;
    if (utcDay === 5) return utcMinute < brokerWeekCloseUtcMin;
    return !minuteInWindow(utcMinute, brokerDailyBreakStartUtcMin, brokerDailyBreakEndUtcMin);
  };

  const fetchTick = async (symbol) => {
    const tickResult = await readMt4Ticks({ symbol });
    if (!tickResult.ok || !Array.isArray(tickResult.ticks)) return null;
    const first = tickResult.ticks[0];
    const bid = Number(first?.bid);
    const ask = Number(first?.ask);
    if (!Number.isFinite(bid) || !Number.isFinite(ask)) return null;
    return {
      bid,
      ask,
      mid: (bid + ask) / 2,
      time: Number(first?.time || 0),
      symbol: first?.symbol || symbol,
    };
  };

  const fetchCandles = async (symbol, timeframe, count = 320) => {
    const result = await readMt4Candles({ symbol, timeframe, count });
    if (!result.ok || !Array.isArray(result.candles)) return [];
    return result.candles
      .map((item) => ({
        time: Number(item.time),
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close),
        volume: Number(item.volume || 0),
      }))
      .filter(
        (candle) =>
          Number.isFinite(candle.time) &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close)
      )
      .sort((a, b) => a.time - b.time);
  };

  const buildPriceDataFromCandles = (symbol, candles) => {
    if (candles.length < 60) return null;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const closes = candles.map((candle) => candle.close);
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const ema12 = emaSeries(closes, 12);
    const ema26 = emaSeries(closes, 26);
    const macdSeries = ema12.map((item, index) => item - (ema26[index] ?? item));
    const signalSeries = emaSeries(macdSeries, 9);
    const recentHigh = Math.max(...highs.slice(-50));
    const recentLow = Math.min(...lows.slice(-50));
    const swingSlice = candles.slice(-31, -1);
    const movingAverage200 = sma(closes, 200) ?? sma(closes, 100) ?? closes[closes.length - 1];
    const previousCloses = closes.slice(0, -1);
    const previousMovingAverage200 = previousCloses.length
      ? sma(previousCloses, 200) ?? sma(previousCloses, 100) ?? previousCloses[previousCloses.length - 1]
      : movingAverage200;
    const atr = computeAtr(candles, 14);
    const safeAtr = Number.isFinite(atr) && atr > 0 ? atr : Math.max(Math.abs(recentHigh - recentLow) / 14, 1e-9);
    const ma200Slope = movingAverage200 - previousMovingAverage200;
    const ma200SlopeAtrRatio = safeAtr > 0 ? Math.abs(ma200Slope) / safeAtr : 0;
    return {
      symbol,
      current: last.close,
      high: recentHigh,
      low: recentLow,
      change: last.close - prev.close,
      changePercent: prev.close !== 0 ? ((last.close - prev.close) / prev.close) * 100 : 0,
      rsi: computeRsi(closes, 14),
      macd: {
        line: macdSeries[macdSeries.length - 1] ?? 0,
        signal: signalSeries[signalSeries.length - 1] ?? 0,
        histogram: (macdSeries[macdSeries.length - 1] ?? 0) - (signalSeries[signalSeries.length - 1] ?? 0),
      },
      supportLevel: recentLow,
      resistanceLevel: recentHigh,
      swingLow: swingSlice.length ? Math.min(...swingSlice.map((candle) => candle.low)) : recentLow,
      swingHigh: swingSlice.length ? Math.max(...swingSlice.map((candle) => candle.high)) : recentHigh,
      atr,
      movingAverage50: sma(closes, 50) ?? closes[closes.length - 1],
      movingAverage200,
      movingAverage200Prev: previousMovingAverage200,
      movingAverage200Slope: ma200Slope,
      movingAverage200SlopeAtrRatio: ma200SlopeAtrRatio,
      lastOpen: last.open,
      lastHigh: last.high,
      lastLow: last.low,
      lastClose: last.close,
      prevOpen: prev.open,
      prevHigh: prev.high,
      prevLow: prev.low,
      prevClose: prev.close,
      lastCandleTime: last.time,
    };
  };

  const getDirectionalStructureTarget = (side, data, entryPrice, point) => {
    const rawTarget =
      side === "BUY"
        ? Math.max(Number(data.resistanceLevel), Number(data.swingHigh))
        : Math.min(Number(data.supportLevel), Number(data.swingLow));
    if (!Number.isFinite(rawTarget) || rawTarget <= 0) return null;
    if (side === "BUY" && !(rawTarget > entryPrice + point)) return null;
    if (side === "SELL" && !(rawTarget < entryPrice - point)) return null;
    return rawTarget;
  };

  const evaluateDirectionalConfirmation = (symbol, data, side, autoConfig = state.config.auto) => {
    const point = getPointSizeForSymbol(symbol, data.current);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0
        ? data.atr
        : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const structureLevel =
      side === "BUY"
        ? Math.min(Number(data.supportLevel), Number(data.swingLow))
        : Math.max(Number(data.resistanceLevel), Number(data.swingHigh));
    const zoneDistance = Math.abs(Number(data.current) - structureLevel);
    const zoneBuffer = Math.max(point * Math.max(6, getMinSlPointsForSymbol(symbol, autoConfig) * 0.5), atrValue * 0.35);
    const maOk = side === "BUY" ? data.current >= data.movingAverage50 : data.current <= data.movingAverage50;
    const rsi = Number(data.rsi || 0);
    const rsiOk = side === "BUY" ? rsi >= 35 && rsi <= 60 : rsi >= 40 && rsi <= 65;
    const candleBody = Math.max(Math.abs(data.lastClose - data.lastOpen), point);
    const upperWick = Math.max(0, data.lastHigh - Math.max(data.lastOpen, data.lastClose));
    const lowerWick = Math.max(0, Math.min(data.lastOpen, data.lastClose) - data.lastLow);
    const bullishEngulfing =
      data.lastClose > data.lastOpen &&
      data.prevClose < data.prevOpen &&
      data.lastOpen <= data.prevClose &&
      data.lastClose >= data.prevOpen;
    const bearishEngulfing =
      data.lastClose < data.lastOpen &&
      data.prevClose > data.prevOpen &&
      data.lastOpen >= data.prevClose &&
      data.lastClose <= data.prevOpen;
    const bullishRejection = data.lastClose > data.lastOpen && lowerWick >= candleBody * 1.5 && upperWick <= candleBody * 0.8;
    const bearishRejection = data.lastClose < data.lastOpen && upperWick >= candleBody * 1.5 && lowerWick <= candleBody * 0.8;
    const patternOk = side === "BUY" ? bullishEngulfing || bullishRejection : bearishEngulfing || bearishRejection;
    const patternLabel =
      side === "BUY"
        ? bullishEngulfing
          ? "bullish engulfing"
          : bullishRejection
          ? "bullish rejection"
          : "no bullish rejection/engulfing"
        : bearishEngulfing
        ? "bearish engulfing"
        : bearishRejection
        ? "bearish rejection"
        : "no bearish rejection/engulfing";
    return {
      nearStructure: zoneDistance <= zoneBuffer,
      zoneDistance,
      zoneBuffer,
      zoneAtrRatio: atrValue > 0 ? zoneDistance / atrValue : Number.NaN,
      maOk,
      rsiOk,
      patternOk,
      patternLabel,
    };
  };

  const computeHighImpactNewsBlock = async (symbol) => {
    if (
      !state.config.auto.highImpactNewsFilterEnabled ||
      typeof fetchMarketIntelForSymbols !== "function" ||
      !Array.isArray(state.config.auto.highImpactNewsKeywords) ||
      !state.config.auto.highImpactNewsKeywords.length
    ) {
      return { blocked: false, reason: "" };
    }

    const cacheKey = `${normalizeSymbol(symbol)}|${state.config.auto.highImpactNewsKeywords.join("|")}|${state.config.auto.highImpactNewsLookbackMin}`;
    const cached = state.highImpactNewsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAtMs < HIGH_IMPACT_NEWS_CACHE_MS) {
      return cached.result;
    }

    try {
      const result = await fetchMarketIntelForSymbols([symbol], 8);
      const entries = result?.ok && Array.isArray(result.symbols) ? result.symbols : [];
      const symbolEntry = entries.find((entry) => normalizeSymbol(entry.symbol) === normalizeSymbol(symbol));
      const news = Array.isArray(symbolEntry?.news) ? symbolEntry.news : [];
      const keywords = state.config.auto.highImpactNewsKeywords.map((item) => String(item || "").toUpperCase());
      const lookbackMs = Number(state.config.auto.highImpactNewsLookbackMin) * 60 * 1000;
      const nowMs = Date.now();
      const matched = news.find((item) => {
        const publishedMs = Date.parse(String(item?.publishedAt || ""));
        if (!Number.isFinite(publishedMs) || nowMs - publishedMs > lookbackMs) return false;
        const haystack = `${String(item?.title || "")} ${String(item?.summary || "")}`.toUpperCase();
        return keywords.some((keyword) => haystack.includes(keyword));
      });
      const finalResult = matched
        ? {
            blocked: true,
            reason: `High-impact news filter: ${matched.title || "macro event"} (${state.config.auto.highImpactNewsKeywords.join("/")})`,
          }
        : { blocked: false, reason: "" };
      state.highImpactNewsCache.set(cacheKey, { cachedAtMs: nowMs, result: finalResult });
      return finalResult;
    } catch {
      return { blocked: false, reason: "" };
    }
  };

  const generatePriceData = async (symbol, timeframe) => {
    const candles = await fetchCandles(symbol, timeframe, 320);
    return buildPriceDataFromCandles(symbol, candles);
  };

  const getManagedWatchItem = (symbol, config = state.config) =>
    (Array.isArray(config?.watchlist) ? config.watchlist : []).find((item) => symbolsMatch(item?.symbol, symbol)) || null;

  const getManagedProtectionRiskDistanceCap = async (symbol, lots, maxRiskUsd) => {
    if (!(Number.isFinite(lots) && lots > 0 && Number.isFinite(maxRiskUsd) && maxRiskUsd > 0)) {
      return Number.NaN;
    }
    const specResult = await readMt4SymbolSpecs({ symbol });
    const spec = specResult.ok ? specResult.spec : null;
    const tickValue = Number(spec?.tickValue || 0);
    const tickSize = Number(spec?.tickSize || 0);
    const point = Number(spec?.point || 0);
    const lotSize = Number(spec?.lotSize || 0);
    let moneyPerPricePerLot = 0;
    if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(tickSize) && tickSize > 0) {
      moneyPerPricePerLot = tickValue / tickSize;
    } else if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(point) && point > 0) {
      moneyPerPricePerLot = tickValue / point;
    } else if (Number.isFinite(lotSize) && lotSize > 0) {
      moneyPerPricePerLot = lotSize;
    }
    return moneyPerPricePerLot > 0 ? maxRiskUsd / (moneyPerPricePerLot * lots) : Number.NaN;
  };

  const buildMissingProtectionPlan = async (position, side, tick, autoConfig = getEffectiveAutoConfig(position.symbol)) => {
    const missingSl = !(Number(position.sl) > 0);
    const missingTp = !(Number(position.tp) > 0);
    if (!missingSl && !missingTp) return null;

    const watchItem = getManagedWatchItem(position.symbol);
    if (!watchItem) return null;

    const entry = Number(position.openPrice);
    if (!Number.isFinite(entry) || entry <= 0) return null;

    const timeframe = toChartTimeframe(watchItem.timeframe, toChartTimeframe(autoConfig.entryTimeframe, "M15"));
    const data = await generatePriceData(watchItem.symbol, timeframe);
    if (!data) return null;

    const current = Number(tick?.mid ?? data.current);
    const point = getPointSizeForSymbol(position.symbol, current || entry);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0
        ? data.atr
        : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const minSlPoints = Math.max(1, Number(autoConfig.minSlPoints) || getMinSlPointsForSymbol(position.symbol, autoConfig));
    const atrBufferMult = Math.max(0, Number(autoConfig.atrBufferMult) || 0.25);
    const minRR = Math.max(0.5, Number(autoConfig.minRR) || 1.0);
    const minStopDistance = Math.max(point * minSlPoints, atrValue * 0.35);
    const structureBuffer = Math.max(point * 3, atrValue * atrBufferMult);
    const structureLevel =
      side === "BUY"
        ? Math.min(Number(data.supportLevel), Number(data.swingLow))
        : Math.max(Number(data.resistanceLevel), Number(data.swingHigh));

    let computedSl = Number(position.sl);
    if (missingSl) {
      if (!Number.isFinite(structureLevel) || structureLevel <= 0) return null;
      computedSl =
        side === "BUY"
          ? Math.min(structureLevel - structureBuffer, entry - point, current - minStopDistance)
          : Math.max(structureLevel + structureBuffer, entry + point, current + minStopDistance);
      const lots = Number(position.lots);
      const maxRiskDistance = await getManagedProtectionRiskDistanceCap(
        position.symbol,
        lots,
        MANAGED_PROTECT_MAX_RISK_USD
      );
      if (Number.isFinite(maxRiskDistance) && maxRiskDistance > point) {
        const cappedSl = side === "BUY" ? entry - maxRiskDistance : entry + maxRiskDistance;
        computedSl = side === "BUY" ? Math.max(computedSl, cappedSl) : Math.min(computedSl, cappedSl);
      }
    }

    if (!Number.isFinite(computedSl) || computedSl <= 0) return null;
    if (missingSl) {
      if (side === "BUY" && !(computedSl < entry - point)) return null;
      if (side === "SELL" && !(computedSl > entry + point)) return null;
      if (tick && side === "BUY" && !(computedSl < tick.bid - point)) return null;
      if (tick && side === "SELL" && !(computedSl > tick.ask + point)) return null;
    }

    const rawRiskDistance = side === "BUY" ? entry - computedSl : computedSl - entry;
    const riskDistance =
      Number.isFinite(rawRiskDistance) && rawRiskDistance > point
        ? rawRiskDistance
        : minStopDistance;
    if (!Number.isFinite(riskDistance) || riskDistance <= point) return null;

    const existingTp = Number(position.tp);
    let finalTp = existingTp;
    let tpSource = "RR";
    if (missingTp) {
      const structureTarget = getDirectionalStructureTarget(side, data, entry, point);
      const structureTargetValue = Number(structureTarget);
      const structureTpOk =
        Number.isFinite(structureTargetValue) &&
        ((side === "BUY" && structureTargetValue > Math.max(entry + point, current + point)) ||
          (side === "SELL" && structureTargetValue < Math.min(entry - point, current - point)));
      const rrTarget = side === "BUY" ? entry + riskDistance * minRR : entry - riskDistance * minRR;
      const fallbackTp = side === "BUY" ? Math.max(rrTarget, current + point) : Math.min(rrTarget, current - point);
      const structureRewardDistance = side === "BUY" ? structureTargetValue - entry : entry - structureTargetValue;
      const structureRr =
        structureTpOk && Number.isFinite(structureRewardDistance) && structureRewardDistance > point
          ? structureRewardDistance / riskDistance
          : Number.NaN;
      if (structureTpOk && Number.isFinite(structureRr) && structureRr >= minRR) {
        finalTp = structureTargetValue;
        tpSource = "STRUCTURE";
      } else {
        finalTp = fallbackTp;
      }
    }

    if (!Number.isFinite(finalTp) || finalTp <= 0) return null;
    if (side === "BUY" && !(finalTp > entry + point)) return null;
    if (side === "SELL" && !(finalTp < entry - point)) return null;
    if (tick && side === "BUY" && !(finalTp > tick.ask + point)) return null;
    if (tick && side === "SELL" && !(finalTp < tick.bid - point)) return null;

    const rewardDistance = side === "BUY" ? finalTp - entry : entry - finalTp;
    const rr =
      Number.isFinite(rewardDistance) && rewardDistance > point
        ? rewardDistance / riskDistance
        : Number.NaN;
    if (!Number.isFinite(rr) || rr <= 0) return null;

    return {
      symbol: watchItem.symbol,
      timeframe,
      sl: computedSl,
      tp: finalTp,
      rr,
      tpSource,
    };
  };

  const evaluateCooldownReentryConfirmation = async (symbol, side, autoConfig = state.config.auto) => {
    const reentryMode = String(autoConfig.reentryMode || "BALANCED").toUpperCase();
    if (reentryMode === "OFF") {
      return { ok: true, reason: "Re-entry confirmation disabled" };
    }

    const m5Candles = await fetchCandles(symbol, "M5", 12);
    const closedM5 = m5Candles.slice(0, -1).slice(-4);
    if (closedM5.length < 4) {
      return { ok: false, reason: "M5 re-entry bias unavailable" };
    }

    const bullishM5 = closedM5.filter((candle) => candle.close > candle.open).length;
    const bearishM5 = closedM5.filter((candle) => candle.close < candle.open).length;
    const m5NetMove = closedM5[closedM5.length - 1].close - closedM5[0].open;
    const requiredM5Count = reentryMode === "STRICT" ? 4 : 3;
    const m5BiasOk = side === "BUY" ? bullishM5 >= requiredM5Count && m5NetMove > 0 : bearishM5 >= requiredM5Count && m5NetMove < 0;
    if (!m5BiasOk) {
      return {
        ok: false,
        reason:
          `Previous 4 M5 candles do not support ${side} bias ` +
          `(${side === "BUY" ? bullishM5 + "/4 bullish" : bearishM5 + "/4 bearish"}, need ${requiredM5Count}, net ${m5NetMove >= 0 ? "+" : ""}${m5NetMove.toFixed(5)})`,
      };
    }

    const m1Candles = await fetchCandles(symbol, "M1", 90);
    const closedM1 = m1Candles.slice(0, -1);
    const m1Data = buildPriceDataFromCandles(symbol, closedM1);
    const m1LastClosed = closedM1[closedM1.length - 1];
    if (!m1Data || !m1LastClosed) {
      return { ok: false, reason: "M1 confirmation unavailable" };
    }

    const m1Signal = generateTradeSignal(m1Data, autoConfig);
    const m1CandleOk = side === "BUY" ? m1LastClosed.close > m1LastClosed.open : m1LastClosed.close < m1LastClosed.open;
    const m1EmaOk =
      side === "BUY" ? m1LastClosed.close >= m1Data.movingAverage50 : m1LastClosed.close <= m1Data.movingAverage50;
    const requireEmaFilter = reentryMode === "STRICT";
    if (!(m1Signal.signal === side && m1CandleOk && (!requireEmaFilter || m1EmaOk))) {
      return {
        ok: false,
        reason:
          `M1 confirmation does not match ${side} bias ` +
          `(signal ${m1Signal.signal}, candle ${m1CandleOk ? "confirms" : "opposes"}${requireEmaFilter ? `, EMA50 ${m1EmaOk ? "aligned" : "not aligned"}` : ""})`,
      };
    }

    return { ok: true, reason: `M5 bias and M1 confirmation aligned for ${side}` };
  };

  const generateTradeSignal = (data, autoConfig = state.config.auto) => {
    let signal = "HOLD";
    let strength = "WEAK";
    let confidence = 0;
    if (data.rsi < 30) {
      signal = "BUY";
      confidence += 25;
    } else if (data.rsi > 70) {
      signal = "SELL";
      confidence += 25;
    }
    if (data.current > data.movingAverage50 && data.movingAverage50 > data.movingAverage200) {
      if (signal !== "SELL") signal = "BUY";
      confidence += 25;
    } else if (data.current < data.movingAverage50 && data.movingAverage50 < data.movingAverage200) {
      if (signal !== "BUY") signal = "SELL";
      confidence += 25;
    }
    if (data.macd.line > data.macd.signal && data.macd.histogram > 0) {
      if (signal !== "SELL") signal = "BUY";
      confidence += 25;
    } else if (data.macd.line < data.macd.signal && data.macd.histogram < 0) {
      if (signal !== "BUY") signal = "SELL";
      confidence += 25;
    }
    const noiseProfile = buildSignalNoiseProfile(data);
    if (signal !== "HOLD") {
      confidence = Math.max(0, confidence - noiseProfile.confidencePenalty);
      if (noiseProfile.noiseState === "HIGH" && confidence < 55) {
        signal = "HOLD";
      }
    }
    if (signal === "HOLD") strength = "WEAK";
    else if (confidence > 60) strength = "STRONG";
    else if (confidence > 35) strength = "MODERATE";

    const point = getPointSizeForSymbol(data.symbol, data.current);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0 ? data.atr : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const minStopDistance = Math.max(point * getMinSlPointsForSymbol(data.symbol, autoConfig), atrValue * 0.35);
    const structureBuffer = Math.max(
      point * 3,
      atrValue * Math.max(0, Number(autoConfig.atrBufferMult) || 0.25)
    );
    const entryPrimary = data.current;
    const entryAlternative = signal === "BUY" ? data.supportLevel : data.resistanceLevel;
    let stopLoss = entryPrimary;
    if (signal === "BUY") {
      const structureSL = Math.min(data.supportLevel, data.swingLow) - structureBuffer;
      const fallbackSL = entryPrimary - minStopDistance;
      stopLoss = Math.min(structureSL, fallbackSL);
      if (!(stopLoss < entryPrimary)) stopLoss = fallbackSL;
    } else if (signal === "SELL") {
      const structureSL = Math.max(data.resistanceLevel, data.swingHigh) + structureBuffer;
      const fallbackSL = entryPrimary + minStopDistance;
      stopLoss = Math.max(structureSL, fallbackSL);
      if (!(stopLoss > entryPrimary)) stopLoss = fallbackSL;
    } else {
      stopLoss = entryPrimary - minStopDistance;
    }
    const riskDistance = Math.max(Math.abs(entryPrimary - stopLoss), minStopDistance);
    const targetRR = strength === "STRONG" ? 2.2 : strength === "MODERATE" ? 2.0 : 1.8;
    const structureTarget =
      signal === "BUY" || signal === "SELL"
        ? getDirectionalStructureTarget(signal, data, entryPrimary, point)
        : null;
    const rrTargetPrice =
      signal === "BUY"
        ? entryPrimary + riskDistance * targetRR
        : signal === "SELL"
        ? entryPrimary - riskDistance * targetRR
        : entryPrimary + riskDistance;
    const takeProfit = structureTarget ?? rrTargetPrice;
    const digits = isCryptoSymbol(data.symbol) ? 2 : 5;
    return {
      symbol: data.symbol,
      signal,
      strength,
      entryPoints: {
        primary: Number(entryPrimary.toFixed(digits)),
        alternative: Number(entryAlternative.toFixed(digits)),
      },
      stopLoss: Number(stopLoss.toFixed(digits)),
      takeProfit: Number(takeProfit.toFixed(digits)),
      risk: Number(riskDistance.toFixed(digits)),
      reward: Number(Math.abs(takeProfit - entryPrimary).toFixed(digits)),
      confidence: Math.min(confidence, 100),
      winRate: calculateWinRate(data, signal, noiseProfile),
      noiseScore: noiseProfile.noiseScore,
      noiseState: noiseProfile.noiseState,
      isCrypto: isCryptoSymbol(data.symbol),
    };
  };

  const buildAutoOrderPlan = (symbol, data, signal, liveEntryPrice, autoConfig = state.config.auto) => {
    const side = signal.signal === "BUY" ? "BUY" : "SELL";
    const point = getPointSizeForSymbol(symbol, data.current);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0 ? data.atr : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const minStopDistance = Math.max(point * getMinSlPointsForSymbol(symbol, autoConfig), atrValue * 0.35);
    const rrTarget = Math.max(1.1, Number(autoConfig.minRR) || 1.8);
    const fallbackMinConfidence = Math.max(0, Math.min(100, Number(autoConfig.fallbackMinConfidence) || 80));
    const fallbackRrBuffer = Math.max(0, Number(autoConfig.fallbackRrBuffer) || 0.2);

    if (autoConfig.entryMode === "LIMIT_SR") {
      const structureEntry =
        side === "BUY" ? Math.min(data.supportLevel, data.swingLow) : Math.max(data.resistanceLevel, data.swingHigh);
      const entryBuffer = Math.max(point * 2, atrValue * 0.1);
      const pendingPrice = side === "BUY" ? structureEntry + entryBuffer : structureEntry - entryBuffer;
      const referenceEntry =
        Number.isFinite(liveEntryPrice) && Number(liveEntryPrice) > 0 ? Number(liveEntryPrice) : Number(data.current);
      const validPendingSide =
        side === "BUY" ? pendingPrice < referenceEntry - point : pendingPrice > referenceEntry + point;
      if (Number.isFinite(pendingPrice) && pendingPrice > 0 && validPendingSide) {
        let sl = Number(signal.stopLoss);
        if (!Number.isFinite(sl)) sl = side === "BUY" ? pendingPrice - minStopDistance : pendingPrice + minStopDistance;
        if (side === "BUY" && !(sl < pendingPrice - point)) sl = pendingPrice - minStopDistance;
        if (side === "SELL" && !(sl > pendingPrice + point)) sl = pendingPrice + minStopDistance;
        const riskDistance = Math.max(Math.abs(pendingPrice - sl), minStopDistance);
        const structureTarget = getDirectionalStructureTarget(side, data, pendingPrice, point);
        if (!structureTarget) {
          return {
            plan: null,
            blockedReason: "Structure TP unavailable beyond the pending entry; move already extended past the next zone",
          };
        }
        const structureRr = computeEffectiveRR(side, pendingPrice, sl, structureTarget);
        if (!Number.isFinite(structureRr)) {
          return { plan: null, blockedReason: "Structure TP R:R unavailable" };
        }
        if (structureRr < rrTarget) {
          return {
            plan: null,
            blockedReason: `Structure TP R:R ${structureRr.toFixed(2)} < ${rrTarget.toFixed(2)}`,
          };
        }
        return {
          plan: {
            action: "PENDING",
            side,
            orderType: side === "BUY" ? "BUY_LIMIT" : "SELL_LIMIT",
            price: pendingPrice,
            sl,
            tp: structureTarget,
            entryForRisk: pendingPrice,
            label: `${side} LIMIT @ S/R`,
            tpSource: "STRUCTURE",
            rrAtTp: structureRr,
          },
        };
      }
      if (!autoConfig.allowMarketFallback) {
        return { plan: null, blockedReason: "Limit @ S/R invalid and market fallback is disabled" };
      }
      const marketEntry =
        Number.isFinite(liveEntryPrice) && Number(liveEntryPrice) > 0
          ? Number(liveEntryPrice)
          : Number(data.current || signal.entryPoints.primary);
      const structureBuffer = Math.max(
        point * 3,
        atrValue * Math.max(0, Number(autoConfig.atrBufferMult) || 0.25)
      );
      let marketSl = Number(signal.stopLoss);
      if (side === "BUY") {
        const structureSl = Math.min(data.supportLevel, data.swingLow) - structureBuffer;
        const minDistanceSl = marketEntry - minStopDistance;
        marketSl = Number.isFinite(structureSl) ? Math.min(structureSl, minDistanceSl) : minDistanceSl;
        if (!(marketSl < marketEntry - point)) marketSl = minDistanceSl;
      } else {
        const structureSl = Math.max(data.resistanceLevel, data.swingHigh) + structureBuffer;
        const minDistanceSl = marketEntry + minStopDistance;
        marketSl = Number.isFinite(structureSl) ? Math.max(structureSl, minDistanceSl) : minDistanceSl;
        if (!(marketSl > marketEntry + point)) marketSl = minDistanceSl;
      }
      let slDistance = Math.abs(marketEntry - marketSl);
      if (!Number.isFinite(slDistance) || slDistance < minStopDistance) {
        marketSl = side === "BUY" ? marketEntry - minStopDistance : marketEntry + minStopDistance;
        slDistance = Math.abs(marketEntry - marketSl);
      }
      const fallbackRiskDistance = Math.max(slDistance, minStopDistance);
      const structureTarget = getDirectionalStructureTarget(side, data, marketEntry, point);
      const marketTp =
        structureTarget ??
        (side === "BUY" ? marketEntry + fallbackRiskDistance * rrTarget : marketEntry - fallbackRiskDistance * rrTarget);
      const marketRr = computeEffectiveRR(side, marketEntry, marketSl, marketTp);
      if (signal.confidence < fallbackMinConfidence) {
        return {
          plan: null,
          blockedReason: `Market fallback blocked: confidence ${signal.confidence.toFixed(0)}% < ${fallbackMinConfidence}%`,
        };
      }
      if (Number.isFinite(marketRr) && marketRr < rrTarget + fallbackRrBuffer) {
        return {
          plan: null,
          blockedReason: `Market fallback blocked: R:R ${marketRr.toFixed(2)} < ${(rrTarget + fallbackRrBuffer).toFixed(2)}`,
        };
      }
      if (!Number.isFinite(marketRr)) {
        return { plan: null, blockedReason: "Market fallback blocked: R:R unavailable" };
      }
      const directionOk =
        side === "BUY" ? marketSl < marketEntry && marketTp > marketEntry : marketSl > marketEntry && marketTp < marketEntry;
      if (!directionOk) {
        return { plan: null, blockedReason: "Limit @ S/R invalid and fallback SL/TP direction failed" };
      }
      return {
        plan: {
          action: "PLACE",
          side,
          sl: marketSl,
          tp: marketTp,
          entryForRisk: marketEntry,
          label: `${side} MARKET`,
          fallbackReason: "Fallback to MARKET: invalid limit-at-structure",
          tpSource: structureTarget ? "STRUCTURE" : "RR",
          rrAtTp: marketRr,
        },
      };
    }

    const marketEntry =
      Number.isFinite(liveEntryPrice) && Number(liveEntryPrice) > 0
        ? Number(liveEntryPrice)
        : Number(data.current || signal.entryPoints.primary);
    let marketSl = Number(signal.stopLoss);
    let marketTp = Number(signal.takeProfit);
    const directionOk =
      side === "BUY" ? marketSl < marketEntry && marketTp > marketEntry : marketSl > marketEntry && marketTp < marketEntry;
    let reframedStops = false;
    if (!directionOk) {
      const fallbackRiskDistance = Math.max(
        minStopDistance,
        Number.isFinite(marketSl) ? Math.abs(marketEntry - marketSl) : 0
      );
      marketSl = side === "BUY" ? marketEntry - fallbackRiskDistance : marketEntry + fallbackRiskDistance;
      marketTp =
        side === "BUY" ? marketEntry + fallbackRiskDistance * rrTarget : marketEntry - fallbackRiskDistance * rrTarget;
      reframedStops = true;
    }
    return {
      plan: {
        action: "PLACE",
        side,
        sl: marketSl,
        tp: marketTp,
        entryForRisk: marketEntry,
        label: `${side} MARKET`,
        fallbackReason: reframedStops ? "SL/TP auto-reframed from live entry (stale signal levels)" : undefined,
        tpSource: "RR",
        rrAtTp: computeEffectiveRR(side, marketEntry, marketSl, marketTp),
      },
    };
  };

  const executeValidatedRequest = async (payload, auditContext = {}) => {
    if (state.commandBusy) {
      return { ok: false, error: "Bridge command busy" };
    }
    state.commandBusy = true;
    try {
      const validation = validateOrderRequest(payload);
      if (!validation.ok) {
        return { ok: false, error: validation.error || "Invalid order request" };
      }

      if (validation.request.action === "PLACE" || validation.request.action === "PENDING") {
        const resolved = await resolveExecutableSymbol(validation.request.symbol);
        if (!resolved.ok) {
          return { ok: false, error: resolved.error || "Failed to resolve broker symbol" };
        }
        validation.request.symbol = resolved.symbol;
        if (!validateAllowedSymbol(validation.request.symbol)) {
          return { ok: false, error: `symbol ${validation.request.symbol} is not allowed` };
        }
        const evaluation = await evaluatePlaceRiskPolicy(validation.request);
        if (!evaluation.ok) {
          const failed = evaluation.checks.find((check) => !check.ok);
          return { ok: false, error: failed?.detail || failed?.rule || "Risk policy blocked order" };
        }
      }

      const result = await executeMt4Command({
        ...validation.request,
        id: randomUUID(),
      });

      if (result.ok) {
        if (auditContext.symbol && auditContext.successStage) {
          pushAudit(
            auditContext.symbol,
            auditContext.successStage,
            auditContext.successMessage ||
              `${validation.summary}${result.ticket ? ` ticket=${result.ticket}` : ""}${result.price ? ` price=${result.price}` : ""}`
          );
        }
        return result;
      }

      if (auditContext.symbol && auditContext.failureStage) {
        pushAudit(auditContext.symbol, auditContext.failureStage, result.message || result.error || "execution failed");
      }
      return { ok: false, error: result.message || result.error || "execution failed" };
    } finally {
      state.commandBusy = false;
    }
  };

  const evaluateTradeCandidate = async ({
    symbol,
    panelTimeframe,
    positions,
    currentOpenCount,
    accountRiskBase,
    specCache,
    trendCache,
    nowMs,
  }) => {
    const autoConfig = getEffectiveAutoConfig(symbol);
    const strategyMode = String(autoConfig.strategyMode || "CLASSIC_STACK").toUpperCase();
    if (!autoConfig.enabled) {
      return { eligible: false, reason: "Symbol auto-trade disabled" };
    }
    const autoTimeframe =
      autoConfig.timeframeOverride && autoConfig.timeframeOverride !== "PANEL"
        ? autoConfig.timeframeOverride
        : panelTimeframe;
    const dataForOrder = await generatePriceData(symbol, autoTimeframe);
    if (!dataForOrder) {
      return { eligible: false, reason: `No MT4 candle data available for ${symbol} ${autoTimeframe}` };
    }

    const signal = generateTradeSignal(dataForOrder, autoConfig);
    if (!signal || signal.signal === "HOLD") {
      return { eligible: false, reason: "No actionable signal" };
    }

    if (strategyMode === "CLASSIC_STACK") {
      const biasCacheKey = `${symbol}|${AUTO_BIAS_TIMEFRAME}`;
      let biasSignal = trendCache.get(biasCacheKey);
      if (biasSignal === undefined) {
        const biasData = await generatePriceData(symbol, AUTO_BIAS_TIMEFRAME);
        biasSignal = biasData ? generateTradeSignal(biasData, autoConfig) : null;
        trendCache.set(biasCacheKey, biasSignal);
      }
      const h4Bias = biasSignal?.signal === "BUY" || biasSignal?.signal === "SELL" ? biasSignal.signal : null;
      if (h4Bias && signal.signal !== h4Bias) {
        return {
          eligible: false,
          reason: `${AUTO_BIAS_TIMEFRAME} bias is ${h4Bias}; wait for ${h4Bias} entry confirmation`,
        };
      }
    }

    const resolvedSymbol = await resolveExecutableSymbol(symbol);
    if (!resolvedSymbol.ok) {
      return { eligible: false, reason: resolvedSymbol.error || "Failed to resolve broker symbol" };
    }

    const liveTick = await fetchTick(resolvedSymbol.symbol);
    const orderPlanResult = buildAutoOrderPlan(symbol, dataForOrder, signal, liveTick?.mid, autoConfig);
    const orderPlan = orderPlanResult.plan;
    if (!orderPlan) {
      return { eligible: false, reason: orderPlanResult.blockedReason || "No valid order plan" };
    }
    if (
      (autoConfig.sideFilter === "BUY_ONLY" && orderPlan.side !== "BUY") ||
      (autoConfig.sideFilter === "SELL_ONLY" && orderPlan.side !== "SELL")
    ) {
      return {
        eligible: false,
        reason: `Side filter blocked ${orderPlan.side} (${autoConfig.sideFilter})`,
      };
    }

    let strategyBlockReason = null;
    if (signal.confidence < Number(autoConfig.minConfidence)) {
      strategyBlockReason = `Confidence ${signal.confidence.toFixed(0)}% < ${Number(autoConfig.minConfidence)}%`;
    }
    if (signal.winRate < Number(autoConfig.minWinRate) && !strategyBlockReason) {
      strategyBlockReason = `Win rate ${signal.winRate.toFixed(0)}% < ${Number(autoConfig.minWinRate)}%`;
    }
    if (signal.noiseState === "HIGH" && !strategyBlockReason) {
      strategyBlockReason = `Noise filter: setup too choppy (${signal.noiseScore.toFixed(0)}%)`;
    }
    if (autoConfig.requireStrong && signal.strength !== "STRONG" && !strategyBlockReason) {
      strategyBlockReason = "Signal strength is not STRONG";
    }
    if (!isBrokerSessionOpen(symbol, nowMs) && !strategyBlockReason) {
      strategyBlockReason = "Broker market closed";
    }
    if (!isAutoSessionWindowOpen(symbol, autoConfig, nowMs) && !strategyBlockReason) {
      strategyBlockReason = "Outside configured auto-trade session window";
    }
    if (
      getEffectiveProtectConfig(symbol).overnightEnabled &&
      autoConfig.ma200FlatFilterEnabled &&
      Number.isFinite(Number(dataForOrder.movingAverage200SlopeAtrRatio)) &&
      Number(dataForOrder.movingAverage200SlopeAtrRatio) > Number(autoConfig.ma200FlatMaxAtrRatio) &&
      !strategyBlockReason
    ) {
      strategyBlockReason =
        `MA200 trend too strong (` +
        `MA200 ${Number(dataForOrder.movingAverage200).toFixed(2)} vs prev ${Number(dataForOrder.movingAverage200Prev).toFixed(2)}, ` +
        `slope ${Number(dataForOrder.movingAverage200Slope).toFixed(2)}, ` +
        `ATR ratio ${Number(dataForOrder.movingAverage200SlopeAtrRatio).toFixed(2)} > ${Number(autoConfig.ma200FlatMaxAtrRatio).toFixed(2)}` +
        `)`;
    }
    if (currentOpenCount >= Number(autoConfig.maxOpenTrades) && !strategyBlockReason) {
      strategyBlockReason = `Max active positions reached (${currentOpenCount}/${autoConfig.maxOpenTrades})`;
    }
    if (autoConfig.adaptiveLearningEnabled) {
      const symbolKey = normalizeSymbol(symbol);
      const blockedSymbol = autoConfig.learnedBlockedSymbols.some(
        (item) => item === symbolKey || item.startsWith(symbolKey) || symbolKey.startsWith(item)
      );
      if (blockedSymbol && !strategyBlockReason) {
        strategyBlockReason = "Adaptive filter blocked this symbol";
      }
      if (autoConfig.learnedBlockedSessions.includes(classifyAdaptiveSession(nowMs)) && !strategyBlockReason) {
        strategyBlockReason = "Adaptive filter blocked the current session";
      }
    }

    const symbolKey = normalizeSymbol(symbol);
    const hasSameSymbolOpen = positions.some((position) => normalizeSymbol(position.symbol).startsWith(symbolKey));
    if (hasSameSymbolOpen && !strategyBlockReason) {
      strategyBlockReason = "Existing open position on symbol";
    }

    if (strategyMode === "CLASSIC_STACK" && !strategyBlockReason) {
      const confirmation = evaluateDirectionalConfirmation(symbol, dataForOrder, orderPlan.side, autoConfig);
      if (!confirmation.nearStructure) {
        strategyBlockReason = `Price is not yet at the ${orderPlan.side === "BUY" ? "support" : "resistance"} zone on ${autoTimeframe} (${confirmation.zoneAtrRatio.toFixed(2)} ATR away)`;
      }
      if (!confirmation.maOk && !strategyBlockReason) {
        strategyBlockReason = `${autoTimeframe} MA50 filter blocks ${orderPlan.side}`;
      }
      if (!confirmation.rsiOk && !strategyBlockReason) {
        strategyBlockReason = `${autoTimeframe} RSI is not supportive for ${orderPlan.side} (${Number(dataForOrder.rsi).toFixed(1)})`;
      }
      if (!confirmation.patternOk && !strategyBlockReason) {
        strategyBlockReason = `Need ${orderPlan.side === "BUY" ? "bullish" : "bearish"} rejection or engulfing candle on ${autoTimeframe}`;
      }
    }

    if (getEffectiveProtectConfig(symbol).overnightEnabled && !strategyBlockReason) {
      const newsBlock = await computeHighImpactNewsBlock(symbol);
      if (newsBlock.blocked) {
        strategyBlockReason = newsBlock.reason;
      }
    }

    if (strategyMode === "CLASSIC_STACK" && autoConfig.enforceTrendStack !== false) {
      const trendFrames = getTrendFilterFrames(autoConfig.entryTimeframe);
      const trendState = {};
      let aligned = true;
      for (const tf of trendFrames) {
        const cacheKey = `${symbol}|${tf}`;
        let trendSignal = trendCache.get(cacheKey);
        if (trendSignal === undefined) {
          const trendData = await generatePriceData(symbol, tf);
          trendSignal = trendData ? generateTradeSignal(trendData, autoConfig) : null;
          trendCache.set(cacheKey, trendSignal);
        }
        trendState[tf] = trendSignal?.signal || "N/A";
        if (trendState[tf] !== orderPlan.side) aligned = false;
      }
      if (!aligned && !strategyBlockReason) {
        strategyBlockReason = `Trend filter blocked ${orderPlan.side} (${trendFrames
          .map((frame) => `${frame}=${trendState[frame]}`)
          .join(", ")})`;
      }
    }

    if (!strategyBlockReason) {
      const reentryConfirmation = await evaluateCooldownReentryConfirmation(symbol, orderPlan.side, autoConfig);
      if (!reentryConfirmation.ok) {
        strategyBlockReason = reentryConfirmation.reason;
      }
    }

    if (liveTick) {
      const point = getPointSizeForSymbol(symbol, liveTick.mid);
      const spreadPoints = point > 0 ? Math.max(0, liveTick.ask - liveTick.bid) / point : 0;
      if (Number.isFinite(spreadPoints) && spreadPoints > getSpreadGuardPointsForSymbol(symbol, autoConfig) && !strategyBlockReason) {
        strategyBlockReason = `Spread guard: ${spreadPoints.toFixed(1)} pts`;
      }
    }

    let lots = Number(autoConfig.botLots);
    let rawRiskLot;
    let actualRiskLot;
    if (autoConfig.useDynamicLot) {
      if (accountRiskBase <= 0) {
        return { eligible: false, reason: "Account snapshot unavailable for dynamic lot" };
      }

      let spec = specCache.get(resolvedSymbol.symbol);
      if (spec === undefined) {
        const specResult = await readMt4SymbolSpecs({ symbol: resolvedSymbol.symbol });
        if (specResult.ok && specResult.spec) {
          const tickValue = Number(specResult.spec.tickValue || 0);
          const tickSize = Number(specResult.spec.tickSize || 0);
          spec =
            Number.isFinite(tickValue) &&
            tickValue > 0 &&
            Number.isFinite(tickSize) &&
            tickSize > 0
              ? { tickValue, tickSize }
              : null;
        } else {
          spec = null;
        }
        specCache.set(resolvedSymbol.symbol, spec);
      }
      if (!spec) {
        return { eligible: false, reason: "Symbol tick spec unavailable" };
      }

      const entry = Number(orderPlan.entryForRisk);
      let slDistance = Math.abs(entry - Number(orderPlan.sl));
      if (!Number.isFinite(slDistance) || slDistance <= 0) {
        return { eligible: false, reason: "Invalid SL distance" };
      }

      const riskAmount =
        autoConfig.riskMode === "USD"
          ? Number(autoConfig.riskUsd)
          : accountRiskBase * (Number(autoConfig.riskPct) / 100);
      let riskPerLot = (slDistance / spec.tickSize) * spec.tickValue;
      if (!Number.isFinite(riskPerLot) || riskPerLot <= 0) {
        return { eligible: false, reason: "Invalid risk-per-lot" };
      }

      let rawLots = riskAmount / riskPerLot;
      rawRiskLot = rawLots;
      if (!Number.isFinite(rawLots) || rawLots <= 0) {
        return { eligible: false, reason: "Lot calculation failed" };
      }

      const minLot = Number(autoConfig.minLot);
      const lotStep = Number(autoConfig.lotStep);
      if (rawLots < minLot) {
        const pointSize = getPointSizeForSymbol(symbol, entry);
        const minDistanceByPoints = Math.max(pointSize, pointSize * getMinSlPointsForSymbol(symbol, autoConfig));
        const requiredRiskPerLot = riskAmount / minLot;
        const requiredSlDistance = requiredRiskPerLot * (spec.tickSize / spec.tickValue);
        const adjustedSlDistance = Math.max(minDistanceByPoints, requiredSlDistance);

        if (Number.isFinite(adjustedSlDistance) && adjustedSlDistance > 0 && adjustedSlDistance < slDistance) {
          const adjustedSl = orderPlan.side === "BUY" ? entry - adjustedSlDistance : entry + adjustedSlDistance;
          const directionOk = orderPlan.side === "BUY" ? adjustedSl < entry : adjustedSl > entry;
          if (directionOk) {
            orderPlan.sl = adjustedSl;
            slDistance = adjustedSlDistance;
            riskPerLot = (slDistance / spec.tickSize) * spec.tickValue;
            rawLots = riskPerLot > 0 ? riskAmount / riskPerLot : 0;
            orderPlan.fallbackReason = orderPlan.fallbackReason
              ? `${orderPlan.fallbackReason}; SL tightened for min lot`
              : "SL tightened for min lot";
          }
        }
      }

      const minLotTolerance = Math.max(1e-6, lotStep / 1000);
      if (rawLots < minLot && minLot - rawLots <= minLotTolerance) {
        rawLots = minLot;
      }
      rawRiskLot = rawLots;
      if (rawLots < minLot) {
        actualRiskLot = minLot;
        if (!strategyBlockReason) {
          strategyBlockReason = `Risk lot ${rawLots.toFixed(5)} below min ${minLot}`;
        }
        lots = minLot;
      }

      const normalizedCap =
        Number.isFinite(Number(autoConfig.botLots)) && Number(autoConfig.botLots) > 0
          ? Number(autoConfig.botLots)
          : 5;
      const decimals = Math.max(2, String(lotStep).split(".")[1]?.length || 0);
      const minStepMultiple = Math.max(1, Math.ceil(minLot / lotStep - 1e-9));
      const minStepLot = Number((minStepMultiple * lotStep).toFixed(decimals));
      let stepped = Math.floor(rawLots / lotStep) * lotStep;
      if (stepped <= 0 && rawLots > 0) stepped = minStepLot;
      lots = Number(Math.min(normalizedCap, stepped).toFixed(decimals));
      if (lots <= 0 && rawLots > 0) lots = minStepLot;
      actualRiskLot = lots;

      const projectedRiskUsd = riskPerLot * lots;
      const targetRiskUsd =
        autoConfig.riskMode === "USD"
          ? Number(autoConfig.riskUsd)
          : accountRiskBase > 0
          ? accountRiskBase * (Number(autoConfig.riskPct) / 100)
          : 0;
      if (
        targetRiskUsd > 0 &&
        projectedRiskUsd > targetRiskUsd * Number(autoConfig.riskGuardMult) &&
        autoConfig.enforceHardRiskBlock
      ) {
        return {
          eligible: false,
          reason: `Hard-block: projected SL $${projectedRiskUsd.toFixed(2)} exceeds target $${targetRiskUsd.toFixed(2)}`,
        };
      }
    }

    const lotDecimals = Math.max(2, String(autoConfig.lotStep).split(".")[1]?.length || 0);
    const minStepMultipleFinal = Math.max(
      1,
      Math.ceil(Number(autoConfig.minLot) / Number(autoConfig.lotStep) - 1e-9)
    );
    const minStepLotFinal = Number((minStepMultipleFinal * Number(autoConfig.lotStep)).toFixed(lotDecimals));
    if (Number.isFinite(lots) && lots > 0 && lots < minStepLotFinal) {
      lots = minStepLotFinal;
      actualRiskLot = lots;
    }
    if (!Number.isFinite(lots) || lots <= 0) {
      return { eligible: false, reason: "Invalid lot size" };
    }

    const aggressiveTpSpecResult = await readMt4SymbolSpecs({ symbol: resolvedSymbol.symbol });
    if (aggressiveTpSpecResult.ok && aggressiveTpSpecResult.spec) {
      const entry = Number(orderPlan.entryForRisk);
      const point = getPointSizeForSymbol(symbol, entry);
      const moneyPerPricePerLot = computeMoneyPerPricePerLot(
        Number(aggressiveTpSpecResult.spec.tickValue || 0),
        Number(aggressiveTpSpecResult.spec.tickSize || 0),
        Number(aggressiveTpSpecResult.spec.point || 0),
        Number(aggressiveTpSpecResult.spec.lotSize || 0)
      );
      if (
        Number.isFinite(entry) &&
        entry > 0 &&
        Number.isFinite(lots) &&
        lots > 0 &&
        Number.isFinite(moneyPerPricePerLot) &&
        moneyPerPricePerLot > 0
      ) {
        const targetDistance = Math.max(point, AGGRESSIVE_AUTO_TP_TARGET_USD / (moneyPerPricePerLot * lots));
        const fixedTp = orderPlan.side === "BUY" ? entry + targetDistance : entry - targetDistance;
        if (Number.isFinite(fixedTp) && fixedTp > 0) {
          orderPlan.tp = fixedTp;
          orderPlan.tpSource = "RR";
          orderPlan.fallbackReason = orderPlan.fallbackReason
            ? `${orderPlan.fallbackReason}; TP targets ~$${AGGRESSIVE_AUTO_TP_TARGET_USD.toFixed(2)}`
            : `TP targets ~$${AGGRESSIVE_AUTO_TP_TARGET_USD.toFixed(2)}`;
        }
      }
    }

    const rrRatio = Number(
      computeEffectiveRR(orderPlan.side, Number(orderPlan.entryForRisk), Number(orderPlan.sl), Number(orderPlan.tp)).toFixed(2)
    );
    if (!Number.isFinite(rrRatio)) {
      if (!strategyBlockReason) strategyBlockReason = "R:R unavailable";
    } else if (rrRatio < Number(autoConfig.minRR) && !strategyBlockReason) {
      strategyBlockReason = `R:R ${rrRatio.toFixed(2)} < ${Number(autoConfig.minRR)}`;
    }

    const policyPayload = {
      action: orderPlan.action,
      symbol: resolvedSymbol.symbol,
      lots,
      sl: orderPlan.sl,
      tp: orderPlan.tp,
      symbolCooldownSec: autoConfig.enforceSymbolCooldown ? Number(autoConfig.cooldownMin) * 60 : 0,
      enforceSymbolCooldown: autoConfig.enforceSymbolCooldown,
      enforceDailyLossLimit: autoConfig.enforceDailyLossLimit,
      comment: `${autoConfig.commentTag}-${autoTimeframe}`,
    };
    if (orderPlan.action === "PLACE") {
      policyPayload.side = orderPlan.side;
    } else {
      policyPayload.orderType = orderPlan.orderType;
      policyPayload.price = orderPlan.price;
    }

    const policy = await evaluatePlaceRiskPolicy(policyPayload);
    if (!policy.ok) {
      const failed = policy.checks.find((check) => !check.ok);
      return {
        eligible: false,
        reason: strategyBlockReason || failed?.detail || failed?.rule || "Risk policy blocked order",
        orderPlan,
        resolvedSymbol: resolvedSymbol.symbol,
        lots,
        rawRiskLot,
        actualRiskLot,
      };
    }

    if (strategyBlockReason) {
      return {
        eligible: false,
        reason: strategyBlockReason,
        orderPlan,
        resolvedSymbol: resolvedSymbol.symbol,
        lots,
        rawRiskLot,
        actualRiskLot,
      };
    }

    return {
      eligible: true,
      reason: `Eligible now (${orderPlan.label}, R:R ${rrRatio.toFixed(2)})`,
      orderPlan,
      resolvedSymbol: resolvedSymbol.symbol,
      lots,
      rawRiskLot,
      actualRiskLot,
      autoTimeframe,
      autoConfig,
    };
  };

  const runAutoScan = async () => {
    if (!hasAnyAutoEnabled() || state.autoBusy) return { ok: true, skipped: true };
    if (state.overnightLossGuard.active) {
      state.autoStatus =
        state.overnightLossGuard.stopReason ||
        `Headless auto-trade blocked after ${OVERNIGHT_MAX_CONSECUTIVE_LOSSES} consecutive losses`;
      return { ok: true, skipped: true };
    }
    state.autoBusy = true;
    state.lastAutoRunAtMs = Date.now();
    try {
      const openResult = await listOpenPositions();
      const positions = openResult.ok && Array.isArray(openResult.positions) ? openResult.positions : [];
      let currentOpenCount = positions.length;
      let accountRiskBase = 0;
      if (
        state.config.watchlist.some((item) => {
          const autoConfig = getEffectiveAutoConfig(item.symbol);
          return autoConfig.enabled && (autoConfig.useDynamicLot || autoConfig.riskMode === "PCT");
        })
      ) {
        const accountResult = await readMt4AccountSnapshot();
        if (accountResult.ok && accountResult.account) {
          const balance = Number(accountResult.account.balance || 0);
          const equity = Number(accountResult.account.equity || 0);
          const candidate = equity > 0 ? Math.min(balance > 0 ? balance : equity, equity) : balance;
          accountRiskBase = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
        }
      }

      const specCache = new Map();
      const trendCache = new Map();
      const executedLocks = new Set();
      const executed = [];
      const skipped = [];

      for (const item of state.config.watchlist) {
        const symbol = item.symbol;
        const panelTimeframe = item.timeframe;
        const autoConfig = getEffectiveAutoConfig(symbol);
        if (!autoConfig.enabled) {
          skipped.push(`${symbol}: skipped - symbol auto-trade disabled`);
          continue;
        }
        const lockKey = normalizeSymbol(symbol).replace(/M$/, "");
        if (executedLocks.has(lockKey)) {
          skipped.push(`${symbol}: skipped - symbol lock active for current scan`);
          continue;
        }

        const evaluation = await evaluateTradeCandidate({
          symbol,
          panelTimeframe,
          positions,
          currentOpenCount,
          accountRiskBase,
          specCache,
          trendCache,
          nowMs: Date.now(),
        });

        if (!evaluation.eligible || !evaluation.orderPlan || !evaluation.resolvedSymbol || !evaluation.lots) {
          skipped.push(`${symbol}: skipped - ${evaluation.reason}`);
          continue;
        }

        if (evaluation.orderPlan.action === "PLACE") {
          const preSendTick = await fetchTick(evaluation.resolvedSymbol);
          if (!preSendTick) {
            skipped.push(`${symbol}: skipped - live tick unavailable`);
            continue;
          }
          const point = getPointSizeForSymbol(symbol, preSendTick.mid);
          const spreadPoints = point > 0 ? Math.max(0, preSendTick.ask - preSendTick.bid) / point : 0;
          if (Number.isFinite(spreadPoints) && spreadPoints > getSpreadGuardPointsForSymbol(symbol, evaluation.autoConfig)) {
            skipped.push(`${symbol}: skipped - spread guard ${spreadPoints.toFixed(1)} pts`);
            continue;
          }
          const entryRef = Number(evaluation.orderPlan.entryForRisk);
          const slippagePoints = point > 0 && Number.isFinite(entryRef) ? Math.abs(preSendTick.mid - entryRef) / point : 0;
          if (Number.isFinite(slippagePoints) && slippagePoints > getSlippageGuardPointsForSymbol(symbol)) {
            skipped.push(`${symbol}: skipped - slippage guard ${slippagePoints.toFixed(1)} pts`);
            continue;
          }
        }

        const payload = {
          action: evaluation.orderPlan.action,
          symbol: evaluation.resolvedSymbol,
          lots: evaluation.lots,
          sl: evaluation.orderPlan.sl,
          tp: evaluation.orderPlan.tp,
          symbolCooldownSec: evaluation.autoConfig.enforceSymbolCooldown ? Number(evaluation.autoConfig.cooldownMin) * 60 : 0,
          enforceSymbolCooldown: evaluation.autoConfig.enforceSymbolCooldown,
          enforceDailyLossLimit: evaluation.autoConfig.enforceDailyLossLimit,
          comment: `${evaluation.autoConfig.commentTag}-${evaluation.autoTimeframe || panelTimeframe}`,
        };
        if (evaluation.orderPlan.action === "PLACE") {
          payload.side = evaluation.orderPlan.side;
        } else {
          payload.orderType = evaluation.orderPlan.orderType;
          payload.price = evaluation.orderPlan.price;
        }

        pushAudit(
          symbol,
          "PREPARE_SENT",
          `${evaluation.orderPlan.label} lots=${evaluation.lots} sl=${formatNumericPrice(symbol, evaluation.orderPlan.sl)} tp=${formatNumericPrice(symbol, evaluation.orderPlan.tp)}${evaluation.orderPlan.rrAtTp ? ` rr=${Number(evaluation.orderPlan.rrAtTp).toFixed(2)}` : ""}${evaluation.orderPlan.tpSource ? ` tpSource=${String(evaluation.orderPlan.tpSource).toLowerCase()}` : ""}`
        );

        const result = await executeValidatedRequest(payload, {
          symbol,
          successStage: "EXECUTION_OK",
          successMessage: `${evaluation.orderPlan.label} lots=${evaluation.lots}${evaluation.orderPlan.rrAtTp ? ` rr=${Number(evaluation.orderPlan.rrAtTp).toFixed(2)}` : ""}${evaluation.orderPlan.tpSource ? ` tpSource=${String(evaluation.orderPlan.tpSource).toLowerCase()}` : ""}`,
          failureStage: "EXECUTION_FAIL",
        });

        if (!result.ok) {
          skipped.push(`${symbol}: execution failed - ${result.error}`);
          continue;
        }

        executed.push(`${evaluation.orderPlan.label} ${symbol} lots=${evaluation.lots}${result.ticket ? ` #${result.ticket}` : ""}`);
        executedLocks.add(lockKey);
        executedLocks.add(normalizeSymbol(evaluation.resolvedSymbol).replace(/M$/, ""));
        currentOpenCount += 1;
      }

      if (executed.length) {
        state.autoStatus = `Headless auto trade executed: ${executed.join(" | ")}`;
        pushLog("INFO", state.autoStatus);
      } else if (skipped.length) {
        state.autoStatus = `Headless auto trade scan: ${skipped.join(" | ")}`;
        pushLog("WARN", state.autoStatus);
      } else {
        state.autoStatus = "Headless auto trade scan: no qualifying signals";
        pushLog("INFO", state.autoStatus);
      }
      return { ok: true };
    } catch (error) {
      state.autoStatus = error instanceof Error ? `Headless auto trade error: ${error.message}` : "Headless auto trade error";
      pushLog("ERROR", state.autoStatus);
      return { ok: false, error: state.autoStatus };
    } finally {
      state.autoBusy = false;
      state.lastAutoCompletedAtMs = Date.now();
    }
  };

  const runProtectLoop = async () => {
    if (!hasAnyProtectEnabled() || state.protectBusy) {
      return { ok: true, skipped: true };
    }
    state.protectBusy = true;
    state.lastProtectRunAtMs = Date.now();
    try {
      await syncOvernightLossGuard();
      const openResult = await listOpenPositions();
      const positions = openResult.ok && Array.isArray(openResult.positions) ? openResult.positions : [];
      if (!positions.length) {
        state.overnightProfitRetraceState.clear();
        state.protectStatus = state.overnightLossGuard.active
          ? `Headless protect paused: ${state.overnightLossGuard.stopReason || "overnight loss-stop active"}`
          : "Headless protect: no open positions";
        return { ok: true };
      }

      const updates = [];
      const closures = [];
      const failures = [];
      const signalCache = new Map();
      const specCache = new Map();
      const openTickets = new Set(positions.map((position) => String(position.ticket)));
      for (const ticket of Array.from(state.overnightProfitRetraceState.keys())) {
        if (!openTickets.has(String(ticket))) {
          state.overnightProfitRetraceState.delete(ticket);
        }
      }

      for (const position of positions) {
        const side = String(position.type || "").toUpperCase();
        if (side !== "BUY" && side !== "SELL") continue;
        const protectConfig = getEffectiveProtectConfig(position.symbol);
        const autoConfig = getEffectiveAutoConfig(position.symbol);
        if (!protectConfig.enabled && !protectConfig.overnightEnabled) continue;
        const graceMs = Number(protectConfig.graceMin) * 60 * 1000;
        const overnightProfitUsd = Number(protectConfig.overnightProfitUsd);
        const overnightLossUsd = Number(protectConfig.overnightLossUsd);
        const breakEvenProfitUsd = Number(protectConfig.breakEvenProfitUsd);
        const overnightProfitRetraceLockEnabled = Boolean(protectConfig.overnightProfitRetraceLockEnabled);
        const overnightProfitRetraceArmUsd = Math.max(
          0.01,
          Number(protectConfig.overnightProfitRetraceArmUsd) || 0.8
        );
        const overnightProfitRetraceCloseUsd = Math.max(
          0.01,
          Number(protectConfig.overnightProfitRetraceCloseUsd) || 0.4
        );
        const tick = await fetchTick(position.symbol);

        let floatingPnl = Number.NaN;
        if (tick) {
          let spec = specCache.get(position.symbol);
          if (spec === undefined) {
            const specResult = await readMt4SymbolSpecs({ symbol: position.symbol });
            if (specResult.ok && specResult.spec) {
              spec = specResult.spec;
            } else {
              spec = null;
            }
            specCache.set(position.symbol, spec);
          }
          const entry = Number(position.openPrice);
          const lots = Number(position.lots);
          const tickValue = Number(spec?.tickValue || 0);
          const tickSize = Number(spec?.tickSize || 0);
          const point = Number(spec?.point || 0);
          const lotSize = Number(spec?.lotSize || 0);
          let moneyPerPricePerLot = 0;
          if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(tickSize) && tickSize > 0) {
            moneyPerPricePerLot = tickValue / tickSize;
          } else if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(point) && point > 0) {
            moneyPerPricePerLot = tickValue / point;
          } else if (Number.isFinite(lotSize) && lotSize > 0) {
            moneyPerPricePerLot = lotSize;
          }
          if (Number.isFinite(entry) && entry > 0 && Number.isFinite(lots) && lots > 0 && moneyPerPricePerLot > 0) {
            const closePrice = side === "BUY" ? tick.bid : tick.ask;
            floatingPnl =
              side === "BUY"
                ? (closePrice - entry) * moneyPerPricePerLot * lots
                : (entry - closePrice) * moneyPerPricePerLot * lots;
            if (protectConfig.overnightEnabled && Number.isFinite(floatingPnl)) {
              const retraceState = state.overnightProfitRetraceState.get(position.ticket) || {
                armed: false,
                peakProfitUsd: Number.NEGATIVE_INFINITY,
              };
              retraceState.peakProfitUsd = Math.max(retraceState.peakProfitUsd, floatingPnl);
              if (!retraceState.armed && retraceState.peakProfitUsd >= overnightProfitRetraceArmUsd) {
                retraceState.armed = true;
              }
              state.overnightProfitRetraceState.set(position.ticket, retraceState);
            }
            if (
              protectConfig.overnightEnabled &&
              Number.isFinite(floatingPnl) &&
              overnightLossUsd > 0 &&
              floatingPnl <= -Math.abs(overnightLossUsd)
            ) {
              const closeResult = await executeValidatedRequest(
                {
                  action: "CLOSE",
                  ticket: position.ticket,
                  lots: position.lots,
                },
                {
                  symbol: position.symbol,
                  successStage: "EXECUTION_OK",
                  successMessage: `${position.symbol} #${position.ticket} closed by overnight loss cap`,
                  failureStage: "EXECUTION_FAIL",
                }
              );
              if (closeResult.ok) {
                closures.push(
                  `${position.symbol} #${position.ticket} closed by overnight loss cap (-$${Math.abs(floatingPnl).toFixed(2)} >= $${Math.abs(overnightLossUsd).toFixed(2)})`
                );
                continue;
              }
              failures.push(`${position.symbol}: ${closeResult.error || "overnight loss close failed"}`);
            }
            if (
              protectConfig.overnightEnabled &&
              Number.isFinite(floatingPnl) &&
              floatingPnl >= overnightProfitUsd
            ) {
              const closeResult = await executeValidatedRequest(
                {
                  action: "CLOSE",
                  ticket: position.ticket,
                  lots: position.lots,
                },
                {
                  symbol: position.symbol,
                  successStage: "EXECUTION_OK",
                  successMessage: `${position.symbol} #${position.ticket} closed by overnight target`,
                  failureStage: "EXECUTION_FAIL",
                }
              );
              if (closeResult.ok) {
                closures.push(
                  `${position.symbol} #${position.ticket} closed by overnight target (+$${floatingPnl.toFixed(2)} >= $${overnightProfitUsd.toFixed(2)})`
                );
                continue;
              }
              failures.push(`${position.symbol}: ${closeResult.error || "overnight close failed"}`);
            }
            const retraceState = state.overnightProfitRetraceState.get(position.ticket);
            if (
              protectConfig.overnightEnabled &&
              overnightProfitRetraceLockEnabled &&
              retraceState?.armed &&
              Number.isFinite(floatingPnl) &&
              floatingPnl > 0 &&
              floatingPnl <= overnightProfitRetraceCloseUsd
            ) {
              const closeResult = await executeValidatedRequest(
                {
                  action: "CLOSE",
                  ticket: position.ticket,
                  lots: position.lots,
                },
                {
                  symbol: position.symbol,
                  successStage: "EXECUTION_OK",
                  successMessage: `${position.symbol} #${position.ticket} closed by overnight retrace lock`,
                  failureStage: "EXECUTION_FAIL",
                }
              );
              if (closeResult.ok) {
                closures.push(
                  `${position.symbol} #${position.ticket} closed by overnight retrace lock (armed at +$${overnightProfitRetraceArmUsd.toFixed(2)}, retraced to +$${floatingPnl.toFixed(2)})`
                );
                state.overnightProfitRetraceState.delete(position.ticket);
                continue;
              }
              failures.push(`${position.symbol}: ${closeResult.error || "overnight retrace close failed"}`);
            }
          }
        }

        const missingProtectionPlan = await buildMissingProtectionPlan(position, side, tick, autoConfig);
        if (missingProtectionPlan) {
          const missingLabel =
            !(Number(position.sl) > 0) && !(Number(position.tp) > 0)
              ? "SL/TP"
              : !(Number(position.sl) > 0)
              ? "SL"
              : "TP";
          const modifyResult = await executeValidatedRequest(
            {
              action: "MODIFY",
              ticket: position.ticket,
              sl: missingProtectionPlan.sl,
              tp: missingProtectionPlan.tp,
            },
            {
              symbol: position.symbol,
              successStage: "EXECUTION_OK",
              successMessage:
                `${position.symbol} #${position.ticket} auto-filled ${missingLabel} via ${missingProtectionPlan.symbol} ${missingProtectionPlan.timeframe} ` +
                `(${String(missingProtectionPlan.tpSource).toLowerCase()} TP, R:R ${Number(missingProtectionPlan.rr).toFixed(2)})`,
              failureStage: "EXECUTION_FAIL",
            }
          );
          if (modifyResult.ok) {
            updates.push(
              `${position.symbol} #${position.ticket} auto-filled ${missingLabel} via ${missingProtectionPlan.symbol} ${missingProtectionPlan.timeframe} ` +
                `(${String(missingProtectionPlan.tpSource).toLowerCase()} TP, R:R ${Number(missingProtectionPlan.rr).toFixed(2)})`
            );
            continue;
          }
          failures.push(`${position.symbol}: ${modifyResult.error || "missing SL/TP autofill failed"}`);
        }

        if (protectConfig.enabled && protectConfig.breakEvenEnabled && Number.isFinite(tick?.mid)) {
          const current = Number(tick.mid);
          const pointSize = getPointSizeForSymbol(position.symbol, current);
          const minDistance = Number(protectConfig.minStopPoints) * pointSize;
          const entry = Number(position.openPrice);
          const currentSl = Number(position.sl);
          const originalRiskDistance = side === "BUY" ? entry - currentSl : currentSl - entry;
          const favorableDistance = side === "BUY" ? current - entry : entry - current;
          const beReadyByR =
            Number.isFinite(originalRiskDistance) &&
            originalRiskDistance > 0 &&
            Number.isFinite(favorableDistance) &&
            favorableDistance >= originalRiskDistance * Number(protectConfig.breakEvenR);
          const beReadyByUsd =
            protectConfig.overnightEnabled &&
            Number.isFinite(floatingPnl) &&
            breakEvenProfitUsd > 0 &&
            floatingPnl >= breakEvenProfitUsd;
          const beReady = beReadyByR || beReadyByUsd;
          const beSl = entry;
          if (beReady) {
            let beAllowed = false;
            if (side === "BUY") {
              const brokerGuardOk = minDistance <= 0 || current - beSl >= minDistance;
              const quoteGuardOk = !tick || beSl < tick.bid;
              const moveForward = !position.sl || beSl > position.sl;
              beAllowed = brokerGuardOk && quoteGuardOk && moveForward;
            } else {
              const brokerGuardOk = minDistance <= 0 || beSl - current >= minDistance;
              const quoteGuardOk = !tick || beSl > tick.ask;
              const moveForward = !position.sl || beSl < position.sl;
              beAllowed = brokerGuardOk && quoteGuardOk && moveForward;
            }
            if (beAllowed) {
              const modifyResult = await executeValidatedRequest(
                {
                  action: "MODIFY",
                  ticket: position.ticket,
                  sl: beSl,
                  ...(Number(position.tp) > 0 ? { tp: Number(position.tp) } : {}),
                },
                {
                  symbol: position.symbol,
                  successStage: "EXECUTION_OK",
                  successMessage: `${position.symbol} SL -> BE @ ${formatNumericPrice(position.symbol, beSl)}`,
                  failureStage: "EXECUTION_FAIL",
                }
              );
              if (modifyResult.ok) {
                updates.push(`${position.symbol} SL -> BE @ ${formatNumericPrice(position.symbol, beSl)}`);
                continue;
              }
              failures.push(`${position.symbol}: ${modifyResult.error || "break-even modify failed"}`);
            }
          }
        }

        if (position.openTime && Date.now() - Number(position.openTime) * 1000 < graceMs) continue;
        if (!protectConfig.enabled) continue;

        const candles = await fetchCandles(
          position.symbol,
          protectConfig.timeframe,
          Math.max(Number(protectConfig.lookback) + Number(protectConfig.atrPeriod) + 5, 60)
        );
        if (candles.length < Number(protectConfig.lookback) + 5) continue;

        const atr = computeAtr(candles, Number(protectConfig.atrPeriod));
        if (!Number.isFinite(atr) || atr <= 0) continue;

        const closes = candles.map((candle) => candle.close);
        const recentCloses = closes.slice(-Number(protectConfig.lookback));
        const highestClose = Math.max(...recentCloses);
        const lowestClose = Math.min(...recentCloses);
        const current = tick?.mid ?? closes[closes.length - 1];
        if (!Number.isFinite(current)) continue;
        const pointSize = getPointSizeForSymbol(position.symbol, current);
        const minDistance = Number(protectConfig.minStopPoints) * pointSize;

        if (protectConfig.degradeCloseEnabled) {
          const signalKey = `${position.symbol}|${protectConfig.timeframe}`;
          let protectSignal = signalCache.get(signalKey);
          if (protectSignal === undefined) {
            const protectData = await generatePriceData(position.symbol, protectConfig.timeframe);
            protectSignal = protectData ? generateTradeSignal(protectData, autoConfig) : null;
            signalCache.set(signalKey, protectSignal);
          }
          const isOpposite =
            protectSignal &&
            (protectSignal.signal === "BUY" || protectSignal.signal === "SELL") &&
            ((side === "BUY" && protectSignal.signal === "SELL") ||
              (side === "SELL" && protectSignal.signal === "BUY"));
          if (isOpposite && (protectSignal?.confidence || 0) >= Number(protectConfig.degradeMinConfidence)) {
            const tp = Number(position.tp);
            const entry = Number(position.openPrice);
            const tpDistance =
              side === "BUY" ? tp - entry : entry - tp;
            const favorableDistance =
              side === "BUY" ? current - entry : entry - current;
            const tpProgressPct =
              Number.isFinite(tpDistance) && tpDistance > 0 && Number.isFinite(favorableDistance)
                ? (favorableDistance / tpDistance) * 100
                : Number.NaN;
            const biasFlipProfitLockEnabled = Boolean(protectConfig.biasFlipProfitLockEnabled);
            const biasFlipTpProgressPct = Math.max(1, Number(protectConfig.biasFlipTpProgressPct) || 35);
            const eligibleForProfitLock =
              biasFlipProfitLockEnabled &&
              Number.isFinite(floatingPnl) &&
              floatingPnl > 0 &&
              Number.isFinite(tpProgressPct) &&
              tpProgressPct >= biasFlipTpProgressPct;

            if (eligibleForProfitLock || !biasFlipProfitLockEnabled) {
              const closeResult = await executeValidatedRequest(
                {
                  action: "CLOSE",
                  ticket: position.ticket,
                  lots: position.lots,
                },
                {
                  symbol: position.symbol,
                  successStage: "EXECUTION_OK",
                  successMessage: `${position.symbol} #${position.ticket} closed by ${eligibleForProfitLock ? "bias-flip profit lock" : "degrade-close"}`,
                  failureStage: "EXECUTION_FAIL",
                }
              );
              if (closeResult.ok) {
                closures.push(
                  eligibleForProfitLock
                    ? `${position.symbol} #${position.ticket} closed by bias-flip profit lock (${tpProgressPct.toFixed(0)}% TP progress, opposite ${protectSignal.signal} ${protectSignal.confidence.toFixed(0)}%)`
                    : `${position.symbol} #${position.ticket} closed (opposite ${protectSignal.signal} ${protectSignal.confidence.toFixed(0)}%)`
                );
                continue;
              }
              failures.push(`${position.symbol}: ${closeResult.error || "close failed"}`);
            }
          }
        }

        let nextSl = null;
        if (side === "BUY") {
          const trail = highestClose - Number(protectConfig.atrMult) * atr;
          if (trail <= Number(position.openPrice)) continue;
          if (tick && trail >= tick.bid) continue;
          if (position.sl && trail <= Number(position.sl)) continue;
          if (minDistance > 0 && current - trail < minDistance) continue;
          nextSl = trail;
        } else {
          const trail = lowestClose + Number(protectConfig.atrMult) * atr;
          if (trail >= Number(position.openPrice)) continue;
          if (tick && trail <= tick.ask) continue;
          if (position.sl && trail >= Number(position.sl)) continue;
          if (minDistance > 0 && trail - current < minDistance) continue;
          nextSl = trail;
        }
        if (!nextSl || !Number.isFinite(nextSl)) continue;

        const trailResult = await executeValidatedRequest(
          {
            action: "MODIFY",
            ticket: position.ticket,
            sl: nextSl,
            ...(Number(position.tp) > 0 ? { tp: Number(position.tp) } : {}),
          },
          {
            symbol: position.symbol,
            successStage: "EXECUTION_OK",
            successMessage: `${position.symbol} SL -> ${formatNumericPrice(position.symbol, nextSl)}`,
            failureStage: "EXECUTION_FAIL",
          }
        );
        if (!trailResult.ok) {
          failures.push(`${position.symbol}: ${trailResult.error || "trailing modify failed"}`);
          continue;
        }
        updates.push(`${position.symbol} SL -> ${formatNumericPrice(position.symbol, nextSl)}`);
      }

      if (updates.length || closures.length) {
        const parts = [
          updates.length ? `updates ${updates.join(" | ")}` : "",
          closures.length ? `closures ${closures.join(" | ")}` : "",
        ].filter(Boolean);
        state.protectStatus = `Headless protect applied: ${parts.join(" ; ")}`;
        pushLog("INFO", state.protectStatus);
      } else if (failures.length) {
        state.protectStatus = `Headless protect warnings: ${failures.join(" | ")}`;
        pushLog("WARN", state.protectStatus);
      } else {
        state.protectStatus = state.overnightLossGuard.active
          ? `Headless protect paused: ${state.overnightLossGuard.stopReason || "overnight loss-stop active"}`
          : hasAnyProtectEnabled()
          ? "Headless protect: no close or trailing actions"
          : "Headless protect idle";
      }
      return { ok: true };
    } catch (error) {
      state.protectStatus = error instanceof Error ? `Headless protect error: ${error.message}` : "Headless protect error";
      pushLog("ERROR", state.protectStatus);
      return { ok: false, error: state.protectStatus };
    } finally {
      state.protectBusy = false;
      state.lastProtectCompletedAtMs = Date.now();
    }
  };

  const clearTimers = () => {
    if (state.autoTimer) clearInterval(state.autoTimer);
    if (state.protectTimer) clearInterval(state.protectTimer);
    state.autoTimer = null;
    state.protectTimer = null;
  };

  const refreshTimers = async () => {
    clearTimers();
    if (hasAnyAutoEnabled()) {
      const intervalMs =
        state.config.auto.timeframeOverride !== "PANEL"
          ? getWatchIntervalMs(state.config.auto.timeframeOverride)
          : Math.min(...state.config.watchlist.map((item) => getWatchIntervalMs(item.timeframe)));
      state.autoTimer = setInterval(() => {
        void runAutoScan();
      }, intervalMs);
      void runAutoScan();
    }
    if (hasAnyProtectEnabled()) {
      state.protectTimer = setInterval(() => {
        void runProtectLoop();
      }, 5000);
      void runProtectLoop();
    }
  };

  const getStatus = () => ({
    config: state.config,
    status: {
      autoEnabled: hasAnyAutoEnabled(),
      protectEnabled: hasAnyProtectEnabled(),
      protectTrailingEnabled: state.config.protect.enabled,
      protectOvernightEnabled: state.config.protect.overnightEnabled,
      overnightLossStopActive: state.overnightLossGuard.active,
      overnightConsecutiveLosses: state.overnightLossGuard.consecutiveLosses,
      overnightMaxConsecutiveLosses: OVERNIGHT_MAX_CONSECUTIVE_LOSSES,
      overnightLossStopReason: state.overnightLossGuard.stopReason,
      overnightLossStopAtMs: state.overnightLossGuard.stoppedAtMs,
      autoBusy: state.autoBusy,
      protectBusy: state.protectBusy,
      commandBusy: state.commandBusy,
      autoRunning: Boolean(state.autoTimer),
      protectRunning: Boolean(state.protectTimer),
      autoStatus: state.autoStatus,
      protectStatus: state.protectStatus,
      lastAutoRunAtMs: state.lastAutoRunAtMs,
      lastAutoCompletedAtMs: state.lastAutoCompletedAtMs,
      lastProtectRunAtMs: state.lastProtectRunAtMs,
      lastProtectCompletedAtMs: state.lastProtectCompletedAtMs,
      logs: state.logs,
      auditLogs: state.auditLogs,
    },
  });

  const updateConfig = async (payload) => {
    const previousConfig = state.config;
    const previousAutoEnabled = hasAnyAutoEnabled(previousConfig);
    const previousOvernightEnabled = hasAnyProtectEnabled(previousConfig);
    const previousPrefixes = JSON.stringify(
      collectManagedTradeCommentPrefixes({ overnightOnly: true, config: previousConfig }).sort()
    );
    state.config = sanitizeConfig(
      {
        ...state.config,
        ...payload,
        auto: { ...state.config.auto, ...(payload?.auto || {}) },
        protect: { ...state.config.protect, ...(payload?.protect || {}) },
      },
      runtimeDefaults
    );
    const nextPrefixes = JSON.stringify(
      collectManagedTradeCommentPrefixes({ overnightOnly: true, config: state.config }).sort()
    );
    const reenabledAfterStop =
      state.overnightLossGuard.active &&
      ((!previousAutoEnabled && hasAnyAutoEnabled()) ||
        (!previousOvernightEnabled && hasAnyProtectEnabled()) ||
        previousPrefixes !== nextPrefixes);
    if (reenabledAfterStop) {
      await resetOvernightLossGuard({ markCurrentHistoryProcessed: true, resetLosses: true });
      pushLog("INFO", "Overnight loss-stop reset after manual re-enable");
    } else if (previousPrefixes !== nextPrefixes) {
      await resetOvernightLossGuard({ markCurrentHistoryProcessed: true, resetLosses: true });
      await syncOvernightLossGuard();
    }
    await persistConfig();
    await refreshTimers();
    pushLog("INFO", "Headless config updated");
    return getStatus();
  };

  await loadConfig();
  await syncOvernightLossGuard();
  await refreshTimers();

  return {
    getStatus,
    updateConfig,
    runAutoScan,
    runProtectLoop,
  };
};
