import type {
  BrokerAdapter,
  PlaceOrderRequest,
  PlaceOrderResult,
  OrderSide,
} from "./brokerAdapter";

export type OrderStatus = "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";

export interface Order {
  orderId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  type: string;
  limitPrice?: number;
  stopPrice?: number;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  symbol: string;
  qty: number; // negative for short
  avgPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
}

export interface AccountMetrics {
  balance: number;
  equity: number;
  buyingPower: number;
  dailyPnl: number;
  dailyPnlPercent: number;
}

export interface Fill {
  orderId: string;
  symbol: string;
  side: OrderSide;
  qty: number;
  price: number;
  ts: number;
}

export type PaperEvent =
  | { type: "order"; order: Order }
  | { type: "fill"; fill: Fill }
  | { type: "position"; position: Position }
  | { type: "account"; account: AccountMetrics };

export type PaperEventHandler = (event: PaperEvent) => void;

export class PaperTradingAdapter implements BrokerAdapter {
  readonly id = "paper";

  private orders: Map<string, Order> = new Map();
  private positions: Map<string, Position> = new Map();
  private fills: Fill[] = [];
  private eventHandlers: Set<PaperEventHandler> = new Set();
  private orderCounter = 0;

  // Account state
  private initialBalance = 100000; // $100k starting capital
  private realizedPnl = 0;

  // Market prices (updated externally or mocked)
  private marketPrices: Map<string, number> = new Map();

  constructor() {
    // Start periodic account updates
    setInterval(() => this.updateAccountMetrics(), 1000);
  }

  async connect(): Promise<void> {
    console.log("[PaperTradingAdapter] Connected");
  }

  async disconnect(): Promise<void> {
    console.log("[PaperTradingAdapter] Disconnected");
  }

