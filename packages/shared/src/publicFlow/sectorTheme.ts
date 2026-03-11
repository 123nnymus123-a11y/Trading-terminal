import { z } from "zod";

/**
 * Schema for a sector theme derived from aggregated disclosure events.
 * Represents trends over a rolling time window (e.g., 7 or 30 days).
 */
export const sectorThemeSchema = z.object({
  id: z.number().int().positive(),
  window_days: z.union([z.literal(7), z.literal(30)]), // Rolling window in days
  window_start: z.string().datetime(), // ISO 8601 start of window
  window_end: z.string().datetime(), // ISO 8601 end of window
  sector: z.string().min(1).max(100),
  score: z.number().min(0).max(100), // Aggregated score (higher = stronger theme)
  summary: z.string().max(1000), // Brief summary of the theme
  created_at: z.string().datetime(), // ISO 8601
});

export type SectorTheme = z.infer<typeof sectorThemeSchema>;

export const insertSectorThemeSchema = sectorThemeSchema.omit({ id: true, created_at: true });
export type InsertSectorTheme = z.infer<typeof insertSectorThemeSchema> & { created_at: string };
