import type { ValuationTag, Fundamentals, PriceProvider, FundamentalsProvider } from "@tc/shared";
import { createLogger as makeLogger } from "@tc/shared";

const logger = makeLogger({ scope: "valuation" });

/**
 * Valuation tagging engine.
 * 
 * Computes valuation tags (overvalued, fair, undervalued) based on fundamental metrics:
 * - P/E ratio (Price to Earnings)
 * - FCF yield (Free Cash Flow yield)
 * - Revenue growth
 * 
 * HEURISTIC BANDS (MVP - subject to refinement):
 * 
 * P/E Ratio bands:
 * - < 15: Low (potential undervalued signal)
 * - 15-25: Fair range
 * - 25-35: Moderate (watching)
 * - > 35: High (potential overvalued signal)
 * 
 * FCF Yield bands:
 * - > 6%: Strong (undervalued signal)
 * - 4-6%: Healthy
 * - 2-4%: Moderate
 * - < 2%: Weak (overvalued signal)
 * 
 * Revenue Growth YoY:
 * - > 25%: High growth (justifies higher multiples)
 * - 10-25%: Solid growth
 * - 0-10%: Slow growth
 * - < 0%: Declining (concern)
 * 
 * The final tag is derived by combining these signals with weighted consideration.
 * Confidence reflects data completeness and signal strength.
 */

interface ValuationMetrics {
  pe?: number;
  fcfYield?: number;
  revenueGrowth?: number;
}

interface ValuationSignals {
  peSignal: "undervalued" | "fair" | "overvalued" | null;
  fcfSignal: "undervalued" | "fair" | "overvalued" | null;
  growthSignal: "high" | "solid" | "slow" | "declining" | null;
  basis: string[];
}

/**
 * Compute valuation metrics from price and fundamentals.
 */
function computeMetrics(price: number, fundamentals: Fundamentals): ValuationMetrics {
  const metrics: ValuationMetrics = {};

  if (fundamentals.eps_ttm !== undefined && fundamentals.eps_ttm > 0) {
    metrics.pe = price / fundamentals.eps_ttm;
  }

  if (fundamentals.fcf_per_share !== undefined && fundamentals.fcf_per_share > 0) {
    metrics.fcfYield = (fundamentals.fcf_per_share / price) * 100; // as percentage
  }

  if (fundamentals.revenue_growth_yoy !== undefined) {
    metrics.revenueGrowth = fundamentals.revenue_growth_yoy;
  }

  return metrics;
}

/**
 * Derive valuation signals from metrics.
 */
function deriveSignals(metrics: ValuationMetrics): ValuationSignals {
  const signals: ValuationSignals = {
    peSignal: null,
    fcfSignal: null,
    growthSignal: null,
    basis: [],
  };

  // P/E signal
  if (metrics.pe !== undefined) {
    const pe = metrics.pe;
    if (pe < 0) {
      signals.basis.push(`P/E=${pe.toFixed(1)} (negative earnings)`);
    } else if (pe < 15) {
      signals.peSignal = "undervalued";
      signals.basis.push(`P/E=${pe.toFixed(1)} (low)`);
    } else if (pe <= 25) {
      signals.peSignal = "fair";
      signals.basis.push(`P/E=${pe.toFixed(1)} (fair range)`);
    } else if (pe <= 35) {
      signals.peSignal = "fair";
      signals.basis.push(`P/E=${pe.toFixed(1)} (moderate)`);
    } else {
      signals.peSignal = "overvalued";
      signals.basis.push(`P/E=${pe.toFixed(1)} (high)`);
    }
  }

  // FCF yield signal
  if (metrics.fcfYield !== undefined) {
    const fcf = metrics.fcfYield;
    if (fcf < 0) {
      signals.basis.push(`FCF yield=${fcf.toFixed(1)}% (negative)`);
    } else if (fcf > 6) {
      signals.fcfSignal = "undervalued";
      signals.basis.push(`FCF yield=${fcf.toFixed(1)}% (strong)`);
    } else if (fcf >= 4) {
      signals.fcfSignal = "fair";
      signals.basis.push(`FCF yield=${fcf.toFixed(1)}% (healthy)`);
    } else if (fcf >= 2) {
      signals.fcfSignal = "fair";
      signals.basis.push(`FCF yield=${fcf.toFixed(1)}% (moderate)`);
    } else {
      signals.fcfSignal = "overvalued";
      signals.basis.push(`FCF yield=${fcf.toFixed(1)}% (weak)`);
    }
  }

  // Revenue growth signal
  if (metrics.revenueGrowth !== undefined) {
    const growth = metrics.revenueGrowth;
    if (growth > 25) {
      signals.growthSignal = "high";
      signals.basis.push(`YoY revenue growth=${growth.toFixed(1)}% (high)`);
    } else if (growth >= 10) {
      signals.growthSignal = "solid";
      signals.basis.push(`YoY revenue growth=${growth.toFixed(1)}% (solid)`);
    } else if (growth >= 0) {
      signals.growthSignal = "slow";
      signals.basis.push(`YoY revenue growth=${growth.toFixed(1)}% (slow)`);
    } else {
      signals.growthSignal = "declining";
      signals.basis.push(`YoY revenue growth=${growth.toFixed(1)}% (declining)`);
    }
  }

  return signals;
}

