import { z } from "zod";
import type { CongressionalTrade } from "@tc/shared";
import { searchWebWithStatus } from "../webSearch";
import { AppSettingsRepo } from "../../persistence/repos";
import { AiResearchRepo } from "../../persistence/aiResearchRepo";
import { CongressRepo } from "../../persistence/congressRepo";

export type AiCongressSourceHit = {
  title: string;
  url: string;
  snippet: string;
  source?: "brave" | "google" | "duckduckgo" | "local";
};

export type AiCongressSource = {
  id: string;
  name: string;
  query: string;
  hits: AiCongressSourceHit[];
  note?: string | undefined;
  dataSource?: "live" | "fallback" | undefined;
  provider?: "brave" | "google" | "duckduckgo" | "local" | undefined;
  rateLimit?:
    | {
        provider: "brave";
        retryAfterMs?: number;
      }
    | undefined;
};

export type CategorizedTrade = {
  ticker: string;
  politician: string;
  party?: string;
  chamber?: string;
  transactionType: string;
  amount: string;
  filedDate: string;
  lagDays?: number;
  impactReason: string;
  source: string;
  url: string;
};

export type DetectedPattern = {
  type:
    | "cluster"
    | "unusual_timing"
    | "large_volume"
    | "committee_chair"
    | "other";
  description: string;
  tickers: string[];
  count: number;
};

export type TradeMetrics = {
  totalTrades: number;
  totalVolume: string;
  topTickers: Array<{ ticker: string; count: number }>;
  avgLagDays: number | null;
  buyVsSell: { buys: number; sells: number; exchanges: number };
};

export type AiCongressIntel = {
  generatedAt: string;
  model: string;
  summary: string;
  highlights: string[];
  tickers: string[];
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  watchlist: Array<{ title: string; ticker?: string; reason?: string }>;
  sources: Array<Omit<AiCongressSource, "query">>;
  contextPreview: string;
  dataQualityNote?: string;
  // NEW: Enhanced categorization
  categorizedTrades?: {
    highImpact: CategorizedTrade[];
    mediumImpact: CategorizedTrade[];
    monitoring: CategorizedTrade[];
  };
  patterns?: DetectedPattern[];
  metrics?: TradeMetrics;
  localTradeCount?: number;
  localTradeWindowDays?: number;
  rateLimit?: {
    provider: "brave";
    active: boolean;
    retryAfterMs?: number;
    message?: string;
  };
};

const TRADING_SOURCE_IDS = new Set(["capitoltrades", "quiverquant"]);
const FALLBACK_TRADE_WINDOW_DAYS = 7;
const FALLBACK_TRADE_LIMIT = 15;
const LOCAL_TRADE_CONTEXT_LIMIT = 15;

const SOURCE_QUERIES = [
  {
    id: "capitoltrades",
    name: "Capitol Trades",
    query: "site:capitoltrades.com\nlatest congressional trades",
  },
  {
    id: "quiverquant",
    name: "QuiverQuant",
    query: "site:quiverquant.com\ncongress trading tracker",
  },
] as const;

const CategorizedTradeSchema = z.object({
  ticker: z.string(),
  politician: z.string(),
  party: z.string().optional(),
  chamber: z.string().optional(),
  transactionType: z.string(),
  amount: z.string(),
  filedDate: z.string(),
  lagDays: z.number().optional(),
  impactReason: z.string(),
  source: z.string(),
  url: z.string(),
});

const PatternSchema = z.object({
  type: z.enum([
    "cluster",
    "unusual_timing",
    "large_volume",
    "committee_chair",
    "other",
  ]),
  description: z.string(),
  tickers: z.array(z.string()),
  count: z.number(),
});

const SummarySchema = z.object({
  summary: z.string().min(1).default("No summary"),
  highlights: z.array(z.string()).default([]),
  tickers: z.array(z.string()).default([]),
  sentiment: z
    .enum(["bullish", "bearish", "neutral", "mixed"])
    .default("neutral"),
  watchlist: z
    .array(
      z.object({
        title: z.string().min(1),
        ticker: z.string().optional(),
        reason: z.string().optional(),
      }),
    )
    .default([]),
  categorizedTrades: z
    .object({
      highImpact: z.array(CategorizedTradeSchema).default([]),
      mediumImpact: z.array(CategorizedTradeSchema).default([]),
      monitoring: z.array(CategorizedTradeSchema).default([]),
    })
    .optional(),
  patterns: z.array(PatternSchema).default([]),
});

