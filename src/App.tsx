/**
 * Main Trading Dashboard App
 * XM-Inspired Professional Trading Platform
 */

import React, { useEffect, useMemo, useState } from "react";
import Dashboard from "./components/Dashboard";
import RiskCalculator from "./components/RiskCalculator";
import TradingJournal from "./components/TradingJournal";
import MarketAnalysis from "./components/MarketAnalysis";
import PortfolioManager from "./components/PortfolioManager";
import TradingAssistant from "./components/TradingAssistant";
import { Trade } from "./types";
import { ACCOUNT_CONFIG, THEME } from "./utils/constants";
import {
  MANUAL_TRADES_STORAGE_KEY,
  createManualTrade,
  estimateTradePips,
  getTradePriceTolerance,
  normalizeTradeSymbol,
  parseStoredManualTrades,
  reconcileTradeLedger,
  sortTradesNewestFirst,
} from "./utils/tradeLedger";

type PageView =
  | "dashboard"
  | "journal"
  | "risk"
  | "market"
  | "portfolio"
  | "assistant";

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<PageView>("dashboard");
  const [manualTrades, setManualTrades] = useState<Trade[]>(() => {
    if (typeof window === "undefined") return [];
    return parseStoredManualTrades(window.localStorage.getItem(MANUAL_TRADES_STORAGE_KEY));
  });
  const [mt4Trades, setMt4Trades] = useState<Trade[]>([]);
  const [currentBalance, setCurrentBalance] = useState(ACCOUNT_CONFIG.INIT_BALANCE);
  const [selectedAsset] = useState("EURUSD");
  const [sidebarOpen] = useState(true);
  const [mt4SyncStatus, setMt4SyncStatus] = useState<string>("");
  const [mt4PolicyStatus, setMt4PolicyStatus] = useState<string>("");
  const mt4BridgeBase = import.meta.env.VITE_MT4_BRIDGE_URL || "/api/mt4";
  const trades = useMemo(
    () => reconcileTradeLedger(manualTrades, mt4Trades),
    [manualTrades, mt4Trades]
  );

  const getCloseTolerance = (symbol: string): number => {
    return getTradePriceTolerance(symbol);
  };

  const getCloseSource = (row: any): "SL_TRIGGER" | "TP_TRIGGER" | "MANUAL_CLOSE" | "BOT_CLOSE" => {
    const symbol = normalizeTradeSymbol(String(row.symbol || ""));
    const tradeType = String(row.type || "").toUpperCase() === "SELL" ? "Sell" : "Buy";
    const closePrice = Number(row.closePrice || 0);
    const sl = Number(row.sl || 0);
    const tp = Number(row.tp || 0);
    const comment = String(row.comment || "");
    const tol = getCloseTolerance(symbol);

    if (tradeType === "Buy") {
      if (tp > 0 && closePrice >= tp - tol) return "TP_TRIGGER";
      if (sl > 0 && closePrice <= sl + tol) return "SL_TRIGGER";
    } else {
      if (tp > 0 && closePrice <= tp + tol) return "TP_TRIGGER";
      if (sl > 0 && closePrice >= sl - tol) return "SL_TRIGGER";
    }

    if (/ai-auto|web-bridge|policy-check|auto-protect/i.test(comment)) {
      return "BOT_CLOSE";
    }

    return "MANUAL_CLOSE";
  };

  const getCloseReason = (source: "SL_TRIGGER" | "TP_TRIGGER" | "MANUAL_CLOSE" | "BOT_CLOSE"): string => {
    if (source === "TP_TRIGGER") return "Closed: TP hit";
    if (source === "SL_TRIGGER") return "Closed: SL hit";
    if (source === "BOT_CLOSE") return "Closed: bot-managed exit";
    return "Closed: manual/unknown";
  };

  const handleAddTrade = (newTrade: Omit<Trade, "id" | "created_at">) => {
    const trade = createManualTrade(newTrade);
    setManualTrades((prev) => sortTradesNewestFirst([...prev, trade]));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      MANUAL_TRADES_STORAGE_KEY,
      JSON.stringify(sortTradesNewestFirst(manualTrades))
    );
  }, [manualTrades]);

  useEffect(() => {
    let cancelled = false;

    const syncFromMt4 = async () => {
      try {
        const [accountRes, historyRes, policyRes] = await Promise.all([
          fetch(`${mt4BridgeBase}/account`, { method: "GET" }),
          fetch(`${mt4BridgeBase}/history`, { method: "GET" }),
          fetch(`${mt4BridgeBase}/policy-events?limit=1`, { method: "GET" }),
        ]);

        const accountData = await accountRes.json().catch(() => ({}));
        const historyData = await historyRes.json().catch(() => ({}));
        const policyData = await policyRes.json().catch(() => ({}));

        if (!cancelled && accountRes.ok && accountData?.ok && accountData?.account) {
          const nextBalance = Number(accountData.account.balance);
          if (Number.isFinite(nextBalance) && nextBalance > 0) {
            setCurrentBalance(nextBalance);
          }
        }

        if (!cancelled && historyRes.ok && historyData?.ok && Array.isArray(historyData.trades)) {
          const importedTrades: Trade[] = historyData.trades
            .filter((row: any) => Number.isFinite(Number(row.ticket)) && Number.isFinite(Number(row.closeTime)))
            .map((row: any) => {
              const symbol = normalizeTradeSymbol(String(row.symbol || ""));
              const tradeType = String(row.type || "").toUpperCase() === "SELL" ? "Sell" : "Buy";
              const ticket = Number(row.ticket);
              const closeTime = Number(row.closeTime);
              const openTime = Number(row.openTime || 0);
              const entryPrice = Number(row.openPrice || 0);
              const closePrice = Number(row.closePrice || 0);
              const pips = estimateTradePips(
                symbol,
                tradeType === "Buy" ? "BUY" : "SELL",
                entryPrice,
                closePrice
              );
              const closeSource = getCloseSource(row);

              return {
                id: `mt4-${ticket}-${closeTime}`,
                user_id: "mt4_sync",
                asset: symbol || String(row.symbol || ""),
                trade_type: tradeType,
                entry_price: entryPrice,
                stop_loss: Number(row.sl || 0),
                take_profit: Number(row.tp || 0),
                close_price: closePrice,
                lot_size: Number(row.lots || 0),
                pnl_usd: Number(row.profit || 0),
                pips_gained: pips,
                emotional_state: "Imported",
                reasoning: `Auto-imported from MT4 ticket ${ticket}. ${getCloseReason(closeSource)} | SL ${Number(row.sl || 0)} | TP ${Number(row.tp || 0)}`,
                close_source: closeSource,
                close_reason: getCloseReason(closeSource),
                mt4_ticket: ticket,
                mt4_comment: String(row.comment || ""),
                created_at: openTime > 0 ? new Date(openTime * 1000).toISOString() : new Date().toISOString(),
                closed_at: closeTime > 0 ? new Date(closeTime * 1000).toISOString() : new Date().toISOString(),
                is_closed: true,
              };
            });
          setMt4Trades(sortTradesNewestFirst(importedTrades));
        }

        if (!cancelled) {
          const accountOk = accountRes.ok && accountData?.ok;
          const historyOk = historyRes.ok && historyData?.ok;
          setMt4SyncStatus(accountOk || historyOk ? "MT4 sync active" : "");
          const latestPolicy = Array.isArray(policyData?.events) ? policyData.events[0] : null;
          if (policyRes.ok && policyData?.ok && latestPolicy?.event) {
            const when = latestPolicy.time
              ? new Date(Number(latestPolicy.time) * 1000).toLocaleTimeString()
              : "";
            setMt4PolicyStatus(`EA ${latestPolicy.event}${when ? ` at ${when}` : ""}`);
          } else {
            setMt4PolicyStatus("");
          }
        }
      } catch {
        if (!cancelled) {
          setMt4SyncStatus("");
          setMt4PolicyStatus("");
        }
      }
    };

    syncFromMt4();
    const timer = window.setInterval(syncFromMt4, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mt4BridgeBase]);

  // Navigation items
  const navItems: { id: PageView; label: string; icon: string }[] = [
    { id: "dashboard", label: "Dashboard", icon: "📈" },
    { id: "journal", label: "Journal", icon: "📔" },
    { id: "assistant", label: "Assistant", icon: "🤖" },
    { id: "risk", label: "Risk Calc", icon: "⚡" },
    { id: "market", label: "Markets", icon: "🔍" },
    { id: "portfolio", label: "Portfolio", icon: "📊" },
  ];

  const totalPnL = trades
    .filter((t) => t.is_closed)
    .reduce((sum, t) => sum + (t.pnl_usd || 0), 0);
  
  const winRate = trades.filter((t) => t.is_closed).length > 0
    ? (trades.filter((t) => t.is_closed && (t.pnl_usd || 0) > 0).length /
       trades.filter((t) => t.is_closed).length) * 100
    : 0;

  return (
    <div className={`flex h-screen overflow-hidden ${THEME.BG_PRIMARY}`} style={{ height: "100dvh" }}>
      {/* Premium Sidebar - XM Inspired */}
      <aside
        className={`${THEME.BG_SECONDARY} min-h-0 border-r border-slate-700/50 transition-all duration-300 ${
          sidebarOpen ? "w-72" : "w-24"
        } flex flex-col overflow-y-auto backdrop-blur-sm`}
      >
        {/* XM Branding Header */}
        <div className="p-6 border-b border-slate-700/50">
          {sidebarOpen ? (
            <div className="space-y-1">
              <h1 className="text-2xl font-black text-white tracking-tight">
                XM Trading
              </h1>
              <p className="text-xs text-emerald-400 font-semibold">
                MICRO ACCOUNT DASHBOARD
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <span className="text-2xl font-black text-emerald-400">X</span>
            </div>
          )}
        </div>

        {/* Premium Account Card */}
        {sidebarOpen && (
          <div className="mx-4 mt-6 p-4 rounded-xl bg-gradient-to-br from-emerald-900/20 to-slate-800/50 border border-emerald-400/20 space-y-3">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                Account Balance
              </p>
              <p className="text-3xl font-bold text-white mt-2">
                ${currentBalance.toFixed(2)}
              </p>
            </div>
            <div className="pt-3 border-t border-slate-700/50 grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">
                  Total P&L
                </p>
                <p className={`font-bold text-lg ${totalPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  ${totalPnL.toFixed(2)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wider">
                  Win Rate
                </p>
                <p className="font-bold text-lg text-blue-400">
                  {winRate.toFixed(1)}%
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation Menu */}
        <nav className="flex-1 p-4 mt-6 space-y-2">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-all duration-200 ${
                currentPage === item.id
                  ? "bg-emerald-400/10 border border-emerald-400/50 text-emerald-400 font-semibold shadow-lg shadow-emerald-400/10"
                  : "text-slate-300 hover:bg-slate-700/50 hover:text-white"
              }`}
              title={item.label}
            >
              <span className="text-xl flex-shrink-0">{item.icon}</span>
              {sidebarOpen && <span className="text-sm font-medium">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Account Details Footer */}
        {sidebarOpen && (
          <div className="p-4 border-t border-slate-700/50 space-y-3 text-sm">
            <div className="space-y-2 text-slate-300 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Leverage:</span>
                <span className="text-emerald-400 font-semibold">1:{ACCOUNT_CONFIG.LEVERAGE}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Open Trades:</span>
                <span className="text-white font-semibold">{trades.filter((t) => !t.is_closed).length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Closed Trades:</span>
                <span className="text-white font-semibold">{trades.filter((t) => t.is_closed).length}</span>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content - Premium Layout */}
      <main className={`flex min-h-0 min-w-0 flex-1 flex-col ${THEME.BG_PRIMARY}`}>
        {/* Professional Header */}
        <header
          className={`${THEME.BG_SECONDARY} border-b border-slate-700/50 sticky top-0 z-10 backdrop-blur-sm`}
        >
          <div className="px-8 py-5 flex justify-between items-center">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-4xl">
                  {navItems.find((n) => n.id === currentPage)?.icon}
                </span>
                <h2 className="text-2xl font-bold text-white">
                  {navItems.find((n) => n.id === currentPage)?.label}
                </h2>
              </div>
              <p className={`${THEME.TEXT_SECONDARY} text-sm`}>
                {currentPage === "dashboard" &&
                  "Real-time performance analytics & trading statistics"}
                {currentPage === "journal" &&
                  "Complete trade history with emotional & technical analysis"}                {currentPage === "assistant" &&
                  "AI-powered trading signals and entry point recommendations"}                {currentPage === "risk" &&
                  "Professional position sizing calculator"}
                {currentPage === "market" &&
                  "Market insights and trading opportunities"}
                {currentPage === "portfolio" &&
                  "Portfolio composition and margin monitoring"}
              </p>
              {mt4SyncStatus && (
                <p className="text-xs text-emerald-300 mt-2">{mt4SyncStatus}</p>
              )}
              {mt4PolicyStatus && (
                <p className="text-xs text-cyan-300 mt-1">{mt4PolicyStatus}</p>
              )}
            </div>

            {/* Premium Quick Stats - Compact */}
            <div className="flex gap-8 ml-8">
              <div className="text-center px-4 py-2 rounded-lg bg-slate-700/30 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                  Total PnL
                </p>
                <p className={`text-xl font-bold mt-1 ${totalPnL >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                  ${totalPnL.toFixed(2)}
                </p>
              </div>
              <div className="text-center px-4 py-2 rounded-lg bg-slate-700/30 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                  Win Rate
                </p>
                <p className="text-xl font-bold text-blue-400 mt-1">
                  {winRate.toFixed(1)}%
                </p>
              </div>
              <div className="text-center px-4 py-2 rounded-lg bg-slate-700/30 border border-slate-700">
                <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">
                  Open
                </p>
                <p className="text-xl font-bold text-amber-400 mt-1">
                  {trades.filter((t) => !t.is_closed).length}
                </p>
              </div>
            </div>
          </div>
        </header>

        {/* Page Content with Premium Styling */}
        <div className="min-h-0 flex-1 overflow-y-auto p-8">
          {currentPage === "dashboard" && (
            <Dashboard
              trades={trades}
              currentBalance={currentBalance}
              initialBalance={ACCOUNT_CONFIG.INIT_BALANCE}
            />
          )}

          {currentPage === "journal" && (
            <TradingJournal
              trades={trades}
              onAddTrade={handleAddTrade}
            />
          )}

          <div style={{ display: currentPage === "assistant" ? "block" : "none" }}>
            <TradingAssistant trades={trades} />
          </div>

          {currentPage === "risk" && (
            <div className="max-w-3xl">
              <RiskCalculator
                balance={currentBalance}
                onLotSizeCalculated={(lotSize) => {
                  console.log("Recommended lot size:", lotSize);
                }}
              />
            </div>
          )}

          {currentPage === "market" && (
            <MarketAnalysis selectedAsset={selectedAsset} />
          )}

          {currentPage === "portfolio" && (
            <PortfolioManager trades={trades} currentBalance={currentBalance} />
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
