export type OrderSide = "BUY" | "SELL";
export type OrderType = "MARKET" | "LIMIT" | "STOP" | "STOP_LIMIT";

export type PlaceOrderRequest = {
  symbol: string;
  side: OrderSide;
  qty: number;
  type: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  tif?: "DAY" | "GTC";
};

export type PlaceOrderResult = {
  orderId: string;
  accepted: boolean;
  reason?: string;
};

export type BrokerAdapter = {
  id: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  placeOrder(req: PlaceOrderRequest): Promise<PlaceOrderResult>;
  cancelOrder(orderId: string): Promise<boolean>;

  // optional: later
  // getPositions(): Promise<...>
  // getAccount(): Promise<...>
};
