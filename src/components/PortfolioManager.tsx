/**
 * Portfolio Manager Component
 * Portfolio overview plus closed-trade analytics.
 */

import React, { useMemo } from "react";
import { Trade } from "../types";
import { formatCurrency } from "../utils/calculations";
import { MICRO_LOT_CONFIG, THEME, ACCOUNT_CONFIG } from "../utils/constants";

interface PortfolioManagerProps {
  trades: Trade[];
  currentBalance: number;
}

interface DailyTradeSummary {
  dayKey: string;
  label: string;
  pnl: number;
  grossProfit: number;
  grossLoss: number;
  trades: number;
  wins: number;
  losses: number;
}

const DAY_LABEL = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

const toDayKey = (value: string | null | undefined): string => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const toDayLabel = (dayKey: string): string => {
  const date = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(date.getTime()) ? dayKey : DAY_LABEL.format(date);
};

const buildDailySummaries = (closedTrades: Trade[]): DailyTradeSummary[] => {
  const bucket = new Map<string, DailyTradeSummary>();

  closedTrades.forEach((trade) => {
    const dayKey = toDayKey(trade.closed_at || trade.created_at);
    if (!dayKey) return;

    const pnl = Number(trade.pnl_usd || 0);
    const summary = bucket.get(dayKey) || {
      dayKey,
      label: toDayLabel(dayKey),
      pnl: 0,
      grossProfit: 0,
      grossLoss: 0,
      trades: 0,
      wins: 0,
      losses: 0,
    };

    summary.pnl += pnl;
    summary.trades += 1;
    if (pnl >= 0) {
      summary.grossProfit += pnl;
      summary.wins += 1;
    } else {
      summary.grossLoss += Math.abs(pnl);
      summary.losses += 1;
    }

    bucket.set(dayKey, summary);
  });

  return [...bucket.values()].sort((a, b) => a.dayKey.localeCompare(b.dayKey));
};

