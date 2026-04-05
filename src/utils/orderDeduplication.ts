/**
 * Order Deduplication System
 * Prevents duplicate orders from being sent for the same symbol
 * Tracks pending orders and enforces cooldowns
 */

export interface PendingOrder {
  symbol: string;
  action: string; // PLACE, CLOSE, MODIFY
  side?: string; // BUY, SELL
  price?: number;
  timestamp: number;
  orderKey: string; // Unique identifier for this order
}

export interface OrderDeduplicationConfig {
  cooldownMs: number; // Minimum time between orders for same symbol
  enabled: boolean;
}

const DEFAULT_CONFIG: OrderDeduplicationConfig = {
  cooldownMs: 5 * 60 * 1000, // 5 minutes cooldown between same symbol
  enabled: true,
};

/**
 * Order Deduplication Manager
 * Prevents duplicate orders for the same symbol
 */
export class OrderDeduplicator {
  private pendingOrders: Map<string, PendingOrder[]> = new Map();
  private lastOrderBySymbol: Map<string, PendingOrder> = new Map();
  private config: OrderDeduplicationConfig;

  constructor(config: Partial<OrderDeduplicationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate unique order key based on symbol, action, and details
   */
  private generateOrderKey(
    symbol: string,
    action: string,
    side?: string,
    price?: number
  ): string {
    const parts = [symbol, action, side || "", price || ""].filter(Boolean);
    return parts.join(":").toLowerCase();
  }

  /**
   * Check if an order would be a duplicate
   * Returns reason if duplicate, null if allowed
   */
  canPlaceOrder(
    symbol: string,
    action: string,
    side?: string,
    price?: number
  ): string | null {
    if (!this.config.enabled) {
      return null; // Deduplication disabled
    }

    this.cleanup(Math.max(this.config.cooldownMs, 60 * 1000));

    const orderKey = this.generateOrderKey(symbol, action, side, price);
    const pending = this.pendingOrders.get(symbol) || [];

    // Check 1: Is this exact same order already pending?
    const exactDuplicate = pending.find((o) => o.orderKey === orderKey);
    if (exactDuplicate) {
      const ageSec = (Date.now() - exactDuplicate.timestamp) / 1000;
      return `Duplicate order pending for ${symbol}: same ${action} already sent ${ageSec.toFixed(0)}s ago`;
    }

    // Check 2: Are we within cooldown period for this symbol?
    const lastOrder = this.lastOrderBySymbol.get(symbol);
    if (lastOrder) {
      const ageMs = Date.now() - lastOrder.timestamp;
      if (ageMs < this.config.cooldownMs) {
        const remainingSec = Math.ceil((this.config.cooldownMs - ageMs) / 1000);
        return `Symbol ${symbol} on cooldown: ${remainingSec}s remaining (${this.config.cooldownMs / 1000}s cooldown)`;
      }
    }

    return null; // Order is allowed
  }

  /**
   * Register an order as sent
   */
  registerOrder(symbol: string, action: string, side?: string, price?: number): void {
    const orderKey = this.generateOrderKey(symbol, action, side, price);
    const order: PendingOrder = {
      symbol,
      action,
      side,
      price,
      timestamp: Date.now(),
      orderKey,
    };

    if (!this.pendingOrders.has(symbol)) {
      this.pendingOrders.set(symbol, []);
    }

    this.pendingOrders.get(symbol)!.push(order);
    this.lastOrderBySymbol.set(symbol, order);
  }

  /**
   * Clear/remove an order as filled or cancelled
   */
  clearOrder(symbol: string, orderKey?: string): void {
    if (!this.pendingOrders.has(symbol)) {
      return;
    }

    if (orderKey) {
      // Remove specific order
      const orders = this.pendingOrders.get(symbol)!;
      const idx = orders.findIndex((o) => o.orderKey === orderKey);
      if (idx >= 0) {
        orders.splice(idx, 1);
      }
      if (orders.length === 0) {
        this.pendingOrders.delete(symbol);
      }
    } else {
      // Clear all orders for symbol
      this.pendingOrders.delete(symbol);
    }
  }

  /**
   * Clear all orders for a symbol (after fill or failure)
   */
  clearSymbol(symbol: string): void {
    this.pendingOrders.delete(symbol);
  }

  /**
   * Get all pending orders for a symbol
   */
  getPendingOrders(symbol: string): PendingOrder[] {
    return this.pendingOrders.get(symbol) || [];
  }

  /**
   * Get all pending orders across all symbols
   */
  getAllPendingOrders(): PendingOrder[] {
    const all: PendingOrder[] = [];
    this.pendingOrders.forEach((orders) => {
      all.push(...orders);
    });
    return all;
  }

  /**
   * Get statistics about pending orders
   */
  getStats(): {
    totalPending: number;
    symbolsWithPending: number;
    ordersByAction: Record<string, number>;
  } {
    const allOrders = this.getAllPendingOrders();
    const ordersByAction: Record<string, number> = {};

    allOrders.forEach((order) => {
      ordersByAction[order.action] = (ordersByAction[order.action] || 0) + 1;
    });

    return {
      totalPending: allOrders.length,
      symbolsWithPending: this.pendingOrders.size,
      ordersByAction,
    };
  }

  /**
   * Clean up old orders (older than specified age)
   */
  cleanup(maxAgeMs: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    this.pendingOrders.forEach((orders, symbol) => {
      const filtered = orders.filter((order) => now - order.timestamp < maxAgeMs);
      if (filtered.length < orders.length) {
        removed += orders.length - filtered.length;
      }
      if (filtered.length === 0) {
        this.pendingOrders.delete(symbol);
      } else {
        this.pendingOrders.set(symbol, filtered);
      }
    });

    this.lastOrderBySymbol.forEach((order, symbol) => {
      if (now - order.timestamp >= this.config.cooldownMs) {
        this.lastOrderBySymbol.delete(symbol);
      }
    });

    return removed;
  }

  /**
   * Enable/disable deduplication
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Update cooldown period
   */
  setCooldown(cooldownMs: number): void {
    this.config.cooldownMs = cooldownMs;
  }

  /**
   * Log pending orders for debugging
   */
  logPendingOrders(): void {
    const stats = this.getStats();
    console.group("📋 Pending Orders");
    console.log("Total:", stats.totalPending);
    console.log("Symbols with pending:", stats.symbolsWithPending);
    console.log("By action:", stats.ordersByAction);

    const all = this.getAllPendingOrders();
    if (all.length > 0) {
      console.table(
        all.map((o) => ({
          symbol: o.symbol,
          action: o.action,
          side: o.side || "-",
          price: o.price ? o.price.toFixed(2) : "-",
          age: `${((Date.now() - o.timestamp) / 1000).toFixed(0)}s`,
        }))
      );
    }
    console.groupEnd();
  }
}

/**
 * Global singleton instance
 */
let globalDeduplicator: OrderDeduplicator | null = null;

export function getGlobalDeduplicator(): OrderDeduplicator {
  if (!globalDeduplicator) {
    globalDeduplicator = new OrderDeduplicator({
      cooldownMs: 5 * 60 * 1000, // 5 minute coodn
      enabled: true,
    });
  }
  return globalDeduplicator;
}

export function resetGlobalDeduplicator(): void {
  if (globalDeduplicator) {
    globalDeduplicator = null;
  }
}