  async placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult> {
    const orderId = `PAPER-${++this.orderCounter}-${Date.now()}`;

    const order: Order = {
      orderId,
      symbol: req.symbol,
      side: req.side,
      qty: req.qty,
      type: req.type,
      ...(req.limitPrice !== undefined && { limitPrice: req.limitPrice }),
      ...(req.stopPrice !== undefined && { stopPrice: req.stopPrice }),
      status: "PENDING",
      filledQty: 0,
      avgFillPrice: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.orders.set(orderId, order);
    this.emit({ type: "order", order });

    // Simulate instant fill for MARKET orders
    if (req.type === "MARKET") {
      setTimeout(() => this.fillOrder(orderId), 50 + Math.random() * 150);
    }

    // For LIMIT orders, check if price is already met
    if (req.type === "LIMIT" && req.limitPrice) {
      setTimeout(() => this.checkLimitOrder(orderId), 100);
    }

    return { orderId, accepted: true };
  }

  async cancelOrder(orderId: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (!order) return false;
    if (order.status === "FILLED") return false;

    order.status = "CANCELLED";
    order.updatedAt = Date.now();
    this.emit({ type: "order", order });
    return true;
  }

  // Event subscription
  onEvent(handler: PaperEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  private emit(event: PaperEvent) {
    this.eventHandlers.forEach((h) => h(event));
  }

  // Update market price (called externally from market data)
  updateMarketPrice(symbol: string, price: number) {
    this.marketPrices.set(symbol, price);
    this.updatePositionPnl(symbol, price);
    this.checkPendingOrders(symbol, price);
  }

  private fillOrder(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.status !== "PENDING") return;

    const marketPrice = this.marketPrices.get(order.symbol) || 100; // fallback
    const fillPrice = order.limitPrice || marketPrice;

    order.status = "FILLED";
    order.filledQty = order.qty;
    order.avgFillPrice = fillPrice;
    order.updatedAt = Date.now();

    this.emit({ type: "order", order });

    const fill: Fill = {
      orderId: order.orderId,
      symbol: order.symbol,
      side: order.side,
      qty: order.qty,
      price: fillPrice,
      ts: Date.now(),
    };
    this.fills.push(fill);
    this.emit({ type: "fill", fill });

    // Update position
    this.updatePosition(order.symbol, order.side, order.qty, fillPrice);
  }

  private checkLimitOrder(orderId: string) {
    const order = this.orders.get(orderId);
    if (!order || order.status !== "PENDING" || !order.limitPrice) return;

    const marketPrice = this.marketPrices.get(order.symbol);
    if (!marketPrice) return;

    // Simple fill logic: buy limit fills if market <= limit, sell limit fills if market >= limit
    const shouldFill =
      (order.side === "BUY" && marketPrice <= order.limitPrice) ||
      (order.side === "SELL" && marketPrice >= order.limitPrice);

    if (shouldFill) {
      this.fillOrder(orderId);
    }
  }

  private checkPendingOrders(symbol: string, _price: number) {
    for (const [orderId, order] of this.orders.entries()) {
      if (order.symbol === symbol && order.status === "PENDING") {
        if (order.type === "LIMIT") {
          this.checkLimitOrder(orderId);
        }
        // TODO: implement STOP and STOP_LIMIT logic
      }
    }
  }

  private updatePosition(
    symbol: string,
    side: OrderSide,
    qty: number,
    price: number
  ) {
    let pos = this.positions.get(symbol);
    if (!pos) {
      pos = {
        symbol,
        qty: 0,
        avgPrice: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
      };
      this.positions.set(symbol, pos);
    }

    const deltaQty = side === "BUY" ? qty : -qty;
    const newQty = pos.qty + deltaQty;

    // Calculate realized PnL on position reduction/reversal
    if (Math.sign(pos.qty) !== Math.sign(newQty) && pos.qty !== 0) {
      const closedQty = Math.min(Math.abs(pos.qty), Math.abs(deltaQty));
      const pnlPerShare =
        side === "SELL" ? price - pos.avgPrice : pos.avgPrice - price;
      const realized = pnlPerShare * closedQty;
      pos.realizedPnl += realized;
      this.realizedPnl += realized;
    }

    // Update average price
    if (Math.sign(newQty) === Math.sign(deltaQty) || pos.qty === 0) {
      // Adding to position or opening new
      const totalCost = pos.avgPrice * Math.abs(pos.qty) + price * qty;
      const totalQty = Math.abs(pos.qty) + qty;
      pos.avgPrice = totalQty > 0 ? totalCost / totalQty : 0;
    }

    pos.qty = newQty;

    // Update unrealized PnL
    const currentPrice = this.marketPrices.get(symbol) || price;
    this.updatePositionPnl(symbol, currentPrice);

    this.emit({ type: "position", position: pos });
  }

  private updatePositionPnl(symbol: string, currentPrice: number) {
    const pos = this.positions.get(symbol);
    if (!pos || pos.qty === 0) return;

    pos.unrealizedPnl = (currentPrice - pos.avgPrice) * pos.qty;
    this.emit({ type: "position", position: pos });
  }

  private updateAccountMetrics() {
    const totalUnrealized = Array.from(this.positions.values()).reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0
    );

    const equity = this.initialBalance + this.realizedPnl + totalUnrealized;
    const dailyPnl = this.realizedPnl + totalUnrealized; // simplified: all PnL is "today"
    const dailyPnlPercent = (dailyPnl / this.initialBalance) * 100;

    const account: AccountMetrics = {
      balance: this.initialBalance + this.realizedPnl,
      equity,
      buyingPower: equity * 4, // 4x leverage example
      dailyPnl,
      dailyPnlPercent,
    };

    this.emit({ type: "account", account });
  }

  // Public getters for UI
  getOrders(): Order[] {
    return Array.from(this.orders.values());
  }

  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getAccount(): AccountMetrics {
    const totalUnrealized = Array.from(this.positions.values()).reduce(
      (sum, p) => sum + p.unrealizedPnl,
      0
    );
    const equity = this.initialBalance + this.realizedPnl + totalUnrealized;
    const dailyPnl = this.realizedPnl + totalUnrealized;
    const dailyPnlPercent = (dailyPnl / this.initialBalance) * 100;

    return {
      balance: this.initialBalance + this.realizedPnl,
      equity,
      buyingPower: equity * 4,
      dailyPnl,
      dailyPnlPercent,
    };
  }
}
