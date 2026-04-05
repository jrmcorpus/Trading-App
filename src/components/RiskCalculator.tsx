/**
 * RiskCalculator Component
 * Calculates recommended lot size based on:
 * - Account balance
 * - Stop loss in pips
 * - Risk percentage
 *
 * Formula: LotSize = (Balance * Risk%) / (SL_Pips * Pip_Value)
 */

import React, { useMemo, useState } from "react";
import { calculateMarginRequired, calculateRisk, formatCurrency, formatPips } from "../utils/calculations";
import { ACCOUNT_CONFIG, MICRO_LOT_CONFIG, THEME } from "../utils/constants";

interface RiskCalculatorProps {
  balance?: number;
  onLotSizeCalculated?: (lotSize: number) => void;
}

type SampleSymbol = {
  code: string;
  label: string;
  sampleEntry: number;
  pipStep: number;
  side: "Buy" | "Sell";
  note: string;
};

const SAMPLE_SYMBOLS: SampleSymbol[] = [
  {
    code: "EURUSD",
    label: "EURUSD",
    sampleEntry: 1.0852,
    pipStep: 0.0001,
    side: "Buy",
    note: "Best fit for the current calculator math because the pip-value model assumes a USD-quoted forex pair.",
  },
  {
    code: "GBPUSD",
    label: "GBPUSD",
    sampleEntry: 1.2748,
    pipStep: 0.0001,
    side: "Buy",
    note: "Good for a major-pair sample where the current micro-lot pip formula is usually closest.",
  },
  {
    code: "USDJPY",
    label: "USDJPY",
    sampleEntry: 149.35,
    pipStep: 0.01,
    side: "Buy",
    note: "JPY pairs use a different pip step, so treat this as a planning estimate rather than an exact broker calculation.",
  },
  {
    code: "GOLD",
    label: "GOLD",
    sampleEntry: 3025.4,
    pipStep: 0.1,
    side: "Sell",
    note: "Gold is shown as a planning example only. Metals often use broker-specific point values, so confirm live risk in MT4.",
  },
];

const getPriceDecimals = (pipStep: number): number => {
  const decimals = String(pipStep).split(".")[1];
  return decimals ? decimals.length : 0;
};

