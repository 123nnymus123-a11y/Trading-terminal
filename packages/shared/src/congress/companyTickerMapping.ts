import { z } from "zod";

/**
 * Schema for mapping company names to ticker symbols across all congress domains.
 */
export const companyTickerMappingSchema = z.object({
  id: z.number().int().positive(),
  mapping_id: z.string().nullable(),
  company_name_raw: z.string().min(1).max(500),
  company_name_normalized: z.string().min(1).max(500),
  ticker: z.string().min(1).max(20),
  match_confidence: z.enum(["high", "medium", "low"]),
  match_method: z.enum(["exact", "fuzzy", "manual"]),
  valid_from_date: z.string().nullable(),
  valid_to_date: z.string().nullable(),
  last_verified_timestamp: z.string().datetime(),
});

export type CompanyTickerMapping = z.infer<typeof companyTickerMappingSchema>;

export const insertCompanyTickerMappingSchema = companyTickerMappingSchema.omit({ id: true });
export type InsertCompanyTickerMapping = z.infer<typeof insertCompanyTickerMappingSchema>;
