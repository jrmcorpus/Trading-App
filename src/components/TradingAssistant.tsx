/**
 * Trading Assistant Component
 * AI-powered trading suggestions based on technical analysis
 * MT4-only signal generation from bridge candles
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Trade } from "../types";
import { CRYPTO_ASSETS, THEME } from "../utils/constants";
import { formatPairLabel } from "../utils/pairs";
import {
  AdaptiveSessionKey,
  analyzeAdaptiveLearning,
  classifyAdaptiveSession,
  formatAdaptiveSessionLabel,
} from "../utils/assistantLearning";
import { getGlobalDeduplicator } from "../utils/orderDeduplication";
import PriceChart from "./PriceChart";

interface PriceData {
  symbol: string;
  current: number;
  high: number;
  low: number;
  change: number;
  changePercent: number;
  rsi: number;
  macd: { line: number; signal: number; histogram: number };
  supportLevel: number;
  resistanceLevel: number;
  swingLow: number;
  swingHigh: number;
  atr: number;
  movingAverage50: number;
  movingAverage200: number;
  movingAverage200Prev?: number;
  movingAverage200Slope?: number;
  movingAverage200SlopeAtrRatio?: number;
  lastOpen: number;
  lastHigh: number;
  lastLow: number;
  lastClose: number;
  prevOpen: number;
  prevHigh: number;
  prevLow: number;
  prevClose: number;
  lastCandleTime: number;
}

interface TradeSignal {
  symbol: string;
  signal: "BUY" | "SELL" | "HOLD";
  strength: "STRONG" | "MODERATE" | "WEAK";
  entryPoints: {
    primary: number;
    alternative: number;
  };
  stopLoss: number;
  takeProfit: number;
  risk: number;
  reward: number;
  confidence: number;
  winRate: number;
  noiseScore: number;
  noiseState: "LOW" | "MEDIUM" | "HIGH";
  isCrypto: boolean;
}

type ChartTimeframe = "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1" | "MN";
type OrderAction = "PLACE" | "CLOSE" | "MODIFY";
type AutoEntryMode = "MARKET" | "LIMIT_SR";
type AutoEntryTiming = "M15" | "M5" | "M1";
type AutoStrategyMode = "CLASSIC_STACK" | "SCALP_M15";
type AutoReentryMode = "OFF" | "BALANCED" | "STRICT";
type AutoRuntimeMode = "BROWSER" | "HEADLESS";
type AutoSideFilter = "BOTH" | "BUY_ONLY" | "SELL_ONLY";
type ManagedSymbol = "GOLD" | "ETHUSD";
type AutoTradeLogLevel = "INFO" | "WARN" | "ERROR";
type WatchlistBoardAssetType = "CRYPTO" | "FOREX" | "METAL" | "INDEX";
type WatchlistBoardTypeFilter = "ALL" | WatchlistBoardAssetType;
type BotExecutionStage =
  | "PREPARE_SENT"
  | "PREPARE_OK"
  | "PREPARE_FAIL"
  | "DUPLICATE_BLOCKED"
  | "CONFIRM_SENT"
  | "EXECUTION_OK"
  | "EXECUTION_FAIL";

interface AutoTradeLogEntry {
  ts: number;
  level: AutoTradeLogLevel;
  message: string;
}

interface BotExecutionAuditLogEntry {
  ts: number;
  symbol: string;
  stage: BotExecutionStage;
  details: string;
}

interface HeadlessRuntimeStatus {
  autoEnabled: boolean;
  protectEnabled: boolean;
  protectOvernightEnabled: boolean;
  overnightLossStopActive: boolean;
  overnightConsecutiveLosses: number;
  overnightMaxConsecutiveLosses: number;
  overnightLossStopReason: string;
  overnightLossStopAtMs: number;
  autoBusy: boolean;
  protectBusy: boolean;
  commandBusy: boolean;
  autoRunning: boolean;
  protectRunning: boolean;
  autoStatus: string;
  protectStatus: string;
  lastAutoRunAtMs: number;
  lastAutoCompletedAtMs: number;
  lastProtectRunAtMs: number;
  lastProtectCompletedAtMs: number;
  logs: AutoTradeLogEntry[];
  auditLogs: BotExecutionAuditLogEntry[];
}

interface OpenPosition {
  ticket: number;
  symbol: string;
  type: string;
  lots: number;
  openPrice: number;
  sl: number;
  tp: number;
  openTime: number;
}

interface OpenPositionProjection {
  atSl: number;
  atTp: number;
}

interface SettingsBundle {
  version: number;
  exportedAt: string;
  app: string;
  localSettings: Record<string, string | null>;
  headlessConfig: Record<string, unknown> | null;
}

interface PolicyCheckItem {
  rule: string;
  ok: boolean;
  detail: string;
}

interface PanelPolicyDiagnostics {
  symbol: string;
  timeframe: ChartTimeframe;
  pass: boolean | null;
  message: string;
  checks: PolicyCheckItem[];
  checkedAtMs?: number;
  orderPlan?: string;
  actualOpenCount?: number;
  reservedOpenCount?: number;
  maxOpenTradesApplied?: number;
}

interface PanelAutoEligibility {
  symbol: string;
  timeframe: ChartTimeframe;
  eligible: boolean;
  reason: string;
  intendedSide?: "BUY" | "SELL";
  scalpBias?: "BUY" | "SELL";
  lots?: number;
  rawRiskLot?: number;
  actualRiskLot?: number;
  note?: string;
}

interface WatchlistBoardEntry {
  symbol: string;
  timeframe: ChartTimeframe;
  priceData: PriceData | null;
  tradeSignal: TradeSignal | null;
  updatedAtMs: number;
}

interface PanelStrategyIndicators {
  strategyMode: AutoStrategyMode;
  trendTimeframe: ChartTimeframe;
  trendData: PriceData | null;
  trendBias: "BUY" | "SELL" | "HOLD" | null;
  setupTimeframe?: ChartTimeframe;
  setupData?: PriceData | null;
  setupSignal?: TradeSignal | null;
  entryTimeframe: AutoEntryTiming;
  entryData: PriceData | null;
  entrySignal: TradeSignal | null;
  updatedAtMs: number;
}

interface CandidateEvaluation {
  symbol: string;
  panelTimeframe: ChartTimeframe;
  autoTimeframe: ChartTimeframe;
  eligible: boolean;
  reason: string;
  pass: boolean | null;
  message: string;
  checks: PolicyCheckItem[];
  checkedAtMs: number;
  orderPlan?: string;
  orderPlanData?: AutoOrderPlan;
  resolvedSymbol?: string;
  scalpBias?: "BUY" | "SELL";
  actualOpenCount?: number;
  reservedOpenCount?: number;
  maxOpenTradesApplied?: number;
  lots?: number;
  rawRiskLot?: number;
  actualRiskLot?: number;
  note?: string;
}

const createPolicyCheck = (rule: string, ok: boolean, detail: string): PolicyCheckItem => ({
  rule,
  ok,
  detail,
});

const getScalpTrendBias = (
  data: PriceData | null,
  aggressive: boolean
): "BUY" | "SELL" | null => {
  if (!data) return null;
  const trendAtr = Number(data.atr || 0);
  const trendTolerance = aggressive ? Math.max(0, trendAtr * 0.2) : 0;
  const trendDelta = Number(data.current) - Number(data.movingAverage50);
  return trendDelta >= -trendTolerance ? "BUY" : "SELL";
};

interface Mt4PolicyEvent {
  time: number;
  symbol: string;
  event: string;
  severity: string;
  detail: string;
}

interface Mt4Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface RiskSettingsPreview {
  symbol: string;
  timeframe: ChartTimeframe;
  side: "BUY" | "SELL";
  entry: number;
  sl: number;
  tp: number;
  lots: number;
  spreadCost: number;
  riskAtSL: number;
  rewardAtTP: number;
  rr: number;
  slPoints: number;
  tpPoints: number;
  slPips: number;
  tpPips: number;
  pipLabel: string;
  targetRisk: number;
  rawLots: number;
  lotStatus: "OK" | "BELOW_MIN" | "CAPPED";
}

interface MarketNewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt?: string;
  summary?: string;
  sentiment?: string;
}

interface SymbolMarketIntel {
  symbol: string;
  resources: string[];
  news: MarketNewsItem[];
  warnings?: string[];
}

type BridgeVersionStatus = "checking" | "ok" | "outdated" | "offline";

interface BridgeVersionCheck {
  status: BridgeVersionStatus;
  message: string;
  version: string;
  capabilities: string[];
  checkedAtMs: number;
}

interface AutoOrderPlan {
  action: "PLACE" | "PENDING";
  side: "BUY" | "SELL";
  orderType?: "BUY_LIMIT" | "SELL_LIMIT";
  price?: number;
  sl: number;
  tp: number;
  entryForRisk: number;
  label: string;
  fallbackReason?: string;
  tpSource?: "STRUCTURE" | "RR";
  rrAtTp?: number;
}

interface ManagedSymbolTradeDraft {
  sideFilter: AutoSideFilter;
  minConfidence: string;
  minWinRate: string;
  minRR: string;
  maxSpreadPoints: string;
  cooldownMin: string;
  maxOpenTrades: string;
  requireStrong: boolean;
  enforceSymbolCooldown: boolean;
  enforceDailyLossLimit: boolean;
  enforceHardRiskBlock: boolean;
  entryTimeframe: AutoEntryTiming;
  entryMode: AutoEntryMode;
  botLots: string;
  riskMode: "PCT" | "USD";
  useDynamicLot: boolean;
  riskPct: string;
  riskUsd: string;
  riskGuardMult: string;
  minSlPoints: string;
  atrBufferMult: string;
  minLot: string;
  lotStep: string;
}

interface AutoOrderPlanResult {
  plan: AutoOrderPlan | null;
  blockedReason?: string;
}

const TIMEFRAMES: ChartTimeframe[] = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"];
const REQUIRED_BRIDGE_CAPABILITIES = ["market-intel", "ai-complete"] as const;
const WATCHLIST_BASE_SYMBOLS = [
  "BTCUSD",
  "ETHUSD",
  "SOLUSD",
  "XRPUSD",
  "EURUSD",
  "USDJPY",
  "AUDUSD",
  "GBPUSD",
  "GBPJPY",
  "GBPNZD",
  "EURJPY",
  "AUDJPY",
  "US30CASH",
  "GOLD",
  "SILVER",
] as const;
const WATCHLIST_ALL_TYPE_ORDER = [
  "EURUSD",
  "AUDJPY",
  "GBPUSD",
  "GBPNZD",
  "AUDUSD",
  "USDJPY",
  "GBPJPY",
  "EURJPY",
  "US30CASH",
  "GOLD",
  "SILVER",
  "BTCUSD",
  "ETHUSD",
  "XRPUSD",
  "SOLUSD",
] as const;
const WATCHLIST_BOARD_TYPE_OPTIONS: Array<{ value: WatchlistBoardTypeFilter; label: string }> = [
  { value: "ALL", label: "All Types" },
  { value: "FOREX", label: "Forex" },
  { value: "INDEX", label: "Indices" },
  { value: "METAL", label: "Metals" },
  { value: "CRYPTO", label: "Crypto" },
];
const WATCHLIST_BOARD_BATCH_SIZE = 4;
const getWatchlistBoardIntervalMs = (timeframe: ChartTimeframe): number => {
  switch (timeframe) {
    case "M1":
    case "M5":
      return 10000;
    case "M15":
      return 15000;
    case "M30":
    case "H1":
      return 20000;
    case "H4":
    case "D1":
      return 30000;
    default:
      return 45000;
  }
};
interface SymbolExecutionPreset {
  minSlPoints: number;
  spreadMult: number;
  slippageMult: number;
}
const parseUtcMinutes = (value: string | undefined, fallback: number): number => {
  if (!value) return fallback;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return fallback;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return fallback;
  return hours * 60 + minutes;
};

const parseBooleanFlag = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
};

const getBridgeHealthUrl = (bridgeBase: string): string => {
  const normalized = String(bridgeBase || "").replace(/\/+$/, "");
  if (!normalized) return "/api/mt4/health";

  // If the provided base already points to a health endpoint, don't append twice.
  if (/\/health$/i.test(normalized)) return normalized;

  // Some users set VITE_MT4_BRIDGE_URL to the MT5 reader path (`/api/mt5`), but
  // the bridge only exposes health under the MT4 namespace or at root.
  if (/\/api\/mt5$/i.test(normalized)) {
    return `${normalized.replace(/\/api\/mt5$/i, "/api/mt4")}/health`;
  }

  return `${normalized}/health`;
};

const minuteInWindow = (minute: number, start: number, end: number): boolean => {
  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;
  return minute >= start || minute < end;
};

const formatClockMinute = (minute: number): string => {
  const safe = ((Math.floor(minute) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
};

const getMinuteInTimeZone = (nowMs: number, timeZone: string): number => {
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

const readResponseJsonSafe = async (response: Response): Promise<any> => {
  try {
    const raw = await response.text();
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const requestBridgeAiCompletion = async (
  bridgeBase: string,
  payload: { prompt: string; system?: string; temperature?: number }
): Promise<{ ok: true; provider: "GEMINI" | "OPENAI"; text: string } | { ok: false; error: string }> => {
  try {
    const response = await fetch(`${bridgeBase}/ai/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await readResponseJsonSafe(response);
    if (!response.ok || !data?.ok) {
      const rawError = String(data?.error || "").trim();
      if (response.status === 404 || rawError.toLowerCase() === "not found") {
        return {
          ok: false,
          error: "Bridge endpoint /api/mt4/ai/complete is not available. Restart mt5_bridge/server.mjs with the latest code.",
        };
      }
      return { ok: false, error: rawError || "Bridge AI request failed" };
    }
    const provider = data?.provider === "OPENAI" ? "OPENAI" : data?.provider === "GEMINI" ? "GEMINI" : null;
    const text = String(data?.text || "").trim();
    if (!provider || !text) {
      return { ok: false, error: "Bridge AI returned an empty response" };
    }
    return { ok: true, provider, text };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Bridge AI request failed" };
  }
};

const AUTO_TRADE_DEFAULTS = {
  sideFilter: "BOTH" as AutoSideFilter,
  minConfidence: "30",
  minWinRate: "0",
  minRR: "1.0",
  maxSpreadPoints: "80",
  cooldownMin: "60",
  maxOpenTrades: "2",
  requireStrong: false,
  enforceTrendStack: false,
  enforceSymbolCooldown: true,
  enforceDailyLossLimit: true,
  enforceHardRiskBlock: true,
  strategyMode: "SCALP_M15" as AutoStrategyMode,
  scalpAggressive: true,
  biasTimeframe: "H4" as ChartTimeframe,
  setupTimeframe: "H1" as ChartTimeframe,
  entryTimeframe: "M5" as AutoEntryTiming,
  reentryMode: "OFF" as AutoReentryMode,
  timeframeOverride: "PANEL" as ChartTimeframe | "PANEL",
  entryMode: "MARKET" as AutoEntryMode,
  allowMarketFallback: true,
  fallbackMinConfidence: "30",
  fallbackRrBuffer: "0.2",
  botLots: "0.01",
  riskMode: "USD" as "PCT" | "USD",
  useDynamicLot: true,
  riskPct: "1.0",
  riskUsd: "1.00",
  riskGuardMult: "1.10",
  minSlPoints: "30",
  atrBufferMult: "0.25",
  minLot: "0.01",
  lotStep: "0.01",
};
const HEADLESS_RUNTIME_STATUS_DEFAULT: HeadlessRuntimeStatus = {
  autoEnabled: false,
  protectEnabled: false,
  protectOvernightEnabled: false,
  overnightLossStopActive: false,
  overnightConsecutiveLosses: 0,
  overnightMaxConsecutiveLosses: 3,
  overnightLossStopReason: "",
  overnightLossStopAtMs: 0,
  autoBusy: false,
  protectBusy: false,
  commandBusy: false,
  autoRunning: false,
  protectRunning: false,
  autoStatus: "",
  protectStatus: "",
  lastAutoRunAtMs: 0,
  lastAutoCompletedAtMs: 0,
  lastProtectRunAtMs: 0,
  lastProtectCompletedAtMs: 0,
  logs: [],
  auditLogs: [],
};
const AUTO_RISK_HARD_BLOCK_MULTIPLIER = 1.1;
const MANAGED_PROTECT_MAX_RISK_USD = 2;
const AGGRESSIVE_AUTO_TP_TARGET_USD = 1;
const HEADLESS_MANAGED_PRESET = [
  {
    symbol: "GOLD",
    timeframe: "M5" as ChartTimeframe,
    commentTag: "gold-overnight-scalp",
    description: "GOLD M5 overnight scalp",
  },
  {
    symbol: "ETHUSD",
    timeframe: "M15" as ChartTimeframe,
    commentTag: "eth-trend-pullback",
    description: "ETHUSD M15 trend pullback",
  },
] as const;
const MANAGED_SYMBOLS = ["GOLD", "ETHUSD"] as const;
const HEADLESS_OVERNIGHT_BREAK_EVEN_PROFIT_USD = "0.30";
const HEADLESS_OVERNIGHT_TARGET_PROFIT_USD = "1.10";
const HEADLESS_OVERNIGHT_LOSS_USD = "1.20";
const HEADLESS_BIAS_FLIP_TP_PROGRESS_PCT = "35";
const HEADLESS_OVERNIGHT_RETRACE_ARM_USD = "0.80";
const HEADLESS_OVERNIGHT_RETRACE_CLOSE_USD = "0.40";
const HEADLESS_MA200_FLAT_MAX_ATR_RATIO = 0.09;
const HEADLESS_HIGH_IMPACT_NEWS_LOOKBACK_MIN = 360;
const HEADLESS_HIGH_IMPACT_NEWS_KEYWORDS = ["NFP", "CPI", "FOMC"];
const SETTINGS_BUNDLE_VERSION = 1;
const SETTINGS_BUNDLE_LOCAL_STORAGE_KEYS = [
  "assistant.autoTrade",
  "assistant.protect",
  "assistant.profile",
  "assistant.learning",
  "assistant.orderForm",
  "assistant.panels",
  "journal.manualTrades.v1",
] as const;
const sanitizePositiveNumber = (value: unknown, fallback: number, min: number, max: number): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(fallback);
  return String(Math.max(min, Math.min(max, n)));
};
const sanitizeCooldownMinutes = (value: unknown, fallback = 15): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(fallback);
  return String(Math.max(1, Math.min(1440, Math.round(n))));
};
const sanitizeMaxOpenTrades = (value: unknown, fallback = 1): string => {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(fallback);
  return String(Math.max(1, Math.min(100, Math.round(n))));
};
const clampNumber = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const getWatchIntervalMs = (timeframe: ChartTimeframe): number => {
  switch (timeframe) {
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
const AUTO_BIAS_TIMEFRAME: ChartTimeframe = "H4";
const AUTO_SETUP_TIMEFRAME: ChartTimeframe = "H1";
const AUTO_SCALP_TREND_TIMEFRAME: ChartTimeframe = "M15";
const ASSISTANT_MT4_ONLY_MODE = parseBooleanFlag(import.meta.env.VITE_MT4_ONLY as string | undefined, false);
const getTrendFilterFrames = (
  strategyMode: AutoStrategyMode,
  entryTimeframe: AutoEntryTiming
): ChartTimeframe[] =>
  strategyMode === "SCALP_M15"
    ? [AUTO_SCALP_TREND_TIMEFRAME, entryTimeframe]
    : [entryTimeframe, AUTO_SETUP_TIMEFRAME, AUTO_BIAS_TIMEFRAME];
const formatTrendStackLabel = (strategyMode: AutoStrategyMode, entryTimeframe: AutoEntryTiming): string =>
  strategyMode === "SCALP_M15"
    ? `Trend ${AUTO_SCALP_TREND_TIMEFRAME} / Entry ${entryTimeframe}`
    : `Bias ${AUTO_BIAS_TIMEFRAME} / Setup ${AUTO_SETUP_TIMEFRAME} / Entry ${entryTimeframe}`;

interface TradingAssistantProps {
  trades: Trade[];
}

const TradingAssistant: React.FC<TradingAssistantProps> = ({ trades }) => {
  const [selectedSymbol] = useState("EURUSD");
  const getStoredPanels = () => {
    const defaultSymbols = ["EURUSD", "USDJPY", "GOLD", "BTCUSD"];
    const defaultTimeframes = ["D1", "D1", "D1", "D1"] as ChartTimeframe[];
    if (typeof window === "undefined") {
      return {
        symbols: defaultSymbols,
        timeframes: defaultTimeframes,
      };
    }
    try {
      const raw = localStorage.getItem("assistant.panels");
      if (!raw) {
        return {
          symbols: defaultSymbols,
          timeframes: defaultTimeframes,
        };
      }
      const parsed = JSON.parse(raw);
      const rawSymbols = Array.isArray(parsed?.symbols) && parsed.symbols.length === 4
        ? parsed.symbols
        : defaultSymbols;
      const symbols = rawSymbols.map((sym: string, idx: number) => {
        if (WATCHLIST_BASE_SYMBOLS.includes(sym as (typeof WATCHLIST_BASE_SYMBOLS)[number])) return sym;
        return defaultSymbols[idx] || defaultSymbols[0];
      });
      const timeframes = Array.isArray(parsed?.timeframes) && parsed.timeframes.length === 4
        ? parsed.timeframes
        : defaultTimeframes;
      return { symbols, timeframes };
    } catch {
      return {
        symbols: defaultSymbols,
        timeframes: defaultTimeframes,
      };
    }
  };

  const storedPanels = getStoredPanels();
  const [panelSymbols, setPanelSymbols] = useState<string[]>(storedPanels.symbols);
  const [panelTimeframes, setPanelTimeframes] = useState<ChartTimeframe[]>(storedPanels.timeframes);
  const [fullscreenChartIndex, setFullscreenChartIndex] = useState<number | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<ChartTimeframe>("D1");
  const [tradeSignal, setTradeSignal] = useState<TradeSignal | null>(null);
  const [loading, setLoading] = useState(false);
  const [orderAction, setOrderAction] = useState<OrderAction>("PLACE");
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderLots, setOrderLots] = useState("0.01");
  const [orderTicket, setOrderTicket] = useState("");
  const [orderCloseLots, setOrderCloseLots] = useState("");
  const [orderSL, setOrderSL] = useState("");
  const [orderTP, setOrderTP] = useState("");
  const [orderComment, setOrderComment] = useState("web-bridge");
  const [confirmTokenInput, setConfirmTokenInput] = useState("");
  const [pendingOrder, setPendingOrder] = useState<{
    requestId: string;
    confirmToken: string;
    summary: string;
    expiresInMs: number;
    action: string;
    symbol: string;
    side?: string;
    price?: number;
  } | null>(null);
  const [tradeBridgeBusy, setTradeBridgeBusy] = useState(false);
  const [tradeBridgeMessage, setTradeBridgeMessage] = useState<string>("");
  const [openPositions, setOpenPositions] = useState<OpenPosition[]>([]);
  const [openPositionProjections, setOpenPositionProjections] = useState<Record<number, OpenPositionProjection>>({});
  const [aiNote, setAiNote] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [aiProviderUsed, setAiProviderUsed] = useState<"GEMINI" | "OPENAI" | "">("");
  const [aiPositionsLoading, setAiPositionsLoading] = useState(false);
  const [aiPositionsError, setAiPositionsError] = useState("");
  const [aiPositionsResponse, setAiPositionsResponse] = useState("");
  const [aiPositionsProvider, setAiPositionsProvider] = useState<"GEMINI" | "OPENAI" | "">("");
  const [autoRuntimeMode, setAutoRuntimeMode] = useState<AutoRuntimeMode>("BROWSER");
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [autoSideFilter, setAutoSideFilter] = useState<AutoSideFilter>(AUTO_TRADE_DEFAULTS.sideFilter);
  const [autoMinConfidence, setAutoMinConfidence] = useState(AUTO_TRADE_DEFAULTS.minConfidence);
  const [autoMinWinRate, setAutoMinWinRate] = useState(AUTO_TRADE_DEFAULTS.minWinRate);
  const [autoMinRR, setAutoMinRR] = useState(AUTO_TRADE_DEFAULTS.minRR);
  const [autoMaxSpreadPointsSetting, setAutoMaxSpreadPointsSetting] = useState(
    AUTO_TRADE_DEFAULTS.maxSpreadPoints
  );
  const [autoCooldownMin, setAutoCooldownMin] = useState(AUTO_TRADE_DEFAULTS.cooldownMin);
  const [autoMaxOpenTrades, setAutoMaxOpenTrades] = useState(AUTO_TRADE_DEFAULTS.maxOpenTrades);
  const [autoRequireStrongSignal, setAutoRequireStrongSignal] = useState(AUTO_TRADE_DEFAULTS.requireStrong);
  const [autoEnforceTrendStack, setAutoEnforceTrendStack] = useState(AUTO_TRADE_DEFAULTS.enforceTrendStack);
  const [autoEnforceSymbolCooldown, setAutoEnforceSymbolCooldown] = useState(AUTO_TRADE_DEFAULTS.enforceSymbolCooldown);
  const [autoEnforceDailyLossLimit, setAutoEnforceDailyLossLimit] = useState(AUTO_TRADE_DEFAULTS.enforceDailyLossLimit);
  const [autoEnforceHardRiskBlock, setAutoEnforceHardRiskBlock] = useState(AUTO_TRADE_DEFAULTS.enforceHardRiskBlock);
  const [autoStrategyMode, setAutoStrategyMode] = useState<AutoStrategyMode>(AUTO_TRADE_DEFAULTS.strategyMode);
  const [autoScalpAggressive, setAutoScalpAggressive] = useState(Boolean(AUTO_TRADE_DEFAULTS.scalpAggressive));
  const [autoSessionGateEnabled, setAutoSessionGateEnabled] = useState(
    parseBooleanFlag(import.meta.env.VITE_AUTO_SESSION_WINDOW_ENABLED as string | undefined, false)
  );
  const [autoEntryTimeframe, setAutoEntryTimeframe] = useState<AutoEntryTiming>(AUTO_TRADE_DEFAULTS.entryTimeframe);
  const [autoReentryMode, setAutoReentryMode] = useState<AutoReentryMode>(AUTO_TRADE_DEFAULTS.reentryMode);
  const [autoTradeTimeframeOverride, setAutoTradeTimeframeOverride] =
    useState<ChartTimeframe | "PANEL">(AUTO_TRADE_DEFAULTS.timeframeOverride);
  const [autoEntryMode, setAutoEntryMode] = useState<AutoEntryMode>(AUTO_TRADE_DEFAULTS.entryMode);
  const [autoAllowMarketFallback, setAutoAllowMarketFallback] = useState(AUTO_TRADE_DEFAULTS.allowMarketFallback);
  const [autoFallbackMinConfidence, setAutoFallbackMinConfidence] = useState(AUTO_TRADE_DEFAULTS.fallbackMinConfidence);
  const [autoFallbackRrBuffer, setAutoFallbackRrBuffer] = useState(AUTO_TRADE_DEFAULTS.fallbackRrBuffer);
  const [autoBotLots, setAutoBotLots] = useState(AUTO_TRADE_DEFAULTS.botLots);
  const [autoRiskMode, setAutoRiskMode] = useState<"PCT" | "USD">(AUTO_TRADE_DEFAULTS.riskMode);
  const [autoUseDynamicLot, setAutoUseDynamicLot] = useState(AUTO_TRADE_DEFAULTS.useDynamicLot);
  const [autoRiskPct, setAutoRiskPct] = useState(AUTO_TRADE_DEFAULTS.riskPct);
  const [autoRiskUsd, setAutoRiskUsd] = useState(AUTO_TRADE_DEFAULTS.riskUsd);
  const [autoRiskGuardMult, setAutoRiskGuardMult] = useState(AUTO_TRADE_DEFAULTS.riskGuardMult);
  const [autoMinSlPoints, setAutoMinSlPoints] = useState(AUTO_TRADE_DEFAULTS.minSlPoints);
  const [autoAtrBufferMult, setAutoAtrBufferMult] = useState(AUTO_TRADE_DEFAULTS.atrBufferMult);
  const [autoDynamicMinLot, setAutoDynamicMinLot] = useState(AUTO_TRADE_DEFAULTS.minLot);
  const [autoDynamicLotStep, setAutoDynamicLotStep] = useState(AUTO_TRADE_DEFAULTS.lotStep);
  const [accountProfile, setAccountProfile] = useState<"STANDARD" | "MICRO">("MICRO");
  const [autoTradeDraft, setAutoTradeDraft] = useState({
    sideFilter: AUTO_TRADE_DEFAULTS.sideFilter,
    minConfidence: AUTO_TRADE_DEFAULTS.minConfidence,
    minWinRate: AUTO_TRADE_DEFAULTS.minWinRate,
    minRR: AUTO_TRADE_DEFAULTS.minRR,
    maxSpreadPoints: AUTO_TRADE_DEFAULTS.maxSpreadPoints,
    cooldownMin: AUTO_TRADE_DEFAULTS.cooldownMin,
    maxOpenTrades: AUTO_TRADE_DEFAULTS.maxOpenTrades,
    requireStrong: AUTO_TRADE_DEFAULTS.requireStrong,
    enforceTrendStack: AUTO_TRADE_DEFAULTS.enforceTrendStack,
    enforceSymbolCooldown: AUTO_TRADE_DEFAULTS.enforceSymbolCooldown,
    enforceDailyLossLimit: AUTO_TRADE_DEFAULTS.enforceDailyLossLimit,
    enforceHardRiskBlock: AUTO_TRADE_DEFAULTS.enforceHardRiskBlock,
    strategyMode: AUTO_TRADE_DEFAULTS.strategyMode,
    scalpAggressive: Boolean(AUTO_TRADE_DEFAULTS.scalpAggressive),
    sessionGateEnabled: parseBooleanFlag(import.meta.env.VITE_AUTO_SESSION_WINDOW_ENABLED as string | undefined, false),
    biasTimeframe: AUTO_TRADE_DEFAULTS.biasTimeframe,
    setupTimeframe: AUTO_TRADE_DEFAULTS.setupTimeframe,
    entryTimeframe: AUTO_TRADE_DEFAULTS.entryTimeframe,
    reentryMode: AUTO_TRADE_DEFAULTS.reentryMode,
    timeframeOverride: AUTO_TRADE_DEFAULTS.timeframeOverride,
    entryMode: AUTO_TRADE_DEFAULTS.entryMode,
    allowMarketFallback: AUTO_TRADE_DEFAULTS.allowMarketFallback,
    fallbackMinConfidence: AUTO_TRADE_DEFAULTS.fallbackMinConfidence,
    fallbackRrBuffer: AUTO_TRADE_DEFAULTS.fallbackRrBuffer,
    botLots: AUTO_TRADE_DEFAULTS.botLots,
    riskMode: AUTO_TRADE_DEFAULTS.riskMode,
    useDynamicLot: AUTO_TRADE_DEFAULTS.useDynamicLot,
    riskPct: AUTO_TRADE_DEFAULTS.riskPct,
    riskUsd: AUTO_TRADE_DEFAULTS.riskUsd,
    riskGuardMult: AUTO_TRADE_DEFAULTS.riskGuardMult,
    minSlPoints: AUTO_TRADE_DEFAULTS.minSlPoints,
    atrBufferMult: AUTO_TRADE_DEFAULTS.atrBufferMult,
    minLot: AUTO_TRADE_DEFAULTS.minLot,
    lotStep: AUTO_TRADE_DEFAULTS.lotStep,
  });
  const [selectedManagedSymbol, setSelectedManagedSymbol] = useState<ManagedSymbol>("GOLD");
  const [managedSymbolTradeDrafts, setManagedSymbolTradeDrafts] = useState<Record<ManagedSymbol, ManagedSymbolTradeDraft>>({
    GOLD: {
      sideFilter: AUTO_TRADE_DEFAULTS.sideFilter,
      minConfidence: AUTO_TRADE_DEFAULTS.minConfidence,
      minWinRate: AUTO_TRADE_DEFAULTS.minWinRate,
      minRR: AUTO_TRADE_DEFAULTS.minRR,
      maxSpreadPoints: AUTO_TRADE_DEFAULTS.maxSpreadPoints,
      cooldownMin: AUTO_TRADE_DEFAULTS.cooldownMin,
      maxOpenTrades: AUTO_TRADE_DEFAULTS.maxOpenTrades,
      requireStrong: AUTO_TRADE_DEFAULTS.requireStrong,
      enforceSymbolCooldown: AUTO_TRADE_DEFAULTS.enforceSymbolCooldown,
      enforceDailyLossLimit: AUTO_TRADE_DEFAULTS.enforceDailyLossLimit,
      enforceHardRiskBlock: AUTO_TRADE_DEFAULTS.enforceHardRiskBlock,
      entryTimeframe: "M5",
      entryMode: "MARKET",
      botLots: AUTO_TRADE_DEFAULTS.botLots,
      riskMode: AUTO_TRADE_DEFAULTS.riskMode,
      useDynamicLot: AUTO_TRADE_DEFAULTS.useDynamicLot,
      riskPct: AUTO_TRADE_DEFAULTS.riskPct,
      riskUsd: AUTO_TRADE_DEFAULTS.riskUsd,
      riskGuardMult: AUTO_TRADE_DEFAULTS.riskGuardMult,
      minSlPoints: AUTO_TRADE_DEFAULTS.minSlPoints,
      atrBufferMult: AUTO_TRADE_DEFAULTS.atrBufferMult,
      minLot: AUTO_TRADE_DEFAULTS.minLot,
      lotStep: AUTO_TRADE_DEFAULTS.lotStep,
    },
    ETHUSD: {
      sideFilter: "BOTH",
      minConfidence: "30",
      minWinRate: "0",
      minRR: "1.0",
      maxSpreadPoints: "120",
      cooldownMin: "45",
      maxOpenTrades: "2",
      requireStrong: false,
      enforceSymbolCooldown: true,
      enforceDailyLossLimit: AUTO_TRADE_DEFAULTS.enforceDailyLossLimit,
      enforceHardRiskBlock: true,
      entryTimeframe: "M15",
      entryMode: "MARKET",
      botLots: AUTO_TRADE_DEFAULTS.botLots,
      riskMode: AUTO_TRADE_DEFAULTS.riskMode,
      useDynamicLot: AUTO_TRADE_DEFAULTS.useDynamicLot,
      riskPct: AUTO_TRADE_DEFAULTS.riskPct,
      riskUsd: AUTO_TRADE_DEFAULTS.riskUsd,
      riskGuardMult: AUTO_TRADE_DEFAULTS.riskGuardMult,
      minSlPoints: "120",
      atrBufferMult: "0.35",
      minLot: AUTO_TRADE_DEFAULTS.minLot,
      lotStep: AUTO_TRADE_DEFAULTS.lotStep,
    },
  });
  const settingsWarnings = useMemo(() => {
    const warnings: string[] = [];
    const sideFilter = String(autoTradeDraft.sideFilter || "");
    const minConfidence = Number(autoTradeDraft.minConfidence);
    const minWinRate = Number(autoTradeDraft.minWinRate);
    const maxSpreadPoints = Number(autoTradeDraft.maxSpreadPoints);
    const lotCap = Number(autoTradeDraft.botLots);
    const minLot = Number(autoTradeDraft.minLot);
    const lotStep = Number(autoTradeDraft.lotStep);
    const riskPct = Number(autoTradeDraft.riskPct);
    const riskUsd = Number(autoTradeDraft.riskUsd);
    const riskGuardMult = Number(autoTradeDraft.riskGuardMult);
    const minSlPoints = Number(autoTradeDraft.minSlPoints);
    const atrBufferMult = Number(autoTradeDraft.atrBufferMult);
    const fallbackMinConfidence = Number(autoTradeDraft.fallbackMinConfidence);
    const fallbackRrBuffer = Number(autoTradeDraft.fallbackRrBuffer);
    const minRR = Number(autoTradeDraft.minRR);
    const cooldownMin = Number(autoTradeDraft.cooldownMin);
    const maxOpenTrades = Number(autoTradeDraft.maxOpenTrades);

    if (!["BOTH", "BUY_ONLY", "SELL_ONLY"].includes(sideFilter)) {
      warnings.push("Trade Side must be Both, Buy only, or Sell only.");
    }
    if (!Number.isFinite(lotCap) || lotCap <= 0) {
      warnings.push("Default Bot Lots must be greater than 0.");
    }
    if (!Number.isFinite(maxSpreadPoints) || maxSpreadPoints <= 0) {
      warnings.push("Max Spread Points must be greater than 0.");
    }
    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 100) {
      warnings.push("Min Confidence % must be between 0 and 100.");
    }
    if (!Number.isFinite(minWinRate) || minWinRate < 0 || minWinRate > 100) {
      warnings.push("Min Win Rate % must be between 0 and 100.");
    }
    if (Number.isFinite(minWinRate) && minWinRate > 95) {
      warnings.push("Min Win Rate above 95% is unreachable because the model estimate is capped at 95%.");
    }
    if (!Number.isFinite(minLot) || minLot <= 0) {
      warnings.push("Min Lot must be greater than 0.");
    }
    if (!Number.isFinite(lotStep) || lotStep <= 0) {
      warnings.push("Lot Step must be greater than 0.");
    }
    if (Number.isFinite(minLot) && Number.isFinite(lotCap) && minLot > lotCap) {
      warnings.push("Min Lot is greater than Default Bot Lots. Bot cannot place orders below Min Lot.");
    }
    if (Number.isFinite(lotStep) && Number.isFinite(lotCap) && lotStep > lotCap) {
      warnings.push("Lot Step is greater than Default Bot Lots. Computed lots may collapse to 0.");
    }
    if (Number.isFinite(minLot) && Number.isFinite(lotStep) && lotStep > minLot) {
      warnings.push("Lot Step is greater than Min Lot. Verify broker lot increment settings.");
    }
    if (Number.isFinite(minLot) && Number.isFinite(lotStep) && minLot > 0 && lotStep > 0) {
      const ratio = minLot / lotStep;
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
        warnings.push("Min Lot is not aligned with Lot Step (not an exact multiple).");
      }
    }
    if (autoTradeDraft.riskMode === "PCT") {
      if (!Number.isFinite(riskPct) || riskPct <= 0) {
        warnings.push("Risk Per Trade % must be greater than 0 when Risk Mode is Percent.");
      }
      if (Number.isFinite(riskPct) && riskPct > 5) {
        warnings.push("Risk Per Trade % is high (>5%). This can significantly increase drawdown.");
      }
    } else {
      if (!Number.isFinite(riskUsd) || riskUsd <= 0) {
        warnings.push("Risk Per Trade USD must be greater than 0 when Risk Mode is USD.");
      }
    }
    if (!autoTradeDraft.useDynamicLot) {
      warnings.push("Dynamic lot sizing is OFF. Risk Mode / Risk targets will not control lot size.");
    }
    if (!Number.isFinite(riskGuardMult) || riskGuardMult < 1) {
      warnings.push("Risk Guard Multiplier must be >= 1.0.");
    }
    if (!Number.isFinite(minSlPoints) || minSlPoints <= 0) {
      warnings.push("Min SL Distance (points) must be greater than 0.");
    }
    if (!Number.isFinite(atrBufferMult) || atrBufferMult < 0) {
      warnings.push("ATR Buffer Multiplier must be >= 0.");
    }
    if (!Number.isFinite(fallbackMinConfidence) || fallbackMinConfidence < 0 || fallbackMinConfidence > 100) {
      warnings.push("Fallback Min Confidence % must be between 0 and 100.");
    }
    if (
      autoTradeDraft.entryMode === "LIMIT_SR" &&
      autoTradeDraft.allowMarketFallback &&
      Number.isFinite(minConfidence) &&
      Number.isFinite(fallbackMinConfidence) &&
      fallbackMinConfidence < minConfidence
    ) {
      warnings.push("Fallback Min Confidence is below Min Confidence, so fallback is looser than the primary entry gate.");
    }
    if (!Number.isFinite(fallbackRrBuffer) || fallbackRrBuffer < 0) {
      warnings.push("Fallback R:R Buffer must be >= 0.");
    }
    if (Number.isFinite(minRR) && minRR < 1) {
      warnings.push("Min R:R below 1.0 means target reward is smaller than risk.");
    }
    if (Number.isFinite(cooldownMin) && cooldownMin < 1) {
      warnings.push("Cooldown below 1 minute may cause overtrading.");
    }
    if (!Number.isFinite(maxOpenTrades) || maxOpenTrades < 1) {
      warnings.push("Max Active Trades must be at least 1.");
    }
    if (autoTradeDraft.strategyMode === "SCALP_M15" && autoTradeDraft.scalpAggressive) {
      warnings.push("Scalper aggressive mode increases trade frequency and may raise drawdown.");
    }

    return warnings;
  }, [autoTradeDraft]);
  void settingsWarnings;
  const hasUnappliedTradeSettings = useMemo(() => {
    return JSON.stringify(autoTradeDraft) !== JSON.stringify({
      sideFilter: autoSideFilter,
      minConfidence: autoMinConfidence,
      minWinRate: autoMinWinRate,
      minRR: autoMinRR,
      maxSpreadPoints: autoMaxSpreadPointsSetting,
      cooldownMin: sanitizeCooldownMinutes(autoCooldownMin, 15),
      maxOpenTrades: sanitizeMaxOpenTrades(autoMaxOpenTrades, 1),
      requireStrong: autoRequireStrongSignal,
      enforceTrendStack: autoEnforceTrendStack,
      enforceSymbolCooldown: autoEnforceSymbolCooldown,
      enforceDailyLossLimit: autoEnforceDailyLossLimit,
      enforceHardRiskBlock: autoEnforceHardRiskBlock,
      strategyMode: autoStrategyMode,
      scalpAggressive: autoScalpAggressive,
      sessionGateEnabled: autoSessionGateEnabled,
      biasTimeframe: AUTO_BIAS_TIMEFRAME,
      setupTimeframe: AUTO_SETUP_TIMEFRAME,
      entryTimeframe: autoEntryTimeframe,
      reentryMode: autoReentryMode,
      timeframeOverride: autoTradeTimeframeOverride,
      entryMode: autoEntryMode,
      allowMarketFallback: autoAllowMarketFallback,
      fallbackMinConfidence: autoFallbackMinConfidence,
      fallbackRrBuffer: autoFallbackRrBuffer,
      botLots: autoBotLots,
      riskMode: autoRiskMode,
      useDynamicLot: autoUseDynamicLot,
      riskPct: autoRiskPct,
      riskUsd: autoRiskUsd,
      riskGuardMult: autoRiskGuardMult,
      minSlPoints: autoMinSlPoints,
      atrBufferMult: autoAtrBufferMult,
      minLot: autoDynamicMinLot,
      lotStep: autoDynamicLotStep,
    });
  }, [
    autoTradeDraft,
    autoSideFilter,
    autoMinConfidence,
    autoMinWinRate,
    autoMinRR,
    autoMaxSpreadPointsSetting,
    autoCooldownMin,
    autoMaxOpenTrades,
    autoRequireStrongSignal,
    autoEnforceTrendStack,
    autoEnforceSymbolCooldown,
    autoEnforceDailyLossLimit,
    autoEnforceHardRiskBlock,
    autoStrategyMode,
    autoScalpAggressive,
    autoSessionGateEnabled,
    autoEntryTimeframe,
    autoReentryMode,
    autoTradeTimeframeOverride,
    autoEntryMode,
    autoAllowMarketFallback,
    autoFallbackMinConfidence,
    autoFallbackRrBuffer,
    autoBotLots,
    autoRiskMode,
    autoUseDynamicLot,
    autoRiskPct,
    autoRiskUsd,
    autoRiskGuardMult,
    autoMinSlPoints,
    autoAtrBufferMult,
    autoDynamicMinLot,
    autoDynamicLotStep,
  ]);
  const [autoTradeBusy, setAutoTradeBusy] = useState(false);
  const [autoTradeStatus, setAutoTradeStatus] = useState("");
  const [autoTradeLogs, setAutoTradeLogs] = useState<AutoTradeLogEntry[]>([]);
  const [botExecutionAuditLogs, setBotExecutionAuditLogs] = useState<BotExecutionAuditLogEntry[]>([]);
  const [headlessRuntimeStatus, setHeadlessRuntimeStatus] = useState<HeadlessRuntimeStatus>(
    HEADLESS_RUNTIME_STATUS_DEFAULT
  );
  const [headlessSyncBusy, setHeadlessSyncBusy] = useState(false);
  const [settingsBundleBusy, setSettingsBundleBusy] = useState(false);
  const [showAutoTradeLogs, setShowAutoTradeLogs] = useState(false);
  const [protectEnabled, setProtectEnabled] = useState(true);
  const [protectTimeframe, setProtectTimeframe] = useState<ChartTimeframe>("M15");
  const [protectAtrPeriod, setProtectAtrPeriod] = useState("14");
  const [protectAtrMult, setProtectAtrMult] = useState("2.0");
  const [protectLookback, setProtectLookback] = useState("14");
  const [protectMinStopPoints, setProtectMinStopPoints] = useState("30");
  const [protectGraceMin, setProtectGraceMin] = useState("1");
  const [protectBreakEvenEnabled, setProtectBreakEvenEnabled] = useState(true);
  const [protectBreakEvenR, setProtectBreakEvenR] = useState("1.0");
  const [protectBreakEvenProfitUsd, setProtectBreakEvenProfitUsd] = useState(HEADLESS_OVERNIGHT_BREAK_EVEN_PROFIT_USD);
  const [protectDegradeCloseEnabled, setProtectDegradeCloseEnabled] = useState(false);
  const [protectDegradeMinConfidence, setProtectDegradeMinConfidence] = useState("82");
  const [protectBiasFlipProfitLockEnabled, setProtectBiasFlipProfitLockEnabled] = useState(true);
  const [protectBiasFlipTpProgressPct, setProtectBiasFlipTpProgressPct] = useState(HEADLESS_BIAS_FLIP_TP_PROGRESS_PCT);
  const [protectOvernightProfitRetraceLockEnabled, setProtectOvernightProfitRetraceLockEnabled] = useState(true);
  const [protectOvernightProfitRetraceArmUsd, setProtectOvernightProfitRetraceArmUsd] = useState(
    HEADLESS_OVERNIGHT_RETRACE_ARM_USD
  );
  const [protectOvernightProfitRetraceCloseUsd, setProtectOvernightProfitRetraceCloseUsd] = useState(
    HEADLESS_OVERNIGHT_RETRACE_CLOSE_USD
  );
  const [protectOvernightEnabled, setProtectOvernightEnabled] = useState(false);
  const [protectOvernightProfitUsd, setProtectOvernightProfitUsd] = useState(HEADLESS_OVERNIGHT_TARGET_PROFIT_USD);
  const [protectOvernightLossUsd, setProtectOvernightLossUsd] = useState(HEADLESS_OVERNIGHT_LOSS_USD);
  const [protectStatus, setProtectStatus] = useState("");
  const [showTradeSettings, setShowTradeSettings] = useState(false);
  const [showRiskCalcModule, setShowRiskCalcModule] = useState(false);
  const [showManualOrderSection, setShowManualOrderSection] = useState(false);
  const protectBusyRef = useRef(false);
  const overnightProfitRetraceStateRef = useRef<Record<number, { armed: boolean; peakProfitUsd: number }>>({});
  const settingsImportInputRef = useRef<HTMLInputElement | null>(null);
  const tradeCommandBusyRef = useRef(false);
  const policyRunSeqRef = useRef(0);
  const runPolicyDiagnosticsRef = useRef<() => Promise<void>>(async () => {});
  const checkOrderDuplicate = (payload: Record<string, unknown>): string | null => {
    try {
      const dedup = getGlobalDeduplicator();
      const symbol = String(payload.symbol || "");
      const action = String(payload.action || "");
      const side = payload.side ? String(payload.side) : undefined;
      const price = payload.price ? Number(payload.price) : undefined;

      const reason = dedup.canPlaceOrder(symbol, action, side, price);
      if (reason) {
        console.warn("Order blocked (duplicate):", reason);
        return reason;
      }

      return null;
    } catch (e) {
      console.error("Error checking order duplicate:", e);
      return null;
    }
  };
  const registerOrderExecution = (payload: Record<string, unknown>): void => {
    try {
      const dedup = getGlobalDeduplicator();
      const symbol = String(payload.symbol || "");
      const action = String(payload.action || "");
      const side = payload.side ? String(payload.side) : undefined;
      const price = payload.price ? Number(payload.price) : undefined;

      dedup.registerOrder(symbol, action, side, price);
    } catch (e) {
      console.error("Error registering order:", e);
    }
  };
  const clearRegisteredOrder = (payload: Record<string, unknown>): void => {
    try {
      const dedup = getGlobalDeduplicator();
      const symbol = String(payload.symbol || "");
      const action = String(payload.action || "");
      const side = payload.side ? String(payload.side) : undefined;
      const price = payload.price ? Number(payload.price) : undefined;
      if (!symbol || !action) return;
      const parts = [symbol, action, side || "", price || ""].filter(Boolean);
      dedup.clearOrder(symbol, parts.join(":").toLowerCase());
    } catch (e) {
      console.error("Error clearing registered order:", e);
    }
  };
  const [policyBusy, setPolicyBusy] = useState(false);
  const [policyByPanel, setPolicyByPanel] = useState<Record<string, PanelPolicyDiagnostics>>({});
  const [autoEligibilityByPanel, setAutoEligibilityByPanel] = useState<Record<string, PanelAutoEligibility>>({});
  const [policyClockMs, setPolicyClockMs] = useState(Date.now());
  const [, setPolicyEvents] = useState<Mt4PolicyEvent[]>([]);
  const blockedBySideSummary = useMemo(() => {
    const acc: Record<"BUY" | "SELL", { total: number; blocked: number; reasons: Record<string, number> }> = {
      BUY: { total: 0, blocked: 0, reasons: {} },
      SELL: { total: 0, blocked: 0, reasons: {} },
    };
    Object.values(autoEligibilityByPanel).forEach((item) => {
      const side = item.intendedSide;
      if (side !== "BUY" && side !== "SELL") return;
      acc[side].total += 1;
      if (!item.eligible) {
        acc[side].blocked += 1;
        const reason = String(item.reason || "Blocked").trim();
        const key = reason.length > 120 ? `${reason.slice(0, 117)}...` : reason;
        acc[side].reasons[key] = (acc[side].reasons[key] || 0) + 1;
      }
    });
    const topReasons = (side: "BUY" | "SELL") =>
      Object.entries(acc[side].reasons)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
    return {
      BUY: { total: acc.BUY.total, blocked: acc.BUY.blocked, topReasons: topReasons("BUY") },
      SELL: { total: acc.SELL.total, blocked: acc.SELL.blocked, topReasons: topReasons("SELL") },
    };
  }, [autoEligibilityByPanel]);
  const [symbolSpec, setSymbolSpec] = useState<{
    symbol: string;
    lotSize: number;
    digits: number;
    point: number;
    tickValue: number;
    tickSize: number;
  } | null>(null);
  const [riskSettingsPreview, setRiskSettingsPreview] = useState<RiskSettingsPreview | null>(null);
  const [riskPreviewPanelIndex, setRiskPreviewPanelIndex] = useState(0);
  const [panelAnalysis, setPanelAnalysis] = useState<
    Record<
      string,
      {
        priceData: PriceData | null;
        tradeSignal: TradeSignal | null;
      }
    >
  >({});
  const [livePanelQuotes, setLivePanelQuotes] = useState<
    Record<string, { bid: number; ask: number; mid: number; time: number }>
  >({});
  const [panelStrategyIndicators, setPanelStrategyIndicators] = useState<Record<string, PanelStrategyIndicators | null>>({});
  const [watchlistBoard, setWatchlistBoard] = useState<Record<string, WatchlistBoardEntry>>({});
  const [watchlistBoardLoading, setWatchlistBoardLoading] = useState(false);
  const [watchlistBoardUpdatedAtMs, setWatchlistBoardUpdatedAtMs] = useState(0);
  const [watchlistBoardTimeframe, setWatchlistBoardTimeframe] = useState<ChartTimeframe>("M15");
  const [watchlistBoardTypeFilter, setWatchlistBoardTypeFilter] = useState<WatchlistBoardTypeFilter>("ALL");
  const [watchlistBoardNameFilter, setWatchlistBoardNameFilter] = useState("");
  const [panelLoading, setPanelLoading] = useState<Record<string, boolean>>({});
  const [autoTradeLoaded, setAutoTradeLoaded] = useState(false);
  const [adaptiveLearningEnabled, setAdaptiveLearningEnabled] = useState(true);
  const [learnedBlockedSymbols, setLearnedBlockedSymbols] = useState<string[]>([]);
  const [learnedBlockedSessions, setLearnedBlockedSessions] = useState<AdaptiveSessionKey[]>([]);
  const [adaptiveLearningLoaded, setAdaptiveLearningLoaded] = useState(false);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const effectiveCooldownMin = useMemo(() => {
    const parsed = Number(autoCooldownMin);
    if (!Number.isFinite(parsed)) return 15;
    return Math.max(1, Math.min(1440, Math.round(parsed)));
  }, [autoCooldownMin]);
  const effectiveMaxOpenTrades = useMemo(() => Number(sanitizeMaxOpenTrades(autoMaxOpenTrades, 1)), [autoMaxOpenTrades]);
  const analyzeBusyRef = useRef(false);
  const watchlistBoardBusyRef = useRef(false);
  const watchlistBoardRunSeqRef = useRef(0);
  const mt4BridgeBase = String(import.meta.env.VITE_MT4_BRIDGE_URL || "/api/mt4").replace(/\/+$/, "");
  const [bridgeVersionCheck, setBridgeVersionCheck] = useState<BridgeVersionCheck>({
    status: "checking",
    message: "Checking bridge...",
    version: "",
    capabilities: [],
    checkedAtMs: Date.now(),
  });
  const [headlessRuntimeConfig, setHeadlessRuntimeConfig] = useState<Record<string, unknown> | null>(null);
  const isHeadlessMode = autoRuntimeMode === "HEADLESS";
  const activeAutoTradeLogs = isHeadlessMode ? headlessRuntimeStatus.logs : autoTradeLogs;
  const activeBotExecutionAuditLogs = isHeadlessMode ? headlessRuntimeStatus.auditLogs : botExecutionAuditLogs;
  const autoTradeStatusDisplay = isHeadlessMode
    ? headlessRuntimeStatus.autoStatus || autoTradeStatus
    : autoTradeStatus;
  const protectStatusDisplay = isHeadlessMode
    ? headlessRuntimeStatus.protectStatus || protectStatus
    : protectStatus;

  const resolvePanelEntryMode = (symbol: string, timeframe: ChartTimeframe): AutoEntryMode => {
    if (!isHeadlessMode) return autoEntryMode;
    const config = headlessRuntimeConfig;
    if (!config || typeof config !== "object") return autoEntryMode;

    const watchlist = Array.isArray((config as { watchlist?: unknown }).watchlist)
      ? ((config as { watchlist: Array<Record<string, unknown>> }).watchlist || [])
      : [];
    const isManagedPanel = watchlist.some(
      (item) =>
        normalizeSymbol(String(item.symbol || "")) === normalizeSymbol(symbol) &&
        String(item.timeframe || "").toUpperCase() === timeframe
    );
    if (!isManagedPanel) return autoEntryMode;

    const symbolProfiles = Array.isArray((config as { symbolProfiles?: unknown }).symbolProfiles)
      ? ((config as { symbolProfiles: Array<Record<string, unknown>> }).symbolProfiles || [])
      : [];
    const symbolProfile = symbolProfiles.find(
      (item) => normalizeSymbol(String(item.symbol || "")) === normalizeSymbol(symbol)
    );
    const profileEntryMode = String(
      (symbolProfile?.auto as { entryMode?: unknown } | undefined)?.entryMode || ""
    ).toUpperCase();
    if (profileEntryMode === "LIMIT_SR" || profileEntryMode === "MARKET") {
      return profileEntryMode as AutoEntryMode;
    }

    const baseEntryMode = String(
      ((config as { auto?: { entryMode?: unknown } }).auto?.entryMode || "")
    ).toUpperCase();
    return baseEntryMode === "LIMIT_SR" ? "LIMIT_SR" : "MARKET";
  };

  const getManagedRuntimeProfile = (symbol: "GOLD" | "ETHUSD") => {
    const normalizeManagedSymbol = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const config = headlessRuntimeConfig;
    if (!config || typeof config !== "object") return null;
    const symbolProfiles = Array.isArray((config as { symbolProfiles?: unknown }).symbolProfiles)
      ? ((config as { symbolProfiles: Array<Record<string, unknown>> }).symbolProfiles || [])
      : [];
    const profile = symbolProfiles.find(
      (item) => normalizeManagedSymbol(String(item.symbol || "")) === normalizeManagedSymbol(symbol)
    );
    if (!profile) return null;
    return {
      auto: typeof profile.auto === "object" && profile.auto ? (profile.auto as Record<string, unknown>) : null,
      protect:
        typeof profile.protect === "object" && profile.protect
          ? (profile.protect as Record<string, unknown>)
          : null,
    };
  };

  const buildManagedSymbolTradeDraft = (
    symbol: ManagedSymbol,
    sourceConfig?: Record<string, unknown> | null
  ): ManagedSymbolTradeDraft => {
    const config =
      sourceConfig && typeof sourceConfig === "object"
        ? sourceConfig
        : ({ symbolProfiles: [] } as Record<string, unknown>);
    const symbolProfiles = Array.isArray((config as { symbolProfiles?: unknown }).symbolProfiles)
      ? ((config as { symbolProfiles: Array<Record<string, unknown>> }).symbolProfiles || [])
      : [];
    const normalizeManagedSymbol = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const symbolProfile = symbolProfiles.find(
      (item) => normalizeManagedSymbol(String(item.symbol || "")) === normalizeManagedSymbol(symbol)
    );
    const auto = typeof symbolProfile?.auto === "object" && symbolProfile.auto
      ? (symbolProfile.auto as Record<string, unknown>)
      : {};

    return {
      sideFilter: (String(auto.sideFilter || (symbol === "ETHUSD" ? "BOTH" : autoSideFilter)).toUpperCase() as AutoSideFilter),
      minConfidence: String(auto.minConfidence ?? (symbol === "ETHUSD" ? 30 : autoMinConfidence)),
      minWinRate: String(auto.minWinRate ?? (symbol === "ETHUSD" ? 0 : autoMinWinRate)),
      minRR: String(auto.minRR ?? (symbol === "ETHUSD" ? 1.0 : autoMinRR)),
      maxSpreadPoints: String(auto.maxSpreadPoints ?? (symbol === "ETHUSD" ? 120 : autoMaxSpreadPointsSetting)),
      cooldownMin: String(auto.cooldownMin ?? (symbol === "ETHUSD" ? 45 : autoCooldownMin)),
      maxOpenTrades: String(auto.maxOpenTrades ?? (symbol === "ETHUSD" ? 2 : sanitizeMaxOpenTrades(autoMaxOpenTrades, 1))),
      requireStrong: Boolean(auto.requireStrong ?? (symbol === "ETHUSD" ? false : autoRequireStrongSignal)),
      enforceSymbolCooldown: Boolean(auto.enforceSymbolCooldown ?? true),
      enforceDailyLossLimit: Boolean(auto.enforceDailyLossLimit ?? autoEnforceDailyLossLimit),
      enforceHardRiskBlock: Boolean(auto.enforceHardRiskBlock ?? (symbol === "ETHUSD" ? true : autoEnforceHardRiskBlock)),
      entryTimeframe: (String(auto.entryTimeframe || (symbol === "ETHUSD" ? "M15" : "M5")).toUpperCase() as AutoEntryTiming),
      entryMode: String(auto.entryMode || "LIMIT_SR").toUpperCase() === "MARKET" ? "MARKET" : "LIMIT_SR",
      botLots: String(auto.botLots ?? autoBotLots),
      riskMode: String(auto.riskMode || autoRiskMode).toUpperCase() === "PCT" ? "PCT" : "USD",
      useDynamicLot: Boolean(auto.useDynamicLot ?? autoUseDynamicLot),
      riskPct: String(auto.riskPct ?? autoRiskPct),
      riskUsd: String(auto.riskUsd ?? autoRiskUsd),
      riskGuardMult: String(auto.riskGuardMult ?? autoRiskGuardMult),
      minSlPoints: String(auto.minSlPoints ?? (symbol === "ETHUSD" ? 120 : autoMinSlPoints)),
      atrBufferMult: String(auto.atrBufferMult ?? (symbol === "ETHUSD" ? 0.35 : autoAtrBufferMult)),
      minLot: String(auto.minLot ?? autoDynamicMinLot),
      lotStep: String(auto.lotStep ?? autoDynamicLotStep),
    };
  };

  const selectedManagedSymbolTradeDraft = managedSymbolTradeDrafts[selectedManagedSymbol];
  const appliedSelectedManagedSymbolTradeDraft = useMemo(
    () => buildManagedSymbolTradeDraft(selectedManagedSymbol, headlessRuntimeConfig),
    [
      selectedManagedSymbol,
      headlessRuntimeConfig,
      autoSideFilter,
      autoMinConfidence,
      autoMinWinRate,
      autoMinRR,
      autoMaxSpreadPointsSetting,
      autoCooldownMin,
      autoMaxOpenTrades,
      autoRequireStrongSignal,
      autoEnforceDailyLossLimit,
      autoEnforceHardRiskBlock,
      autoBotLots,
      autoRiskMode,
      autoUseDynamicLot,
      autoRiskPct,
      autoRiskUsd,
      autoRiskGuardMult,
      autoMinSlPoints,
      autoAtrBufferMult,
      autoDynamicMinLot,
      autoDynamicLotStep,
    ]
  );
  const updateSelectedManagedSymbolTradeDraft = (
    updater: ManagedSymbolTradeDraft | ((prev: ManagedSymbolTradeDraft) => ManagedSymbolTradeDraft)
  ) => {
    setManagedSymbolTradeDrafts((prev) => ({
      ...prev,
      [selectedManagedSymbol]:
        typeof updater === "function"
          ? (updater as (prev: ManagedSymbolTradeDraft) => ManagedSymbolTradeDraft)(prev[selectedManagedSymbol])
          : updater,
    }));
  };
  const selectedManagedSymbolWarnings = useMemo(() => {
    const warnings: string[] = [];
    const minConfidence = Number(selectedManagedSymbolTradeDraft.minConfidence);
    const minWinRate = Number(selectedManagedSymbolTradeDraft.minWinRate);
    const minRR = Number(selectedManagedSymbolTradeDraft.minRR);
    const maxSpreadPoints = Number(selectedManagedSymbolTradeDraft.maxSpreadPoints);
    const cooldownMin = Number(selectedManagedSymbolTradeDraft.cooldownMin);
    const maxOpenTrades = Number(selectedManagedSymbolTradeDraft.maxOpenTrades);
    const botLots = Number(selectedManagedSymbolTradeDraft.botLots);
    const riskPct = Number(selectedManagedSymbolTradeDraft.riskPct);
    const riskUsd = Number(selectedManagedSymbolTradeDraft.riskUsd);
    const minLot = Number(selectedManagedSymbolTradeDraft.minLot);
    const lotStep = Number(selectedManagedSymbolTradeDraft.lotStep);
    const minSlPoints = Number(selectedManagedSymbolTradeDraft.minSlPoints);
    const atrBufferMult = Number(selectedManagedSymbolTradeDraft.atrBufferMult);

    if (!Number.isFinite(minConfidence) || minConfidence < 0 || minConfidence > 100) warnings.push("Min Confidence % must be between 0 and 100.");
    if (!Number.isFinite(minWinRate) || minWinRate < 0 || minWinRate > 100) warnings.push("Min Win Rate % must be between 0 and 100.");
    if (!Number.isFinite(minRR) || minRR < 1) warnings.push("Min R:R must be at least 1.0.");
    if (!Number.isFinite(maxSpreadPoints) || maxSpreadPoints <= 0) warnings.push("Max Spread Points must be greater than 0.");
    if (!Number.isFinite(cooldownMin) || cooldownMin < 1) warnings.push("Cooldown must be at least 1 minute.");
    if (!Number.isFinite(maxOpenTrades) || maxOpenTrades < 1) warnings.push("Max Active Trades must be at least 1.");
    if (!Number.isFinite(botLots) || botLots <= 0) warnings.push("Default Bot Lots must be greater than 0.");
    if (selectedManagedSymbolTradeDraft.riskMode === "PCT" && (!Number.isFinite(riskPct) || riskPct <= 0)) warnings.push("Risk Per Trade % must be greater than 0.");
    if (selectedManagedSymbolTradeDraft.riskMode === "USD" && (!Number.isFinite(riskUsd) || riskUsd <= 0)) warnings.push("Risk Per Trade USD must be greater than 0.");
    if (!Number.isFinite(minLot) || minLot <= 0) warnings.push("Min Lot must be greater than 0.");
    if (!Number.isFinite(lotStep) || lotStep <= 0) warnings.push("Lot Step must be greater than 0.");
    if (!Number.isFinite(minSlPoints) || minSlPoints <= 0) warnings.push("Min Stop Points must be greater than 0.");
    if (!Number.isFinite(atrBufferMult) || atrBufferMult < 0) warnings.push("ATR Buffer must be >= 0.");

    return warnings;
  }, [selectedManagedSymbolTradeDraft]);
  const hasSelectedManagedSymbolUnappliedChanges = useMemo(
    () => JSON.stringify(selectedManagedSymbolTradeDraft) !== JSON.stringify(appliedSelectedManagedSymbolTradeDraft),
    [selectedManagedSymbolTradeDraft, appliedSelectedManagedSymbolTradeDraft]
  );

  const managedSetupCards = (["GOLD", "ETHUSD"] as const).map((symbol) => {
    const runtimeProfile = getManagedRuntimeProfile(symbol);
    const autoProfile = runtimeProfile?.auto;
    const protectProfile = runtimeProfile?.protect;
    const isGold = symbol === "GOLD";
    const timeframe = isGold ? "M5" : "M15";
    const sideFilterRaw = String(
      autoProfile?.sideFilter || (isGold ? autoTradeDraft.sideFilter : "BOTH")
    ).toUpperCase();
    const sideFilterLabel =
      sideFilterRaw === "BUY_ONLY" ? "Buy only" : sideFilterRaw === "SELL_ONLY" ? "Sell only" : "Both sides";
    const minConfidence = Number(
      autoProfile?.minConfidence ?? (isGold ? autoTradeDraft.minConfidence : 30)
    );
    const minWinRate = Number(
      autoProfile?.minWinRate ?? (isGold ? autoTradeDraft.minWinRate : 0)
    );
    const minRR = Number(autoProfile?.minRR ?? (isGold ? autoTradeDraft.minRR : 1.0));
    const cooldownMin = Number(
      autoProfile?.cooldownMin ?? (isGold ? autoTradeDraft.cooldownMin : 45)
    );
    const maxSpreadPoints = Number(
      autoProfile?.maxSpreadPoints ?? (isGold ? autoTradeDraft.maxSpreadPoints : 120)
    );
    const requireStrong = Boolean(
      autoProfile?.requireStrong ?? (isGold ? autoTradeDraft.requireStrong : false)
    );
    const entryMode = String(autoProfile?.entryMode || "LIMIT_SR").toUpperCase() === "MARKET" ? "MARKET" : "LIMIT_SR";
    const minSlPoints = Number(
      autoProfile?.minSlPoints ?? (isGold ? autoTradeDraft.minSlPoints : 120)
    );
    const atrBufferMult = Number(
      autoProfile?.atrBufferMult ?? (isGold ? autoTradeDraft.atrBufferMult : 0.35)
    );
    const hardRiskBlock = Boolean(
      autoProfile?.enforceHardRiskBlock ?? (isGold ? autoTradeDraft.enforceHardRiskBlock : true)
    );
    const symbolCooldown = Boolean(
      autoProfile?.enforceSymbolCooldown ?? (isGold ? autoTradeDraft.enforceSymbolCooldown : true)
    );
    const overnightEnabled = Boolean(protectProfile?.overnightEnabled ?? (isGold ? protectOvernightEnabled : false));
    const breakEvenEnabled = Boolean(protectProfile?.breakEvenEnabled ?? protectBreakEvenEnabled);
    const breakEvenProfitUsd = Number(protectProfile?.breakEvenProfitUsd ?? protectBreakEvenProfitUsd);
    const degradeCloseEnabled = Boolean(protectProfile?.degradeCloseEnabled ?? protectDegradeCloseEnabled);
    const newsFilterEnabled = Boolean(autoProfile?.highImpactNewsFilterEnabled ?? isGold);
    const ma200FlatEnabled = Boolean(autoProfile?.ma200FlatFilterEnabled ?? isGold);
    const biasPath = isGold ? "H4 -> H1 -> M5" : "H4 -> H1 -> M15";
    const title = isGold ? "GOLD M5" : "ETHUSD M15";
    const description = isGold ? "Overnight metal pullback" : "Crypto trend pullback";
    const accent = isGold
      ? {
          border: "border-amber-500/40",
          bg: "bg-amber-500/10",
          title: "text-amber-200",
          text: "text-amber-100",
          pill: "border-amber-400/40 bg-amber-400/10 text-amber-100",
        }
      : {
          border: "border-cyan-500/40",
          bg: "bg-cyan-500/10",
          title: "text-cyan-200",
          text: "text-cyan-100",
          pill: "border-cyan-400/40 bg-cyan-400/10 text-cyan-100",
        };

    return {
      symbol,
      title,
      description,
      timeframe,
      sideFilterLabel,
      minConfidence,
      minWinRate,
      minRR,
      cooldownMin,
      maxSpreadPoints,
      requireStrong,
      entryMode,
      minSlPoints,
      atrBufferMult,
      hardRiskBlock,
      symbolCooldown,
      overnightEnabled,
      breakEvenEnabled,
      breakEvenProfitUsd,
      degradeCloseEnabled,
      newsFilterEnabled,
      ma200FlatEnabled,
      biasPath,
      accent,
      notes: isGold
        ? "Uses stricter metal filters, news blackout, and overnight profit/loss protection."
        : "Uses looser ETH thresholds, both-side trading, and no overnight auto-close profile.",
    };
  });

  const buildHeadlessConfigPayload = () => ({
    watchlist: HEADLESS_MANAGED_PRESET.map((item) => ({
      symbol: item.symbol,
      timeframe: item.timeframe,
    })),
    auto: {
      enabled: autoTradeEnabled,
      sideFilter: autoSideFilter,
      minConfidence: Number(autoMinConfidence),
      minWinRate: Number(autoMinWinRate),
      minRR: Number(autoMinRR),
      maxSpreadPoints: Number(autoMaxSpreadPointsSetting),
      cooldownMin: effectiveCooldownMin,
      maxOpenTrades: Math.max(2, effectiveMaxOpenTrades),
      requireStrong: autoRequireStrongSignal,
      enforceTrendStack: autoEnforceTrendStack,
      enforceSymbolCooldown: autoEnforceSymbolCooldown,
      enforceDailyLossLimit: autoEnforceDailyLossLimit,
      enforceHardRiskBlock: autoEnforceHardRiskBlock,
      strategyMode: autoStrategyMode,
      scalpAggressive: autoScalpAggressive,
      sessionGateEnabled: autoSessionGateEnabled,
      biasTimeframe: AUTO_BIAS_TIMEFRAME,
      setupTimeframe: AUTO_SETUP_TIMEFRAME,
      entryTimeframe: autoEntryTimeframe,
      reentryMode: autoReentryMode,
      timeframeOverride: autoTradeTimeframeOverride,
      entryMode: autoEntryMode,
      allowMarketFallback: autoAllowMarketFallback,
      fallbackMinConfidence: Number(autoFallbackMinConfidence),
      fallbackRrBuffer: Number(autoFallbackRrBuffer),
      botLots: Number(autoBotLots),
      riskMode: autoRiskMode,
      useDynamicLot: autoUseDynamicLot,
      riskPct: Number(autoRiskPct),
      riskUsd: Number(autoRiskUsd),
      riskGuardMult: Number(autoRiskGuardMult),
      minSlPoints: Number(autoMinSlPoints),
      atrBufferMult: Number(autoAtrBufferMult),
      minLot: Number(autoDynamicMinLot),
      lotStep: Number(autoDynamicLotStep),
      ma200FlatFilterEnabled: true,
      ma200FlatMaxAtrRatio: HEADLESS_MA200_FLAT_MAX_ATR_RATIO,
      highImpactNewsFilterEnabled: true,
      highImpactNewsLookbackMin: HEADLESS_HIGH_IMPACT_NEWS_LOOKBACK_MIN,
      highImpactNewsKeywords: HEADLESS_HIGH_IMPACT_NEWS_KEYWORDS,
      adaptiveLearningEnabled,
      learnedBlockedSymbols,
      learnedBlockedSessions,
      commentTag: "managed-dual-core",
    },
    symbolProfiles: [
      {
        symbol: "GOLD",
        auto: {
          enabled: autoTradeEnabled,
          sideFilter: autoSideFilter,
          minConfidence: Number(autoMinConfidence),
          minWinRate: Number(autoMinWinRate),
          minRR: Number(autoMinRR),
          maxSpreadPoints: Number(autoMaxSpreadPointsSetting),
          cooldownMin: effectiveCooldownMin,
          maxOpenTrades: Math.max(2, effectiveMaxOpenTrades),
          requireStrong: autoRequireStrongSignal,
          enforceTrendStack: autoEnforceTrendStack,
          enforceSymbolCooldown: autoEnforceSymbolCooldown,
          enforceDailyLossLimit: autoEnforceDailyLossLimit,
          enforceHardRiskBlock: autoEnforceHardRiskBlock,
          strategyMode: autoStrategyMode,
          scalpAggressive: autoScalpAggressive,
          sessionGateEnabled: autoSessionGateEnabled,
          entryTimeframe: "M5",
          timeframeOverride: "PANEL",
          entryMode: autoEntryMode,
          allowMarketFallback: autoAllowMarketFallback,
          fallbackMinConfidence: Number(autoFallbackMinConfidence),
          fallbackRrBuffer: Number(autoFallbackRrBuffer),
          botLots: Number(autoBotLots),
          riskMode: autoRiskMode,
          useDynamicLot: autoUseDynamicLot,
          riskPct: Number(autoRiskPct),
          riskUsd: Number(autoRiskUsd),
          riskGuardMult: Number(autoRiskGuardMult),
          minSlPoints: Number(autoMinSlPoints),
          atrBufferMult: Number(autoAtrBufferMult),
          minLot: Number(autoDynamicMinLot),
          lotStep: Number(autoDynamicLotStep),
          ma200FlatFilterEnabled: true,
          ma200FlatMaxAtrRatio: HEADLESS_MA200_FLAT_MAX_ATR_RATIO,
          highImpactNewsFilterEnabled: true,
          highImpactNewsLookbackMin: HEADLESS_HIGH_IMPACT_NEWS_LOOKBACK_MIN,
          highImpactNewsKeywords: HEADLESS_HIGH_IMPACT_NEWS_KEYWORDS,
          adaptiveLearningEnabled,
          learnedBlockedSymbols,
          learnedBlockedSessions,
          commentTag: "gold-overnight-scalp",
        },
        protect: {
          enabled: protectEnabled,
          timeframe: protectTimeframe,
          atrPeriod: Number(protectAtrPeriod),
          atrMult: Number(protectAtrMult),
          lookback: Number(protectLookback),
          minStopPoints: Number(protectMinStopPoints),
          graceMin: Number(protectGraceMin),
          breakEvenEnabled: protectBreakEvenEnabled,
          breakEvenR: Number(protectBreakEvenR),
          breakEvenProfitUsd: Number(protectBreakEvenProfitUsd),
          degradeCloseEnabled: protectDegradeCloseEnabled,
          degradeMinConfidence: Number(protectDegradeMinConfidence),
          biasFlipProfitLockEnabled: protectBiasFlipProfitLockEnabled,
          biasFlipTpProgressPct: Number(protectBiasFlipTpProgressPct),
          overnightProfitRetraceLockEnabled: protectOvernightProfitRetraceLockEnabled,
          overnightProfitRetraceArmUsd: Number(protectOvernightProfitRetraceArmUsd),
          overnightProfitRetraceCloseUsd: Number(protectOvernightProfitRetraceCloseUsd),
          overnightEnabled: protectOvernightEnabled,
          overnightProfitUsd: Number(protectOvernightProfitUsd),
          overnightLossUsd: Number(protectOvernightLossUsd),
        },
      },
      {
        symbol: "ETHUSD",
        auto: {
          enabled: autoTradeEnabled,
          sideFilter: "BOTH",
          minConfidence: 30,
          minWinRate: 0,
          minRR: 1.0,
          maxSpreadPoints: 120,
          cooldownMin: 45,
          maxOpenTrades: 2,
          requireStrong: false,
          enforceTrendStack: autoEnforceTrendStack,
          enforceSymbolCooldown: true,
          enforceDailyLossLimit: autoEnforceDailyLossLimit,
          enforceHardRiskBlock: true,
          strategyMode: autoStrategyMode,
          scalpAggressive: autoScalpAggressive,
          sessionGateEnabled: autoSessionGateEnabled,
          entryTimeframe: "M15",
          timeframeOverride: "PANEL",
          entryMode: "MARKET",
          allowMarketFallback: true,
          fallbackMinConfidence: 30,
          fallbackRrBuffer: 0.3,
          botLots: Number(autoBotLots),
          riskMode: autoRiskMode,
          useDynamicLot: autoUseDynamicLot,
          riskPct: Number(autoRiskPct),
          riskUsd: Number(autoRiskUsd),
          riskGuardMult: Number(autoRiskGuardMult),
          minSlPoints: 120,
          atrBufferMult: 0.35,
          minLot: Number(autoDynamicMinLot),
          lotStep: Number(autoDynamicLotStep),
          ma200FlatFilterEnabled: false,
          highImpactNewsFilterEnabled: false,
          adaptiveLearningEnabled: false,
          learnedBlockedSymbols: [],
          learnedBlockedSessions: [],
          commentTag: "eth-trend-pullback",
        },
        protect: {
          enabled: protectEnabled,
          timeframe: "M15",
          atrPeriod: Number(protectAtrPeriod),
          atrMult: Number(protectAtrMult),
          lookback: Number(protectLookback),
          minStopPoints: Number(protectMinStopPoints),
          graceMin: Number(protectGraceMin),
          breakEvenEnabled: protectBreakEvenEnabled,
          breakEvenR: Number(protectBreakEvenR),
          breakEvenProfitUsd: Number(protectBreakEvenProfitUsd),
          degradeCloseEnabled: protectDegradeCloseEnabled,
          degradeMinConfidence: Number(protectDegradeMinConfidence),
          biasFlipProfitLockEnabled: protectBiasFlipProfitLockEnabled,
          biasFlipTpProgressPct: Number(protectBiasFlipTpProgressPct),
          overnightProfitRetraceLockEnabled: false,
          overnightProfitRetraceArmUsd: Number(protectOvernightProfitRetraceArmUsd),
          overnightProfitRetraceCloseUsd: Number(protectOvernightProfitRetraceCloseUsd),
          overnightEnabled: false,
          overnightProfitUsd: Number(protectOvernightProfitUsd),
          overnightLossUsd: Number(protectOvernightLossUsd),
        },
      },
    ],
    protect: {
      enabled: protectEnabled,
      timeframe: protectTimeframe,
      atrPeriod: Number(protectAtrPeriod),
      atrMult: Number(protectAtrMult),
      lookback: Number(protectLookback),
      minStopPoints: Number(protectMinStopPoints),
      graceMin: Number(protectGraceMin),
      breakEvenEnabled: protectBreakEvenEnabled,
      breakEvenR: Number(protectBreakEvenR),
      breakEvenProfitUsd: Number(protectBreakEvenProfitUsd),
      degradeCloseEnabled: protectDegradeCloseEnabled,
      degradeMinConfidence: Number(protectDegradeMinConfidence),
      biasFlipProfitLockEnabled: protectBiasFlipProfitLockEnabled,
      biasFlipTpProgressPct: Number(protectBiasFlipTpProgressPct),
      overnightProfitRetraceLockEnabled: protectOvernightProfitRetraceLockEnabled,
      overnightProfitRetraceArmUsd: Number(protectOvernightProfitRetraceArmUsd),
      overnightProfitRetraceCloseUsd: Number(protectOvernightProfitRetraceCloseUsd),
      overnightEnabled: protectOvernightEnabled,
      overnightProfitUsd: Number(protectOvernightProfitUsd),
      overnightLossUsd: Number(protectOvernightLossUsd),
    },
  });

  const loadHeadlessStatus = async () => {
    try {
      const response = await fetch(`${mt4BridgeBase}/headless/status`, { method: "GET" });
      const data = await readResponseJsonSafe(response);
      if (!response.ok || !data?.ok || !data?.status) return;
      if (data.config && typeof data.config === "object") {
        setHeadlessRuntimeConfig(data.config as Record<string, unknown>);
      }
      setHeadlessRuntimeStatus({
        autoEnabled: Boolean(data.status.autoEnabled),
        protectEnabled: Boolean(data.status.protectEnabled),
        protectOvernightEnabled: Boolean(data.status.protectOvernightEnabled),
        overnightLossStopActive: Boolean(data.status.overnightLossStopActive),
        overnightConsecutiveLosses: Number(data.status.overnightConsecutiveLosses || 0),
        overnightMaxConsecutiveLosses: Number(data.status.overnightMaxConsecutiveLosses || 3),
        overnightLossStopReason: String(data.status.overnightLossStopReason || ""),
        overnightLossStopAtMs: Number(data.status.overnightLossStopAtMs || 0),
        autoBusy: Boolean(data.status.autoBusy),
        protectBusy: Boolean(data.status.protectBusy),
        commandBusy: Boolean(data.status.commandBusy),
        autoRunning: Boolean(data.status.autoRunning),
        protectRunning: Boolean(data.status.protectRunning),
        autoStatus: String(data.status.autoStatus || ""),
        protectStatus: String(data.status.protectStatus || ""),
        lastAutoRunAtMs: Number(data.status.lastAutoRunAtMs || 0),
        lastAutoCompletedAtMs: Number(data.status.lastAutoCompletedAtMs || 0),
        lastProtectRunAtMs: Number(data.status.lastProtectRunAtMs || 0),
        lastProtectCompletedAtMs: Number(data.status.lastProtectCompletedAtMs || 0),
        logs: Array.isArray(data.status.logs) ? (data.status.logs as AutoTradeLogEntry[]) : [],
        auditLogs: Array.isArray(data.status.auditLogs)
          ? (data.status.auditLogs as BotExecutionAuditLogEntry[])
          : [],
      });
    } catch {
      // headless status is optional while bridge is restarting
    }
  };

  const syncHeadlessConfig = async (payload: ReturnType<typeof buildHeadlessConfigPayload>) => {
    setHeadlessSyncBusy(true);
    try {
      const response = await fetch(`${mt4BridgeBase}/headless/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await readResponseJsonSafe(response);
      if (!response.ok || !data?.ok || !data?.status) {
        throw new Error(String(data?.error || "Headless config sync failed"));
      }
      if (data.config && typeof data.config === "object") {
        setHeadlessRuntimeConfig(data.config as Record<string, unknown>);
      }
      setHeadlessRuntimeStatus({
        autoEnabled: Boolean(data.status.autoEnabled),
        protectEnabled: Boolean(data.status.protectEnabled),
        protectOvernightEnabled: Boolean(data.status.protectOvernightEnabled),
        overnightLossStopActive: Boolean(data.status.overnightLossStopActive),
        overnightConsecutiveLosses: Number(data.status.overnightConsecutiveLosses || 0),
        overnightMaxConsecutiveLosses: Number(data.status.overnightMaxConsecutiveLosses || 3),
        overnightLossStopReason: String(data.status.overnightLossStopReason || ""),
        overnightLossStopAtMs: Number(data.status.overnightLossStopAtMs || 0),
        autoBusy: Boolean(data.status.autoBusy),
        protectBusy: Boolean(data.status.protectBusy),
        commandBusy: Boolean(data.status.commandBusy),
        autoRunning: Boolean(data.status.autoRunning),
        protectRunning: Boolean(data.status.protectRunning),
        autoStatus: String(data.status.autoStatus || ""),
        protectStatus: String(data.status.protectStatus || ""),
        lastAutoRunAtMs: Number(data.status.lastAutoRunAtMs || 0),
        lastAutoCompletedAtMs: Number(data.status.lastAutoCompletedAtMs || 0),
        lastProtectRunAtMs: Number(data.status.lastProtectRunAtMs || 0),
        lastProtectCompletedAtMs: Number(data.status.lastProtectCompletedAtMs || 0),
        logs: Array.isArray(data.status.logs) ? (data.status.logs as AutoTradeLogEntry[]) : [],
        auditLogs: Array.isArray(data.status.auditLogs)
          ? (data.status.auditLogs as BotExecutionAuditLogEntry[])
          : [],
      });
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Headless config sync failed";
      setAutoTradeStatus(message);
      return { ok: false as const, error: message };
    } finally {
      setHeadlessSyncBusy(false);
    }
  };

  const readSettingsBundleHeadlessConfig = async (): Promise<Record<string, unknown> | null> => {
    try {
      const response = await fetch(`${mt4BridgeBase}/headless/status`, { method: "GET" });
      const data = await readResponseJsonSafe(response);
      if (response.ok && data?.ok && data?.config && typeof data.config === "object") {
        return data.config as Record<string, unknown>;
      }
    } catch {
      // fall back to the current UI payload when the bridge is unavailable
    }
    return buildHeadlessConfigPayload() as unknown as Record<string, unknown>;
  };

  const applySelectedManagedSymbolSettings = async () => {
    const draft = managedSymbolTradeDrafts[selectedManagedSymbol];
    const warnings = selectedManagedSymbolWarnings;
    if (warnings.length > 0) {
      setAutoTradeStatus(`${selectedManagedSymbol} settings need attention before sync.`);
      return;
    }
    const payload = JSON.parse(JSON.stringify(headlessRuntimeConfig ?? buildHeadlessConfigPayload())) as {
      symbolProfiles?: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const symbolProfiles = Array.isArray(payload.symbolProfiles) ? payload.symbolProfiles : [];
    const targetIndex = symbolProfiles.findIndex(
      (item) => normalizeSymbol(String(item.symbol || "")) === normalizeSymbol(selectedManagedSymbol)
    );
    if (targetIndex < 0) {
      setAutoTradeStatus(`Unable to find ${selectedManagedSymbol} profile in headless config.`);
      return;
    }

    const currentProfile = symbolProfiles[targetIndex];
    symbolProfiles[targetIndex] = {
      ...currentProfile,
      auto: {
        ...(currentProfile.auto || {}),
        sideFilter: draft.sideFilter,
        minConfidence: Number(draft.minConfidence),
        minWinRate: Number(draft.minWinRate),
        minRR: Number(draft.minRR),
        maxSpreadPoints: Number(draft.maxSpreadPoints),
        cooldownMin: Number(draft.cooldownMin),
        maxOpenTrades: Number(draft.maxOpenTrades),
        requireStrong: draft.requireStrong,
        enforceSymbolCooldown: draft.enforceSymbolCooldown,
        enforceDailyLossLimit: draft.enforceDailyLossLimit,
        enforceHardRiskBlock: draft.enforceHardRiskBlock,
        entryTimeframe: draft.entryTimeframe,
        entryMode: draft.entryMode,
        botLots: Number(draft.botLots),
        riskMode: draft.riskMode,
        useDynamicLot: draft.useDynamicLot,
        riskPct: Number(draft.riskPct),
        riskUsd: Number(draft.riskUsd),
        riskGuardMult: Number(draft.riskGuardMult),
        minSlPoints: Number(draft.minSlPoints),
        atrBufferMult: Number(draft.atrBufferMult),
        minLot: Number(draft.minLot),
        lotStep: Number(draft.lotStep),
      },
    };
    payload.symbolProfiles = symbolProfiles;

    const result = await syncHeadlessConfig(payload as ReturnType<typeof buildHeadlessConfigPayload>);
    if (!result.ok) return;
    setAutoTradeStatus(`${selectedManagedSymbol} trading settings saved and applied.`);
  };

  const exportSettingsBundle = async () => {
    if (typeof window === "undefined") return;
    setSettingsBundleBusy(true);
    try {
      const localSettings = Object.fromEntries(
        SETTINGS_BUNDLE_LOCAL_STORAGE_KEYS.map((key) => [key, window.localStorage.getItem(key)])
      );
      const bundle: SettingsBundle = {
        version: SETTINGS_BUNDLE_VERSION,
        exportedAt: new Date().toISOString(),
        app: "Trading-App",
        localSettings,
        headlessConfig: await readSettingsBundleHeadlessConfig(),
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      const stamp = bundle.exportedAt.replace(/[:.]/g, "-");
      link.href = downloadUrl;
      link.download = `trading-settings-bundle-${stamp}.json`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setAutoTradeStatus("Settings bundle exported.");
    } catch (error) {
      setAutoTradeStatus(error instanceof Error ? error.message : "Failed to export settings bundle");
    } finally {
      setSettingsBundleBusy(false);
    }
  };

  const importSettingsBundle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || typeof window === "undefined") return;

    setSettingsBundleBusy(true);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as Partial<SettingsBundle>;
      if (!parsed || typeof parsed !== "object" || typeof parsed.localSettings !== "object" || !parsed.localSettings) {
        throw new Error("Invalid settings bundle");
      }

      for (const key of SETTINGS_BUNDLE_LOCAL_STORAGE_KEYS) {
        const value = parsed.localSettings[key];
        if (typeof value === "string") {
          window.localStorage.setItem(key, value);
        } else {
          window.localStorage.removeItem(key);
        }
      }

      if (parsed.headlessConfig && typeof parsed.headlessConfig === "object") {
        const syncResult = await syncHeadlessConfig(
          parsed.headlessConfig as ReturnType<typeof buildHeadlessConfigPayload>
        );
        if (!syncResult.ok) {
          throw new Error(syncResult.error || "Headless config sync failed during import");
        }
      }

      window.alert("Settings bundle imported. The page will reload to apply the imported values.");
      window.location.reload();
    } catch (error) {
      setAutoTradeStatus(error instanceof Error ? error.message : "Failed to import settings bundle");
    } finally {
      setSettingsBundleBusy(false);
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setInterval(() => setPolicyClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    const healthUrl = getBridgeHealthUrl(mt4BridgeBase);

    const buildHealthCandidates = (url: string): string[] => {
      const candidates = new Set<string>();
      candidates.add(url);

      // Add root /health fallback (older bridge versions only exposed this).
      const rootHealth = `${url.replace(/(\/api\/mt4)?\/health\/?$/i, "")}/health`;
      candidates.add(rootHealth);

      // Add /api/mt4/health fallback (newer bridge versions expose this).
      const apiHealth = url.replace(/\/health\/?$/i, "/api/mt4/health");
      candidates.add(apiHealth);

       // Add direct localhost bridge port fallback to bypass dev proxy issues.
       const bridgePort =
         Number((import.meta.env.VITE_MT5_BRIDGE_PORT as string | undefined) || 8787) || 8787;
       candidates.add(`http://localhost:${bridgePort}/health`);
       candidates.add(`http://127.0.0.1:${bridgePort}/health`);

      return Array.from(candidates);
    };

    const runCheck = async (markChecking = false) => {
      if (markChecking && active) {
        setBridgeVersionCheck((prev) => ({
          ...prev,
          status: "checking",
          message: "Checking bridge...",
          checkedAtMs: Date.now(),
        }));
      }

      const candidates = buildHealthCandidates(healthUrl);
      let lastStatus: number | null = null;
      let lastError = "";

      for (const url of candidates) {
        try {
          const response = await fetch(url, { method: "GET" });
          const data = await readResponseJsonSafe(response);
          if (!active) return;

          if (response.ok && data?.ok) {
            const version = String(data?.bridge_version || data?.version || "").trim();
            const capabilities = Array.isArray(data?.capabilities)
              ? data.capabilities.map((item: unknown) => String(item || "").trim()).filter(Boolean)
              : [];
            const capabilitySet = new Set(capabilities);
            const missing = REQUIRED_BRIDGE_CAPABILITIES.filter((feature) => !capabilitySet.has(feature));
            if (missing.length > 0) {
              setBridgeVersionCheck({
                status: "outdated",
                message: `Missing capability: ${missing.join(", ")}`,
                version: version || "legacy",
                capabilities,
                checkedAtMs: Date.now(),
              });
              return;
            }

            setBridgeVersionCheck({
              status: "ok",
              message: version ? `Bridge ${version}` : "Bridge ready",
              version: version || "unknown",
              capabilities,
              checkedAtMs: Date.now(),
            });
            return;
          }

          lastStatus = response.status;
          lastError = String(data?.error || `Bridge health check failed (${response.status})`);

          // If this candidate is missing (404), continue to the next fallback.
          if (response.status === 404) {
            continue;
          }

          // For non-404 failures, stop early.
          break;
        } catch (error) {
          if (!active) return;
          lastError = error instanceof Error ? error.message : "Bridge unavailable";
        }
      }

      if (!active) return;
      setBridgeVersionCheck({
        status: "offline",
        message: lastError || (lastStatus ? `Bridge health check failed (${lastStatus})` : "Bridge unavailable"),
        version: "",
        capabilities: [],
        checkedAtMs: Date.now(),
      });
    };

    void runCheck(true);
    const timer = window.setInterval(() => {
      void runCheck(false);
    }, 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [mt4BridgeBase]);

  const getPolicyCheckDetail = (diag: PanelPolicyDiagnostics | undefined, check: PolicyCheckItem): string => {
    const detail = String(check.detail || "");
    if (check.rule !== "symbol_cooldown") return detail;
    const lowered = detail.toLowerCase();
    if (lowered.includes("inactive") || lowered.includes("disabled") || lowered.includes("no recent close")) {
      return detail;
    }
    const match = detail.match(/(\d+)\s*s\b/i);
    if (!match || !diag?.checkedAtMs) return detail;
    const baseSec = Number(match[1]);
    if (!Number.isFinite(baseSec)) return detail;
    const elapsedSec = Math.max(0, Math.floor((policyClockMs - diag.checkedAtMs) / 1000));
    const leftSec = Math.max(0, Math.floor(baseSec - elapsedSec));
    if (leftSec <= 0) return "ready";
    const min = Math.floor(leftSec / 60);
    const sec = leftSec % 60;
    return `${min}m ${sec}s remaining (${leftSec}s)`;
  };

  const getCheckedAgoLabel = (checkedAtMs?: number): string => {
    if (!checkedAtMs) return "n/a";
    const diffSec = Math.max(0, Math.floor((policyClockMs - checkedAtMs) / 1000));
    if (diffSec < 60) return `${diffSec}s ago`;
    const min = Math.floor(diffSec / 60);
    const sec = diffSec % 60;
    return `${min}m ${sec}s ago`;
  };
  const formatSetupPrice = (symbol: string, value?: number | null): string => {
    if (typeof value !== "number" || !Number.isFinite(value)) return "--";
    return value.toFixed(isCryptoSymbol(symbol) ? 2 : 5);
  };
  const getSetupBiasTone = (signal: "BUY" | "SELL" | "HOLD" | null | undefined): string => {
    switch (signal) {
      case "BUY":
        return "text-emerald-200";
      case "SELL":
        return "text-rose-200";
      default:
        return "text-slate-200";
    }
  };
  const getSetupBadgeClass = (signal: "BUY" | "SELL" | "HOLD" | null | undefined): string => {
    switch (signal) {
      case "BUY":
        return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
      case "SELL":
        return "border-rose-400/40 bg-rose-400/10 text-rose-200";
      default:
        return "border-slate-600/70 bg-slate-800/80 text-slate-200";
    }
  };
  const getSetupCardClass = (signal: "BUY" | "SELL" | "HOLD" | null | undefined): string => {
    switch (signal) {
      case "BUY":
        return "border-emerald-500/35 bg-[linear-gradient(135deg,rgba(5,46,22,0.92),rgba(15,23,42,0.92))]";
      case "SELL":
        return "border-rose-500/35 bg-[linear-gradient(135deg,rgba(69,10,10,0.92),rgba(15,23,42,0.92))]";
      default:
        return "border-slate-700/70 bg-[linear-gradient(135deg,rgba(15,23,42,0.95),rgba(30,41,59,0.88))]";
    }
  };
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
  const mt4SymbolSuffix = normalizeBrokerSuffix((import.meta.env.VITE_MT4_SYMBOL_SUFFIX as string | undefined) || "");
  const configuredCryptoSuffix = (import.meta.env.VITE_MT4_CRYPTO_SUFFIX as string | undefined) || "";
  const mt4CryptoSuffix = normalizeBrokerSuffix(configuredCryptoSuffix || mt4SymbolSuffix) || "#";
  const profileSymbolSuffix = "#";
  const profileCryptoSuffix = "#";
  const mt4SymbolMapRaw = (import.meta.env.VITE_MT4_SYMBOL_MAP as string | undefined) || "";
  const mt4SymbolMap = useMemo(() => {
    if (!mt4SymbolMapRaw) return {} as Record<string, string>;
    try {
      const parsed = JSON.parse(mt4SymbolMapRaw);
      if (parsed && typeof parsed === "object") return parsed as Record<string, string>;
    } catch {
      // ignore invalid map
    }
    return {} as Record<string, string>;
  }, [mt4SymbolMapRaw]);
  const brokerWeekOpenUtcMin = parseUtcMinutes(
    import.meta.env.VITE_BROKER_WEEK_OPEN_UTC as string | undefined,
    22 * 60 + 5
  );
  const brokerWeekCloseUtcMin = parseUtcMinutes(
    import.meta.env.VITE_BROKER_WEEK_CLOSE_UTC as string | undefined,
    21 * 60 + 55
  );
  const brokerDailyBreakStartUtcMin = parseUtcMinutes(
    import.meta.env.VITE_BROKER_DAILY_BREAK_START_UTC as string | undefined,
    21 * 60 + 55
  );
  const brokerDailyBreakEndUtcMin = parseUtcMinutes(
    import.meta.env.VITE_BROKER_DAILY_BREAK_END_UTC as string | undefined,
    22 * 60 + 5
  );
  const runtimeDefaultMaxSpreadPoints = Math.max(
    1,
    Number(
      (import.meta.env.VITE_AUTO_MAX_SPREAD_POINTS as string | undefined) ??
      (import.meta.env.VITE_AUTO_GOLD_MAX_SPREAD_POINTS as string | undefined) ??
      80
    )
  );
  const autoMaxSlippagePoints = Math.max(
    1,
    Number(
      (import.meta.env.VITE_AUTO_MAX_SLIPPAGE_POINTS as string | undefined) ??
      (import.meta.env.VITE_AUTO_GOLD_MAX_SLIPPAGE_POINTS as string | undefined) ??
      120
    )
  );
  const runtimeDefaultMinLot = sanitizePositiveNumber(
    import.meta.env.VITE_MT4_MIN_LOT as string | undefined,
    Number(AUTO_TRADE_DEFAULTS.minLot),
    0.001,
    1000
  );
  const runtimeDefaultLotStep = sanitizePositiveNumber(
    import.meta.env.VITE_MT4_LOT_STEP as string | undefined,
    Number(AUTO_TRADE_DEFAULTS.lotStep),
    0.001,
    1000
  );
  const autoSessionWindowTz =
    (import.meta.env.VITE_AUTO_SESSION_WINDOW_TZ as string | undefined)?.trim() || "Asia/Manila";
  const autoSessionWindowStartMin = parseUtcMinutes(
    import.meta.env.VITE_AUTO_SESSION_WINDOW_START as string | undefined,
    20 * 60
  );
  const autoSessionWindowEndMin = parseUtcMinutes(
    import.meta.env.VITE_AUTO_SESSION_WINDOW_END as string | undefined,
    0
  );
  const autoSessionWindowIncludeCrypto = parseBooleanFlag(
    import.meta.env.VITE_AUTO_SESSION_WINDOW_INCLUDE_CRYPTO as string | undefined,
    false
  );
  const mt4AllowedSymbolsRaw = (import.meta.env.VITE_MT4_ALLOWED_SYMBOLS as string | undefined) || "";
  const sessionWindowLabel = `${formatClockMinute(autoSessionWindowStartMin)}-${formatClockMinute(autoSessionWindowEndMin)} ${autoSessionWindowTz}`;
  const formatTimeInTz = (nowMs: number): string => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: autoSessionWindowTz,
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(nowMs));
    } catch {
      return formatClockMinute(getMinuteInTimeZone(nowMs, "UTC"));
    }
  };
  const isAutoSessionWindowOpen = (symbol: string, nowMs = Date.now()): boolean => {
    if (!autoSessionGateEnabled) return true;
    if (isCryptoSymbol(symbol) && !autoSessionWindowIncludeCrypto) return true;
    const localMinute = getMinuteInTimeZone(nowMs, autoSessionWindowTz);
    return minuteInWindow(localMinute, autoSessionWindowStartMin, autoSessionWindowEndMin);
  };

  const isBrokerSessionOpen = (symbol: string, nowMs = Date.now()): boolean => {
    if (isCryptoSymbol(symbol)) return true;
    const now = new Date(nowMs);
    const utcDay = now.getUTCDay(); // 0=Sun ... 6=Sat
    const utcMinute = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (utcDay === 6) return false; // Saturday
    if (utcDay === 0) return utcMinute >= brokerWeekOpenUtcMin; // Sunday open
    if (utcDay === 5) return utcMinute < brokerWeekCloseUtcMin; // Friday close
    return !minuteInWindow(utcMinute, brokerDailyBreakStartUtcMin, brokerDailyBreakEndUtcMin);
  };

  const pushAutoTradeLog = (level: "INFO" | "WARN" | "ERROR", message: string) => {
    const now = Date.now();
    setAutoTradeLogs((prev) => {
      const next = [{ ts: now, level, message }, ...prev];
      return next.slice(0, 200);
    });
  };
  const pushBotExecutionAuditLog = (
    symbol: string,
    stage: BotExecutionStage,
    details: string
  ) => {
    const now = Date.now();
    const label = formatPairLabel(symbol);
    setBotExecutionAuditLogs((prev) => {
      const next = [{ ts: now, symbol: label, stage, details }, ...prev];
      return next.slice(0, 500);
    });
  };

  const fetchMt4Tick = async (symbol: string) => {
    const resolvedSymbol = resolveOrderSymbol(symbol);
    try {
      const response = await fetch(`${mt4BridgeBase}/ticks?symbol=${encodeURIComponent(resolvedSymbol)}`, { method: "GET" });
      if (!response.ok) return null;
      const data = await response.json();
      if (!data?.ok || !data?.tick) return null;
      const bid = Number(data.tick.bid);
      const ask = Number(data.tick.ask);
      if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return null;
      return {
        bid,
        ask,
        mid: (bid + ask) / 2,
        time: Number(data.tick.time || 0),
      };
    } catch {
      return null;
    }
  };

  const computeEffectiveRR = (
    side: "BUY" | "SELL",
    entry: number,
    sl: number,
    tp: number
  ): number => {
    if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp)) return NaN;
    const riskDistance = side === "BUY" ? entry - sl : sl - entry;
    const rewardDistance = side === "BUY" ? tp - entry : entry - tp;
    if (!Number.isFinite(riskDistance) || !Number.isFinite(rewardDistance) || riskDistance <= 0 || rewardDistance <= 0) {
      return NaN;
    }
    return rewardDistance / riskDistance;
  };

  const normalizeSymbol = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const symbolsMatch = (left: string, right: string): boolean => {
    const leftKey = normalizeSymbol(left);
    const rightKey = normalizeSymbol(right);
    if (!leftKey || !rightKey) return false;
    return leftKey === rightKey || leftKey.startsWith(rightKey) || rightKey.startsWith(leftKey);
  };
  const resolveOrderSymbol = (symbol: string): string => {
    const normalized = normalizeSymbol(symbol);
    const mapped = mt4SymbolMap[normalized];
    if (mapped) return stripLegacyBrokerSuffix(mapped);
    if (normalized !== symbol.toUpperCase()) return symbol;
    const suffix = isCryptoSymbol(symbol)
      ? (mt4CryptoSuffix || profileCryptoSuffix || "#")
      : (mt4SymbolSuffix || profileSymbolSuffix || "#");
    if (!suffix) return normalized;
    return stripLegacyBrokerSuffix(`${normalized}${suffix}`);
  };
  const getSymbolExecutionPreset = (symbol: string): SymbolExecutionPreset => {
    const normalized = normalizeSymbol(symbol);
    // Special handling for newly-added and high-volatility symbols.
    if (normalized.includes("US30")) {
      return { minSlPoints: 120, spreadMult: 0.5, slippageMult: 0.65 };
    }
    if (normalized.includes("GBPNZD")) {
      return { minSlPoints: 70, spreadMult: 2.0, slippageMult: 2.0 };
    }
    if (normalized.endsWith("JPY")) {
      return { minSlPoints: 45, spreadMult: 1.5, slippageMult: 1.5 };
    }
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
    // FX majors/crosses default baseline.
    return { minSlPoints: 30, spreadMult: 1.0, slippageMult: 1.0 };
  };
  const getMinSlPointsForSymbol = (symbol: string): number => {
    const configured = Math.max(1, Number(autoMinSlPoints) || 30);
    const preset = getSymbolExecutionPreset(symbol).minSlPoints;
    return Math.max(configured, preset);
  };
  const getSpreadGuardPointsForSymbol = (symbol: string): number => {
    const preset = getSymbolExecutionPreset(symbol);
    const configuredBaseSpread = Math.max(1, Number(autoTradeDraft.maxSpreadPoints) || runtimeDefaultMaxSpreadPoints);
    return Math.max(1, configuredBaseSpread * preset.spreadMult);
  };
  const getSlippageGuardPointsForSymbol = (symbol: string): number => {
    const preset = getSymbolExecutionPreset(symbol);
    return Math.max(1, autoMaxSlippagePoints * preset.slippageMult);
  };

  const average = (values: number[]): number => {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const isCryptoSymbol = (value: string): boolean =>
    CRYPTO_ASSETS.some((asset) => normalizeSymbol(asset) === normalizeSymbol(value));
  const getWatchlistBoardAssetType = (value: string): WatchlistBoardAssetType => {
    const normalized = normalizeSymbol(value);
    if (isCryptoSymbol(normalized)) return "CRYPTO";
    if (
      normalized.includes("XAU") ||
      normalized.includes("GOLD") ||
      normalized.includes("XAG") ||
      normalized.includes("SILVER")
    ) {
      return "METAL";
    }
    if (normalized.includes("US30")) return "INDEX";
    return "FOREX";
  };

  const configuredAllowedSymbols = useMemo(
    () =>
      mt4AllowedSymbolsRaw
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    [mt4AllowedSymbolsRaw]
  );
  const normalizedLearnedBlockedSymbols = useMemo(
    () => learnedBlockedSymbols.map((symbol) => normalizeSymbol(symbol)),
    [learnedBlockedSymbols]
  );
  const adaptiveLearningReport = useMemo(
    () =>
      analyzeAdaptiveLearning(trades, {
        minConfidence: Math.max(0, Number(autoMinConfidence) || 0),
        minRR: Math.max(1, Number(autoMinRR) || 1),
        cooldownMin: Math.max(1, Number(autoCooldownMin) || 15),
      }),
    [trades, autoMinConfidence, autoMinRR, autoCooldownMin]
  );
  const activeAdaptiveSession = useMemo(
    () => classifyAdaptiveSession(Date.now()),
    [policyClockMs]
  );
  const adaptiveRecommendationsPending =
    adaptiveLearningReport.recommendations.minConfidence.changed ||
    adaptiveLearningReport.recommendations.minRR.changed ||
    adaptiveLearningReport.recommendations.cooldownMin.changed ||
    adaptiveLearningReport.recommendations.blockSymbols.length > 0 ||
    adaptiveLearningReport.recommendations.blockSessions.length > 0;

  const setupConflictWarnings = useMemo(() => {
    const warnings: string[] = [];
    const warningSet = new Set<string>();
    const addWarning = (value: string) => {
      if (!warningSet.has(value)) {
        warningSet.add(value);
        warnings.push(value);
      }
    };

    const brokerMin = Number(runtimeDefaultMinLot);
    const brokerStep = Number(runtimeDefaultLotStep);
    const currentMin = Number(autoDynamicMinLot);
    const currentStep = Number(autoDynamicLotStep);

    if (Number.isFinite(brokerMin) && Number.isFinite(currentMin) && currentMin + 1e-9 < brokerMin) {
      addWarning(`Min Lot ${currentMin} is below broker default ${brokerMin}.`);
    }
    if (Number.isFinite(brokerStep) && Number.isFinite(currentStep) && currentStep + 1e-9 < brokerStep) {
      addWarning(`Lot Step ${currentStep} is below broker default ${brokerStep}.`);
    }

    if (configuredAllowedSymbols.length > 0) {
      const allowlist = configuredAllowedSymbols.map((item) => normalizeSymbol(item));
      const isAllowlisted = (candidate: string) => {
        const rawNorm = normalizeSymbol(candidate);
        return allowlist.some(
          (allowedNorm) =>
            allowedNorm === rawNorm ||
            allowedNorm.startsWith(rawNorm) ||
            rawNorm.startsWith(allowedNorm)
        );
      };

      panelSymbols.forEach((symbol) => {
        const normalized = normalizeSymbol(symbol);
        const mapped = mt4SymbolMap[normalized];
        const suffix = isCryptoSymbol(symbol)
          ? (mt4CryptoSuffix || profileCryptoSuffix || "#")
          : (mt4SymbolSuffix || profileSymbolSuffix || "#");
        const resolved = mapped
          ? stripLegacyBrokerSuffix(mapped)
          : stripLegacyBrokerSuffix(`${normalized}${suffix || ""}`);
        if (!isAllowlisted(resolved)) {
          addWarning(
            `Allowed-symbol mismatch: ${symbol} resolves to ${resolved}, but it is missing in VITE_MT4_ALLOWED_SYMBOLS.`
          );
        }
      });
    }

    return warnings;
  }, [
    runtimeDefaultMinLot,
    runtimeDefaultLotStep,
    autoDynamicMinLot,
    autoDynamicLotStep,
    configuredAllowedSymbols,
    panelSymbols,
    mt4SymbolMap,
    mt4CryptoSuffix,
    profileCryptoSuffix,
    mt4SymbolSuffix,
    profileSymbolSuffix,
  ]);

  const buildRecommendedAutoTradeDraft = (): typeof autoTradeDraft => ({
    sideFilter: AUTO_TRADE_DEFAULTS.sideFilter,
    minConfidence: AUTO_TRADE_DEFAULTS.minConfidence,
    minWinRate: AUTO_TRADE_DEFAULTS.minWinRate,
    minRR: AUTO_TRADE_DEFAULTS.minRR,
    maxSpreadPoints: AUTO_TRADE_DEFAULTS.maxSpreadPoints,
    cooldownMin: AUTO_TRADE_DEFAULTS.cooldownMin,
    maxOpenTrades: AUTO_TRADE_DEFAULTS.maxOpenTrades,
    requireStrong: AUTO_TRADE_DEFAULTS.requireStrong,
    enforceTrendStack: AUTO_TRADE_DEFAULTS.enforceTrendStack,
    enforceSymbolCooldown: AUTO_TRADE_DEFAULTS.enforceSymbolCooldown,
    enforceDailyLossLimit: AUTO_TRADE_DEFAULTS.enforceDailyLossLimit,
    enforceHardRiskBlock: AUTO_TRADE_DEFAULTS.enforceHardRiskBlock,
    strategyMode: AUTO_TRADE_DEFAULTS.strategyMode,
    scalpAggressive: Boolean(AUTO_TRADE_DEFAULTS.scalpAggressive),
    sessionGateEnabled: autoSessionGateEnabled,
    biasTimeframe: AUTO_TRADE_DEFAULTS.biasTimeframe,
    setupTimeframe: AUTO_TRADE_DEFAULTS.setupTimeframe,
    entryTimeframe: AUTO_TRADE_DEFAULTS.entryTimeframe,
    reentryMode: AUTO_TRADE_DEFAULTS.reentryMode,
    timeframeOverride: AUTO_TRADE_DEFAULTS.timeframeOverride,
    entryMode: AUTO_TRADE_DEFAULTS.entryMode,
    allowMarketFallback: AUTO_TRADE_DEFAULTS.allowMarketFallback,
    fallbackMinConfidence: AUTO_TRADE_DEFAULTS.fallbackMinConfidence,
    fallbackRrBuffer: AUTO_TRADE_DEFAULTS.fallbackRrBuffer,
    botLots: AUTO_TRADE_DEFAULTS.botLots,
    riskMode: AUTO_TRADE_DEFAULTS.riskMode,
    useDynamicLot: AUTO_TRADE_DEFAULTS.useDynamicLot,
    riskPct: AUTO_TRADE_DEFAULTS.riskPct,
    riskUsd: AUTO_TRADE_DEFAULTS.riskUsd,
    riskGuardMult: AUTO_TRADE_DEFAULTS.riskGuardMult,
    minSlPoints: AUTO_TRADE_DEFAULTS.minSlPoints,
    atrBufferMult: AUTO_TRADE_DEFAULTS.atrBufferMult,
    minLot: runtimeDefaultMinLot,
    lotStep: runtimeDefaultLotStep,
  });

  const applyAutoTradeSettings = (
    nextDraft: typeof autoTradeDraft,
    options?: { statusMessage?: string; alertMessage?: string; silent?: boolean }
  ) => {
    setAutoSideFilter(nextDraft.sideFilter);
    setAutoMinConfidence(nextDraft.minConfidence);
    setAutoMinWinRate(nextDraft.minWinRate);
    setAutoMinRR(nextDraft.minRR);
    setAutoMaxSpreadPointsSetting(nextDraft.maxSpreadPoints);
    const nextCooldownMin = sanitizeCooldownMinutes(nextDraft.cooldownMin, 15);
    const nextMaxOpenTrades = sanitizeMaxOpenTrades(nextDraft.maxOpenTrades, 1);
    setAutoCooldownMin(nextCooldownMin);
    setAutoMaxOpenTrades(nextMaxOpenTrades);
    setAutoRequireStrongSignal(nextDraft.requireStrong);
    setAutoEnforceTrendStack(nextDraft.enforceTrendStack);
    setAutoEnforceSymbolCooldown(nextDraft.enforceSymbolCooldown);
    setAutoEnforceDailyLossLimit(nextDraft.enforceDailyLossLimit);
    setAutoEnforceHardRiskBlock(nextDraft.enforceHardRiskBlock);
    setAutoStrategyMode(nextDraft.strategyMode);
    setAutoScalpAggressive(nextDraft.scalpAggressive);
    setAutoSessionGateEnabled(nextDraft.sessionGateEnabled);
    setAutoEntryTimeframe(nextDraft.entryTimeframe);
    setAutoReentryMode(nextDraft.reentryMode);
    setAutoTradeTimeframeOverride(nextDraft.timeframeOverride);
    setAutoEntryMode(nextDraft.entryMode);
    setAutoAllowMarketFallback(nextDraft.allowMarketFallback);
    setAutoFallbackMinConfidence(nextDraft.fallbackMinConfidence);
    setAutoFallbackRrBuffer(nextDraft.fallbackRrBuffer);
    setAutoBotLots(nextDraft.botLots);
    setAutoRiskMode(nextDraft.riskMode);
    setAutoUseDynamicLot(nextDraft.useDynamicLot);
    setAutoRiskPct(nextDraft.riskPct);
    setAutoRiskUsd(nextDraft.riskUsd);
    setAutoRiskGuardMult(nextDraft.riskGuardMult);
    const nextMinSlPoints = sanitizePositiveNumber(nextDraft.minSlPoints, 30, 1, 100000);
    const nextAtrBufferMult = sanitizePositiveNumber(nextDraft.atrBufferMult, 0.25, 0, 10);
    setAutoMinSlPoints(nextMinSlPoints);
    setAutoAtrBufferMult(nextAtrBufferMult);
    setAutoDynamicMinLot(nextDraft.minLot);
    setAutoDynamicLotStep(nextDraft.lotStep);
    localStorage.setItem(
      "assistant.autoTrade",
      JSON.stringify({
        runtimeMode: autoRuntimeMode,
        enabled: autoTradeEnabled,
        sideFilter: nextDraft.sideFilter,
        minConfidence: nextDraft.minConfidence,
        minWinRate: nextDraft.minWinRate,
        minRR: nextDraft.minRR,
        maxSpreadPoints: nextDraft.maxSpreadPoints,
        cooldownMin: nextCooldownMin,
        maxOpenTrades: nextMaxOpenTrades,
        requireStrong: nextDraft.requireStrong,
        enforceTrendStack: nextDraft.enforceTrendStack,
        enforceSymbolCooldown: nextDraft.enforceSymbolCooldown,
        enforceDailyLossLimit: nextDraft.enforceDailyLossLimit,
        enforceHardRiskBlock: nextDraft.enforceHardRiskBlock,
        strategyMode: nextDraft.strategyMode,
        scalpAggressive: nextDraft.scalpAggressive,
        sessionGateEnabled: nextDraft.sessionGateEnabled,
        biasTimeframe: AUTO_BIAS_TIMEFRAME,
        setupTimeframe: AUTO_SETUP_TIMEFRAME,
        entryTimeframe: nextDraft.entryTimeframe,
        reentryMode: nextDraft.reentryMode,
        timeframeOverride: nextDraft.timeframeOverride,
        entryMode: nextDraft.entryMode,
        allowMarketFallback: nextDraft.allowMarketFallback,
        fallbackMinConfidence: nextDraft.fallbackMinConfidence,
        fallbackRrBuffer: nextDraft.fallbackRrBuffer,
        botLots: nextDraft.botLots,
        riskMode: nextDraft.riskMode,
        useDynamicLot: nextDraft.useDynamicLot,
        riskPct: nextDraft.riskPct,
        riskUsd: nextDraft.riskUsd,
        riskGuardMult: nextDraft.riskGuardMult,
        minSlPoints: nextMinSlPoints,
        atrBufferMult: nextAtrBufferMult,
        minLot: nextDraft.minLot,
        lotStep: nextDraft.lotStep,
        logs: autoTradeLogs.slice(0, 200),
        auditLogs: botExecutionAuditLogs.slice(0, 500),
      })
    );
    localStorage.setItem("assistant.profile", accountProfile);
    if (!options?.silent) {
      setAutoTradeStatus(options?.statusMessage || "Trading settings saved and applied. Rechecking policy diagnostics...");
    }
    setTimeout(() => {
      void runPolicyDiagnostics();
    }, 0);
    if (options?.alertMessage && typeof window !== "undefined") {
      window.alert(options.alertMessage);
    }
  };

  const loadRecommendedTradingConfig = () => {
    const nextDraft = buildRecommendedAutoTradeDraft();
    setAutoTradeDraft(nextDraft);
    setAccountProfile("MICRO");
    setProtectTimeframe("M15");
    setProtectAtrPeriod("14");
    setProtectAtrMult("2.0");
    setProtectLookback("14");
    setProtectMinStopPoints("30");
    setProtectGraceMin("1");
    setProtectBreakEvenEnabled(true);
    setProtectBreakEvenR("1.0");
    setProtectBreakEvenProfitUsd(HEADLESS_OVERNIGHT_BREAK_EVEN_PROFIT_USD);
    setProtectDegradeCloseEnabled(true);
    setProtectDegradeMinConfidence("82");
    setProtectBiasFlipProfitLockEnabled(true);
    setProtectBiasFlipTpProgressPct(HEADLESS_BIAS_FLIP_TP_PROGRESS_PCT);
    setProtectOvernightProfitRetraceLockEnabled(true);
    setProtectOvernightProfitRetraceArmUsd(HEADLESS_OVERNIGHT_RETRACE_ARM_USD);
    setProtectOvernightProfitRetraceCloseUsd(HEADLESS_OVERNIGHT_RETRACE_CLOSE_USD);
    setProtectEnabled(true);
    setProtectOvernightEnabled(true);
    setProtectOvernightProfitUsd(HEADLESS_OVERNIGHT_TARGET_PROFIT_USD);
    setProtectOvernightLossUsd(HEADLESS_OVERNIGHT_LOSS_USD);
    applyAutoTradeSettings(nextDraft, {
      statusMessage:
        "Optimized gold overnight preset applied. Headless sync is pinned to GOLD M5 with tighter MA200/news filters, $1.10 target, $1.20 loss cap, break-even at +$0.30, and faster protective handling.",
      alertMessage: "Optimized gold overnight preset applied.",
    });
  };
  void loadRecommendedTradingConfig;

  const applyAdaptiveRecommendations = () => {
    const nextMinConfidence = String(adaptiveLearningReport.recommendations.minConfidence.suggested);
    const nextMinRR = adaptiveLearningReport.recommendations.minRR.suggested.toFixed(2).replace(/\.00$/, "");
    const nextCooldownMin = sanitizeCooldownMinutes(adaptiveLearningReport.recommendations.cooldownMin.suggested, 15);
    const nextBlockedSymbols = adaptiveLearningReport.recommendations.blockSymbols
      .map((symbol) => normalizeSymbol(symbol))
      .filter(Boolean);
    const nextBlockedSessions = adaptiveLearningReport.recommendations.blockSessions;

    setAutoMinConfidence(nextMinConfidence);
    setAutoMinRR(nextMinRR);
    setAutoCooldownMin(nextCooldownMin);
    setAutoTradeDraft((prev) => ({
      ...prev,
      minConfidence: nextMinConfidence,
      minRR: nextMinRR,
      cooldownMin: nextCooldownMin,
    }));
    setAdaptiveLearningEnabled(true);
    setLearnedBlockedSymbols(nextBlockedSymbols);
    setLearnedBlockedSessions(nextBlockedSessions);
    setAutoTradeStatus(
      `Adaptive recommendations applied (${adaptiveLearningReport.sampleSize} closed trades analyzed).`
    );
    setTimeout(() => {
      void runPolicyDiagnostics();
    }, 0);
  };

  const clearAdaptiveFilters = () => {
    setLearnedBlockedSymbols([]);
    setLearnedBlockedSessions([]);
    setAdaptiveLearningEnabled(false);
    setAutoTradeStatus("Adaptive learning filters cleared.");
    setTimeout(() => {
      void runPolicyDiagnostics();
    }, 0);
  };

  const sma = (values: number[], period: number): number | null => {
    if (values.length < period) return null;
    return average(values.slice(-period));
  };

  const emaSeries = (values: number[], period: number): number[] => {
    if (!values.length) return [];
    const k = 2 / (period + 1);
    const output: number[] = [];
    let prev = values[0];
    output.push(prev);
    for (let i = 1; i < values.length; i += 1) {
      const next = values[i] * k + prev * (1 - k);
      output.push(next);
      prev = next;
    }
    return output;
  };

  const computeRsi = (closes: number[], period = 14): number => {
    if (closes.length <= period) return 50;
    let gains = 0;
    let losses = 0;
    for (let i = closes.length - period; i < closes.length; i += 1) {
      const prev = closes[i - 1];
      const curr = closes[i];
      const delta = curr - prev;
      if (delta >= 0) gains += delta;
      else losses += Math.abs(delta);
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - 100 / (1 + rs);
  };

  const getPointSizeForSymbol = (symbol: string, price?: number): number => {
    const normalized = normalizeSymbol(symbol);
    // Align "points" with MT4-style quote precision (not pips).
    if (normalized.includes("US30")) return 1;
    if (isCryptoSymbol(symbol)) return 0.01;
    if (normalized.includes("XAU") || normalized.includes("GOLD") || normalized.includes("XAG")) {
      return 0.01;
    }
    if (normalized.endsWith("JPY")) return 0.001;
    if (price && price >= 100) return 0.01;
    return 0.00001;
  };

  const getPipSizeForSymbol = (symbol: string, price?: number): number => {
    const normalized = normalizeSymbol(symbol);
    if (normalized.includes("US30")) return 1;
    if (isCryptoSymbol(symbol)) return 1;
    if (normalized.includes("XAU") || normalized.includes("GOLD") || normalized.includes("XAG")) {
      return 0.1;
    }
    if (normalized.endsWith("JPY")) return 0.01;
    if (price && price >= 100) return 0.01;
    return 0.0001;
  };

  const computeAtr = (candles: Mt4Candle[], period = 14): number => {
    if (candles.length <= period) return 0;
    const trs: number[] = [];
    for (let i = 1; i < candles.length; i += 1) {
      const prev = candles[i - 1];
      const curr = candles[i];
      const tr = Math.max(
        curr.high - curr.low,
        Math.abs(curr.high - prev.close),
        Math.abs(curr.low - prev.close)
      );
      trs.push(tr);
    }
    const recent = trs.slice(-period);
    return average(recent);
  };

  const fetchMt4Candles = async (symbol: string, timeframe: ChartTimeframe, count = 260): Promise<Mt4Candle[]> => {
    const resolvedSymbol = resolveOrderSymbol(symbol);
    const parseCandles = (items: any[]): Mt4Candle[] =>
      items
        .map((item: any) => ({
          time: Number(item.time),
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
          volume: Number(item.volume || 0),
        }))
        .filter(
          (candle: Mt4Candle) =>
            Number.isFinite(candle.time) &&
            Number.isFinite(candle.open) &&
            Number.isFinite(candle.high) &&
            Number.isFinite(candle.low) &&
            Number.isFinite(candle.close)
        )
        .sort((a: Mt4Candle, b: Mt4Candle) => a.time - b.time);

    const response = await fetch(
      `${mt4BridgeBase}/candles?symbol=${encodeURIComponent(resolvedSymbol)}&timeframe=${timeframe}&count=${count}`,
      { method: "GET" }
    );
    if (!response.ok) return [];
    const data = await response.json();
    if (!data?.ok || !Array.isArray(data?.candles)) return [];
    return parseCandles(data.candles);
  };

  const fetchFallbackCandlesForAnalysis = async (
    symbol: string,
    timeframe: ChartTimeframe,
    count = 260
  ): Promise<Mt4Candle[]> => {
    if (ASSISTANT_MT4_ONLY_MODE) return [];
    const resolvedSymbol = resolveOrderSymbol(symbol);
    try {
      const response = await fetch(
        `${mt4BridgeBase}/fallback-candles?symbol=${encodeURIComponent(resolvedSymbol)}&timeframe=${timeframe}&count=${count}`,
        { method: "GET" }
      );
      if (!response.ok) return [];
      const data = await response.json();
      if (!data?.ok || !Array.isArray(data?.candles)) return [];
      return data.candles
        .map((item: any) => ({
          time: Number(item.time),
          open: Number(item.open),
          high: Number(item.high),
          low: Number(item.low),
          close: Number(item.close),
          volume: Number(item.volume || 0),
        }))
        .filter(
          (candle: Mt4Candle) =>
            Number.isFinite(candle.time) &&
            Number.isFinite(candle.open) &&
            Number.isFinite(candle.high) &&
            Number.isFinite(candle.low) &&
            Number.isFinite(candle.close)
        )
        .sort((a: Mt4Candle, b: Mt4Candle) => a.time - b.time);
    } catch {
      return [];
    }
  };

  const buildPriceDataFromCandles = (symbol: string, candles: Mt4Candle[]): PriceData | null => {
    if (candles.length < 60) return null;

    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const closes = candles.map((candle) => candle.close);
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);

    const ema12 = emaSeries(closes, 12);
    const ema26 = emaSeries(closes, 26);
    const macdSeries = ema12.map((value, index) => value - (ema26[index] ?? value));
    const signalSeries = emaSeries(macdSeries, 9);
    const macdLine = macdSeries[macdSeries.length - 1] ?? 0;
    const macdSignal = signalSeries[signalSeries.length - 1] ?? 0;
    const macdHistogram = macdLine - macdSignal;

    const ma50 = sma(closes, 50) ?? closes[closes.length - 1];
    const ma200 = sma(closes, 200) ?? sma(closes, 100) ?? closes[closes.length - 1];
    const previousCloses = closes.slice(0, -1);
    const previousMa200 = previousCloses.length
      ? sma(previousCloses, 200) ?? sma(previousCloses, 100) ?? previousCloses[previousCloses.length - 1]
      : ma200;
    const recentHigh = Math.max(...highs.slice(-50));
    const recentLow = Math.min(...lows.slice(-50));
    const swingSlice = candles.slice(-31, -1);
    const swingHigh = swingSlice.length
      ? Math.max(...swingSlice.map((candle) => candle.high))
      : recentHigh;
    const swingLow = swingSlice.length
      ? Math.min(...swingSlice.map((candle) => candle.low))
      : recentLow;
    const atr = computeAtr(candles, 14);
    const safeAtr = Number.isFinite(atr) && atr > 0 ? atr : Math.max(Math.abs(recentHigh - recentLow) / 14, 1e-9);
    const ma200Slope = ma200 - previousMa200;
    const ma200SlopeAtrRatio = safeAtr > 0 ? Math.abs(ma200Slope) / safeAtr : 0;
    const rsi = computeRsi(closes, 14);
    const change = last.close - prev.close;
    const changePercent = prev.close !== 0 ? (change / prev.close) * 100 : 0;

    return {
      symbol,
      current: last.close,
      high: recentHigh,
      low: recentLow,
      change,
      changePercent,
      rsi,
      macd: { line: macdLine, signal: macdSignal, histogram: macdHistogram },
      supportLevel: recentLow,
      resistanceLevel: recentHigh,
      swingLow,
      swingHigh,
      atr,
      movingAverage50: ma50,
      movingAverage200: ma200,
      movingAverage200Prev: previousMa200,
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

  const getDirectionalStructureTarget = (
    side: "BUY" | "SELL",
    data: PriceData,
    entryPrice: number,
    point: number
  ): number | null => {
    const rawTarget =
      side === "BUY"
        ? Math.max(Number(data.resistanceLevel), Number(data.swingHigh))
        : Math.min(Number(data.supportLevel), Number(data.swingLow));
    if (!Number.isFinite(rawTarget) || rawTarget <= 0) return null;
    if (side === "BUY" && !(rawTarget > entryPrice + point)) return null;
    if (side === "SELL" && !(rawTarget < entryPrice - point)) return null;
    return rawTarget;
  };

  const evaluateDirectionalConfirmation = (
    symbol: string,
    data: PriceData,
    side: "BUY" | "SELL"
  ): {
    nearStructure: boolean;
    zoneDistance: number;
    zoneBuffer: number;
    zoneAtrRatio: number;
    maOk: boolean;
    rsiOk: boolean;
    patternOk: boolean;
    patternLabel: string;
  } => {
    const point = getPointSizeForSymbol(symbol, data.current);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0
        ? data.atr
        : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const structureLevel =
      side === "BUY" ? Math.min(Number(data.supportLevel), Number(data.swingLow)) : Math.max(Number(data.resistanceLevel), Number(data.swingHigh));
    const zoneDistance = Math.abs(Number(data.current) - structureLevel);
    const zoneBuffer = Math.max(point * Math.max(6, getMinSlPointsForSymbol(symbol) * 0.5), atrValue * 0.35);
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

  // MT4-first price/indicator source for signal generation.
  const generatePriceData = async (symbol: string, timeframe: ChartTimeframe): Promise<PriceData | null> => {
    const candles = await fetchMt4Candles(symbol, timeframe, 320);
    return buildPriceDataFromCandles(symbol, candles);
  };

  const getManagedProtectProfile = (
    symbol: string
  ): { managedSymbol: ManagedSymbol; timeframe: ChartTimeframe; tradeDraft: ManagedSymbolTradeDraft } | null => {
    const preset = HEADLESS_MANAGED_PRESET.find((item) => symbolsMatch(item.symbol, symbol));
    if (!preset) return null;
    return {
      managedSymbol: preset.symbol,
      timeframe: preset.timeframe,
      tradeDraft: managedSymbolTradeDrafts[preset.symbol],
    };
  };

  const buildMissingProtectionPlan = async (
    position: OpenPosition,
    side: "BUY" | "SELL",
    tick: { bid: number; ask: number; mid: number; time: number } | null
  ): Promise<
    | {
        managedSymbol: ManagedSymbol;
        timeframe: ChartTimeframe;
        sl: number;
        tp: number;
        rr: number;
        tpSource: "STRUCTURE" | "RR";
      }
    | null
  > => {
    const missingSl = !(Number(position.sl) > 0);
    const missingTp = !(Number(position.tp) > 0);
    if (!missingSl && !missingTp) return null;

    const managedProfile = getManagedProtectProfile(position.symbol);
    if (!managedProfile) return null;

    const entry = Number(position.openPrice);
    if (!Number.isFinite(entry) || entry <= 0) return null;

    const getManagedProtectionRiskDistanceCap = async (symbol: string, lots: number, maxRiskUsd: number) => {
      if (!(Number.isFinite(lots) && lots > 0 && Number.isFinite(maxRiskUsd) && maxRiskUsd > 0)) {
        return Number.NaN;
      }
      try {
        const specResponse = await fetch(`${mt4BridgeBase}/symbols?symbol=${encodeURIComponent(symbol)}`, { method: "GET" });
        const specData = await readResponseJsonSafe(specResponse);
        const spec = specResponse.ok && specData?.ok && specData?.spec ? specData.spec : null;
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
      } catch {
        return Number.NaN;
      }
    };

    const data = await generatePriceData(managedProfile.managedSymbol, managedProfile.timeframe);
    if (!data) return null;

    const current = Number(tick?.mid ?? data.current);
    const point = getPointSizeForSymbol(position.symbol, current || entry);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0
        ? data.atr
        : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const minSlPoints = Math.max(1, Number(managedProfile.tradeDraft.minSlPoints) || getMinSlPointsForSymbol(position.symbol));
    const atrBufferMult = Math.max(0, Number(managedProfile.tradeDraft.atrBufferMult) || 0.25);
    const minRR = Math.max(0.5, Number(managedProfile.tradeDraft.minRR) || 1.0);
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
          ? Math.min(
              structureLevel - structureBuffer,
              entry - point,
              current - minStopDistance
            )
          : Math.max(
              structureLevel + structureBuffer,
              entry + point,
              current + minStopDistance
            );

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
    let tpSource: "STRUCTURE" | "RR" = "RR";
    if (missingTp) {
      const structureTarget = getDirectionalStructureTarget(side, data, entry, point);
      const structureTargetValue = Number(structureTarget);
      const structureTpOk =
        Number.isFinite(structureTargetValue) &&
        ((side === "BUY" && structureTargetValue > Math.max(entry + point, current + point)) ||
          (side === "SELL" && structureTargetValue < Math.min(entry - point, current - point)));
      const rrTarget = side === "BUY" ? entry + riskDistance * minRR : entry - riskDistance * minRR;
      const fallbackTp =
        side === "BUY"
          ? Math.max(rrTarget, current + point)
          : Math.min(rrTarget, current - point);
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
      managedSymbol: managedProfile.managedSymbol,
      timeframe: managedProfile.timeframe,
      sl: computedSl,
      tp: finalTp,
      rr,
      tpSource,
    };
  };

  const evaluateCooldownReentryConfirmation = async (
    symbol: string,
    side: "BUY" | "SELL"
  ): Promise<{ ok: boolean; reason: string; m5Detail: string; m1Detail: string; m5Ok: boolean; m1Ok: boolean }> => {
    if (autoReentryMode === "OFF") {
      return {
        ok: true,
        reason: "Re-entry confirmation disabled",
        m5Detail: "Mode OFF",
        m1Detail: "Mode OFF",
        m5Ok: true,
        m1Ok: true,
      };
    }

    const m5Candles = await fetchMt4Candles(symbol, "M5", 12);
    const closedM5 = m5Candles.slice(0, -1).slice(-4);
    if (closedM5.length < 4) {
      return {
        ok: false,
        reason: "M5 re-entry bias unavailable",
        m5Detail: "Need 4 closed M5 candles",
        m1Detail: "M1 confirmation skipped",
        m5Ok: false,
        m1Ok: false,
      };
    }

    const bullishM5 = closedM5.filter((candle) => candle.close > candle.open).length;
    const bearishM5 = closedM5.filter((candle) => candle.close < candle.open).length;
    const m5NetMove = closedM5[closedM5.length - 1].close - closedM5[0].open;
    const requiredM5Count = autoReentryMode === "STRICT" ? 4 : 3;
    const m5BiasOk =
      side === "BUY" ? bullishM5 >= requiredM5Count && m5NetMove > 0 : bearishM5 >= requiredM5Count && m5NetMove < 0;
    const m5Detail =
      side === "BUY"
        ? `${bullishM5}/4 bullish, need ${requiredM5Count}, net ${m5NetMove >= 0 ? "+" : ""}${m5NetMove.toFixed(5)}`
        : `${bearishM5}/4 bearish, need ${requiredM5Count}, net ${m5NetMove >= 0 ? "+" : ""}${m5NetMove.toFixed(5)}`;

    const m1Candles = await fetchMt4Candles(symbol, "M1", 90);
    const closedM1 = m1Candles.slice(0, -1);
    const m1Data = buildPriceDataFromCandles(symbol, closedM1);
    const m1LastClosed = closedM1[closedM1.length - 1];
    if (!m1Data || !m1LastClosed) {
      return {
        ok: false,
        reason: "M1 confirmation unavailable",
        m5Detail,
        m1Detail: "Need closed M1 history",
        m5Ok: m5BiasOk,
        m1Ok: false,
      };
    }

    const m1Signal = generateTradeSignal(m1Data);
    const m1CandleOk = side === "BUY" ? m1LastClosed.close > m1LastClosed.open : m1LastClosed.close < m1LastClosed.open;
    const m1SignalOk = m1Signal.signal === side;
    const m1EmaOk =
      side === "BUY" ? m1LastClosed.close >= m1Data.movingAverage50 : m1LastClosed.close <= m1Data.movingAverage50;
    const requireEmaFilter = autoReentryMode === "STRICT";
    const m1Detail = `${m1Signal.signal} signal, latest M1 candle ${m1CandleOk ? "confirms" : "opposes"}${
      requireEmaFilter ? `, EMA50 ${m1EmaOk ? "aligned" : "not aligned"}` : ""
    }`;
    const m1ConfirmationOk = m1SignalOk && m1CandleOk && (!requireEmaFilter || m1EmaOk);

    if (!m5BiasOk) {
      return {
        ok: false,
        reason: `Previous 4 M5 candles do not support ${side} bias`,
        m5Detail,
        m1Detail,
        m5Ok: false,
        m1Ok: m1ConfirmationOk,
      };
    }
    if (!m1ConfirmationOk) {
      return {
        ok: false,
        reason: `M1 confirmation does not match ${side} bias`,
        m5Detail,
        m1Detail,
        m5Ok: true,
        m1Ok: false,
      };
    }

    return {
      ok: true,
      reason: `M5 bias and M1 confirmation aligned for ${side}`,
      m5Detail,
      m1Detail,
      m5Ok: true,
      m1Ok: true,
    };
  };

  const generateBoardPriceData = async (symbol: string, timeframe: ChartTimeframe): Promise<PriceData | null> => {
    const mt4Candles = await fetchMt4Candles(symbol, timeframe, 320);
    const mt4Data = buildPriceDataFromCandles(symbol, mt4Candles);
    if (mt4Data) return mt4Data;
    const fallbackCandles = await fetchFallbackCandlesForAnalysis(symbol, timeframe, 320);
    return buildPriceDataFromCandles(symbol, fallbackCandles);
  };

  const buildPanelStrategyIndicators = async (
    symbol: string,
    panelTimeframe: ChartTimeframe,
    baseData?: PriceData | null
  ): Promise<PanelStrategyIndicators | null> => {
    const loadFrame = async (timeframe: ChartTimeframe): Promise<PriceData | null> => {
      if (baseData && panelTimeframe === timeframe) return baseData;
      return generatePriceData(symbol, timeframe);
    };

    if (autoStrategyMode === "SCALP_M15") {
      const trendData = await loadFrame(AUTO_SCALP_TREND_TIMEFRAME);
      const entryData = await loadFrame(autoEntryTimeframe);
      return {
        strategyMode: autoStrategyMode,
        trendTimeframe: AUTO_SCALP_TREND_TIMEFRAME,
        trendData,
        trendBias: getScalpTrendBias(trendData, autoScalpAggressive),
        entryTimeframe: autoEntryTimeframe,
        entryData,
        entrySignal: entryData ? generateTradeSignal(entryData) : null,
        updatedAtMs: Date.now(),
      };
    }

    const trendData = await loadFrame(AUTO_BIAS_TIMEFRAME);
    const setupData = await loadFrame(AUTO_SETUP_TIMEFRAME);
    const entryData = await loadFrame(autoEntryTimeframe);
    const trendSignal = trendData ? generateTradeSignal(trendData) : null;
    const setupSignal = setupData ? generateTradeSignal(setupData) : null;
    const entrySignal = entryData ? generateTradeSignal(entryData) : null;

    return {
      strategyMode: autoStrategyMode,
      trendTimeframe: AUTO_BIAS_TIMEFRAME,
      trendData,
      trendBias: trendSignal?.signal || null,
      setupTimeframe: AUTO_SETUP_TIMEFRAME,
      setupData,
      setupSignal,
      entryTimeframe: autoEntryTimeframe,
      entryData,
      entrySignal,
      updatedAtMs: Date.now(),
    };
  };

  const buildSignalNoiseProfile = (data: PriceData) => {
    const cryptoProfile = isCryptoSymbol(data.symbol);
    const point = getPointSizeForSymbol(data.symbol, data.current);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0
        ? data.atr
        : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
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

    const noiseScore = clampNumber(score, 0, 100);
    const noiseState: TradeSignal["noiseState"] = noiseScore >= 55 ? "HIGH" : noiseScore >= 30 ? "MEDIUM" : "LOW";
    const confidencePenaltyMult = noiseState === "HIGH"
      ? cryptoProfile ? 0.30 : 0.45
      : cryptoProfile ? 0.20 : 0.30;
    const winRatePenaltyMult = noiseState === "HIGH"
      ? cryptoProfile ? 0.20 : 0.28
      : cryptoProfile ? 0.14 : 0.20;

    return {
      noiseScore,
      noiseState,
      confidencePenalty: Math.round(noiseScore * confidencePenaltyMult),
      winRatePenalty: Math.round(noiseScore * winRatePenaltyMult),
    };
  };

  // This is a heuristic score, not a true probability-of-win forecast.
  const calculateWinRate = (
    data: PriceData,
    signal: "BUY" | "SELL" | "HOLD",
    noiseProfile?: { noiseScore: number; noiseState: "LOW" | "MEDIUM" | "HIGH"; winRatePenalty: number }
  ): number => {
    if (signal === "HOLD") {
      return clampNumber(40 - Math.round((noiseProfile?.noiseScore || 0) * 0.2), 15, 45);
    }

    let winRate = 50;
    
    // RSI improvement
    if (signal === "BUY" && data.rsi < 40) {
      winRate += 15;
    } else if (signal === "SELL" && data.rsi > 60) {
      winRate += 15;
    }

    // Trend strength
    if (data.movingAverage50 > data.movingAverage200) {
      if (signal === "BUY") winRate += 10;
    } else {
      if (signal === "SELL") winRate += 10;
    }

    // MACD alignment
    if (signal === "BUY" && data.macd.histogram > 0) {
      winRate += 8;
    } else if (signal === "SELL" && data.macd.histogram < 0) {
      winRate += 8;
    }

    const penalty = noiseProfile?.winRatePenalty || 0;
    return clampNumber(winRate - penalty, 20, 95);
  };

  // Generate trade signals based on technical analysis
  const generateTradeSignal = (data: PriceData): TradeSignal => {
    let signal: "BUY" | "SELL" | "HOLD" = "HOLD";
    let strength: "STRONG" | "MODERATE" | "WEAK" = "WEAK";
    let confidence = 0;
    let buyScore = 0;
    let sellScore = 0;

    // Score direction per indicator instead of adding confidence to a pre-picked side.
    if (data.rsi < 30) buyScore += 25;
    else if (data.rsi < 40) buyScore += 15;
    else if (data.rsi < 46) buyScore += 8;
    else if (data.rsi > 70) sellScore += 25;
    else if (data.rsi > 60) sellScore += 15;
    else if (data.rsi > 54) sellScore += 8;

    if (data.current > data.movingAverage50 && data.movingAverage50 > data.movingAverage200) {
      buyScore += 25;
    } else if (data.current > data.movingAverage50 && data.movingAverage50 >= data.movingAverage200) {
      buyScore += 16;
    } else if (data.current > data.movingAverage50) {
      buyScore += 8;
    }

    if (data.current < data.movingAverage50 && data.movingAverage50 < data.movingAverage200) {
      sellScore += 25;
    } else if (data.current < data.movingAverage50 && data.movingAverage50 <= data.movingAverage200) {
      sellScore += 16;
    } else if (data.current < data.movingAverage50) {
      sellScore += 8;
    }

    if (data.macd.line > data.macd.signal && data.macd.histogram > 0) {
      buyScore += 25;
    } else if (data.macd.line > data.macd.signal) {
      buyScore += 16;
    } else if (data.macd.histogram > 0) {
      buyScore += 8;
    }

    if (data.macd.line < data.macd.signal && data.macd.histogram < 0) {
      sellScore += 25;
    } else if (data.macd.line < data.macd.signal) {
      sellScore += 16;
    } else if (data.macd.histogram < 0) {
      sellScore += 8;
    }

    const dominantScore = Math.max(buyScore, sellScore);
    const opposingScore = Math.min(buyScore, sellScore);
    const directionalEdge = Math.abs(buyScore - sellScore);

    if (buyScore >= sellScore + 8 && buyScore >= 28) signal = "BUY";
    else if (sellScore >= buyScore + 8 && sellScore >= 28) signal = "SELL";

    confidence = Math.max(0, dominantScore - Math.round(opposingScore * 0.35));

    const noiseProfile = buildSignalNoiseProfile(data);
    if (signal !== "HOLD") {
      confidence = Math.max(0, confidence - noiseProfile.confidencePenalty);
      const minHoldConfidence = isCryptoSymbol(data.symbol) ? 45 : 55;
      if (noiseProfile.noiseState === "HIGH" && confidence < minHoldConfidence) {
        signal = "HOLD";
      }
    }

    if (signal !== "HOLD" && directionalEdge < 8) {
      signal = "HOLD";
      confidence = Math.max(0, confidence - 6);
    }

    // Determine strength
    if (signal === "HOLD") strength = "WEAK";
    else if (confidence >= 65) strength = "STRONG";
    else if (confidence >= 40) strength = "MODERATE";
    else strength = "WEAK";

    // Calculate win rate
    const winRate = calculateWinRate(data, signal, noiseProfile);

    const point = getPointSizeForSymbol(data.symbol, data.current);
    const configuredMinSlPoints = getMinSlPointsForSymbol(data.symbol);
    const configuredAtrBufferMult = Math.max(0, Number(autoAtrBufferMult) || 0.25);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0
        ? data.atr
        : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const minStopDistance = Math.max(point * configuredMinSlPoints, atrValue * 0.35);
    const structureBuffer = Math.max(point * 3, atrValue * configuredAtrBufferMult);
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

    const isCrypto = isCryptoSymbol(data.symbol);

    return {
      symbol: data.symbol,
      signal,
      strength,
      entryPoints: {
        primary: parseFloat(entryPrimary.toFixed(isCrypto ? 2 : 5)),
        alternative: parseFloat(entryAlternative.toFixed(isCrypto ? 2 : 5)),
      },
      stopLoss: parseFloat(stopLoss.toFixed(isCrypto ? 2 : 5)),
      takeProfit: parseFloat(takeProfit.toFixed(isCrypto ? 2 : 5)),
      risk: parseFloat(riskDistance.toFixed(isCrypto ? 2 : 5)),
      reward: parseFloat(Math.abs(takeProfit - entryPrimary).toFixed(isCrypto ? 2 : 5)),
      confidence: Math.min(confidence, 100),
      winRate,
      noiseScore: noiseProfile.noiseScore,
      noiseState: noiseProfile.noiseState,
      isCrypto,
    };
  };

  const buildAutoOrderPlan = (
    symbol: string,
    data: PriceData,
    signal: TradeSignal,
    liveEntryPrice?: number
  ): AutoOrderPlanResult => {
    const side: "BUY" | "SELL" = signal.signal === "BUY" ? "BUY" : "SELL";
    const point = getPointSizeForSymbol(symbol, data.current);
    const atrValue =
      Number.isFinite(data.atr) && data.atr > 0 ? data.atr : Math.max(Math.abs(data.high - data.low) / 14, point * 20);
    const minStopDistance = Math.max(point * getMinSlPointsForSymbol(symbol), atrValue * 0.35);
    const rrTarget = Math.max(1.1, Number(autoMinRR) || 1.8);
    const fallbackMinConfidence = Math.max(0, Math.min(100, Number(autoFallbackMinConfidence) || 75));
    const fallbackRrBuffer = Math.max(0, Number(autoFallbackRrBuffer) || 0.2);

    if (autoEntryMode === "LIMIT_SR") {
      const structureEntry =
        side === "BUY"
          ? Math.min(data.supportLevel, data.swingLow)
          : Math.max(data.resistanceLevel, data.swingHigh);
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

      if (!autoAllowMarketFallback) {
        return {
          plan: null,
          blockedReason: "Limit @ S/R invalid and market fallback is disabled",
        };
      }

      const marketEntry =
        Number.isFinite(liveEntryPrice) && Number(liveEntryPrice) > 0
          ? Number(liveEntryPrice)
          : Number(data.current || signal.entryPoints.primary);
      const structureBuffer = Math.max(point * 3, atrValue * Math.max(0, Number(autoAtrBufferMult) || 0.25));
      let marketSl = Number(signal.stopLoss);
      if (side === "BUY") {
        const structureSl = Math.min(data.supportLevel, data.swingLow) - structureBuffer;
        const minDistanceSl = marketEntry - minStopDistance;
        marketSl = Number.isFinite(structureSl) ? Math.min(structureSl, minDistanceSl) : minDistanceSl;
        if (!(marketSl < marketEntry - point)) {
          marketSl = minDistanceSl;
        }
      } else {
        const structureSl = Math.max(data.resistanceLevel, data.swingHigh) + structureBuffer;
        const minDistanceSl = marketEntry + minStopDistance;
        marketSl = Number.isFinite(structureSl) ? Math.max(structureSl, minDistanceSl) : minDistanceSl;
        if (!(marketSl > marketEntry + point)) {
          marketSl = minDistanceSl;
        }
      }
      let slDistance = Math.abs(marketEntry - marketSl);
      if (!Number.isFinite(slDistance) || slDistance < minStopDistance) {
        marketSl = side === "BUY" ? marketEntry - minStopDistance : marketEntry + minStopDistance;
        slDistance = Math.abs(marketEntry - marketSl);
      }

      const fallbackRiskDistance = Math.max(slDistance, minStopDistance);
      const structureTarget = getDirectionalStructureTarget(side, data, marketEntry, point);
      const marketTp = structureTarget ?? (side === "BUY"
        ? marketEntry + fallbackRiskDistance * rrTarget
        : marketEntry - fallbackRiskDistance * rrTarget);
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
      const directionOk = side === "BUY" ? marketSl < marketEntry && marketTp > marketEntry : marketSl > marketEntry && marketTp < marketEntry;
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
      marketTp = side === "BUY"
        ? marketEntry + fallbackRiskDistance * rrTarget
        : marketEntry - fallbackRiskDistance * rrTarget;
      reframedStops = true;
    }
    const finalMarketRr = computeEffectiveRR(side, marketEntry, marketSl, marketTp);

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
        rrAtTp: finalMarketRr,
      },
    };
  };

  const analyzeSelectedSymbol = async (options?: { silent?: boolean }) => {
    if (analyzeBusyRef.current) return;
    analyzeBusyRef.current = true;
    const silent = Boolean(options?.silent);
    if (!silent) setLoading(true);
    try {
      const data = await generatePriceData(selectedSymbol, selectedTimeframe);
      if (!data) {
        setTradeBridgeMessage(`No MT5 candle data available for ${selectedSymbol} ${selectedTimeframe}.`);
        setTradeSignal(null);
        return;
      }
      const signal = generateTradeSignal(data);
      setTradeSignal(signal);
    } catch (error) {
      console.error("Error analyzing symbol:", error);
    } finally {
      if (!silent) setLoading(false);
      analyzeBusyRef.current = false;
    }
  };

  useEffect(() => {
    void analyzeSelectedSymbol({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSymbol, selectedTimeframe]);

  useEffect(() => {
    const payload = JSON.stringify({
      symbols: panelSymbols,
      timeframes: panelTimeframes,
    });
    localStorage.setItem("assistant.panels", payload);
  }, [panelSymbols, panelTimeframes]);

  useEffect(() => {
    if (fullscreenChartIndex === null) return;
    if (fullscreenChartIndex < 0 || fullscreenChartIndex >= panelSymbols.length) {
      setFullscreenChartIndex(null);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFullscreenChartIndex(null);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [fullscreenChartIndex, panelSymbols.length]);

  useEffect(() => {
    const raw = localStorage.getItem("assistant.orderForm");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.orderAction) setOrderAction(parsed.orderAction);
      if (parsed?.orderSide) setOrderSide(parsed.orderSide);
      if (parsed?.orderLots !== undefined) {
        const storedOrderLots = Number(parsed.orderLots);
        setOrderLots(storedOrderLots === 0.1 ? "0.01" : String(parsed.orderLots));
      }
      if (parsed?.orderTicket !== undefined) setOrderTicket(String(parsed.orderTicket));
      if (parsed?.orderCloseLots !== undefined) setOrderCloseLots(String(parsed.orderCloseLots));
      if (parsed?.orderSL !== undefined) setOrderSL(String(parsed.orderSL));
      if (parsed?.orderTP !== undefined) setOrderTP(String(parsed.orderTP));
      if (parsed?.orderComment !== undefined) setOrderComment(String(parsed.orderComment));
    } catch {
      // ignore invalid cache
    }
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({
      orderAction,
      orderSide,
      orderLots,
      orderTicket,
      orderCloseLots,
      orderSL,
      orderTP,
      orderComment,
    });
    localStorage.setItem("assistant.orderForm", payload);
  }, [orderAction, orderSide, orderLots, orderTicket, orderCloseLots, orderSL, orderTP, orderComment]);

  useEffect(() => {
    const raw = localStorage.getItem("assistant.autoTrade");
    let hasStoredMinLot = false;
    let hasStoredLotStep = false;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.runtimeMode === "HEADLESS" || parsed?.runtimeMode === "BROWSER") {
          setAutoRuntimeMode(parsed.runtimeMode);
        }
        if (typeof parsed?.enabled === "boolean") setAutoTradeEnabled(parsed.enabled);
        if (parsed?.sideFilter === "BOTH" || parsed?.sideFilter === "BUY_ONLY" || parsed?.sideFilter === "SELL_ONLY") {
          setAutoSideFilter(parsed.sideFilter);
        }
        if (parsed?.minConfidence !== undefined) setAutoMinConfidence(String(parsed.minConfidence));
        if (parsed?.minWinRate !== undefined) setAutoMinWinRate(String(parsed.minWinRate));
        if (parsed?.minRR !== undefined) setAutoMinRR(String(parsed.minRR));
        if (parsed?.maxSpreadPoints !== undefined) setAutoMaxSpreadPointsSetting(String(parsed.maxSpreadPoints));
        if (parsed?.cooldownMin !== undefined) setAutoCooldownMin(sanitizeCooldownMinutes(parsed.cooldownMin, 15));
        if (parsed?.maxOpenTrades !== undefined) setAutoMaxOpenTrades(sanitizeMaxOpenTrades(parsed.maxOpenTrades, 1));
        if (typeof parsed?.requireStrong === "boolean") setAutoRequireStrongSignal(parsed.requireStrong);
        if (typeof parsed?.enforceTrendStack === "boolean") setAutoEnforceTrendStack(parsed.enforceTrendStack);
        if (typeof parsed?.enforceSymbolCooldown === "boolean") setAutoEnforceSymbolCooldown(parsed.enforceSymbolCooldown);
        if (typeof parsed?.enforceDailyLossLimit === "boolean") setAutoEnforceDailyLossLimit(parsed.enforceDailyLossLimit);
        if (typeof parsed?.enforceHardRiskBlock === "boolean") setAutoEnforceHardRiskBlock(parsed.enforceHardRiskBlock);
        if (parsed?.strategyMode === "CLASSIC_STACK" || parsed?.strategyMode === "SCALP_M15") {
          setAutoStrategyMode(parsed.strategyMode);
        }
        if (typeof parsed?.scalpAggressive === "boolean") setAutoScalpAggressive(parsed.scalpAggressive);
        if (typeof parsed?.sessionGateEnabled === "boolean") setAutoSessionGateEnabled(parsed.sessionGateEnabled);
        if (parsed?.entryTimeframe === "M15" || parsed?.entryTimeframe === "M5" || parsed?.entryTimeframe === "M1") {
          setAutoEntryTimeframe(parsed.entryTimeframe);
        } else if (parsed?.trendAlignment === "M15_H1_H4" || parsed?.trendAlignment === "M5_H1_H4") {
          setAutoEntryTimeframe(parsed.trendAlignment === "M5_H1_H4" ? "M5" : "M15");
        }
        if (parsed?.reentryMode === "OFF" || parsed?.reentryMode === "BALANCED" || parsed?.reentryMode === "STRICT") {
          setAutoReentryMode(parsed.reentryMode);
        }
        if (parsed?.timeframeOverride) setAutoTradeTimeframeOverride(parsed.timeframeOverride);
        if (parsed?.entryMode === "MARKET" || parsed?.entryMode === "LIMIT_SR") setAutoEntryMode(parsed.entryMode);
        if (typeof parsed?.allowMarketFallback === "boolean") setAutoAllowMarketFallback(parsed.allowMarketFallback);
        if (parsed?.fallbackMinConfidence !== undefined) setAutoFallbackMinConfidence(String(parsed.fallbackMinConfidence));
        if (parsed?.fallbackRrBuffer !== undefined) setAutoFallbackRrBuffer(String(parsed.fallbackRrBuffer));
        if (parsed?.botLots !== undefined) {
          const storedBotLots = Number(parsed.botLots);
          setAutoBotLots(storedBotLots === 0.1 ? AUTO_TRADE_DEFAULTS.botLots : String(parsed.botLots));
        }
        if (parsed?.riskMode === "USD" || parsed?.riskMode === "PCT") setAutoRiskMode(parsed.riskMode);
        if (typeof parsed?.useDynamicLot === "boolean") setAutoUseDynamicLot(parsed.useDynamicLot);
        if (parsed?.riskPct !== undefined) setAutoRiskPct(String(parsed.riskPct));
        if (parsed?.riskUsd !== undefined) setAutoRiskUsd(String(parsed.riskUsd));
        if (parsed?.riskGuardMult !== undefined) setAutoRiskGuardMult(String(parsed.riskGuardMult));
        if (parsed?.minSlPoints !== undefined) setAutoMinSlPoints(sanitizePositiveNumber(parsed.minSlPoints, 30, 1, 100000));
        if (parsed?.atrBufferMult !== undefined) setAutoAtrBufferMult(sanitizePositiveNumber(parsed.atrBufferMult, 0.25, 0, 10));
        if (parsed?.minLot !== undefined) {
          hasStoredMinLot = true;
          const storedMinLot = Number(parsed.minLot);
          setAutoDynamicMinLot(storedMinLot === 0.1 ? AUTO_TRADE_DEFAULTS.minLot : String(parsed.minLot));
        }
        if (parsed?.lotStep !== undefined) {
          hasStoredLotStep = true;
          setAutoDynamicLotStep(String(parsed.lotStep));
        }
        if (Array.isArray(parsed?.logs)) setAutoTradeLogs(parsed.logs);
        if (Array.isArray(parsed?.auditLogs)) setBotExecutionAuditLogs(parsed.auditLogs);

        const parsedMinConfidence = Number(parsed?.minConfidence);
        const parsedMinWinRate = Number(parsed?.minWinRate);
        const parsedMinRR = Number(parsed?.minRR);
        const parsedEntryMode = String(parsed?.entryMode || "");
        const parsedFallbackMinConfidence = Number(parsed?.fallbackMinConfidence);
        const shouldMigrateAggressivePreset =
          parsedEntryMode !== "MARKET" ||
          !Number.isFinite(parsedMinConfidence) ||
          parsedMinConfidence > 30 ||
          !Number.isFinite(parsedMinWinRate) ||
          parsedMinWinRate > 0 ||
          !Number.isFinite(parsedMinRR) ||
          parsedMinRR > 1;
        if (shouldMigrateAggressivePreset) {
          setAutoMinConfidence("30");
          setAutoMinWinRate("0");
          setAutoMinRR("1.0");
          setAutoEntryMode("MARKET");
          setAutoAllowMarketFallback(true);
          setAutoFallbackMinConfidence(
            Number.isFinite(parsedFallbackMinConfidence) && parsedFallbackMinConfidence > 0
              ? String(Math.min(parsedFallbackMinConfidence, 30))
              : "30"
          );
          setAutoRequireStrongSignal(false);
        }
      } catch {
        // ignore invalid cache
      }
    }
    if (!hasStoredMinLot) setAutoDynamicMinLot(runtimeDefaultMinLot);
    if (!hasStoredLotStep) setAutoDynamicLotStep(runtimeDefaultLotStep);
    setAutoTradeLoaded(true);
  }, [runtimeDefaultMinLot, runtimeDefaultLotStep]);

  useEffect(() => {
    if (autoStrategyMode === "SCALP_M15" && autoEntryTimeframe === "M15") {
      setAutoEntryTimeframe("M5");
    }
  }, [autoStrategyMode, autoEntryTimeframe]);

  useEffect(() => {
    if (!autoTradeLoaded) return;
    const payload = JSON.stringify({
      runtimeMode: autoRuntimeMode,
      enabled: autoTradeEnabled,
      sideFilter: autoSideFilter,
      minConfidence: autoMinConfidence,
      minWinRate: autoMinWinRate,
      minRR: autoMinRR,
      maxSpreadPoints: autoMaxSpreadPointsSetting,
      cooldownMin: autoCooldownMin,
      maxOpenTrades: sanitizeMaxOpenTrades(autoMaxOpenTrades, 1),
      requireStrong: autoRequireStrongSignal,
      enforceTrendStack: autoEnforceTrendStack,
      enforceSymbolCooldown: autoEnforceSymbolCooldown,
      enforceDailyLossLimit: autoEnforceDailyLossLimit,
      enforceHardRiskBlock: autoEnforceHardRiskBlock,
      strategyMode: autoStrategyMode,
      scalpAggressive: autoScalpAggressive,
      sessionGateEnabled: autoSessionGateEnabled,
      biasTimeframe: AUTO_BIAS_TIMEFRAME,
      setupTimeframe: AUTO_SETUP_TIMEFRAME,
      entryTimeframe: autoEntryTimeframe,
      reentryMode: autoReentryMode,
      timeframeOverride: autoTradeTimeframeOverride,
      entryMode: autoEntryMode,
      allowMarketFallback: autoAllowMarketFallback,
      fallbackMinConfidence: autoFallbackMinConfidence,
      fallbackRrBuffer: autoFallbackRrBuffer,
      botLots: autoBotLots,
      riskMode: autoRiskMode,
      useDynamicLot: autoUseDynamicLot,
      riskPct: autoRiskPct,
      riskUsd: autoRiskUsd,
      riskGuardMult: autoRiskGuardMult,
      minSlPoints: autoMinSlPoints,
      atrBufferMult: autoAtrBufferMult,
      minLot: autoDynamicMinLot,
      lotStep: autoDynamicLotStep,
      logs: autoTradeLogs.slice(0, 200),
      auditLogs: botExecutionAuditLogs.slice(0, 500),
    });
    localStorage.setItem("assistant.autoTrade", payload);
  }, [
    autoTradeEnabled,
    autoRuntimeMode,
    autoSideFilter,
    autoMinConfidence,
    autoMinWinRate,
    autoMinRR,
    autoMaxSpreadPointsSetting,
    autoCooldownMin,
    autoMaxOpenTrades,
    autoRequireStrongSignal,
    autoEnforceTrendStack,
    autoEnforceSymbolCooldown,
    autoEnforceDailyLossLimit,
    autoEnforceHardRiskBlock,
    autoStrategyMode,
    autoScalpAggressive,
    autoSessionGateEnabled,
    autoEntryTimeframe,
    autoReentryMode,
    autoTradeTimeframeOverride,
    autoEntryMode,
    autoAllowMarketFallback,
    autoFallbackMinConfidence,
    autoFallbackRrBuffer,
    autoBotLots,
    autoRiskMode,
    autoUseDynamicLot,
    autoRiskPct,
    autoRiskUsd,
    autoRiskGuardMult,
    autoMinSlPoints,
    autoAtrBufferMult,
    autoDynamicMinLot,
    autoDynamicLotStep,
    autoTradeLogs,
    botExecutionAuditLogs,
    autoTradeLoaded,
  ]);

  useEffect(() => {
    const raw = localStorage.getItem("assistant.learning");
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.enabled === "boolean") setAdaptiveLearningEnabled(parsed.enabled);
        if (Array.isArray(parsed?.blockedSymbols)) {
          setLearnedBlockedSymbols(
            parsed.blockedSymbols
              .map((value: unknown) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, ""))
              .filter(Boolean)
          );
        }
        if (Array.isArray(parsed?.blockedSessions)) {
          setLearnedBlockedSessions(
            parsed.blockedSessions.filter((value: unknown) =>
              ["ASIA", "LONDON", "OVERLAP", "NEW_YORK", "QUIET"].includes(String(value))
            ) as AdaptiveSessionKey[]
          );
        }
      } catch {
        // ignore invalid cache
      }
    }
    setAdaptiveLearningLoaded(true);
  }, []);

  useEffect(() => {
    if (!adaptiveLearningLoaded) return;
    const payload = JSON.stringify({
      enabled: adaptiveLearningEnabled,
      blockedSymbols: learnedBlockedSymbols,
      blockedSessions: learnedBlockedSessions,
      updatedAtMs: Date.now(),
    });
    localStorage.setItem("assistant.learning", payload);
  }, [adaptiveLearningEnabled, learnedBlockedSymbols, learnedBlockedSessions, adaptiveLearningLoaded]);

  useEffect(() => {
    const raw = localStorage.getItem("assistant.profile");
    if (raw && (raw === "MICRO" || raw === "STANDARD")) {
      setAccountProfile(raw);
    }
    setProfileLoaded(true);
  }, []);

  useEffect(() => {
    if (!profileLoaded) return;
    localStorage.setItem("assistant.profile", accountProfile);
  }, [accountProfile, profileLoaded]);

  useEffect(() => {
    const maxIndex = Math.max(0, panelSymbols.length - 1);
    if (riskPreviewPanelIndex > maxIndex) setRiskPreviewPanelIndex(maxIndex);
  }, [panelSymbols, riskPreviewPanelIndex]);

  useEffect(() => {
    if (!showTradeSettings) return;
    setManagedSymbolTradeDrafts({
      GOLD: buildManagedSymbolTradeDraft("GOLD", headlessRuntimeConfig),
      ETHUSD: buildManagedSymbolTradeDraft("ETHUSD", headlessRuntimeConfig),
    });
  }, [showTradeSettings, headlessRuntimeConfig]);

  useEffect(() => {
    if (!showTradeSettings) return;
    setAutoTradeDraft({
      sideFilter: autoSideFilter,
      minConfidence: autoMinConfidence,
      minWinRate: autoMinWinRate,
      minRR: autoMinRR,
      maxSpreadPoints: autoMaxSpreadPointsSetting,
      cooldownMin: autoCooldownMin,
      maxOpenTrades: sanitizeMaxOpenTrades(autoMaxOpenTrades, 1),
      requireStrong: autoRequireStrongSignal,
      enforceTrendStack: autoEnforceTrendStack,
      enforceSymbolCooldown: autoEnforceSymbolCooldown,
      enforceDailyLossLimit: autoEnforceDailyLossLimit,
      enforceHardRiskBlock: autoEnforceHardRiskBlock,
      strategyMode: autoStrategyMode,
      scalpAggressive: autoScalpAggressive,
      sessionGateEnabled: autoSessionGateEnabled,
      biasTimeframe: AUTO_BIAS_TIMEFRAME,
      setupTimeframe: AUTO_SETUP_TIMEFRAME,
      entryTimeframe: autoEntryTimeframe,
      reentryMode: autoReentryMode,
      timeframeOverride: autoTradeTimeframeOverride,
      entryMode: autoEntryMode,
      allowMarketFallback: autoAllowMarketFallback,
      fallbackMinConfidence: autoFallbackMinConfidence,
      fallbackRrBuffer: autoFallbackRrBuffer,
      botLots: autoBotLots,
      riskMode: autoRiskMode,
      useDynamicLot: autoUseDynamicLot,
      riskPct: autoRiskPct,
      riskUsd: autoRiskUsd,
      riskGuardMult: autoRiskGuardMult,
      minSlPoints: autoMinSlPoints,
      atrBufferMult: autoAtrBufferMult,
      minLot: autoDynamicMinLot,
      lotStep: autoDynamicLotStep,
    });
  }, [
    showTradeSettings,
    autoSideFilter,
    autoMinConfidence,
    autoMinWinRate,
    autoMinRR,
    autoMaxSpreadPointsSetting,
    autoCooldownMin,
    autoMaxOpenTrades,
    autoRequireStrongSignal,
    autoEnforceTrendStack,
    autoEnforceSymbolCooldown,
    autoEnforceDailyLossLimit,
    autoEnforceHardRiskBlock,
    autoStrategyMode,
    autoScalpAggressive,
    autoSessionGateEnabled,
    autoEntryTimeframe,
    autoReentryMode,
    autoTradeTimeframeOverride,
    autoEntryMode,
    autoAllowMarketFallback,
    autoFallbackMinConfidence,
    autoFallbackRrBuffer,
    autoBotLots,
    autoRiskMode,
    autoUseDynamicLot,
    autoRiskPct,
    autoRiskUsd,
    autoRiskGuardMult,
    autoMinSlPoints,
    autoAtrBufferMult,
    autoDynamicMinLot,
    autoDynamicLotStep,
  ]);

  useEffect(() => {
    if (!showTradeSettings || !autoTradeLoaded || !hasUnappliedTradeSettings) return;
    const timeoutId = window.setTimeout(() => {
      applyAutoTradeSettings(autoTradeDraft, { silent: true });
    }, 250);
    return () => window.clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTradeSettings, autoTradeLoaded, autoTradeDraft, hasUnappliedTradeSettings]);

  useEffect(() => {
    const raw = localStorage.getItem("assistant.protect");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.enabled === "boolean") setProtectEnabled(parsed.enabled);
      if (parsed?.timeframe) setProtectTimeframe(parsed.timeframe);
      if (parsed?.atrPeriod !== undefined) setProtectAtrPeriod(String(parsed.atrPeriod));
      if (parsed?.atrMult !== undefined) setProtectAtrMult(String(parsed.atrMult));
      if (parsed?.lookback !== undefined) setProtectLookback(String(parsed.lookback));
      if (parsed?.minStopPoints !== undefined) setProtectMinStopPoints(String(parsed.minStopPoints));
      if (parsed?.graceMin !== undefined) setProtectGraceMin(String(parsed.graceMin));
      if (typeof parsed?.breakEvenEnabled === "boolean") setProtectBreakEvenEnabled(parsed.breakEvenEnabled);
      if (parsed?.breakEvenR !== undefined) setProtectBreakEvenR(String(parsed.breakEvenR));
      if (parsed?.breakEvenProfitUsd !== undefined) setProtectBreakEvenProfitUsd(String(parsed.breakEvenProfitUsd));
      if (typeof parsed?.degradeCloseEnabled === "boolean") setProtectDegradeCloseEnabled(parsed.degradeCloseEnabled);
      if (parsed?.degradeMinConfidence !== undefined) setProtectDegradeMinConfidence(String(parsed.degradeMinConfidence));
      if (typeof parsed?.biasFlipProfitLockEnabled === "boolean") setProtectBiasFlipProfitLockEnabled(parsed.biasFlipProfitLockEnabled);
      if (parsed?.biasFlipTpProgressPct !== undefined) setProtectBiasFlipTpProgressPct(String(parsed.biasFlipTpProgressPct));
      if (typeof parsed?.overnightProfitRetraceLockEnabled === "boolean") {
        setProtectOvernightProfitRetraceLockEnabled(parsed.overnightProfitRetraceLockEnabled);
      }
      if (parsed?.overnightProfitRetraceArmUsd !== undefined) {
        setProtectOvernightProfitRetraceArmUsd(String(parsed.overnightProfitRetraceArmUsd));
      }
      if (parsed?.overnightProfitRetraceCloseUsd !== undefined) {
        setProtectOvernightProfitRetraceCloseUsd(String(parsed.overnightProfitRetraceCloseUsd));
      }
      if (typeof parsed?.overnightEnabled === "boolean") setProtectOvernightEnabled(parsed.overnightEnabled);
      if (parsed?.overnightProfitUsd !== undefined) setProtectOvernightProfitUsd(String(parsed.overnightProfitUsd));
      if (parsed?.overnightLossUsd !== undefined) setProtectOvernightLossUsd(String(parsed.overnightLossUsd));
    } catch {
      // ignore invalid cache
    }
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({
      enabled: protectEnabled,
      timeframe: protectTimeframe,
      atrPeriod: protectAtrPeriod,
      atrMult: protectAtrMult,
      lookback: protectLookback,
      minStopPoints: protectMinStopPoints,
      graceMin: protectGraceMin,
      breakEvenEnabled: protectBreakEvenEnabled,
      breakEvenR: protectBreakEvenR,
      breakEvenProfitUsd: protectBreakEvenProfitUsd,
      degradeCloseEnabled: protectDegradeCloseEnabled,
      degradeMinConfidence: protectDegradeMinConfidence,
      biasFlipProfitLockEnabled: protectBiasFlipProfitLockEnabled,
      biasFlipTpProgressPct: protectBiasFlipTpProgressPct,
      overnightProfitRetraceLockEnabled: protectOvernightProfitRetraceLockEnabled,
      overnightProfitRetraceArmUsd: protectOvernightProfitRetraceArmUsd,
      overnightProfitRetraceCloseUsd: protectOvernightProfitRetraceCloseUsd,
      overnightEnabled: protectOvernightEnabled,
      overnightProfitUsd: protectOvernightProfitUsd,
      overnightLossUsd: protectOvernightLossUsd,
    });
    localStorage.setItem("assistant.protect", payload);
  }, [
    protectEnabled,
    protectTimeframe,
    protectAtrPeriod,
    protectAtrMult,
    protectLookback,
    protectMinStopPoints,
    protectGraceMin,
    protectBreakEvenEnabled,
    protectBreakEvenR,
    protectBreakEvenProfitUsd,
    protectDegradeCloseEnabled,
    protectDegradeMinConfidence,
    protectBiasFlipProfitLockEnabled,
    protectBiasFlipTpProgressPct,
    protectOvernightProfitRetraceLockEnabled,
    protectOvernightProfitRetraceArmUsd,
    protectOvernightProfitRetraceCloseUsd,
    protectOvernightEnabled,
    protectOvernightProfitUsd,
    protectOvernightLossUsd,
  ]);

  useEffect(() => {
    void loadHeadlessStatus();
    const intervalId = window.setInterval(() => {
      void loadHeadlessStatus();
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [mt4BridgeBase]);

  const previousRuntimeModeRef = useRef<AutoRuntimeMode>("BROWSER");
  useEffect(() => {
    if (!autoTradeLoaded) return;
    const previousMode = previousRuntimeModeRef.current;
    previousRuntimeModeRef.current = autoRuntimeMode;
    if (previousMode === autoRuntimeMode) return;
    if (autoRuntimeMode === "HEADLESS") {
      void syncHeadlessConfig(buildHeadlessConfigPayload());
      return;
    }
    if (previousMode === "HEADLESS") {
      void syncHeadlessConfig({
        ...buildHeadlessConfigPayload(),
        auto: { ...buildHeadlessConfigPayload().auto, enabled: false },
        protect: { ...buildHeadlessConfigPayload().protect, enabled: false },
      });
    }
  }, [autoRuntimeMode, autoTradeLoaded]);

  useEffect(() => {
    if (!autoTradeLoaded || autoRuntimeMode !== "HEADLESS") return;
    void syncHeadlessConfig(buildHeadlessConfigPayload());
  }, [
    autoRuntimeMode,
    autoTradeLoaded,
    autoTradeEnabled,
    autoSideFilter,
    autoMinConfidence,
    autoMinWinRate,
    autoMinRR,
    autoMaxSpreadPointsSetting,
    autoCooldownMin,
    autoMaxOpenTrades,
    autoRequireStrongSignal,
    autoEnforceTrendStack,
    autoEnforceSymbolCooldown,
    autoEnforceDailyLossLimit,
    autoEnforceHardRiskBlock,
    autoStrategyMode,
    autoScalpAggressive,
    autoSessionGateEnabled,
    autoEntryTimeframe,
    autoTradeTimeframeOverride,
    autoEntryMode,
    autoAllowMarketFallback,
    autoFallbackMinConfidence,
    autoFallbackRrBuffer,
    autoBotLots,
    autoRiskMode,
    autoUseDynamicLot,
    autoRiskPct,
    autoRiskUsd,
    autoRiskGuardMult,
    autoMinSlPoints,
    autoAtrBufferMult,
    autoDynamicMinLot,
    autoDynamicLotStep,
    protectEnabled,
    protectTimeframe,
    protectAtrPeriod,
    protectAtrMult,
    protectLookback,
    protectMinStopPoints,
    protectGraceMin,
    protectBreakEvenEnabled,
    protectBreakEvenR,
    protectBreakEvenProfitUsd,
    protectDegradeCloseEnabled,
    protectDegradeMinConfidence,
    protectBiasFlipProfitLockEnabled,
    protectBiasFlipTpProgressPct,
    protectOvernightProfitRetraceLockEnabled,
    protectOvernightProfitRetraceArmUsd,
    protectOvernightProfitRetraceCloseUsd,
    protectOvernightEnabled,
    protectOvernightProfitUsd,
    protectOvernightLossUsd,
    panelSymbols,
    panelTimeframes,
    adaptiveLearningEnabled,
    learnedBlockedSymbols,
    learnedBlockedSessions,
  ]);

  const prevPanelsRef = useRef<{ symbols: string[]; timeframes: ChartTimeframe[] } | null>(null);
  useEffect(() => {
    const prev = prevPanelsRef.current;
    prevPanelsRef.current = { symbols: [...panelSymbols], timeframes: [...panelTimeframes] };
    if (!prev) {
      void analyzePanels();
      return;
    }
    const changedIndexes: number[] = [];
    for (let i = 0; i < panelSymbols.length; i += 1) {
      if (prev.symbols[i] !== panelSymbols[i] || prev.timeframes[i] !== panelTimeframes[i]) {
        changedIndexes.push(i);
      }
    }
    if (changedIndexes.length === 0) return;
    void Promise.all(changedIndexes.map((i) => analyzePanelIndex(i)));
  }, [panelSymbols, panelTimeframes]);

  useEffect(() => {
    void analyzePanels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStrategyMode, autoEntryTimeframe, autoScalpAggressive]);

  useEffect(() => {
    const loadSymbolSpec = async () => {
      try {
        const response = await fetch(
          `${mt4BridgeBase}/symbols?symbol=${encodeURIComponent(resolveOrderSymbol(selectedSymbol))}`,
          { method: "GET" }
        );
        const data = await response.json();
        if (response.ok && data?.ok && data?.spec) {
          setSymbolSpec(data.spec);
        } else {
          setSymbolSpec(null);
        }
      } catch {
        setSymbolSpec(null);
      }
    };
    void loadSymbolSpec();
  }, [mt4BridgeBase, selectedSymbol, accountProfile, mt4SymbolMapRaw, mt4SymbolSuffix, mt4CryptoSuffix]);

  useEffect(() => {
    let cancelled = false;
    const refreshLivePanelQuotes = async () => {
      if (document.hidden) return;
      const symbols = Array.from(new Set(panelSymbols.filter(Boolean)));
      const quotes = await Promise.all(
        symbols.map(async (symbol) => {
          const tick = await fetchMt4Tick(symbol);
          return tick ? ([symbol, tick] as const) : null;
        })
      );
      if (cancelled) return;
      setLivePanelQuotes((previous) => {
        const next = { ...previous };
        quotes.forEach((entry) => {
          if (entry) next[entry[0]] = entry[1];
        });
        return next;
      });
    };

    void refreshLivePanelQuotes();
    const intervalId = window.setInterval(() => {
      void refreshLivePanelQuotes();
    }, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [panelSymbols, mt4BridgeBase, mt4SymbolMapRaw, mt4SymbolSuffix, mt4CryptoSuffix]);

  useEffect(() => {
    let cancelled = false;
    const calculateRiskSettingsPreview = async () => {
      const previewTimeframeOverride = autoTradeDraft.timeframeOverride;
      const previewBotLots = Math.max(0, Number(autoTradeDraft.botLots) || 0);
      const previewUseDynamicLot = Boolean(autoTradeDraft.useDynamicLot);
      const previewRiskMode = autoTradeDraft.riskMode;
      const previewRiskPct = Math.max(0.01, Number(autoTradeDraft.riskPct) || 0);
      const previewRiskUsd = Math.max(0.01, Number(autoTradeDraft.riskUsd) || 0);
      const previewMinLot = Math.max(0.001, Number(autoTradeDraft.minLot) || 0.01);
      const previewLotStep = Math.max(0.001, Number(autoTradeDraft.lotStep) || 0.01);

      const panelCount = Math.max(1, panelSymbols.length);
      const selectedIndex = Math.max(0, Math.min(riskPreviewPanelIndex, panelCount - 1));
      const panelSymbol = panelSymbols[selectedIndex] || selectedSymbol;
      const panelTimeframe = panelTimeframes[selectedIndex] || "D1";
      const timeframe =
        previewTimeframeOverride && previewTimeframeOverride !== "PANEL"
          ? previewTimeframeOverride
          : panelTimeframe;

      let signal: TradeSignal | null = null;
      const panelKey = `${panelSymbol}|${panelTimeframe}`;
      const panel = panelAnalysis[panelKey];
      if (panel?.tradeSignal && timeframe === panelTimeframe) {
        signal = panel.tradeSignal;
      } else {
        const data = await generatePriceData(panelSymbol, timeframe);
        if (data) signal = generateTradeSignal(data);
      }

      if (!signal || signal.signal === "HOLD") {
        setRiskSettingsPreview(null);
        return;
      }

      const resolvedSymbol = resolveOrderSymbol(panelSymbol);
      let specTickValue = 0;
      let specTickSize = 0;
      try {
        const specResponse = await fetch(`${mt4BridgeBase}/symbols?symbol=${encodeURIComponent(resolvedSymbol)}`, {
          method: "GET",
        });
        const specData = await specResponse.json();
        if (specResponse.ok && specData?.ok && specData?.spec) {
          specTickValue = Number(specData.spec.tickValue || 0);
          specTickSize = Number(specData.spec.tickSize || 0);
        }
      } catch {
        // ignore
      }
      if (!Number.isFinite(specTickValue) || specTickValue <= 0 || !Number.isFinite(specTickSize) || specTickSize <= 0) {
        setRiskSettingsPreview(null);
        return;
      }

      let tick = await fetchMt4Tick(resolvedSymbol);
      if (!tick) tick = await fetchMt4Tick(panelSymbol);

      const entryFallback = Number(signal.entryPoints.primary || 0);
      const entry = tick ? (signal.signal === "BUY" ? Number(tick.ask) : Number(tick.bid)) : entryFallback;
      const sl = Number(signal.stopLoss);
      const tp = Number(signal.takeProfit);
      if (!Number.isFinite(entry) || !Number.isFinite(sl) || !Number.isFinite(tp) || entry <= 0) {
        setRiskSettingsPreview(null);
        return;
      }

      const slDistance = Math.abs(entry - sl);
      const tpDistance = Math.abs(tp - entry);
      if (!Number.isFinite(slDistance) || !Number.isFinite(tpDistance) || slDistance <= 0 || tpDistance <= 0) {
        setRiskSettingsPreview(null);
        return;
      }

      let lots = previewBotLots;
      let targetRisk = 0;
      let rawLots = previewBotLots;
      let lotStatus: "OK" | "BELOW_MIN" | "CAPPED" = "OK";
      if (previewUseDynamicLot) {
        let accountRiskBase = 0;
        try {
          const accountResponse = await fetch(`${mt4BridgeBase}/account`, { method: "GET" });
          const accountData = await accountResponse.json();
          if (accountResponse.ok && accountData?.ok && accountData?.account) {
            const balance = Number(accountData.account.balance || 0);
            const equity = Number(accountData.account.equity || 0);
            const candidate = equity > 0 ? Math.min(balance > 0 ? balance : equity, equity) : balance;
            accountRiskBase = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
          }
        } catch {
          accountRiskBase = 0;
        }
        if (accountRiskBase > 0) {
          const riskAmount = previewRiskMode === "USD" ? previewRiskUsd : accountRiskBase * (previewRiskPct / 100);
          targetRisk = riskAmount;
          const riskPerLot = (slDistance / specTickSize) * specTickValue;
          const minLot = previewMinLot;
          const lotStep = previewLotStep;
          const cap = previewBotLots;
          rawLots = riskPerLot > 0 ? riskAmount / riskPerLot : 0;
          if (Number.isFinite(rawLots) && rawLots > 0) {
            if (rawLots < minLot) lotStatus = "BELOW_MIN";
            const stepped = Math.floor(rawLots / lotStep) * lotStep;
            const normalizedCap = Number.isFinite(cap) && cap > 0 ? cap : 5;
            const decimals = Math.max(2, String(lotStep).split(".")[1]?.length || 0);
            if (stepped > normalizedCap) lotStatus = "CAPPED";
            lots = rawLots < minLot ? minLot : Number(Math.min(normalizedCap, stepped).toFixed(decimals));
          }
        }
      } else {
        targetRisk = previewRiskMode === "USD" ? previewRiskUsd : 0;
      }

      if (!Number.isFinite(lots) || lots <= 0) {
        setRiskSettingsPreview(null);
        return;
      }

      const moneyPerPricePerLot = specTickValue / specTickSize;
      const spread = tick ? Math.max(0, Number(tick.ask) - Number(tick.bid)) : 0;
      const spreadCost = spread * moneyPerPricePerLot * lots;
      const riskAtSL = slDistance * moneyPerPricePerLot * lots;
      const rewardAtTP = tpDistance * moneyPerPricePerLot * lots;

      const pointSize = getPointSizeForSymbol(panelSymbol, entry);
      const pipSize = getPipSizeForSymbol(panelSymbol, entry);
      const slPoints = pointSize > 0 ? slDistance / pointSize : 0;
      const tpPoints = pointSize > 0 ? tpDistance / pointSize : 0;
      const slPips = pipSize > 0 ? slDistance / pipSize : 0;
      const tpPips = pipSize > 0 ? tpDistance / pipSize : 0;

      if (cancelled) return;
      setRiskSettingsPreview({
        symbol: resolvedSymbol,
        timeframe,
        side: signal.signal,
        entry,
        sl,
        tp,
        lots,
        spreadCost,
        riskAtSL,
        rewardAtTP,
        rr: riskAtSL > 0 ? rewardAtTP / riskAtSL : 0,
        slPoints,
        tpPoints,
        slPips,
        tpPips,
        pipLabel: isCryptoSymbol(panelSymbol) ? "price units" : "pips",
        targetRisk,
        rawLots,
        lotStatus,
      });
    };

    void calculateRiskSettingsPreview();
    return () => {
      cancelled = true;
    };
  }, [
    panelSymbols,
    panelTimeframes,
    riskPreviewPanelIndex,
    autoTradeDraft.timeframeOverride,
    autoTradeDraft.botLots,
    autoTradeDraft.useDynamicLot,
    autoTradeDraft.riskMode,
    autoTradeDraft.riskPct,
    autoTradeDraft.riskUsd,
    autoTradeDraft.minLot,
    autoTradeDraft.lotStep,
    panelAnalysis,
    selectedSymbol,
    mt4BridgeBase,
  ]);

  const autoTradeStartedRef = useRef(false);
  const getPanelsIntervalMs = (timeframes: ChartTimeframe[]) => {
    if (!timeframes.length) return getWatchIntervalMs("M15");
    return Math.min(...timeframes.map((tf) => getWatchIntervalMs(tf)));
  };

  useEffect(() => {
    if (!autoTradeEnabled) {
      autoTradeStartedRef.current = false;
      return;
    }
    const tick = () => {
      void analyzePanels();
    };
    if (!autoTradeStartedRef.current) {
      autoTradeStartedRef.current = true;
      tick();
    }
    const intervalMs =
      autoTradeTimeframeOverride && autoTradeTimeframeOverride !== "PANEL"
        ? getWatchIntervalMs(autoTradeTimeframeOverride)
        : getPanelsIntervalMs(panelTimeframes);
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      tick();
    }, intervalMs);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTradeEnabled, panelTimeframes, panelSymbols, autoTradeTimeframeOverride]);

  useEffect(() => {
    void analyzeWatchlistBoard();
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void analyzeWatchlistBoard();
    }, getWatchlistBoardIntervalMs(watchlistBoardTimeframe));
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchlistBoardTimeframe]);

  const getSignalColor = (signal: "BUY" | "SELL" | "HOLD") => {
    switch (signal) {
      case "BUY":
        return "text-emerald-400";
      case "SELL":
        return "text-rose-400";
      default:
        return "text-slate-400";
    }
  };
  const getSignalSurfaceClass = (signal: "BUY" | "SELL" | "HOLD") => {
    switch (signal) {
      case "BUY":
        return "border-emerald-500/40 bg-emerald-500/10 hover:border-emerald-400/70";
      case "SELL":
        return "border-rose-500/40 bg-rose-500/10 hover:border-rose-400/70";
      default:
        return "border-slate-700/80 bg-slate-900/70 hover:border-slate-500/80";
    }
  };
  const getPercentTone = (value: number) => {
    if (value >= 70) return "text-emerald-300";
    if (value >= 60) return "text-amber-300";
    return "text-rose-300";
  };
  const getNoiseTone = (value: TradeSignal["noiseState"]) => {
    switch (value) {
      case "LOW":
        return "text-emerald-300";
      case "MEDIUM":
        return "text-amber-300";
      default:
        return "text-rose-300";
    }
  };
  const doesWatchlistSignalPassCriteria = (signal: TradeSignal | null | undefined) => {
    if (!signal) return false;
    if (signal.signal !== "BUY" && signal.signal !== "SELL") return false;
    const strengthPass = autoRequireStrongSignal ? signal.strength === "STRONG" : signal.strength !== "WEAK";
    const confidencePass = signal.confidence >= Math.max(0, Number(autoMinConfidence) || 0);
    const configuredMinWinRate = Math.max(0, Number(autoMinWinRate) || 0);
    const winRatePass = configuredMinWinRate <= 0 || signal.winRate >= configuredMinWinRate;
    return strengthPass && confidencePass && winRatePass;
  };

  const loadOpenPositions = async () => {
    try {
      const response = await fetch(`${mt4BridgeBase}/orders/open`, { method: "GET" });
      const data = await readResponseJsonSafe(response);
      if (response.ok && data?.ok && Array.isArray(data.positions)) {
        const positions = data.positions as OpenPosition[];
        setOpenPositions(positions);

        const nextProjections: Record<number, OpenPositionProjection> = {};
        const readSpec = async (symbol: string) => {
          try {
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const specResponse = await fetch(
                `${mt4BridgeBase}/symbols?symbol=${encodeURIComponent(symbol)}`,
                { method: "GET" }
              );
              const specData = await readResponseJsonSafe(specResponse);
              if (specResponse.ok && specData?.ok && specData?.spec) {
                return specData.spec as {
                  symbol: string;
                  lotSize: number;
                  point: number;
                  tickValue: number;
                  tickSize: number;
                };
              }
              if (attempt < 1) {
                await new Promise((r) => setTimeout(r, 80));
              }
            }
            return null;
          } catch {
            return null;
          }
        };
        const readAllSpecs = async () => {
          try {
            for (let attempt = 0; attempt < 2; attempt += 1) {
              const specResponse = await fetch(`${mt4BridgeBase}/symbols`, { method: "GET" });
              const specData = await readResponseJsonSafe(specResponse);
              if (specResponse.ok && specData?.ok && Array.isArray(specData?.specs)) {
                return specData.specs as Array<{
                  symbol: string;
                  lotSize: number;
                  point: number;
                  tickValue: number;
                  tickSize: number;
                }>;
              }
              if (attempt < 1) {
                await new Promise((r) => setTimeout(r, 80));
              }
            }
            return [] as Array<{
              symbol: string;
              lotSize: number;
              point: number;
              tickValue: number;
              tickSize: number;
            }>;
          } catch {
            return [] as Array<{
              symbol: string;
              lotSize: number;
              point: number;
              tickValue: number;
              tickSize: number;
            }>;
          }
        };
        const allSpecs = await readAllSpecs();
        const normalizeSpecToken = (value: string) => normalizeSymbol(String(value || "")).replace(/M$/, "");
        const pickSpecFromSnapshot = (symbol: string) => {
          if (!allSpecs.length) return null;
          const candidates = [
            symbol,
            resolveOrderSymbol(symbol),
            normalizeSymbol(symbol),
            normalizeSpecToken(symbol),
          ].filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx);
          const normalizedCandidates = candidates.map((candidate) => normalizeSpecToken(candidate));
          for (const candidate of normalizedCandidates) {
            const exact = allSpecs.find((spec) => normalizeSpecToken(spec.symbol) === candidate);
            if (exact) return exact;
          }
          for (const candidate of normalizedCandidates) {
            const prefix = allSpecs.find((spec) => {
              const token = normalizeSpecToken(spec.symbol);
              return token.startsWith(candidate) || candidate.startsWith(token);
            });
            if (prefix) return prefix;
          }
          return null;
        };
        await Promise.all(
          positions.map(async (position) => {
            try {
              const symbolFromPosition = String(position.symbol || "");
              const normalizedNoSuffix = normalizeSymbol(symbolFromPosition).replace(/M$/, "");
              const specCandidates = [
                symbolFromPosition,
                resolveOrderSymbol(symbolFromPosition),
                normalizedNoSuffix,
              ].filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx);
              let spec: {
                symbol: string;
                lotSize: number;
                point: number;
                tickValue: number;
                tickSize: number;
              } | null = pickSpecFromSnapshot(symbolFromPosition);
              if (!spec) {
                for (const candidate of specCandidates) {
                  spec = await readSpec(candidate);
                  if (spec) break;
                }
              }
              if (!spec) return;

              const tickValue = Number(spec.tickValue || 0);
              const tickSize = Number(spec.tickSize || 0);
              const lotSize = Number(spec.lotSize || 0);
              const point = Number(spec.point || 0);
              let moneyPerPricePerLot = 0;
              if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(tickSize) && tickSize > 0) {
                moneyPerPricePerLot = tickValue / tickSize;
              } else if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(point) && point > 0) {
                moneyPerPricePerLot = tickValue / point;
              } else if (Number.isFinite(lotSize) && lotSize > 0) {
                // Fallback estimate for symbols with incomplete tick spec.
                moneyPerPricePerLot = lotSize;
              }
              if (!Number.isFinite(moneyPerPricePerLot) || moneyPerPricePerLot <= 0) return;

              const side = String(position.type || "").toUpperCase();
              const entry = Number(position.openPrice);
              const sl = Number(position.sl);
              const tp = Number(position.tp);
              const lots = Number(position.lots);
              const ticket = Number(position.ticket);
              if (!Number.isFinite(ticket) || ticket <= 0) return;
              if (!Number.isFinite(entry) || !Number.isFinite(lots) || lots <= 0) return;

              const signedPnl = (exitPrice: number): number => {
                if (!Number.isFinite(exitPrice) || exitPrice <= 0) return 0;
                if (side === "BUY") return (exitPrice - entry) * moneyPerPricePerLot * lots;
                if (side === "SELL") return (entry - exitPrice) * moneyPerPricePerLot * lots;
                return 0;
              };

              nextProjections[ticket] = {
                atSl: signedPnl(sl),
                atTp: signedPnl(tp),
              };
            } catch {
              // ignore projection errors per position
            }
          })
        );
        setOpenPositionProjections((prev) => {
          const next: Record<number, OpenPositionProjection> = {};
          for (const position of positions) {
            const ticket = Number(position.ticket);
            if (!Number.isFinite(ticket) || ticket <= 0) continue;
            if (nextProjections[ticket]) {
              next[ticket] = nextProjections[ticket];
              continue;
            }
            // Keep last known projection for active ticket if current recompute failed.
            if (prev[ticket]) {
              next[ticket] = prev[ticket];
            }
          }
          return next;
        });
      }
    } catch {
      // bridge not running or unavailable
    }
  };

  const applyProtectiveTrail = async () => {
    if (isHeadlessMode || (!protectEnabled && !protectOvernightEnabled) || protectBusyRef.current || tradeBridgeBusy || tradeCommandBusyRef.current) return;
    protectBusyRef.current = true;

    const atrPeriod = Math.max(2, Number(protectAtrPeriod) || 14);
    const atrMult = Math.max(0.5, Number(protectAtrMult) || 1.5);
    const lookback = Math.max(3, Number(protectLookback) || 14);
    const minStopPoints = Math.max(0, Number(protectMinStopPoints) || 0);
    const graceMin = Math.max(0, Number(protectGraceMin) || 0);
    const breakEvenEnabled = protectBreakEvenEnabled;
    const breakEvenR = Math.max(0.1, Number(protectBreakEvenR) || 1.0);
    const breakEvenProfitUsd = Math.max(0.01, Number(protectBreakEvenProfitUsd) || 0.3);
    const degradeCloseEnabled = protectDegradeCloseEnabled;
    const degradeMinConfidence = Math.max(0, Math.min(100, Number(protectDegradeMinConfidence) || 82));
    const biasFlipProfitLockEnabled = protectBiasFlipProfitLockEnabled;
    const biasFlipTpProgressPct = Math.max(1, Math.min(100, Number(protectBiasFlipTpProgressPct) || 35));
    const overnightProfitRetraceLockEnabled = protectOvernightProfitRetraceLockEnabled;
    const overnightProfitRetraceArmUsd = Math.max(0.01, Number(protectOvernightProfitRetraceArmUsd) || 0.8);
    const overnightProfitRetraceCloseUsd = Math.max(0.01, Number(protectOvernightProfitRetraceCloseUsd) || 0.4);
    const overnightEnabled = protectOvernightEnabled;
    const overnightProfitUsd = Math.max(0.01, Number(protectOvernightProfitUsd) || 1.1);
    const overnightLossUsd = Math.max(0.01, Number(protectOvernightLossUsd) || 1.2);
    const graceMs = graceMin * 60 * 1000;
    const signalCache: Record<string, TradeSignal | null> = {};
    const specCache: Record<
      string,
      {
        symbol: string;
        lotSize: number;
        point: number;
        tickValue: number;
        tickSize: number;
      } | null
    > = {};

    const executeAction = async (payload: Record<string, unknown>) => {
      // Check for duplicate orders BEFORE executing (don't register yet)
      const duplicateReason = checkOrderDuplicate(payload);
      if (duplicateReason) {
        tradeCommandBusyRef.current = false;
        return { ok: false as const, reason: duplicateReason };
      }

      tradeCommandBusyRef.current = true;
      try {
        const prepareResponse = await fetch(`${mt4BridgeBase}/orders/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const prepareData = await readResponseJsonSafe(prepareResponse);
        if (!prepareResponse.ok || !prepareData?.ok) {
          const reason =
            prepareData?.error ||
            prepareData?.message ||
            (prepareResponse.ok ? "prepare failed" : `prepare failed (${prepareResponse.status})`);
          return { ok: false as const, reason };
        }

        const confirmResponse = await fetch(`${mt4BridgeBase}/orders/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: prepareData.requestId,
            confirmToken: prepareData.confirmToken,
          }),
        });
        const confirmData = await readResponseJsonSafe(confirmResponse);
        if (!confirmResponse.ok || !confirmData?.ok) {
          const reason =
            confirmData?.message ||
            confirmData?.error ||
            (confirmResponse.ok ? "execution failed" : `execution failed (${confirmResponse.status})`);
          return { ok: false as const, reason };
        }

        registerOrderExecution(payload);
        clearRegisteredOrder(payload);
        return { ok: true as const };
      } finally {
        tradeCommandBusyRef.current = false;
      }
    };

    const readSpec = async (symbol: string) => {
      if (Object.prototype.hasOwnProperty.call(specCache, symbol)) {
        return specCache[symbol];
      }
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const specResponse = await fetch(`${mt4BridgeBase}/symbols?symbol=${encodeURIComponent(symbol)}`, { method: "GET" });
          const specData = await readResponseJsonSafe(specResponse);
          if (specResponse.ok && specData?.ok && specData?.spec) {
            specCache[symbol] = specData.spec as {
              symbol: string;
              lotSize: number;
              point: number;
              tickValue: number;
              tickSize: number;
            };
            return specCache[symbol];
          }
          if (attempt < 1) {
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
        }
      } catch {
        // ignore spec lookup errors
      }
      specCache[symbol] = null;
      return null;
    };

    try {
      const openResponse = await fetch(`${mt4BridgeBase}/orders/open`, { method: "GET" });
      const openData = await readResponseJsonSafe(openResponse);
      const positions = openResponse.ok && openData?.ok && Array.isArray(openData.positions)
        ? (openData.positions as OpenPosition[])
        : [];

      if (!positions.length) {
        overnightProfitRetraceStateRef.current = {};
        return;
      }

      const openTicketSet = new Set(positions.map((position) => Number(position.ticket)));
      Object.keys(overnightProfitRetraceStateRef.current).forEach((ticket) => {
        if (!openTicketSet.has(Number(ticket))) {
          delete overnightProfitRetraceStateRef.current[Number(ticket)];
        }
      });

      const updates: string[] = [];
      const closures: string[] = [];
      const failures: string[] = [];

      for (const position of positions) {
        const symbol = position.symbol;
        const side = String(position.type || "").toUpperCase();
        if (side !== "BUY" && side !== "SELL") continue;

        const tick = await fetchMt4Tick(symbol);
        let floatingPnl = Number.NaN;
        if (tick) {
          const spec = await readSpec(symbol);
          const entry = Number(position.openPrice);
          const lots = Number(position.lots);
          if (spec && Number.isFinite(entry) && entry > 0 && Number.isFinite(lots) && lots > 0) {
            const tickValue = Number(spec.tickValue || 0);
            const tickSize = Number(spec.tickSize || 0);
            const point = Number(spec.point || 0);
            const lotSize = Number(spec.lotSize || 0);
            let moneyPerPricePerLot = 0;
            if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(tickSize) && tickSize > 0) {
              moneyPerPricePerLot = tickValue / tickSize;
            } else if (Number.isFinite(tickValue) && tickValue > 0 && Number.isFinite(point) && point > 0) {
              moneyPerPricePerLot = tickValue / point;
            } else if (Number.isFinite(lotSize) && lotSize > 0) {
              moneyPerPricePerLot = lotSize;
            }
            const closePrice = side === "BUY" ? tick.bid : tick.ask;
            floatingPnl =
              side === "BUY"
                ? (closePrice - entry) * moneyPerPricePerLot * lots
                : (entry - closePrice) * moneyPerPricePerLot * lots;
            if (overnightEnabled && Number.isFinite(floatingPnl)) {
              const retraceState = overnightProfitRetraceStateRef.current[position.ticket] || {
                armed: false,
                peakProfitUsd: Number.NEGATIVE_INFINITY,
              };
              retraceState.peakProfitUsd = Math.max(retraceState.peakProfitUsd, floatingPnl);
              if (!retraceState.armed && retraceState.peakProfitUsd >= overnightProfitRetraceArmUsd) {
                retraceState.armed = true;
              }
              overnightProfitRetraceStateRef.current[position.ticket] = retraceState;
            }
            if (overnightEnabled && Number.isFinite(floatingPnl) && floatingPnl <= -overnightLossUsd) {
              const closeAction = await executeAction({
                action: "CLOSE",
                ticket: position.ticket,
                lots: position.lots,
              });
              if (closeAction.ok) {
                closures.push(
                  `${symbol} #${position.ticket} closed by overnight loss cap (-$${Math.abs(floatingPnl).toFixed(2)} >= $${overnightLossUsd.toFixed(2)})`
                );
                continue;
              }
              failures.push(`${symbol}: ${closeAction.reason || "overnight loss close failed"}`);
            }
            if (overnightEnabled && Number.isFinite(floatingPnl) && floatingPnl >= overnightProfitUsd) {
              const closeAction = await executeAction({
                action: "CLOSE",
                ticket: position.ticket,
                lots: position.lots,
              });
              if (closeAction.ok) {
                closures.push(
                  `${symbol} #${position.ticket} closed by overnight target (+$${floatingPnl.toFixed(2)} >= $${overnightProfitUsd.toFixed(2)})`
                );
                continue;
              }
              failures.push(`${symbol}: ${closeAction.reason || "overnight close failed"}`);
            }
            const retraceState = overnightProfitRetraceStateRef.current[position.ticket];
            if (
              overnightEnabled &&
              overnightProfitRetraceLockEnabled &&
              retraceState?.armed &&
              Number.isFinite(floatingPnl) &&
              floatingPnl > 0 &&
              floatingPnl <= overnightProfitRetraceCloseUsd
            ) {
              const closeAction = await executeAction({
                action: "CLOSE",
                ticket: position.ticket,
                lots: position.lots,
              });
              if (closeAction.ok) {
                closures.push(
                  `${symbol} #${position.ticket} closed by overnight retrace lock (armed at +$${overnightProfitRetraceArmUsd.toFixed(2)}, retraced to +$${floatingPnl.toFixed(2)})`
                );
                delete overnightProfitRetraceStateRef.current[position.ticket];
                continue;
              }
              failures.push(`${symbol}: ${closeAction.reason || "overnight retrace close failed"}`);
            }
          }
        }

        const missingProtectionPlan = await buildMissingProtectionPlan(position, side, tick);
        if (missingProtectionPlan) {
          const missingLabel =
            !(Number(position.sl) > 0) && !(Number(position.tp) > 0)
              ? "SL/TP"
              : !(Number(position.sl) > 0)
              ? "SL"
              : "TP";
          const autofillAction = await executeAction({
            action: "MODIFY",
            ticket: position.ticket,
            sl: missingProtectionPlan.sl,
            tp: missingProtectionPlan.tp,
          });
          if (autofillAction.ok) {
            updates.push(
              `${symbol} #${position.ticket} auto-filled ${missingLabel} via ${missingProtectionPlan.managedSymbol} ${missingProtectionPlan.timeframe} (${missingProtectionPlan.tpSource.toLowerCase()} TP, R:R ${missingProtectionPlan.rr.toFixed(2)})`
            );
            continue;
          }
          failures.push(`${symbol}: ${autofillAction.reason || "missing SL/TP autofill failed"}`);
        }

        if (breakEvenEnabled && tick && Number.isFinite(tick.mid)) {
          const current = Number(tick.mid);
          const pointSize = getPointSizeForSymbol(symbol, current);
          const minDistance = minStopPoints * pointSize;
          const entry = Number(position.openPrice);
          const currentSl = Number(position.sl);
          const hasValidEntry = Number.isFinite(entry) && entry > 0;
          const hasValidSl = Number.isFinite(currentSl) && currentSl > 0;
          if (hasValidEntry && hasValidSl) {
            const originalRiskDistance = side === "BUY" ? entry - currentSl : currentSl - entry;
            const favorableDistance = side === "BUY" ? current - entry : entry - current;
            const beReadyByR =
              Number.isFinite(originalRiskDistance) &&
              originalRiskDistance > 0 &&
              Number.isFinite(favorableDistance) &&
              favorableDistance >= originalRiskDistance * breakEvenR;
            const beReadyByUsd = overnightEnabled && Number.isFinite(floatingPnl) && floatingPnl >= breakEvenProfitUsd;
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
                const beAction = await executeAction({
                  action: "MODIFY",
                  ticket: position.ticket,
                  sl: beSl,
                  ...(Number(position.tp) > 0 ? { tp: Number(position.tp) } : {}),
                });
                if (beAction.ok) {
                  updates.push(`${symbol} SL -> BE @ ${beSl.toFixed(isCryptoSymbol(symbol) ? 2 : 5)}`);
                  continue;
                }
                failures.push(`${symbol}: ${beAction.reason || "break-even modify failed"}`);
              }
            }
          }
        }

        if (position.openTime && Date.now() - position.openTime * 1000 < graceMs) {
          continue;
        }

        if (!protectEnabled) {
          continue;
        }

        const candles = await fetchMt4Candles(symbol, protectTimeframe, Math.max(lookback + atrPeriod + 5, 60));
        if (candles.length < lookback + 5) continue;

        const atr = computeAtr(candles, atrPeriod);
        if (!Number.isFinite(atr) || atr <= 0) continue;

        const closes = candles.map((c) => c.close);
        const recentCloses = closes.slice(-lookback);
        const highestClose = Math.max(...recentCloses);
        const lowestClose = Math.min(...recentCloses);

        const current = tick?.mid ?? closes[closes.length - 1];
        if (!Number.isFinite(current)) continue;
        const pointSize = getPointSizeForSymbol(symbol, current);
        const minDistance = minStopPoints * pointSize;
        const entry = Number(position.openPrice);

        if (degradeCloseEnabled) {
          const normalizedPosition = normalizeSymbol(symbol);
          const matchedBase = WATCHLIST_BASE_SYMBOLS.find((base) =>
            normalizedPosition.startsWith(normalizeSymbol(base))
          );
          const signalKey = `${matchedBase || normalizedPosition}|${protectTimeframe}`;
          let protectSignal = signalCache[signalKey];
          if (protectSignal === undefined) {
            const protectData = await generatePriceData(matchedBase || normalizedPosition, protectTimeframe);
            protectSignal = protectData ? generateTradeSignal(protectData) : null;
            signalCache[signalKey] = protectSignal;
          }
          const isOpposite =
            protectSignal &&
            (protectSignal.signal === "BUY" || protectSignal.signal === "SELL") &&
            ((side === "BUY" && protectSignal.signal === "SELL") ||
              (side === "SELL" && protectSignal.signal === "BUY"));
          if (isOpposite && (protectSignal?.confidence || 0) >= degradeMinConfidence) {
            const tpDistance = side === "BUY" ? Number(position.tp) - entry : entry - Number(position.tp);
            const favorableDistance = side === "BUY" ? current - entry : entry - current;
            const tpProgressPct =
              Number.isFinite(tpDistance) && tpDistance > 0 && Number.isFinite(favorableDistance)
                ? (favorableDistance / tpDistance) * 100
                : Number.NaN;
            const eligibleForProfitLock =
              biasFlipProfitLockEnabled &&
              Number.isFinite(floatingPnl) &&
              floatingPnl > 0 &&
              Number.isFinite(tpProgressPct) &&
              tpProgressPct >= biasFlipTpProgressPct;

            if (eligibleForProfitLock || !biasFlipProfitLockEnabled) {
              const closeAction = await executeAction({
                action: "CLOSE",
                ticket: position.ticket,
                lots: position.lots,
              });
              if (closeAction.ok) {
                closures.push(
                  eligibleForProfitLock
                    ? `${symbol} #${position.ticket} closed by bias-flip profit lock (${tpProgressPct.toFixed(0)}% TP progress, opposite ${protectSignal?.signal} ${protectSignal?.confidence.toFixed(0)}%)`
                    : `${symbol} #${position.ticket} closed (opposite ${protectSignal?.signal} ${protectSignal?.confidence.toFixed(0)}%)`
                );
                continue;
              }
              failures.push(`${symbol}: ${closeAction.reason || "close failed"}`);
            }
          }
        }

        let nextSl: number | null = null;
        if (side === "BUY") {
          const trail = highestClose - atrMult * atr;
          if (trail <= position.openPrice) continue;
          if (tick && trail >= tick.bid) continue;
          if (position.sl && trail <= position.sl) continue;
          if (minDistance > 0 && current - trail < minDistance) continue;
          nextSl = trail;
        } else {
          const trail = lowestClose + atrMult * atr;
          if (trail >= position.openPrice) continue;
          if (tick && trail <= tick.ask) continue;
          if (position.sl && trail >= position.sl) continue;
          if (minDistance > 0 && trail - current < minDistance) continue;
          nextSl = trail;
        }

        if (!nextSl || !Number.isFinite(nextSl)) continue;

        const trailAction = await executeAction({
          action: "MODIFY",
          ticket: position.ticket,
          sl: nextSl,
          ...(Number(position.tp) > 0 ? { tp: Number(position.tp) } : {}),
        });
        if (!trailAction.ok) {
          failures.push(`${position.symbol}: ${trailAction.reason || "trailing modify failed"}`);
          continue;
        }
        updates.push(`${position.symbol} SL -> ${nextSl.toFixed(isCryptoSymbol(symbol) ? 2 : 5)}`);
      }

      if (updates.length || closures.length) {
        const parts = [
          updates.length ? `updates ${updates.join(" | ")}` : "",
          closures.length ? `closures ${closures.join(" | ")}` : "",
        ].filter(Boolean);
        const msg = `Auto protect applied: ${parts.join(" ; ")}`;
        setProtectStatus(msg);
        pushAutoTradeLog("INFO", msg);
      } else if (failures.length) {
        const msg = `Auto protect warnings: ${failures.join(" | ")}`;
        setProtectStatus(msg);
        pushAutoTradeLog("WARN", msg);
      } else {
        setProtectStatus("Auto protect: no trailing updates");
      }
    } catch (error) {
      const msg = error instanceof Error ? `Auto protect error: ${error.message}` : "Auto protect error";
      setProtectStatus(msg);
      pushAutoTradeLog("ERROR", msg);
    } finally {
      tradeCommandBusyRef.current = false;
      protectBusyRef.current = false;
    }
  };

  const analyzePanels = async () => {
    const symbolsSnapshot = [...panelSymbols];
    const timeframesSnapshot = [...panelTimeframes];
    const next: Record<string, { priceData: PriceData | null; tradeSignal: TradeSignal | null } | null> = {};
    const nextStrategy: Record<string, PanelStrategyIndicators | null> = {};
    await Promise.all(
      symbolsSnapshot.map(async (symbol, index) => {
        const timeframe = timeframesSnapshot[index] || "D1";
        const key = `${symbol}|${timeframe}`;
        setPanelLoading((prev) => ({ ...prev, [key]: true }));
        try {
          const data = await generatePriceData(symbol, timeframe);
          if (!data) {
            next[key] = null;
            nextStrategy[key] = null;
            return;
          }
          const signal = generateTradeSignal(data);
          next[key] = { priceData: data, tradeSignal: signal };
          nextStrategy[key] = await buildPanelStrategyIndicators(symbol, timeframe, data);
        } catch {
          next[key] = null;
          nextStrategy[key] = null;
        } finally {
          setPanelLoading((prev) => ({ ...prev, [key]: false }));
        }
      })
    );
    setPanelAnalysis((prev) => {
      const merged = { ...prev };
      Object.entries(next).forEach(([key, value]) => {
        if (value) {
          merged[key] = value;
          return;
        }
        if (!merged[key]) {
          merged[key] = { priceData: null, tradeSignal: null };
        }
      });
      return merged;
    });
    setPanelStrategyIndicators((prev) => {
      const merged = { ...prev };
      Object.entries(nextStrategy).forEach(([key, value]) => {
        merged[key] = value;
      });
      return merged;
    });
  };

  const analyzePanelIndex = async (index: number) => {
    const symbol = panelSymbols[index];
    const timeframe = panelTimeframes[index] || "D1";
    if (!symbol) return;
    const key = `${symbol}|${timeframe}`;
    setPanelLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const data = await generatePriceData(symbol, timeframe);
      if (!data) {
        setPanelAnalysis((prev) => {
          if (prev[key]) return prev;
          return { ...prev, [key]: { priceData: null, tradeSignal: null } };
        });
        setPanelStrategyIndicators((prev) => ({ ...prev, [key]: null }));
        return;
      }
      const signal = generateTradeSignal(data);
      setPanelAnalysis((prev) => ({ ...prev, [key]: { priceData: data, tradeSignal: signal } }));
      const strategyIndicators = await buildPanelStrategyIndicators(symbol, timeframe, data);
      setPanelStrategyIndicators((prev) => ({ ...prev, [key]: strategyIndicators }));
    } finally {
      setPanelLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  const analyzeWatchlistBoard = async () => {
    if (watchlistBoardBusyRef.current) return;
    const runSeq = ++watchlistBoardRunSeqRef.current;
    watchlistBoardBusyRef.current = true;
    setWatchlistBoardLoading(true);
    const next: Record<string, WatchlistBoardEntry> = {};
    try {
      for (let start = 0; start < WATCHLIST_BASE_SYMBOLS.length; start += WATCHLIST_BOARD_BATCH_SIZE) {
        const batch = WATCHLIST_BASE_SYMBOLS.slice(start, start + WATCHLIST_BOARD_BATCH_SIZE);
        const results = await Promise.all(
          batch.map(async (symbol) => {
            try {
              const data = await generateBoardPriceData(symbol, watchlistBoardTimeframe);
              return {
                symbol,
                entry: {
                  symbol,
                  timeframe: watchlistBoardTimeframe,
                  priceData: data,
                  tradeSignal: data ? generateTradeSignal(data) : null,
                  updatedAtMs: Date.now(),
                },
              };
            } catch {
              return {
                symbol,
                entry: {
                  symbol,
                  timeframe: watchlistBoardTimeframe,
                  priceData: null,
                  tradeSignal: null,
                  updatedAtMs: Date.now(),
                },
              };
            }
          })
        );
        results.forEach(({ symbol, entry }) => {
          next[symbol] = entry;
        });
      }
      if (runSeq === watchlistBoardRunSeqRef.current) {
        setWatchlistBoard(next);
        setWatchlistBoardUpdatedAtMs(Date.now());
      }
    } finally {
      if (runSeq === watchlistBoardRunSeqRef.current) {
        setWatchlistBoardLoading(false);
      }
      watchlistBoardBusyRef.current = false;
    }
  };

  const watchlistBoardCards = useMemo(() => {
    const allTypePriority = WATCHLIST_ALL_TYPE_ORDER.reduce<Record<string, number>>((acc, symbol, index) => {
      acc[symbol] = index;
      return acc;
    }, {});
    const getSignalRank = (entry: WatchlistBoardEntry | null) => {
      if (!entry?.tradeSignal) return 2;
      return entry.tradeSignal.signal === "BUY" || entry.tradeSignal.signal === "SELL" ? 0 : 1;
    };
    const nameFilter = watchlistBoardNameFilter.trim().toUpperCase();

    return WATCHLIST_BASE_SYMBOLS.map((symbol, index) => {
      const entry = watchlistBoard[symbol];
      const matchesTimeframe = entry?.timeframe === watchlistBoardTimeframe;
      const assetType = getWatchlistBoardAssetType(symbol);
      const formattedName = formatPairLabel(symbol);
      return {
        symbol,
        entry: matchesTimeframe ? entry : null,
        assetType,
        formattedName,
        originalIndex: index,
      };
    })
      .filter((item) => {
        if (watchlistBoardTypeFilter !== "ALL" && item.assetType !== watchlistBoardTypeFilter) return false;
        if (!nameFilter) return true;
        return item.symbol.includes(nameFilter) || item.formattedName.toUpperCase().includes(nameFilter);
      })
      .sort((left, right) => {
        if (watchlistBoardTypeFilter === "ALL") {
          const leftOrder = allTypePriority[left.symbol] ?? Number.MAX_SAFE_INTEGER;
          const rightOrder = allTypePriority[right.symbol] ?? Number.MAX_SAFE_INTEGER;
          if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        }
        const signalRankDiff = getSignalRank(left.entry) - getSignalRank(right.entry);
        if (signalRankDiff !== 0) return signalRankDiff;
        const leftConfidence = left.entry?.tradeSignal?.confidence ?? -1;
        const rightConfidence = right.entry?.tradeSignal?.confidence ?? -1;
        if (rightConfidence !== leftConfidence) return rightConfidence - leftConfidence;
        const leftWinRate = left.entry?.tradeSignal?.winRate ?? -1;
        const rightWinRate = right.entry?.tradeSignal?.winRate ?? -1;
        if (rightWinRate !== leftWinRate) return rightWinRate - leftWinRate;
        return left.originalIndex - right.originalIndex;
      });
  }, [watchlistBoard, watchlistBoardTimeframe, watchlistBoardTypeFilter, watchlistBoardNameFilter]);
  const watchlistBoardTableGroups = useMemo(() => {
    const midpoint = Math.ceil(watchlistBoardCards.length / 2);
    return [watchlistBoardCards.slice(0, midpoint), watchlistBoardCards.slice(midpoint)].filter((group) => group.length > 0);
  }, [watchlistBoardCards]);

  const loadPolicyEvents = async () => {
    try {
      const response = await fetch(`${mt4BridgeBase}/policy-events?limit=12`, { method: "GET" });
      const data = await response.json();
      if (response.ok && data?.ok && Array.isArray(data.events)) {
        setPolicyEvents(data.events as Mt4PolicyEvent[]);
      }
    } catch {
      // bridge not running or unavailable
    }
  };

  const handlePrepareOrder = async () => {
    setTradeBridgeBusy(true);
    setTradeBridgeMessage("");
    if (pendingOrder) {
      clearRegisteredOrder(pendingOrder);
    }
    setPendingOrder(null);
    setConfirmTokenInput("");
    try {
      const payload: Record<string, unknown> = { action: orderAction };

      if (orderAction === "PLACE") {
        const maxOpenTrades = effectiveMaxOpenTrades;
        try {
          const openResponse = await fetch(`${mt4BridgeBase}/orders/open`, { method: "GET" });
          const openData = await openResponse.json();
          const positions =
            openResponse.ok && openData?.ok && Array.isArray(openData.positions)
              ? (openData.positions as OpenPosition[])
              : [];
          if (positions.length >= maxOpenTrades) {
            setTradeBridgeMessage(`Blocked: max active positions reached (${positions.length}/${maxOpenTrades})`);
            return;
          }
        } catch {
          // If unavailable, continue and let bridge policy enforce.
        }

        payload.symbol = resolveOrderSymbol(selectedSymbol);
        payload.side = orderSide;
        payload.lots = Number(orderLots);
        payload.sl = Number(orderSL);
        payload.tp = Number(orderTP);
        payload.symbolCooldownSec = autoEnforceSymbolCooldown ? effectiveCooldownMin * 60 : 0;
        payload.maxOpenTrades = effectiveMaxOpenTrades;
        payload.enforceSymbolCooldown = autoEnforceSymbolCooldown;
        payload.enforceDailyLossLimit = autoEnforceDailyLossLimit;
        payload.enforceTrendStack = autoEnforceTrendStack;
        payload.comment = orderComment;
      } else if (orderAction === "CLOSE") {
        payload.ticket = Number(orderTicket);
        if (orderCloseLots.trim()) payload.lots = Number(orderCloseLots);
      } else {
        payload.ticket = Number(orderTicket);
        if (orderSL.trim()) payload.sl = Number(orderSL);
        if (orderTP.trim()) payload.tp = Number(orderTP);
      }

      // Check for duplicate orders before preparing
      const duplicateReason = checkOrderDuplicate(payload);
      if (duplicateReason) {
        setTradeBridgeMessage(`Blocked: ${duplicateReason}`);
        return;
      }

      const response = await fetch(`${mt4BridgeBase}/orders/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();

      if (!response.ok || !data?.ok) {
        setTradeBridgeMessage(data?.error || "Failed to prepare order");
        return;
      }

      // Register order since prepare succeeded
      registerOrderExecution(payload);

      setPendingOrder({
        requestId: data.requestId,
        confirmToken: data.confirmToken,
        summary: data.summary,
        expiresInMs: data.expiresInMs,
        action: String(payload.action || ""),
        symbol: String(payload.symbol || ""),
        side: payload.side ? String(payload.side) : undefined,
        price: payload.price ? Number(payload.price) : undefined,
      });
      setTradeBridgeMessage("Prepared. Enter confirm token to execute.");
    } catch (error) {
      setTradeBridgeMessage(error instanceof Error ? error.message : "Prepare request failed");
    } finally {
      setTradeBridgeBusy(false);
    }
  };

  const handleConfirmOrder = async () => {
    if (!pendingOrder) return;
    if (confirmTokenInput.trim().toUpperCase() !== pendingOrder.confirmToken.toUpperCase()) {
      setTradeBridgeMessage("Confirm token mismatch");
      return;
    }

    setTradeBridgeBusy(true);
    try {
      const response = await fetch(`${mt4BridgeBase}/orders/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: pendingOrder.requestId,
          confirmToken: confirmTokenInput.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok || !data?.ok) {
        clearRegisteredOrder(pendingOrder);
        setPendingOrder(null);
        setTradeBridgeMessage(data?.message || data?.error || "Execution failed");
        return;
      }

      clearRegisteredOrder(pendingOrder);
      setTradeBridgeMessage(
        `Executed: ${data.status}${data.ticket ? ` | ticket ${data.ticket}` : ""}${
          data.price ? ` | price ${data.price}` : ""
        }`
      );
      setPendingOrder(null);
      setConfirmTokenInput("");
      await loadOpenPositions();
      await loadPolicyEvents();
    } catch (error) {
      clearRegisteredOrder(pendingOrder);
      setPendingOrder(null);
      setTradeBridgeMessage(error instanceof Error ? error.message : "Confirm request failed");
    } finally {
      setTradeBridgeBusy(false);
    }
  };

  const handleUseCurrentSignalStops = () => {
    if (!tradeSignal) return;
    const decimals = tradeSignal.isCrypto ? 2 : 5;
    setOrderSL(tradeSignal.stopLoss.toFixed(decimals));
    setOrderTP(tradeSignal.takeProfit.toFixed(decimals));
  };

  const handleGenerateAiTradePlan = async () => {
    if (!panelSymbols.length) {
      setAiError("No watchlist panels configured.");
      return;
    }

    setAiLoading(true);
    setAiError("");
    setAiResponse("");
    setAiProviderUsed("");
    try {
      const watchlistContext: Array<Record<string, unknown>> = [];
      for (let i = 0; i < panelSymbols.length; i += 1) {
        const symbol = panelSymbols[i];
        const timeframe = panelTimeframes[i] || "D1";
        const panelKey = `${symbol}|${timeframe}`;
        const panelData = panelAnalysis[panelKey];

        let localPrice = panelData?.priceData ?? null;
        let localSignal = panelData?.tradeSignal ?? null;
        if (!localPrice || !localSignal) {
          const fetched = await generatePriceData(symbol, timeframe);
          if (fetched) {
            localPrice = fetched;
            localSignal = generateTradeSignal(fetched);
          }
        }

        const eligibility = autoEligibilityByPanel[panelKey];
        const policyDiag = policyByPanel[panelKey];
        if (!localPrice || !localSignal) {
          watchlistContext.push({
            symbol,
            label: formatPairLabel(symbol),
            timeframe,
            status: "NO_DATA",
            eligibleNow: eligibility?.eligible ?? false,
            eligibilityReason: eligibility?.reason || "No signal data",
            policyPass: policyDiag?.pass ?? null,
            policyMessage: policyDiag?.message || "",
          });
          continue;
        }

        const rr =
          Number.isFinite(localSignal.risk) && localSignal.risk > 0
            ? Number((localSignal.reward / localSignal.risk).toFixed(2))
            : null;

        watchlistContext.push({
          symbol,
          label: formatPairLabel(symbol),
          timeframe,
          signal: localSignal.signal,
          strength: localSignal.strength,
          confidence: Number(localSignal.confidence.toFixed(1)),
          winRate: Number(localSignal.winRate.toFixed(1)),
          currentPrice: localPrice.current,
          high: localPrice.high,
          low: localPrice.low,
          rsi: Number(localPrice.rsi.toFixed(2)),
          ma50: localPrice.movingAverage50,
          ma200: localPrice.movingAverage200,
          atr: localPrice.atr,
          entry: localSignal.entryPoints.primary,
          sl: localSignal.stopLoss,
          tp: localSignal.takeProfit,
          rrRatio: rr,
          eligibleNow: eligibility?.eligible ?? false,
          eligibilityReason: eligibility?.reason || "",
          policyPass: policyDiag?.pass ?? null,
          policyMessage: policyDiag?.message || "",
        });
      }

      if (!watchlistContext.length) {
        setAiError("No watchlist context available.");
        return;
      }

      const intelResponse = await fetch(
        `${mt4BridgeBase}/market-intel?symbols=${encodeURIComponent(panelSymbols.join(","))}&limit=6`,
        { method: "GET" }
      );
      const intelData = await readResponseJsonSafe(intelResponse);
      if (!intelResponse.ok || !intelData?.ok || !Array.isArray(intelData.symbols)) {
        const rawError = String(intelData?.error || "").trim();
        if (intelResponse.status === 404 || rawError.toLowerCase() === "not found") {
          setAiError(
            "Bridge endpoint /api/mt4/market-intel is not available. Restart mt5_bridge/server.mjs with the latest code."
          );
          return;
        }
        setAiError(rawError || "Market intel lookup failed. Ensure bridge internet access.");
        return;
      }

      const marketIntel = (intelData.symbols as SymbolMarketIntel[]).map((item) => ({
        symbol: item.symbol,
        resources: Array.isArray(item.resources) ? item.resources : [],
        news: Array.isArray(item.news) ? item.news.slice(0, 6) : [],
        warnings: Array.isArray(item.warnings) ? item.warnings : [],
      }));
      const hasNews = marketIntel.some((item) => item.news.length > 0);
      if (!hasNews) {
        setAiError("No market news found for watchlist symbols. Check bridge internet access or provider availability.");
        return;
      }

      const context = {
        generatedAtUtc: new Date().toISOString(),
        watchlist: watchlistContext,
        policyThresholds: {
          minConfidence: Number(autoMinConfidence),
          minWinRate: Number(autoMinWinRate),
          minRR: Number(autoMinRR),
        },
        marketIntel,
      };

      const prompt = [
        "You are a professional market scanner and risk manager for MT5 execution.",
        "Goal: rank the best watchlist symbols for today using BOTH price action and external market news.",
        "You must be conservative and reject weak/conflicting setups. Never promise profit.",
        "Use only the provided marketIntel links as external references (do not fabricate links).",
        "Generate a concise watchlist plan from this JSON context:",
        JSON.stringify(context),
        aiNote ? `Trader note: ${aiNote}` : "Trader note: none",
        "Output in plain text with sections:",
        "1) Top opportunities today (rank up to 3 symbols with score /100, direction BUY/SELL/NO TRADE).",
        "2) For each ranked symbol: setup quality, key catalysts, and cited sources in format [source | publishedAt | url].",
        "3) Entry plan per ranked symbol: trigger, invalidation, SL, TP, and R:R.",
        "4) Reject/Waitlist symbols and why they should be avoided today.",
        "5) Daily risk controls: max trades, max loss, and what conditions invalidate all trades.",
        "If data quality is poor or evidence conflicts, state NO TRADE clearly.",
        "Keep it practical, specific, and short.",
      ].join("\n");
      const aiResult = await requestBridgeAiCompletion(mt4BridgeBase, {
        prompt,
        temperature: 0.3,
      });
      if (!aiResult.ok) {
        setAiError(aiResult.error);
        return;
      }
      setAiProviderUsed(aiResult.provider);
      setAiResponse(aiResult.text);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI request failed");
    } finally {
      setAiLoading(false);
    }
  };

  const evaluateTradeCandidate = async (params: {
    symbol: string;
    panelTimeframe: ChartTimeframe;
    panelData?: { priceData: PriceData | null; tradeSignal: TradeSignal | null };
    positions: OpenPosition[];
    actualOpenCount: number;
    currentOpenCount: number;
    accountRiskBase: number;
    symbolSpecCache: Record<string, { tickValue: number; tickSize: number } | null>;
    trendSignalCache: Record<string, TradeSignal | null>;
    nowMs: number;
  }): Promise<CandidateEvaluation> => {
    const {
      symbol,
      panelTimeframe,
      panelData,
      positions,
      actualOpenCount,
      currentOpenCount,
      accountRiskBase,
      symbolSpecCache,
      trendSignalCache,
      nowMs,
    } = params;

    const minConfidence = Number(autoMinConfidence);
    const minWinRate = Number(autoMinWinRate);
    const minRR = Number(autoMinRR);
    const sideFilter = autoSideFilter;
    const maxOpenTrades = effectiveMaxOpenTrades;
    const dynamicLotEnabled = autoUseDynamicLot;
    const riskMode = autoRiskMode;
    const riskPct = Math.max(0.01, Number(autoRiskPct) || 0);
    const riskUsd = Math.max(0.01, Number(autoRiskUsd) || 0);
    const riskGuardMult = Math.max(1, Number(autoRiskGuardMult) || AUTO_RISK_HARD_BLOCK_MULTIPLIER);
    const minLot = Math.max(0.001, Number(autoDynamicMinLot) || 0.01);
    const lotStep = Math.max(0.001, Number(autoDynamicLotStep) || 0.01);
    const configuredBotLots = Number(autoBotLots);
    const lotCap = configuredBotLots;
    const strategyMode = autoStrategyMode;
    const scalpAggressive = autoScalpAggressive;
    const enforceTrendStack = autoEnforceTrendStack;
    const reservedOpenCount = Math.max(0, currentOpenCount - actualOpenCount);
    const autoTimeframe =
      strategyMode === "SCALP_M15"
        ? autoEntryTimeframe
        : autoTradeTimeframeOverride && autoTradeTimeframeOverride !== "PANEL"
        ? autoTradeTimeframeOverride
        : panelTimeframe;
    let rawRiskLot: number | undefined;
    let actualRiskLot: number | undefined;
    let scalpTrendData: PriceData | null = null;
    let scalpTrendSide: "BUY" | "SELL" | null = null;
    const finalizeEvaluation = (evaluation: CandidateEvaluation): CandidateEvaluation => ({
      ...evaluation,
      scalpBias: evaluation.scalpBias ?? scalpTrendSide ?? undefined,
      actualOpenCount: evaluation.actualOpenCount ?? actualOpenCount,
      reservedOpenCount: evaluation.reservedOpenCount ?? reservedOpenCount,
      maxOpenTradesApplied: evaluation.maxOpenTradesApplied ?? maxOpenTrades,
    });

    let signal = panelData?.tradeSignal ?? null;
    let dataForOrder = panelData?.priceData ?? null;
    if (!signal || autoTimeframe !== panelTimeframe) {
      const data = await generatePriceData(symbol, autoTimeframe);
      if (data) {
        signal = generateTradeSignal(data);
        dataForOrder = data;
      }
    }

    if (!signal || !dataForOrder) {
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason: "Price/signal data unavailable",
        pass: null,
        message: "Price/signal data unavailable for policy check",
        checks: [createPolicyCheck("signal", false, "Price/signal data unavailable")],
        checkedAtMs: nowMs,
      });
    }

    if (strategyMode === "SCALP_M15") {
      scalpTrendData = await generatePriceData(symbol, AUTO_SCALP_TREND_TIMEFRAME);
      if (scalpTrendData) {
        const trendAtr = Number(scalpTrendData.atr || 0);
        const trendTolerance = scalpAggressive ? Math.max(0, trendAtr * 0.20) : 0;
        const trendDelta = Number(scalpTrendData.current) - Number(scalpTrendData.movingAverage50);
        scalpTrendSide = trendDelta >= -trendTolerance ? "BUY" : "SELL";
      }
    }

    if (signal.signal === "HOLD") {
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason: "No actionable signal",
        pass: null,
        message: "No actionable signal for policy check",
        checks: [
          createPolicyCheck("signal", false, "No actionable signal"),
          createPolicyCheck(
            "auto_confidence",
            signal.confidence >= minConfidence,
            signal.confidence >= minConfidence
              ? `${signal.confidence.toFixed(0)}% >= ${minConfidence}%`
              : `Confidence ${signal.confidence.toFixed(0)}% < ${minConfidence}%`
          ),
          createPolicyCheck(
            "auto_win_rate",
            minWinRate <= 0 || signal.winRate >= minWinRate,
            minWinRate <= 0
              ? "Win-rate gate inactive"
              : signal.winRate >= minWinRate
              ? `${signal.winRate.toFixed(0)}% >= ${minWinRate}%`
              : `Win rate ${signal.winRate.toFixed(0)}% < ${minWinRate}%`
          ),
          createPolicyCheck(
            "auto_noise",
            signal.noiseState !== "HIGH",
            signal.noiseState !== "HIGH"
              ? `${signal.noiseState} noise (${signal.noiseScore.toFixed(0)}%)`
              : `Noise filter: setup too choppy (${signal.noiseScore.toFixed(0)}%)`
          ),
          createPolicyCheck(
            "auto_strength",
            !autoRequireStrongSignal || signal.strength === "STRONG",
            !autoRequireStrongSignal || signal.strength === "STRONG"
              ? autoRequireStrongSignal
                ? `${signal.strength} signal accepted`
                : "Strong-signal filter inactive"
              : "Signal strength is not STRONG"
          ),
        ],
        checkedAtMs: nowMs,
      });
    }

    if (strategyMode === "SCALP_M15" && scalpTrendSide && signal.signal !== scalpTrendSide) {
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason: `Entry signal ${signal.signal} opposes M15 EMA50 ${scalpTrendSide} bias`,
        pass: null,
        message: `Counter-trend setup blocked: wait for ${scalpTrendSide} confirmation on ${autoEntryTimeframe}`,
        checks: [
          createPolicyCheck(
            "scalp_m15_trend",
            false,
            `Entry signal ${signal.signal} opposes M15 EMA50 ${scalpTrendSide} bias`
          ),
          createPolicyCheck(
            "scalp_entry_side",
            false,
            `Counter-trend ${signal.signal} signal on ${autoEntryTimeframe}`
          ),
        ],
        checkedAtMs: nowMs,
      });
    }

    if (strategyMode === "CLASSIC_STACK") {
      const biasCacheKey = `${symbol}|${AUTO_BIAS_TIMEFRAME}`;
      let biasSignal = trendSignalCache[biasCacheKey];
      if (biasSignal === undefined) {
        const biasData = await generatePriceData(symbol, AUTO_BIAS_TIMEFRAME);
        biasSignal = biasData ? generateTradeSignal(biasData) : null;
        trendSignalCache[biasCacheKey] = biasSignal;
      }
      const h4Bias = biasSignal?.signal === "BUY" || biasSignal?.signal === "SELL" ? biasSignal.signal : null;
      if (h4Bias && signal.signal !== h4Bias) {
        return finalizeEvaluation({
          symbol,
          panelTimeframe,
          autoTimeframe,
          eligible: false,
          reason: `${AUTO_BIAS_TIMEFRAME} bias is ${h4Bias}; wait for ${h4Bias} entry confirmation`,
          pass: null,
          message: `Bias-led mode blocked: ${AUTO_BIAS_TIMEFRAME} ${h4Bias} overrides ${autoTimeframe} ${signal.signal}`,
          checks: [
            createPolicyCheck("auto_h4_bias", false, `${AUTO_BIAS_TIMEFRAME} bias ${h4Bias} opposes ${autoTimeframe} ${signal.signal}`),
            createPolicyCheck("signal", false, `${autoTimeframe} signal ${signal.signal} is counter-trend to ${AUTO_BIAS_TIMEFRAME} ${h4Bias}`),
          ],
          checkedAtMs: nowMs,
        });
      }
    }

    const resolvedSymbol = resolveOrderSymbol(symbol);
    const liveTick = await fetchMt4Tick(resolvedSymbol);
    const liveEntry = liveTick?.mid;
    const orderPlanResult = buildAutoOrderPlan(symbol, dataForOrder, signal, liveEntry);
    const orderPlan = orderPlanResult.plan;
    if (!orderPlan) {
      const attemptedPlan = autoEntryMode === "LIMIT_SR" ? `${signal.signal} LIMIT @ S/R` : `${signal.signal} MARKET`;
      const blockedReason = orderPlanResult.blockedReason || "No valid order plan";
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason: blockedReason,
        pass: null,
        message: blockedReason,
        checks: [createPolicyCheck("order_plan", false, blockedReason)],
        checkedAtMs: nowMs,
        orderPlan: attemptedPlan,
      });
    }

    if (
      (sideFilter === "BUY_ONLY" && orderPlan.side !== "BUY") ||
      (sideFilter === "SELL_ONLY" && orderPlan.side !== "SELL")
    ) {
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason: `Side filter blocked ${orderPlan.side} (${sideFilter})`,
        pass: false,
        message: `Blocked by side filter: ${sideFilter.replace("_", " ").toLowerCase()}`,
        checks: [createPolicyCheck("auto_side_filter", false, `Side filter blocked ${orderPlan.side} (${sideFilter})`)],
        checkedAtMs: nowMs,
        orderPlan: orderPlan.label,
      });
    }

    let rrRatio = Number.NaN;
    let strategyBlockReason: string | null = null;
    const localChecks: PolicyCheckItem[] = [];
    const addLocalCheck = (
      rule: string,
      ok: boolean,
      passDetail: string,
      failDetail: string,
      options?: { block?: boolean }
    ) => {
      const detail = ok ? passDetail : failDetail;
      localChecks.push(createPolicyCheck(rule, ok, detail));
      if (!ok && options?.block !== false && !strategyBlockReason) {
        strategyBlockReason = failDetail;
      }
    };

    addLocalCheck(
      "auto_side_filter",
      sideFilter === "BOTH" || (sideFilter === "BUY_ONLY" && orderPlan.side === "BUY") || (sideFilter === "SELL_ONLY" && orderPlan.side === "SELL"),
      sideFilter === "BOTH" ? "Both sides allowed" : `${sideFilter === "BUY_ONLY" ? "Buy" : "Sell"} side allowed`,
      `Side filter blocked ${orderPlan.side} (${sideFilter})`
    );

    addLocalCheck(
      "auto_confidence",
      signal.confidence >= minConfidence,
      `${signal.confidence.toFixed(0)}% >= ${minConfidence}%`,
      `Confidence ${signal.confidence.toFixed(0)}% < ${minConfidence}%`
    );
    addLocalCheck(
      "auto_win_rate",
      minWinRate <= 0 || signal.winRate >= minWinRate,
      minWinRate <= 0 ? "Win-rate gate inactive" : `${signal.winRate.toFixed(0)}% >= ${minWinRate}%`,
      minWinRate <= 0 ? "Win-rate gate inactive" : `Win rate ${signal.winRate.toFixed(0)}% < ${minWinRate}%`
    );
    addLocalCheck(
      "auto_noise",
      signal.noiseState !== "HIGH",
      `${signal.noiseState} noise (${signal.noiseScore.toFixed(0)}%)`,
      `Noise filter: setup too choppy (${signal.noiseScore.toFixed(0)}%)`
    );
    addLocalCheck(
      "auto_strength",
      !autoRequireStrongSignal || signal.strength === "STRONG",
      autoRequireStrongSignal ? `${signal.strength} signal accepted` : "Strong-signal filter inactive",
      autoRequireStrongSignal ? "Signal strength is not STRONG" : "Strong-signal filter inactive",
      { block: autoRequireStrongSignal }
    );

    const brokerSessionOpen = isBrokerSessionOpen(symbol, nowMs);
    addLocalCheck("auto_broker_session", brokerSessionOpen, "Broker session open", "Broker market closed");

    const autoSessionOpen = isAutoSessionWindowOpen(symbol, nowMs);
    addLocalCheck(
      "auto_session_gate",
      autoSessionOpen,
      autoSessionGateEnabled ? `Within ${sessionWindowLabel}` : "Session gate inactive",
      autoSessionGateEnabled
        ? `Session gate: outside ${sessionWindowLabel} (now ${formatTimeInTz(nowMs)})`
        : "Session gate inactive",
      { block: autoSessionGateEnabled }
    );

    addLocalCheck(
      "auto_open_slots",
      currentOpenCount < maxOpenTrades,
      `${actualOpenCount} actual + ${reservedOpenCount} reserved / ${maxOpenTrades} limit`,
      `Max active positions reached (${actualOpenCount} actual + ${reservedOpenCount} reserved / ${maxOpenTrades} limit)`
    );

    if (strategyMode === "SCALP_M15") {
      const sessionTradeCap = scalpAggressive ? 8 : 5;
      const recentSessionStartMs = nowMs - 8 * 60 * 60 * 1000;
      const recentSessionTrades = activeBotExecutionAuditLogs.filter(
        (log) => log.stage === "PREPARE_SENT" && Number(log.ts || 0) >= recentSessionStartMs
      ).length;
      addLocalCheck(
        "scalp_session_trade_cap",
        recentSessionTrades < sessionTradeCap,
        `${recentSessionTrades}/${sessionTradeCap} session trades`,
        `Scalp risk rule: session trade cap reached (${recentSessionTrades}/${sessionTradeCap})`
      );
    }

    const symbolKey = normalizeSymbol(symbol);
    const adaptiveSession = classifyAdaptiveSession(nowMs);
    if (adaptiveLearningEnabled) {
      const blockedByLearningSymbol = normalizedLearnedBlockedSymbols.some(
        (blocked) =>
          blocked === symbolKey ||
          blocked.startsWith(symbolKey) ||
          symbolKey.startsWith(blocked)
      );
      addLocalCheck(
        "auto_adaptive_symbol",
        !blockedByLearningSymbol,
        "Adaptive symbol filter clear",
        `Adaptive filter: ${formatPairLabel(symbol)} is blocked by recent trade performance`
      );
      addLocalCheck(
        "auto_adaptive_session",
        !learnedBlockedSessions.includes(adaptiveSession),
        "Adaptive session filter clear",
        `Adaptive filter: ${formatAdaptiveSessionLabel(adaptiveSession)} session is blocked`
      );
    } else {
      localChecks.push(createPolicyCheck("auto_adaptive_symbol", true, "Adaptive symbol filter inactive"));
      localChecks.push(createPolicyCheck("auto_adaptive_session", true, "Adaptive session filter inactive"));
    }
    const hasSameSymbolOpen = positions.some((position) => normalizeSymbol(position.symbol).startsWith(symbolKey));
    addLocalCheck(
      "auto_open_symbol",
      !hasSameSymbolOpen,
      "No existing open position on symbol",
      "Existing open position on symbol"
    );

    if (strategyMode === "CLASSIC_STACK") {
      const confirmation = evaluateDirectionalConfirmation(symbol, dataForOrder, orderPlan.side);
      const structureHint = orderPlan.side === "BUY" ? "support" : "resistance";
      addLocalCheck(
        "auto_sr_zone",
        confirmation.nearStructure,
        `${autoTimeframe} price is inside the ${structureHint} zone`,
        `Price is not yet at the ${structureHint} zone on ${autoTimeframe} (${confirmation.zoneAtrRatio.toFixed(2)} ATR away)`
      );
      addLocalCheck(
        "auto_ma50_bias",
        confirmation.maOk,
        `${autoTimeframe} price is aligned with MA50 for ${orderPlan.side}`,
        `${autoTimeframe} MA50 filter blocks ${orderPlan.side}`
      );
      addLocalCheck(
        "auto_sr_rsi",
        confirmation.rsiOk,
        `${autoTimeframe} RSI supports ${orderPlan.side}`,
        `${autoTimeframe} RSI is not supportive for ${orderPlan.side} (${Number(dataForOrder.rsi).toFixed(1)})`
      );
      addLocalCheck(
        "auto_candle_confirm",
        confirmation.patternOk,
        `${autoTimeframe} ${confirmation.patternLabel} confirms ${orderPlan.side}`,
        `Need ${orderPlan.side === "BUY" ? "bullish" : "bearish"} rejection or engulfing candle on ${autoTimeframe}`
      );
    }

    // Strategy filter: either classic multi-timeframe stack or scalp M15 + pullback + RSI workflow.
    if (strategyMode === "SCALP_M15") {
      const trendData = scalpTrendData ?? (await generatePriceData(symbol, AUTO_SCALP_TREND_TIMEFRAME));
      const entryData =
        autoTimeframe === panelTimeframe && panelData?.priceData
          ? panelData.priceData
          : await generatePriceData(symbol, autoEntryTimeframe);

      const trendAtr = Number(trendData?.atr || 0);
      const trendTolerance = scalpAggressive ? Math.max(0, trendAtr * 0.20) : 0;
      const trendAligned = Boolean(
        trendData &&
          (orderPlan.side === "BUY"
            ? trendData.current >= trendData.movingAverage50 - trendTolerance
            : trendData.current <= trendData.movingAverage50 + trendTolerance)
      );
      addLocalCheck(
        "scalp_m15_trend",
        trendAligned,
        `${AUTO_SCALP_TREND_TIMEFRAME} trend matches ${orderPlan.side} bias`,
        `Scalp trend mismatch: ${AUTO_SCALP_TREND_TIMEFRAME} EMA50 bias opposes ${orderPlan.side}`
      );

      if (entryData) {
        const pullbackDistance = Math.abs(entryData.current - entryData.movingAverage50);
        const pullbackBuffer = Math.max(0, Number(entryData.atr || 0) * (scalpAggressive ? 0.60 : 0.35));
        const nearEma = pullbackBuffer > 0 && pullbackDistance <= pullbackBuffer;
        const nearSr =
          pullbackBuffer > 0 &&
          (orderPlan.side === "BUY"
            ? Math.abs(entryData.current - entryData.supportLevel) <= pullbackBuffer
            : Math.abs(entryData.current - entryData.resistanceLevel) <= pullbackBuffer);
        const pullbackOk = nearEma || nearSr;
        addLocalCheck(
          "scalp_pullback",
          pullbackOk,
          `Pullback confirmed (${autoEntryTimeframe})`,
          `Scalp pullback missing: wait for price near EMA50 or S/R on ${autoEntryTimeframe}`
        );

        const rsi = Number(entryData.rsi);
        const rsiOk = orderPlan.side === "BUY"
          ? rsi >= (scalpAggressive ? 35 : 40) && rsi <= (scalpAggressive ? 60 : 55)
          : rsi >= (scalpAggressive ? 40 : 45) && rsi <= (scalpAggressive ? 65 : 60);
        addLocalCheck(
          "scalp_rsi",
          rsiOk,
          `RSI ${rsi.toFixed(1)} supports ${orderPlan.side}`,
          `Scalp RSI filter failed on ${autoEntryTimeframe} (RSI ${rsi.toFixed(1)})`
        );

        const entryTriggerSignal = generateTradeSignal(entryData);
        const triggerOk =
          entryTriggerSignal.signal === orderPlan.side ||
          (scalpAggressive &&
            entryTriggerSignal.signal === "HOLD" &&
            entryTriggerSignal.noiseState !== "HIGH");
        addLocalCheck(
          "scalp_trigger",
          triggerOk,
          `${autoEntryTimeframe} trigger candle aligns with ${orderPlan.side}`,
          `Scalp trigger not confirmed on ${autoEntryTimeframe} for ${orderPlan.side}`
        );
      } else {
        addLocalCheck(
          "scalp_entry_data",
          false,
          `Entry data ready (${autoEntryTimeframe})`,
          `Entry data unavailable on ${autoEntryTimeframe}`
        );
      }

      if (!isCryptoSymbol(symbol)) {
        const utcMinute = new Date(nowMs).getUTCHours() * 60 + new Date(nowMs).getUTCMinutes();
        const londonWindow = minuteInWindow(utcMinute, 7 * 60, 17 * 60);
        const newYorkWindow = minuteInWindow(utcMinute, 12 * 60, 21 * 60);
        const highLiquidity = londonWindow || newYorkWindow;
        addLocalCheck(
          "scalp_liquidity_session",
          highLiquidity || scalpAggressive,
          highLiquidity ? "London/New York liquidity window open" : "Liquidity filter relaxed (aggressive)",
          "Scalp session filter: outside London/New York liquidity windows",
          { block: !scalpAggressive }
        );
      } else {
        localChecks.push(createPolicyCheck("scalp_liquidity_session", true, "Session filter inactive for crypto"));
      }

    } else {
      const trendFrames = getTrendFilterFrames(strategyMode, autoEntryTimeframe);
      const trendState: Record<string, string> = {};
      let aligned = true;
      for (const tf of trendFrames) {
        const cacheKey = `${symbol}|${tf}`;
        let trendSignal = trendSignalCache[cacheKey];
        if (trendSignal === undefined) {
          const trendData = await generatePriceData(symbol, tf);
          trendSignal = trendData ? generateTradeSignal(trendData) : null;
          trendSignalCache[cacheKey] = trendSignal;
        }
        const state = trendSignal?.signal || "N/A";
        trendState[tf] = state;
        if (state !== orderPlan.side) aligned = false;
      }
      const trendDetail = trendFrames.map((tf) => `${tf}=${trendState[tf]}`).join(", ");
      addLocalCheck(
        "auto_trend_stack",
        aligned || !enforceTrendStack,
        enforceTrendStack
          ? `${formatTrendStackLabel(strategyMode, autoEntryTimeframe)} aligned (${trendDetail})`
          : "Trend stack inactive",
        enforceTrendStack
          ? `Trend filter: ${orderPlan.side} requires ${formatTrendStackLabel(strategyMode, autoEntryTimeframe)} alignment (${trendDetail})`
          : "Trend stack inactive",
        { block: enforceTrendStack }
      );
    }

    const reentryConfirmation = await evaluateCooldownReentryConfirmation(symbol, orderPlan.side);
    addLocalCheck(
      "auto_reentry_m5_bias",
      reentryConfirmation.m5Ok,
      reentryConfirmation.m5Detail,
      `${reentryConfirmation.reason} (${reentryConfirmation.m5Detail})`
    );
    addLocalCheck(
      "auto_reentry_m1_confirm",
      reentryConfirmation.m1Ok,
      reentryConfirmation.m1Detail,
      `${reentryConfirmation.reason} (${reentryConfirmation.m1Detail})`
    );

    // Guard high spread before policy/execution (all symbols).
    if (liveTick) {
      const point = getPointSizeForSymbol(symbol, liveTick.mid);
      const spread = Math.max(0, liveTick.ask - liveTick.bid);
      const spreadPoints = point > 0 ? spread / point : 0;
      const spreadGuardPoints = getSpreadGuardPointsForSymbol(symbol);
      addLocalCheck(
        "auto_spread_guard",
        !(Number.isFinite(spreadPoints) && spreadPoints > spreadGuardPoints),
        `${spreadPoints.toFixed(1)} pts <= ${spreadGuardPoints.toFixed(1)} pts`,
        `Spread guard: ${formatPairLabel(symbol)} spread ${spreadPoints.toFixed(1)} pts > ${spreadGuardPoints.toFixed(1)} pts`
      );
    } else {
      localChecks.push(createPolicyCheck("auto_spread_guard", true, "Spread guard inactive (live tick unavailable)"));
    }

    let lots = configuredBotLots;
    if (dynamicLotEnabled) {
      if (accountRiskBase <= 0) {
        const reason = "Account snapshot unavailable for dynamic lot";
        return finalizeEvaluation({
          symbol,
          panelTimeframe,
          autoTimeframe,
          eligible: false,
          reason,
          pass: null,
          message: reason,
          checks: [...localChecks, createPolicyCheck("auto_dynamic_lot", false, reason)],
          checkedAtMs: nowMs,
        });
      }
      let spec = symbolSpecCache[resolvedSymbol];
      if (spec === undefined) {
        try {
          const specResponse = await fetch(
            `${mt4BridgeBase}/symbols?symbol=${encodeURIComponent(resolvedSymbol)}`,
            { method: "GET" }
          );
          const specData = await readResponseJsonSafe(specResponse);
          if (specResponse.ok && specData?.ok && specData?.spec) {
            const tickValue = Number(specData.spec.tickValue || 0);
            const tickSize = Number(specData.spec.tickSize || 0);
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
        } catch {
          spec = null;
        }
        symbolSpecCache[resolvedSymbol] = spec;
      }

      if (!spec) {
        const reason = "Symbol tick spec unavailable";
        return finalizeEvaluation({
          symbol,
          panelTimeframe,
          autoTimeframe,
          eligible: false,
          reason,
          pass: null,
          message: reason,
          checks: [...localChecks, createPolicyCheck("auto_dynamic_lot", false, reason)],
          checkedAtMs: nowMs,
        });
      }

      const entry = Number(orderPlan.entryForRisk);
      let slDistance = Math.abs(entry - Number(orderPlan.sl));
      if (!Number.isFinite(slDistance) || slDistance <= 0) {
        const reason = "Invalid SL distance";
        return finalizeEvaluation({
          symbol,
          panelTimeframe,
          autoTimeframe,
          eligible: false,
          reason,
          pass: null,
          message: reason,
          checks: [...localChecks, createPolicyCheck("auto_sl_distance", false, reason)],
          checkedAtMs: nowMs,
        });
      }

      const riskAmount = riskMode === "USD" ? riskUsd : accountRiskBase * (riskPct / 100);
      let riskPerLot = (slDistance / spec.tickSize) * spec.tickValue;
      if (!Number.isFinite(riskPerLot) || riskPerLot <= 0) {
        const reason = "Invalid risk-per-lot";
        return finalizeEvaluation({
          symbol,
          panelTimeframe,
          autoTimeframe,
          eligible: false,
          reason,
          pass: null,
          message: reason,
          checks: [...localChecks, createPolicyCheck("auto_dynamic_lot", false, reason)],
          checkedAtMs: nowMs,
        });
      }

      let rawLots = riskAmount / riskPerLot;
      rawRiskLot = rawLots;
      if (!Number.isFinite(rawLots) || rawLots <= 0) {
        const reason = "Lot calculation failed";
        return finalizeEvaluation({
          symbol,
          panelTimeframe,
          autoTimeframe,
          eligible: false,
          reason,
          pass: null,
          message: reason,
          checks: [...localChecks, createPolicyCheck("auto_dynamic_lot", false, reason)],
          checkedAtMs: nowMs,
        });
      }

      if (rawLots < minLot) {
        const pointSize = getPointSizeForSymbol(symbol, entry);
        const configuredMinSlPoints = getMinSlPointsForSymbol(symbol);
        const minDistanceByPoints = Math.max(pointSize, pointSize * configuredMinSlPoints);
        const requiredRiskPerLot = riskAmount / minLot;
        const requiredSlDistance = requiredRiskPerLot * (spec.tickSize / spec.tickValue);
        const adjustedSlDistance = Math.max(minDistanceByPoints, requiredSlDistance);

        if (
          Number.isFinite(adjustedSlDistance) &&
          adjustedSlDistance > 0 &&
          adjustedSlDistance < slDistance
        ) {
          const adjustedSl =
            orderPlan.side === "BUY" ? entry - adjustedSlDistance : entry + adjustedSlDistance;
          const directionOk =
            orderPlan.side === "BUY" ? adjustedSl < entry : adjustedSl > entry;
          if (directionOk) {
            const previousDistance = slDistance;
            orderPlan.sl = adjustedSl;
            slDistance = adjustedSlDistance;
            riskPerLot = (slDistance / spec.tickSize) * spec.tickValue;
            rawLots = riskPerLot > 0 ? riskAmount / riskPerLot : 0;
            const tightenNote = `SL tightened for min lot (${previousDistance.toFixed(3)} -> ${slDistance.toFixed(3)})`;
            orderPlan.fallbackReason = orderPlan.fallbackReason
              ? `${orderPlan.fallbackReason}; ${tightenNote}`
              : tightenNote;
          }
        }
      }

      // Floating point tolerance: treat values that are effectively min lot as min lot.
      const minLotTolerance = Math.max(1e-6, lotStep / 1000);
      if (rawLots < minLot && minLot - rawLots <= minLotTolerance) {
        rawLots = minLot;
      }

      rawRiskLot = rawLots;
      if (rawLots < minLot) {
        const riskAmountLabel = Number.isFinite(riskAmount) ? riskAmount.toFixed(3) : "n/a";
        const slDistanceLabel = Number.isFinite(slDistance) ? slDistance.toFixed(3) : "n/a";
        actualRiskLot = minLot;
        if (!strategyBlockReason) {
          strategyBlockReason = `Risk lot ${rawLots.toFixed(5)} below min ${minLot} (risk $${riskAmountLabel}, SL dist ${slDistanceLabel})`;
        }
        localChecks.push(
          createPolicyCheck(
            "auto_risk_lot_floor",
            false,
            `Risk lot ${rawLots.toFixed(5)} below min ${minLot} (risk $${riskAmountLabel}, SL dist ${slDistanceLabel})`
          )
        );
        lots = minLot;
      } else {
        localChecks.push(
          createPolicyCheck(
            "auto_risk_lot_floor",
            true,
            `Risk lot ${rawLots.toFixed(5)} >= min ${minLot}`
          )
        );
      }

      const normalizedCap = Number.isFinite(lotCap) && lotCap > 0 ? lotCap : 5;
      const decimals = Math.max(2, String(lotStep).split(".")[1]?.length || 0);
      const minStepMultiple = Math.max(1, Math.ceil(minLot / lotStep - 1e-9));
      const minStepLot = Number((minStepMultiple * lotStep).toFixed(decimals));
      let stepped = Math.floor(rawLots / lotStep) * lotStep;
      if (stepped <= 0 && rawLots > 0) {
        stepped = minStepLot;
        const clampNote = `Lot auto-clamped to min step (${minStepLot.toFixed(decimals)})`;
        orderPlan.fallbackReason = orderPlan.fallbackReason
          ? `${orderPlan.fallbackReason}; ${clampNote}`
          : clampNote;
      }
      lots = Number(Math.min(normalizedCap, stepped).toFixed(decimals));
      if (lots <= 0 && rawLots > 0) {
        lots = minStepLot;
      }
      actualRiskLot = lots;
      localChecks.push(createPolicyCheck("auto_dynamic_lot", true, `Raw ${rawLots.toFixed(5)} -> final ${lots.toFixed(decimals)}`));
    } else {
      localChecks.push(createPolicyCheck("auto_dynamic_lot", true, "Dynamic lot sizing inactive"));
    }

    // Final clamp for tiny positive lots (including fixed-lot mode): do not allow sub-step lots.
    const lotDecimals = Math.max(2, String(lotStep).split(".")[1]?.length || 0);
    const minStepMultipleFinal = Math.max(1, Math.ceil(minLot / lotStep - 1e-9));
    const minStepLotFinal = Number((minStepMultipleFinal * lotStep).toFixed(lotDecimals));
    if (Number.isFinite(lots) && lots > 0 && lots < minStepLotFinal) {
      lots = minStepLotFinal;
      actualRiskLot = lots;
      const clampNote = `Lot auto-clamped to min step (${minStepLotFinal.toFixed(lotDecimals)})`;
      orderPlan.fallbackReason = orderPlan.fallbackReason
        ? `${orderPlan.fallbackReason}; ${clampNote}`
        : clampNote;
    }

    if (!Number.isFinite(lots) || lots <= 0) {
      const reason = "Invalid lot size";
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason,
        pass: null,
        message: reason,
        checks: [...localChecks, createPolicyCheck("auto_lot_size", false, reason)],
        checkedAtMs: nowMs,
        rawRiskLot,
        actualRiskLot,
      });
    }

    let guardSpec = symbolSpecCache[resolvedSymbol];
    if (guardSpec === undefined) {
      try {
        const specResponse = await fetch(
          `${mt4BridgeBase}/symbols?symbol=${encodeURIComponent(resolvedSymbol)}`,
          { method: "GET" }
        );
        const specData = await readResponseJsonSafe(specResponse);
        if (specResponse.ok && specData?.ok && specData?.spec) {
          const tickValue = Number(specData.spec.tickValue || 0);
          const tickSize = Number(specData.spec.tickSize || 0);
          guardSpec =
            Number.isFinite(tickValue) &&
            tickValue > 0 &&
            Number.isFinite(tickSize) &&
            tickSize > 0
              ? { tickValue, tickSize }
              : null;
        } else {
          guardSpec = null;
        }
      } catch {
        guardSpec = null;
      }
      symbolSpecCache[resolvedSymbol] = guardSpec;
    }

    let riskGuardNote = "";
    if (guardSpec) {
      const guardEntry = Number(orderPlan.entryForRisk);
      const guardSlDistance = Math.abs(guardEntry - Number(orderPlan.sl));
      if (Number.isFinite(guardSlDistance) && guardSlDistance > 0) {
        const guardRiskPerLot = (guardSlDistance / guardSpec.tickSize) * guardSpec.tickValue;
        if (Number.isFinite(guardRiskPerLot) && guardRiskPerLot > 0) {
          const projectedRiskUsd = guardRiskPerLot * lots;
          const targetRiskUsd =
            riskMode === "USD"
              ? riskUsd
              : accountRiskBase > 0
              ? accountRiskBase * (riskPct / 100)
              : 0;
          if (targetRiskUsd > 0 && projectedRiskUsd > targetRiskUsd * riskGuardMult) {
            if (autoEnforceHardRiskBlock) {
              const reason = `Hard-block: projected SL $${projectedRiskUsd.toFixed(2)} exceeds target $${targetRiskUsd.toFixed(2)}`;
              return finalizeEvaluation({
                symbol,
                panelTimeframe,
                autoTimeframe,
                eligible: false,
                reason,
                pass: null,
                message: reason,
                checks: [...localChecks, createPolicyCheck("hard_risk_block", false, reason)],
                checkedAtMs: nowMs,
              });
            }
            riskGuardNote = ` | Risk warning: projected SL $${projectedRiskUsd.toFixed(2)} > target $${targetRiskUsd.toFixed(2)}`;
          }
        }
      }
    }
    if (!guardSpec) {
      localChecks.push(createPolicyCheck("auto_risk_guard", true, "Risk guard inactive (symbol spec unavailable)"));
    } else if (riskGuardNote) {
      localChecks.push(createPolicyCheck("auto_risk_guard", true, riskGuardNote.replace(/^ \| /, "")));
    } else {
      localChecks.push(createPolicyCheck("auto_risk_guard", true, "Risk guard within target"));
    }

    if (guardSpec) {
      const moneyPerPricePerLot = guardSpec.tickSize > 0 ? guardSpec.tickValue / guardSpec.tickSize : 0;
      const entry = Number(orderPlan.entryForRisk);
      const pointSize = getPointSizeForSymbol(symbol, entry);
      if (
        Number.isFinite(entry) &&
        entry > 0 &&
        Number.isFinite(lots) &&
        lots > 0 &&
        Number.isFinite(moneyPerPricePerLot) &&
        moneyPerPricePerLot > 0
      ) {
        const targetDistance = Math.max(pointSize, AGGRESSIVE_AUTO_TP_TARGET_USD / (moneyPerPricePerLot * lots));
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

    const rrRatioRaw = computeEffectiveRR(
      signal.signal,
      Number(orderPlan.entryForRisk),
      Number(orderPlan.sl),
      Number(orderPlan.tp)
    );
    rrRatio = Number(rrRatioRaw.toFixed(2));
    if (!Number.isFinite(rrRatio)) {
      addLocalCheck(
        "auto_rr_model",
        false,
        "R:R unavailable (invalid entry/SL/TP distance)",
        "R:R unavailable (invalid entry/SL/TP distance)"
      );
    } else if (rrRatio < minRR) {
      addLocalCheck(
        "auto_rr_model",
        false,
        `R:R ${rrRatio.toFixed(2)} < ${minRR}`,
        `R:R ${rrRatio.toFixed(2)} < ${minRR}`
      );
    } else {
      localChecks.push(createPolicyCheck("auto_rr_model", true, `${rrRatio.toFixed(2)} >= ${minRR}`));
    }

    const planDecimals = isCryptoSymbol(symbol) ? 2 : 5;
    const planText =
      orderPlan.action === "PENDING"
        ? `${orderPlan.orderType} @ ${Number(orderPlan.price || 0).toFixed(planDecimals)}`
        : `${orderPlan.side} MARKET`;
    const planDisplay = orderPlan.fallbackReason ? `${planText} (${orderPlan.fallbackReason})` : planText;
    const payload: Record<string, unknown> = {
      action: orderPlan.action,
      symbol: resolvedSymbol,
      lots,
      sl: orderPlan.sl,
      tp: orderPlan.tp,
      symbolCooldownSec: autoEnforceSymbolCooldown ? effectiveCooldownMin * 60 : 0,
      maxOpenTrades: effectiveMaxOpenTrades,
      enforceSymbolCooldown: autoEnforceSymbolCooldown,
      enforceDailyLossLimit: autoEnforceDailyLossLimit,
      comment: orderComment || "policy-check",
    };
    if (orderPlan.action === "PLACE") {
      payload.side = orderPlan.side;
    } else {
      payload.orderType = orderPlan.orderType;
      payload.price = orderPlan.price;
    }
    const response = await fetch(`${mt4BridgeBase}/orders/policy-check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const policyData = await readResponseJsonSafe(response);
    if (!response.ok || !policyData?.ok) {
      const reason = policyData?.error || "Policy diagnostics failed";
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason,
        pass: false,
        message: reason,
        checks: [...localChecks, createPolicyCheck("policy_check", false, reason)],
        checkedAtMs: nowMs,
        orderPlan: planDisplay,
      });
    }

    const bridgeChecks = Array.isArray(policyData.checks) ? (policyData.checks as PolicyCheckItem[]) : [];
    const checks = [...localChecks, ...bridgeChecks];
    const failed = bridgeChecks.find((check) => !check.ok);
    const policyMessage = failed ? `Blocked by: ${failed.rule}` : "All policy checks passed";
    if (failed) {
      const failedRule = failed.rule || "";
      let reason = failed.detail || `Blocked by ${failedRule}`;
      if (failedRule === "symbol_cooldown") {
        reason = failed.detail ? `Cooldown active (${failed.detail})` : "Cooldown active";
      } else if (failedRule === "daily_loss_limit") {
        reason = failed.detail ? `Daily loss limit (${failed.detail})` : "Daily loss limit reached";
      } else if (failedRule === "sl_tp_direction") {
        reason = failed.detail ? `SL/TP direction invalid (${failed.detail})` : "SL/TP direction invalid";
      } else if (failedRule === "sl_tp_distance") {
        reason = failed.detail ? `SL/TP distance invalid (${failed.detail})` : "SL/TP distance invalid";
      } else if (failedRule === "live_reference_price") {
        reason = failed.detail || "Live reference price unavailable";
      }
      if (strategyBlockReason) {
        reason = strategyBlockReason;
      }
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason,
        pass: Boolean(policyData.pass),
        message: policyMessage,
        checks,
        checkedAtMs: nowMs,
        orderPlan: planDisplay,
        orderPlanData: orderPlan,
        rawRiskLot,
        actualRiskLot: actualRiskLot ?? lots,
        note: orderPlan.fallbackReason,
      });
    }

    if (strategyBlockReason) {
      return finalizeEvaluation({
        symbol,
        panelTimeframe,
        autoTimeframe,
        eligible: false,
        reason: strategyBlockReason,
        pass: Boolean(policyData.pass),
        message: policyMessage,
        checks,
        checkedAtMs: nowMs,
        orderPlan: planDisplay,
        orderPlanData: orderPlan,
        rawRiskLot,
        actualRiskLot: actualRiskLot ?? lots,
        note: orderPlan.fallbackReason,
      });
    }

    return finalizeEvaluation({
      symbol,
      panelTimeframe,
      autoTimeframe,
      eligible: true,
      reason: `Eligible now (${orderPlan.label}, R:R ${rrRatio.toFixed(2)})${riskGuardNote}`,
      pass: Boolean(policyData.pass),
      message: policyMessage,
      checks,
      checkedAtMs: nowMs,
      orderPlan: planDisplay,
      orderPlanData: orderPlan,
      resolvedSymbol,
      lots,
      rawRiskLot,
      actualRiskLot: actualRiskLot ?? lots,
      note: orderPlan.fallbackReason,
    });
  };

  const runPolicyDiagnostics = async () => {
    if (orderAction !== "PLACE") {
      setPolicyByPanel({});
      setAutoEligibilityByPanel({});
      return;
    }

    const runSeq = ++policyRunSeqRef.current;
    setPolicyBusy(true);
    try {
      const nextByPanel: Record<string, PanelPolicyDiagnostics> = {};
      const nextEligibilityByPanel: Record<string, PanelAutoEligibility> = {};
      const nowMs = Date.now();

      let positions: OpenPosition[] = [];
      try {
        const openResponse = await fetch(`${mt4BridgeBase}/orders/open`, { method: "GET" });
        const openData = await readResponseJsonSafe(openResponse);
        if (openResponse.ok && openData?.ok && Array.isArray(openData.positions)) {
          positions = openData.positions as OpenPosition[];
        }
      } catch {
        positions = [];
      }

      let accountRiskBase = 0;
      if (autoUseDynamicLot || autoRiskMode === "PCT") {
        try {
          const accountResponse = await fetch(`${mt4BridgeBase}/account`, { method: "GET" });
          const accountData = await readResponseJsonSafe(accountResponse);
          if (accountResponse.ok && accountData?.ok && accountData?.account) {
            const balance = Number(accountData.account.balance || 0);
            const equity = Number(accountData.account.equity || 0);
            const candidate = equity > 0 ? Math.min(balance > 0 ? balance : equity, equity) : balance;
            accountRiskBase = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
          }
        } catch {
          accountRiskBase = 0;
        }
      }

      const symbolSpecCache: Record<string, { tickValue: number; tickSize: number } | null> = {};
      const trendSignalCache: Record<string, TradeSignal | null> = {};
      const actualOpenCount = positions.length;
      let simulatedOpenCount = positions.length;

      for (let i = 0; i < panelSymbols.length; i += 1) {
        const symbol = panelSymbols[i];
        const panelTimeframe = panelTimeframes[i] || "D1";
        const panelKey = `${symbol}|${panelTimeframe}`;
        const evaluation = await evaluateTradeCandidate({
          symbol,
          panelTimeframe,
          panelData: panelAnalysis[panelKey],
          positions,
          actualOpenCount,
          currentOpenCount: simulatedOpenCount,
          accountRiskBase,
          symbolSpecCache,
          trendSignalCache,
          nowMs,
        });

        nextByPanel[panelKey] = {
          symbol,
          timeframe: panelTimeframe,
          pass: evaluation.pass,
          message: evaluation.message,
          checks: evaluation.checks,
          checkedAtMs: evaluation.checkedAtMs,
          orderPlan: evaluation.orderPlan,
          actualOpenCount: evaluation.actualOpenCount,
          reservedOpenCount: evaluation.reservedOpenCount,
          maxOpenTradesApplied: evaluation.maxOpenTradesApplied,
        };
        nextEligibilityByPanel[panelKey] = {
          symbol,
          timeframe: evaluation.autoTimeframe,
          eligible: evaluation.eligible,
          reason: evaluation.reason,
          scalpBias: evaluation.scalpBias,
          intendedSide:
            evaluation.orderPlanData?.side ||
            (panelAnalysis[panelKey]?.tradeSignal?.signal === "BUY" || panelAnalysis[panelKey]?.tradeSignal?.signal === "SELL"
              ? panelAnalysis[panelKey]?.tradeSignal?.signal
              : undefined),
          lots: evaluation.lots,
          rawRiskLot: evaluation.rawRiskLot,
          actualRiskLot: evaluation.actualRiskLot,
          note: evaluation.note,
        };
        if (evaluation.eligible) simulatedOpenCount += 1;
      }

      if (runSeq === policyRunSeqRef.current) {
        setPolicyByPanel(nextByPanel);
        setAutoEligibilityByPanel(nextEligibilityByPanel);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Policy diagnostics request failed";
      const fallback: Record<string, PanelPolicyDiagnostics> = {};
      const fallbackEligibility: Record<string, PanelAutoEligibility> = {};
      for (let i = 0; i < panelSymbols.length; i += 1) {
        const symbol = panelSymbols[i];
        const timeframe = panelTimeframes[i] || "D1";
        const panelKey = `${symbol}|${timeframe}`;
        fallback[panelKey] = {
          symbol,
          timeframe,
          pass: false,
          message,
          checks: [createPolicyCheck("policy_diagnostics", false, message)],
          checkedAtMs: Date.now(),
          orderPlan: undefined,
        };
        fallbackEligibility[panelKey] = {
          symbol,
          timeframe,
          eligible: false,
          reason: message,
        };
      }
      if (runSeq === policyRunSeqRef.current) {
        setPolicyByPanel(fallback);
        setAutoEligibilityByPanel(fallbackEligibility);
      }
    } finally {
      if (runSeq === policyRunSeqRef.current) {
        setPolicyBusy(false);
      }
    }
  };

  useEffect(() => {
    runPolicyDiagnosticsRef.current = runPolicyDiagnostics;
  }, [runPolicyDiagnostics]);

  const autoTradeScan = async () => {
    if (isHeadlessMode || !autoTradeEnabled || loading || autoTradeBusy || tradeBridgeBusy || tradeCommandBusyRef.current) return;

    setAutoTradeBusy(true);
    try {
      const openResponse = await fetch(`${mt4BridgeBase}/orders/open`, { method: "GET" });
      const openData = await readResponseJsonSafe(openResponse);
      const positions = openResponse.ok && openData?.ok && Array.isArray(openData.positions) ? (openData.positions as OpenPosition[]) : [];
      setOpenPositions(positions);
      const actualOpenCount = positions.length;
      let currentOpenCount = positions.length;
      let accountRiskBase = 0;
      if (autoUseDynamicLot || autoRiskMode === "PCT") {
        try {
          const accountResponse = await fetch(`${mt4BridgeBase}/account`, { method: "GET" });
          const accountData = await readResponseJsonSafe(accountResponse);
          if (accountResponse.ok && accountData?.ok && accountData?.account) {
            const balance = Number(accountData.account.balance || 0);
            const equity = Number(accountData.account.equity || 0);
            const candidate = equity > 0 ? Math.min(balance > 0 ? balance : equity, equity) : balance;
            accountRiskBase = Number.isFinite(candidate) && candidate > 0 ? candidate : 0;
          }
        } catch {
          accountRiskBase = 0;
        }
      }
      const symbolSpecCache: Record<string, { tickValue: number; tickSize: number } | null> = {};
      const trendSignalCache: Record<string, TradeSignal | null> = {};
      const executedSymbolLock = new Set<string>();
      const toSymbolLockKey = (value: string) => normalizeSymbol(value).replace(/M$/, "");

      const executed: string[] = [];
      const failures: string[] = [];

      for (let i = 0; i < panelSymbols.length; i += 1) {
        const symbol = panelSymbols[i];
        const panelTimeframe = panelTimeframes[i] || "D1";
        const panelKey = `${symbol}|${panelTimeframe}`;
        const panelLockKey = toSymbolLockKey(symbol);
        if (executedSymbolLock.has(panelLockKey)) {
          failures.push(`${formatPairLabel(symbol)}: skipped - symbol lock active for current scan`);
          continue;
        }
        const evaluation = await evaluateTradeCandidate({
          symbol,
          panelTimeframe,
          panelData: panelAnalysis[panelKey],
          positions,
          actualOpenCount,
          currentOpenCount,
          accountRiskBase,
          symbolSpecCache,
          trendSignalCache,
          nowMs: Date.now(),
        });

        if (!evaluation.eligible || !evaluation.orderPlanData || !evaluation.resolvedSymbol || !evaluation.lots) {
          if (evaluation.reason) {
            failures.push(`${formatPairLabel(symbol)}: skipped - ${evaluation.reason}`);
          }
          continue;
        }
        const orderPlan = evaluation.orderPlanData;
        const resolvedSymbol = evaluation.resolvedSymbol;
        const lots = evaluation.lots;

        // Final pre-send guard (all symbols): spread + slippage drift.
        if (orderPlan.action === "PLACE") {
          const preSendTick = await fetchMt4Tick(resolvedSymbol);
          if (!preSendTick) {
            failures.push(`${formatPairLabel(symbol)}: skipped - Spread/slippage guard: live tick unavailable`);
            continue;
          }
          const point = getPointSizeForSymbol(symbol, preSendTick.mid);
          const spreadPoints = point > 0 ? Math.max(0, preSendTick.ask - preSendTick.bid) / point : 0;
          const spreadGuardPoints = getSpreadGuardPointsForSymbol(symbol);
          if (Number.isFinite(spreadPoints) && spreadPoints > spreadGuardPoints) {
            failures.push(
              `${formatPairLabel(symbol)}: skipped - Spread guard ${spreadPoints.toFixed(1)} pts > ${spreadGuardPoints.toFixed(1)}`
            );
            continue;
          }
          const entryRef = Number(orderPlan.entryForRisk);
          const slippagePoints = point > 0 && Number.isFinite(entryRef) ? Math.abs(preSendTick.mid - entryRef) / point : 0;
          const slippageGuardPoints = getSlippageGuardPointsForSymbol(symbol);
          if (Number.isFinite(slippagePoints) && slippagePoints > slippageGuardPoints) {
            failures.push(
              `${formatPairLabel(symbol)}: skipped - Slippage guard ${slippagePoints.toFixed(1)} pts > ${slippageGuardPoints.toFixed(1)}`
            );
            continue;
          }
        }

        const preparePayload: Record<string, unknown> = {
          action: orderPlan.action,
          symbol: resolvedSymbol,
          lots,
          sl: orderPlan.sl,
          tp: orderPlan.tp,
          symbolCooldownSec: autoEnforceSymbolCooldown ? effectiveCooldownMin * 60 : 0,
          maxOpenTrades: effectiveMaxOpenTrades,
          enforceSymbolCooldown: autoEnforceSymbolCooldown,
          enforceDailyLossLimit: autoEnforceDailyLossLimit,
          comment: `ai-auto-${evaluation.autoTimeframe}`,
        };
        if (orderPlan.action === "PLACE") {
          preparePayload.side = orderPlan.side;
        } else {
          preparePayload.orderType = orderPlan.orderType;
          preparePayload.price = orderPlan.price;
        }

        // Check for duplicate orders before preparing (bot execution)
        const duplicateReason = checkOrderDuplicate(preparePayload);
        if (duplicateReason) {
          pushBotExecutionAuditLog(symbol, "DUPLICATE_BLOCKED", duplicateReason);
          failures.push(`${formatPairLabel(symbol)}: ${duplicateReason}`);
          continue;
        }

        pushBotExecutionAuditLog(
          symbol,
          "PREPARE_SENT",
          `${orderPlan.label} lots=${lots} sl=${Number(orderPlan.sl).toFixed(isCryptoSymbol(symbol) ? 2 : 5)} tp=${Number(orderPlan.tp).toFixed(isCryptoSymbol(symbol) ? 2 : 5)}${orderPlan.rrAtTp ? ` rr=${orderPlan.rrAtTp.toFixed(2)}` : ""}${orderPlan.tpSource ? ` tpSource=${orderPlan.tpSource.toLowerCase()}` : ""}`
        );

        tradeCommandBusyRef.current = true;
        const prepareResponse = await fetch(`${mt4BridgeBase}/orders/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preparePayload),
        });
        const prepareData = await readResponseJsonSafe(prepareResponse);
        if (!prepareResponse.ok || !prepareData?.ok) {
          const reason =
            prepareData?.error ||
            prepareData?.message ||
            (prepareResponse.ok ? "prepare failed" : `prepare failed (${prepareResponse.status})`);
          pushBotExecutionAuditLog(symbol, "PREPARE_FAIL", reason);
          failures.push(`${formatPairLabel(symbol)}: prepare failed - ${reason}`);
          tradeCommandBusyRef.current = false;
          continue;
        }
        // Register the order since prepare succeeded
        registerOrderExecution(preparePayload);
        pushBotExecutionAuditLog(
          symbol,
          "PREPARE_OK",
          `requestId=${String(prepareData.requestId || "")} ${orderPlan.label} lots=${lots}`
        );
        pushBotExecutionAuditLog(
          symbol,
          "CONFIRM_SENT",
          `requestId=${String(prepareData.requestId || "")}`
        );

        const confirmResponse = await fetch(`${mt4BridgeBase}/orders/confirm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: prepareData.requestId,
            confirmToken: prepareData.confirmToken,
          }),
        });
        const confirmData = await readResponseJsonSafe(confirmResponse);
        if (!confirmResponse.ok || !confirmData?.ok) {
          const reason =
            confirmData?.message ||
            confirmData?.error ||
            (confirmResponse.ok ? "execution failed" : `execution failed (${confirmResponse.status})`);
          pushBotExecutionAuditLog(
            symbol,
            "EXECUTION_FAIL",
            `requestId=${String(prepareData.requestId || "")} ${reason}`
          );
          failures.push(`${formatPairLabel(symbol)}: execution failed - ${reason}`);
          tradeCommandBusyRef.current = false;
          continue;
        }
        clearRegisteredOrder(preparePayload);
        pushBotExecutionAuditLog(
          symbol,
          "EXECUTION_OK",
          `${orderPlan.label} lots=${lots}${confirmData?.ticket ? ` ticket=${confirmData.ticket}` : ""}${
            confirmData?.price ? ` price=${confirmData.price}` : ""
          }${orderPlan.rrAtTp ? ` rr=${orderPlan.rrAtTp.toFixed(2)}` : ""}${orderPlan.tpSource ? ` tpSource=${orderPlan.tpSource.toLowerCase()}` : ""}`
        );

        executed.push(
          `${orderPlan.label} ${formatPairLabel(symbol)} lots=${lots}${confirmData?.ticket ? ` #${confirmData.ticket}` : ""}`
        );
        executedSymbolLock.add(panelLockKey);
        executedSymbolLock.add(toSymbolLockKey(resolvedSymbol));
        currentOpenCount += 1;
        tradeCommandBusyRef.current = false;
        await loadOpenPositions();
        await loadPolicyEvents();
      }

      if (executed.length) {
        const msg = `Auto trade executed: ${executed.join(" | ")}`;
        setAutoTradeStatus(msg);
        pushAutoTradeLog("INFO", msg);
      } else if (failures.length) {
        const msg = `Auto trade scan: ${failures.join(" | ")}`;
        setAutoTradeStatus(msg);
        pushAutoTradeLog("WARN", msg);
      } else {
        const msg = "Auto trade scan: no qualifying signals";
        setAutoTradeStatus(msg);
        pushAutoTradeLog("INFO", msg);
      }
    } catch (error) {
      const msg = error instanceof Error ? `Auto trade error: ${error.message}` : "Auto trade error";
      setAutoTradeStatus(msg);
      pushAutoTradeLog("ERROR", msg);
    } finally {
      tradeCommandBusyRef.current = false;
      setAutoTradeBusy(false);
    }
  };

  const handleAnalyzeOpenPositions = async () => {
    setAiPositionsLoading(true);
    setAiPositionsError("");
    setAiPositionsResponse("");
    setAiPositionsProvider("");

    try {
      const response = await fetch(`${mt4BridgeBase}/orders/open`, { method: "GET" });
      const data = await response.json();
      if (!response.ok || !data?.ok || !Array.isArray(data.positions)) {
        setAiPositionsError(data?.error || "Failed to load open positions");
        return;
      }

      const positions: OpenPosition[] = data.positions;
      if (!positions.length) {
        setAiPositionsError("No open positions found.");
        return;
      }

      const enriched = await Promise.all(
        positions.map(async (pos) => {
          const tick = await fetchMt4Tick(pos.symbol);
          return {
            ...pos,
            currentBid: tick?.bid ?? null,
            currentAsk: tick?.ask ?? null,
            currentMid: tick?.mid ?? null,
            currentTime: tick?.time ?? null,
          };
        })
      );

      const prompt = {
        instruction:
          "Analyze the open MT5 positions. For each position, comment on trend alignment, risk (distance to SL/TP), and whether to hold, reduce, or exit. Be concise and actionable. Assume this is a demo account and use prudent risk language.",
        positions: enriched,
      };

      const aiResult = await requestBridgeAiCompletion(mt4BridgeBase, {
        system: "You are a trading risk assistant. Be concise and actionable.",
        prompt: JSON.stringify(prompt),
        temperature: 0.2,
      });
      if (aiResult.ok) {
        setAiPositionsProvider(aiResult.provider);
        setAiPositionsResponse(aiResult.text);
        return;
      }
      setAiPositionsError(aiResult.error);
    } catch (error) {
      setAiPositionsError(error instanceof Error ? error.message : "AI request failed");
    } finally {
      setAiPositionsLoading(false);
    }
  };

  useEffect(() => {
    void autoTradeScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    autoRuntimeMode,
    autoTradeEnabled,
    autoSideFilter,
    autoMinConfidence,
    autoMinWinRate,
    autoMinRR,
    autoMaxSpreadPointsSetting,
    autoCooldownMin,
    autoMaxOpenTrades,
    autoRequireStrongSignal,
    autoEnforceTrendStack,
    autoEnforceSymbolCooldown,
    autoEnforceDailyLossLimit,
    autoEnforceHardRiskBlock,
    autoStrategyMode,
    autoScalpAggressive,
    autoSessionGateEnabled,
    autoEntryTimeframe,
    autoTradeTimeframeOverride,
    autoEntryMode,
    autoAllowMarketFallback,
    autoFallbackMinConfidence,
    autoFallbackRrBuffer,
    autoBotLots,
    autoRiskMode,
    autoUseDynamicLot,
    autoRiskPct,
    autoRiskUsd,
    autoRiskGuardMult,
    autoMinSlPoints,
    autoAtrBufferMult,
    autoDynamicMinLot,
    autoDynamicLotStep,
    panelSymbols,
    panelTimeframes,
    panelAnalysis,
    loading,
  ]);

  useEffect(() => {
    void runPolicyDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    orderAction,
    orderComment,
    panelSymbols,
    panelTimeframes,
    panelAnalysis,
    autoSideFilter,
    autoMinConfidence,
    autoMinWinRate,
    autoMinRR,
    autoMaxSpreadPointsSetting,
    autoCooldownMin,
    autoMaxOpenTrades,
    autoRequireStrongSignal,
    autoEnforceTrendStack,
    autoEnforceSymbolCooldown,
    autoEnforceDailyLossLimit,
    autoEnforceHardRiskBlock,
    autoStrategyMode,
    autoScalpAggressive,
    autoSessionGateEnabled,
    autoEntryTimeframe,
    autoTradeTimeframeOverride,
    autoEntryMode,
    autoAllowMarketFallback,
    autoFallbackMinConfidence,
    autoFallbackRrBuffer,
    autoBotLots,
    autoRiskMode,
    autoUseDynamicLot,
    autoRiskPct,
    autoRiskUsd,
    autoRiskGuardMult,
    autoMinSlPoints,
    autoAtrBufferMult,
    autoDynamicMinLot,
    autoDynamicLotStep,
  ]);

  useEffect(() => {
    void loadOpenPositions();
    void loadPolicyEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void loadOpenPositions();
    }, 5000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void loadPolicyEvents();
    }, 5000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void runPolicyDiagnosticsRef.current();
    }, 15000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isHeadlessMode || (!protectEnabled && !protectOvernightEnabled)) return;
    void applyProtectiveTrail();
    const intervalId = window.setInterval(() => {
      if (document.hidden) return;
      void applyProtectiveTrail();
    }, 5000);
    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    protectEnabled,
    protectOvernightEnabled,
    protectOvernightProfitUsd,
    protectOvernightLossUsd,
    protectBiasFlipProfitLockEnabled,
    protectBiasFlipTpProgressPct,
    protectOvernightProfitRetraceLockEnabled,
    protectOvernightProfitRetraceArmUsd,
    protectOvernightProfitRetraceCloseUsd,
    protectTimeframe,
    protectAtrPeriod,
    protectAtrMult,
    protectLookback,
    protectMinStopPoints,
    protectGraceMin,
    protectBreakEvenEnabled,
    protectBreakEvenR,
    protectBreakEvenProfitUsd,
    protectDegradeCloseEnabled,
    protectDegradeMinConfidence,
    isHeadlessMode,
  ]);

  const bridgeBadge = useMemo(() => {
    if (bridgeVersionCheck.status === "ok") {
      return {
        label: "Bridge OK",
        className: "border-emerald-400/50 bg-emerald-500/10 text-emerald-200",
      };
    }
    if (bridgeVersionCheck.status === "outdated") {
      return {
        label: "Bridge Outdated",
        className: "border-amber-400/50 bg-amber-500/10 text-amber-200",
      };
    }
    if (bridgeVersionCheck.status === "offline") {
      return {
        label: "Bridge Offline",
        className: "border-rose-400/50 bg-rose-500/10 text-rose-200",
      };
    }
    return {
      label: "Checking Bridge",
      className: "border-slate-500/50 bg-slate-500/10 text-slate-200",
    };
  }, [bridgeVersionCheck.status]);

  const renderChartPanel = (panelSymbol: string, index: number, isFullscreen = false) => {
    const usedSymbols = panelSymbols.filter((_, i) => i !== index);
    const options = WATCHLIST_BASE_SYMBOLS.filter((sym) => !usedSymbols.includes(sym));
    const panelIsCrypto = isCryptoSymbol(panelSymbol);
    const resolvedPanelSymbol = resolveOrderSymbol(panelSymbol);
    const panelTimeframe = panelTimeframes[index] || "D1";
    const panelKey = `${panelSymbol}|${panelTimeframe}`;
    const panelData = panelAnalysis[panelKey];
    const panelStrategy = panelStrategyIndicators[panelKey];
    const panelTradeSignal = panelData?.tradeSignal;
    const panelPriceData = panelData?.priceData;
    const livePanelQuote = livePanelQuotes[panelSymbol];
    const displayedPanelCurrent = livePanelQuote?.mid ?? panelPriceData?.current ?? 0;
    const displayedPanelChange = panelPriceData ? displayedPanelCurrent - panelPriceData.prevClose : 0;
    const displayedPanelChangePercent =
      panelPriceData && panelPriceData.prevClose !== 0
        ? (displayedPanelChange / panelPriceData.prevClose) * 100
        : 0;
    const panelIsLoading = Boolean(panelLoading[panelKey]);
    const hasPanelData = Boolean(panelTradeSignal && panelPriceData);
    const panelEntryMode = resolvePanelEntryMode(panelSymbol, panelTimeframe);
    const strategyTrendData = panelStrategy?.trendData || null;
    const strategyEntryData = panelStrategy?.entryData || null;
    const strategyBias = panelStrategy?.trendBias || null;
    const strategySetupSignal = panelStrategy?.setupSignal?.signal || "HOLD";
    const strategyEntrySignal = panelStrategy?.entrySignal?.signal || "HOLD";
    const structureData = strategyEntryData || panelPriceData || strategyTrendData || null;
    const supportPriceLabel = structureData ? formatSetupPrice(panelSymbol, structureData.supportLevel) : "--";
    const resistancePriceLabel = structureData ? formatSetupPrice(panelSymbol, structureData.resistanceLevel) : "--";
    const chartSetupToneClass = getSetupCardClass(strategyBias);
    const chartSetupZoneLabel =
      strategyBias === "BUY" ? "Support zone" : strategyBias === "SELL" ? "Resistance zone" : "Wait for bias";
    const chartPendingOrderLabel =
      panelEntryMode === "LIMIT_SR"
        ? strategyBias === "BUY"
          ? "BUY_LIMIT"
          : strategyBias === "SELL"
          ? "SELL_LIMIT"
          : "PENDING"
        : strategyBias === "BUY"
        ? "BUY MARKET"
        : strategyBias === "SELL"
        ? "SELL MARKET"
        : "WAIT";
    const chartSetupHeadline =
      strategyBias === "BUY"
        ? `Follow ${AUTO_BIAS_TIMEFRAME} BUY bias and buy pullbacks into support`
        : strategyBias === "SELL"
        ? `Follow ${AUTO_BIAS_TIMEFRAME} SELL bias and sell pullbacks into resistance`
        : `Waiting for a clean ${AUTO_BIAS_TIMEFRAME} directional bias`;
    const chartSetupDetail =
      strategyBias === "BUY"
        ? `Bias from ${AUTO_BIAS_TIMEFRAME}, setup on ${AUTO_SETUP_TIMEFRAME}, then ${autoEntryTimeframe} confirmation before placing a ${chartPendingOrderLabel}.`
        : strategyBias === "SELL"
        ? `Bias from ${AUTO_BIAS_TIMEFRAME}, setup on ${AUTO_SETUP_TIMEFRAME}, then ${autoEntryTimeframe} confirmation before placing a ${chartPendingOrderLabel}.`
        : `No directional edge yet. The panel will stay defensive until ${AUTO_BIAS_TIMEFRAME} and ${AUTO_SETUP_TIMEFRAME} align.`;
    const scalpPullbackBuffer =
      autoStrategyMode === "SCALP_M15" && strategyEntryData
        ? Math.max(0, Number(strategyEntryData.atr || 0) * (autoScalpAggressive ? 0.6 : 0.35))
        : 0;
    const scalpNearEma =
      autoStrategyMode === "SCALP_M15" &&
      strategyEntryData &&
      scalpPullbackBuffer > 0 &&
      Math.abs(strategyEntryData.current - strategyEntryData.movingAverage50) <= scalpPullbackBuffer;
    const scalpNearSr =
      autoStrategyMode === "SCALP_M15" &&
      strategyEntryData &&
      strategyBias !== null &&
      strategyBias !== "HOLD" &&
      scalpPullbackBuffer > 0 &&
      (strategyBias === "BUY"
        ? Math.abs(strategyEntryData.current - strategyEntryData.supportLevel) <= scalpPullbackBuffer
        : Math.abs(strategyEntryData.current - strategyEntryData.resistanceLevel) <= scalpPullbackBuffer);
    const scalpRsiOk =
      autoStrategyMode === "SCALP_M15" &&
      strategyEntryData &&
      strategyBias !== null &&
      strategyBias !== "HOLD" &&
      (strategyBias === "BUY"
        ? strategyEntryData.rsi >= (autoScalpAggressive ? 35 : 40) &&
          strategyEntryData.rsi <= (autoScalpAggressive ? 60 : 55)
        : strategyEntryData.rsi >= (autoScalpAggressive ? 40 : 45) &&
          strategyEntryData.rsi <= (autoScalpAggressive ? 65 : 60));
    const chartHeight =
      isFullscreen
        ? typeof window !== "undefined"
          ? Math.max(340, Math.min(760, window.innerHeight - 280))
          : 540
        : 240;

    return (
      <div
        key={`${panelSymbol}-${index}-${isFullscreen ? "fullscreen" : "inline"}`}
        className={`self-start rounded-lg border border-slate-700/60 bg-slate-900/60 ${
          isFullscreen ? "h-full overflow-y-auto p-4 shadow-2xl shadow-slate-950/60" : "p-3"
        }`}
      >
        <div className="flex flex-col gap-2 mb-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <h4 className="text-sm font-semibold text-slate-200">
              Price Chart - {formatPairLabel(panelSymbol)}
            </h4>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFullscreenChartIndex(isFullscreen ? null : index)}
                className="rounded border border-slate-600 bg-slate-800/80 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:border-slate-500"
              >
                {isFullscreen ? "Exit Full Screen" : "Full Screen"}
              </button>
              <select
                value={panelSymbol}
                onChange={(e) => {
                  const next = e.target.value;
                  setPanelSymbols((prev) => prev.map((s, i) => (i === index ? next : s)));
                }}
                className="rounded bg-slate-800 border border-slate-600 text-xs text-slate-200 px-2 py-1"
              >
                {options.map((sym) => (
                  <option key={sym} value={sym}>
                    {formatPairLabel(sym)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="text-[11px] text-slate-400">
            MT5 symbol: <span className="text-slate-200">{resolvedPanelSymbol}</span>
          </div>
          <div className={`rounded-xl border p-3 shadow-[0_16px_40px_rgba(2,6,23,0.35)] ${chartSetupToneClass}`}>
            <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/90">Trend Pullback Setup</p>
                <p className={`text-sm font-semibold mt-1 ${getSetupBiasTone(strategyBias)}`}>{chartSetupHeadline}</p>
                <p className="text-[11px] mt-1 text-slate-300">{chartSetupDetail}</p>
              </div>
              <span className="inline-flex items-center rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                {panelEntryMode === "LIMIT_SR" ? "Limit @ S/R" : "Market Entry"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Bias</p>
                <p className={`mt-1 text-xs font-semibold ${getSetupBiasTone(strategyBias)}`}>
                  {AUTO_BIAS_TIMEFRAME} {strategyBias || "WAIT"}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Zone</p>
                <p className="mt-1 text-xs font-semibold text-slate-100">{chartSetupZoneLabel}</p>
                <p className="text-[10px] text-slate-400">
                  S {supportPriceLabel} | R {resistancePriceLabel}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Confirmation</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getSetupBadgeClass(strategySetupSignal)}`}>
                    {AUTO_SETUP_TIMEFRAME} {strategySetupSignal}
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getSetupBadgeClass(strategyEntrySignal)}`}>
                    {autoEntryTimeframe} {strategyEntrySignal}
                  </span>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Trigger</p>
                <p className="mt-1 text-xs font-semibold text-slate-100">{chartPendingOrderLabel}</p>
                <p className="text-[10px] text-slate-400">
                  {panelEntryMode === "LIMIT_SR" ? "Pending order near structure" : "Immediate execution after confirmation"}
                </p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {TIMEFRAMES.map((tf) => (
              <button
                key={`${panelSymbol}-${index}-${tf}`}
                onClick={() => {
                  setPanelTimeframes((prev) => prev.map((t, i) => (i === index ? tf : t)));
                  if (panelSymbol === selectedSymbol) {
                    setSelectedTimeframe(tf);
                  }
                }}
                className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border ${
                  panelTimeframe === tf
                    ? "bg-emerald-400/20 border-emerald-400 text-emerald-400"
                    : "bg-slate-700/50 border-slate-600 text-slate-300 hover:border-slate-500"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        </div>
        <PriceChart
          symbol={panelSymbol}
          isCrypto={panelIsCrypto}
          height={chartHeight}
          timeframe={panelTimeframe}
        />
        {panelIsLoading && (
          <div className="mt-3 text-xs text-slate-400">Loading analysis...</div>
        )}
        {!panelIsLoading && !hasPanelData && (
          <div className="mt-3 text-xs text-slate-400">
            No MT5 analysis data yet for {formatPairLabel(panelSymbol)} {panelTimeframe}.
          </div>
        )}
        {panelTradeSignal && panelPriceData && (
          <div className="mt-3 text-xs text-slate-300 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <div className={`text-sm font-bold ${getSignalColor(panelTradeSignal.signal)}`}>
                  {panelTradeSignal.signal}
                </div>
                <div className="text-[11px] text-slate-400">
                  {panelTradeSignal.strength} Signal
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-slate-100">
                  ${displayedPanelCurrent.toFixed(panelIsCrypto ? 2 : 5)}
                </div>
                <div className={displayedPanelChange >= 0 ? "text-emerald-400" : "text-rose-400"}>
                  {displayedPanelChange >= 0 ? "+" : ""}
                  {displayedPanelChangePercent.toFixed(2)}%
                </div>
                {panelPriceData.lastCandleTime ? (
                  <div className="text-[10px] text-slate-500 mt-1">
                    Last candle: {new Date(panelPriceData.lastCandleTime * 1000).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <div className="text-[11px] text-slate-400">Win Rate</div>
                <div className="text-emerald-300 font-semibold">
                  {panelTradeSignal.winRate.toFixed(1)}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Confidence</div>
                <div className="text-blue-300 font-semibold">
                  {panelTradeSignal.confidence.toFixed(0)}%
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">R:R Ratio</div>
                <div className="text-amber-300 font-semibold">
                  1:{(panelTradeSignal.reward / panelTradeSignal.risk).toFixed(2)}
                </div>
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <span className="text-[11px] text-slate-400">Expected Win Rate</span>
                <span className="text-[11px] text-emerald-300">
                  {panelTradeSignal.winRate.toFixed(1)}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-rose-400 via-blue-400 to-emerald-400"
                  style={{ width: `${Math.max(0, Math.min(100, panelTradeSignal.winRate))}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2">
                <div className="text-[11px] font-semibold text-slate-200 mb-1">Trend Stack</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Bias Model</span>
                    <span className="text-slate-200">
                      {autoStrategyMode === "SCALP_M15" ? "M15 -> Entry" : "H4 -> H1 -> Entry"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">
                      {autoStrategyMode === "SCALP_M15" ? "M15 Bias" : "Trend Bias"}
                    </span>
                    <span
                      className={
                        strategyBias === "BUY"
                          ? "text-emerald-300"
                          : strategyBias === "SELL"
                          ? "text-rose-300"
                          : "text-slate-400"
                      }
                    >
                      {strategyBias || "N/A"}
                    </span>
                  </div>
                  {strategyTrendData && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Trend Price</span>
                        <span className="text-slate-200">
                          {strategyTrendData.current.toFixed(panelIsCrypto ? 2 : 5)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Trend EMA50</span>
                        <span className="text-sky-300">
                          {strategyTrendData.movingAverage50.toFixed(panelIsCrypto ? 2 : 5)}
                        </span>
                      </div>
                    </>
                  )}
                  {strategyEntryData && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Entry RSI</span>
                        <span className={scalpRsiOk ? "text-emerald-300" : "text-amber-300"}>
                          {strategyEntryData.rsi.toFixed(1)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Near EMA50</span>
                        <span className={scalpNearEma ? "text-emerald-300" : "text-slate-400"}>
                          {scalpNearEma ? "YES" : "NO"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Near S/R</span>
                        <span className={scalpNearSr ? "text-emerald-300" : "text-slate-400"}>
                          {scalpNearSr ? "YES" : "NO"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Entry Signal</span>
                        <span className={getSignalColor(panelStrategy?.entrySignal?.signal || "HOLD")}>
                          {panelStrategy?.entrySignal?.signal || "HOLD"}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2">
                <div className="text-[11px] font-semibold text-slate-200 mb-1">Market Structure</div>
                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">24h Range</span>
                    <span className="text-slate-200">
                      {panelPriceData.low.toFixed(panelIsCrypto ? 2 : 5)} - {panelPriceData.high.toFixed(panelIsCrypto ? 2 : 5)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Current</span>
                    <span className="text-slate-100">
                      {panelPriceData.current.toFixed(panelIsCrypto ? 2 : 5)}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden mt-1">
                    <div
                      className="h-full bg-gradient-to-r from-rose-400 via-blue-400 to-emerald-400"
                      style={{
                        marginLeft: `${((panelPriceData.low / panelPriceData.high) * 100)}%`,
                        width: `${(((panelPriceData.current - panelPriceData.low) / (panelPriceData.high - panelPriceData.low)) * 100) || 50}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-700 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2">
                  <div className="text-[11px] font-semibold text-slate-200 mb-1">Entry Points</div>
                  <div className="text-[11px] text-slate-400">Primary Entry</div>
                  <div className="text-emerald-300 font-semibold">
                    {panelTradeSignal.entryPoints.primary.toFixed(panelIsCrypto ? 2 : 5)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2">Alternative Entry</div>
                  <div className="text-blue-300 font-semibold">
                    {panelTradeSignal.entryPoints.alternative.toFixed(panelIsCrypto ? 2 : 5)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2">
                  <div className="text-[11px] font-semibold text-slate-200 mb-1">Risk Management</div>
                  <div className="text-[11px] text-slate-400">Stop Loss</div>
                  <div className="text-rose-300 font-semibold">
                    {panelTradeSignal.stopLoss.toFixed(panelIsCrypto ? 2 : 5)}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-2">Take Profit</div>
                  <div className="text-emerald-300 font-semibold">
                    {panelTradeSignal.takeProfit.toFixed(panelIsCrypto ? 2 : 5)}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2 text-center">
                  <div className="text-[11px] text-slate-400 mb-1">Risk Amount</div>
                  <div className="text-rose-300 font-semibold">
                    {panelTradeSignal.risk.toFixed(panelIsCrypto ? 2 : 5)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2 text-center">
                  <div className="text-[11px] text-slate-400 mb-1">Reward Amount</div>
                  <div className="text-emerald-300 font-semibold">
                    {panelTradeSignal.reward.toFixed(panelIsCrypto ? 2 : 5)}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700/60 bg-slate-900/60 p-2 text-center">
                  <div className="text-[11px] text-slate-400 mb-1">R-R Ratio</div>
                  <div className="text-blue-300 font-semibold">
                    1:{(panelTradeSignal.reward / panelTradeSignal.risk).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* IMPORTANT DISCLAIMER
      <div className="card bg-amber-500/10 border-2 border-amber-500/50">
        <div className="flex gap-3">
          <span className="text-2xl">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ</span>
          <div>
            <h3 className="font-bold text-amber-400 mb-2">USING REAL MARKET DATA</h3>
            <p className="text-sm text-amber-300">
              <strong>Source:</strong> Native MT5 candles from your logged-in terminal ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã¢â‚¬Å“ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œ<br/>
              <strong>Technical analysis:</strong> RSI, Moving Averages, and MACD computed from MT5 candles<br/>
              <strong>Execution validation:</strong> Risk policy checks use MT5 live reference candles<br/>
            </p>
            <p className="text-xs text-amber-200 mt-2">
              Always conduct your own research. Past performance does not guarantee future results.
            </p>
          </div>
        </div>
      </div>
      */}

      {loading && (
        <div className="card flex items-center justify-center py-12">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-4 border-slate-600 border-t-emerald-400 rounded-full mx-auto mb-3"></div>
            <p className={THEME.TEXT_SECONDARY}>Analyzing {selectedSymbol}...</p>
          </div>
        </div>
      )}

      {!loading && (
        <div className="space-y-6">
          {/* AI Watchlist Copilot */}
          <div className="card border border-fuchsia-400/30">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
              <div className="flex flex-col gap-1">
                <h4 className={`font-bold ${THEME.TEXT_PRIMARY}`}>AI Watchlist Copilot</h4>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-semibold border ${bridgeBadge.className}`}>
                    {bridgeBadge.label}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {bridgeVersionCheck.message}
                  </span>
                </div>
              </div>
              <button
                onClick={handleGenerateAiTradePlan}
                disabled={aiLoading}
                className="px-3 py-1.5 rounded-md border border-fuchsia-400/60 bg-fuchsia-400/10 text-fuchsia-300 text-xs font-semibold hover:bg-fuchsia-400/20 disabled:opacity-60"
              >
                {aiLoading ? "Generating..." : "Generate Watchlist Plan"}
              </button>
            </div>
            <textarea
              value={aiNote}
              onChange={(e) => setAiNote(e.target.value)}
              rows={2}
              placeholder="Optional note for AI (e.g., avoid high-impact news, intraday only, skip low-liquidity hours)"
              className="w-full mb-3 px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white text-sm"
            />
            {aiError && (
              <p className="text-sm text-rose-400 mb-2">{aiError}</p>
            )}
            {aiProviderUsed && (
              <p className="text-xs text-slate-400 mb-2">Provider: {aiProviderUsed}</p>
            )}
            {aiResponse ? (
              <pre className="whitespace-pre-wrap text-sm text-slate-200 bg-slate-900/70 border border-slate-700 rounded p-3">
                {aiResponse}
              </pre>
            ) : (
              <p className="text-sm text-slate-400">
                Scan watchlist symbols using price action + external market news and generate todayÃƒÂ¢Ã¢â€šÂ¬Ã¢â€žÂ¢s best trade shortlist.
              </p>
            )}
          </div>

          {/* Real-World Price Charts */}
          <div className="card">
            <div className="mb-3">
              <h4 className={`font-bold ${THEME.TEXT_PRIMARY}`}>Price Charts</h4>
            </div>
            <div className="mb-4 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-100">Watchlist Signal Board</div>
                  <div className="text-xs text-slate-400">
                    All rows are based on <span className="text-slate-200">{watchlistBoardTimeframe}</span>.
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                  <label className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                    <span>TF</span>
                    <select
                      value={watchlistBoardTimeframe}
                      onChange={(e) => setWatchlistBoardTimeframe(e.target.value as ChartTimeframe)}
                      className="rounded bg-slate-800 border border-slate-600 text-xs text-slate-200 px-2 py-1"
                    >
                      {TIMEFRAMES.map((timeframe) => (
                        <option key={`watchlist-tf-${timeframe}`} value={timeframe}>
                          {timeframe}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                    <span>Type</span>
                    <select
                      value={watchlistBoardTypeFilter}
                      onChange={(e) => setWatchlistBoardTypeFilter(e.target.value as WatchlistBoardTypeFilter)}
                      className="rounded bg-slate-800 border border-slate-600 text-xs text-slate-200 px-2 py-1"
                    >
                      {WATCHLIST_BOARD_TYPE_OPTIONS.map((option) => (
                        <option key={`watchlist-type-${option.value}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                    <span>Name</span>
                    <input
                      value={watchlistBoardNameFilter}
                      onChange={(e) => setWatchlistBoardNameFilter(e.target.value)}
                      placeholder="BTC, GBP, Gold..."
                      className="w-28 rounded bg-slate-800 border border-slate-600 text-xs text-slate-200 px-2 py-1 placeholder:text-slate-500"
                    />
                  </label>
                  <span className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                    {watchlistBoardLoading ? "Scanning..." : "Live board"}
                  </span>
                  <span className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1">
                    {watchlistBoardUpdatedAtMs
                      ? `Updated ${new Date(watchlistBoardUpdatedAtMs).toLocaleTimeString()}`
                      : "Waiting for first scan"}
                  </span>
                </div>
              </div>
              <div className="mt-3 grid gap-3 xl:grid-cols-2">
                {watchlistBoardTableGroups.length === 0 ? (
                  <div className="rounded border border-slate-700/80 bg-slate-900/70 px-3 py-3 text-xs text-slate-400 xl:col-span-2">
                    No watchlist symbols match the current type or name filter.
                  </div>
                ) : null}
                {watchlistBoardTableGroups.map((group, groupIndex) => (
                  <div key={`watchlist-board-group-${groupIndex}`} className="overflow-x-auto">
                    <table className="min-w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-slate-700/80 text-[10px] uppercase tracking-[0.14em] text-slate-500">
                          <th className="px-2 py-1.5 text-left">Symbol</th>
                          <th className="px-2 py-1.5 text-left">Strength</th>
                          <th className="px-2 py-1.5 text-left">Confidence</th>
                          <th className="px-2 py-1.5 text-left">Win Rate</th>
                          <th className="px-2 py-1.5 text-left">Noise</th>
                          <th className="px-2 py-1.5 text-left">Price Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.map(({ symbol, entry }) => {
                          const tradeSignal = entry?.tradeSignal;
                          const priceData = entry?.priceData;
                          const passesCriteria = doesWatchlistSignalPassCriteria(tradeSignal);
                          const rowClass =
                            passesCriteria && tradeSignal?.signal === "BUY"
                              ? "bg-emerald-500/15 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.35)]"
                              : passesCriteria && tradeSignal?.signal === "SELL"
                              ? "bg-rose-500/15 shadow-[inset_0_0_0_1px_rgba(251,113,133,0.35)]"
                              : "";

                          return (
                            <tr
                              key={`watchlist-board-${symbol}`}
                              className={`border-b border-slate-800/80 transition ${rowClass}`}
                            >
                              <td className="px-2 py-1.5 align-top">
                                <div className="font-semibold text-slate-100">{formatPairLabel(symbol)}</div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                                  <span
                                    className={`rounded border px-1.5 py-0.5 font-semibold ${
                                      tradeSignal ? getSignalSurfaceClass(tradeSignal.signal) : "border-slate-700 bg-slate-900/80 text-slate-500"
                                    }`}
                                  >
                                    {tradeSignal?.signal || "NO DATA"}
                                  </span>
                                  {passesCriteria ? (
                                    <span
                                      className={`rounded border px-1.5 py-0.5 font-semibold ${
                                        tradeSignal?.signal === "BUY"
                                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                                          : "border-rose-400/40 bg-rose-500/15 text-rose-200"
                                      }`}
                                    >
                                      PASS
                                    </span>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-2 py-1.5 align-top font-semibold text-slate-200">
                                {tradeSignal?.strength || "--"}
                              </td>
                              <td className={`px-2 py-1.5 align-top font-semibold ${tradeSignal ? getPercentTone(tradeSignal.confidence) : "text-slate-500"}`}>
                                {tradeSignal ? `${tradeSignal.confidence.toFixed(0)}%` : "--"}
                              </td>
                              <td className={`px-2 py-1.5 align-top font-semibold ${tradeSignal ? getPercentTone(tradeSignal.winRate) : "text-slate-500"}`}>
                                {tradeSignal ? `${tradeSignal.winRate.toFixed(0)}%` : "--"}
                              </td>
                              <td className={`px-2 py-1.5 align-top font-semibold ${tradeSignal ? getNoiseTone(tradeSignal.noiseState) : "text-slate-500"}`}>
                                {tradeSignal?.noiseState || "--"}
                              </td>
                              <td className="px-2 py-1.5 align-top">
                                {priceData ? (
                                  <>
                                    <div className="font-semibold text-slate-200">
                                      {priceData.current.toFixed(isCryptoSymbol(symbol) ? 2 : 5)}
                                    </div>
                                    <div className={priceData.changePercent >= 0 ? "text-emerald-300" : "text-rose-300"}>
                                      {priceData.changePercent >= 0 ? "+" : ""}
                                      {priceData.changePercent.toFixed(2)}%
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-slate-500">--</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid items-start gap-4 md:grid-cols-2">
              {panelSymbols.map((panelSymbol, index) =>
                fullscreenChartIndex === index ? null : renderChartPanel(panelSymbol, index)
              )}
            </div>
            {fullscreenChartIndex !== null && panelSymbols[fullscreenChartIndex] && (
              <div className="fixed inset-0 z-50 bg-slate-950/85 px-3 py-4 backdrop-blur-sm md:px-6 md:py-6">
                <div className="mx-auto flex h-full max-w-7xl flex-col">
                  {renderChartPanel(panelSymbols[fullscreenChartIndex], fullscreenChartIndex, true)}
                </div>
              </div>
            )}
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-3`}>
              Candles: Green = Up, Red = Down. Check the chart header for active data source (MT5).
            </p>
          </div>

          {/* Entry & Exit Strategy (moved to chart panels) */}
          {/* MT5 Trading Panel */}
          <div className="card border border-blue-400/30">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between mb-4">
              <h4 className={`font-bold ${THEME.TEXT_PRIMARY}`}>MT5 Trading Panel (Guarded)</h4>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowTradeSettings((prev) => !prev)}
                  className="px-2.5 py-1.5 text-xs rounded-md border border-slate-600 bg-slate-700/50 text-slate-200 hover:border-slate-500"
                  title="Trading settings"
                >
                  Settings
                </button>
                <button
                  type="button"
                  onClick={() => setShowRiskCalcModule((prev) => !prev)}
                  className="px-2.5 py-1.5 text-xs rounded-md border border-cyan-400/50 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20"
                >
                  Risk Cal Module
                </button>
                <button
                  type="button"
                  onClick={() => setShowManualOrderSection((prev) => !prev)}
                  className="px-2.5 py-1.5 text-xs rounded-md border border-blue-400/50 bg-blue-400/10 text-blue-200 hover:bg-blue-400/20"
                >
                  {showManualOrderSection ? "Hide Manual Order" : "Show Manual Order"}
                </button>
                <button
                  onClick={loadOpenPositions}
                  disabled={tradeBridgeBusy}
                  className="px-3 py-1.5 text-xs rounded-md border border-slate-600 bg-slate-700/50 text-slate-200 hover:border-slate-500 disabled:opacity-60"
                >
                  Refresh Positions
                </button>
              </div>
            </div>

            <div className="mb-4 p-3 rounded border border-fuchsia-400/30 bg-fuchsia-400/5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-fuchsia-300">Auto Trade (AI-driven)</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {isHeadlessMode
                      ? "Bridge-owned runtime. It can keep trading after the UI is closed."
                      : "Browser-owned runtime. It pauses when the tab is hidden or closed."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-xs text-slate-300">
                    <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Runtime</span>
                    <select
                      value={autoRuntimeMode}
                      onChange={(e) => setAutoRuntimeMode(e.target.value as AutoRuntimeMode)}
                      className="px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                    >
                      <option value="BROWSER">Browser</option>
                      <option value="HEADLESS">Headless 24/7</option>
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-200 pt-5">
                    <input
                      type="checkbox"
                      checked={autoTradeEnabled}
                      onChange={(e) => setAutoTradeEnabled(e.target.checked)}
                    />
                    Enable
                  </label>
                </div>
              </div>
              {autoTradeStatusDisplay && (
                <p className="text-xs text-slate-300 mt-2">{autoTradeStatusDisplay}</p>
              )}
              {isHeadlessMode && (
                <div className="mt-2 rounded border border-cyan-400/30 bg-cyan-400/5 p-2 text-[11px] text-slate-300">
                  <p>
                    Headless runtime: {headlessRuntimeStatus.autoRunning ? "running" : "idle"}
                    {headlessRuntimeStatus.autoBusy ? " | scan in progress" : ""}
                    {headlessRuntimeStatus.commandBusy ? " | MT5 command busy" : ""}
                  </p>
                  {headlessRuntimeStatus.lastAutoCompletedAtMs > 0 && (
                    <p className="text-slate-400 mt-1">
                      Last auto scan: {new Date(headlessRuntimeStatus.lastAutoCompletedAtMs).toISOString()}
                    </p>
                  )}
                  {headlessRuntimeStatus.lastProtectCompletedAtMs > 0 && (
                    <p className="text-slate-400 mt-1">
                      Last protect pass: {new Date(headlessRuntimeStatus.lastProtectCompletedAtMs).toISOString()}
                    </p>
                  )}
                </div>
              )}
              {(blockedBySideSummary.BUY.total > 0 || blockedBySideSummary.SELL.total > 0) && (
                <div className="mt-2 grid md:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-slate-200 font-semibold">
                      BUY blocks: {blockedBySideSummary.BUY.blocked}/{blockedBySideSummary.BUY.total}
                    </p>
                    {blockedBySideSummary.BUY.topReasons.length ? (
                      <p className="text-slate-400 mt-1">
                        {blockedBySideSummary.BUY.topReasons
                          .map(([reason, count]) => `${count}x ${reason}`)
                          .join(" | ")}
                      </p>
                    ) : (
                      <p className="text-slate-500 mt-1">No BUY blocks detected.</p>
                    )}
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-slate-200 font-semibold">
                      SELL blocks: {blockedBySideSummary.SELL.blocked}/{blockedBySideSummary.SELL.total}
                    </p>
                    {blockedBySideSummary.SELL.topReasons.length ? (
                      <p className="text-slate-400 mt-1">
                        {blockedBySideSummary.SELL.topReasons
                          .map(([reason, count]) => `${count}x ${reason}`)
                          .join(" | ")}
                      </p>
                    ) : (
                      <p className="text-slate-500 mt-1">No SELL blocks detected.</p>
                    )}
                  </div>
                </div>
              )}
              {autoTradeTimeframeOverride && autoTradeTimeframeOverride !== "PANEL" && (
                <p className="text-[11px] text-slate-400 mt-1">
                  Auto-trade timeframe override: {autoTradeTimeframeOverride}
                </p>
              )}
              <p className="text-[11px] text-slate-400 mt-1">
                Trend stack: {formatTrendStackLabel(autoStrategyMode, autoEntryTimeframe)}
              </p>
              <div className="mt-3 rounded border border-amber-400/30 bg-amber-400/5 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-200">Adaptive Learning</p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      {adaptiveLearningReport.sampleSize} closed trades analyzed | PF{" "}
                      {adaptiveLearningReport.metrics.profitFactor === null
                        ? "-"
                        : adaptiveLearningReport.metrics.profitFactor.toFixed(2)}{" "}
                      | Expectancy ${adaptiveLearningReport.metrics.expectancy.toFixed(2)} | Recent WR{" "}
                      {adaptiveLearningReport.metrics.recentWinRate.toFixed(0)}% | Session now{" "}
                      {formatAdaptiveSessionLabel(activeAdaptiveSession)}
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={adaptiveLearningEnabled}
                      onChange={(e) => setAdaptiveLearningEnabled(e.target.checked)}
                    />
                    Enforce learned filters
                  </label>
                </div>
                <div className="mt-3 grid lg:grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-slate-200 font-semibold">
                      Min Confidence: {adaptiveLearningReport.recommendations.minConfidence.current}%
                      {" -> "}
                      {adaptiveLearningReport.recommendations.minConfidence.suggested}%
                    </p>
                    <p className="text-slate-400 mt-1">
                      {adaptiveLearningReport.recommendations.minConfidence.reason}
                    </p>
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-slate-200 font-semibold">
                      Min R:R: {adaptiveLearningReport.recommendations.minRR.current.toFixed(2)}
                      {" -> "}
                      {adaptiveLearningReport.recommendations.minRR.suggested.toFixed(2)}
                    </p>
                    <p className="text-slate-400 mt-1">
                      {adaptiveLearningReport.recommendations.minRR.reason}
                    </p>
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-slate-200 font-semibold">
                      Cooldown: {adaptiveLearningReport.recommendations.cooldownMin.current}m
                      {" -> "}
                      {adaptiveLearningReport.recommendations.cooldownMin.suggested}m
                    </p>
                    <p className="text-slate-400 mt-1">
                      {adaptiveLearningReport.recommendations.cooldownMin.reason}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid lg:grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-slate-200 font-semibold">Weak Symbols</p>
                    {adaptiveLearningReport.weakSymbols.length === 0 ? (
                      <p className="text-slate-500 mt-1">No weak-symbol pattern yet.</p>
                    ) : (
                      <p className="text-slate-400 mt-1">
                        {adaptiveLearningReport.weakSymbols
                          .slice(0, 3)
                          .map(
                            (item) =>
                              `${formatPairLabel(item.key)} (${item.count} trades, WR ${item.winRate.toFixed(0)}%, PnL $${item.totalPnl.toFixed(2)})`
                          )
                          .join(" | ")}
                      </p>
                    )}
                    {adaptiveLearningReport.recommendations.blockSymbols.length > 0 && (
                      <p className="text-amber-300 mt-2">
                        Suggested blocklist:{" "}
                        {adaptiveLearningReport.recommendations.blockSymbols
                          .map((symbol) => formatPairLabel(symbol))
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                    <p className="text-slate-200 font-semibold">Weak Sessions</p>
                    {adaptiveLearningReport.weakSessions.length === 0 ? (
                      <p className="text-slate-500 mt-1">No weak-session pattern yet.</p>
                    ) : (
                      <p className="text-slate-400 mt-1">
                        {adaptiveLearningReport.weakSessions
                          .slice(0, 3)
                          .map(
                            (item) =>
                              `${formatAdaptiveSessionLabel(item.session)} (${item.count} trades, WR ${item.winRate.toFixed(0)}%, PnL $${item.totalPnl.toFixed(2)})`
                          )
                          .join(" | ")}
                      </p>
                    )}
                    {adaptiveLearningReport.recommendations.blockSessions.length > 0 && (
                      <p className="text-amber-300 mt-2">
                        Suggested blocked sessions:{" "}
                        {adaptiveLearningReport.recommendations.blockSessions
                          .map((session) => formatAdaptiveSessionLabel(session))
                          .join(", ")}
                      </p>
                    )}
                  </div>
                </div>
                {adaptiveLearningReport.notes.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {adaptiveLearningReport.notes.map((note, idx) => (
                      <p key={`adaptive-note-${idx}`} className="text-[11px] text-slate-400">
                        - {note}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={applyAdaptiveRecommendations}
                    disabled={adaptiveLearningReport.sampleSize === 0 || !adaptiveRecommendationsPending}
                    className="px-2 py-1 text-[11px] rounded border border-amber-400/50 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 disabled:opacity-50"
                  >
                    Apply Recommendations
                  </button>
                  <button
                    type="button"
                    onClick={clearAdaptiveFilters}
                    disabled={learnedBlockedSymbols.length === 0 && learnedBlockedSessions.length === 0 && !adaptiveLearningEnabled}
                    className="px-2 py-1 text-[11px] rounded border border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500 disabled:opacity-50"
                  >
                    Clear Learned Filters
                  </button>
                </div>
                {(learnedBlockedSymbols.length > 0 || learnedBlockedSessions.length > 0) && (
                  <p className="text-[11px] text-cyan-200 mt-2">
                    Active learned filters:{" "}
                    {learnedBlockedSymbols.length > 0
                      ? `symbols ${learnedBlockedSymbols.map((symbol) => formatPairLabel(symbol)).join(", ")}`
                      : "no blocked symbols"}
                    {learnedBlockedSessions.length > 0
                      ? ` | sessions ${learnedBlockedSessions.map((session) => formatAdaptiveSessionLabel(session)).join(", ")}`
                      : ""}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                <input
                  ref={settingsImportInputRef}
                  type="file"
                  accept="application/json"
                  onChange={(event) => {
                    void importSettingsBundle(event);
                  }}
                  className="hidden"
                />
                {isHeadlessMode && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        void syncHeadlessConfig(buildHeadlessConfigPayload());
                      }}
                      disabled={headlessSyncBusy}
                      className="px-2 py-1 text-[11px] rounded border border-cyan-400/50 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
                    >
                      {headlessSyncBusy ? "Syncing..." : "Sync Headless"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setHeadlessSyncBusy(true);
                        try {
                          const response = await fetch(`${mt4BridgeBase}/headless/scan-now`, { method: "POST" });
                          await readResponseJsonSafe(response);
                          await loadHeadlessStatus();
                        } finally {
                          setHeadlessSyncBusy(false);
                        }
                      }}
                      disabled={headlessSyncBusy}
                      className="px-2 py-1 text-[11px] rounded border border-cyan-400/50 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
                    >
                      Run Headless Scan
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        setHeadlessSyncBusy(true);
                        try {
                          const response = await fetch(`${mt4BridgeBase}/headless/protect-now`, { method: "POST" });
                          await readResponseJsonSafe(response);
                          await loadHeadlessStatus();
                        } finally {
                          setHeadlessSyncBusy(false);
                        }
                      }}
                      disabled={headlessSyncBusy}
                      className="px-2 py-1 text-[11px] rounded border border-cyan-400/50 bg-cyan-400/10 text-cyan-200 hover:bg-cyan-400/20 disabled:opacity-50"
                    >
                      Run Protect Pass
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    void exportSettingsBundle();
                  }}
                  disabled={settingsBundleBusy}
                  className="px-2 py-1 text-[11px] rounded border border-emerald-400/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
                >
                  {settingsBundleBusy ? "Working..." : "Export Settings"}
                </button>
                <button
                  type="button"
                  onClick={() => settingsImportInputRef.current?.click()}
                  disabled={settingsBundleBusy}
                  className="px-2 py-1 text-[11px] rounded border border-emerald-400/50 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20 disabled:opacity-50"
                >
                  Import Settings
                </button>
                <button
                  type="button"
                  onClick={() => setShowAutoTradeLogs((prev) => !prev)}
                  className="px-2 py-1 text-[11px] rounded border border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500"
                >
                  {showAutoTradeLogs ? "Hide Logs" : "View Logs"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const data = JSON.stringify(
                      {
                        runtimeMode: autoRuntimeMode,
                        logs: activeAutoTradeLogs,
                        audit: activeBotExecutionAuditLogs,
                      },
                      null,
                      2
                    );
                    const blob = new Blob([data], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "auto-trade-audit.json";
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-2 py-1 text-[11px] rounded border border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500"
                >
                  Export Logs
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (isHeadlessMode) return;
                    setAutoTradeLogs([]);
                    setBotExecutionAuditLogs([]);
                  }}
                  disabled={isHeadlessMode}
                  className="px-2 py-1 text-[11px] rounded border border-slate-600 bg-slate-800 text-slate-200 hover:border-slate-500 disabled:opacity-50"
                >
                  Clear Logs
                </button>
              </div>
              {showAutoTradeLogs && (
                <div className="mt-3 max-h-56 overflow-auto rounded border border-slate-700 bg-slate-900/70">
                  <table className="w-full text-[11px] text-slate-300">
                    <thead className="sticky top-0 bg-slate-900/90 text-slate-400">
                      <tr>
                        <th className="text-left px-2 py-1 w-36">Time (UTC)</th>
                        <th className="text-left px-2 py-1 w-16">Level</th>
                        <th className="text-left px-2 py-1">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeAutoTradeLogs.length === 0 ? (
                        <tr>
                          <td className="px-2 py-2 text-slate-500" colSpan={3}>
                            No logs yet.
                          </td>
                        </tr>
                      ) : (
                        activeAutoTradeLogs.map((log, idx) => (
                          <tr key={`${log.ts}-${idx}`} className="border-t border-slate-800">
                            <td className="px-2 py-1 whitespace-nowrap">
                              {new Date(log.ts).toISOString()}
                            </td>
                            <td
                              className={`px-2 py-1 font-semibold ${
                                log.level === "ERROR"
                                  ? "text-rose-300"
                                  : log.level === "WARN"
                                  ? "text-amber-300"
                                  : "text-emerald-300"
                              }`}
                            >
                              {log.level}
                            </td>
                            <td className="px-2 py-1">{log.message}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
              {showAutoTradeLogs && (
                <div className="mt-3 max-h-56 overflow-auto rounded border border-slate-700 bg-slate-900/70">
                  <table className="w-full text-[11px] text-slate-300">
                    <thead className="sticky top-0 bg-slate-900/90 text-slate-400">
                      <tr>
                        <th className="text-left px-2 py-1 w-36">Time (UTC)</th>
                        <th className="text-left px-2 py-1 w-24">Symbol</th>
                        <th className="text-left px-2 py-1 w-28">Stage</th>
                        <th className="text-left px-2 py-1">Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeBotExecutionAuditLogs.length === 0 ? (
                        <tr>
                          <td className="px-2 py-2 text-slate-500" colSpan={4}>
                            No audit entries yet.
                          </td>
                        </tr>
                      ) : (
                        activeBotExecutionAuditLogs.map((log, idx) => (
                          <tr key={`${log.ts}-${idx}`} className="border-t border-slate-800">
                            <td className="px-2 py-1 whitespace-nowrap">{new Date(log.ts).toISOString()}</td>
                            <td className="px-2 py-1">{log.symbol}</td>
                            <td className="px-2 py-1 font-semibold text-cyan-300">{log.stage}</td>
                            <td className="px-2 py-1">{log.details}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {showTradeSettings && (
              <div className="mb-4 p-3 rounded border border-slate-600 bg-slate-800/50">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-200">GOLD + ETH Setup</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateSelectedManagedSymbolTradeDraft(
                          buildManagedSymbolTradeDraft(selectedManagedSymbol, headlessRuntimeConfig)
                        )
                      }
                      title="Reload the selected symbol draft from the active managed profile."
                      className="px-2 py-1 text-[11px] rounded border border-slate-600 bg-slate-700/50 text-slate-200 hover:border-slate-500"
                    >
                      Reload Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => void applySelectedManagedSymbolSettings()}
                      className="px-2 py-1 text-[11px] rounded border border-emerald-400/60 bg-emerald-400/10 text-emerald-200 hover:bg-emerald-400/20"
                    >
                      Apply Selected
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTradeSettings(false)}
                      className="px-2 py-1 text-[11px] rounded border border-slate-600 bg-slate-700/50 text-slate-200 hover:border-slate-500"
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="grid xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)] gap-3">
                    <div className="rounded border border-slate-700 bg-slate-900/40 p-3">
                      <p className="text-xs font-semibold text-cyan-200 mb-2">Selected Symbol Setup</p>
                      <p className="text-[11px] text-slate-400 mb-3">
                        Choose `GOLD` or `ETHUSD`, load that symbol's profile, then apply only the selected symbol. Shared account and protection controls stay outside this symbol-level apply flow.
                      </p>
                      <div className="flex flex-wrap gap-2 mb-3">
                        {MANAGED_SYMBOLS.map((symbol) => {
                          const active = selectedManagedSymbol === symbol;
                          return (
                            <button
                              key={`managed-symbol-toggle-${symbol}`}
                              type="button"
                              onClick={() => setSelectedManagedSymbol(symbol)}
                              className={`px-3 py-1.5 rounded border text-xs font-semibold ${
                                active
                                  ? symbol === "GOLD"
                                    ? "border-amber-400/60 bg-amber-400/10 text-amber-200"
                                    : "border-cyan-400/60 bg-cyan-400/10 text-cyan-200"
                                  : "border-slate-600 bg-slate-800 text-slate-300 hover:border-slate-500"
                              }`}
                            >
                              {symbol === "GOLD" ? "GOLD M5" : "ETHUSD M15"}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                        <label className="text-xs" title="Managed strategy used by the selected symbol profile.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Strategy Profile</span>
                          <input
                            value={selectedManagedSymbol === "GOLD" ? "GOLD Trend Pullback" : "ETH Trend Pullback"}
                            readOnly
                            className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300"
                          />
                        </label>

                        <label className="text-xs" title="Limit auto-trading to buy-only, sell-only, or allow both sides.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Trade Side</span>
                          <select
                            value={selectedManagedSymbolTradeDraft.sideFilter}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({
                                ...prev,
                                sideFilter: e.target.value as AutoSideFilter,
                              }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          >
                            <option value="BOTH">Both</option>
                            <option value="BUY_ONLY">Buy only</option>
                            <option value="SELL_ONLY">Sell only</option>
                          </select>
                        </label>

                        <label className="text-xs" title="Managed entry behavior uses pending limit orders at support or resistance in the H4 direction.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Entry Model</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.entryMode === "LIMIT_SR" ? "BUY_LIMIT / SELL_LIMIT @ S/R" : "MARKET"}
                            readOnly
                            className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300"
                          />
                        </label>

                        <label className="text-xs" title="Current managed symbol being edited.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Selected Symbol</span>
                          <input
                            value={selectedManagedSymbol === "GOLD" ? "GOLD M5" : "ETHUSD M15"}
                            readOnly
                            className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-300"
                          />
                        </label>

                        <label className="text-xs" title="Minimum signal confidence required before auto-trade can execute.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Min Confidence %</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.minConfidence}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, minConfidence: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="text-xs" title="Minimum modeled win rate required before auto-trade can execute.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Min Win Rate %</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.minWinRate}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, minWinRate: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="text-xs" title="Minimum reward-to-risk ratio required by policy.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Min R:R</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.minRR}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, minRR: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="text-xs" title="Base spread guard in points before symbol multipliers are applied. Gold uses a 1.25x multiplier on top of this value.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Max Spread Points</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.maxSpreadPoints}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, maxSpreadPoints: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="text-xs" title="Minimum wait time between trades on the same symbol.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Cooldown (minutes)</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.cooldownMin}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, cooldownMin: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="text-xs" title="Maximum number of open positions allowed at the same time across all symbols.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Max Active Trades</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.maxOpenTrades}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, maxOpenTrades: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="text-xs" title="Choose whether dynamic lot sizing uses a percent of balance or a fixed USD risk target.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Risk Mode</span>
                          <select
                            value={selectedManagedSymbolTradeDraft.riskMode}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, riskMode: e.target.value as "PCT" | "USD" }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          >
                            <option value="PCT">Percent of balance</option>
                            <option value="USD">Fixed USD risk</option>
                          </select>
                        </label>

                        <label className="text-xs" title="Risk target as a percentage of account balance per trade.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Risk Per Trade %</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.riskPct}
                            disabled={selectedManagedSymbolTradeDraft.riskMode !== "PCT"}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, riskPct: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white disabled:opacity-50"
                          />
                        </label>

                        <label className="text-xs" title="Fixed USD risk target per trade.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Risk Per Trade USD</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.riskUsd}
                            disabled={selectedManagedSymbolTradeDraft.riskMode !== "USD"}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, riskUsd: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white disabled:opacity-50"
                          />
                        </label>

                        <label className="text-xs" title="Base lot size for the bot. With dynamic lot ON this acts as the maximum lot cap. With dynamic lot OFF this becomes the fixed lot used for each trade.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Default Bot Lots</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.botLots}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, botLots: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs text-slate-300 mt-2" title="Turn ON to let the bot calculate lot size from your risk settings. Turn OFF to use Default Bot Lots as a fixed lot per trade.">
                          <input
                            type="checkbox"
                            checked={selectedManagedSymbolTradeDraft.useDynamicLot}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, useDynamicLot: e.target.checked }))
                            }
                          />
                          Dynamic Lot ON/OFF
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs text-slate-300 mt-2" title="Require a strong signal before the selected symbol can trade.">
                          <input
                            type="checkbox"
                            checked={selectedManagedSymbolTradeDraft.requireStrong}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, requireStrong: e.target.checked }))
                            }
                          />
                          Require strong signal
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs text-slate-300 mt-2" title="If disabled, symbol cooldown becomes advisory only for the selected symbol.">
                          <input
                            type="checkbox"
                            checked={selectedManagedSymbolTradeDraft.enforceSymbolCooldown}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, enforceSymbolCooldown: e.target.checked }))
                            }
                          />
                          Enforce symbol cooldown
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs text-slate-300 mt-2" title="If disabled, the daily loss limit policy becomes advisory only for the selected symbol.">
                          <input
                            type="checkbox"
                            checked={selectedManagedSymbolTradeDraft.enforceDailyLossLimit}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, enforceDailyLossLimit: e.target.checked }))
                            }
                          />
                          Enforce daily loss limit
                        </label>

                        <label className="inline-flex items-center gap-2 text-xs text-slate-300 mt-2" title="If disabled, the hard risk block becomes advisory only for the selected symbol.">
                          <input
                            type="checkbox"
                            checked={selectedManagedSymbolTradeDraft.enforceHardRiskBlock}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, enforceHardRiskBlock: e.target.checked }))
                            }
                          />
                          Enforce hard risk block
                        </label>

                        <label className="text-xs" title="Minimum stop distance in points for the selected symbol.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Min Stop Points</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.minSlPoints}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, minSlPoints: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>

                        <label className="text-xs" title="ATR buffer multiplier used when building stop distance around structure.">
                          <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>ATR Buffer</span>
                          <input
                            value={selectedManagedSymbolTradeDraft.atrBufferMult}
                            onChange={(e) =>
                              updateSelectedManagedSymbolTradeDraft((prev) => ({ ...prev, atrBufferMult: e.target.value }))
                            }
                            className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                          />
                        </label>
                      </div>
                      <div className="mt-3 text-[11px] text-slate-400">
                        {selectedManagedSymbol === "GOLD"
                          ? "Editing the GOLD M5 managed profile. This symbol keeps the stricter metal setup and overnight handling in the headless runtime."
                          : "Editing the ETHUSD M15 managed profile. This symbol keeps the looser crypto pullback setup and no overnight auto-close profile."}
                      </div>
                      <div className="mt-2 text-[11px] text-slate-400">
                        These controls affect only the selected symbol when you click `Apply Selected`.
                      </div>
                    </div>

                    <div className="space-y-3">
                      {selectedManagedSymbolWarnings.length > 0 && (
                        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
                          <p className="text-xs font-semibold text-amber-300 mb-1">Settings Warnings</p>
                          <div className="space-y-1">
                            {selectedManagedSymbolWarnings.map((warning, idx) => (
                              <p key={`settings-warning-${idx}`} className="text-[11px] text-amber-200">
                                - {warning}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {hasSelectedManagedSymbolUnappliedChanges && (
                        <div className="rounded border border-cyan-500/40 bg-cyan-500/10 p-2">
                          <p className="text-xs font-semibold text-cyan-200 mb-1">Unapplied Changes</p>
                          <p className="text-[11px] text-cyan-100">
                            The visible {selectedManagedSymbol} draft differs from the active applied profile. Click `Apply Selected` to sync only this symbol.
                          </p>
                        </div>
                      )}

                      {setupConflictWarnings.length > 0 && (
                        <div className="rounded border border-rose-500/40 bg-rose-500/10 p-2">
                          <p className="text-xs font-semibold text-rose-300 mb-1">Setup Conflicts</p>
                          <div className="space-y-1">
                            {setupConflictWarnings.map((warning, idx) => (
                              <p key={`setup-conflict-${idx}`} className="text-[11px] text-rose-200">
                                - {warning}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="grid gap-3 md:grid-cols-2">
                        {managedSetupCards.map((card) => (
                          <div
                            key={`managed-setup-card-${card.symbol}`}
                            className={`rounded border p-3 ${card.accent.border} ${card.accent.bg}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className={`text-xs font-semibold ${card.accent.title}`}>{card.title}</p>
                                <p className={`text-[11px] ${card.accent.text}`}>{card.description}</p>
                              </div>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${card.accent.pill}`}>
                                {card.entryMode === "LIMIT_SR" ? "LIMIT @ S/R" : "MARKET"}
                              </span>
                            </div>
                            <div className="mt-3">
                              <p className={`text-[11px] font-semibold ${card.accent.title}`}>Trading Settings</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px] mt-2">
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Timeframe</p>
                                <p className="text-slate-100">{card.timeframe}</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Bias Path</p>
                                <p className="text-slate-100">{card.biasPath}</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Trade Side</p>
                                <p className="text-slate-100">{card.sideFilterLabel}</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Entry Mode</p>
                                <p className="text-slate-100">{card.entryMode === "LIMIT_SR" ? "BUY_LIMIT / SELL_LIMIT" : "MARKET"}</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Min Confidence</p>
                                <p className="text-slate-100">{card.minConfidence}%</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Min Win Rate</p>
                                <p className="text-slate-100">{card.minWinRate}%</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Min R:R</p>
                                <p className="text-slate-100">{card.minRR.toFixed(1)}R</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Max Spread</p>
                                <p className="text-slate-100">{card.maxSpreadPoints} pts</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Cooldown</p>
                                <p className="text-slate-100">{card.cooldownMin} minutes</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">Min Stop</p>
                                <p className="text-slate-100">{card.minSlPoints} pts</p>
                              </div>
                              <div className="rounded border border-slate-800/70 bg-slate-950/40 p-2">
                                <p className="text-slate-400">ATR Buffer</p>
                                <p className="text-slate-100">x{card.atrBufferMult.toFixed(2)}</p>
                              </div>
                            </div>
                            <div className="mt-3">
                              <p className={`text-[11px] font-semibold ${card.accent.title}`}>Protection & Filters</p>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.requireStrong ? "STRONG signal required" : "Signal strength relaxed"}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.newsFilterEnabled ? "News filter ON" : "News filter OFF"}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.ma200FlatEnabled ? "MA200 flat guard ON" : "MA200 flat guard OFF"}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.overnightEnabled ? "Overnight protect ON" : "No overnight auto-close"}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.symbolCooldown ? "Symbol cooldown ON" : "Symbol cooldown OFF"}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.hardRiskBlock ? "Hard risk block ON" : "Hard risk block OFF"}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.breakEvenEnabled ? `Break-even +$${card.breakEvenProfitUsd.toFixed(2)}` : "Break-even OFF"}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-slate-200">
                                {card.degradeCloseEnabled ? "Opposite-signal exit ON" : "Opposite-signal exit OFF"}
                              </span>
                            </div>
                            <p className="mt-3 text-[11px] text-slate-300">{card.notes}</p>
                          </div>
                        ))}
                      </div>

                      <div className={`rounded p-2 ${autoTradeDraft.sessionGateEnabled ? "border border-cyan-500/30 bg-cyan-500/10" : "border border-amber-500/30 bg-amber-500/10"}`}>
                        <p className={`text-xs font-semibold mb-1 ${autoTradeDraft.sessionGateEnabled ? "text-cyan-200" : "text-amber-200"}`}>Session Gate</p>
                        <p className={`text-[11px] ${autoTradeDraft.sessionGateEnabled ? "text-cyan-100" : "text-amber-100"}`}>
                          {autoTradeDraft.sessionGateEnabled
                            ? `Trades are allowed only during ${sessionWindowLabel}${autoSessionWindowIncludeCrypto ? " (including crypto)." : " (crypto exempt)."}` 
                            : "Session gate is disabled. Time-window checks are bypassed."}
                        </p>
                      </div>

                      <div className={`rounded p-2 ${autoTradeDraft.enforceDailyLossLimit ? "border border-slate-600 bg-slate-900/50" : "border border-amber-500/30 bg-amber-500/10"}`}>
                        <p className={`text-xs font-semibold mb-1 ${autoTradeDraft.enforceDailyLossLimit ? "text-slate-200" : "text-amber-200"}`}>Daily Loss Limit</p>
                        <p className={`text-[11px] ${autoTradeDraft.enforceDailyLossLimit ? "text-slate-300" : "text-amber-100"}`}>
                          {autoTradeDraft.enforceDailyLossLimit
                            ? "Daily loss guard remains a blocking policy."
                            : "Daily loss limit is disabled. Loss-cap checks stay visible in diagnostics but no longer block trades."}
                        </p>
                      </div>

                      <div className={`rounded p-2 ${protectOvernightEnabled ? "border border-emerald-500/30 bg-emerald-500/10" : "border border-slate-600 bg-slate-900/50"}`}>
                        <p className={`text-xs font-semibold mb-1 ${protectOvernightEnabled ? "text-emerald-200" : "text-slate-200"}`}>Overnight Mode</p>
                        <p className={`text-[11px] ${protectOvernightEnabled ? "text-emerald-100" : "text-slate-300"}`}>
                          {protectOvernightEnabled
                            ? `GOLD keeps the overnight H4/H1/M5 profile, blocks strong MA200 trends, skips high-impact NFP/CPI/FOMC windows, moves SL to entry at +$${Number(protectBreakEvenProfitUsd || 0).toFixed(2)}, closes at +$${Number(protectOvernightProfitUsd || 0).toFixed(2)} or -$${Number(protectOvernightLossUsd || 0).toFixed(2)}, then enforces the ${autoTradeDraft.cooldownMin}-minute cooldown. ETH stays on its separate M15 trend-pullback profile and does not use these overnight exits.`
                            : "Overnight mode is off."}
                        </p>
                      </div>

                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-xs font-semibold text-slate-200 mb-1">Hidden Defaults</p>
                        <p className="text-[11px] text-slate-400">
                          Strategy mode, trend-stack enforcement, re-entry tuning, and news blackout logic stay on the managed preset to keep this panel focused on risk and protection.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded border border-slate-700 bg-slate-900/40 p-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-xs font-semibold text-slate-200">Managed Defaults</p>
                        <p className="text-[11px] text-slate-400">Headless sync runs the managed GOLD M5 and ETHUSD M15 trend-pullback profiles. This panel controls shared risk, filter thresholds, and protection values.</p>
                      </div>
                      {protectStatusDisplay && <p className="text-[11px] text-slate-300">{protectStatusDisplay}</p>}
                    </div>
                    <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-2 text-[11px] mt-3">
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Signal Gate</p>
                        <p className="text-slate-100">Win rate &gt;= {autoTradeDraft.minWinRate}%</p>
                        <p className="text-slate-300">{autoTradeDraft.requireStrong ? "STRONG only" : "Any signal strength"}</p>
                        <p className="text-slate-300">Trade side {autoTradeDraft.sideFilter === "BOTH" ? "Both" : autoTradeDraft.sideFilter === "BUY_ONLY" ? "Buy only" : "Sell only"}</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Risk Mode</p>
                        <p className="text-slate-100">{autoTradeDraft.riskMode === "PCT" ? `${autoTradeDraft.riskPct}% balance risk` : `$${autoTradeDraft.riskUsd} fixed risk`}</p>
                        <p className="text-slate-300">Dynamic lot {autoTradeDraft.useDynamicLot ? "ON" : "OFF"}, cap {autoTradeDraft.botLots} lot</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Risk Guard</p>
                        <p className="text-slate-100">Multiplier x{autoTradeDraft.riskGuardMult}</p>
                        <p className="text-slate-300">Min SL {autoTradeDraft.minSlPoints} pts, ATR buffer {autoTradeDraft.atrBufferMult}</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Entry Model</p>
                        <p className="text-slate-100">Pending limits at support / resistance</p>
                        <p className="text-slate-300">No market fallback in the managed runtime</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Loss Guard</p>
                        <p className="text-slate-100">Daily loss {autoTradeDraft.enforceDailyLossLimit ? "ON" : "OFF"}</p>
                        <p className="text-slate-300">Hard risk block {autoTradeDraft.enforceHardRiskBlock ? "ON" : "OFF"}</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Cooldown Guard</p>
                        <p className="text-slate-100">Symbol cooldown {autoTradeDraft.enforceSymbolCooldown ? "ON" : "OFF"}</p>
                        <p className="text-slate-300">{autoTradeDraft.cooldownMin} minute wait per symbol</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Trend Filter</p>
                        <p className="text-slate-100">H4 direction gate ON</p>
                        <p className="text-slate-300">H4 bias, H1 setup, entry confirmation, and MA50/RSI/candle checks</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">News Guard</p>
                        <p className="text-slate-100">High-impact blackout ON</p>
                        <p className="text-slate-300">{HEADLESS_HIGH_IMPACT_NEWS_KEYWORDS.join(" / ")} within {HEADLESS_HIGH_IMPACT_NEWS_LOOKBACK_MIN} minutes</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">ATR Trail</p>
                        <p className="text-slate-100">{protectEnabled ? "Enabled" : "Disabled"}</p>
                        <p className="text-slate-300">{protectTimeframe} / ATR {protectAtrPeriod} x {protectAtrMult}</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Overnight Target</p>
                        <p className="text-slate-100">{protectOvernightEnabled ? "Enabled" : "Disabled"}</p>
                        <p className="text-slate-300">Close at +${Number(protectOvernightProfitUsd || 0).toFixed(2)} or -${Number(protectOvernightLossUsd || 0).toFixed(2)} floating PnL</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Overnight Safety</p>
                        <p className="text-slate-100">
                          {isHeadlessMode
                            ? `${headlessRuntimeStatus.overnightConsecutiveLosses}/${headlessRuntimeStatus.overnightMaxConsecutiveLosses} consecutive losses`
                            : `Stops after 3 consecutive losses`}
                        </p>
                        <p className="text-slate-300">
                          {isHeadlessMode && headlessRuntimeStatus.overnightLossStopActive
                            ? "Loss-stop active. Re-enable the preset to start a fresh overnight session."
                            : "A win resets the loss streak; 3 straight losses disable overnight mode."}
                        </p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                        <p className="text-slate-400">Break-even / Exit</p>
                        <p className="text-slate-100">Break-even {protectBreakEvenEnabled ? `ON at +$${Number(protectBreakEvenProfitUsd || 0).toFixed(2)}` : "OFF"}</p>
                        <p className="text-slate-300">Opposite-signal close {protectDegradeCloseEnabled ? `ON at ${protectDegradeMinConfidence}%` : "OFF"}</p>
                        <p className="text-slate-300">
                          Bias-flip lock {protectBiasFlipProfitLockEnabled ? `ON at ${Number(protectBiasFlipTpProgressPct || 0).toFixed(0)}% TP progress` : "OFF"}
                        </p>
                        <p className="text-slate-300">
                          Retrace lock {protectOvernightProfitRetraceLockEnabled ? `ON arm +$${Number(protectOvernightProfitRetraceArmUsd || 0).toFixed(2)} / close +$${Number(protectOvernightProfitRetraceCloseUsd || 0).toFixed(2)}` : "OFF"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="card border border-cyan-400/30 bg-cyan-400/5">
              <p className="text-sm font-semibold text-cyan-200 mb-2">Risk Calc Module</p>
              {showRiskCalcModule && (
                <>
                  <div className="grid md:grid-cols-4 gap-2 mb-2">
                    <label className="text-xs" title="Select which chart panel to use for risk preview calculations.">
                      <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Sample Panel</span>
                      <select
                        value={String(riskPreviewPanelIndex)}
                        onChange={(e) => setRiskPreviewPanelIndex(Number(e.target.value))}
                        className="w-full px-2 py-1.5 rounded bg-slate-800 border border-slate-600 text-white"
                      >
                        {panelSymbols.map((sym, i) => (
                          <option key={`risk-preview-panel-${i}`} value={i}>
                            Panel {i + 1}: {formatPairLabel(sym)} {panelTimeframes[i] || "D1"}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {riskSettingsPreview ? (
                    <div className="grid md:grid-cols-5 gap-2 text-[11px]">
                      <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                        <p className="text-slate-400">Setup</p>
                        <p className="text-slate-100 font-semibold">
                          {riskSettingsPreview.side} {riskSettingsPreview.symbol} {riskSettingsPreview.timeframe}
                        </p>
                        <p className="text-slate-400 mt-1">Lots</p>
                        <p className="text-slate-100 font-semibold">{riskSettingsPreview.lots.toFixed(2)}</p>
                        <p className="text-slate-400 mt-1">Target Risk</p>
                        <p className="text-slate-100 font-semibold">${riskSettingsPreview.targetRisk.toFixed(4)}</p>
                        <p className="text-slate-400 mt-1">Raw Lot (calc)</p>
                        <p className="text-slate-100 font-semibold">{riskSettingsPreview.rawLots.toFixed(4)}</p>
                        {riskSettingsPreview.lotStatus !== "OK" && (
                          <p className="text-amber-300 mt-1">
                            {riskSettingsPreview.lotStatus === "BELOW_MIN"
                              ? "Below min lot: risk target cannot be matched"
                              : "Lot capped by Default Bot Lots"}
                          </p>
                        )}
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                        <p className="text-slate-400">Entry / SL / TP</p>
                        <p className="text-slate-100">E {riskSettingsPreview.entry.toFixed(5)}</p>
                        <p className="text-rose-300">SL {riskSettingsPreview.sl.toFixed(5)}</p>
                        <p className="text-emerald-300">TP {riskSettingsPreview.tp.toFixed(5)}</p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                        <p className="text-slate-400">Distance</p>
                        <p className="text-slate-100">SL {riskSettingsPreview.slPoints.toFixed(1)} points</p>
                        <p className="text-slate-100">TP {riskSettingsPreview.tpPoints.toFixed(1)} points</p>
                        <p className="text-slate-300">
                          SL {riskSettingsPreview.slPips.toFixed(1)} {riskSettingsPreview.pipLabel}
                        </p>
                        <p className="text-slate-300">
                          TP {riskSettingsPreview.tpPips.toFixed(1)} {riskSettingsPreview.pipLabel}
                        </p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                        <p className="text-slate-400">Cost / Loss</p>
                        <p className="text-amber-300">Spread ${riskSettingsPreview.spreadCost.toFixed(4)}</p>
                        <p className="text-rose-300">SL -${riskSettingsPreview.riskAtSL.toFixed(4)}</p>
                        <p className="text-slate-300">
                          Net at SL -${(riskSettingsPreview.riskAtSL + riskSettingsPreview.spreadCost).toFixed(4)}
                        </p>
                      </div>
                      <div className="rounded border border-slate-700 bg-slate-900/50 p-2">
                        <p className="text-slate-400">Reward</p>
                        <p className="text-emerald-300">TP +${riskSettingsPreview.rewardAtTP.toFixed(4)}</p>
                        <p className="text-slate-300">
                          Net at TP +${Math.max(0, riskSettingsPreview.rewardAtTP - riskSettingsPreview.spreadCost).toFixed(4)}
                        </p>
                        <p className="text-slate-100 font-semibold">R:R {riskSettingsPreview.rr.toFixed(2)}</p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-slate-400">
                      Waiting for actionable signal/spec to build preview.
                    </p>
                  )}
                  <div className="mt-2 text-[11px] text-slate-400">
                    Risk Mode selects how dynamic lot is computed. USD mode uses fixed dollar risk per trade.
                    Default Bot Lots is always the base lot; with dynamic lot enabled it acts as the max lot cap.
                  </div>
                </>
              )}
            </div>

            {showManualOrderSection && (
              <>
                {symbolSpec && (
                  <div className="mb-4 p-3 rounded border border-slate-600 bg-slate-800/40">
                    <p className="text-xs text-slate-300">
                      MT5 Contract: <span className="text-slate-100">{symbolSpec.symbol}</span> |
                      {" "}1 lot = <span className="text-slate-100">{Number(symbolSpec.lotSize || 0).toLocaleString()}</span> units |
                      {" "}Digits {symbolSpec.digits} | Point {symbolSpec.point}
                    </p>
                  </div>
                )}

                <div className="grid md:grid-cols-3 gap-3 mb-3">
                  <label className="text-sm">
                    <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Action</span>
                    <select
                      value={orderAction}
                      onChange={(e) => {
                        if (pendingOrder) {
                          clearRegisteredOrder(pendingOrder);
                        }
                        setOrderAction(e.target.value as OrderAction);
                        setPendingOrder(null);
                        setTradeBridgeMessage("");
                      }}
                      className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                    >
                      <option value="PLACE">PLACE</option>
                      <option value="CLOSE">CLOSE</option>
                      <option value="MODIFY">MODIFY</option>
                    </select>
                  </label>

              {orderAction === "PLACE" && (
                <label className="text-sm">
                  <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Side</span>
                  <select
                    value={orderSide}
                    onChange={(e) => setOrderSide(e.target.value as "BUY" | "SELL")}
                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </label>
              )}

              {orderAction === "PLACE" && (
                <label className="text-sm">
                  <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Lots</span>
                  <input
                    value={orderLots}
                    onChange={(e) => setOrderLots(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                    placeholder="0.01"
                  />
                </label>
              )}

              {(orderAction === "CLOSE" || orderAction === "MODIFY") && (
                <label className="text-sm">
                  <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Ticket</span>
                  <input
                    value={orderTicket}
                    onChange={(e) => setOrderTicket(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                    placeholder="12345678"
                  />
                </label>
              )}

              {orderAction === "CLOSE" && (
                <label className="text-sm">
                  <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Close Lots (optional)</span>
                  <input
                    value={orderCloseLots}
                    onChange={(e) => setOrderCloseLots(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                    placeholder="leave blank = full close"
                  />
                </label>
              )}

              {(orderAction === "PLACE" || orderAction === "MODIFY") && (
                <label className="text-sm">
                  <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Stop Loss</span>
                  <input
                    value={orderSL}
                    onChange={(e) => setOrderSL(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                    placeholder={tradeSignal ? tradeSignal.stopLoss.toString() : ""}
                  />
                </label>
              )}

              {(orderAction === "PLACE" || orderAction === "MODIFY") && (
                <label className="text-sm">
                  <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Take Profit</span>
                  <input
                    value={orderTP}
                    onChange={(e) => setOrderTP(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                    placeholder={tradeSignal ? tradeSignal.takeProfit.toString() : ""}
                  />
                </label>
              )}

              {orderAction === "PLACE" && (
                <div className="text-sm flex items-end">
                  <button
                    onClick={handleUseCurrentSignalStops}
                    disabled={!tradeSignal}
                    type="button"
                    className="w-full px-3 py-2 rounded border border-emerald-400/60 bg-emerald-400/10 text-emerald-300 font-semibold hover:bg-emerald-400/20 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Use current signal SL/TP
                  </button>
                </div>
              )}

              {orderAction === "PLACE" && (
                <label className="text-sm md:col-span-3">
                  <span className={`block mb-1 ${THEME.TEXT_SECONDARY}`}>Comment</span>
                  <input
                    value={orderComment}
                    onChange={(e) => setOrderComment(e.target.value)}
                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                    placeholder="web-bridge"
                  />
                </label>
              )}
                </div>

                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <button
                    onClick={handlePrepareOrder}
                    disabled={tradeBridgeBusy}
                    className="px-4 py-2 rounded bg-blue-500/20 border border-blue-400 text-blue-300 font-semibold hover:bg-blue-500/30 disabled:opacity-60"
                  >
                    Prepare Order
                  </button>
                  {pendingOrder && (
                    <>
                      <input
                        value={confirmTokenInput}
                        onChange={(e) => setConfirmTokenInput(e.target.value)}
                        className="px-3 py-2 rounded bg-slate-800 border border-slate-600 text-white"
                        placeholder="Enter confirm token"
                      />
                      <button
                        onClick={handleConfirmOrder}
                        disabled={tradeBridgeBusy}
                        className="px-4 py-2 rounded bg-emerald-500/20 border border-emerald-400 text-emerald-300 font-semibold hover:bg-emerald-500/30 disabled:opacity-60"
                      >
                        Confirm & Execute
                      </button>
                    </>
                  )}
                </div>

                {pendingOrder && (
                  <div className="mb-3 p-3 rounded border border-amber-400/40 bg-amber-400/10 text-sm text-amber-200">
                    <p className="font-semibold mb-1">Pending Confirmation</p>
                    <p>Summary: {pendingOrder.summary}</p>
                    <p>Token: {pendingOrder.confirmToken}</p>
                    <p>Expires in: {Math.floor(pendingOrder.expiresInMs / 1000)}s</p>
                  </div>
                )}

                {tradeBridgeMessage && (
                  <div className="mb-3 p-3 rounded border border-slate-600 bg-slate-800/70 text-sm text-slate-200">
                    {tradeBridgeMessage}
                  </div>
                )}
              </>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className={`text-sm font-semibold ${THEME.TEXT_SECONDARY}`}>Open Positions</p>
                {(protectEnabled || protectOvernightEnabled) && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-full border border-emerald-400/50 bg-emerald-400/10 text-emerald-200">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    {protectEnabled && protectOvernightEnabled
                      ? "Protect + Overnight Active"
                      : protectEnabled
                        ? "Auto Protect Active"
                        : "Overnight Active"}
                  </span>
                )}
              </div>
              {openPositions.length === 0 ? (
                <p className="text-sm text-slate-400">No open positions loaded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-slate-400">
                      <tr className="border-b border-slate-700">
                        <th className="text-left py-2 pr-3">Ticket</th>
                        <th className="text-left py-2 pr-3">Symbol</th>
                        <th className="text-left py-2 pr-3">Type</th>
                        <th className="text-left py-2 pr-3">Lots</th>
                        <th className="text-left py-2 pr-3">Open</th>
                        <th className="text-left py-2 pr-3">SL</th>
                        <th className="text-left py-2 pr-3">TP</th>
                        <th className="text-left py-2 pr-3">Proj @SL</th>
                        <th className="text-left py-2">Proj @TP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openPositions.map((position) => (
                        <tr key={position.ticket} className="border-b border-slate-800">
                          <td className="py-2 pr-3 text-white">{position.ticket}</td>
                          <td className="py-2 pr-3 text-white">{position.symbol}</td>
                          <td className="py-2 pr-3 text-white">{position.type}</td>
                          <td className="py-2 pr-3 text-white">{position.lots}</td>
                          <td className="py-2 pr-3 text-white">{position.openPrice}</td>
                          <td className="py-2 pr-3 text-white">{position.sl}</td>
                          <td className="py-2 pr-3 text-white">{position.tp}</td>
                          <td className="py-2 pr-3 text-rose-300">
                            {openPositionProjections[position.ticket]
                              ? `$${openPositionProjections[position.ticket].atSl.toFixed(2)}`
                              : "-"}
                          </td>
                          <td className="py-2 text-emerald-300">
                            {openPositionProjections[position.ticket]
                              ? `$${openPositionProjections[position.ticket].atTp.toFixed(2)}`
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* AI Open Positions Review */}
          <div className="card border border-cyan-400/30">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
              <h4 className={`font-bold ${THEME.TEXT_PRIMARY}`}>AI Review: Open Positions</h4>
              <button
                onClick={handleAnalyzeOpenPositions}
                disabled={aiPositionsLoading}
                className="px-3 py-1.5 rounded-md border border-cyan-400/60 bg-cyan-400/10 text-cyan-300 text-xs font-semibold hover:bg-cyan-400/20 disabled:opacity-60"
              >
                {aiPositionsLoading ? "Analyzing..." : "Analyze Open Positions"}
              </button>
            </div>
            {aiPositionsError && (
              <p className="text-sm text-rose-400 mb-2">{aiPositionsError}</p>
            )}
            {aiPositionsProvider && (
              <p className="text-xs text-slate-400 mb-2">Provider: {aiPositionsProvider}</p>
            )}
            {aiPositionsResponse ? (
              <pre className="whitespace-pre-wrap text-sm text-slate-200 bg-slate-900/70 border border-slate-700 rounded p-3">
                {aiPositionsResponse}
              </pre>
            ) : (
              <p className="text-sm text-slate-400">
                Generate AI analysis for all open MT5 positions.
              </p>
            )}
          </div>

          <div className="card border border-slate-600 bg-slate-800/40">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-slate-100">Trend Pullback Diagnostics</p>
                <p className="text-[10px] text-slate-400">
                  Applied max open trades: {effectiveMaxOpenTrades} | Workflow: {AUTO_BIAS_TIMEFRAME} bias {"->"} {AUTO_SETUP_TIMEFRAME} setup {"->"} {autoEntryTimeframe} confirmation {"->"} {autoEntryMode === "LIMIT_SR" ? "BUY_LIMIT / SELL_LIMIT" : "MARKET"}
                </p>
              </div>
              <button
                onClick={runPolicyDiagnostics}
                disabled={policyBusy}
                className="px-2 py-1 text-xs rounded border border-slate-600 bg-slate-700/50 text-slate-200 hover:border-slate-500 disabled:opacity-60"
              >
                {policyBusy ? "Checking..." : "Recheck"}
              </button>
            </div>
            <div className="mb-3 rounded-xl border border-amber-300/20 bg-[linear-gradient(135deg,rgba(120,53,15,0.14),rgba(15,23,42,0.86),rgba(30,41,59,0.72))] p-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-200/90">Current Trading Lens</p>
                  <p className="text-sm font-semibold text-slate-100 mt-1">
                    Trade only at structure, not in the middle of the move.
                  </p>
                  <p className="text-[11px] text-slate-300 mt-1">
                    GOLD and ETH now present the UI as trend-following pullback setups with pending limit execution near support or resistance.
                  </p>
                </div>
                <span className="inline-flex items-center rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-100">
                  {autoEntryMode === "LIMIT_SR" ? "Structure Limits Active" : "Market Trigger Active"}
                </span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-4">
                <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">1. Bias</p>
                  <p className="mt-1 text-xs font-semibold text-slate-100">Read {AUTO_BIAS_TIMEFRAME} first</p>
                  <p className="text-[10px] text-slate-400">If {AUTO_BIAS_TIMEFRAME} is BUY, only buy pullbacks. If SELL, only sell pullbacks.</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">2. Zone</p>
                  <p className="mt-1 text-xs font-semibold text-slate-100">Wait for structure</p>
                  <p className="text-[10px] text-slate-400">Buy near support. Sell near resistance. Treat levels as zones, not exact lines.</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">3. Confirmation</p>
                  <p className="mt-1 text-xs font-semibold text-slate-100">{AUTO_SETUP_TIMEFRAME} + {autoEntryTimeframe}</p>
                  <p className="text-[10px] text-slate-400">Use signal alignment, confidence, RSI, and noise filters before placing anything.</p>
                </div>
                <div className="rounded-lg border border-white/10 bg-slate-950/35 p-2">
                  <p className="text-[10px] uppercase tracking-[0.16em] text-slate-400">4. Trigger</p>
                  <p className="mt-1 text-xs font-semibold text-slate-100">
                    {autoEntryMode === "LIMIT_SR" ? "BUY_LIMIT / SELL_LIMIT" : "Market execution"}
                  </p>
                  <p className="text-[10px] text-slate-400">The executor waits for a better pullback price instead of chasing the move.</p>
                </div>
              </div>
            </div>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-2">
              {panelSymbols.map((symbol, i) => {
                const timeframe = panelTimeframes[i] || "D1";
                const panelKey = `${symbol}|${timeframe}`;
                const panelEntryMode = resolvePanelEntryMode(symbol, timeframe);
                const diag = policyByPanel[panelKey];
                const eligibility = autoEligibilityByPanel[panelKey];
                const panelStrategy = panelStrategyIndicators[panelKey];
                const panelData = panelAnalysis[panelKey];
                const biasSignal = panelStrategy?.trendBias || null;
                const setupSignal = panelStrategy?.setupSignal?.signal || "HOLD";
                const entrySignal = panelStrategy?.entrySignal?.signal || "HOLD";
                const structureData = panelStrategy?.entryData || panelData?.priceData || panelStrategy?.trendData || null;
                const supportLabel = structureData ? formatSetupPrice(symbol, structureData.supportLevel) : "--";
                const resistanceLabel = structureData ? formatSetupPrice(symbol, structureData.resistanceLevel) : "--";
                const structureLabel =
                  biasSignal === "BUY"
                    ? "Buy support"
                    : biasSignal === "SELL"
                    ? "Sell resistance"
                    : "Wait for bias";
                const pendingOrderLabel =
                  panelEntryMode === "LIMIT_SR"
                    ? biasSignal === "BUY"
                      ? "BUY_LIMIT"
                      : biasSignal === "SELL"
                      ? "SELL_LIMIT"
                      : "PENDING"
                    : biasSignal === "BUY"
                    ? "BUY MARKET"
                    : biasSignal === "SELL"
                    ? "SELL MARKET"
                    : "WAIT";
                const setupNarrative =
                  biasSignal === "BUY"
                    ? `Follow ${AUTO_BIAS_TIMEFRAME} BUY bias, look for pullback into support, confirm on ${AUTO_SETUP_TIMEFRAME}/${autoEntryTimeframe}, then place ${pendingOrderLabel}.`
                    : biasSignal === "SELL"
                    ? `Follow ${AUTO_BIAS_TIMEFRAME} SELL bias, wait near resistance, confirm on ${AUTO_SETUP_TIMEFRAME}/${autoEntryTimeframe}, then place ${pendingOrderLabel}.`
                    : `No clear ${AUTO_BIAS_TIMEFRAME} edge yet. The panel stays defensive until direction and setup agree.`;
                const headlessAdvisory =
                  isHeadlessMode &&
                  !HEADLESS_MANAGED_PRESET.some(
                    (item) => normalizeSymbol(symbol) === normalizeSymbol(item.symbol) && timeframe === item.timeframe
                  );
                const panelBlocked = eligibility !== undefined ? !eligibility.eligible : diag?.pass === false;
                const panelPass = eligibility !== undefined ? eligibility.eligible : diag?.pass === true;
                const failedCheck = diag?.checks?.find((check) => !check.ok);
                return (
                  <div key={`policy-${panelKey}-${i}`} className={`rounded-xl border p-2 shadow-[0_10px_30px_rgba(2,6,23,0.24)] ${headlessAdvisory ? "border-amber-400/30 bg-[linear-gradient(135deg,rgba(120,53,15,0.12),rgba(15,23,42,0.92))]" : getSetupCardClass(biasSignal)}`}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-slate-100">
                        {formatPairLabel(symbol)} {timeframe}
                      </p>
                      <span
                        className={`text-[10px] ${
                          panelBlocked
                            ? "text-rose-300"
                            : panelPass
                            ? "text-emerald-300"
                            : "text-slate-400"
                        }`}
                      >
                        {panelBlocked ? "BLOCKED" : panelPass ? "PASS" : "N/A"}
                      </span>
                    </div>
                    <p className="text-[11px] mb-1">
                      <span className="text-slate-400">Auto: </span>
                      <span
                        className={
                          headlessAdvisory
                            ? "text-amber-300"
                            : eligibility === undefined
                            ? "text-slate-400"
                            : eligibility.eligible
                            ? "text-emerald-300"
                            : "text-rose-300"
                        }
                      >
                        {headlessAdvisory ? "ADVISORY" : eligibility === undefined ? "N/A" : eligibility.eligible ? "ELIGIBLE" : "BLOCKED"}
                      </span>
                    </p>
                    {headlessAdvisory ? (
                      <p className="text-[11px] mb-1 text-amber-300">
                        Headless runtime executes {HEADLESS_MANAGED_PRESET.map((item) => `${item.symbol} ${item.timeframe}`).join(" + ")}. This panel is diagnostics only.
                      </p>
                    ) : null}
                    <div className="mb-2 rounded-lg border border-white/10 bg-slate-950/35 p-2">
                      <div className="flex flex-wrap gap-1.5">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getSetupBadgeClass(biasSignal)}`}>
                          {AUTO_BIAS_TIMEFRAME} {biasSignal || "WAIT"}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getSetupBadgeClass(setupSignal)}`}>
                          {AUTO_SETUP_TIMEFRAME} {setupSignal}
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getSetupBadgeClass(entrySignal)}`}>
                          {autoEntryTimeframe} {entrySignal}
                        </span>
                        <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                          {pendingOrderLabel}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                        <div className="rounded-md border border-white/10 bg-slate-900/55 p-2">
                          <p className="uppercase tracking-[0.14em] text-slate-500">Zone</p>
                          <p className={`mt-1 text-xs font-semibold ${getSetupBiasTone(biasSignal)}`}>{structureLabel}</p>
                        </div>
                        <div className="rounded-md border border-white/10 bg-slate-900/55 p-2">
                          <p className="uppercase tracking-[0.14em] text-slate-500">Levels</p>
                          <p className="mt-1 text-xs text-slate-200">S {supportLabel}</p>
                          <p className="text-xs text-slate-200">R {resistanceLabel}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-300">{setupNarrative}</p>
                    </div>
                    {eligibility?.scalpBias && autoStrategyMode === "SCALP_M15" && (
                      <p className="text-[11px] mb-1">
                        <span className="text-slate-400">M15 Bias: </span>
                        <span className={eligibility.scalpBias === "BUY" ? "text-emerald-300" : "text-rose-300"}>
                          {eligibility.scalpBias}
                        </span>
                      </p>
                    )}
                    {diag?.orderPlan ? (
                      <p className="text-[11px] mb-1">
                        <span className="text-slate-400">Order Plan: </span>
                        <span className="text-slate-200">{diag.orderPlan}</span>
                      </p>
                    ) : null}
                    <p className="text-[10px] mb-1 text-slate-500">
                      Checked: {getCheckedAgoLabel(diag?.checkedAtMs)}
                    </p>
                    <p className="text-[10px] mb-1 text-slate-400">
                      Cooldown:{" "}
                      <span className={autoEnforceSymbolCooldown ? "text-emerald-300" : "text-amber-300"}>
                        {autoEnforceSymbolCooldown ? "ON" : "OFF"}
                      </span>
                      {autoEnforceSymbolCooldown ? <span className="text-slate-500"> ({effectiveCooldownMin}m)</span> : null}
                      {" | "}Daily Loss:{" "}
                      <span className={autoEnforceDailyLossLimit ? "text-emerald-300" : "text-amber-300"}>
                        {autoEnforceDailyLossLimit ? "ON" : "OFF"}
                      </span>
                    </p>
                    {diag?.maxOpenTradesApplied !== undefined && (
                      <p className="text-[10px] mb-1 text-slate-400">
                        Slots:{" "}
                        <span className="text-slate-200">
                          {diag.actualOpenCount ?? 0} actual + {diag.reservedOpenCount ?? 0} reserved / {diag.maxOpenTradesApplied} limit
                        </span>
                      </p>
                    )}
                    {eligibility?.reason && eligibility.reason !== diag?.message && (
                      <p
                        className={`text-[11px] mb-1 ${
                          eligibility.reason.toLowerCase().includes("risk lot")
                            ? "text-amber-300"
                            : eligibility.reason.toLowerCase().includes("eligible now")
                            ? "text-emerald-300"
                            : "text-rose-300"
                        }`}
                      >
                        {eligibility.reason}
                      </p>
                    )}
                    {eligibility?.note && (
                      <p className="text-[11px] mb-1 text-amber-300">{eligibility.note}</p>
                    )}
                    {failedCheck ? (
                      <p className="text-[11px] mb-1 text-rose-300">Blocked by: {failedCheck.rule}</p>
                    ) : diag?.message ? (
                      <p className="text-[11px] mb-1 text-emerald-300">{diag.message}</p>
                    ) : (
                      <p className="text-[11px] mb-1 text-slate-400">No diagnostics yet.</p>
                    )}
                    <div className="grid gap-0.5 mt-1 min-h-[116px]">
                      {diag?.checks?.length ? (
                        diag.checks.map((check) => (
                          <div key={`${panelKey}-${check.rule}`} className="flex items-start justify-between text-[11px]">
                            {(() => {
                              const detail = String(check.detail || "").toLowerCase();
                              const inactive = detail.includes("inactive") || detail.includes("disabled");
                              const statusLabel = inactive ? "INACTIVE" : check.ok ? "PASS" : "BLOCK";
                              const statusClass = inactive
                                ? "text-amber-300"
                                : check.ok
                                ? "text-emerald-300"
                                : "text-rose-300";
                              return (
                                <span className={statusClass}>
                                  {statusLabel} {check.rule}
                                </span>
                              );
                            })()}
                            <span className="text-slate-400 text-right ml-2">{getPolicyCheckDetail(diag, check)}</span>
                          </div>
                        ))
                      ) : diag ? (
                        <p className="text-[11px] text-slate-500">No detailed policy check items were produced for this state.</p>
                      ) : (
                        <p className="text-[11px] text-slate-500">{policyBusy ? "Policy details loading..." : "No diagnostics yet."}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Disclaimer */}
          <div className="card bg-amber-400/5 border border-amber-400/30">
            <p className="text-sm text-amber-400">
              Warning: This is an AI-generated analysis for educational purposes only. Cryptocurrency and Forex markets are highly volatile. 
              Always conduct your own research and implement strict risk management. Past performance does not guarantee future results.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default TradingAssistant;






