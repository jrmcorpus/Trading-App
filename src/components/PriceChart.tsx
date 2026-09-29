import React, { useEffect, useMemo, useRef, useState } from "react";
import { ColorType, LineStyle, UTCTimestamp, createChart } from "lightweight-charts";

interface PriceCandle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Mt4Tick {
  symbol: string;
  bid: number;
  ask: number;
  time: number;
}

type ChartTimeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1" | "MN";

interface PriceChartProps {
  symbol: string;
  isCrypto: boolean;
  height?: number;
  timeframe?: ChartTimeframe;
}

interface TimeframeConfig {
  bucketMs: number;
  candles: number;
  lookbackMs: number;
}

interface ChartStats {
  candle: PriceCandle;
  previousClose: number | null;
  ma7: number | null;
  ma25: number | null;
  ma99: number | null;
  ema50: number | null;
  support: number | null;
  resistance: number | null;
}

type ChartDataSource =
  | "BINANCE"
  | "COINGECKO"
  | "MT4"
  | "TWELVE_DATA"
  | "ALPHA_VANTAGE"
  | "YAHOO_FINANCE"
  | "SIMULATED";

type ExternalFallbackSource = Extract<ChartDataSource, "TWELVE_DATA" | "ALPHA_VANTAGE" | "YAHOO_FINANCE">;

interface ExternalFallbackResult {
  source: ExternalFallbackSource | null;
  candles: PriceCandle[];
}

const TIMEFRAME_CONFIG: Record<ChartTimeframe, TimeframeConfig> = {
  M1: { bucketMs: 60 * 1000, candles: 180, lookbackMs: 180 * 60 * 1000 },
  M5: { bucketMs: 5 * 60 * 1000, candles: 180, lookbackMs: 15 * 60 * 60 * 1000 },
  M15: { bucketMs: 15 * 60 * 1000, candles: 180, lookbackMs: 3 * 24 * 60 * 60 * 1000 },
  M30: { bucketMs: 30 * 60 * 1000, candles: 180, lookbackMs: 6 * 24 * 60 * 60 * 1000 },
  H1: { bucketMs: 60 * 60 * 1000, candles: 220, lookbackMs: 20 * 24 * 60 * 60 * 1000 },
  H4: { bucketMs: 4 * 60 * 60 * 1000, candles: 240, lookbackMs: 120 * 24 * 60 * 60 * 1000 },
  D1: { bucketMs: 24 * 60 * 60 * 1000, candles: 260, lookbackMs: 2 * 365 * 24 * 60 * 60 * 1000 },
  W1: { bucketMs: 7 * 24 * 60 * 60 * 1000, candles: 260, lookbackMs: 8 * 365 * 24 * 60 * 60 * 1000 },
  MN: { bucketMs: 30 * 24 * 60 * 60 * 1000, candles: 180, lookbackMs: 15 * 365 * 24 * 60 * 60 * 1000 },
};

const COINGECKO_IDS: Record<string, string> = {
  BTCUSD: "bitcoin",
  ETHUSD: "ethereum",
  XRPUSD: "ripple",
  LTCUSD: "litecoin",
  BNBUSD: "binancecoin",
  ADAUSD: "cardano",
  DOGEUSD: "dogecoin",
  SOLUSD: "solana",
};

const BINANCE_SYMBOLS: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  XRPUSD: "XRPUSDT",
  LTCUSD: "LTCUSDT",
  BNBUSD: "BNBUSDT",
  ADAUSD: "ADAUSDT",
  DOGEUSD: "DOGEUSDT",
  SOLUSD: "SOLUSDT",
};

const BINANCE_INTERVALS: Record<ChartTimeframe, string> = {
  M1: "1m",
  M5: "5m",
  M15: "15m",
  M30: "30m",
  H1: "1h",
  H4: "4h",
  D1: "1d",
  W1: "1w",
  MN: "1M",
};

const ALPHA_INTRADAY_INTERVALS: Partial<Record<ChartTimeframe, string>> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "60min",
};

const TWELVE_DATA_INTERVALS: Record<ChartTimeframe, string> = {
  M1: "1min",
  M5: "5min",
  M15: "15min",
  M30: "30min",
  H1: "1h",
  H4: "4h",
  D1: "1day",
  W1: "1week",
  MN: "1month",
};

const FOREX_BASE_PRICES: Record<string, number> = {
  EURUSD: 1.08,
  GBPUSD: 1.27,
  USDJPY: 151.0,
  AUDUSD: 0.66,
  NZDUSD: 0.61,
  USDCAD: 1.35,
  Gold: 2030,
  "Crude Oil": 74,
};

const toSeriesTime = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

const calculateMA = (candles: PriceCandle[], period: number): Array<{ time: UTCTimestamp; value: number }> => {
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  let rollingSum = 0;

  for (let i = 0; i < candles.length; i += 1) {
    rollingSum += candles[i].close;

    if (i >= period) {
      rollingSum -= candles[i - period].close;
    }

    if (i >= period - 1) {
      result.push({
        time: candles[i].time,
        value: rollingSum / period,
      });
    }
  }

  return result;
};

const calculateEMA = (candles: PriceCandle[], period: number): Array<{ time: UTCTimestamp; value: number }> => {
  if (!candles.length || period <= 0) return [];
  const multiplier = 2 / (period + 1);
  const result: Array<{ time: UTCTimestamp; value: number }> = [];
  let emaValue = candles[0].close;

  for (let i = 0; i < candles.length; i += 1) {
    const close = candles[i].close;
    emaValue = i === 0 ? close : close * multiplier + emaValue * (1 - multiplier);
    result.push({
      time: candles[i].time,
      value: emaValue,
    });
  }

  return result;
};

