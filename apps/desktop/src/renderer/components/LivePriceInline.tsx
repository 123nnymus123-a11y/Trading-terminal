import React from "react";
import { useMarketData } from "../marketData/useMarketData";

export function LivePriceInline(props: { symbol?: string }) {
  const symbol = props.symbol ?? "AAPL";
  const prices = useMarketData();
  const p = prices[symbol];

  return (
    <span style={{ marginLeft: 12, opacity: 0.95 }}>
      {symbol}: {typeof p === "number" ? p.toFixed(2) : "--"}
    </span>
  );
}
