import { z } from "zod";

/**
 * Schema for federal contract/award/spending records.
 */
export const federalContractSchema = z.object({
  id: z.number().int().positive(),
  record_id: z.string().nullable(),
  recipient_name: z.string().min(1).max(500),
  contractor_name: z.string().min(1).max(500),
  award_amount: z.number().nonnegative().nullable(),
  award_currency: z.string().max(10).default("USD"),
  agency_name: z.string().min(1).max(200),
  award_date: z.string().nullable(),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  naics_code: z.string().nullable(),
  category_description: z.string().nullable(),
  ticker_normalized: z.string().max(20).nullable(),
  contract_reference_id: z.string().nullable(),
  source_url: z.string().nullable(),
  ingestion_timestamp: z.string().datetime(),
  last_updated_timestamp: z.string().datetime(),
});

export type FederalContract = z.infer<typeof federalContractSchema>;

export const insertFederalContractSchema = federalContractSchema.omit({ id: true });
export type InsertFederalContract = z.infer<typeof insertFederalContractSchema>;
