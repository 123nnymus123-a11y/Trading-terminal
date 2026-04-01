import { z } from "zod";

/**
 * Schema for lobbying activity records.
 */
export const lobbyingActivitySchema = z.object({
  id: z.number().int().positive(),
  record_id: z.string().nullable(),
  reporting_entity_name: z.string().min(1).max(500),
  client_name: z.string().min(1).max(500),
  lobbying_amount: z.number().nonnegative().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  issues_topics_raw: z.string().nullable(), // Raw text of issues/topics
  naics_code: z.string().nullable(),
  ticker_normalized: z.string().max(20).nullable(),
  filing_reference_id: z.string().nullable(),
  filing_url: z.string().nullable(),
  ingestion_timestamp: z.string().datetime(),
  last_updated_timestamp: z.string().datetime(),
});

export type LobbyingActivity = z.infer<typeof lobbyingActivitySchema>;

export const insertLobbyingActivitySchema = lobbyingActivitySchema.omit({ id: true });
export type InsertLobbyingActivity = z.infer<typeof insertLobbyingActivitySchema>;
