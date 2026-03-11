import { z } from "zod";

export type MarketDataChannel =
  | "quotes"
  | "bars"
  | "ticks"
  | "orderbook"
  | "news"
  | "calendar";

export const QuoteSchema = z.object({
  symbol: z.string(),
  bid: z.number(),
  ask: z.number(),
  last: z.number(),
  ts: z.number(),
}).strict();

export const TradePrintSchema = z.object({
  symbol: z.string(),
  price: z.number(),
  size: z.number(),
  ts: z.number(),
}).strict();

export const BarSchema = z.object({
  symbol: z.string(),
  timeframe: z.literal("1m"),
  tsStart: z.number(),
  tsEnd: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
}).strict();

export const MarketDataEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("md.quote"), quote: QuoteSchema }),
  z.object({ type: z.literal("md.print"), print: TradePrintSchema }),
  z.object({ type: z.literal("md.bar"), bar: BarSchema }),
]);

export type MarketDataEvent = z.infer<typeof MarketDataEventSchema>;
