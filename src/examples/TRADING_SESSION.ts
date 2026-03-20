/**
 * Example: Complete Trading Session
 * Shows how to use the app end-to-end
 */

// ============================================
// SCENARIO: Day Trading EUR/USD on $100 Account
// ============================================

/**
 * STEP 1: Calculate Position Size
 * ================================
 * Use the Risk Calculator component:
 * 
 * Balance: $100
 * Stop Loss: 40 pips (tight for Micro accounts)
 * Risk: 1% ($1)
 * 
 * Formula: LotSize = (Balance × Risk%) / (SL_Pips × Pip_Value)
 * 
 * With 0.01 Micro = $0.001/pip:
 * LotSize = (100 × 1) / (40 × 0.10) = 0.25 Micro Lots
 * 
 * Recommended: 0.25 Micro Lots (round to 0.01 increments)
 */

const EXAMPLE_TRADE_1 = {
  asset: "EURUSD",
  trade_type: "Buy",
  entry_price: 1.0850,
  stop_loss: 1.0810, // 40 pips
  take_profit: 1.0900, // 50 pips (Risk/Reward 1:1.25)
  lot_size: 0.25, // As calculated
  emotional_state: "Confident", // You feel good about this
  reasoning: `
    Technical Confluence:
    - EMA(20) just crossed above EMA(50) = Golden Cross
    - RSI at 45 = Room to move up
    - Price touched 1.0800 support
    - London session starting = increasing volatility
    
    Market Context:
    - ECB decision yesterday (risk off priced in)
    - No major USD data today
    
    Risk/Reward: 1:1.25 (acceptable)
    Max Loss: $1 (1% of $100)
  `,
  is_closed: false, // Will update later when trade closes
};

/**
 * STEP 2: Log Trade (Via Trade Journal)
 * =====================================
 * You would fill this in the UI form:
 * - Click "+ New Trade"
 * - Fill all fields
 * - Click "Log Trade"
 * 
 * Now it's saved to Supabase!
 */

/**
 * STEP 3: Monitor Trade
 * ====================
 * The Dashboard shows:
 * - 1 open position in Portfolio Manager
 * - Margin Used: (0.25 × 1000 × 1.0850) / 1000 = ~0.27 USD
 * - Margin Usage: 0.27% (super safe!)
 */

/**
 * STEP 4: Trade Closes (Wins!)
 * =============================
 * Price reaches 1.09000 = Take Profit hits
 * 
 * Calculation:
 * - Entry: 1.0850
 * - Exit: 1.0900
 * - Pips: (1.0900 - 1.0850) × 10000 = 50 pips
 * - PnL: 50 pips × 0.25 Micro × $0.10 = $1.25
 * - Win! 🎉
 */

const EXAMPLE_TRADE_1_CLOSED = {
  ...EXAMPLE_TRADE_1,
  is_closed: true,
  closed_at: new Date().toISOString(),
  pips_gained: 50,
  pnl_usd: 1.25, // Win!
};

/**
 * STEP 5: Check Dashboard Metrics
 * ================================
 * After this trade closes:
 * 
 * - Total PnL: $1.25 ✅
 * - Current Balance: $101.25 (up from $100)
 * - Win Rate: 100% (1 win, 0 losses)
 * - Profit Factor: ∞ (no losses yet)
 * - Account Growth: +1.25%
 */

/**
 * STEP 6: Second Trade (Loses)
 * =============================
 * Same setup, different outcome:
 * Entry: 1.0850
 * Exit: 1.0810 (Stop Loss hit)
 * Pips: -40 pips
 * PnL: -$1.00
 */

const EXAMPLE_TRADE_2_CLOSED = {
  asset: "EURUSD",
  trade_type: "Sell",
  entry_price: 1.0900,
  stop_loss: 1.0940, // 40 pips
  take_profit: 1.0750, // 150 pips
  lot_size: 0.25,
  emotional_state: "Anxious", // Nervous about this one
  reasoning: `
    - Reversal from 1.0900 resistance
    - RSI > 70 (overbought)
    - Waiting for EMA death cross
    - Tried anyway (ERROR!)
  `,
  is_closed: true,
  closed_at: new Date().toISOString(),
  pips_gained: -40, // Loss
  pnl_usd: -1.0, // Lost 1%
};

