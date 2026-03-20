# ✅ Setup Checklist - Get Started in 10 Minutes

## 📋 Pre-Setup (1 min)

- [ ] Have Node.js 16+ installed? (`node --version`)
- [ ] Have npm installed? (`npm --version`)
- [ ] Have a Supabase account? (https://supabase.com - free)
- [ ] Have a text editor open (VS Code, WebStorm, etc.)

---

## 🚀 Quick Setup (5 minutes)

### Step 1: Navigate to Project
```bash
cd d:\projects\Trading-App
```

### Step 2: Install Dependencies
```bash
npm install
```
⏱️ Takes ~2-3 minutes  
✅ Creates `node_modules` folder

### Step 3: Create Environment File
```bash
# Windows
copy .env.example .env.local

# Mac/Linux
cp .env.example .env.local
```

### Step 4: Get Supabase Credentials
**In your browser:**
1. Go to https://supabase.com
2. Sign in or create account
3. Click "New Project"
4. Fill form:
   - Name: `trading-dashboard`
   - Password: Create strong password
   - Region: Pick closest to you
5. Wait ~2 min for project creation

**Get Your Credentials:**
1. Project created → Click on it
2. Go to **Settings** → **API**
3. Copy these two values:
   - `Project URL` (looks like: https://xxxxx.supabase.co)
   - `anon / public key` (long string starting with `eyJ...`)

### Step 5: Update .env.local
Open `.env.local` and fill in:
```
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGc...very-long-key...
```

**✅ Save the file**

### Step 6: Setup Database
**In Supabase dashboard:**
1. Go to **SQL Editor**
2. Click **New Query**
3. Open `db/schema.sql` in your editor
4. Copy ALL the SQL code
5. Paste into Supabase SQL Editor
6. Click **Run** button
7. Wait for completion (30 seconds)
8. Check for "Success" message

### Step 7: Start Development Server
```bash
npm run dev
```

You should see:
```
VITE v4.4.0  ready in XXX ms

➜  Local:   http://localhost:3000/
➜  Press h to show help
```

### Step 8: Open in Browser
- Browser should auto-open
- If not, go to: http://localhost:3000
- You should see the Trading Dashboard! 🎉

---

## 🎯 First Steps in App

### Try the Risk Calculator
1. Click **🎯 Risk Calculator** (sidebar)
2. See default values (Stop Loss: 50 pips, Risk: 1%)
3. See recommended lot size: **0.20 Micro Lots** ✅
4. Drag the Stop Loss slider left/right
5. Watch lot size change in real-time
6. This is how you protect your capital! 💰

### Log a Practice Trade
1. Click **📝 Trade Journal** (sidebar)
2. Click **+ New Trade**
3. Fill the form:
   - Asset: EURUSD
   - Type: Buy
   - Entry: 1.08500
   - Stop Loss: 1.08000
   - Take Profit: 1.09000
   - Lot Size: 0.20
   - Emotional State: Confident
   - Reasoning: "Testing the app"
4. Click **Log Trade**
5. See your trade appear in the table! 📊

### Check Your Dashboard
1. Click **📊 Dashboard** (sidebar)
2. See your stats updating:
   - Win Rate: 0% (no closed trades yet)
   - Profit Factor: ∞ (no loss reference)
   - Account Growth: 0%

### View Portfolio Status
1. Click **💼 Portfolio Manager** (sidebar)
2. See your open position:
   - Margin Used: ~0.27 USD (super low!)
   - Margin Available: ~99.73
   - Usage: 0.27% (GREEN - totally safe! ✅)

---

## ⚠️ If Something Goes Wrong

### Issue: "Cannot find module 'react'"
**Solution:**
```bash
# Delete node_modules and reinstall
rm -r node_modules package-lock.json
npm install
```

### Issue: "VITE_SUPABASE_URL is undefined"
**Solution:**
1. Check `.env.local` file exists
2. Check values are copied (no spaces at end)
3. Restart dev server: Ctrl+C then `npm run dev`

### Issue: "Error: Failed to authenticate user"
**Solution:**
1. Verify Supabase URL is correct (no typos)
2. Verify API key matches (copy again if unsure)
3. Check key is public/anonymous (not secret)

### Issue: "Database table 'trades' does not exist"
**Solution:**
1. Go to Supabase SQL Editor
2. Copy `db/schema.sql` again
3. Run the SQL
4. Check for "Success" message
5. Refresh browser (F5)

### Issue: Port 3000 Already in Use
**Solution 1** - Kill process using port:
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# Mac/Linux
lsof -i :3000
kill -9 <PID>
```

**Solution 2** - Use different port:
Edit `vite.config.ts`:
```typescript
server: {
  port: 3001,  // Change this
  open: true,
}
```

### Issue: TypeScript Errors
**Solution:**
```bash
npm run type-check
# Shows all type issues
# Fix them one by one (most have suggestions)
```

---

## 📚 What You Now Have

```
✅ React 18 Frontend
✅ Tailwind CSS Dark Theme  
✅ 5 Complete Components
✅ Risk Management Calculator
✅ Trading Journal with Database
✅ Supabase Backend Ready
✅ TypeScript Strict Mode
✅ Comprehensive Documentation
✅ Examples + Tutorials
```

---

## 🎓 Recommended Learning Path

### Day 1: Exploration (1 hour)
- [ ] Read README.md
- [ ] Read QUICK_START.md
- [ ] Try each dashboard page
- [ ] Log some practice trades

### Day 2: Understanding (1.5 hours)
- [ ] Read PROJECT_INDEX.md
- [ ] Read ARCHITECTURE.md (first half)
- [ ] Look at RiskCalculator.tsx code
- [ ] Look at calculations.ts

### Day 3: Deep Dive (2 hours)
- [ ] Read full ARCHITECTURE.md
- [ ] Understand data flow (App.tsx)
- [ ] Read each component
- [ ] Try modifying colors in constants.ts

### Day 4+: Building (ongoing)
- [ ] Read ROADMAP.md
- [ ] Pick a feature to add
- [ ] Follow patterns from existing code
- [ ] Ask questions in GitHub issues

---

## 🚀 Next: First Real Features to Add

### Easy (30 minutes)
- [ ] Add a new emotional state option
- [ ] Change color theme
- [ ] Add a new major asset pair

### Medium (2-3 hours)
- [ ] Add live price display
- [ ] Add a new risk rule calculation
- [ ] Connect to a real news API

### Hard (1 day)
- [ ] Add authentication (Supabase Auth)
- [ ] Add charts using Lightweight Charts
- [ ] Implement strategy backtesting

---

## 📊 Testing Your Setup

### Run This Command:
```bash
npm run type-check
```

**Expected Output:**
```
(No output means no errors!)
```

If you see errors, they're TypeScript issues to fix.

---

## 🎯 Success Criteria

Your setup is complete when:

- [x] ✅ `npm run dev` starts without errors
- [x] ✅ Browser opens to http://localhost:3000
- [x] ✅ Dashboard loads with sidebar
- [x] ✅ Can add trades to journal
- [x] ✅ Risk Calculator shows lot sizes
- [x] ✅ No console errors (F12 to check)

---

## 💡 Pro Tips

### Tip 1: Hot Reload Magic
When you edit a file, the browser updates automatically! No page refresh needed.

### Tip 2: Console Debugging
Press `F12` → **Console** tab to see errors and logs

### Tip 3: Dark Mode Perfect
The dark theme reduces eye strain during long trading sessions ✨

### Tip 4: TypeScript Help
If you see a red squiggle, hover over it for hints on fixing

### Tip 5: Local Storage
App data is saved in browser storage (localStorage) temporarily. For real storage, implement Supabase in your components.

---

## 🎓 Learning Resources

### Trading Concepts
- [Investopedia: Forex Trading](https://www.investopedia.com/forex)
- [BabyPips: Forex School](https://www.babypips.com/school)
- [School of Trade: Technical Analysis](https://school.stockcharts.com)

### React/TypeScript
- [React Official Tutorial](https://react.dev)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Tailwind CSS Docs](https://tailwindcss.com/docs)

### Supabase
- [Supabase Getting Started](https://supabase.com/docs/guides/getting-started)
- [PostgreSQL Docs](https://www.postgresql.org/docs/)

---

## 🤝 Getting Help

### Common Questions

**Q: Is this safe to use with real money?**  
A: No! This is educational. Use on demo first, then paper trading.

**Q: Can I use with my broker?**  
A: Not yet. You'd need to integrate your broker's API (planned in Phase 2).

**Q: How do I deploy this?**  
A: See deployment section in QUICK_START.md (coming soon)

**Q: Can I run this on mobile?**  
A: Yes, responsive design works on phones!

### Getting Support
1. Check QUICK_START.md troubleshooting section
2. Read PROJECT_INDEX.md for file locations
3. Look at examples in TRADING_SESSION.ts
4. Check browser console for error messages

---

## ⏱️ Time to First Trade: ~15 minutes

1. **Setup** (10 min): Follow steps above
2. **Explore** (3 min): Click around dashboard
3. **Log Trade** (2 min): Fill out trade form

---

## 🎉 Congratulations!

You now have a professional-grade trading dashboard! 

### Next Step?
- [x] Setup complete
- [ ] Explore the code
- [ ] Customize for your needs
- [ ] Add real data source
- [ ] Start paper trading
- [ ] Share to community!

---

**Setup Checklist Created**: February 22, 2026  
**Time to Complete**: ~10 minutes  
**Difficulty**: ⭐⭐☆☆☆ (Very Easy!)  
**Status**: Ready to Use ✨

---

**Questions?** Check PROJECT_INDEX.md for file locations or read the documentation files!
