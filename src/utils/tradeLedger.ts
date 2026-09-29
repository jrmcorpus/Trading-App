import { Trade } from "../types";

export const MANUAL_TRADES_STORAGE_KEY = "journal.manualTrades.v1";
export const MANUAL_TRADE_USER_ID = "manual_journal";

const INDEX_SYMBOL_PATTERN = /US30|NAS100|SPX500|GER40|DJI|USTEC/i;
const CRYPTO_SYMBOL_PATTERN = /(BTC|ETH|XRP|BNB|SOL|ADA|DOGE)/i;
const METAL_OIL_SYMBOL_PATTERN = /^(XAUUSD|XAGUSD|USOIL|WTIUSD|XTIUSD|GOLD|SILVER)$/i;

export const normalizeTradeSymbol = (raw: string): string => {
  const cleaned = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.includes("US30")) return "US30CASH";
  if (cleaned.startsWith("GOLD") || cleaned.startsWith("XAU")) return "GOLD";
  if (cleaned.startsWith("SILVER") || cleaned.startsWith("XAG")) return "SILVER";
  if (cleaned.startsWith("USOIL") || cleaned.startsWith("WTIUSD") || cleaned.startsWith("XTIUSD")) {
    return "USOIL";
  }
  if (cleaned.length >= 6 && /^[A-Z]{6}/.test(cleaned)) return cleaned.slice(0, 6);
  return cleaned || String(raw || "").toUpperCase();
};

export const estimateTradePips = (
  symbol: string,
  tradeType: "Buy" | "Sell" | "BUY" | "SELL",
  openPrice: number,
  closePrice: number
): number | null => {
  if (!Number.isFinite(openPrice) || !Number.isFinite(closePrice) || openPrice <= 0 || closePrice <= 0) {
    return null;
  }

  const normalized = normalizeTradeSymbol(symbol);
  const direction = tradeType === "BUY" || tradeType === "Buy" ? 1 : -1;
  const diff = (closePrice - openPrice) * direction;

  if (INDEX_SYMBOL_PATTERN.test(normalized)) return diff;
  if (CRYPTO_SYMBOL_PATTERN.test(normalized)) return diff * 100;
  if (/JPY$/.test(normalized)) return diff * 100;
  if (METAL_OIL_SYMBOL_PATTERN.test(normalized)) return diff * 100;
  return diff * 10000;
};

export const getTradePriceTolerance = (symbol: string): number => {
  const normalized = normalizeTradeSymbol(symbol);
  if (INDEX_SYMBOL_PATTERN.test(normalized)) return 8;
  if (CRYPTO_SYMBOL_PATTERN.test(normalized)) return 10;
  if (/(XAU|XAG|GOLD|SILVER)/i.test(normalized)) return 0.5;
  if (/JPY$/.test(normalized)) return 0.05;
  return 0.0005;
};

const getTradeLotTolerance = (lotSize: number): number => {
  const baseline = Math.max(0.0001, Math.abs(Number(lotSize) || 0) * 0.02);
  return Math.min(0.1, baseline);
};

const toTimestampMs = (value: string | null | undefined): number => {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
};

const sortValue = (trade: Trade): number => {
  const closedAtMs = toTimestampMs(trade.closed_at);
  if (closedAtMs > 0) return closedAtMs;
  const createdAtMs = toTimestampMs(trade.created_at);
  return createdAtMs > 0 ? createdAtMs : 0;
};

const isNumberClose = (left: number, right: number, tolerance: number): boolean => {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
};

const normalizeStoredTrade = (value: any): Trade | null => {
  if (!value || typeof value !== "object") return null;
  const asset = String(value.asset || "").trim();
  const tradeType = value.trade_type === "Sell" ? "Sell" : value.trade_type === "Buy" ? "Buy" : null;
  if (!asset || !tradeType) return null;

  return {
    id: String(value.id || ""),
    user_id: String(value.user_id || MANUAL_TRADE_USER_ID),
    asset,
    trade_type: tradeType,
    entry_price: Number(value.entry_price || 0),
    stop_loss: Number(value.stop_loss || 0),
    take_profit: Number(value.take_profit || 0),
    lot_size: Number(value.lot_size || 0),
    pnl_usd: value.pnl_usd === null || value.pnl_usd === undefined ? null : Number(value.pnl_usd),
    pips_gained: value.pips_gained === null || value.pips_gained === undefined ? null : Number(value.pips_gained),
    emotional_state: String(value.emotional_state || "Neutral"),
    reasoning: String(value.reasoning || ""),
    created_at:
      typeof value.created_at === "string" && value.created_at.trim()
        ? value.created_at
        : new Date().toISOString(),
    closed_at:
      typeof value.closed_at === "string" && value.closed_at.trim()
        ? value.closed_at
        : null,
    is_closed: Boolean(value.is_closed),
    close_price:
      value.close_price === null || value.close_price === undefined ? null : Number(value.close_price),
    close_reason:
      typeof value.close_reason === "string" && value.close_reason.trim()
        ? value.close_reason
        : null,
    close_source:
      value.close_source === "SL_TRIGGER" ||
      value.close_source === "TP_TRIGGER" ||
      value.close_source === "MANUAL_CLOSE" ||
      value.close_source === "BOT_CLOSE"
        ? value.close_source
        : null,
    mt4_ticket: Number.isFinite(Number(value.mt4_ticket)) ? Number(value.mt4_ticket) : null,
    mt4_comment:
      typeof value.mt4_comment === "string" && value.mt4_comment.trim()
        ? value.mt4_comment
        : null,
  };
};