export async function scanCongressAiIntel(): Promise<AiCongressIntel> {
  const model = resolveAiModel();
  const fallbackTradeHits = await loadRecentTradeHits(
    FALLBACK_TRADE_WINDOW_DAYS,
    FALLBACK_TRADE_LIMIT,
  );
  const recentTrades = await loadRecentTrades(FALLBACK_TRADE_WINDOW_DAYS, 100);
  const sources = await fetchSources(fallbackTradeHits);
  const rateLimitedSource = sources.find(
    (source) => source.rateLimit?.provider === "brave",
  );
  const localTradeContext = buildLocalTradeContext(
    recentTrades,
    FALLBACK_TRADE_WINDOW_DAYS,
  );
  const context = buildContextBlock(sources, localTradeContext);
  const aiSummary = await summarizeWithAi(context, model);
  const metrics = calculateMetrics(recentTrades);
  const patterns = detectPatterns(recentTrades);

  // Generate data quality note based on sources
  const liveSourcesCount = sources.filter(
    (s) => s.dataSource === "live",
  ).length;
  const fallbackSourcesCount = sources.filter(
    (s) => s.dataSource === "fallback",
  ).length;
  let dataQualityNote: string | undefined;

  if (liveSourcesCount === sources.length && recentTrades.length > 0) {
    const providerTypes = new Set(
      sources.map((s) => s.provider).filter(Boolean),
    );
    const providerStr = Array.from(providerTypes).join(" + ");
    dataQualityNote = `🌐 Live web data (${providerStr}) + local filings (last ${FALLBACK_TRADE_WINDOW_DAYS} days)`;
  } else if (liveSourcesCount === sources.length && recentTrades.length === 0) {
    const providerTypes = new Set(
      sources.map((s) => s.provider).filter(Boolean),
    );
    const providerStr = Array.from(providerTypes).join(" + ");
    dataQualityNote = `🌐 Live web data (${providerStr}); no local filings in last ${FALLBACK_TRADE_WINDOW_DAYS} days`;
  } else if (liveSourcesCount > 0) {
    dataQualityNote = `🌐 Mixed sources: ${liveSourcesCount} live, ${fallbackSourcesCount} from local filings`;
  } else if (fallbackSourcesCount > 0) {
    dataQualityNote = `💾 Using local congressional filings (web search unavailable)`;
  } else {
    dataQualityNote = `⚠️ No data available`;
  }

  const normalizedWatchlist = aiSummary.watchlist.map((entry) => {
    const normalized: { title: string; ticker?: string; reason?: string } = {
      title: entry.title,
    };
    if (entry.ticker && entry.ticker.trim().length > 0) {
      normalized.ticker = entry.ticker.trim();
    }
    if (entry.reason && entry.reason.trim().length > 0) {
      normalized.reason = entry.reason.trim();
    }
    return normalized;
  });

  return {
    generatedAt: new Date().toISOString(),
    model,
    summary: aiSummary.summary,
    highlights: aiSummary.highlights,
    tickers: aiSummary.tickers,
    sentiment: aiSummary.sentiment,
    watchlist: normalizedWatchlist,
    sources: sources.map(({ query: _query, ...rest }) => rest),
    contextPreview: context.slice(0, 2000),
    dataQualityNote,
    categorizedTrades:
      "categorizedTrades" in aiSummary && aiSummary.categorizedTrades
        ? aiSummary.categorizedTrades
        : { highImpact: [], mediumImpact: [], monitoring: [] },
    patterns,
    metrics,
    localTradeCount: recentTrades.length,
    localTradeWindowDays: FALLBACK_TRADE_WINDOW_DAYS,
    rateLimit: rateLimitedSource
      ? {
          provider: "brave",
          active: true,
          retryAfterMs: rateLimitedSource.rateLimit?.retryAfterMs,
          message:
            "Brave Search is rate limited on the free tier. Retrying with backoff.",
        }
      : undefined,
  };
}

