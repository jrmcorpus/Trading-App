import { CRYPTO_ASSETS } from "./constants";

export const formatPairLabel = (symbol: string): string => {
  const special: Record<string, string> = {
    Gold: "GOLD",
    GOLD: "GOLD",
    XAUUSD: "GOLD",
    SILVER: "SILVER",
    XAGUSD: "SILVER",
    "Crude Oil": "WTI/USD",
  };

  if (special[symbol]) return special[symbol];
  const normalized = symbol.replace(/[^A-Z0-9]/g, "");
  if (special[normalized]) return special[normalized];
  if (normalized.endsWith("USDT")) return `${normalized.replace("USDT", "")}/USDT`;
  if (normalized.endsWith("USD") && normalized.length >= 6) {
    return `${normalized.slice(0, normalized.length - 3)}/USD`;
  }
  if (CRYPTO_ASSETS.includes(symbol) || CRYPTO_ASSETS.includes(normalized)) {
    return `${normalized.replace("USD", "")}/USD`;
  }
  if (/^[A-Z]{6}$/.test(normalized)) return `${normalized.slice(0, 3)}/${normalized.slice(3, 6)}`;
  return symbol;
};
