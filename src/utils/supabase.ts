/**
 * Supabase Initialization and Connection
 * Handles database operations and real-time subscriptions
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Trade, AccountStats, DailySnapshot } from "../types";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Missing Supabase credentials. Using mock data. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local"
  );
}

export const supabase: SupabaseClient = supabaseUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : ({} as SupabaseClient);

/**
 * Trades Table Operations
 */
export const tradesAPI = {
  async getAll(): Promise<Trade[]> {
    if (!supabaseUrl) return [];
    const { data, error } = await supabase
      .from("trades")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) console.error("Error fetching trades:", error);
    return data || [];
  },

  async create(trade: Omit<Trade, "id" | "created_at">): Promise<Trade | null> {
    if (!supabaseUrl) return null;
    const { data, error } = await supabase
      .from("trades")
      .insert([trade])
      .select()
      .single();

    if (error) console.error("Error creating trade:", error);
    return data;
  },

  async update(
    id: string,
    updates: Partial<Trade>
  ): Promise<Trade | null> {
    if (!supabaseUrl) return null;
    const { data, error } = await supabase
      .from("trades")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) console.error("Error updating trade:", error);
    return data;
  },

  async delete(id: string): Promise<boolean> {
    if (!supabaseUrl) return false;
    const { error } = await supabase
      .from("trades")
      .delete()
      .eq("id", id);

    if (error) console.error("Error deleting trade:", error);
    return !error;
  },
};

/**
 * Account Stats Operations
 */
export const accountStatsAPI = {
  async get(): Promise<AccountStats | null> {
    if (!supabaseUrl) return null;
    const { data, error } = await supabase
      .from("account_stats")
      .select("*")
      .single();

    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found
      console.error("Error fetching account stats:", error);
    }
    return data;
  },

  async create(stats: Omit<AccountStats, "id">): Promise<AccountStats | null> {
    if (!supabaseUrl) return null;
    const { data, error } = await supabase
      .from("account_stats")
      .insert([stats])
      .select()
      .single();

    if (error) console.error("Error creating account stats:", error);
    return data;
  },

  async update(
    updates: Partial<AccountStats>
  ): Promise<AccountStats | null> {
    if (!supabaseUrl) return null;
    const { data, error } = await supabase
      .from("account_stats")
      .update(updates)
      .select()
      .single();

    if (error) console.error("Error updating account stats:", error);
    return data;
  },
};

/**
 * Daily Snapshots Operations (for growth tracking)
 */
export const dailySnapshotsAPI = {
  async getAll(): Promise<DailySnapshot[]> {
    if (!supabaseUrl) return [];
    const { data, error } = await supabase
      .from("daily_snapshots")
      .select("*")
      .order("date", { ascending: true });

    if (error) console.error("Error fetching daily snapshots:", error);
    return data || [];
  },

  async create(snapshot: Omit<DailySnapshot, "id">): Promise<DailySnapshot | null> {
    if (!supabaseUrl) return null;
    const { data, error } = await supabase
      .from("daily_snapshots")
      .insert([snapshot])
      .select()
      .single();

    if (error) console.error("Error creating daily snapshot:", error);
    return data;
  },
};

/**
 * Real-time Subscriptions
 */
export const subscriptions = {
  onTradesChange(callback: (trade: Trade) => void) {
    if (!supabaseUrl) return null;
    return supabase
      .channel('trades')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'trades' },
        (payload: any) => {
          callback(payload.new as Trade);
        }
      )
      .subscribe();
  },

  onAccountStatsChange(callback: (stats: AccountStats) => void) {
    if (!supabaseUrl) return null;
    return supabase
      .channel('account_stats')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'account_stats' },
        (payload: any) => {
          callback(payload.new as AccountStats);
        }
      )
      .subscribe();
  },
};
