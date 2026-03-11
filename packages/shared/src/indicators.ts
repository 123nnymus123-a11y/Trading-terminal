import { z } from "zod";

/**
 * Indicator Definitions & Formulas
 * 
 * OPENING RANGE (OR)
 * - Time window: 5m (configurable, default 5m)
 * - Calculated from first print in session to end of window
 * - OR High: max(price) in window
 * - OR Low: min(price) in window
 * 
 * VWAP (Volume-Weighted Average Price)
 * - Formula: sum(price * qty) / sum(qty) - session-to-date
 * - Slope: linear regression of VWAP over last N bars (10 by default)
 * - Deviation: (price - VWAP) / VWAP * 100 (basis points)
 * 
 * ATR (Average True Range)
 * - True Range = max(high - low, |high - close_prev|, |low - close_prev|)
 * - ATR = SMA of TR over N periods (14 by default)
 * 
 * REALIZED VOLATILITY
 * - Rolling standard deviation of log returns over N periods (20 by default)
 * - Formula: stdev(ln(price_t / price_t-1)) * sqrt(252) for annualized
 */

export const BarSchema = z.object({
  symbol: z.string().min(1),
  ts: z.number().int(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
});
export type Bar = z.infer<typeof BarSchema>;

export const QuoteSchema = z.object({
  symbol: z.string().min(1),
  ts: z.number().int(),
  bid: z.number(),
  ask: z.number(),
  bidSize: z.number().nonnegative(),
  askSize: z.number().nonnegative(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const IndicatorUpdateSchema = z.object({
  type: z.literal("compute.indicator.update"),
  ts: z.number().int(),
  symbol: z.string().min(1),
  openingRange: z
    .object({
      high: z.number(),
      low: z.number(),
      duration: z.number().int(),
      tooltip: z.string(),
    })
    .nullable(),
  vwap: z
    .object({
      value: z.number(),
      slope: z.number(),
      deviation: z.number(),
      tooltip: z.string(),
    })
    .nullable(),
  atr: z
    .object({
      value: z.number(),
      period: z.number().int(),
      tooltip: z.string(),
    })
    .nullable(),
  realizedVol: z
    .object({
      value: z.number(),
      period: z.number().int(),
      annualized: z.number(),
      tooltip: z.string(),
    })
    .nullable(),
  priorDayHLC: z
    .object({
      high: z.number(),
      low: z.number(),
      close: z.number(),
      tooltip: z.string(),
    })
    .nullable(),
});
export type IndicatorUpdate = z.infer<typeof IndicatorUpdateSchema>;
