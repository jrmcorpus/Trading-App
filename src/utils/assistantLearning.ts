import { Trade } from "../types";

export type AdaptiveSessionKey = "ASIA" | "LONDON" | "OVERLAP" | "NEW_YORK" | "QUIET";

export interface AdaptiveMetricSummary {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number | null;
  slRate: number;
}

export interface AdaptiveBucketSummary extends AdaptiveMetricSummary {
  key: string;
}

export interface AdaptiveRecommendationField {
  current: number;
  suggested: number;
  changed: boolean;
  reason: string;
}

export interface AdaptiveLearningReport {
  sampleSize: number;
  metrics: AdaptiveMetricSummary & {
    recentWinRate: number;
    recentExpectancy: number;
    maxLossStreak: number;
    currentLossStreak: number;
    quickLossReentries: number;
  };
  weakSymbols: AdaptiveBucketSummary[];
  weakSessions: Array<AdaptiveBucketSummary & { session: AdaptiveSessionKey }>;
  recommendations: {
    minConfidence: AdaptiveRecommendationField;
    minRR: AdaptiveRecommendationField;
    cooldownMin: AdaptiveRecommendationField;
    blockSymbols: string[];
    blockSessions: AdaptiveSessionKey[];
  };
  notes: string[];
}

interface ClosedTradeSnapshot {
  symbol: string;
  closedAtMs: number;
  pnl: number;
  closeSource: Trade["close_source"] | null;
}

interface CurrentAutoSettings {
  minConfidence: number;
  minRR: number;
  cooldownMin: number;
}

const MIN_SAMPLE_FOR_RECOMMENDATIONS = 8;
const MIN_SAMPLE_PER_BUCKET = 3;

export const normalizeAdaptiveSymbol = (value: string): string =>
  String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export const classifyAdaptiveSession = (timeMs: number): AdaptiveSessionKey => {
  const hour = new Date(timeMs).getUTCHours();
  if (hour < 8) return "ASIA";
  if (hour < 13) return "LONDON";
  if (hour < 17) return "OVERLAP";
  if (hour < 22) return "NEW_YORK";
  return "QUIET";
};

