-- Supabase PostgreSQL Schema for Trading Dashboard

-- Create trades table
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid(),
  asset VARCHAR(20) NOT NULL,
  trade_type VARCHAR(10) NOT NULL CHECK (trade_type IN ('Buy', 'Sell')),
  entry_price DECIMAL(10, 5) NOT NULL,
  stop_loss DECIMAL(10, 5) NOT NULL,
  take_profit DECIMAL(10, 5) NOT NULL,
  lot_size DECIMAL(8, 4) NOT NULL,
  pnl_usd DECIMAL(10, 2),
  pips_gained DECIMAL(10, 2),
  emotional_state VARCHAR(50) NOT NULL,
  reasoning TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  closed_at TIMESTAMP,
  is_closed BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create account_stats table
CREATE TABLE IF NOT EXISTS account_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid(),
  initial_balance DECIMAL(10, 2) NOT NULL DEFAULT 100.00,
  current_balance DECIMAL(10, 2) NOT NULL,
  total_pnl DECIMAL(10, 2) DEFAULT 0.00,
  win_count INT DEFAULT 0,
  loss_count INT DEFAULT 0,
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);

-- Create daily_snapshots table for growth tracking
CREATE TABLE IF NOT EXISTS daily_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL DEFAULT auth.uid(),
  date DATE NOT NULL,
  balance_snapshot DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(user_id, date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset);
CREATE INDEX IF NOT EXISTS idx_account_stats_user_id ON account_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_snapshots_user_id ON daily_snapshots(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_snapshots_date ON daily_snapshots(date DESC);

-- Set up Row Level Security (RLS)
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_snapshots ENABLE ROW LEVEL SECURITY;

-- Create policies for trades table
CREATE POLICY "Users can only view their own trades" ON trades
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own trades" ON trades
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own trades" ON trades
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own trades" ON trades
  FOR DELETE USING (auth.uid() = user_id);

-- Create policies for account_stats table
CREATE POLICY "Users can only view their own stats" ON account_stats
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own stats" ON account_stats
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own stats" ON account_stats
  FOR UPDATE USING (auth.uid() = user_id);

-- Create policies for daily_snapshots table
CREATE POLICY "Users can only view their own snapshots" ON daily_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own snapshots" ON daily_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);
