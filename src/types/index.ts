/**
 * TypeScript Types for Trading Dashboard
 */

export interface Trade {
  id: string;
  user_id: string;
  asset: string;
  trade_type: "Buy" | "Sell";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  lot_size: number;
  pnl_usd: number | null;
  pips_gained: number | null;
  emotional_state: string;
  reasoning: string;
  created_at: string;
  closed_at: string | null;
  is_closed: boolean;
  close_price?: number | null;
  close_reason?: string | null;
  close_source?: "SL_TRIGGER" | "TP_TRIGGER" | "MANUAL_CLOSE" | "BOT_CLOSE" | null;
  mt4_ticket?: number | null;
  mt4_comment?: string | null;
}

export interface AccountStats {
  id: string;
  user_id: string;
  initial_balance: number;
  current_balance: number;
  total_pnl: number;
  win_count: number;
  loss_count: number;
  updated_at: string;
}

export interface DailySnapshot {
  id: string;
  user_id: string;
  date: string;
  balance_snapshot: number;
  created_at: string;
}

export interface RiskCalculation {
  recommendedLotSize: number;
  riskAmount: number;
  pipValue: number;
  potentialPnL: number;
  rawLotSize: number;
  actualRiskAmount: number;
  minLotApplied: boolean;
}

export interface DashboardMetrics {
  totalPnL: number;
  winRate: number;
  profitFactor: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  currentBalance: number;
  marginUsed: number;
  marginAvailable: number;
}

export interface ChartDataPoint {
  time: number | string;
  value: number;
}

export interface MarketNews {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;
  sentiment?: string;
}

export interface PortfolioPosition {
  asset: string;
  qty: number;
  entryPrice: number;
  currentPrice: number;
  pnl: number;
  pnlPercent: number;
}
