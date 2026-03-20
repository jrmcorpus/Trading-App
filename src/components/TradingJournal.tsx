/**
 * Trading Journal - Combined Form & Table
 */

import React, { useMemo, useState } from "react";
import { Trade } from "../types";
import { THEME, EMOTIONAL_STATES, MAJOR_ASSETS } from "../utils/constants";
import { calculatePipValue, formatCurrency } from "../utils/calculations";
import { formatPairLabel } from "../utils/pairs";
import { estimateTradePips } from "../utils/tradeLedger";

interface TradingJournalProps {
  trades: Trade[];
  onAddTrade: (trade: Omit<Trade, "id" | "created_at">) => void;
}

const TradingJournal: React.FC<TradingJournalProps> = ({
  trades,
  onAddTrade,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    asset: "EURUSD",
    trade_type: "Buy" as "Buy" | "Sell",
    entry_price: 0,
    stop_loss: 0,
    take_profit: 0,
    lot_size: 0.01,
    emotional_state: "Neutral",
    reasoning: "",
    close_price: 0,
    is_closed: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.asset ||
      formData.entry_price <= 0 ||
      formData.stop_loss <= 0 ||
      formData.lot_size <= 0 ||
      !formData.reasoning.trim()
    ) {
      alert("Please fill all required fields correctly");
      return;
    }

    let pnl_usd = null;
    let pips_gained = null;

    if (formData.is_closed && formData.close_price > 0) {
      const pips = estimateTradePips(
        formData.asset,
        formData.trade_type,
        formData.entry_price,
        formData.close_price
      );

      pips_gained = pips;
      pnl_usd = pips === null ? null : pips * calculatePipValue(formData.lot_size);
    }

    const newTrade: Omit<Trade, "id" | "created_at"> = {
      user_id: "", // Will be set by backend
      asset: formData.asset,
      trade_type: formData.trade_type,
      entry_price: formData.entry_price,
      stop_loss: formData.stop_loss,
      take_profit: formData.take_profit,
      lot_size: formData.lot_size,
      pnl_usd,
      pips_gained,
      emotional_state: formData.emotional_state,
      reasoning: formData.reasoning,
      close_price: formData.is_closed ? formData.close_price : null,
      closed_at: formData.is_closed ? new Date().toISOString() : null,
      is_closed: formData.is_closed,
      close_reason: formData.is_closed ? "Closed: manual journal entry" : null,
      close_source: formData.is_closed ? "MANUAL_CLOSE" : null,
      mt4_ticket: null,
      mt4_comment: null,
    };

    onAddTrade(newTrade);

    // Reset form
    setFormData({
      asset: "EURUSD",
      trade_type: "Buy",
      entry_price: 0,
      stop_loss: 0,
      take_profit: 0,
      lot_size: 0.01,
      emotional_state: "Neutral",
      reasoning: "",
      close_price: 0,
      is_closed: false,
    });
    setShowForm(false);
  };

  const openTrades = trades.filter((t) => !t.is_closed);
  const closedTrades = trades.filter((t) => t.is_closed);
  const slAnalytics = useMemo(() => {
    const toTime = (trade: Trade) => {
      const ts = trade.closed_at ? new Date(trade.closed_at).getTime() : 0;
      return Number.isFinite(ts) ? ts : 0;
    };
    const sorted = [...closedTrades].sort((a, b) => toTime(a) - toTime(b));
    const splitIndex = Math.floor(sorted.length / 2);
    const before = sorted.slice(0, splitIndex);
    const after = sorted.slice(splitIndex);
    const splitTime = sorted[splitIndex]?.closed_at || null;

    const summarize = (items: Trade[]) => {
      const total = items.length;
      const slHits = items.filter((t) => t.close_source === "SL_TRIGGER").length;
      const tpHits = items.filter((t) => t.close_source === "TP_TRIGGER").length;
      const pnl = items.reduce((sum, t) => sum + Number(t.pnl_usd || 0), 0);
      return {
        total,
        slHits,
        tpHits,
        pnl,
        slRate: total > 0 ? (slHits / total) * 100 : 0,
      };
    };

    const bySymbolMap = new Map<string, { symbol: string; before: Trade[]; after: Trade[]; all: Trade[] }>();
    for (const trade of sorted) {
      const key = String(trade.asset || "").toUpperCase();
      if (!bySymbolMap.has(key)) bySymbolMap.set(key, { symbol: key, before: [], after: [], all: [] });
      bySymbolMap.get(key)!.all.push(trade);
    }
    for (const trade of before) {
      const key = String(trade.asset || "").toUpperCase();
      const bucket = bySymbolMap.get(key);
      if (bucket) bucket.before.push(trade);
    }
    for (const trade of after) {
      const key = String(trade.asset || "").toUpperCase();
      const bucket = bySymbolMap.get(key);
      if (bucket) bucket.after.push(trade);
    }

    const bySymbol = [...bySymbolMap.values()]
      .map((bucket) => {
        const beforeStats = summarize(bucket.before);
        const afterStats = summarize(bucket.after);
        const allStats = summarize(bucket.all);
        return {
          symbol: bucket.symbol,
          before: beforeStats,
          after: afterStats,
          all: allStats,
          slRateDelta: afterStats.slRate - beforeStats.slRate,
        };
      })
      .sort((a, b) => b.all.total - a.all.total || b.all.slRate - a.all.slRate);

    return {
      total: sorted.length,
      splitTime,
      overallBefore: summarize(before),
      overallAfter: summarize(after),
      bySymbol,
    };
  }, [closedTrades]);

  return (
    <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
      <div className="flex justify-between items-center mb-6">
        <h2 className={`text-xl font-bold ${THEME.TEXT_PRIMARY}`}>Trading Journal</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-medium transition"
        >
          {showForm ? "Cancel" : "+ New Trade"}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-8 pb-8 border-b border-slate-600">
          <div className="grid grid-cols-2 gap-4 mb-4">
            {/* Asset */}
            <div>
              <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                Asset
              </label>
              <select
                value={formData.asset}
                onChange={(e) =>
                  setFormData({ ...formData, asset: e.target.value })
                }
                className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
              >
                {MAJOR_ASSETS.map((asset) => (
                  <option key={asset} value={asset}>
                    {formatPairLabel(asset)}
                  </option>
                ))}
              </select>
            </div>

            {/* Trade Type */}
            <div>
              <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                Type
              </label>
              <select
                value={formData.trade_type}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    trade_type: e.target.value as "Buy" | "Sell",
                  })
                }
                className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
              >
                <option value="Buy">Buy</option>
                <option value="Sell">Sell</option>
              </select>
            </div>

            {/* Entry Price */}
            <div>
              <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                Entry Price
              </label>
              <input
                type="number"
                step="0.00001"
                value={formData.entry_price || ""}
                onChange={(e) =>
                  setFormData({ ...formData, entry_price: Number(e.target.value) })
                }
                className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
                placeholder="1.08500"
              />
            </div>

            {/* Lot Size */}
            <div>
              <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                Lot Size (u)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.lot_size || ""}
                onChange={(e) =>
                  setFormData({ ...formData, lot_size: Number(e.target.value) })
                }
                className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
                placeholder="0.01"
              />
            </div>

            {/* Stop Loss */}
            <div>
              <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                Stop Loss Price
              </label>
              <input
                type="number"
                step="0.00001"
                value={formData.stop_loss || ""}
                onChange={(e) =>
                  setFormData({ ...formData, stop_loss: Number(e.target.value) })
                }
                className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
                placeholder="1.08000"
              />
            </div>

            {/* Take Profit */}
            <div>
              <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                Take Profit Price
              </label>
              <input
                type="number"
                step="0.00001"
                value={formData.take_profit || ""}
                onChange={(e) =>
                  setFormData({ ...formData, take_profit: Number(e.target.value) })
                }
                className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
                placeholder="1.09000"
              />
            </div>

            {/* Emotional State */}
            <div>
              <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                Emotional State
              </label>
              <select
                value={formData.emotional_state}
                onChange={(e) =>
                  setFormData({ ...formData, emotional_state: e.target.value })
                }
                className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
              >
                {EMOTIONAL_STATES.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </select>
            </div>

            {/* Close Trade Checkbox */}
            <div className="flex items-end">
              <label className={`flex items-center gap-2 cursor-pointer`}>
                <input
                  type="checkbox"
                  checked={formData.is_closed}
                  onChange={(e) =>
                    setFormData({ ...formData, is_closed: e.target.checked })
                  }
                  className="w-4 h-4"
                />
                <span className={`${THEME.TEXT_SECONDARY} text-sm`}>Close Trade Now</span>
              </label>
            </div>

            {/* Close Price (if trade is closed) */}
            {formData.is_closed && (
              <div>
                <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
                  Close Price
                </label>
                <input
                  type="number"
                  step="0.00001"
                  value={formData.close_price || ""}
                  onChange={(e) =>
                    setFormData({ ...formData, close_price: Number(e.target.value) })
                  }
                  className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600`}
                  placeholder="1.08700"
                />
              </div>
            )}
          </div>

          {/* Reasoning - Full Width */}
          <div className="mb-4">
            <label className={`block text-sm font-medium ${THEME.TEXT_SECONDARY} mb-1`}>
              Trade Reasoning (Mandatory)
            </label>
            <textarea
              value={formData.reasoning}
              onChange={(e) =>
                setFormData({ ...formData, reasoning: e.target.value })
              }
              className={`w-full ${THEME.BG_TERTIARY} ${THEME.TEXT_PRIMARY} px-3 py-2 rounded border border-slate-600 focus:border-emerald-400 focus:outline-none resize-none`}
              rows={4}
              placeholder="Explain your trade setup, why you entered, technical confluence, market conditions, etc."
            />
            {!formData.reasoning.trim() && (
              <p className="text-rose-400 text-xs mt-1">Reasoning is required</p>
            )}
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full px-4 py-3 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg font-semibold transition"
          >
            Log Trade
          </button>
        </form>
      )}

      {/* Trades Table */}
      <div className="mb-8">
        <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
          Open Trades ({openTrades.length})
        </h3>
        {openTrades.length === 0 ? (
          <p className={`${THEME.TEXT_SECONDARY} text-center py-6`}>No open trades</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Asset
                  </th>
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Type
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Entry
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    SL / TP
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Lot Size
                  </th>
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Mood
                  </th>
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Opened
                  </th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-slate-700 hover:bg-slate-700/50">
                    <td className={`px-4 py-3 font-semibold`}>{formatPairLabel(trade.asset)}</td>
                    <td className={`px-4 py-3 ${trade.trade_type === "Buy" ? "text-emerald-400" : "text-rose-500"}`}>
                      {trade.trade_type}
                    </td>
                    <td className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY}`}>
                      {trade.entry_price.toFixed(5)}
                    </td>
                    <td className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY}`}>
                      {trade.stop_loss.toFixed(5)} / {trade.take_profit.toFixed(5)}
                    </td>
                    <td className={`text-right px-4 py-3 font-medium`}>
                      {trade.lot_size.toFixed(2)}u
                    </td>
                    <td className={`px-4 py-3`}>{trade.emotional_state}</td>
                    <td className={`px-4 py-3 text-xs ${THEME.TEXT_SECONDARY}`}>
                      {new Date(trade.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed Trades */}
      <div>
        <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
          Closed Trades ({closedTrades.length})
        </h3>
        {closedTrades.length > 0 && (
          <div className="mb-4 rounded border border-slate-700 bg-slate-900/50 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-semibold text-slate-100">SL-hit Analytics</p>
              <p className="text-[11px] text-slate-400">
                Auto split: before/after {slAnalytics.splitTime ? new Date(slAnalytics.splitTime).toLocaleString() : "N/A"}
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-2 text-[11px] mb-3">
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                <p className="text-slate-200 font-semibold">Before</p>
                <p className="text-slate-400">
                  Trades {slAnalytics.overallBefore.total} | SL hits {slAnalytics.overallBefore.slHits} ({slAnalytics.overallBefore.slRate.toFixed(1)}%) | TP hits {slAnalytics.overallBefore.tpHits} | PnL {formatCurrency(slAnalytics.overallBefore.pnl)}
                </p>
              </div>
              <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
                <p className="text-slate-200 font-semibold">After</p>
                <p className="text-slate-400">
                  Trades {slAnalytics.overallAfter.total} | SL hits {slAnalytics.overallAfter.slHits} ({slAnalytics.overallAfter.slRate.toFixed(1)}%) | TP hits {slAnalytics.overallAfter.tpHits} | PnL {formatCurrency(slAnalytics.overallAfter.pnl)}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="text-left py-1 pr-2">Symbol</th>
                    <th className="text-right py-1 px-2">SL Rate</th>
                    <th className="text-right py-1 px-2">Before</th>
                    <th className="text-right py-1 px-2">After</th>
                    <th className="text-right py-1 px-2">Delta</th>
                    <th className="text-right py-1 pl-2">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {slAnalytics.bySymbol.map((row) => (
                    <tr key={`sl-analytics-${row.symbol}`} className="border-t border-slate-800">
                      <td className="py-1 pr-2 text-slate-200">{formatPairLabel(row.symbol)}</td>
                      <td className="py-1 px-2 text-right text-slate-300">{row.all.slRate.toFixed(1)}%</td>
                      <td className="py-1 px-2 text-right text-slate-400">{row.before.slRate.toFixed(1)}%</td>
                      <td className="py-1 px-2 text-right text-slate-400">{row.after.slRate.toFixed(1)}%</td>
                      <td className={`py-1 px-2 text-right ${row.slRateDelta <= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                        {row.slRateDelta > 0 ? "+" : ""}{row.slRateDelta.toFixed(1)}%
                      </td>
                      <td className="py-1 pl-2 text-right text-slate-400">{row.all.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {closedTrades.length === 0 ? (
          <p className={`${THEME.TEXT_SECONDARY} text-center py-6`}>No closed trades yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-600">
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Asset
                  </th>
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Type
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Entry
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Exit
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    SL / TP
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Pips
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    PnL
                  </th>
                  <th className={`text-right px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Lot Size
                  </th>
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Close Source
                  </th>
                  <th className={`text-left px-4 py-3 ${THEME.TEXT_SECONDARY} font-semibold`}>
                    Closed
                  </th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map((trade) => (
                  <tr
                    key={trade.id}
                    className={`border-b border-slate-700 hover:bg-slate-700/50 ${
                      (trade.pnl_usd || 0) >= 0 ? "" : "opacity-75"
                    }`}
                  >
                    <td className={`px-4 py-3 font-semibold`}>{formatPairLabel(trade.asset)}</td>
                    <td className={`px-4 py-3 ${trade.trade_type === "Buy" ? "text-emerald-400" : "text-rose-500"}`}>
                      {trade.trade_type}
                    </td>
                    <td className={`text-right px-4 py-3 font-medium ${THEME.TEXT_SECONDARY}`}>
                      {Number.isFinite(trade.entry_price) ? trade.entry_price.toFixed(5) : "-"}
                    </td>
                    <td className={`text-right px-4 py-3 font-medium ${THEME.TEXT_SECONDARY}`}>
                      {Number.isFinite(Number(trade.close_price)) ? Number(trade.close_price).toFixed(5) : "-"}
                    </td>
                    <td className={`text-right px-4 py-3 text-xs ${THEME.TEXT_SECONDARY}`}>
                      <div>SL {Number.isFinite(trade.stop_loss) ? trade.stop_loss.toFixed(5) : "-"}</div>
                      <div>TP {Number.isFinite(trade.take_profit) ? trade.take_profit.toFixed(5) : "-"}</div>
                    </td>
                    <td className={`text-right px-4 py-3 font-medium ${
                      (trade.pips_gained || 0) >= 0 ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR
                    }`}>
                      {(trade.pips_gained || 0).toFixed(1)}
                    </td>
                    <td className={`text-right px-4 py-3 font-semibold ${
                      (trade.pnl_usd || 0) >= 0 ? THEME.PROFIT_COLOR : THEME.LOSS_COLOR
                    }`}>
                      {formatCurrency(trade.pnl_usd || 0)}
                    </td>
                    <td className={`text-right px-4 py-3 font-medium`}>
                      {trade.lot_size.toFixed(2)}u
                    </td>
                    <td className={`px-4 py-3 text-xs ${THEME.TEXT_SECONDARY}`}>
                      {(() => {
                        const source = trade.close_source || "MANUAL_CLOSE";
                        const badgeClass =
                          source === "TP_TRIGGER"
                            ? "border-emerald-400/50 bg-emerald-500/10 text-emerald-300"
                            : source === "SL_TRIGGER"
                            ? "border-rose-400/50 bg-rose-500/10 text-rose-300"
                            : source === "BOT_CLOSE"
                            ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-300"
                            : "border-slate-500/50 bg-slate-700/40 text-slate-300";
                        return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-semibold ${badgeClass}`}>
                            {source}
                          </span>
                        );
                      })()}
                      {trade.mt4_ticket ? <div>ticket #{trade.mt4_ticket}</div> : null}
                      {trade.mt4_comment ? (
                        <div className="truncate max-w-[220px]" title={trade.mt4_comment}>
                          comment: {trade.mt4_comment}
                        </div>
                      ) : null}
                    </td>
                    <td className={`px-4 py-3 text-xs ${THEME.TEXT_SECONDARY}`}>
                      {trade.closed_at ? new Date(trade.closed_at).toLocaleString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default TradingJournal;

