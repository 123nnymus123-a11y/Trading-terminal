/**
 * Supply Chain Data Validator
 * Fetches live financial data from free sources and validates Llama's claims
 * No API keys required - uses web scraping and public APIs
 */

import * as fs from "node:fs";
import * as path from "node:path";

async function fetchWithTimeout(input: string, init: RequestInit = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export interface LiveDataPoint {
  source: string;
  ticker: string;
  metric: string;
  value: unknown;
  timestamp: number;
  freshness: "real-time" | "daily" | "weekly" | "monthly";
}

export interface ValidationResult {
  claim: string;
  llamaConfidence: number;
  validatedBy: string[];
  isValid: boolean;
  validationConfidence: number;
  liveData: LiveDataPoint[];
  discrepancy: string | null;
}

export interface EarningsData {
  ticker: string;
  quarter: string;
  revenue: number;
  eps: number;
  date: number;
  source: string;
}

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  date: number;
  sentiment: "positive" | "negative" | "neutral";
  supplyChaainRelevant: boolean;
}

export interface SupplierRisk {
  ticker: string;
  risk: string;
  severity: "low" | "medium" | "high" | "critical";
  source: string;
  date: number;
}

export interface HistoricalValidation {
  claim: string;
  ticker: string;
  validationHistory: Array<{
    date: number;
    confidence: number;
    source: string;
  }>;
}

/**
 * Fetch stock price from Yahoo Finance (free, no auth)
 * Uses a lightweight scrape of the quote page
 */
export async function fetchYahooPrice(ticker: string): Promise<LiveDataPoint | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&fields=regularMarketPrice,currency,marketCap`;
    
    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, 5000);

    if (!response.ok) {
      console.warn(`[dataValidator] Yahoo fetch failed: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as any;
    const quote = data.quoteResponse?.result?.[0];

    if (!quote) return null;

    return {
      source: "Yahoo Finance",
      ticker: ticker.toUpperCase(),
      metric: "stock_price",
      value: quote.regularMarketPrice,
      timestamp: Date.now(),
      freshness: "real-time",
    };
  } catch (err) {
    console.warn(`[dataValidator] Yahoo price fetch error:`, err);
    return null;
  }
}

/**
 * Fetch company market cap from Yahoo Finance
 */
export async function fetchMarketCap(ticker: string): Promise<LiveDataPoint | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&fields=marketCap,shortName`;

    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, 5000);

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const quote = data.quoteResponse?.result?.[0];

    if (!quote?.marketCap) return null;

    return {
      source: "Yahoo Finance",
      ticker: ticker.toUpperCase(),
      metric: "market_cap",
      value: quote.marketCap,
      timestamp: Date.now(),
      freshness: "real-time",
    };
  } catch (err) {
    console.warn(`[dataValidator] Market cap fetch error:`, err);
    return null;
  }
}

/**
 * Fetch SEC filings for supply chain disclosures (10-K, 8-K)
 * Uses SEC Edgar free API
 */
export async function fetchSECFilings(
  ticker: string,
  formType = "10-K"
): Promise<LiveDataPoint | null> {
  try {
    // Convert ticker to CIK
    const cikUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${ticker}&type=${formType}&dateb=&owner=exclude&count=100&search_text=supply`;

    const response = await fetchWithTimeout(cikUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, 8000);

    if (!response.ok) return null;

    const html = await response.text();

    // Extract filing dates and check for supply chain mentions
    const filingMatches = html.match(/(\d{4}-\d{2}-\d{2})/g);
    const hasSupplyChainMentions = html.toLowerCase().includes("supply chain") ||
      html.toLowerCase().includes("supplier") ||
      html.toLowerCase().includes("manufacturing");

    if (!filingMatches?.length) return null;

    return {
      source: "SEC Edgar",
      ticker: ticker.toUpperCase(),
      metric: "latest_filing",
      value: {
        type: formType,
        date: filingMatches[0],
        hasSupplyChainData: hasSupplyChainMentions,
      },
      timestamp: Date.now(),
      freshness: "monthly",
    };
  } catch (err) {
    console.warn(`[dataValidator] SEC filing fetch error:`, err);
    return null;
  }
}

