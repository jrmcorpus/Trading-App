# Trading Dashboard - XM Micro Account Edition

A comprehensive, professional-grade trading dashboard built specifically for XM Ultra Low Micro accounts ($50-$100 balance). Features real-time risk management, trade journal, market analysis, and portfolio tracking with intelligent position sizing.

## 🎯 Features

### Core Features
- **Dashboard**: Real-time metrics (PnL, Win Rate %, Profit Factor, Account Growth)
- **Trade Journal**: Log trades with emotional state tracking and mandatory reasoning
- **Risk Calculator**: Smart lot size calculator using 1% risk rule
- **Market Analysis**: Live news, trading signals, and economic calendar
- **Portfolio Manager**: Real-time margin monitoring (1:1000 leverage)

### XM Micro Specific
- ✅ 1 Micro Lot = 1,000 units
- ✅ Pip Value: $0.10 per pip (1.0 Micro) / $0.001 per pip (0.01 Micro)
- ✅ Default 1% risk per trade for capital protection
- ✅ Margin calculations for 1:1000 leverage
- ✅ Support for accounts from $50-$100

## 🏗️ Tech Stack

- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Charts**: Lightweight Charts (TradingView compatible)
- **Database**: Supabase/PostgreSQL with RLS
- **Build**: Vite (⚡ Lightning fast)
- **Charts Indicators**: EMA (20, 50) + RSI (14) ready

## 📦 Project Structure

```
Trading-App/
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx          # Performance metrics & charts
│   │   ├── RiskCalculator.tsx     # Lot size calculator
│   │   ├── TradingJournal.tsx     # Trade logging & analysis
│   │   ├── MarketAnalysis.tsx     # News & trading signals
│   │   └── PortfolioManager.tsx   # Margin & position tracking
│   ├── utils/
│   │   ├── constants.ts           # XM-specific constants
│   │   └── calculations.ts        # Risk/PnL calculations
│   ├── types/
│   │   └── index.ts               # TypeScript interfaces
│   ├── App.tsx                    # Main layout with sidebar
│   ├── index.tsx                  # React entry point
│   └── index.css                  # Global styles
├── db/
│   └── schema.sql                 # Supabase SQL schema
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
├── index.html
└── README.md
```

## 🚀 Getting Started

### Prerequisites
- Node.js 16+ (recommend 18+)
- npm or yarn
- Supabase account (free tier works)

### Installation

1. **Clone and install dependencies**
```bash
cd Trading-App
npm install
```

2. **Set up environment variables**
```bash
cp .env.example .env.local
# Edit .env.local with your Supabase credentials
```

3. **Create Supabase project**
   - Go to https://supabase.com
   - Create new project
   - Run SQL from `db/schema.sql` in Supabase SQL editor
   - Copy project URL and anon key to `.env.local`

4. **Start development server**
```bash
npm run dev
```

Server runs on `http://localhost:3000`

### One-Click Startup

If you want one shortcut that starts everything needed for the app:

```bash
npm run app:up
```

What it does:
- installs `node_modules` automatically if missing
- creates `.env.local` from `.env.example` if needed
- starts Docker dependencies only if a compose file exists in this repo
- starts the MT4 bridge on `http://127.0.0.1:8787`
- starts the Vite app on `http://127.0.0.1:3000`
- writes logs to `logs/` and PID files to `pids/`

Windows double-click shortcuts are also included:
- `Run-Trading-App.cmd`
- `Stop-Trading-App.cmd`

To stop everything from the terminal:

```bash
npm run app:down
```

### Build for Production
```bash
npm run build
npm run preview  # Test production build
```

## MT4/XM Live Candles (Optional)

For non-crypto pairs, you can stream candles from your local logged-in XM MT4 terminal using the included local bridge.

1. In MT4, open `MetaEditor` and add/compile:
It will export CSV candles to your MT4 `MQL4/Files` folder.

3. Set `.env` value:
`MT4_BRIDGE_FILES_DIR=<your MT4 MQL4\\Files path>`

4. Start bridge:
```bash
c
```

5. In another terminal, run app:
```bash
npm run dev
```

When connected, chart header should show `Source MT4` for forex/metal/oil pairs.

### MT4 Execution EA (Recommended)
- Use `mt5_bridge/MT4_Execution_EA.mq4` as the single EA for:
  - exports (candles/ticks/account/history)
  - manual bridge command execution
  - optional auto-trading with strict policy rules
- Do not run `MT4_Candle_Exporter.mq4` at the same time (same file outputs).
- Full documentation:
  - `mt5_bridge/MT4_EXECUTION_EA_GUIDE.md`

### MT4-Only Mode (Phase 1)
- Set `VITE_MT4_ONLY=true` to force chart data to use MT4 bridge as primary source for all symbols.
- If MT4 has insufficient bars for a symbol/timeframe, the app will only use external fallback when `VITE_MT4_ONLY=false`.

### Guarded Trading API (Phase 2)
Bridge endpoints for controlled trading from app/backend:
- `POST /api/mt4/orders/prepare`
- `POST /api/mt4/orders/confirm`
- `GET /api/mt4/orders/open`
- `GET /api/mt4/market-intel?symbols=EURUSD,GOLD,BTCUSD&limit=6` (watchlist news/catalyst feed)
- `GET /health` (bridge version + capabilities; used by UI startup compatibility badge)

Flow:
1. Call `prepare` with order payload (`PLACE`, `CLOSE`, `MODIFY`).
2. Receive `requestId` + `confirmToken`.
3. Call `confirm` with both values to execute.

