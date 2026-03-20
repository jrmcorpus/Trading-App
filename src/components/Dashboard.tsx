/**
 * Trading Report Dashboard
 * Displays key metrics: Total PnL, Win Rate %, Profit Factor, Account Growth
 */

import React, { useMemo } from "react";
import { Trade, DashboardMetrics } from "../types";
import {
  calculateWinRate,
  formatCurrency,
  formatPercent,
} from "../utils/calculations";
import { ACCOUNT_CONFIG, MICRO_LOT_CONFIG, THEME, RISK_RULES } from "../utils/constants";

interface DashboardProps {
  trades: Trade[];
  currentBalance: number;
  initialBalance: number;
}

const Dashboard: React.FC<DashboardProps> = ({
  trades,
  currentBalance,
  initialBalance,
}) => {
  const metrics = useMemo<DashboardMetrics>(() => {
    const closedTrades = trades.filter((t) => t.is_closed);
    const totalPnL = closedTrades.reduce((sum, t) => sum + (t.pnl_usd || 0), 0);
    const wins = closedTrades.filter((t) => (t.pnl_usd || 0) > 0);
    const losses = closedTrades.filter((t) => (t.pnl_usd || 0) < 0);

    const totalWins = wins.length;
    const totalLosses = losses.length;
    const totalTrades = closedTrades.length;

    const winRate = calculateWinRate(totalWins, totalTrades);
    const totalLossesAmount = losses.reduce(
      (sum, t) => sum + Math.abs(t.pnl_usd || 0),
      0
    );
    const profitFactor =
      totalLossesAmount > 0
        ? Math.abs(totalPnL) / totalLossesAmount
        : totalPnL > 0
          ? 999
          : 0;

    const openTrades = trades.filter((t) => !t.is_closed);
    const marginUsed = openTrades.reduce((sum, t) => {
      const units = t.lot_size * MICRO_LOT_CONFIG.MICRO_LOT_UNITS;
      return sum + (units * t.entry_price) / ACCOUNT_CONFIG.LEVERAGE;
    }, 0);

    const marginAvailable = currentBalance - marginUsed;

    return {
      totalPnL,
      winRate,
      profitFactor,
      totalTrades,
      totalWins,
      totalLosses,
      currentBalance,
      marginUsed,
      marginAvailable,
    };
  }, [trades, currentBalance]);

  const accountGrowthPercent = useMemo(() => {
    return ((currentBalance - initialBalance) / initialBalance) * 100;
  }, [currentBalance, initialBalance]);

  const isProfitable = accountGrowthPercent >= 0;

  return (
    <div className="space-y-6">
      {/* Main Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total PnL */}
        <div
          className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}
        >
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-2`}>Total PnL</p>
          <p
            className={`text-3xl font-bold ${
              metrics.totalPnL >= 0 ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR
            }`}
          >
            {formatCurrency(metrics.totalPnL)}
          </p>
          <div className="mt-3 pt-3 border-t border-slate-600">
            <p className={`text-xs ${THEME.TEXT_SECONDARY}`}>
              {metrics.totalTrades} closed trades
            </p>
          </div>
        </div>

        {/* Win Rate */}
        <div
          className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}
        >
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-2`}>Win Rate</p>
          <p className={`text-3xl font-bold text-blue-400`}>
            {formatPercent(metrics.winRate)}
          </p>
          <div className="mt-3 pt-3 border-t border-slate-600">
            <p className={`text-xs ${THEME.TEXT_SECONDARY}`}>
              {metrics.totalWins}W / {metrics.totalLosses}L
            </p>
          </div>
          {metrics.winRate < RISK_RULES.RECOMMENDED_WIN_RATE * 100 &&
            metrics.totalTrades > 5 && (
              <p className="text-xs text-rose-400 mt-2">
                ⚠️ Below 50% target
              </p>
            )}
        </div>

        {/* Profit Factor */}
        <div
          className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}
        >
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-2`}>Profit Factor</p>
          <p
            className={`text-3xl font-bold ${
              metrics.profitFactor >= RISK_RULES.MINIMUM_PROFIT_FACTOR
                ? THEME.PROFIT_COLOR
                : THEME.LOSS_COLOR
            }`}
          >
            {metrics.profitFactor.toFixed(2)}x
          </p>
          <div className="mt-3 pt-3 border-t border-slate-600">
            <p className={`text-xs ${THEME.TEXT_SECONDARY}`}>
              Revenue / Loss Ratio
            </p>
          </div>
          {metrics.profitFactor < RISK_RULES.MINIMUM_PROFIT_FACTOR &&
            metrics.totalTrades > 5 && (
              <p className="text-xs text-rose-400 mt-2">
                ⚠️ Below 1.5x target
              </p>
            )}
        </div>

        {/* Account Growth */}
        <div
          className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}
        >
          <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-2`}>Account Growth</p>
          <p
            className={`text-3xl font-bold ${
              isProfitable ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR
            }`}
          >
            {formatPercent(accountGrowthPercent)}
          </p>
          <div className="mt-3 pt-3 border-t border-slate-600">
            <p className={`text-xs ${THEME.TEXT_SECONDARY}`}>
              {formatCurrency(initialBalance)} → {formatCurrency(currentBalance)}
            </p>
          </div>
        </div>
      </div>

      {/* Margin Information */}
      <div
        className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}
      >
        <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
          💼 Margin Status (1:1000 Leverage)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Margin Used */}
          <div>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-2`}>Margin Used</p>
            <p className={`text-2xl font-bold text-blue-400`}>
              {formatCurrency(metrics.marginUsed)}
            </p>
          </div>

          {/* Margin Available */}
          <div>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-2`}>
              Margin Available
            </p>
            <p className={`text-2xl font-bold ${THEME.PROFIT_COLOR}`}>
              {formatCurrency(metrics.marginAvailable)}
            </p>
          </div>

          {/* Margin Percentage */}
          <div>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-2`}>Usage %</p>
            <p
              className={`text-2xl font-bold ${
                (metrics.marginUsed / metrics.currentBalance) * 100 > 80
                  ? THEME.LOSS_COLOR
                  : THEME.PROFIT_COLOR
              }`}
            >
              {(
                (metrics.marginUsed / metrics.currentBalance) * 100
              ).toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Margin Warning */}
        {(metrics.marginUsed / metrics.currentBalance) * 100 > 80 && (
          <div className="mt-4 p-3 bg-rose-500/20 border border-rose-500 rounded-lg">
            <p className="text-rose-400 text-sm font-semibold">
              ⚠️ High Margin Usage: Consider closing some positions to reduce risk
            </p>
          </div>
        )}

        {metrics.marginAvailable <= 0 && (
          <div className="mt-4 p-3 bg-rose-600/30 border border-rose-600 rounded-lg">
            <p className="text-rose-300 text-sm font-semibold">
              🚨 Insufficient Margin: Close positions immediately
            </p>
          </div>
        )}
      </div>

      {/* Performance Analysis */}
      {metrics.totalTrades > 0 && (
        <div
          className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}
        >
          <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
            📈 Performance Analysis
          </h3>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <span className={THEME.TEXT_SECONDARY}>Average Win</span>
              <span className={`font-semibold ${THEME.PROFIT_COLOR}`}>
                {metrics.totalWins > 0
                  ? formatCurrency(
                      metrics.totalPnL / metrics.totalWins
                    )
                  : "$0.00"}
              </span>
            </div>

            <div className="flex justify-between items-center">
              <span className={THEME.TEXT_SECONDARY}>Average Loss</span>
              <span className={`font-semibold ${THEME.LOSS_COLOR}`}>
                {metrics.totalLosses > 0
                  ? formatCurrency(
                      -Math.abs(metrics.totalPnL) / metrics.totalLosses
                    )
                  : "$0.00"}
              </span>
            </div>

            <div className="border-t border-slate-600 pt-3 mt-3 flex justify-between items-center">
              <span className={THEME.TEXT_SECONDARY}>Risk/Reward Ratio</span>
              <span className={`font-semibold text-blue-400`}>
                {metrics.totalWins > 0 && metrics.totalLosses > 0
                  ? (
                      Math.abs(metrics.totalPnL / metrics.totalWins) /
                      (Math.abs(metrics.totalPnL / metrics.totalLosses))
                    ).toFixed(2) + ":1"
                  : "N/A"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {metrics.totalTrades === 0 && (
        <div
          className={`${THEME.BG_SECONDARY} rounded-lg p-12 border border-slate-700 text-center`}
        >
          <p className={`${THEME.TEXT_SECONDARY} mb-2`}>No closed trades yet</p>
          <p className={`${THEME.TEXT_SECONDARY} text-sm`}>
            Start logging your trades to see performance metrics
          </p>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
