import { create } from "zustand";

export interface Order {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  type: string;
  limitPrice?: number;
  stopPrice?: number;
  status: "PENDING" | "FILLED" | "CANCELLED" | "REJECTED";
  filledQty: number;
  avgFillPrice: number;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  symbol: string;
  qty: number;
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
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  ts: number;
}

interface TradingState {
  orders: Order[];
  positions: Position[];
  fills: Fill[];
  account: AccountMetrics | null;
  
  // Actions
  setOrders: (orders: Order[]) => void;
  updateOrder: (order: Order) => void;
  addFill: (fill: Fill) => void;
  updatePosition: (position: Position) => void;
  setAccount: (account: AccountMetrics) => void;
}

export const useTradingStore = create<TradingState>((set) => ({
  orders: [],
  positions: [],
  fills: [],
  account: null,

  setOrders: (orders) => set({ orders }),
  
  updateOrder: (order) =>
    set((state) => {
      const existing = state.orders.findIndex((o) => o.orderId === order.orderId);
      if (existing >= 0) {
        const newOrders = [...state.orders];
        newOrders[existing] = order;
        return { orders: newOrders };
      }
      return { orders: [...state.orders, order] };
    }),

  addFill: (fill) => set((state) => ({ fills: [...state.fills, fill] })),

  updatePosition: (position) =>
    set((state) => {
      const existing = state.positions.findIndex((p) => p.symbol === position.symbol);
      if (existing >= 0) {
        const newPositions = [...state.positions];
        newPositions[existing] = position;
        return { positions: newPositions };
      }
      return { positions: [...state.positions, position] };
    }),

  setAccount: (account) => set({ account }),
}));
