/**
 * Account/contract configuration
 * Defaults are for micro accounts unless overridden by env.
 */

// Account Settings
export const ACCOUNT_CONFIG = {
  LEVERAGE: 1000,
  INIT_BALANCE: 31.04, // Starting capital baseline (USD)
  MIN_BALANCE: 50.00,
  DEFAULT_RISK_PERCENT: 1.0, // 1% per trade
};

const rawContractUnits = Number(import.meta.env.VITE_MT4_CONTRACT_UNITS || 1000);
const contractUnits = Number.isFinite(rawContractUnits) && rawContractUnits > 0 ? rawContractUnits : 1000;
const pipValuePerFullLot = contractUnits * 0.0001; // Assumes USD quote (e.g., EURUSD)
const rawMinLot = Number(import.meta.env.VITE_MT4_MIN_LOT || 0.01);
const minLotSize = Number.isFinite(rawMinLot) && rawMinLot > 0 ? rawMinLot : 0.01;
const rawLotStep = Number(import.meta.env.VITE_MT4_LOT_STEP || minLotSize);
const lotStep = Number.isFinite(rawLotStep) && rawLotStep > 0 ? rawLotStep : minLotSize;

export const MICRO_LOT_CONFIG = {
  MICRO_LOT_UNITS: contractUnits,
  PIP_VALUE_FULL_MICRO: pipValuePerFullLot,
  MIN_LOT_SIZE: minLotSize,
  LOT_STEP: lotStep,
  MAX_LOT_SIZE: 100,
  LOT_LABEL:
    contractUnits >= 100000 ? "Standard Lot" : contractUnits <= 1000 ? "Micro Lot" : "Lot",
};

// Trading Session Times (GMT)
export const TRADING_SESSIONS = {
  ASIAN: { open: 22, close: 7 }, // 22:00 - 07:00 GMT
  EUROPEAN: { open: 7, close: 15 }, // 07:00 - 15:00 GMT
  AMERICAN: { open: 12, close: 20 }, // 12:00 - 20:00 GMT
};

// Technical Indicators
export const INDICATORS = {
  EMA_SHORT: 20,
  EMA_LONG: 50,
  RSI_PERIOD: 14,
  RSI_OVERBOUGHT: 70,
  RSI_OVERSOLD: 30,
};

// Emotional States
export const EMOTIONAL_STATES = [
  "Confident",
  "Anxious",
  "Neutral",
  "Greedy",
  "Fearful",
  "Focused",
];

// Color Theme
export const THEME = {
  BG_PRIMARY: "bg-slate-900",
  BG_SECONDARY: "bg-slate-800",
  BG_TERTIARY: "bg-slate-700",
  TEXT_PRIMARY: "text-white",
  TEXT_SECONDARY: "text-slate-300",
  PROFIT_COLOR: "text-emerald-400", // Profit
  LOSS_COLOR: "text-rose-500", // Loss
  ACCENT_COLOR: "#10b981", // Emerald
  WARNING_COLOR: "#f83e8f", // Rose
  INFO_COLOR: "#3b82f6", // Blue
};

// Common Assets
export const MAJOR_ASSETS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "NZDUSD",
  "USDCAD",
  "Gold",
  "Crude Oil",
];

// Crypto Assets
export const CRYPTO_ASSETS = [
  "BTCUSD",
  "ETHUSD",
  "XRPUSD",
  "LTCUSD",
  "BNBUSD",
  "ADAUSD",
  "DOGEUSD",
  "SOLUSD",
];

// All Trading Assets
export const ALL_TRADABLE_ASSETS = [...MAJOR_ASSETS, ...CRYPTO_ASSETS];

// Risk Management Rules
export const RISK_RULES = {
  MAX_DAILY_LOSS_PERCENT: 2.0, // Max 2% loss per day
  MAX_CONSECUTIVE_LOSSES: 3, // Pause after 3 consecutive losses
  RECOMMENDED_WIN_RATE: 0.50, // 50%+ for profitability
  MINIMUM_PROFIT_FACTOR: 1.5, // Revenue / Max Loss should be >= 1.5
};
