import { z } from "zod";

export const WatchlistItemSchema = z.object({
  id: z.number().int(),
  symbol: z.string().min(1),
  note: z.string().optional().default(""),
});
export type WatchlistItem = z.infer<typeof WatchlistItemSchema>;

export const LayoutSchema = z.object({
  id: z.number().int(),
  symbol: z.string().min(1).nullable(),
  preset: z.string().min(1),
  data: z.any().nullable(),
});
export type Layout = z.infer<typeof LayoutSchema>;

export const TradeSchema = z.object({
  id: z.number().int(),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  qty: z.number(),
  price: z.number(),
  ts: z.number().int(),
});
export type Trade = z.infer<typeof TradeSchema>;

export const AuditLogSchema = z.object({
  id: z.number().int(),
  ts: z.number().int(),
  actor: z.string().min(1).default("system"),
  action: z.string().min(1),
  detail: z.string().optional().default(""),
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AppSettingsSchema = z.object({
  id: z.number().int(),
  data: z.record(z.string(), z.any()),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export type LayoutPresetSelection = {
  symbol: string;
  preset: string;
};
