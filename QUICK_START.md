## 🚀 Quick Start Guide

### 30-Second Setup

```bash
# 1. Install dependencies
npm install

# 2. Create .env.local with Supabase credentials
cp .env.example .env.local
# Edit .env.local:
# VITE_SUPABASE_URL=your-project.supabase.co
# VITE_SUPABASE_ANON_KEY=your-anon-key

# 3. Start the app
npm run dev
```

Open `http://localhost:3000` and start trading! 🎉

---

## 📋 First Time Setup (Detailed)

### Step 1: Create Supabase Project

1. Go to [Supabase](https://supabase.com)
2. Click "New Project"
3. Select organization and database region (choose closest to you)
4. Wait for project initialization (~2 min)

### Step 2: Initialize Database

1. Copy entire contents of `db/schema.sql`
2. In Supabase, go to "SQL Editor" → "New query"
3. Paste the SQL and click "Run"
4. Confirm all tables are created

### Step 3: Get API Credentials

1. In Supabase, go to "Settings" → "API"
2. Copy your:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon/public key** → `VITE_SUPABASE_ANON_KEY`

### Step 4: Configure Environment

```bash
# Create .env.local in project root
vi .env.local

# Add these lines:
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...
```

### Step 5: Run Development Server

```bash
npm run dev
```

Navigate to `http://localhost:3000`

---

## 🎯 Using the Dashboard

### Dashboard View
Shows your trading statistics:
- Total PnL from all closed trades
- Win Rate % (wins/total)
- Profit Factor (revenue/loss)
- Account Growth % from start balance
- Real-time margin usage

### Trade Journal View
1. Click **"+ New Trade"**
2. Select Asset (EURUSD, Gold, etc.)
3. Choose Type (Buy/Sell)
4. Enter Entry price (e.g., 1.08500)
5. Set Stop Loss (SL) & Take Profit (TP)
6. Enter Lot Size (e.g., 0.05 for Micro)
7. **IMPORTANT**: Write detailed reasoning
   - Why you entered
   - Technical confluence
   - Market conditions
8. Select Emotional State (tracks psychology)
9. Click "Log Trade"

### Risk Calculator View
1. Set **Stop Loss in Pips** (e.g., 50)
2. Adjust **Risk %** (1% is safest)
3. See recommended lot size
4. Use this size for your next trade

Example:
- Balance: $100
- Stop Loss: 50 pips
- Risk: 1% ($1)
- Recommended: 0.20 Micro Lots

### Portfolio Manager View
- See all open positions
- Track margin usage (should stay <50%)
- Get warnings at 80% usage
- Understand liquidation risk

### Market Analysis View
- Read live market news
- See trading suggestions based on technicals
- Check economic calendar
- Learn EMA and RSI signals

---

## 📊 XM Micro Account Constants

### Account Specs
```
Balance: $50-$100
Leverage: 1:1000
Min Lot: 0.01 Micro (1,000 units)
Max Lot: 100+ Micro
Spread: ~1-2 pips on majors
```

### Pip Values
```
1.00 Micro Lot = $0.10 per pip
0.10 Micro Lot = $0.01 per pip
0.01 Micro Lot = $0.001 per pip
```

### Example Trade
```
Asset: EURUSD
Type: Buy
Entry: 1.08500
SL: 1.08000 (50 pips below)
TP: 1.09000
Lot: 0.20 Micro
Risk: $1 (1% of $100)
```

---

## 🔧 Development Commands

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run type-check

# Lint code
npm run lint
```

---

## 📱 Mobile Support

The dashboard works on mobile but is optimized for desktop. Sidebar collapses on small screens for better space usage.

---

## 🐛 Common Issues & Solutions

### Issue: "Missing Supabase credentials"
**Solution**: Check `.env.local` file exists and has correct values

### Issue: Tables not found in database
**Solution**: Run `db/schema.sql` in Supabase SQL Editor

### Issue: Can't save trades
**Solution**: Check Supabase RLS policies - should allow your auth user

### Issue: Charts not loading
**Solution**: Install Lightweight Charts:
```bash
npm install lightweight-charts
```

### Issue: Port 3000 already in use
**Solution**: Change in `vite.config.ts`:
```typescript
server: {
  port: 3001, // Try different port
}
```

---

## 📚 Next Steps

### Add Live Charts
```bash
npm install lightweight-charts
```
Then integrate in Dashboard component with real broker data

### Add Authentication
Use Supabase Auth to secure user data:
```typescript
import { supabase } from './utils/supabase';
await supabase.auth.signInWithPassword({
  email: 'user@example.com',
  password: 'password'
});
```

### Add Real Market Data
Connect to:
- Finnhub API (free tier available)
- Alpha Vantage API
- Your broker's WebSocket feed

### Add Export Features
Export trades as PDF or CSV for record-keeping:
```bash
npm install jspdf papaparse
```

---

## 💡 Pro Tips

1. **Always log reasoning**: Future you will thank present you
2. **Track emotions**: Emotions > Technical Analysis (80% of the time)
3. **1% risk rule**: NEVER violate. It's your capital protection
4. **Review weekly**: Sunday evening - analyze wins/losses
5. **Keep SL tight**: Micro accounts benefit from small SLs (40-70 pips)
6. **Trade sessions**: Best volatility during London-NY overlap
7. **Account size**: Even $1 profit teaches lessons
8. **Compound**: Use profits to grow account, don't withdraw

---

## 🎓 Learning Resources

### Technical Analysis
- EMA Strategy: [TradingView](https://www.tradingview.com)
- RSI Signals: [School of Trade](https://school.stockcharts.com)
- Risk Management: r/Forex, FX Street

### Trading Psychology
- "Trading in the Zone" - Mark Douglas
- "Market Wizards" - Jack Schwager
- Journal your emotions consistently

---

## 🤝 Getting Help

1. **Code Issues**: Check GitHub/Project Issues
2. **Supabase Help**: Check Supabase Documentation
3. **Trading Help**: Use Market Analysis section
4. **Database Issues**: Verify schema.sql was run correctly

---

## ✅ Checklist Before Live Trading

- [ ] Paper traded 10+ trades successfully
- [ ] Win rate ≥ 50% on historical data
- [ ] Profit factor ≥ 1.5x
- [ ] Never risked >1% per trade
- [ ] Can execute your strategy under pressure
- [ ] Understand all terms (pip, margin, leverage, etc.)
- [ ] Ready to lose account (emotional capital)

---

## 📞 Support Resources

- Supabase Docs: https://supabase.com/docs
- React Docs: https://react.dev
- Tailwind CSS: https://tailwindcss.com/docs
- Vite Guide: https://vitejs.dev/guide/

---

**Remember**: This is a tool for education and paper trading. Live trading with real money involves substantial risk. Only trade with capital you can afford to lose.

Happy Trading! 🚀💰