/**
 * STEP 7: Updated Dashboard
 * ==========================
 * After 2 trades (1 win, 1 loss):
 * 
 * - Total PnL: $0.25 ($1.25 - $1.00)
 * - Current Balance: $100.25 (slightly up!)
 * - Win Rate: 50% (1W / 2T) ✓ Target hit!
 * - Profit Factor: 1.25x ($1.25 revenue / $1.00 loss)
 * - Account Growth: +0.25%
 * 
 * Status: Breakeven is GOOD at start!
 * Emotional Learning: Trade 2 loss came from emotion (Anxious)
 */

/**
 * STEP 8: Review Session
 * ======================
 * Weekly Review (Sunday evening):
 * 
 * Questions to ask:
 * 1. Which trade had better reasoning?
 *    → Trade 1 (golden cross) > Trade 2 (reversal guess)
 * 
 * 2. Did emotions affect decision quality?
 *    → Yes! Trade 2 was Anxious (should wait for confidence)
 * 
 * 3. Is my risk management working?
 *    → YES! Max loss capped at 1% each time
 * 
 * 4. What to improve next week?
 *    → Wait for high probability setups (EMA crosses)
 *    → Never trade when anxious
 *    → Stick to golden cross strategy
 */

/**
 * STEP 9: Compound Growth
 * =======================
 * If you continue 1:1 ratio (50% win rate):
 * - Trade 3: +$1.00 = $101.25
 * - Trade 4: -$0.75 = $100.50
 * - Trade 5: +$1.25 = $101.75
 * - Trade 6: -$0.50 = $101.25
 * 
 * After just 6 trades at 50% win rate:
 * Account: $100 → $101.25 (+1.25%)
 * 
 * This is compound growth!
 * After 50 trades: potentially $110+ (10% growth)
 * After 200 trades: potentially $125+ (25% growth)
 * 
 * But DON'T withdraw! Reinvest profits = exponential growth
 */

/**
 * CRITICAL RULES
 * ==============
 * 
 * 1. NEVER violate 1% risk rule
 *    → Max lot size = (Balance × 1%) / (SL_Pips × Pip_Value)
 * 
 * 2. ALL trades need written reasoning
 *    → Prevents emotional trading
 *    → Creates trading journal for review
 * 
 * 3. Track emotional state
 *    → Identify patterns (emotional trades = losses)
 *    → Train yourself to only trade when confident
 * 
 * 4. Profit factor must stay > 1.0
 *    → If not, your strategy doesn't work
 *    → Back to paper trading
 * 
 * 5. Margin usage < 50%
 *    → Protects from margin call/liquidation
 *    → Gives room for trades to breathe
 */

/**
 * PORTFOLIO MANAGER EXAMPLE
 * =========================
 * If you had 3 open trades:
 * 
 * Trade 1: 0.25 Micro EURUSD @ 1.0850
 *   Margin: (0.25 × 1000 × 1.0850) / 1000 = ~0.27
 * 
 * Trade 2: 0.10 Micro Gold @ 1950
 *   Margin: (0.10 × 1000 × 1950) / 1000 = ~19.50
 * 
 * Trade 3: 0.05 Micro GBPUSD @ 1.2700
 *   Margin: (0.05 × 1000 × 1.2700) / 1000 = ~0.06
 * 
 * Total Margin Used: ~19.83 (19.83% of $100)
 * Margin Available: ~80.17
 * Status: ✅ SAFE (< 50%)
 */

/**
 * ADVANCED: Lot Size Based on Emotional State
 * ============================================
 * 
 * Confident: 0.25 Micro (full size)
 * Neutral: 0.15 Micro (60% size)
 * Anxious: 0.05 Micro (20% size)
 * Fearful: SKIP THIS TRADE (no size)
 * 
 * This prevents emotional trading:
 * - Trading when fearful → smaller position
 * - Trading when confident → full risk
 * - Best trades come when confident!
 */

export {
  EXAMPLE_TRADE_1,
  EXAMPLE_TRADE_1_CLOSED,
  EXAMPLE_TRADE_2_CLOSED,
};