async function fetchSources(
  fallbackTradeHits: AiCongressSourceHit[],
): Promise<AiCongressSource[]> {
  return await Promise.all(
    SOURCE_QUERIES.map(async (source): Promise<AiCongressSource> => {
      let hits: AiCongressSourceHit[] = [];
      let note: string | undefined;
      let dataSource: "live" | "fallback" = "live";
      let provider: "brave" | "google" | "duckduckgo" | "local" | undefined;
      let rateLimit: { provider: "brave"; retryAfterMs?: number } | undefined;

      try {
        const webResponse = await searchWebWithStatus(source.query, 5, {
          freshness: "week",
        });
        if (webResponse.results.length > 0) {
          hits = webResponse.results;
          const resultProvider =
            webResponse.meta?.provider ?? webResponse.results[0]?.source;
          if (
            resultProvider === "brave" ||
            resultProvider === "google" ||
            resultProvider === "duckduckgo"
          ) {
            provider = resultProvider;
          }
          dataSource = "live";
        }

        if (
          webResponse.meta?.rateLimited &&
          webResponse.meta.rateLimitedProvider === "brave"
        ) {
          rateLimit = {
            provider: "brave",
            retryAfterMs: webResponse.meta.retryAfterMs,
          };
          note =
            "Brave Search rate limited; using backoff and fallback providers.";
        }
      } catch (err) {
        console.warn(`[aiCongressIntel] Failed to query ${source.name}:`, err);
      }

      // If web search failed or returned no results, use local fallback
      if (
        hits.length === 0 &&
        fallbackTradeHits.length > 0 &&
        TRADING_SOURCE_IDS.has(source.id)
      ) {
        hits = fallbackTradeHits;
        dataSource = "fallback";
        provider = "local";
        note = `No new headlines detected. Showing local disclosures from the last ${FALLBACK_TRADE_WINDOW_DAYS} days.`;
      }

      const result: AiCongressSource = {
        id: source.id,
        name: source.name,
        query: source.query,
        hits,
        note,
        dataSource,
        provider,
        rateLimit,
      };
      return result;
    }),
  );
}

function buildContextBlock(
  sources: AiCongressSource[],
  localTradeContext: string,
): string {
  const sourceBlock = sources
    .map((source) => {
      const header = source.note
        ? `${source.name} (${source.note})`
        : `Source: ${source.name}`;
      if (source.hits.length === 0) {
        return `${header}\nNo public hits were detected within the last query.`;
      }
      const entries = source.hits
        .map(
          (hit, idx) =>
            `(${idx + 1}) ${hit.title}\nURL: ${hit.url}\nSnippet: ${hit.snippet}`,
        )
        .join("\n");
      return `${header}\n${entries}`;
    })
    .join("\n\n");

  if (!sourceBlock && !localTradeContext) {
    return "No sources fetched.";
  }

  if (!localTradeContext) {
    return sourceBlock || "No sources fetched.";
  }

  return `${sourceBlock}\n\n${localTradeContext}`.trim();
}

function buildLocalTradeContext(
  trades: CongressionalTrade[],
  windowDays: number,
): string {
  if (!trades || trades.length === 0) {
    return "";
  }

  const sorted = [...trades].sort((a, b) => {
    const aDate = a.disclosure_date || a.transaction_date || "";
    const bDate = b.disclosure_date || b.transaction_date || "";
    return aDate < bDate ? 1 : aDate > bDate ? -1 : 0;
  });

  const recent = sorted.slice(0, LOCAL_TRADE_CONTEXT_LIMIT);
  const lines = recent.map((trade, idx) => {
    const amount = formatAmountRange(
      trade.amount_range_low,
      trade.amount_range_high,
      trade.amount_currency,
    );
    const ticker = trade.ticker_normalized || trade.asset_name_raw || "Unknown";
    const person = trade.person_name || "Unknown";
    const chamber = trade.chamber || "Unknown";
    const txDate = formatIsoDate(trade.transaction_date);
    const disclosed = formatIsoDate(trade.disclosure_date);
    const txType = trade.transaction_type || "Unknown";
    return `(${idx + 1}) ${person} [${chamber}] ${txType} ${ticker} ${amount} | tx: ${txDate} | disclosed: ${disclosed}`;
  });

  return `Local filings (last ${windowDays} days):\n${lines.join("\n")}`;
}

