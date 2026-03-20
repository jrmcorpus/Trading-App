/**
 * Market Analysis Component
 * Displays live news, market insights, and trading suggestions
 * Uses Finnhub or Alpha Vantage API (mock implementation)
 */

import React, { useState, useEffect } from "react";
import { MarketNews } from "../types";
import { THEME, INDICATORS } from "../utils/constants";
import { formatPairLabel } from "../utils/pairs";

interface MarketAnalysisProps {
  selectedAsset?: string;
}

const MarketAnalysis: React.FC<MarketAnalysisProps> = ({
  selectedAsset = "EURUSD",
}) => {
  const [news, setNews] = useState<MarketNews[]>([]);
  const [loading, setLoading] = useState(true);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Mock news data (Replace with real API call)
  const fetchMarketNews = () => {
    const mockNews: MarketNews[] = [
      {
        id: "1",
        title: "ECB signals possible rate cuts amid cooling inflation",
        summary:
          "European Central Bank hints at potential interest rate reductions as inflation moderates.",
        source: "Reuters",
        url: "#",
        datetime: Date.now(),
        sentiment: "bullish",
      },
      {
        id: "2",
        title: "USD strengthens on Fed rate expectations",
        summary:
          "US Dollar extends gains following hawkish Federal Reserve commentary.",
        source: "Bloomberg",
        url: "#",
        datetime: Date.now() - 3600000,
        sentiment: "bearish",
      },
      {
        id: "3",
        title: "Gold hits 6-month high amid geopolitical tensions",
        summary:
          "Safe-haven demand pushes precious metals higher amid global uncertainty.",
        source: "MarketWatch",
        url: "#",
        datetime: Date.now() - 7200000,
        sentiment: "bullish",
      },
      {
        id: "4",
        title: "Oil prices surge on supply concerns",
        summary:
          "Crude oil rallies on reports of production cuts and increased demand.",
        source: "CNBC",
        url: "#",
        datetime: Date.now() - 10800000,
        sentiment: "bullish",
      },
    ];

    setNews(mockNews);
    setLoading(false);
  };

  useEffect(() => {
    fetchMarketNews();
    // In production, call real API here
    // const interval = setInterval(fetchMarketNews, 300000); // Update every 5 mins
    // return () => clearInterval(interval);
  }, [selectedAsset]);

  // Generate trading suggestions based on technical indicators
  useEffect(() => {
    const suggestionsList = [
      `📊 EMA Strategy: Monitor ${formatPairLabel(selectedAsset)} for EMA(${INDICATORS.EMA_SHORT}) crossing above EMA(${INDICATORS.EMA_LONG}) for bullish signal`,
      `📈 RSI Levels: Look for RSI dipping to ${INDICATORS.RSI_OVERSOLD} for potential bounce, resistance at ${INDICATORS.RSI_OVERBOUGHT}`,
      `🎯 Support/Resistance: Use daily highs/lows of last 5 days as key levels`,
      `💡 Risk Management: Remember 1% rule - risking $1 per 100 of balance`,
      `🕐 Session Overlap: Best volatility during overlap of London (07:00) and NY (12:00) GMT`,
    ];
    setSuggestions(suggestionsList);
  }, [selectedAsset]);

  return (
    <div className="space-y-6">
      {/* Asset Selector */}
      <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
        <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
          🌍 Market Analysis
        </h3>
        <p className={`${THEME.TEXT_SECONDARY} text-sm mb-4`}>
          Currently analyzing: <span className="font-bold text-emerald-400">{formatPairLabel(selectedAsset)}</span>
        </p>
      </div>

      {/* Live Market News */}
      <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
        <div className="flex justify-between items-center mb-4">
          <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY}`}>
            📰 Market News
          </h3>
          <span className={`text-xs px-2 py-1 rounded ${THEME.BG_PRIMARY} ${THEME.TEXT_SECONDARY}`}>
            {news.length} items
          </span>
        </div>

        {loading ? (
          <p className={`${THEME.TEXT_SECONDARY} text-center py-4`}>Loading news...</p>
        ) : news.length === 0 ? (
          <p className={`${THEME.TEXT_SECONDARY} text-center py-4`}>No news available</p>
        ) : (
          <div className="space-y-4">
            {news.map((item) => (
              <div
                key={item.id}
                className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600 hover:border-slate-500 transition cursor-pointer`}
              >
                <div className="flex justify-between items-start mb-2">
                  <h4
                    className={`font-semibold ${THEME.TEXT_PRIMARY} flex-1 mr-4`}
                  >
                    {item.title}
                  </h4>
                  {item.sentiment && (
                    <span
                      className={`text-xs px-2 py-1 rounded whitespace-nowrap ${
                        item.sentiment === "bullish"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : item.sentiment === "bearish"
                            ? "bg-rose-500/20 text-rose-400"
                            : "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {item.sentiment}
                    </span>
                  )}
                </div>

                <p className={`${THEME.TEXT_SECONDARY} text-sm mb-3`}>
                  {item.summary}
                </p>

                <div className="flex justify-between items-center">
                  <span className={`text-xs ${THEME.TEXT_SECONDARY}`}>
                    {item.source}
                  </span>
                  <span className={`text-xs ${THEME.TEXT_SECONDARY}`}>
                    {new Date(item.datetime).toLocaleTimeString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Trading Suggestions */}
      <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
        <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
          💡 Smart Suggestions
        </h3>

        <div className="space-y-3">
          {suggestions.map((suggestion, idx) => (
            <div
              key={idx}
              className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600 flex items-start gap-3`}
            >
              <span className="text-lg flex-shrink-0">
                {suggestion.split(":")[0]}
              </span>
              <span className={`${THEME.TEXT_SECONDARY} text-sm`}>
                {suggestion.split(":").slice(1).join(":")}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Economic Calendar Teaser */}
      <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
        <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
          📅 Upcoming Economic Events
        </h3>

        <div className="space-y-3">
          {[
            { time: "Today 13:30", event: "US CPI (Jan)", impact: "High" },
            { time: "Tomorrow 08:00", event: "ECB Decision", impact: "High" },
            { time: "Friday 15:00", event: "US Jobs Report", impact: "Very High" },
          ].map((item, idx) => (
            <div
              key={idx}
              className={`${THEME.BG_PRIMARY} p-3 rounded-lg border border-slate-600 flex justify-between items-center`}
            >
              <div>
                <p className={`font-semibold ${THEME.TEXT_PRIMARY} text-sm`}>
                  {item.event}
                </p>
                <p className={`${THEME.TEXT_SECONDARY} text-xs`}>{item.time}</p>
              </div>
              <span
                className={`px-2 py-1 rounded text-xs font-semibold ${
                  item.impact === "High"
                    ? "bg-yellow-500/20 text-yellow-400"
                    : "bg-rose-500/20 text-rose-400"
                }`}
              >
                {item.impact}
              </span>
            </div>
          ))}
        </div>

        <p className={`text-xs ${THEME.TEXT_SECONDARY} mt-4 p-3 bg-slate-800/50 rounded`}>
          💡 Tip: Avoid trading during high-impact economic announcements to reduce volatility shock
        </p>
      </div>

      {/* Trading Insights */}
      <div className={`${THEME.BG_SECONDARY} rounded-lg p-6 border border-slate-700 shadow-lg`}>
        <h3 className={`text-lg font-semibold ${THEME.TEXT_PRIMARY} mb-4`}>
          🎯 Technical Insights
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`font-semibold ${THEME.TEXT_PRIMARY} mb-2`}>
              EMA Trading
            </p>
            <ul className={`${THEME.TEXT_SECONDARY} text-xs space-y-1`}>
              <li>• EMA(20) = Fast trend line</li>
              <li>• EMA(50) = Medium trend line</li>
              <li>• Golden Cross = Bullish signal</li>
              <li>• Death Cross = Bearish signal</li>
            </ul>
          </div>

          <div className={`${THEME.BG_PRIMARY} p-4 rounded-lg border border-slate-600`}>
            <p className={`font-semibold ${THEME.TEXT_PRIMARY} mb-2`}>
              RSI Signals
            </p>
            <ul className={`${THEME.TEXT_SECONDARY} text-xs space-y-1`}>
              <li>• RSI &lt; 30 = Oversold (Buy signal)</li>
              <li>• RSI &gt; 70 = Overbought (Sell signal)</li>
              <li>• RSI Divergence = Potential reversal</li>
              <li>• Default: 14-period RSI</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketAnalysis;