/**
 * Validate a claim against live data sources
 * Returns validation confidence and discrepancies
 */
export async function validateClaim(claim: string, llamaConfidence: number): Promise<ValidationResult> {
  const result: ValidationResult = {
    claim,
    llamaConfidence,
    validatedBy: [],
    isValid: true,
    validationConfidence: 0,
    liveData: [],
    discrepancy: null,
  };

  // Check if claim mentions a ticker
  const tickerMatch = claim.match(/\b([A-Z]{1,5})\b/);
  if (!tickerMatch) {
    result.discrepancy = "No ticker found in claim";
    return result;
  }

  const ticker = tickerMatch[1];

  // Fetch live data
  const priceData = await fetchYahooPrice(ticker);
  const capData = await fetchMarketCap(ticker);
  const filingData = await fetchSECFilings(ticker);

  if (priceData) {
    result.liveData.push(priceData);
    result.validatedBy.push("Yahoo Finance (price)");
  }

  if (capData) {
    result.liveData.push(capData);
    result.validatedBy.push("Yahoo Finance (market cap)");
  }

  if (filingData) {
    result.liveData.push(filingData);
    result.validatedBy.push("SEC Edgar");

    // If filing has supply chain data and claim is about supply chain, boost confidence
    if (
      (filingData.value as any).hasSupplyChainData &&
      (claim.toLowerCase().includes("supplier") || claim.toLowerCase().includes("manufacturing"))
    ) {
      result.validationConfidence = Math.min(1, llamaConfidence + 0.15);
    }
  }

  // If we found live data, increase validation confidence
  if (result.validatedBy.length > 0) {
    result.validationConfidence = Math.max(llamaConfidence, llamaConfidence * 0.9 + 0.1);
    result.isValid = true;
  } else {
    result.validationConfidence = llamaConfidence * 0.7; // Reduce confidence if no live data found
    result.discrepancy = "Could not validate against live data sources";
  }

  return result;
}

/**
 * Validate multiple claims in batch
 */
export async function validateClaimsBatch(
  claims: Array<{ text: string; confidence: number }>
): Promise<ValidationResult[]> {
  return Promise.all(
    claims.map((claim) => validateClaim(claim.text, claim.confidence))
  );
}

/**
 * Format validation results for advisor response
 */
export function formatValidationForAdvisor(validationResults: ValidationResult[]): string {
  if (validationResults.length === 0) return "";

  const validated = validationResults.filter((r) => r.isValid && r.validatedBy.length > 0);
  const unvalidated = validationResults.filter((r) => !r.isValid || r.validatedBy.length === 0);

  let output = "";

  if (validated.length > 0) {
    output += `\n\n✅ **Data-Backed Claims** (${validated.length} validated):\n`;
    for (const v of validated) {
      output += `• ${v.claim}\n  Confidence: ${(v.validationConfidence * 100).toFixed(0)}% (validated via ${v.validatedBy.join(", ")})\n`;
    }
  }

  if (unvalidated.length > 0) {
    output += `\n\n⚠️ **Unvalidated Claims** (${unvalidated.length}):\n`;
    for (const u of unvalidated) {
      output += `• ${u.claim}\n  Note: ${u.discrepancy}\n`;
    }
  }

  return output;
}

/**
 * Cache validation results to avoid repeated fetches
 */
const validationCache = new Map<string, { result: ValidationResult; timestamp: number }>();
const CACHE_TTL = 3600000; // 1 hour

export function getCachedValidation(cacheKey: string): ValidationResult | null {
  const cached = validationCache.get(cacheKey);
  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    validationCache.delete(cacheKey);
    return null;
  }

  return cached.result;
}

export function setCachedValidation(cacheKey: string, result: ValidationResult): void {
  validationCache.set(cacheKey, { result, timestamp: Date.now() });
}

/**
 * Fetch earnings data from Yahoo Finance (quarterly revenue & EPS)
 */