/**
 * Combine signals into a final valuation tag with confidence.
 */
function combineSignals(signals: ValuationSignals): { tag: "overvalued" | "fair" | "undervalued"; confidence: number } {
  const votes: Record<"overvalued" | "fair" | "undervalued", number> = {
    overvalued: 0,
    fair: 0,
    undervalued: 0,
  };

  let totalSignals = 0;

  // P/E signal (weight: 1.5)
  if (signals.peSignal) {
    votes[signals.peSignal] += 1.5;
    totalSignals += 1.5;
  }

  // FCF signal (weight: 1.5)
  if (signals.fcfSignal) {
    votes[signals.fcfSignal] += 1.5;
    totalSignals += 1.5;
  }

  // Growth signal influences valuation tolerance
  // High growth can justify "overvalued" signals → shift toward fair
  // Declining growth can make "undervalued" signals more attractive
  if (signals.growthSignal === "high") {
    // High growth: reduce overvalued penalty
    if (votes.overvalued > 0) {
      votes.fair += 1;
      totalSignals += 1;
    }
  } else if (signals.growthSignal === "declining") {
    // Declining: reduce undervalued benefit
    if (votes.undervalued > 0) {
      votes.fair += 1;
      totalSignals += 1;
    }
  }

  // Determine winner
  let maxVotes = 0;
  let winner: "overvalued" | "fair" | "undervalued" = "fair";

  for (const [tag, count] of Object.entries(votes) as [keyof typeof votes, number][]) {
    if (count > maxVotes) {
      maxVotes = count;
      winner = tag;
    }
  }

  // Confidence based on signal count and strength
  const confidence = totalSignals > 0 ? Math.min(maxVotes / totalSignals, 1.0) : 0.5;

  return { tag: winner, confidence };
}

/**
 * Compute a valuation tag for a single ticker.
 * 
 * @param ticker - The ticker symbol
 * @param priceProvider - Provider for latest price
 * @param fundamentalsProvider - Provider for fundamental data
 * @returns ValuationTag or null if data is insufficient
 */
export async function computeValuationTag(
  ticker: string,
  priceProvider: PriceProvider,
  fundamentalsProvider: FundamentalsProvider
): Promise<ValuationTag | null> {
  try {
    const [price, fundamentals] = await Promise.all([
      priceProvider.getLatestPrice(ticker),
      fundamentalsProvider.getFundamentals(ticker),
    ]);

    if (!price || !fundamentals) {
      logger.debug(`[valuation] Insufficient data for ${ticker}`);
      return null;
    }

    // Must have at least EPS or FCF to compute valuation
    if (fundamentals.eps_ttm === undefined && fundamentals.fcf_per_share === undefined) {
      logger.debug(`[valuation] No earnings or FCF data for ${ticker}`);
      return null;
    }

    const metrics = computeMetrics(price, fundamentals);
    const signals = deriveSignals(metrics);
    const { tag, confidence } = combineSignals(signals);

    const valuationTag: ValuationTag = {
      ticker,
      tag,
      confidence,
      updated_at: new Date().toISOString(),
      basis: signals.basis,
    };

    logger.debug(`[valuation] ${ticker}: ${tag} (confidence=${confidence.toFixed(2)})`, { basis: signals.basis });

    return valuationTag;
  } catch (error) {
    logger.error(`[valuation] Error computing tag for ${ticker}:`, error);
    return null;
  }
}
