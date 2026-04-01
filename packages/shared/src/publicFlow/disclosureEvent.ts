import { z } from "zod";

/**
 * Schema for a public disclosure event (e.g., 13F, Form 4, insider transaction)
 * These are PUBLIC, DELAYED disclosures - not real-time trading signals.
 */
export const disclosureEventSchema = z.object({
  id: z.number().int().positive(),
  source: z.string().min(1).max(100), // e.g., "13F", "Form4", "Mock"
  source_url: z.string().url().nullable(),
  entity_name: z.string().min(1).max(200), // Filer/entity name
  entity_type: z.enum(["institution", "insider", "hedge-fund", "etf", "other"]),
  owner_type: z.enum(["institutional", "insider", "beneficial-owner", "other"]),
  ticker: z.string().min(1).max(20).nullable(),
  asset_name: z.string().min(1).max(200), // Full company/asset name
  action: z.enum(["BUY", "SELL"]),
  tx_date: z.string().datetime(), // ISO 8601 transaction date
  report_date: z.string().datetime(), // ISO 8601 report filing date (typically later than tx_date)
  amount_min: z.number().nonnegative().nullable(), // USD value (min range)
  amount_max: z.number().nonnegative().nullable(),
  sector: z.string().max(100).nullable(),
  industry: z.string().max(200).nullable(),
  confidence: z.number().min(0).max(1), // 0..1 confidence score
  raw_json: z.string().nullable(), // JSON string of original data
  created_at: z.string().datetime(), // ISO 8601
});

export type DisclosureEvent = z.infer<typeof disclosureEventSchema>;

export const insertDisclosureEventSchema = disclosureEventSchema.omit({ id: true });
export type InsertDisclosureEvent = z.infer<typeof insertDisclosureEventSchema>;