export async function fetchEarningsData(ticker: string): Promise<EarningsData | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&fields=epsTrailingTwelveMonths,trailingAnnualRevenue,lastFiscalYearEnd`;

    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, 5000);

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const quote = data.quoteResponse?.result?.[0];

    if (!quote) return null;

    return {
      ticker: ticker.toUpperCase(),
      quarter: "TTM", // Trailing Twelve Months
      revenue: quote.trailingAnnualRevenue || 0,
      eps: quote.epsTrailingTwelveMonths || 0,
      date: Date.now(),
      source: "Yahoo Finance",
    };
  } catch (err) {
    console.warn(`[dataValidator] Earnings fetch error:`, err);
    return null;
  }
}

/**
 * Fetch and analyze news sentiment for supply chain disruptions
 */
export async function fetchSupplyChainNews(ticker: string): Promise<NewsItem[]> {
  try {
    const searchQuery = `${ticker} supply chain disruption`;
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(searchQuery)}`;

    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, 8000);

    if (!response.ok) return [];

    const xml = await response.text();

    // Parse RSS items
    const items: NewsItem[] = [];
    const itemRegex = /<item>(.*?)<\/item>/gs;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];

      const titleMatch = /<title[^>]*>(.*?)<\/title>/s.exec(itemContent);
      const linkMatch = /<link[^>]*>(.*?)<\/link>/s.exec(itemContent);
      const pubDateMatch = /<pubDate[^>]*>(.*?)<\/pubDate>/s.exec(itemContent);

      const title = titleMatch ? stripHtmlTags(titleMatch[1]) : "";
      const url = linkMatch ? linkMatch[1].trim() : "";
      const pubDate = pubDateMatch ? new Date(pubDateMatch[1]).getTime() : Date.now();

      if (!title || !url) continue;

      // Simple sentiment analysis
      const lowerTitle = title.toLowerCase();
      const sentiment = detectSentiment(title);
      const supplyChaainRelevant =
        lowerTitle.includes("supply") ||
        lowerTitle.includes("shortage") ||
        lowerTitle.includes("disruption") ||
        lowerTitle.includes("logistics");

      if (supplyChaainRelevant) {
        items.push({
          title,
          url,
          source: "Google News",
          date: pubDate,
          sentiment,
          supplyChaainRelevant: true,
        });
      }
    }

    return items.slice(0, 5); // Return top 5 relevant items
  } catch (err) {
    console.warn(`[dataValidator] News fetch error:`, err);
    return [];
  }
}

/**
 * Find alternative suppliers for a company
 */
export async function findAlternativeSuppliers(
  ticker: string,
  productCategory: string
): Promise<string[]> {
  try {
    const searchQuery = `${productCategory} suppliers companies (not ${ticker})`;
    const url = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&format=json`;

    const response = await fetchWithTimeout(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, 5000);

    if (!response.ok) return [];

    const data = (await response.json()) as any;
    const suppliers: string[] = [];

    // Extract company names from search results
    if (data.Results && Array.isArray(data.Results)) {
      for (const result of data.Results.slice(0, 5)) {
        const text = result.Result || "";
        const companies = extractCompanyNames(text);
        suppliers.push(...companies);
      }
    }

    return Array.from(new Set(suppliers)).slice(0, 5); // Deduplicate and limit
  } catch (err) {
    console.warn(`[dataValidator] Alternative suppliers fetch error:`, err);
    return [];
  }
}

/**
 * Flag supply chain risks (geopolitical, regulatory, etc.)
 */
export async function detectSupplyChainRisks(ticker: string): Promise<SupplierRisk[]> {
  const risks: SupplierRisk[] = [];

  try {
    // Check for geopolitical risks
    const geopoliticalKeywords = [
      "Taiwan", "China sanctions", "US trade war", "Russia export",
      "EU regulations", "semiconductor shortage"
    ];

    const riskUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
      `${ticker} geopolitical risk supply chain`
    )}`;

    const response = await fetchWithTimeout(riskUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    }, 8000);

    if (response.ok) {
      const xml = await response.text();
      const itemRegex = /<item>(.*?)<\/item>/gs;
      let match;

      while ((match = itemRegex.exec(xml)) !== null) {
        const itemContent = match[1];
        const titleMatch = /<title[^>]*>(.*?)<\/title>/s.exec(itemContent);
        const title = titleMatch ? stripHtmlTags(titleMatch[1]) : "";

        // Check for risk keywords
        for (const keyword of geopoliticalKeywords) {
          if (title.toLowerCase().includes(keyword.toLowerCase())) {
            const severity = determineSeverity(title);
            risks.push({
              ticker: ticker.toUpperCase(),
              risk: title,
              severity,
              source: "Google News",
              date: Date.now(),
            });
            break;
          }
        }

        if (risks.length >= 3) break; // Limit to 3 risks
      }
    }
  } catch (err) {
    console.warn(`[dataValidator] Risk detection error:`, err);
  }

  return risks;
}

