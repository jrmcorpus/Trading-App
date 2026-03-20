/**
 * RiskCalculator Component
 * Calculates recommended lot size based on:
 * - Account balance
 * - Stop loss in pips
 * - Risk percentage (default 1%)
 * 
 * Formula: LotSize = (Balance * Risk%) / (SL_Pips * Pip_Value)
 */

import React, { useState, useMemo } from "react";
import { calculateRisk, formatCurrency, formatPips } from "../utils/calculations";
import { ACCOUNT_CONFIG, MICRO_LOT_CONFIG, THEME } from "../utils/constants";

interface RiskCalculatorProps {
  balance?: number;
  onLotSizeCalculated?: (lotSize: number) => void;
}

const RiskCalculator: React.FC<RiskCalculatorProps> = ({
  balance = ACCOUNT_CONFIG.INIT_BALANCE,
  onLotSizeCalculated,
}) => {
  const [stopLossPips, setStopLossPips] = useState<number>(50);
  const [riskPercent, setRiskPercent] = useState<number>(
    ACCOUNT_CONFIG.DEFAULT_RISK_PERCENT
  );

  const riskCalculation = useMemo(() => {
    return calculateRisk(balance, stopLossPips, riskPercent);
  }, [balance, stopLossPips, riskPercent]);

  React.useEffect(() => {
    onLotSizeCalculated?.(riskCalculation.recommendedLotSize);
  }, [riskCalculation.recommendedLotSize, onLotSizeCalculated]);

  return (
    <div
      className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}
    >
      <h2 className={`text-xl font-bold ${THEME.TEXT_PRIMARY} mb-6`}>
        🎯 Smart Lot Size Calculator
      </h2>

      {/* Account Info */}
      <div className="grid grid-cols-2 gap-4 mb-6 pb-6 border-b border-slate-600">
        <div>
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Current Balance</p>
          <p className={`text-2xl font-bold ${THEME.PROFIT_COLOR}`}>
            {formatCurrency(balance)}
          </p>
        </div>
        <div>
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Risk per Trade</p>
          <p className={`text-2xl font-bold text-blue-400`}>{riskPercent}%</p>
        </div>
        <div>
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Contract Type</p>
          <p className={`text-lg font-bold ${THEME.TEXT_PRIMARY}`}>Ultra Low Micro</p>
        </div>
        <div>
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Broker Min / Step</p>
          <p className={`text-lg font-bold ${THEME.TEXT_PRIMARY}`}>
            {MICRO_LOT_CONFIG.MIN_LOT_SIZE} / {MICRO_LOT_CONFIG.LOT_STEP}
          </p>
        </div>
      </div>

      {/* Stop Loss Input */}
      <div className="mb-6">
        <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-2`}>
          Stop Loss (Pips)
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="10"
            max="500"
            step="5"
            value={stopLossPips}
            onChange={(e) => setStopLossPips(Number(e.target.value))}
            className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-emerald-400"
          />
          <input
            type="number"
            min="10"
            max="500"
            step="5"
            value={stopLossPips}
            onChange={(e) => setStopLossPips(Number(e.target.value))}
            className={`${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} w-20 px-3 py-2 rounded border border-slate-600 text-right`}
          />
        </div>
        <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>
          Adjust your stop loss distance
        </p>
      </div>

      {/* Risk Percentage Slider */}
      <div className="mb-6 pb-6 border-b border-slate-600">
        <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-2`}>
          Risk Per Trade (%)
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0.5"
            max="3"
            step="0.25"
            value={riskPercent}
            onChange={(e) => setRiskPercent(Number(e.target.value))}
            className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-400"
          />
          <input
            type="number"
            min="0.5"
            max="3"
            step="0.25"
            value={riskPercent}
            onChange={(e) => setRiskPercent(Number(e.target.value))}
            className={`${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} w-20 px-3 py-2 rounded border border-slate-600 text-right`}
          />
        </div>
        <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>
          Capital protection rule: Never risk more than 1-2% per trade
        </p>
      </div>

      {/* Calculation Results */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-emerald-400/30`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Recommended Lot Size</p>
          <p className={`text-2xl font-bold ${THEME.PROFIT_COLOR}`}>
            {riskCalculation.recommendedLotSize.toFixed(2)} μ
          </p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>
            {MICRO_LOT_CONFIG.LOT_LABEL} ({MICRO_LOT_CONFIG.MICRO_LOT_UNITS.toLocaleString()} units)
          </p>
        </div>

        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-blue-400/30`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Risk Amount</p>
          <p className={`text-2xl font-bold text-blue-400`}>
            {formatCurrency(riskCalculation.riskAmount)}
          </p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>
            Max loss per trade
          </p>
        </div>

        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Pip Value</p>
          <p className={`text-2xl font-bold ${THEME.TEXT_PRIMARY}`}>
            ${riskCalculation.pipValue.toFixed(4)}/pip
          </p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>
            Per pip gain/loss for 1.0 lot
          </p>
        </div>

        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-rose-500/30`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Max Loss</p>
          <p className={`text-2xl font-bold ${THEME.LOSS_COLOR}`}>
            -{formatCurrency(riskCalculation.actualRiskAmount)}
          </p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>
            At {formatPips(stopLossPips)}
          </p>
        </div>
      </div>

      {/* Summary Card */}
      <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
        <p className={`${THEME.TEXT_SECONDARY} text-sm leading-relaxed`}>
          📊 <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>Trading Plan:</span>{" "}
          Open a trade with <span className="font-bold text-emerald-400">
            {riskCalculation.recommendedLotSize.toFixed(2)} μ
          </span>{" "}
          position size. Set stop loss at{" "}
          <span className="font-bold">{stopLossPips} pips</span>. Maximum loss will be{" "}
          <span className={`font-bold ${THEME.LOSS_COLOR}`}>
            {formatCurrency(riskCalculation.actualRiskAmount)}
          </span>
          .
        </p>
      </div>

      {/* Risk Warning */}
      {riskPercent > 2 && (
        <div className="mt-4 p-3 bg-rose-500/20 border border-rose-500 rounded-lg">
          <p className="text-rose-400 text-sm">
            ⚠️ <span className="font-semibold">High Risk:</span> You're risking more than
            2% per trade. Consider reducing to preserve capital.
          </p>
        </div>
      )}

      {riskCalculation.recommendedLotSize < ACCOUNT_CONFIG.INIT_BALANCE * 0.01 && (
        <div className="mt-4 p-3 bg-blue-500/20 border border-blue-500 rounded-lg">
          <p className="text-blue-400 text-sm">
            💡 <span className="font-semibold">Small Lot:</span> Your lot size is very
            small. Ensure your broker supports this size.
          </p>
        </div>
      )}

      {riskCalculation.minLotApplied && (
        <div className="mt-4 p-3 bg-amber-500/20 border border-amber-500 rounded-lg">
          <p className="text-amber-300 text-sm">
            ⚠️ <span className="font-semibold">Min Lot Applied:</span> Raw lot {riskCalculation.rawLotSize.toFixed(4)}
            {" "}is below broker minimum {MICRO_LOT_CONFIG.MIN_LOT_SIZE}. Actual risk is{" "}
            <span className="font-semibold">{formatCurrency(riskCalculation.actualRiskAmount)}</span>, not{" "}
            {formatCurrency(riskCalculation.riskAmount)}.
          </p>
        </div>
      )}
    </div>
  );
};

export default RiskCalculator;
