import { z } from "zod";

/**
 * Schema for tracking data ingestion operations for congress activity domain.
 */
export const congressDataIngestionLogSchema = z.object({
  id: z.number().int().positive(),
  log_id: z.string().nullable(),
  domain: z.enum(["congressional_trades", "lobbying", "contracts", "member_metadata"]),
  operation_type: z.enum(["initial_load", "incremental_update", "deduplication"]),
  records_processed: z.number().int().nonnegative(),
  records_inserted: z.number().int().nonnegative(),
  records_updated: z.number().int().nonnegative(),
  records_skipped_duplicate: z.number().int().nonnegative(),
  timestamp_start: z.string().datetime(),
  timestamp_end: z.string().datetime().nullable(),
  status: z.enum(["success", "partial", "failed"]),
  error_messages: z.string().nullable(),
});

export type CongressDataIngestionLog = z.infer<typeof congressDataIngestionLogSchema>;

export const insertCongressDataIngestionLogSchema = congressDataIngestionLogSchema.omit({ id: true });
export type InsertCongressDataIngestionLog = z.infer<typeof insertCongressDataIngestionLogSchema>;