Safety controls (env):
- `MT4_MAX_LOT_PER_ORDER`
- `MT4_REQUIRE_SL_TP`
- `MT4_ALLOWED_SYMBOLS`
- `VITE_MT4_ALLOWED_SYMBOLS` (optional frontend mirror for setup conflict checks)
- `MT4_CONFIRM_TTL_MS`
- `VITE_BROKER_WEEK_OPEN_UTC` / `VITE_BROKER_WEEK_CLOSE_UTC` (non-crypto auto-trade window, UTC)
- `VITE_BROKER_DAILY_BREAK_START_UTC` / `VITE_BROKER_DAILY_BREAK_END_UTC` (non-crypto daily maintenance break, UTC)
- `VITE_AUTO_SESSION_WINDOW_ENABLED`
- `VITE_AUTO_SESSION_WINDOW_TZ`
- `VITE_AUTO_SESSION_WINDOW_START` / `VITE_AUTO_SESSION_WINDOW_END`
- `VITE_AUTO_SESSION_WINDOW_INCLUDE_CRYPTO`

## 📊 Key Components Explained

### RiskCalculator Component
The heart of capital protection. Uses the formula:
```
LotSize = (Balance × Risk%) / (SL_Pips × Pip_Value)
```

**Example for $100 balance:**
- Risk: 1% = $1
- Stop Loss: 50 pips
- Pip Value (1.0 μ): $0.10
- Recommended Lot: 0.20 Micro Lots

### Dashboard Metrics
- **Total PnL**: Sum of all closed trade profits/losses
- **Win Rate %**: (Wins / Total Trades) × 100
- **Profit Factor**: Total Revenue / Total Loss (Target: >1.5x)
- **Account Growth %**: (Current Balance - Initial) / Initial × 100

### Margin Calculation
For 1:1000 leverage:
```
Margin Required = (Position Size × 1,000 units × Price) / 1,000
```

Safe usage: **< 50%**  
Warning: **50-80%**  
Critical: **> 80%**

## 🎨 Dark Theme Colors

| Element | Color | Purpose |
|---------|-------|---------|
| Background | Slate-900 | Primary background |
| Secondary | Slate-800 | Cards & components |
| Profit | Emerald-400 | Winning trades |
| Loss | Rose-500 | Losing trades |
| Accent | Blue-400 | Metrics & info |

## 📚 Trading Specifications

### Emotional States
Track your mindset with predefined states:
- Confident, Anxious, Neutral, Greedy, Fearful, Focused

### Technical Indicators (Ready to implement)
- **EMA(20)**: Fast-moving average
- **EMA(50)**: Medium-term trend
- **RSI(14)**: Momentum oscillator
- **Overbought**: RSI > 70
- **Oversold**: RSI < 30

### Risk Management Rules
```javascript
- Max daily loss: 2% of balance
- Consecutive loss limit: 3 trades
- Recommended win rate: ≥ 50%
- Minimum profit factor: 1.5x
- Default risk per trade: 1%
```

## 🔐 Security Features

- **Row Level Security (RLS)**: Each user sees only their data
- **Auth Integration**: Ready for Supabase Auth
- **Encrypted Storage**: Sensitive data encrypted in DB
- **API Keys**: Environment variables only

## 🎯 Usage Examples

### Log a Trade
1. Navigate to "Trade Journal"
2. Click "+ New Trade"
3. Fill form:
   - Asset: EURUSD
   - Type: Buy
   - Entry: 1.08500
   - SL: 1.08000 (50 pips)
   - TP: 1.09000
   - Lot Size: 0.20
   - Reasoning: "EMA golden cross + RSI above 50"
   - Emotional State: Confident
4. Submit

### Calculate Position Size
1. Navigate to "Risk Calculator"
2. Set Stop Loss: 50 pips
3. Risk %: 1.0% (safest)
4. See recommended 0.20 Micro Lots
5. Ready to trade!

### Monitor Margin
1. Navigate to "Portfolio"
2. See live margin usage %
3. Green = Safe (<50%)
4. Yellow = Warning (50-80%)
5. Red = Danger (>80%)

## 📈 Next Steps to Enhance

- [ ] Connect to Lightweight Charts with live data
- [ ] Integrate Finnhub/Alpha Vantage APIs
- [ ] Add authentication (Supabase Auth)
- [ ] Implement price feeds from forex brokers
- [ ] Add PDF export for trade analysis
- [ ] Mobile responsive improvements
- [ ] Dark mode toggle (optional)
- [ ] Advanced charting with indicators
- [ ] WebSocket for real-time updates
- [ ] Backtesting module

## 🐛 Troubleshooting

### Charts Not Showing
- Ensure Lightweight Charts is installed: `npm list lightweight-charts`
- Check console for errors

### Database Errors
- Verify Supabase credentials in `.env.local`
- Run `db/schema.sql` in Supabase SQL editor
- Check RLS policies are enabled

### Performance Issues
- Clear browser cache
- Check React DevTools Profiler
- Reduce trades data load for large accounts

## 📄 License

MIT - Free to use and modify

## 🤝 Contributing

Fork and submit PRs. Issues welcome!

## 📞 Support

- Trading Help: Check "Market Analysis" for educational resources
- Code Issues: GitHub Issues
- Supabase Issues: Supabase Support

---

**Remember**: This dashboard is a tool, not a trading system. Markets are unpredictable. Always trade with capital you can afford to lose. Use stop losses religiously. Never risk more than 1-2% per trade.

Happy Trading! 🚀