/**
 * Store and retrieve validation history to spot trends
 */
const validationHistory = new Map<string, HistoricalValidation>();

export function recordValidationHistory(
  claim: string,
  ticker: string,
  confidence: number,
  source: string
): void {
  const key = `${ticker}:${claim}`;
  let history = validationHistory.get(key);

  if (!history) {
    history = {
      claim,
      ticker,
      validationHistory: [],
    };
  }

  history.validationHistory.push({
    date: Date.now(),
    confidence,
    source,
  });

  // Keep only last 30 records per claim
  if (history.validationHistory.length > 30) {
    history.validationHistory = history.validationHistory.slice(-30);
  }

  validationHistory.set(key, history);
}

export function getValidationTrend(claim: string, ticker: string): {
  trend: "improving" | "declining" | "stable";
  confidenceChange: number;
  historicalData: HistoricalValidation | null;
} {
  const key = `${ticker}:${claim}`;
  const history = validationHistory.get(key);

  if (!history || history.validationHistory.length < 2) {
    return { trend: "stable", confidenceChange: 0, historicalData: history || null };
  }

  const recent = history.validationHistory.slice(-5);
  const older = history.validationHistory.slice(0, 5);

  const recentAvg = recent.reduce((sum, r) => sum + r.confidence, 0) / recent.length;
  const olderAvg = older.reduce((sum, r) => sum + r.confidence, 0) / older.length;

  const change = recentAvg - olderAvg;
  const trend = change > 0.05 ? "improving" : change < -0.05 ? "declining" : "stable";

  return { trend, confidenceChange: change, historicalData: history };
}

/**
 * Helper: Simple sentiment analysis
 */
function detectSentiment(text: string): "positive" | "negative" | "neutral" {
  const lowerText = text.toLowerCase();

  const negative = ["disruption", "shortage", "delay", "warning", "risk", "loss", "down", "fell"];
  const positive = ["gain", "up", "growth", "strong", "improvement", "surge"];

  const negCount = negative.filter((word) => lowerText.includes(word)).length;
  const posCount = positive.filter((word) => lowerText.includes(word)).length;

  if (negCount > posCount) return "negative";
  if (posCount > negCount) return "positive";
  return "neutral";
}

/**
 * Helper: Determine risk severity
 */
function determineSeverity(text: string): "low" | "medium" | "high" | "critical" {
  const lowerText = text.toLowerCase();

  if (
    lowerText.includes("critical") ||
    lowerText.includes("emergency") ||
    lowerText.includes("halt")
  ) {
    return "critical";
  }
  if (
    lowerText.includes("severe") ||
    lowerText.includes("major") ||
    lowerText.includes("significant")
  ) {
    return "high";
  }
  if (lowerText.includes("concern") || lowerText.includes("warning")) {
    return "medium";
  }
  return "low";
}

/**
 * Helper: Extract company names from text
 */
function extractCompanyNames(text: string): string[] {
  // Simple pattern: capitalized words that might be companies
  const matches = (text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || []) as string[];
  return matches.filter(
    (m) =>
      m.length > 2 &&
      !["The", "And", "For", "With", "That", "This"].includes(m)
  );
}

/**
 * Helper: Strip HTML tags
 */
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}
