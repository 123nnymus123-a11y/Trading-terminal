import { z } from "zod";

export const StreamSourceSchema = z.enum(["demo", "replay"]);
export type StreamSource = z.infer<typeof StreamSourceSchema>;

export const ReplaySpeedSchema = z.union([
  z.literal(0.5),
  z.literal(1),
  z.literal(2),
  z.literal(5),
]);
export type ReplaySpeed = z.infer<typeof ReplaySpeedSchema>;

export const ReplayRowSchema = z.object({
  ts: z.number().int().nonnegative(), // epoch ms
  symbol: z.string().min(1),
  price: z.number().finite(),
  size: z.number().int().nonnegative(),
});
export type ReplayRow = z.infer<typeof ReplayRowSchema>;

export const ReplayStateSchema = z.object({
  isLoaded: z.boolean(),
  isPlaying: z.boolean(),
  speed: ReplaySpeedSchema,
  startTs: z.number().int().nullable(),
  endTs: z.number().int().nullable(),
  cursorTs: z.number().int().nullable(),
  cursorIndex: z.number().int().nonnegative(),
  rowCount: z.number().int().nonnegative(),
  datasetName: z.string(),
});
export type ReplayState = z.infer<typeof ReplayStateSchema>;

export const ReplayStatusSchema = z.object({
  source: StreamSourceSchema,
  replay: ReplayStateSchema,
});
export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;