const calculateSupportResistance = (
  candles: PriceCandle[],
  lookback = 50
): { support: number | null; resistance: number | null } => {
  if (!candles.length) {
    return { support: null, resistance: null };
  }

  const recent = candles.slice(-lookback);
  if (!recent.length) {
    return { support: null, resistance: null };
  }

  return {
    support: Math.min(...recent.map((candle) => candle.low)),
    resistance: Math.max(...recent.map((candle) => candle.high)),
  };
};

const inferDecimals = (value: number): number => {
  if (value >= 1000) return 2;
  if (value >= 100) return 2;
  if (value >= 10) return 3;
  if (value >= 1) return 5;
  return 6;
};

const getPricePrecision = (symbol: string, isCrypto: boolean): number => {
  if (isCrypto) return 2;
  const normalized = String(symbol || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.includes("XAU") || normalized.includes("GOLD")) return 2;
  if (normalized.includes("WTI") || normalized.includes("XTI") || normalized.includes("OIL")) return 2;
  if (normalized.length >= 6 && normalized.slice(3, 6) === "JPY") return 3;
  if (normalized.length >= 6) return 5;
  return inferDecimals(1);
};

const formatDisplayPair = (symbol: string): string => {
  const raw = String(symbol || "").toUpperCase();
  const normalized = raw.replace(/[^A-Z0-9]/g, "");
  if (normalized === "XAUUSD" || normalized === "GOLD" || normalized === "GOLDM") return "GOLD";
  if (normalized === "XAGUSD" || normalized === "SILVER" || normalized === "SILVERM") return "SILVER";
  if (normalized.endsWith("USDT")) return `${normalized.replace("USDT", "")}/USDT`;
  if (/^[A-Z]{6}$/.test(normalized)) return `${normalized.slice(0, 3)}/${normalized.slice(3, 6)}`;
  return symbol;
};