async function summarizeWithAi(contextBlock: string, model: string) {
  const system = `You are an investigative market analyst tracking congressional trading, lobbying, and contract disclosures. You must always reply with strict JSON that matches this schema:
{
  "summary": string,
  "highlights": string[],
  "tickers": string[],
  "sentiment": "bullish" | "bearish" | "neutral" | "mixed",
  "watchlist": [{ "title": string, "ticker"?: string, "reason"?: string }],
  "categorizedTrades": {
    "highImpact": [{ "ticker": string, "politician": string, "party"?: string, "chamber"?: string, "transactionType": string, "amount": string, "filedDate": string, "lagDays"?: number, "impactReason": string, "source": string, "url": string }],
    "mediumImpact": [...],
    "monitoring": [...]
  },
  "patterns": [{ "type": "cluster" | "unusual_timing" | "large_volume" | "committee_chair" | "other", "description": string, "tickers": string[], "count": number }]
}

CATEGORIZATION RULES:
- HIGH IMPACT: Large trades (>$250K), unusual timing (<5 days or >60 days lag), committee chair trades, or clustered trades (3+ politicians on same ticker within 7 days)
- MEDIUM IMPACT: Standard trades ($50K-$250K), normal timing (15-45 days lag)
- MONITORING: Small trades (<$50K) or old data (>90 days)

For each trade, include an "impactReason" explaining why it's in that category (e.g., "Unusually large position", "Committee chair + tech sector", "Clustered trades", etc.)

PATTERN DETECTION:
Identify and report notable patterns such as:
- Clusters: Multiple politicians trading the same ticker within 7 days
- Unusual timing: Very fast (<5 days) or very slow (>60 days) disclosure
- Large volume: Single trades >$1M or total volume >$5M on one ticker
- Committee chairs: Trades by committee leadership in relevant sectors

Guidelines:
- Use an even-handed tone. Mention sources in highlights when helpful.
- Prefer ticker format with leading $. ("$NVDA").
- If the context block is empty or low-signal, explain that data is limited.
- Keep watchlist entries focused on specific tickers or policy themes that warrant attention.`;

  const prompt = `Context block with scraped headlines and snippets:\n\n${contextBlock}\n\nReturn only valid JSON.`;

  try {
    const { callCloudLlm } = await import("../llm/cloudLlmClient");
    void model; // model param retained for API compatibility
    const text = await callCloudLlm(system, prompt, { temperature: 0.2 });
    const payload = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
    if (!payload) {
      throw new Error("Empty AI response");
    }

    const parsed = SummarySchema.safeParse(JSON.parse(payload));
    if (parsed.success) {
      return parsed.data;
    }
    console.warn(
      "[aiCongressIntel] AI response failed schema validation",
      parsed.error,
    );
    return buildFallbackSummary(contextBlock);
  } catch (err) {
    console.warn("[aiCongressIntel] AI summarization failed:", err);
    return buildFallbackSummary(contextBlock);
  }
}

async function loadRecentTradeHits(
  windowDays: number,
  limit: number,
): Promise<AiCongressSourceHit[]> {
  try {
    const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const dateStart = start.toISOString().slice(0, 10);
    const trades = CongressRepo.queryCongressionalTrades({
      transaction_date_start: dateStart,
      limit,
    });
    return trades.map((trade) => ({
      title: buildTradeTitle(trade),
      url:
        trade.source_url ||
        trade.source_document_id ||
        "https://www.capitoltrades.com/",
      snippet: buildTradeSnippet(trade),
    }));
  } catch (err) {
    console.warn(
      "[aiCongressIntel] Failed to load fallback congressional trades:",
      err,
    );
    return [];
  }
}

