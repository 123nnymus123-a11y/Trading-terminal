import { z } from "zod";

/**
 * Schema for a valuation tag derived from fundamental analysis.
 * Tags classify tickers as overvalued, fair, or undervalued based on
 * heuristic metrics like P/E ratio and FCF yield.
 */
export const valuationTagSchema = z.object({
  ticker: z.string().min(1).max(20),
  tag: z.enum(["overvalued", "fair", "undervalued"]),
  confidence: z.number().min(0).max(1), // 0 = low confidence, 1 = high confidence
  updated_at: z.string().datetime(), // ISO 8601
  basis: z.array(z.string()), // Human-readable reasons, e.g., ["P/E=38.2 (high)", "FCF yield=5.1%"]
});

export type ValuationTag = z.infer<typeof valuationTagSchema>;

/**
 * Provider interface for retrieving the latest price for a ticker.
 */
export interface PriceProvider {
  /**
   * Get the latest price for a ticker.
   * @returns Price in USD, or null if unavailable.
   */
  getLatestPrice(ticker: string): Promise<number | null>;
}

/**
 * Fundamental data for valuation analysis.
 */
export interface Fundamentals {
  ticker: string;
  eps_ttm?: number; // Trailing twelve months earnings per share
  fcf_per_share?: number; // Free cash flow per share
  revenue_growth_yoy?: number; // Year-over-year revenue growth (as percentage)
}

/**
 * Provider interface for retrieving fundamental data.
 */
export interface FundamentalsProvider {
  /**
   * Get fundamental data for a ticker.
   * @returns Fundamentals object, or null if unavailable.
   */
  getFundamentals(ticker: string): Promise<Fundamentals | null>;
}