const RiskCalculator: React.FC<RiskCalculatorProps> = ({
  balance = ACCOUNT_CONFIG.INIT_BALANCE,
  onLotSizeCalculated,
}) => {
  const [stopLossPips, setStopLossPips] = useState<number>(50);
  const [riskPercent, setRiskPercent] = useState<number>(ACCOUNT_CONFIG.DEFAULT_RISK_PERCENT);
  const [selectedSymbol, setSelectedSymbol] = useState<string>(SAMPLE_SYMBOLS[0].code);

  const riskCalculation = useMemo(() => calculateRisk(balance, stopLossPips, riskPercent), [balance, stopLossPips, riskPercent]);

  const sampleSymbol = useMemo(
    () => SAMPLE_SYMBOLS.find((item) => item.code === selectedSymbol) ?? SAMPLE_SYMBOLS[0],
    [selectedSymbol]
  );

  const sampleTrade = useMemo(() => {
    const directionMultiplier = sampleSymbol.side === "Buy" ? 1 : -1;
    const stopDistance = stopLossPips * sampleSymbol.pipStep;
    const entryPrice = sampleSymbol.sampleEntry;
    const stopPrice = entryPrice - directionMultiplier * stopDistance;
    const targetPrice = entryPrice + directionMultiplier * stopDistance * 2;
    const decimals = getPriceDecimals(sampleSymbol.pipStep);

    return {
      entryPrice,
      stopPrice,
      targetPrice,
      decimals,
      pipValueAtRecommendedLot: riskCalculation.recommendedLotSize * riskCalculation.pipValue,
      estimatedMargin: calculateMarginRequired(riskCalculation.recommendedLotSize, entryPrice),
    };
  }, [riskCalculation.pipValue, riskCalculation.recommendedLotSize, sampleSymbol, stopLossPips]);

  React.useEffect(() => {
    onLotSizeCalculated?.(riskCalculation.recommendedLotSize);
  }, [riskCalculation.recommendedLotSize, onLotSizeCalculated]);

  return (
    <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
      <h2 className={`text-xl font-bold ${THEME.TEXT_PRIMARY} mb-6`}>
        Smart Lot Size Calculator
      </h2>

      <div className="grid grid-cols-2 gap-4 mb-6 pb-6 border-b border-slate-600">
        <div>
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Current Balance</p>
          <p className={`text-2xl font-bold ${THEME.PROFIT_COLOR}`}>{formatCurrency(balance)}</p>
        </div>
        <div>
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Risk per Trade</p>
          <p className="text-2xl font-bold text-blue-400">{riskPercent}%</p>
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

      <div className="mb-6 pb-6 border-b border-slate-600">
        <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-2`}>
          Sample Symbol
        </label>
        <select
          value={selectedSymbol}
          onChange={(e) => setSelectedSymbol(e.target.value)}
          className={`${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} w-full px-3 py-3 rounded border border-slate-600`}
        >
          {SAMPLE_SYMBOLS.map((symbol) => (
            <option key={symbol.code} value={symbol.code}>
              {symbol.label}
            </option>
          ))}
        </select>
        <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>{sampleSymbol.note}</p>
      </div>

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
        <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>Adjust your stop loss distance</p>
      </div>

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

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-emerald-400/30`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Recommended Lot Size</p>
          <p className={`text-2xl font-bold ${THEME.PROFIT_COLOR}`}>
            {riskCalculation.recommendedLotSize.toFixed(2)} u
          </p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>
            {MICRO_LOT_CONFIG.LOT_LABEL} ({MICRO_LOT_CONFIG.MICRO_LOT_UNITS.toLocaleString()} units)
          </p>
        </div>

        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-blue-400/30`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Risk Amount</p>
          <p className="text-2xl font-bold text-blue-400">{formatCurrency(riskCalculation.riskAmount)}</p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>Max loss per trade</p>
        </div>

        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Pip Value</p>
          <p className={`text-2xl font-bold ${THEME.TEXT_PRIMARY}`}>
            {formatCurrency(riskCalculation.pipValue)}/pip
          </p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>Per pip gain/loss for 1.0 lot</p>
        </div>

        <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-rose-500/30`}>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Max Loss</p>
          <p className={`text-2xl font-bold ${THEME.LOSS_COLOR}`}>
            -{formatCurrency(riskCalculation.actualRiskAmount)}
          </p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-2`}>At {formatPips(stopLossPips)}</p>
        </div>
      </div>

      <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
        <p className={`${THEME.TEXT_SECONDARY} text-sm leading-relaxed`}>
          <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>Trading Plan:</span> Open a{" "}
          <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{sampleSymbol.label}</span>{" "}
          <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{sampleSymbol.side}</span> with{" "}
          <span className="font-bold text-emerald-400">{riskCalculation.recommendedLotSize.toFixed(2)} u</span>. Use{" "}
          <span className="font-bold">{formatPips(stopLossPips)}</span> as the stop distance. Estimated max loss is{" "}
          <span className={`font-bold ${THEME.LOSS_COLOR}`}>{formatCurrency(riskCalculation.actualRiskAmount)}</span>.
        </p>
      </div>

      <div className={`${THEME.BG_PRIMARY} mt-4 p-4 rounded-lg border border-slate-600`}>
        <p className={`text-sm font-semibold ${THEME.TEXT_PRIMARY} mb-3`}>
          Worked Example: {sampleSymbol.label} {sampleSymbol.side}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className={`${THEME.BG_SECONDARY} rounded-lg p-3 border border-slate-700`}>
            <p className={`${THEME.TEXT_SECONDARY} mb-1`}>Sample Entry</p>
            <p className={`font-semibold ${THEME.TEXT_PRIMARY}`}>
              {sampleTrade.entryPrice.toFixed(sampleTrade.decimals)}
            </p>
          </div>
          <div className={`${THEME.BG_SECONDARY} rounded-lg p-3 border border-slate-700`}>
            <p className={`${THEME.TEXT_SECONDARY} mb-1`}>Sample Stop Loss</p>
            <p className={`font-semibold ${THEME.LOSS_COLOR}`}>
              {sampleTrade.stopPrice.toFixed(sampleTrade.decimals)}
            </p>
          </div>
          <div className={`${THEME.BG_SECONDARY} rounded-lg p-3 border border-slate-700`}>
            <p className={`${THEME.TEXT_SECONDARY} mb-1`}>Sample Take Profit</p>
            <p className={`font-semibold ${THEME.PROFIT_COLOR}`}>
              {sampleTrade.targetPrice.toFixed(sampleTrade.decimals)}
            </p>
          </div>
          <div className={`${THEME.BG_SECONDARY} rounded-lg p-3 border border-slate-700`}>
            <p className={`${THEME.TEXT_SECONDARY} mb-1`}>Pip Value At Your Lot</p>
            <p className={`font-semibold ${THEME.TEXT_PRIMARY}`}>
              {formatCurrency(sampleTrade.pipValueAtRecommendedLot)}/pip
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`${THEME.BG_SECONDARY} rounded-lg p-4 border border-slate-700`}>
            <p className={`text-sm font-semibold ${THEME.TEXT_PRIMARY} mb-2`}>Formula Breakdown</p>
            <div className={`space-y-2 text-sm ${THEME.TEXT_SECONDARY}`}>
              <p>
                Risk amount = {formatCurrency(balance)} x {riskPercent}% ={" "}
                <span className="font-semibold text-blue-400">{formatCurrency(riskCalculation.riskAmount)}</span>
              </p>
              <p>
                Pip value per 1.0 lot ={" "}
                <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{formatCurrency(riskCalculation.pipValue)}</span>
              </p>
              <p>Raw lot = risk amount / (stop loss x pip value)</p>
              <p>
                Raw lot = {formatCurrency(riskCalculation.riskAmount)} / ({stopLossPips} x {formatCurrency(riskCalculation.pipValue)}) ={" "}
                <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{riskCalculation.rawLotSize.toFixed(4)}</span>
              </p>
              <p>
                Rounded lot ={" "}
                <span className="font-semibold text-emerald-400">{riskCalculation.recommendedLotSize.toFixed(2)} u</span>
              </p>
            </div>
          </div>

          <div className={`${THEME.BG_SECONDARY} rounded-lg p-4 border border-slate-700`}>
            <p className={`text-sm font-semibold ${THEME.TEXT_PRIMARY} mb-2`}>Trade Snapshot</p>
            <div className={`space-y-2 text-sm ${THEME.TEXT_SECONDARY}`}>
              <p>
                Symbol = <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{sampleSymbol.label}</span>
              </p>
              <p>
                Direction = <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{sampleSymbol.side}</span>
              </p>
              <p>
                Stop distance = <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{formatPips(stopLossPips)}</span>
              </p>
              <p>
                Estimated max loss = <span className={`font-semibold ${THEME.LOSS_COLOR}`}>-{formatCurrency(riskCalculation.actualRiskAmount)}</span>
              </p>
              <p>
                Estimated margin at 1:{ACCOUNT_CONFIG.LEVERAGE} ={" "}
                <span className={`font-semibold ${THEME.TEXT_PRIMARY}`}>{formatCurrency(sampleTrade.estimatedMargin)}</span>
              </p>
              <p>
                Example 2R target ={" "}
                <span className={`font-semibold ${THEME.PROFIT_COLOR}`}>{formatCurrency(riskCalculation.actualRiskAmount * 2)}</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {riskPercent > 2 && (
        <div className="mt-4 p-3 bg-rose-500/20 border border-rose-500 rounded-lg">
          <p className="text-rose-400 text-sm">
            <span className="font-semibold">High Risk:</span> You are risking more than 2% per trade. Consider reducing it to preserve capital.
          </p>
        </div>
      )}

      {riskCalculation.recommendedLotSize < ACCOUNT_CONFIG.INIT_BALANCE * 0.01 && (
        <div className="mt-4 p-3 bg-blue-500/20 border border-blue-500 rounded-lg">
          <p className="text-blue-400 text-sm">
            <span className="font-semibold">Small Lot:</span> Your lot size is very small. Ensure your broker supports this size.
          </p>
        </div>
      )}

      {riskCalculation.minLotApplied && (
        <div className="mt-4 p-3 bg-amber-500/20 border border-amber-500 rounded-lg">
          <p className="text-amber-300 text-sm">
            <span className="font-semibold">Min Lot Applied:</span> Raw lot {riskCalculation.rawLotSize.toFixed(4)} is below broker minimum{" "}
            {MICRO_LOT_CONFIG.MIN_LOT_SIZE}. Actual risk is{" "}
            <span className="font-semibold">{formatCurrency(riskCalculation.actualRiskAmount)}</span>, not{" "}
            {formatCurrency(riskCalculation.riskAmount)}.
          </p>
        </div>
      )}
    </div>
  );
};

export default RiskCalculator;
