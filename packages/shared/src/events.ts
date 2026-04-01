import { z } from "zod";
import { IndicatorUpdateSchema } from "./indicators.js";
import {
  AlphaSignalSchema,
  CapitalMomentumSignalSchema,
  RegimeUpdateSchema,
} from "./strategy.js";

export const eventSourceSchema = z.enum(["demo", "replay", "live"]);
export type EventSource = z.infer<typeof eventSourceSchema>;

export const heartbeatEventSchema = z.object({
  type: z.literal("system.heartbeat"),
  ts: z.number(),
  seq: z.number(),
  source: eventSourceSchema.optional().default("demo"),
});
export type HeartbeatEvent = z.infer<typeof heartbeatEventSchema>;

export const marketPrintEventSchema = z.object({
  type: z.literal("market.print"),
  ts: z.number(),
  symbol: z.string().min(1),
  price: z.number(),
  size: z.number().optional().default(0),
  source: eventSourceSchema.optional().default("demo"),
});
export type MarketPrintEvent = z.infer<typeof marketPrintEventSchema>;

export const replayStatusSchema = z.object({
  playing: z.boolean(),
  speed: z.number(),
  cursorTs: z.number(),
  startTs: z.number(),
  endTs: z.number(),
  dataset: z.string(),
});
export type ReplayStatus = z.infer<typeof replayStatusSchema>;

export const replayStateEventSchema = z.object({
  type: z.literal("system.replay.state"),
  ts: z.number(),
  source: z.literal("replay").optional().default("replay"),
  state: replayStatusSchema,
});
export type ReplayStateEvent = z.infer<typeof replayStateEventSchema>;

export const appEventSchema = z.discriminatedUnion("type", [
  heartbeatEventSchema,
  marketPrintEventSchema,
  replayStateEventSchema,
  IndicatorUpdateSchema,
  RegimeUpdateSchema,
  AlphaSignalSchema,
  CapitalMomentumSignalSchema,
]);
export type AppEvent = z.infer<typeof appEventSchema>;

export const appEventBatchSchema = z.array(appEventSchema);
export type AppEventBatch = z.infer<typeof appEventBatchSchema>;

/**
 * Validate an unknown batch coming from IPC/preload.
 * We keep this tolerant: drop invalid events instead of throwing.
 */
export function validateAppEventBatch(input: unknown): AppEvent[] {
  if (!Array.isArray(input)) return [];
  const out: AppEvent[] = [];
  for (const item of input) {
    const parsed = appEventSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