export const formatAdaptiveSessionLabel = (value: AdaptiveSessionKey): string => {
  switch (value) {
    case "ASIA":
      return "Asia";
    case "LONDON":
      return "London";
    case "OVERLAP":
      return "London/NY Overlap";
    case "NEW_YORK":
      return "New York";
    case "QUIET":
      return "Quiet Hours";
    default:
      return value;
  }
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const toClosedTradeSnapshots = (trades: Trade[]): ClosedTradeSnapshot[] =>
  trades
    .filter((trade) => trade.is_closed && trade.closed_at && Number.isFinite(Number(trade.pnl_usd)))
    .map((trade) => ({
      symbol: normalizeAdaptiveSymbol(trade.asset),
      closedAtMs: Date.parse(String(trade.closed_at)),
      pnl: Number(trade.pnl_usd || 0),
      closeSource: trade.close_source || null,
    }))
    .filter((trade) => Number.isFinite(trade.closedAtMs))
    .sort((a, b) => a.closedAtMs - b.closedAtMs);

const summarizeTrades = (items: ClosedTradeSnapshot[]): AdaptiveMetricSummary => {
  const wins = items.filter((trade) => trade.pnl > 0);
  const losses = items.filter((trade) => trade.pnl < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = losses.reduce((sum, trade) => sum + trade.pnl, 0);
  const slHits = items.filter((trade) => trade.closeSource === "SL_TRIGGER").length;

  return {
    count: items.length,
    wins: wins.length,
    losses: losses.length,
    winRate: items.length ? (wins.length / items.length) * 100 : 0,
    totalPnl: round(items.reduce((sum, trade) => sum + trade.pnl, 0), 2),
    expectancy: items.length ? round(items.reduce((sum, trade) => sum + trade.pnl, 0) / items.length, 2) : 0,
    avgWin: wins.length ? round(grossWins / wins.length, 2) : 0,
    avgLoss: losses.length ? round(Math.abs(grossLoss) / losses.length, 2) : 0,
    profitFactor: losses.length ? round(grossWins / Math.abs(grossLoss || 1), 2) : wins.length ? 99 : null,
    slRate: items.length ? (slHits / items.length) * 100 : 0,
  };
};

const buildBucketSummary = (entries: Map<string, ClosedTradeSnapshot[]>): AdaptiveBucketSummary[] =>
  Array.from(entries.entries())
    .map(([key, items]) => ({
      key,
      ...summarizeTrades(items),
    }))
    .sort((a, b) => {
      if (a.totalPnl !== b.totalPnl) return a.totalPnl - b.totalPnl;
      if (a.expectancy !== b.expectancy) return a.expectancy - b.expectancy;
      return a.winRate - b.winRate;
    });

export const analyzeAdaptiveLearning = (
  trades: Trade[],
  current: CurrentAutoSettings
): AdaptiveLearningReport => {
  const closedTrades = toClosedTradeSnapshots(trades);
  const metrics = summarizeTrades(closedTrades);
  const recentTrades = closedTrades.slice(-10);
  const recentMetrics = summarizeTrades(recentTrades);

  let maxLossStreak = 0;
  let currentLossStreak = 0;
  let quickLossReentries = 0;
  const lastLossBySymbol = new Map<string, number>();
  const reentryWindowMs = Math.max(30, current.cooldownMin) * 60 * 1000;

  for (const trade of closedTrades) {
    if (trade.pnl < 0) {
      currentLossStreak += 1;
      maxLossStreak = Math.max(maxLossStreak, currentLossStreak);
      const prevLossTime = lastLossBySymbol.get(trade.symbol);
      if (prevLossTime && trade.closedAtMs - prevLossTime <= reentryWindowMs) {
        quickLossReentries += 1;
      }
      lastLossBySymbol.set(trade.symbol, trade.closedAtMs);
    } else {
      currentLossStreak = 0;
    }
  }

  const symbolBuckets = new Map<string, ClosedTradeSnapshot[]>();
  const sessionBuckets = new Map<AdaptiveSessionKey, ClosedTradeSnapshot[]>();

  for (const trade of closedTrades) {
    if (!symbolBuckets.has(trade.symbol)) symbolBuckets.set(trade.symbol, []);
    symbolBuckets.get(trade.symbol)!.push(trade);

    const session = classifyAdaptiveSession(trade.closedAtMs);
    if (!sessionBuckets.has(session)) sessionBuckets.set(session, []);
    sessionBuckets.get(session)!.push(trade);
  }

  const weakSymbols = buildBucketSummary(symbolBuckets).filter(
    (bucket) =>
      bucket.count >= MIN_SAMPLE_PER_BUCKET &&
      bucket.totalPnl < 0 &&
      (bucket.winRate < 45 || bucket.expectancy < 0 || bucket.slRate >= 50)
  );
  const weakSessions = buildBucketSummary(sessionBuckets as Map<string, ClosedTradeSnapshot[]>)
    .map((bucket) => ({
      ...bucket,
      session: bucket.key as AdaptiveSessionKey,
    }))
    .filter(
      (bucket) =>
        bucket.count >= MIN_SAMPLE_PER_BUCKET &&
        bucket.totalPnl < 0 &&
        (bucket.winRate < 45 || bucket.expectancy < 0 || bucket.slRate >= 50)
    );

  const notes: string[] = [];

  let confidenceBump = 0;
  if (closedTrades.length < MIN_SAMPLE_FOR_RECOMMENDATIONS) {
    notes.push(`Need at least ${MIN_SAMPLE_FOR_RECOMMENDATIONS} closed trades before changing thresholds aggressively.`);
  } else {
    if (recentMetrics.winRate < 45) confidenceBump += 5;
    if (metrics.slRate >= 50) confidenceBump += 3;
    if (maxLossStreak >= 3) confidenceBump += 2;
  }
  const suggestedMinConfidence = clamp(Math.round(current.minConfidence + Math.min(confidenceBump, 10)), 55, 90);
  const confidenceReasons: string[] = [];
  if (recentMetrics.winRate < 45) confidenceReasons.push(`recent win rate ${recentMetrics.winRate.toFixed(0)}% is weak`);
  if (metrics.slRate >= 50) confidenceReasons.push(`SL exits are ${metrics.slRate.toFixed(0)}% of closed trades`);
  if (maxLossStreak >= 3) confidenceReasons.push(`max loss streak reached ${maxLossStreak}`);
  if (!confidenceReasons.length) confidenceReasons.push("current threshold is acceptable for the observed sample");
  notes.push("Confidence recommendation is heuristic because closed trades do not yet store signal-confidence-at-entry.");

  let rrBump = 0;
  if (closedTrades.length >= MIN_SAMPLE_FOR_RECOMMENDATIONS) {
    if ((metrics.profitFactor ?? 0) < 1.1) rrBump += 0.2;
    if (metrics.avgLoss > 0 && metrics.avgWin < metrics.avgLoss * 1.25) rrBump += 0.1;
    if (metrics.slRate >= 55) rrBump += 0.1;
  }
  const suggestedMinRR = round(clamp(current.minRR + Math.min(rrBump, 0.4), 1.2, 3.2), 2);
  const rrReasons: string[] = [];
  if ((metrics.profitFactor ?? 0) < 1.1 && closedTrades.length >= MIN_SAMPLE_FOR_RECOMMENDATIONS) {
    rrReasons.push(`profit factor ${metrics.profitFactor?.toFixed(2) ?? "0.00"} is weak`);
  }
  if (metrics.avgLoss > 0 && metrics.avgWin < metrics.avgLoss * 1.25 && closedTrades.length >= MIN_SAMPLE_FOR_RECOMMENDATIONS) {
    rrReasons.push(`average win $${metrics.avgWin.toFixed(2)} is too close to average loss $${metrics.avgLoss.toFixed(2)}`);
  }
  if (metrics.slRate >= 55 && closedTrades.length >= MIN_SAMPLE_FOR_RECOMMENDATIONS) {
    rrReasons.push(`SL hit rate is high at ${metrics.slRate.toFixed(0)}%`);
  }
  if (!rrReasons.length) rrReasons.push("reward-to-risk is not the main weakness in the current sample");

  let cooldownBump = 0;
  if (closedTrades.length >= MIN_SAMPLE_FOR_RECOMMENDATIONS) {
    if (quickLossReentries >= 2) cooldownBump += 10;
    if (currentLossStreak >= 2) cooldownBump += 5;
    if (weakSymbols.some((bucket) => bucket.count >= 4 && bucket.slRate >= 60)) cooldownBump += 5;
  }
  const suggestedCooldownMin = clamp(current.cooldownMin + cooldownBump, 5, 240);
  const cooldownReasons: string[] = [];
  if (quickLossReentries >= 2) cooldownReasons.push(`${quickLossReentries} same-symbol loss re-entries landed inside the cooldown window`);
  if (currentLossStreak >= 2) cooldownReasons.push(`current loss streak is ${currentLossStreak}`);
  if (weakSymbols.some((bucket) => bucket.count >= 4 && bucket.slRate >= 60)) {
    cooldownReasons.push("several symbols are repeatedly stopping out");
  }
  if (!cooldownReasons.length) cooldownReasons.push("recent trade spacing does not suggest overtrading");

  const blockSymbols =
    closedTrades.length >= MIN_SAMPLE_FOR_RECOMMENDATIONS
      ? weakSymbols.slice(0, 3).map((bucket) => bucket.key)
      : [];
  const blockSessions =
    closedTrades.length >= MIN_SAMPLE_FOR_RECOMMENDATIONS
      ? weakSessions.slice(0, 2).map((bucket) => bucket.session)
      : [];

  return {
    sampleSize: closedTrades.length,
    metrics: {
      ...metrics,
      recentWinRate: recentMetrics.winRate,
      recentExpectancy: recentMetrics.expectancy,
      maxLossStreak,
      currentLossStreak,
      quickLossReentries,
    },
    weakSymbols,
    weakSessions,
    recommendations: {
      minConfidence: {
        current: current.minConfidence,
        suggested: suggestedMinConfidence,
        changed: suggestedMinConfidence !== current.minConfidence,
        reason: confidenceReasons.join("; "),
      },
      minRR: {
        current: current.minRR,
        suggested: suggestedMinRR,
        changed: suggestedMinRR !== current.minRR,
        reason: rrReasons.join("; "),
      },
      cooldownMin: {
        current: current.cooldownMin,
        suggested: suggestedCooldownMin,
        changed: suggestedCooldownMin !== current.cooldownMin,
        reason: cooldownReasons.join("; "),
      },
      blockSymbols,
      blockSessions,
    },
    notes,
  };
};