function buildTradeTitle(trade: CongressionalTrade): string {
  const member = trade.person_name ?? "Member";
  const action = (trade.transaction_type ?? "Trade").replace(/_/g, " ");
  const ticker =
    trade.ticker_normalized || trade.asset_name_raw || "Private Asset";
  return `${member} ${action} ${ticker}`;
}

function buildTradeSnippet(trade: CongressionalTrade): string {
  const chamber = trade.chamber ?? "Congress";
  const tradeDate = formatIsoDate(trade.transaction_date);
  const disclosure = formatIsoDate(trade.disclosure_date);
  const amount = formatAmountRange(
    trade.amount_range_low,
    trade.amount_range_high,
    trade.amount_currency,
  );
  return `${chamber} filing • Trade: ${tradeDate} • Disclosed: ${disclosure} • ${amount}`;
}

function formatAmountRange(
  low?: number | null,
  high?: number | null,
  currency?: string | null,
): string {
  if (typeof low === "number" && typeof high === "number") {
    return `${formatCurrency(low, currency)} - ${formatCurrency(high, currency)}`;
  }
  if (typeof low === "number") {
    return `${formatCurrency(low, currency)}+`;
  }
  if (typeof high === "number") {
    return `Under ${formatCurrency(high, currency)}`;
  }
  return "Amount undisclosed";
}

function formatCurrency(value: number, currency?: string | null): string {
  const prefix = currency && currency !== "USD" ? `${currency} ` : "$";
  return `${prefix}${Number(value).toLocaleString()}`;
}

