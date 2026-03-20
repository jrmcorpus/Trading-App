/**
 * Trading Calculation Utilities
 * Contract-size aware calculations
 */

import { ACCOUNT_CONFIG, MICRO_LOT_CONFIG } from "./constants";
import { RiskCalculation } from "../types";

/**
 * Calculate pip value based on lot size
 * Assumes USD-quoted pairs (e.g., EURUSD). For other quotes, this is an approximation.
 */
export const calculatePipValue = (lotSize: number): number => {
  return lotSize * MICRO_LOT_CONFIG.PIP_VALUE_FULL_MICRO;
};

/**
 * Calculate recommended lot size based on risk management
 * Formula: LotSize = (Balance * Risk%) / (SL_Pips * Pip_Value)
 * Simplified: LotSize = (Balance * Risk%) / (SL_Pips * pipValuePerLot)
 */
export const calculateLotSize = (
  balance: number,
  riskPercent: number,
  slPips: number
): number => {
  if (slPips <= 0) return 0;

  const riskAmount = (balance * riskPercent) / 100;
  const rawLot = riskAmount / (slPips * MICRO_LOT_CONFIG.PIP_VALUE_FULL_MICRO);
  const step = MICRO_LOT_CONFIG.LOT_STEP || 0.01;
  const steppedLot = Math.floor(rawLot / step) * step;

  // Clamp to min/max lot size
  return Math.max(
    MICRO_LOT_CONFIG.MIN_LOT_SIZE,
    Math.min(MICRO_LOT_CONFIG.MAX_LOT_SIZE, Number(steppedLot.toFixed(4)))
  );
};

/**
 * Calculate PnL in USD
 */
export const calculatePnL = (
  lotSize: number,
  entryPrice: number,
  exitPrice: number,
  tradeType: "Buy" | "Sell"
): number => {
  const pips = tradeType === "Buy" 
    ? (exitPrice - entryPrice) * 10000 
    : (entryPrice - exitPrice) * 10000;
  
  const pipValue = calculatePipValue(lotSize);
  return pips * pipValue;
};

/**
 * Calculate pips gained
 */
export const calculatePips = (
  entryPrice: number,
  exitPrice: number,
  tradeType: "Buy" | "Sell"
): number => {
  return tradeType === "Buy"
    ? (exitPrice - entryPrice) * 10000
    : (entryPrice - exitPrice) * 10000;
};

/**
 * Calculate margin required
 * Margin = (Lot Size * contract units) * Entry Price / Leverage
 */
export const calculateMarginRequired = (
  lotSize: number,
  price: number,
  leverage: number = ACCOUNT_CONFIG.LEVERAGE
): number => {
  const units = lotSize * MICRO_LOT_CONFIG.MICRO_LOT_UNITS;
  return (units * price) / leverage;
};

/**
 * Comprehensive risk calculation
 */
export const calculateRisk = (
  balance: number,
  stopLossPips: number,
  riskPercent: number = ACCOUNT_CONFIG.DEFAULT_RISK_PERCENT
): RiskCalculation => {
  const riskAmount = (balance * riskPercent) / 100;
  const pipValue = MICRO_LOT_CONFIG.PIP_VALUE_FULL_MICRO;
  const rawLotSize =
    stopLossPips > 0 ? riskAmount / (stopLossPips * MICRO_LOT_CONFIG.PIP_VALUE_FULL_MICRO) : 0;
  const recommendedLotSize = calculateLotSize(balance, riskPercent, stopLossPips);
  const potentialPnL = stopLossPips * calculatePipValue(recommendedLotSize);
  const actualRiskAmount = Math.abs(potentialPnL);
  const minLotApplied = rawLotSize > 0 && rawLotSize < MICRO_LOT_CONFIG.MIN_LOT_SIZE;

  return {
    recommendedLotSize,
    riskAmount,
    pipValue,
    potentialPnL,
    rawLotSize,
    actualRiskAmount,
    minLotApplied,
  };
};

/**
 * Calculate win rate percentage
 */
export const calculateWinRate = (wins: number, total: number): number => {
  return total === 0 ? 0 : (wins / total) * 100;
};

/**
 * Calculate profit factor (total wins / total losses)
 */
export const calculateProfitFactor = (
  totalPnL: number,
  totalLosses: number
): number => {
  if (totalLosses === 0) return 0;
  return Math.abs(totalPnL) / Math.abs(totalLosses);
};

/**
 * Format currency
 */
export const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
};

/**
 * Format percentage
 */
export const formatPercent = (value: number, decimals: number = 2): string => {
  return `${(value).toFixed(decimals)}%`;
};

/**
 * Format pips
 */
export const formatPips = (value: number): string => {
  return `${value.toFixed(1)} pips`;
};
