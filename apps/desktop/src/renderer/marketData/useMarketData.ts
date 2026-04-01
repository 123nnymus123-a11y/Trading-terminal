import { useMemo } from "react";
import { useStreamStore } from "../store/streamStore";

/**
 * Returns { [symbol]: lastPriceNumber } for simple consumption.
 */
export function useMarketData(): Record<string, number> {
  const lastPrices = useStreamStore((s) => s.lastPrices);

  return useMemo(() => {
    const out: Record<string, number> = {};
    for (const [sym, v] of Object.entries(lastPrices)) out[sym] = v.price;
    return out;
  }, [lastPrices]);
}