const normalizeMt4Token = (value: string): string => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const stripLegacyBrokerSuffix = (value: string): string =>
  String(value || "")
    .trim()
    .replace(/micro(?=#|$)/gi, "")
    .replace(/m(?=#|$)/gi, "");

const normalizeBrokerSuffix = (value: string): string => {
  const suffix = String(value || "").trim();
  if (/^(?:micro|m)#?$/i.test(suffix)) return suffix.endsWith("#") ? "#" : "";
  return suffix;
};

const parseEnvBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const parseAlphaTimeToSec = (value: string): UTCTimestamp => {
  const raw = String(value).trim();
  if (!raw) return 0 as UTCTimestamp;

  // Accept both "YYYY-MM-DD" and "YYYY-MM-DD HH:mm:ss" without relying on local timezone parsing.
  const normalized =
    /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00Z` : raw.replace(" ", "T");
  const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? normalized : `${normalized}Z`;
  const ms = Date.parse(withZone);

  return (Number.isFinite(ms) ? Math.floor(ms / 1000) : 0) as UTCTimestamp;
};

const aggregateCandlesByBucket = (
  candles: PriceCandle[],
  bucketMs: number,
  maxCandles: number
): PriceCandle[] => {
  if (!candles.length) return [];
  const buckets = new Map<number, PriceCandle>();

  for (const candle of candles) {
    const ms = candle.time * 1000;
    const bucket = Math.floor(ms / bucketMs) * bucketMs;
    const key = Math.floor(bucket / 1000) as UTCTimestamp;
    const existing = buckets.get(key);

    if (!existing) {
      buckets.set(key, { ...candle, time: key });
      continue;
    }

    existing.high = Math.max(existing.high, candle.high);
    existing.low = Math.min(existing.low, candle.low);
    existing.close = candle.close;
    existing.volume += candle.volume;
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.time - b.time)
    .slice(-maxCandles);
};

const aggregateToCandles = (
  prices: Array<[number, number]>,
  volumes: Array<[number, number]>,
  config: TimeframeConfig
): PriceCandle[] => {
  const buckets = new Map<number, PriceCandle>();
  const now = Date.now();
  const minTime = now - config.lookbackMs;

  for (const [timestamp, price] of prices) {
    if (timestamp < minTime) continue;
    const bucket = Math.floor(timestamp / config.bucketMs) * config.bucketMs;
    const existing = buckets.get(bucket);

    if (!existing) {
      buckets.set(bucket, {
        time: toSeriesTime(bucket),
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
      });
      continue;
    }

    existing.high = Math.max(existing.high, price);
    existing.low = Math.min(existing.low, price);
    existing.close = price;
  }

  for (const [timestamp, volume] of volumes) {
    if (timestamp < minTime) continue;
    const bucket = Math.floor(timestamp / config.bucketMs) * config.bucketMs;
    const existing = buckets.get(bucket);
    if (existing) {
      existing.volume += Number.isFinite(volume) ? volume : 0;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => a.time - b.time)
    .slice(-config.candles);
};

const generateSyntheticCandles = (symbol: string, config: TimeframeConfig): PriceCandle[] => {
  const candles: PriceCandle[] = [];
  const base = FOREX_BASE_PRICES[symbol] ?? 1.2;
  const now = Date.now();
  const start = now - config.bucketMs * config.candles;
  const baseVolatility = base * (base > 50 ? 0.003 : 0.0015);

  let previousClose = base;

  for (let i = 0; i < config.candles; i += 1) {
    const timestamp = start + i * config.bucketMs;
    const trend = Math.sin(i / 24) * baseVolatility * 0.35;
    const shock = (Math.random() - 0.5) * baseVolatility;
    const open = previousClose;
    const close = Math.max(0.0001, open + trend + shock);
    const wick = Math.abs(close - open) * 0.6 + Math.random() * baseVolatility * 0.7;
    const high = Math.max(open, close) + wick;
    const low = Math.max(0.0001, Math.min(open, close) - wick);
    const volume = Math.abs(close - open) * (base > 50 ? 25000 : 2500000) + Math.random() * 50000;

    candles.push({
      time: toSeriesTime(timestamp),
      open,
      high,
      low,
      close,
      volume,
    });

    previousClose = close;
  }

  return candles;
};

const fetchAlphaVantageFxCandles = async (
  symbol: string,
  timeframe: ChartTimeframe,
  config: TimeframeConfig
): Promise<PriceCandle[]> => {
  const apiKey = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
  if (!apiKey || apiKey === "your-alpha-vantage-key") return [];

  const mappedSymbol = symbol === "Gold" ? "XAUUSD" : symbol;
  if (!/^[A-Z]{6}$/.test(mappedSymbol)) return [];

  const fromSymbol = mappedSymbol.slice(0, 3);
  const toSymbol = mappedSymbol.slice(3, 6);
  const intradayInterval = ALPHA_INTRADAY_INTERVALS[timeframe];

  if (intradayInterval) {
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&interval=${intradayInterval}&outputsize=full&apikey=${apiKey}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return [];

    const data = await response.json();
    const seriesKey = Object.keys(data).find((key) => key.startsWith("Time Series FX"));
    if (!seriesKey || !data[seriesKey]) return [];

    const candles = Object.entries(data[seriesKey])
      .map(([time, values]: [string, any]) => ({
        time: parseAlphaTimeToSec(time),
        open: Number(values["1. open"]),
        high: Number(values["2. high"]),
        low: Number(values["3. low"]),
        close: Number(values["4. close"]),
        volume: 0,
      }))
      .filter(
        (candle: PriceCandle) =>
          candle.time > 0 &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close)
      )
      .sort((a: PriceCandle, b: PriceCandle) => a.time - b.time);

    if (timeframe === "H1") return candles.slice(-config.candles);
    return candles.slice(-config.candles);
  }

  if (timeframe === "H4") {
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&interval=60min&outputsize=full&apikey=${apiKey}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) return [];

    const data = await response.json();
    const seriesKey = Object.keys(data).find((key) => key.startsWith("Time Series FX"));
    if (!seriesKey || !data[seriesKey]) return [];

    const candles = Object.entries(data[seriesKey])
      .map(([time, values]: [string, any]) => ({
        time: parseAlphaTimeToSec(time),
        open: Number(values["1. open"]),
        high: Number(values["2. high"]),
        low: Number(values["3. low"]),
        close: Number(values["4. close"]),
        volume: 0,
      }))
      .filter(
        (candle: PriceCandle) =>
          candle.time > 0 &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close)
      )
      .sort((a: PriceCandle, b: PriceCandle) => a.time - b.time);

    return aggregateCandlesByBucket(candles, 4 * 60 * 60 * 1000, config.candles);
  }

  const dailyUrl = `https://www.alphavantage.co/query?function=FX_DAILY&from_symbol=${fromSymbol}&to_symbol=${toSymbol}&outputsize=full&apikey=${apiKey}`;
  const dailyResponse = await fetch(dailyUrl, { method: "GET" });
  if (!dailyResponse.ok) return [];
  const dailyData = await dailyResponse.json();
  const dailySeries = dailyData["Time Series FX (Daily)"];
  if (!dailySeries) return [];

  const dailyCandles = Object.entries(dailySeries)
    .map(([date, values]: [string, any]) => ({
      time: parseAlphaTimeToSec(`${date} 00:00:00`),
      open: Number(values["1. open"]),
      high: Number(values["2. high"]),
      low: Number(values["3. low"]),
      close: Number(values["4. close"]),
      volume: 0,
    }))
    .filter(
      (candle: PriceCandle) =>
        candle.time > 0 &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    )
    .sort((a: PriceCandle, b: PriceCandle) => a.time - b.time);

  if (timeframe === "D1") return dailyCandles.slice(-config.candles);
  if (timeframe === "W1") {
    return aggregateCandlesByBucket(dailyCandles, 7 * 24 * 60 * 60 * 1000, config.candles);
  }
  return aggregateCandlesByBucket(dailyCandles, 30 * 24 * 60 * 60 * 1000, config.candles);
};

const getTwelveDataSymbol = (symbol: string): string | null => {
  if (symbol === "Gold") return "XAU/USD";
  if (symbol === "Crude Oil") return "XTI/USD";
  if (/^[A-Z]{6}$/.test(symbol)) return `${symbol.slice(0, 3)}/${symbol.slice(3, 6)}`;
  return null;
};

const fetchTwelveDataCandles = async (
  symbol: string,
  timeframe: ChartTimeframe,
  config: TimeframeConfig
): Promise<PriceCandle[]> => {
  const apiKey = import.meta.env.VITE_TWELVE_DATA_API_KEY;
  if (!apiKey || apiKey === "your-twelve-data-key") return [];

  const tdSymbol = getTwelveDataSymbol(symbol);
  if (!tdSymbol) return [];

  const interval = TWELVE_DATA_INTERVALS[timeframe];
  const outputsize = Math.min(5000, Math.max(300, config.candles));
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${outputsize}&apikey=${apiKey}`;
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) return [];

  const data = await response.json();
  if (data?.status === "error" || !Array.isArray(data?.values)) return [];

  const candles = data.values
    .map((item: any) => ({
      time: parseAlphaTimeToSec(item.datetime),
      open: Number(item.open),
      high: Number(item.high),
      low: Number(item.low),
      close: Number(item.close),
      volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 0,
    }))
    .filter(
      (candle: PriceCandle) =>
        candle.time > (0 as UTCTimestamp) &&
        Number.isFinite(candle.open) &&
        Number.isFinite(candle.high) &&
        Number.isFinite(candle.low) &&
        Number.isFinite(candle.close)
    )
    .sort((a: PriceCandle, b: PriceCandle) => a.time - b.time)
    .slice(-config.candles);

  return candles;
};

const fetchMt4BridgeCandles = async (
  symbol: string,
  timeframe: ChartTimeframe,
  config: TimeframeConfig,
  isCryptoSymbol: boolean
): Promise<{ candles: PriceCandle[]; brokerSymbol: string | null; tick: Mt4Tick | null; error: string | null }> => {
  const baseUrl = import.meta.env.VITE_MT4_BRIDGE_URL || "/api/mt4";
  const mt4SymbolMapRaw = (import.meta.env.VITE_MT4_SYMBOL_MAP as string | undefined) || "";
  let mt4SymbolMap: Record<string, string> = {};
  if (mt4SymbolMapRaw) {
    try {
      const parsed = JSON.parse(mt4SymbolMapRaw);
      if (parsed && typeof parsed === "object") mt4SymbolMap = parsed as Record<string, string>;
    } catch {
      mt4SymbolMap = {};
    }
  }
  const preferredSuffix = normalizeBrokerSuffix((import.meta.env.VITE_MT4_SYMBOL_SUFFIX as string | undefined) || "");
  const configuredCryptoSuffix = (import.meta.env.VITE_MT4_CRYPTO_SUFFIX as string | undefined) || "";
  const preferredCryptoSuffix = normalizeBrokerSuffix(configuredCryptoSuffix || preferredSuffix) || "#";
  const normalized = normalizeMt4Token(symbol);
  const isMetal = normalized === "GOLD" || normalized === "XAUUSD" || normalized === "SILVER" || normalized === "XAGUSD";
  const baseTokens =
    normalized === "GOLD"
      ? ["GOLD", "XAUUSD"]
      : normalized === "SILVER"
      ? ["SILVER", "XAGUSD"]
      : [normalized || symbol];
  const isCryptoPair = isCryptoSymbol;
  const suffixPriority = isCryptoPair
    ? [preferredCryptoSuffix, "#", ""]
    : [preferredSuffix, "#", "", "m#", "m", ".", "pro"];
  const querySymbols: string[] = [];
  const pushUnique = (value: string) => {
    const v = String(value || "").trim();
    if (!v) return;
    if (!querySymbols.includes(v)) querySymbols.push(v);
  };
  const mapped = mt4SymbolMap[normalized];
  if (mapped) pushUnique(stripLegacyBrokerSuffix(mapped));
  for (const baseToken of baseTokens) {
    for (const suffix of suffixPriority) {
      pushUnique(`${baseToken}${suffix}`);
    }
  }
  if (isMetal) {
    pushUnique("GOLDm#");
    pushUnique("GOLD#");
    pushUnique("XAUUSDm#");
    pushUnique("XAUUSD#");
    pushUnique("SILVERm#");
    pushUnique("XAGUSDm#");
  }
  pushUnique(symbol);

  try {
    let lastError = "MT5 bridge request failed";

    for (const querySymbol of querySymbols) {
      const url = `${baseUrl}/market?symbol=${encodeURIComponent(querySymbol)}&timeframe=${timeframe}&count=${config.candles}`;
      const response = await fetch(url, { method: "GET" });
      if (!response.ok) {
        try {
          const errPayload = await response.json();
          if (typeof errPayload?.error === "string" && errPayload.error.trim()) {
            lastError = errPayload.error;
          }
        } catch {
          // keep lastError
        }
        continue;
      }

      const data = await response.json();
      if (!data?.ok || !Array.isArray(data?.candles)) {
          lastError = typeof data?.error === "string" ? data.error : "MT5 bridge returned no candles";
        continue;
      }

      const candles = data.candles
        .map((item: any) => ({
          time: Number(item.time) as UTCTimestamp,
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
          volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 0,
        }))
        .filter(
          (candle: PriceCandle) =>
            candle.time > (0 as UTCTimestamp) &&
            Number.isFinite(candle.open) &&
            Number.isFinite(candle.high) &&
            Number.isFinite(candle.low) &&
            Number.isFinite(candle.close)
        )
        .sort((a: PriceCandle, b: PriceCandle) => a.time - b.time)
        .slice(-config.candles);

      if (!candles.length) {
        lastError = "MT5 bridge returned no candles";
        continue;
      }

      return {
        candles,
        brokerSymbol: typeof data.symbol === "string" ? data.symbol : querySymbol,
        tick:
          data?.tick &&
          Number.isFinite(Number(data.tick.bid)) &&
          Number.isFinite(Number(data.tick.ask)) &&
          Number.isFinite(Number(data.tick.time))
            ? {
                symbol: String(data.tick.symbol || data.symbol || querySymbol),
                bid: Number(data.tick.bid),
                ask: Number(data.tick.ask),
                time: Number(data.tick.time),
              }
            : null,
        error: null,
      };
    }
    return { candles: [], brokerSymbol: null, tick: null, error: lastError };
  } catch {
    return { candles: [], brokerSymbol: null, tick: null, error: "MT5 bridge unavailable" };
  }
};

const externalFallbackCache = new Map<
  string,
  {
    cachedAtMs: number;
    ttlMs: number;
    result: ExternalFallbackResult;
  }
>();

const getExternalFallbackCacheTtlMs = (bucketMs: number): number =>
  Math.min(60_000, Math.max(15_000, Math.floor(bucketMs / 6)));

const fetchExternalFallbackCandles = async (
  symbol: string,
  timeframe: ChartTimeframe,
  config: TimeframeConfig,
  isCryptoSymbol: boolean
): Promise<ExternalFallbackResult> => {
  if (isCryptoSymbol) {
    return { source: null, candles: [] };
  }

  const baseUrl = import.meta.env.VITE_MT4_BRIDGE_URL || "/api/mt4";
  const cacheKey = `${symbol}|${timeframe}`;
  const nowMs = Date.now();
  const cached = externalFallbackCache.get(cacheKey);
  if (cached && nowMs - cached.cachedAtMs < cached.ttlMs) {
    return cached.result;
  }

  const persist = (result: ExternalFallbackResult): ExternalFallbackResult => {
    externalFallbackCache.set(cacheKey, {
      cachedAtMs: nowMs,
      ttlMs: getExternalFallbackCacheTtlMs(config.bucketMs),
      result,
    });
    return result;
  };

  try {
    const response = await fetch(
      `${baseUrl}/fallback-candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&count=${config.candles}`,
      { method: "GET" }
    );
    if (response.ok) {
      const data = await response.json();
      const source =
        data?.source === "TWELVE_DATA" || data?.source === "ALPHA_VANTAGE" || data?.source === "YAHOO_FINANCE"
          ? data.source
          : null;
      const candles = Array.isArray(data?.candles)
        ? data.candles
            .map((item: any) => ({
              time: Number(item.time) as UTCTimestamp,
              open: Number(item.open),
              high: Number(item.high),
              low: Number(item.low),
              close: Number(item.close),
              volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 0,
            }))
            .filter(
              (candle: PriceCandle) =>
                candle.time > (0 as UTCTimestamp) &&
                Number.isFinite(candle.open) &&
                Number.isFinite(candle.high) &&
                Number.isFinite(candle.low) &&
                Number.isFinite(candle.close)
            )
            .sort((a: PriceCandle, b: PriceCandle) => a.time - b.time)
            .slice(-config.candles)
        : [];
      if (source && candles.length >= 2) {
        return persist({ source, candles });
      }
    }
  } catch {
    // Fall through to direct browser fetchers.
  }

  const twelveDataCandles = await fetchTwelveDataCandles(symbol, timeframe, config);
  if (twelveDataCandles.length >= 2) {
    return persist({ source: "TWELVE_DATA", candles: twelveDataCandles });
  }

  const alphaVantageCandles = await fetchAlphaVantageFxCandles(symbol, timeframe, config);
  if (alphaVantageCandles.length >= 2) {
    return persist({ source: "ALPHA_VANTAGE", candles: alphaVantageCandles });
  }

  return persist({ source: null, candles: [] });
};

const describeMt4Insufficiency = (
  symbol: string,
  timeframe: ChartTimeframe,
  candles: PriceCandle[],
  explicitError: string | null
): string => {
  if (explicitError && explicitError.trim()) return explicitError;
  if (!candles.length) return `MT5 returned no candles for ${symbol} ${timeframe}`;

  const count = candles.length;
  const last = candles[candles.length - 1];
  const iso = new Date(Number(last.time) * 1000).toISOString().replace("T", " ").replace(".000Z", " UTC");
  return `MT5 returned ${count} candle${count === 1 ? "" : "s"} for ${symbol} ${timeframe} (last candle ${iso})`;
};

// Retained for optional future non-MT4 mode; referenced to satisfy strict noUnusedLocals.
void COINGECKO_IDS;
void BINANCE_INTERVALS;
void aggregateToCandles;
void generateSyntheticCandles;

const MT4_ONLY_MODE = parseEnvBoolean(import.meta.env.VITE_MT4_ONLY as string | undefined, false);

const getRefreshIntervalMs = (timeframe: ChartTimeframe): number => {
  switch (timeframe) {
    case "M1":
      return 1000;
    case "M5":
      return 1500;
    case "M15":
      return 2000;
    case "M30":
      return 2500;
    case "H1":
      return 3000;
    case "H4":
      return 3500;
    case "D1":
      return 4000;
    case "W1":
      return 5000;
    case "MN":
      return 6000;
    default:
      return 2000;
  }
};

const timeframeBucketSec = (timeframe: ChartTimeframe): number => {
  switch (timeframe) {
    case "M1":
      return 60;
    case "M5":
      return 5 * 60;
    case "M15":
      return 15 * 60;
    case "M30":
      return 30 * 60;
    case "H1":
      return 60 * 60;
    case "H4":
      return 4 * 60 * 60;
    case "D1":
      return 24 * 60 * 60;
    case "W1":
      return 7 * 24 * 60 * 60;
    case "MN":
      return 30 * 24 * 60 * 60;
    default:
      return 60;
  }
};

const trimToRecentContinuousCandles = (
  candles: PriceCandle[],
  timeframe: ChartTimeframe
): PriceCandle[] => {
  if (candles.length < 3) return candles;
  const bucketSec = timeframeBucketSec(timeframe);
  const maxGapSec =
    bucketSec <= 60 * 60
      ? 3 * 24 * 60 * 60
      : bucketSec <= 4 * 60 * 60
      ? 7 * 24 * 60 * 60
      : bucketSec <= 24 * 60 * 60
      ? 120 * 24 * 60 * 60
      : bucketSec <= 7 * 24 * 60 * 60
      ? 365 * 24 * 60 * 60
      : 3 * 365 * 24 * 60 * 60;

  let startIndex = 0;
  for (let i = candles.length - 1; i > 0; i -= 1) {
    const gapSec = Number(candles[i].time) - Number(candles[i - 1].time);
    if (gapSec > maxGapSec) {
      startIndex = i;
      break;
    }
  }

  const trimmed = candles.slice(startIndex);
  // If a large history gap leaves too-few tail candles, keep full series to avoid one-bar chart collapse.
  if (startIndex > 0 && trimmed.length < 20) return candles;
  return trimmed;
};

const applyTickToCandles = (
  candles: PriceCandle[],
  tick: Mt4Tick | null,
  timeframe: ChartTimeframe
): PriceCandle[] => {
  if (!tick || !candles.length) return candles;
  const bucketSec = timeframeBucketSec(timeframe);
  const tickMid = tick.ask > 0 ? (tick.bid + tick.ask) / 2 : tick.bid;
  if (!Number.isFinite(tickMid) || tickMid <= 0) return candles;

  const tickBucket = Math.floor(tick.time / bucketSec) * bucketSec;
  const last = candles[candles.length - 1];
  const lastTime = Number(last.time);

  if (tickBucket < lastTime) return candles;

  if (tickBucket === lastTime) {
    const updated = candles.slice();
    const next = { ...last };
    next.high = Math.max(next.high, tickMid);
    next.low = Math.min(next.low, tickMid);
    next.close = tickMid;
    updated[updated.length - 1] = next;
    return updated;
  }

  const nextCandle: PriceCandle = {
    time: tickBucket as UTCTimestamp,
    open: last.close,
    high: Math.max(last.close, tickMid),
    low: Math.min(last.close, tickMid),
    close: tickMid,
    volume: 0,
  };
  return [...candles, nextCandle].slice(-candles.length);
};

export const PriceChart: React.FC<PriceChartProps> = ({
  symbol,
  isCrypto,
  height = 440,
  timeframe = "D1",
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const lastRenderSignatureRef = useRef<string>("");
  const [stats, setStats] = useState<ChartStats | null>(null);
  const [source, setSource] = useState<ChartDataSource>("SIMULATED");
  const [resolvedBrokerSymbol, setResolvedBrokerSymbol] = useState<string | null>(null);
  const [mt4Status, setMt4Status] = useState<string | null>(null);
  const [noDataReason, setNoDataReason] = useState<string | null>(null);
  const [staleFeedWarning, setStaleFeedWarning] = useState<string | null>(null);
  const [bridgeRttMs, setBridgeRttMs] = useState<number | null>(null);
  const [feedAgeMs, setFeedAgeMs] = useState<number | null>(null);

  const config = useMemo(() => TIMEFRAME_CONFIG[timeframe], [timeframe]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) return;

    let cancelled = false;
    let fetching = false;
    let detachResizeListener: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let refreshTimer: number | null = null;
    let chart: any = null;
    let candleSeries: any = null;
    let volumeSeries: any = null;
    let ma7Series: any = null;
    let ma25Series: any = null;
    let ma99Series: any = null;
    let ema50Series: any = null;
    let supportPriceLine: any = null;
    let resistancePriceLine: any = null;
    let hasFittedOnce = false;

    const ensureChart = () => {
      if (!container || cancelled || chart) return;
      const initialWidth = Math.max(320, container.clientWidth || 0);

      chart = createChart(container, {
        width: initialWidth,
        height,
        layout: {
          background: { type: ColorType.Solid, color: "#0b1220" },
          textColor: "#9ca3af",
          fontFamily: "Segoe UI, Roboto, sans-serif",
          fontSize: 12,
        },
        grid: {
          vertLines: { color: "rgba(148,163,184,0.12)" },
          horzLines: { color: "rgba(148,163,184,0.12)" },
        },
        rightPriceScale: {
          borderColor: "rgba(148,163,184,0.25)",
        },
        timeScale: {
          borderColor: "rgba(148,163,184,0.25)",
          timeVisible: timeframe !== "W1" && timeframe !== "MN",
          secondsVisible: timeframe === "M1" || timeframe === "M5",
          rightOffset: 8,
          barSpacing: 9,
        },
        crosshair: {
          vertLine: { color: "rgba(148,163,184,0.45)", width: 1, style: 3 },
          horzLine: { color: "rgba(148,163,184,0.45)", width: 1, style: 3 },
        },
      });

      const precision = getPricePrecision(symbol, isCrypto);
      const minMove = Number((1 / Math.pow(10, precision)).toFixed(precision));

      candleSeries = chart.addCandlestickSeries({
        upColor: "#22c55e",
        downColor: "#f43f5e",
        borderUpColor: "#22c55e",
        borderDownColor: "#f43f5e",
        wickUpColor: "#22c55e",
        wickDownColor: "#f43f5e",
        priceFormat: {
          type: "price",
          precision,
          minMove,
        },
      });

      volumeSeries = chart.addHistogramSeries({
        priceFormat: { type: "volume" },
        priceScaleId: "",
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.78,
          bottom: 0,
        },
      });

      ma7Series = chart.addLineSeries({
        color: "#facc15",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ma25Series = chart.addLineSeries({
        color: "#ec4899",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ma99Series = chart.addLineSeries({
        color: "#a78bfa",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      ema50Series = chart.addLineSeries({
        color: "#38bdf8",
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
        title: "EMA50",
      });

      const onResize = () => {
        if (!chart || !container) return;
        const nextWidth = Math.max(320, container.clientWidth || 0);
        chart.applyOptions({ width: nextWidth, height });
      };
      window.addEventListener("resize", onResize);
      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => onResize());
        resizeObserver.observe(container);
      }
      detachResizeListener = () => window.removeEventListener("resize", onResize);
      chartRef.current = chart;
    };

    const cleanup = () => {
      if (refreshTimer !== null) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
      }
      if (detachResizeListener) {
        detachResizeListener();
        detachResizeListener = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (chart) chart.remove();
      chart = null;
      candleSeries = null;
      volumeSeries = null;
      ma7Series = null;
      ma25Series = null;
      ma99Series = null;
      ema50Series = null;
      supportPriceLine = null;
      resistancePriceLine = null;
      chartRef.current = null;
      hasFittedOnce = false;
      lastRenderSignatureRef.current = "";
    };

    const renderChart = (candles: PriceCandle[], activeSource: ChartDataSource) => {
      if (!container || cancelled || candles.length < 1) return;
      ensureChart();
      if (!chart || !candleSeries || !volumeSeries || !ma7Series || !ma25Series || !ma99Series || !ema50Series) return;
      const liveWidth = Math.max(320, container.clientWidth || 0);
      chart.applyOptions({ width: liveWidth, height });

      candleSeries.setData(
        candles.map((c) => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );

      volumeSeries.setData(
        candles.map((c) => ({
          time: c.time,
          value: c.volume,
          color: c.close >= c.open ? "rgba(34,197,94,0.65)" : "rgba(244,63,94,0.65)",
        }))
      );

      const ma7 = calculateMA(candles, 7);
      const ma25 = calculateMA(candles, 25);
      const ma99 = calculateMA(candles, 99);
      const ema50 = calculateEMA(candles, 50);
      const { support, resistance } = calculateSupportResistance(candles, 50);

      ma7Series.setData(ma7);

      ma25Series.setData(ma25);

      ma99Series.setData(ma99);

      ema50Series.setData(ema50);

      if (supportPriceLine) {
        candleSeries.removePriceLine(supportPriceLine);
        supportPriceLine = null;
      }
      if (resistancePriceLine) {
        candleSeries.removePriceLine(resistancePriceLine);
        resistancePriceLine = null;
      }
      if (support !== null) {
        supportPriceLine = candleSeries.createPriceLine({
          price: support,
          color: "#f97316",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "Support",
        });
      }
      if (resistance !== null) {
        resistancePriceLine = candleSeries.createPriceLine({
          price: resistance,
          color: "#22c55e",
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: true,
          title: "Resistance",
        });
      }

      const lastCandle = candles[candles.length - 1];
      const previousClose = candles[candles.length - 2]?.close ?? null;
      const ma7Last = ma7.length ? ma7[ma7.length - 1].value : null;
      const ma25Last = ma25.length ? ma25[ma25.length - 1].value : null;
      const ma99Last = ma99.length ? ma99[ma99.length - 1].value : null;
      const ema50Last = ema50.length ? ema50[ema50.length - 1].value : null;

      setStats({
        candle: lastCandle,
        previousClose,
        ma7: ma7Last,
        ma25: ma25Last,
        ma99: ma99Last,
        ema50: ema50Last,
        support,
        resistance,
      });

      if (activeSource === "MT4") {
        const lastMs = Number(lastCandle.time) * 1000;
        const nowMs = Date.now();
        const staleThresholdMs = Math.max(config.bucketMs * 3, 3 * 60 * 1000);
        const ageMs = nowMs - lastMs;
        if (ageMs > staleThresholdMs) {
          const iso = new Date(lastMs).toISOString().replace("T", " ").replace(".000Z", " UTC");
          setStaleFeedWarning(`Stale MT5 feed (last candle time ${iso})`);
        } else {
          setStaleFeedWarning(null);
        }
      } else {
        setStaleFeedWarning(null);
      }

      if (!hasFittedOnce) {
        chart.timeScale().fitContent();
        hasFittedOnce = true;
      }
    };

    const fetchAndRender = async () => {
      if (fetching || cancelled) return;
      fetching = true;
      try {
        const requestStartedAt = performance.now();
        let candles: PriceCandle[] = [];
        let activeSource: ChartDataSource = "MT4";
        const mt4Result = await fetchMt4BridgeCandles(symbol, timeframe, config, isCrypto);
        candles = trimToRecentContinuousCandles(mt4Result.candles, timeframe);
        const liveTick = mt4Result.tick;
        setBridgeRttMs(Math.max(0, Math.round(performance.now() - requestStartedAt)));
        candles = applyTickToCandles(candles, liveTick, timeframe);
        const mt4Usable = candles.length >= 2 || (MT4_ONLY_MODE && candles.length >= 1);
        if (mt4Usable) {
          setSource("MT4");
          setResolvedBrokerSymbol(mt4Result.brokerSymbol);
          setMt4Status(null);
          setNoDataReason(null);
        } else {
          const reason = describeMt4Insufficiency(symbol, timeframe, candles, mt4Result.error);

          if (!MT4_ONLY_MODE) {
            const fallback = await fetchExternalFallbackCandles(symbol, timeframe, config, isCrypto);
            if (fallback.source && fallback.candles.length >= 2) {
              candles = fallback.candles;
              activeSource = fallback.source;
              setSource(fallback.source);
              setResolvedBrokerSymbol(null);
              setMt4Status(reason);
              setNoDataReason(null);
              setBridgeRttMs(null);
              setFeedAgeMs(null);
              setStaleFeedWarning(null);
            } else {
              setSource("MT4");
              setResolvedBrokerSymbol(mt4Result.brokerSymbol);
              setMt4Status(reason);
              setNoDataReason(reason);
              setStaleFeedWarning(null);
              setFeedAgeMs(null);
              lastRenderSignatureRef.current = "";
              setStats(null);
              cleanup();
              return;
            }
          } else {
            setSource("MT4");
            setResolvedBrokerSymbol(mt4Result.brokerSymbol);
            setMt4Status(reason);
            setNoDataReason(reason);
            setStaleFeedWarning(null);
            setFeedAgeMs(null);
            lastRenderSignatureRef.current = "";
            setStats(null);
            cleanup();
            return;
          }
        }

        const last = candles[candles.length - 1];
        if (last && activeSource === "MT4") {
          const nowMs = Date.now();
          const tickMs = liveTick?.time ? Number(liveTick.time) * 1000 : 0;
          const lastMs = tickMs > 0 ? tickMs : Number(last.time) * 1000;
          const computedFeedAgeMs = Math.max(0, nowMs - lastMs);
          setFeedAgeMs(computedFeedAgeMs);
          const staleThresholdMs = Math.max(config.bucketMs * 3, 3 * 60 * 1000);
          const ageMs = computedFeedAgeMs;
          if (ageMs > staleThresholdMs) {
            const iso = new Date(lastMs).toISOString().replace("T", " ").replace(".000Z", " UTC");
            setStaleFeedWarning(`Stale MT5 feed (last candle time ${iso})`);
          } else {
            setStaleFeedWarning(null);
          }
        } else {
          setFeedAgeMs(null);
          setStaleFeedWarning(null);
        }
        const prev = candles.length > 1 ? candles[candles.length - 2] : null;
        const signature = [
          symbol,
          timeframe,
          candles.length,
          last?.time ?? 0,
          last?.open ?? 0,
          last?.high ?? 0,
          last?.low ?? 0,
          last?.close ?? 0,
          last?.volume ?? 0,
          prev?.time ?? 0,
          prev?.close ?? 0,
        ].join("|");
        if (signature === lastRenderSignatureRef.current && chart) {
          return;
        }
        lastRenderSignatureRef.current = signature;
        renderChart(candles, activeSource);
      } catch (error) {
        console.error("Error loading chart data:", error);
        setSource("MT4");
        setResolvedBrokerSymbol(null);
        setMt4Status("MT5 bridge unavailable");
        setNoDataReason("MT5 bridge unavailable");
        setStaleFeedWarning(null);
        setBridgeRttMs(null);
        setFeedAgeMs(null);
        lastRenderSignatureRef.current = "";
        setStats(null);
        cleanup();
      } finally {
        fetching = false;
      }
    };

    fetchAndRender();
    const refreshMs = getRefreshIntervalMs(timeframe);
    refreshTimer = window.setInterval(() => {
      if (document.hidden) return;
      fetchAndRender();
    }, refreshMs);

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [config, height, isCrypto, symbol, timeframe]);

  const last = stats?.candle;
  const decimals = getPricePrecision(resolvedBrokerSymbol ?? symbol, isCrypto);
  const changePct =
    stats && stats.previousClose
      ? ((stats.candle.close - stats.previousClose) / stats.previousClose) * 100
      : 0;
  const sourceMeta: Record<ChartDataSource, { label: string; className: string }> = {
    MT4: { label: "MT5", className: "text-lime-300" },
    TWELVE_DATA: { label: "Twelve Data", className: "text-sky-300" },
    ALPHA_VANTAGE: { label: "Alpha Vantage", className: "text-cyan-300" },
    YAHOO_FINANCE: { label: "Yahoo Finance", className: "text-violet-300" },
    BINANCE: { label: "Binance", className: "text-amber-300" },
    COINGECKO: { label: "CoinGecko", className: "text-emerald-300" },
    SIMULATED: { label: "Simulated", className: "text-slate-400" },
  };
  const sourceLabel = sourceMeta[source].label;
  const sourceClass = sourceMeta[source].className;
  const alphaDisplaySymbol = symbol === "Gold" ? "XAUUSD" : symbol;
  const twelveDataDisplaySymbol = getTwelveDataSymbol(symbol) ?? symbol;
  const displaySymbol =
    source === "BINANCE"
      ? BINANCE_SYMBOLS[symbol] ?? symbol
      : source === "MT4"
      ? resolvedBrokerSymbol ?? symbol
      : source === "TWELVE_DATA"
      ? twelveDataDisplaySymbol
      : source === "ALPHA_VANTAGE"
      ? alphaDisplaySymbol
      : source === "YAHOO_FINANCE"
      ? symbol
      : symbol;
  const showMt4MissingStatus = Boolean(mt4Status && source !== "MT4");
  const feedAgeClass =
    feedAgeMs === null
      ? "text-slate-400"
      : feedAgeMs < 2000
      ? "text-emerald-400"
      : feedAgeMs < 10000
      ? "text-amber-300"
      : "text-rose-300";

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-700/60 bg-slate-900/70 px-3 py-2 text-xs text-slate-300">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold text-slate-200">{formatDisplayPair(displaySymbol)} {timeframe}</span>
          <span className={sourceClass}>Source {sourceLabel}</span>
          {last && (
            <>
              <span>Open <span className="text-slate-100">{last.open.toFixed(decimals)}</span></span>
              <span>High <span className="text-emerald-400">{last.high.toFixed(decimals)}</span></span>
              <span>Low <span className="text-rose-400">{last.low.toFixed(decimals)}</span></span>
              <span>Close <span className="text-slate-100">{last.close.toFixed(decimals)}</span></span>
              <span className={changePct >= 0 ? "text-emerald-400" : "text-rose-400"}>
                Change {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
              </span>
              {stats?.ema50 !== null && <span>EMA(50) <span className="text-sky-300">{stats?.ema50?.toFixed(decimals)}</span></span>}
              {stats?.support !== null && <span>Support <span className="text-orange-300">{stats?.support?.toFixed(decimals)}</span></span>}
              {stats?.resistance !== null && <span>Resistance <span className="text-emerald-300">{stats?.resistance?.toFixed(decimals)}</span></span>}
              {stats?.ma7 !== null && <span>MA(7) <span className="text-amber-300">{stats?.ma7?.toFixed(decimals)}</span></span>}
              {stats?.ma25 !== null && <span>MA(25) <span className="text-pink-400">{stats?.ma25?.toFixed(decimals)}</span></span>}
              {stats?.ma99 !== null && <span>MA(99) <span className="text-violet-300">{stats?.ma99?.toFixed(decimals)}</span></span>}
              {bridgeRttMs !== null && (
                <span>
                  Bridge RTT <span className="text-cyan-300">{bridgeRttMs} ms</span>
                </span>
              )}
              {feedAgeMs !== null && (
                <span>
                  Feed Age <span className={feedAgeClass}>{feedAgeMs} ms</span>
                </span>
              )}
            </>
          )}
          {showMt4MissingStatus && (
            <span
              className="text-amber-300 cursor-help"
              title={mt4Status ?? undefined}
            >
              MT5 fallback active for {formatDisplayPair(symbol)} {timeframe}
            </span>
          )}
          {staleFeedWarning && (
            <span className="text-amber-300">
              {staleFeedWarning}
            </span>
          )}
        </div>
      </div>
      <div
        ref={chartContainerRef}
        style={{ width: "100%", height: `${height}px` }}
        className="rounded-lg overflow-hidden border border-slate-700/50 bg-slate-950"
      />
      {noDataReason && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
          No chart data for {formatDisplayPair(symbol)} {timeframe}. {noDataReason}
        </div>
      )}
    </div>
  );
};

export default PriceChart;
