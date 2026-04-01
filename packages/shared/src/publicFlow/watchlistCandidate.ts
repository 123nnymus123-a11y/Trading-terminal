import { z } from "zod";

/**
 * Schema for a watchlist candidate derived from a sector theme.
 * These are tickers that may be relevant based on sector activity,
 * including peers, suppliers, customers, or ETF constituents.
 */
export const watchlistCandidateSchema = z.object({
  id: z.number().int().positive(),
  theme_id: z.number().int().positive(), // References sector_theme.id
  ticker: z.string().min(1).max(20),
  rationale: z.string().max(500), // Why this candidate is relevant
  relation_type: z.enum(["peer", "supplier", "customer", "etf-constituent"]),
  created_at: z.string().datetime(), // ISO 8601
  importance_score: z.number().min(0).max(100).optional(),
  confidence_score: z.number().min(0).max(1).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  theme_count: z.number().int().min(1).optional(),
  freshness_days: z.number().min(0).optional(),
  score_components: z
    .object({
      theme_momentum: z.number().min(0).max(1),
      relation_strength: z.number().min(0).max(1),
      diversity_bonus: z.number().min(0).max(1),
      freshness_boost: z.number().min(0).max(1),
    })
    .optional(),
});

export type WatchlistCandidate = z.infer<typeof watchlistCandidateSchema>;

export const insertWatchlistCandidateSchema = watchlistCandidateSchema.omit({
  id: true,
  created_at: true,
});
export type InsertWatchlistCandidate = z.infer<
  typeof insertWatchlistCandidateSchema
> & { created_at: string };