function formatIsoDate(value?: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function resolveAiModel(): string {
  try {
    const config = AiResearchRepo.getConfig();
    if (
      config?.model &&
      typeof config.model === "string" &&
      config.model.trim().length > 0
    ) {
      return config.model.trim();
    }
  } catch (err) {
    console.warn("[aiCongressIntel] Unable to load AI config:", err);
  }

  try {
    const settings = AppSettingsRepo.get() as {
      globalAiModel?: string;
      primaryAiModel?: { model?: string };
    };
    const primaryModel = settings?.primaryAiModel?.model?.trim();
    if (primaryModel) {
      return primaryModel;
    }
    if (
      settings.globalAiModel &&
      typeof settings.globalAiModel === "string" &&
      settings.globalAiModel.trim().length > 0
    ) {
      return settings.globalAiModel.trim();
    }
  } catch (err) {
    console.warn("[aiCongressIntel] Unable to read global AI model:", err);
  }

  return "deepseek-r1:14b";
}

function buildFallbackSummary(contextBlock: string) {
  const fallbackHighlights = contextBlock
    .split("\n")
    .filter(
      (line) => line.trim().startsWith("(1)") || line.trim().startsWith("(2)"),
    )
    .slice(0, 5)
    .map((line) => line.replace(/^\(\d+\)\s*/, ""));

  return {
    summary: fallbackHighlights.length
      ? "Unable to reach AI runtime. Showing top scraped headlines instead."
      : "No recent public headlines were detected for the requested sources.",
    highlights: fallbackHighlights,
    tickers: [],
    sentiment: "neutral" as const,
    watchlist: [],
    patterns: [],
  };
}

async function loadRecentTrades(
  windowDays: number,
  limit: number,
): Promise<CongressionalTrade[]> {
  try {
    const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const dateStart = start.toISOString().slice(0, 10);
    return CongressRepo.queryCongressionalTrades({
      transaction_date_start: dateStart,
      limit,
    });
  } catch (err) {
    console.warn(
      "[aiCongressIntel] Failed to load recent congressional trades:",
      err,
    );
    return [];
  }
}

function calculateMetrics(trades: CongressionalTrade[]): TradeMetrics {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      totalVolume: "$0",
      topTickers: [],
      avgLagDays: null,
      buyVsSell: { buys: 0, sells: 0, exchanges: 0 },
    };
  }

  // Count by ticker
  const tickerCounts: Record<string, number> = {};
  let totalLag = 0;
  let lagCount = 0;
  let buys = 0;
  let sells = 0;
  let exchanges = 0;
  let totalVolume = 0;

  for (const trade of trades) {
    const ticker = trade.ticker_normalized || trade.asset_name_raw || "Unknown";
    tickerCounts[ticker] = (tickerCounts[ticker] || 0) + 1;

    // Calculate lag
    if (trade.transaction_date && trade.disclosure_date) {
      const txDate = new Date(trade.transaction_date).getTime();
      const discDate = new Date(trade.disclosure_date).getTime();
      const lagDays = Math.floor((discDate - txDate) / (1000 * 60 * 60 * 24));
      if (!isNaN(lagDays) && lagDays >= 0) {
        totalLag += lagDays;
        lagCount++;
      }
    }

    // Count transaction types
    const txType = (trade.transaction_type || "").toLowerCase();
    if (txType.includes("purchase") || txType.includes("buy")) {
      buys++;
    } else if (txType.includes("sale") || txType.includes("sell")) {
      sells++;
    } else if (txType.includes("exchange")) {
      exchanges++;
    }

    // Estimate volume (use midpoint of range)
    if (trade.amount_range_low && trade.amount_range_high) {
      totalVolume += (trade.amount_range_low + trade.amount_range_high) / 2;
    } else if (trade.amount_range_low) {
      totalVolume += trade.amount_range_low;
    }
  }

  // Top tickers
  const topTickers = Object.entries(tickerCounts)
    .map(([ticker, count]) => ({ ticker, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalTrades: trades.length,
    totalVolume: formatCurrency(totalVolume, "USD"),
    topTickers,
    avgLagDays: lagCount > 0 ? Math.round(totalLag / lagCount) : null,
    buyVsSell: { buys, sells, exchanges },
  };
}

function detectPatterns(trades: CongressionalTrade[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];

  if (trades.length === 0) return patterns;

  // Detect clusters: 3+ trades on same ticker within 7 days
  const tickerGroups: Record<string, CongressionalTrade[]> = {};
  for (const trade of trades) {
    const ticker = trade.ticker_normalized || trade.asset_name_raw;
    if (!ticker || ticker === "Unknown") continue;
    if (!tickerGroups[ticker]) tickerGroups[ticker] = [];
    tickerGroups[ticker].push(trade);
  }

  for (const [ticker, group] of Object.entries(tickerGroups)) {
    if (group.length >= 3) {
      // Check if within 7-day window
      const dates = group
        .map((t) => t.transaction_date || t.disclosure_date)
        .filter(Boolean)
        .map((d) => new Date(d!).getTime())
        .sort();

      if (dates.length >= 3) {
        const daySpan =
          (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24);
        if (daySpan <= 7) {
          patterns.push({
            type: "cluster",
            description: `${group.length} politicians traded ${ticker} within ${Math.ceil(daySpan)} days`,
            tickers: [ticker],
            count: group.length,
          });
        }
      }
    }
  }

  // Detect unusual timing
  for (const trade of trades) {
    if (trade.transaction_date && trade.disclosure_date) {
      const txDate = new Date(trade.transaction_date).getTime();
      const discDate = new Date(trade.disclosure_date).getTime();
      const lagDays = Math.floor((discDate - txDate) / (1000 * 60 * 60 * 24));

      const ticker =
        trade.ticker_normalized || trade.asset_name_raw || "Unknown";
      if (lagDays < 5) {
        patterns.push({
          type: "unusual_timing",
          description: `${trade.person_name} disclosed ${ticker} in just ${lagDays} days (unusually fast)`,
          tickers: [ticker],
          count: 1,
        });
      } else if (lagDays > 60) {
        patterns.push({
          type: "unusual_timing",
          description: `${trade.person_name} took ${lagDays} days to disclose ${ticker} (delayed)`,
          tickers: [ticker],
          count: 1,
        });
      }
    }
  }

  // Detect large volume trades
  for (const trade of trades) {
    if (trade.amount_range_low && trade.amount_range_low > 1000000) {
      const ticker =
        trade.ticker_normalized || trade.asset_name_raw || "Unknown";
      patterns.push({
        type: "large_volume",
        description: `${trade.person_name} traded >$1M in ${ticker}`,
        tickers: [ticker],
        count: 1,
      });
    }
  }

  // Limit to top 10 patterns
  return patterns.slice(0, 10);
}