export const parseStoredManualTrades = (raw: string | null): Trade[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortTradesNewestFirst(
      parsed
        .map((item) => normalizeStoredTrade(item))
        .filter((item): item is Trade => Boolean(item))
    );
  } catch {
    return [];
  }
};

export const sortTradesNewestFirst = (trades: Trade[]): Trade[] => {
  return [...trades].sort((left, right) => sortValue(right) - sortValue(left));
};

export const createManualTrade = (trade: Omit<Trade, "id" | "created_at">): Trade => {
  const manualId =
    typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `manual-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return {
    ...trade,
    id: manualId,
    user_id: MANUAL_TRADE_USER_ID,
    created_at: new Date().toISOString(),
  };
};

export const areTradesLikelySame = (manualTrade: Trade, importedTrade: Trade): boolean => {
  const manualTicket = Number(manualTrade.mt4_ticket || 0);
  const importedTicket = Number(importedTrade.mt4_ticket || 0);
  if (manualTicket > 0 && importedTicket > 0 && manualTicket === importedTicket) {
    return true;
  }

  if (!importedTrade.is_closed) return false;
  if (normalizeTradeSymbol(manualTrade.asset) !== normalizeTradeSymbol(importedTrade.asset)) return false;
  if (manualTrade.trade_type !== importedTrade.trade_type) return false;

  const priceTolerance = getTradePriceTolerance(importedTrade.asset);
  const lotTolerance = getTradeLotTolerance(Math.max(manualTrade.lot_size, importedTrade.lot_size));

  if (!isNumberClose(Number(manualTrade.entry_price), Number(importedTrade.entry_price), priceTolerance)) {
    return false;
  }
  if (!isNumberClose(Number(manualTrade.lot_size), Number(importedTrade.lot_size), lotTolerance)) {
    return false;
  }

  const manualClosePrice = Number(manualTrade.close_price);
  const importedClosePrice = Number(importedTrade.close_price);
  if (
    Number.isFinite(manualClosePrice) &&
    manualClosePrice > 0 &&
    Number.isFinite(importedClosePrice) &&
    importedClosePrice > 0 &&
    !isNumberClose(manualClosePrice, importedClosePrice, priceTolerance)
  ) {
    return false;
  }

  const manualClosedAtMs = toTimestampMs(manualTrade.closed_at);
  const importedClosedAtMs = toTimestampMs(importedTrade.closed_at);
  if (
    manualClosedAtMs > 0 &&
    importedClosedAtMs > 0 &&
    Math.abs(manualClosedAtMs - importedClosedAtMs) > 24 * 60 * 60 * 1000
  ) {
    return false;
  }

  const manualCreatedAtMs = toTimestampMs(manualTrade.created_at);
  const importedCreatedAtMs = toTimestampMs(importedTrade.created_at);
  if (
    manualCreatedAtMs > 0 &&
    importedCreatedAtMs > 0 &&
    Math.abs(manualCreatedAtMs - importedCreatedAtMs) > 48 * 60 * 60 * 1000
  ) {
    return false;
  }

  return true;
};

const mergeMatchedTrade = (manualTrade: Trade, importedTrade: Trade): Trade => {
  const manualReasoning = String(manualTrade.reasoning || "").trim();
  const importedReasoning = String(importedTrade.reasoning || "").trim();
  const mergedReasoning =
    manualReasoning && importedReasoning && !importedReasoning.includes(manualReasoning)
      ? `${manualReasoning} | ${importedReasoning}`
      : manualReasoning || importedReasoning;

  return {
    ...importedTrade,
    emotional_state:
      manualTrade.emotional_state && manualTrade.emotional_state !== "Imported"
        ? manualTrade.emotional_state
        : importedTrade.emotional_state,
    reasoning: mergedReasoning,
  };
};

export const reconcileTradeLedger = (manualTrades: Trade[], importedTrades: Trade[]): Trade[] => {
  const usedManualIds = new Set<string>();
  const mergedImported = importedTrades.map((importedTrade) => {
    const matchedManual = manualTrades.find(
      (manualTrade) => !usedManualIds.has(manualTrade.id) && areTradesLikelySame(manualTrade, importedTrade)
    );
    if (!matchedManual) return importedTrade;
    usedManualIds.add(matchedManual.id);
    return mergeMatchedTrade(matchedManual, importedTrade);
  });

  const unmatchedManualTrades = manualTrades.filter((trade) => !usedManualIds.has(trade.id));
  return sortTradesNewestFirst([...unmatchedManualTrades, ...mergedImported]);
};
