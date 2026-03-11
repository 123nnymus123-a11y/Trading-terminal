import { z } from "zod";

/**
 * Schema for a congressional trading disclosure record (e.g., STOCK Act PTR filings).
 * These are PUBLIC, DELAYED disclosures - not real-time trading signals.
 */
export const congressionalTradeSchema = z.object({
  id: z.number().int().positive(),
  record_id: z.string().nullable(),
  person_name: z.string().min(1).max(200),
  chamber: z.enum(["House", "Senate"]),
  transaction_date: z.string().datetime(), // ISO 8601
  disclosure_date: z.string().datetime(), // ISO 8601 (when filed/reported)
  transaction_type: z.string().min(1).max(50), // buy, sell, exchange, etc.
  asset_name_raw: z.string().min(1).max(500), // Raw from filing
  ticker_normalized: z.string().max(20).nullable(),
  asset_type: z.enum(["stock", "option", "crypto", "fund", "bond", "other"]),
  amount_range_low: z.number().nonnegative().nullable(),
  amount_range_high: z.number().nonnegative().nullable(),
  amount_currency: z.string().max(10).default("USD"),
  comments_raw: z.string().nullable(),
  source_document_id: z.string().nullable(),
  source_url: z.string().nullable(),
  quality_flag_ticker_match: z.enum(["confident", "ambiguous", "unmatched"]),
  quality_flag_amount: z.enum(["complete", "partial", "missing"]),
  ingestion_timestamp: z.string().datetime(),
  last_updated_timestamp: z.string().datetime(),
});

export type CongressionalTrade = z.infer<typeof congressionalTradeSchema>;

export const insertCongressionalTradeSchema = congressionalTradeSchema.omit({ id: true });
export type InsertCongressionalTrade = z.infer<typeof insertCongressionalTradeSchema>;