const BarChart: React.FC<{
  data: DailyTradeSummary[];
  valueKey: "pnl" | "grossProfit" | "grossLoss" | "trades";
  title: string;
  subtitle: string;
  mode?: "signedCurrency" | "currency" | "count";
}> = ({ data, valueKey, title, subtitle, mode = "currency" }) => {
  const maxAbs = useMemo(() => {
    const values = data.map((item) => Math.abs(Number(item[valueKey]) || 0));
    return Math.max(...values, 1);
  }, [data, valueKey]);

  const formatValue = (value: number) => {
    if (mode === "count") return `${value.toFixed(0)} trades`;
    return formatCurrency(value);
  };

  return (
    <div className={`${THEME.BG_PRIMARY} rounded-lg border border-slate-600 p-4`}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className={`text-sm font-semibold ${THEME.TEXT_PRIMARY}`}>{title}</p>
          <p className={`text-xs ${THEME.TEXT_SECONDARY}`}>{subtitle}</p>
        </div>
        <p className={`text-xs ${THEME.TEXT_SECONDARY}`}>Last {data.length} days</p>
      </div>

      {data.length === 0 ? (
        <div className="h-44 rounded border border-dashed border-slate-700 flex items-center justify-center">
          <p className={`text-sm ${THEME.TEXT_SECONDARY}`}>No closed trades yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-7 gap-2 items-end h-44">
          {data.map((item) => {
            const rawValue = Number(item[valueKey]) || 0;
            const heightPercent = Math.max((Math.abs(rawValue) / maxAbs) * 100, 6);
            const positive = valueKey === "grossLoss" ? false : rawValue >= 0;
            const barTone =
              mode === "count"
                ? "bg-cyan-400/80"
                : positive
                ? "bg-emerald-400/80"
                : "bg-rose-500/80";

            return (
              <div key={`${title}-${item.dayKey}`} className="flex flex-col justify-end h-full min-w-0">
                <div className="flex-1 flex items-end">
                  <div
                    className={`w-full rounded-t ${barTone}`}
                    style={{ height: `${heightPercent}%` }}
                    title={`${item.label}: ${formatValue(rawValue)}`}
                  />
                </div>
                <p className={`mt-2 text-[11px] text-center truncate ${THEME.TEXT_SECONDARY}`}>{item.label}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const PortfolioManager: React.FC<PortfolioManagerProps> = ({ trades, currentBalance }) => {
  const analytics = useMemo(() => {
    const openTrades = trades.filter((trade) => !trade.is_closed);
    const closedTrades = trades
      .filter((trade) => trade.is_closed)
      .sort((a, b) => new Date(a.closed_at || a.created_at).getTime() - new Date(b.closed_at || b.created_at).getTime());

    let totalMarginUsed = 0;
    let totalNotionalValue = 0;

    openTrades.forEach((trade) => {
      const notional = trade.lot_size * MICRO_LOT_CONFIG.MICRO_LOT_UNITS * trade.entry_price;
      totalNotionalValue += notional;
      totalMarginUsed += notional / ACCOUNT_CONFIG.LEVERAGE;
    });

    const marginAvailable = currentBalance - totalMarginUsed;
    const marginUsagePercent = currentBalance > 0 ? (totalMarginUsed / currentBalance) * 100 : 0;

    const daily = buildDailySummaries(closedTrades);
    const recentDaily = daily.slice(-7);
    const todayKey = toDayKey(new Date().toISOString());
    const today = daily.find((day) => day.dayKey === todayKey) || null;
    const totalClosedTrades = closedTrades.length;
    const totalClosedPnl = closedTrades.reduce((sum, trade) => sum + Number(trade.pnl_usd || 0), 0);
    const averageDailyPnl = daily.length > 0 ? totalClosedPnl / daily.length : 0;
    const bestDay = daily.reduce<DailyTradeSummary | null>(
      (best, day) => (!best || day.pnl > best.pnl ? day : best),
      null
    );
    const worstDay = daily.reduce<DailyTradeSummary | null>(
      (worst, day) => (!worst || day.pnl < worst.pnl ? day : worst),
      null
    );

    return {
      openTrades,
      closedTrades,
      totalMarginUsed,
      totalNotionalValue,
      marginAvailable,
      marginUsagePercent,
      daily,
      recentDaily,
      today,
      totalClosedTrades,
      totalClosedPnl,
      averageDailyPnl,
      bestDay,
      worstDay,
    };
  }, [trades, currentBalance]);

  const isHealthy = analytics.marginUsagePercent < 50;
  const isWarning = analytics.marginUsagePercent >= 50 && analytics.marginUsagePercent < 80;
  const isCritical = analytics.marginUsagePercent >= 80;

  return (
    <div className="space-y-6">
      <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h2 className={`text-xl font-bold ${THEME.TEXT_PRIMARY}`}>Portfolio Dashboard</h2>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mt-1`}>
              Trade analysis, daily performance, and live margin overview.
            </p>
          </div>
          <div className="text-right">
            <p className={`text-xs uppercase tracking-wide ${THEME.TEXT_SECONDARY}`}>Current Balance</p>
            <p className={`text-2xl font-bold ${THEME.TEXT_PRIMARY}`}>{formatCurrency(currentBalance)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Daily PnL</p>
            <p className={`text-3xl font-bold ${(analytics.today?.pnl || 0) >= 0 ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR}`}>
              {formatCurrency(analytics.today?.pnl || 0)}
            </p>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-1`}>{analytics.today?.label || "No trades today"}</p>
          </div>

          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Trades Today</p>
            <p className={`text-3xl font-bold ${THEME.TEXT_PRIMARY}`}>{analytics.today?.trades || 0}</p>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-1`}>
              Wins {analytics.today?.wins || 0} / Losses {analytics.today?.losses || 0}
            </p>
          </div>

          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Closed Trades</p>
            <p className={`text-3xl font-bold ${THEME.TEXT_PRIMARY}`}>{analytics.totalClosedTrades}</p>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-1`}>
              Avg daily {formatCurrency(analytics.averageDailyPnl)}
            </p>
          </div>

          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-sm ${THEME.TEXT_SECONDARY} mb-1`}>Open Positions</p>
            <p className={`text-3xl font-bold ${THEME.TEXT_PRIMARY}`}>{analytics.openTrades.length}</p>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-1`}>
              Margin used {formatCurrency(analytics.totalMarginUsed)}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <BarChart
            data={analytics.recentDaily}
            valueKey="pnl"
            title="Daily PnL"
            subtitle="Net gain or loss per day"
            mode="signedCurrency"
          />
          <BarChart
            data={analytics.recentDaily}
            valueKey="trades"
            title="Trade Count"
            subtitle="How many trades were closed each day"
            mode="count"
          />
          <BarChart
            data={analytics.recentDaily}
            valueKey="grossLoss"
            title="Daily Loss Load"
            subtitle="Gross losses per day"
            mode="currency"
          />
        </div>
      </div>

      <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Total Closed PnL</p>
            <p className={`text-2xl font-bold ${analytics.totalClosedPnl >= 0 ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR}`}>
              {formatCurrency(analytics.totalClosedPnl)}
            </p>
          </div>
          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Best Day</p>
            <p className="text-2xl font-bold text-emerald-400">
              {analytics.bestDay ? formatCurrency(analytics.bestDay.pnl) : formatCurrency(0)}
            </p>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-1`}>{analytics.bestDay?.label || "N/A"}</p>
          </div>
          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Worst Day</p>
            <p className="text-2xl font-bold text-rose-400">
              {analytics.worstDay ? formatCurrency(analytics.worstDay.pnl) : formatCurrency(0)}
            </p>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-1`}>{analytics.worstDay?.label || "N/A"}</p>
          </div>
          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`text-xs ${THEME.TEXT_SECONDARY} mb-1`}>Margin Available</p>
            <p className={`text-2xl font-bold ${analytics.marginAvailable >= 0 ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR}`}>
              {formatCurrency(analytics.marginAvailable)}
            </p>
          </div>
        </div>

        <div className="mb-6 pb-6 border-b border-slate-600">
          <div className="flex justify-between items-center mb-2">
            <span className={`${THEME.TEXT_SECONDARY} text-sm font-semibold`}>Margin Usage</span>
            <span
              className={`font-bold ${
                isHealthy ? THEME.PROFIT_COLOR : isWarning ? "text-yellow-400" : THEME.LOSS_COLOR
              }`}
            >
              {analytics.marginUsagePercent.toFixed(1)}%
            </span>
          </div>

          <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                isHealthy ? "bg-emerald-400" : isWarning ? "bg-yellow-400" : "bg-rose-500"
              }`}
              style={{ width: `${Math.min(analytics.marginUsagePercent, 100)}%` }}
            />
          </div>

          <div className="flex justify-between text-xs mt-2">
            <span className="text-emerald-400">Safe (&lt;50%)</span>
            <span className="text-slate-500">Caution (50-80%)</span>
            <span className="text-rose-500">Danger (&gt;80%)</span>
          </div>
        </div>

        {(isWarning || isCritical) && (
          <div
            className={`p-4 rounded-lg mb-4 border ${
              isCritical
                ? "bg-rose-600/20 border-rose-500"
                : "bg-yellow-500/20 border-yellow-500"
            }`}
          >
            <p className={`text-sm font-semibold ${isCritical ? "text-rose-200" : "text-yellow-200"}`}>
              {isCritical
                ? "Margin usage is critical. You are near liquidation risk."
                : "Margin usage is elevated. Consider reducing exposure."}
            </p>
          </div>
        )}

        <div className={`${THEME.BG_PRIMARY} rounded-lg border border-slate-600 overflow-hidden`}>
          <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between gap-3">
            <div>
              <p className={`text-sm font-semibold ${THEME.TEXT_PRIMARY}`}>Daily Performance Table</p>
              <p className={`text-xs ${THEME.TEXT_SECONDARY}`}>Gain and loss per day, with closed trade counts.</p>
            </div>
          </div>

          {analytics.daily.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className={`${THEME.TEXT_SECONDARY}`}>No closed trades yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>Day</th>
                    <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>Trades</th>
                    <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>Wins</th>
                    <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>Losses</th>
                    <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>Gross Gain</th>
                    <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>Gross Loss</th>
                    <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>Daily PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {[...analytics.daily].reverse().map((day) => (
                    <tr key={day.dayKey} className="border-b border-slate-800 hover:bg-slate-700/30">
                      <td className={`px-4 py-3 font-medium ${THEME.TEXT_PRIMARY}`}>{day.label}</td>
                      <td className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY}`}>{day.trades}</td>
                      <td className="text-right px-4 py-3 text-emerald-300">{day.wins}</td>
                      <td className="text-right px-4 py-3 text-rose-300">{day.losses}</td>
                      <td className="text-right px-4 py-3 text-emerald-300">{formatCurrency(day.grossProfit)}</td>
                      <td className="text-right px-4 py-3 text-rose-300">{formatCurrency(-day.grossLoss)}</td>
                      <td className={`text-right px-4 py-3 font-semibold ${day.pnl >= 0 ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR}`}>
                        {formatCurrency(day.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PortfolioManager;
