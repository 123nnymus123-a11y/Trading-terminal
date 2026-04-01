import { useEffect } from "react";
import { useTradingStore } from "../store/tradingStore";

export function useTrading() {
  const { updateOrder, addFill, updatePosition, setAccount } = useTradingStore();

  useEffect(() => {
    const unsubscribe = window.cockpit?.trading?.onEvent?.((event) => {
      switch (event.type) {
        case "order":
          updateOrder(event.order);
          break;
        case "fill":
          addFill(event.fill);
          break;
        case "position":
          updatePosition(event.position);
          break;
        case "account":
          setAccount(event.account);
          break;
      }
    });

    // Initial load
    Promise.all([
      window.cockpit?.trading?.getOrders?.(),
      window.cockpit?.trading?.getPositions?.(),
      window.cockpit?.trading?.getAccount?.(),
    ]).then(([orders, positions, account]) => {
      if (orders) orders.forEach((o) => updateOrder(o));
      if (positions) positions.forEach((p) => updatePosition(p));
      if (account) setAccount(account);
    });

    return unsubscribe;
  }, [updateOrder, addFill, updatePosition, setAccount]);

  const placeOrder = async (req: {
    symbol: string;
    side: "BUY" | "SELL";
    qty: number;
    type: string;
    limitPrice?: number;
    stopPrice?: number;
    tif?: string;
  }) => {
    return window.cockpit?.trading?.placeOrder?.(req);
  };

  const cancelOrder = async (orderId: string) => {
    return window.cockpit?.trading?.cancelOrder?.(orderId);
  };

  return { placeOrder, cancelOrder };
}
