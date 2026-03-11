/**
 * Web Search Service
 * Provides internet search capability with multi-provider fallback:
 * 1. Brave Search (if API key configured)
 * 2. Google Custom Search (if API key configured)
 * 3. DuckDuckGo (free, no key required)
 */

import { AppSettingsRepo } from "../persistence/repos";
import { getSecret } from "../secrets";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source?: "brave" | "google" | "duckduckgo";
}

export interface SearchMeta {
  provider?: "brave" | "google" | "duckduckgo";
  rateLimited?: boolean;
  rateLimitedProvider?: "brave";
  retryAfterMs?: number;
  cacheHit?: boolean;
  attemptCount?: number;
}

export type SearchOptions = {
  freshness?: "day" | "week" | "month";
};

export interface SearchResponse {
  results: SearchResult[];
  meta?: SearchMeta;
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title: string;
      url: string;
      description: string;
    }>;
  };
}

const BRAVE_RATE_LIMIT_MS = 1000;
const BRAVE_CACHE_TTL_MS = 10 * 60 * 1000;
const BRAVE_MAX_RETRIES = 5;
const BRAVE_MAX_BACKOFF_MS = 15000;

const braveCache = new Map<string, { timestamp: number; results: SearchResult[] }>();
let braveLastRequestAt = 0;
let braveQueue: Promise<unknown> = Promise.resolve();

/**
 * Resolve which search provider to use (Brave → Google → DuckDuckGo)
 */
async function resolveSearchProvider(): Promise<{
  provider: "brave" | "google" | "duckduckgo";
  apiKey?: string;
  engineId?: string;
  maxResults?: number;
}> {
  try {
    // Check if Brave API key is stored
    const settings = AppSettingsRepo.get();
    const apiHub = settings?.apiHub as any;
    
    if (apiHub?.records) {
      const braveRecord = apiHub.records.find((r: any) => r.provider === "brave");
      if (braveRecord) {
        // Try to retrieve the API key from secure storage
        try {
          const braveField = braveRecord.fields.find((f: any) => f.key === "API_KEY");
          if (braveField) {
            const apiKey = await getSecret(braveField.account);
            if (apiKey) {
              const maxResults = braveRecord.config?.MAX_RESULTS ? parseInt(braveRecord.config.MAX_RESULTS, 10) || 5 : 5;
              return { provider: "brave", apiKey, maxResults };
            }
          }
        } catch (err) {
          console.warn("[webSearch] Failed to retrieve Brave API key from secure storage:", err);
        }
      }
    }

    // Fall back to Google Custom Search
    const googleKey = process.env.GOOGLE_CUSTOM_SEARCH_API_KEY;
    const googleEngineId = process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID;
    if (googleKey && googleEngineId) {
      return { provider: "google", apiKey: googleKey, engineId: googleEngineId };
    }

    // Default to free DuckDuckGo
    return { provider: "duckduckgo" };
  } catch (err) {
    console.warn("[webSearch] Error resolving provider, defaulting to DuckDuckGo:", err);
    return { provider: "duckduckgo" };
  }
}

/**
 * Fetch with timeout using AbortController
 */
async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scheduleBraveRequest<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, BRAVE_RATE_LIMIT_MS - (now - braveLastRequestAt));
    if (waitMs > 0) {
      await sleep(waitMs);
    }
    braveLastRequestAt = Date.now();
    return fn();
  };

  const next = braveQueue.then(run, run) as Promise<T>;
  braveQueue = next.catch(() => undefined);
  return next;
}

function parseRetryAfterMs(retryAfterHeader: string | null): number | undefined {
  if (!retryAfterHeader) return undefined;
  const seconds = Number(retryAfterHeader);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, BRAVE_MAX_BACKOFF_MS);
  }
  const parsed = Date.parse(retryAfterHeader);
  if (!Number.isNaN(parsed)) {
    const ms = parsed - Date.now();
    return ms > 0 ? Math.min(ms, BRAVE_MAX_BACKOFF_MS) : undefined;
  }
  return undefined;
}

/**
 * Search using Brave Search API
 */
async function searchWebBrave(
  apiKey: string,
  query: string,
  maxResults: number,
  options?: SearchOptions,
): Promise<SearchResponse> {
  const cacheKey = `${query}::${maxResults}::${options?.freshness ?? "none"}`;
  const cached = braveCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < BRAVE_CACHE_TTL_MS) {
    return {
      results: cached.results,
      meta: { provider: "brave", cacheHit: true },
    };
  }

  return scheduleBraveRequest(async () => {
    let attempt = 0;
    let hadRateLimit = false;
    let lastRetryAfterMs: number | undefined;

    while (attempt < BRAVE_MAX_RETRIES) {
      attempt += 1;
      try {
        console.log(`[webSearch] Attempting Brave Search for: ${query} (attempt ${attempt})`);

        const params = new URLSearchParams({
          q: query,
          count: maxResults.toString(),
        });
        if (options?.freshness) {
          params.set("freshness", options.freshness);
        }

        const response = await fetchWithTimeout(
          `https://api.search.brave.com/res/v1/web/search?${params}`,
          {
            method: "GET",
            headers: {
              "Accept": "application/json",
              "Accept-Encoding": "gzip",
              "X-Subscription-Token": apiKey,
            },
          },
          10000
        );

        if (response.status === 429) {
          hadRateLimit = true;
          lastRetryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"));
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), BRAVE_MAX_BACKOFF_MS);
          const delayMs = lastRetryAfterMs ?? backoffMs;
          console.warn(`[webSearch] Brave rate limited (429). Backing off for ${delayMs}ms.`);
          await sleep(delayMs);
          continue;
        }

        if (!response.ok) {
          console.warn(`[webSearch] Brave returned ${response.status}`);
          return {
            results: [],
            meta: { provider: "brave", attemptCount: attempt },
          };
        }

        const data = (await response.json()) as BraveSearchResponse;
        const results: SearchResult[] = [];

        if (data?.web?.results && Array.isArray(data.web.results)) {
          for (const result of data.web.results) {
            if (result.title && result.url) {
              results.push({
                title: result.title,
                url: result.url,
                snippet: result.description || "",
                source: "brave",
              });
            }
          }
        }

        braveCache.set(cacheKey, { timestamp: Date.now(), results });
        console.log(`[webSearch] Brave returned ${results.length} results`);
        return {
          results,
          meta: {
            provider: "brave",
            rateLimited: hadRateLimit,
            rateLimitedProvider: hadRateLimit ? "brave" : undefined,
            retryAfterMs: lastRetryAfterMs,
            attemptCount: attempt,
          },
        };
      } catch (err) {
        const isTimeout = err instanceof Error && err.name === "AbortError";
        if (isTimeout) {
          console.warn("[webSearch] Brave Search timed out (10s)");
        } else {
          console.warn("[webSearch] Brave Search failed:", err instanceof Error ? err.message : String(err));
        }
        break;
      }
    }

    return {
      results: [],
      meta: {
        provider: "brave",
        rateLimited: true,
        rateLimitedProvider: "brave",
        retryAfterMs: lastRetryAfterMs,
        attemptCount: BRAVE_MAX_RETRIES,
      },
    };
  });
}

/**
 * Search the web using DuckDuckGo (no API key required)
 * Falls back gracefully if search fails
 */
async function searchWebDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    console.log(`[webSearch] Attempting DuckDuckGo for: ${query}`);
    
    // DuckDuckGo Lite API (simplified, no JS required)
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}&format=json`;

    const response = await fetchWithTimeout(
      searchUrl,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        },
      },
      10000
    );

    if (!response.ok) {
      console.warn(`[webSearch] DuckDuckGo returned ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const results: SearchResult[] = [];

    // Extract results from DuckDuckGo response
    if (data.Results && Array.isArray(data.Results)) {
      for (const result of data.Results.slice(0, maxResults)) {
        if (result.FirstURL && result.Result) {
          results.push({
            title: stripHtml(result.Result) || "Result",
            url: result.FirstURL,
            snippet: stripHtml(result.Text) || "",
            source: "duckduckgo",
          });
        }
      }
    }

    console.log(`[webSearch] DuckDuckGo returned ${results.length} results`);
    return results;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    if (isTimeout) {
      console.warn("[webSearch] DuckDuckGo timed out (10s)");
    } else {
      console.warn("[webSearch] DuckDuckGo search failed:", err instanceof Error ? err.message : String(err));
    }
    return [];
  }
}

/**
 * Search using Google Custom Search (requires API key)
 * Set GOOGLE_CUSTOM_SEARCH_API_KEY and GOOGLE_CUSTOM_SEARCH_ENGINE_ID env vars
 */
async function searchWebGoogle(apiKey: string, engineId: string, query: string, maxResults: number): Promise<SearchResult[]> {
  try {
    console.log(`[webSearch] Attempting Google Custom Search for: ${query}`);
    
    const searchUrl = new URL("https://www.googleapis.com/customsearch/v1");
    searchUrl.searchParams.append("q", query);
    searchUrl.searchParams.append("key", apiKey);
    searchUrl.searchParams.append("cx", engineId);
    searchUrl.searchParams.append("num", String(maxResults));

    const response = await fetchWithTimeout(searchUrl.toString(), {}, 10000);

    if (!response.ok) {
      console.warn(`[webSearch] Google returned ${response.status}`);
      return [];
    }

    const data = (await response.json()) as any;
    const results: SearchResult[] = [];

    if (data.items && Array.isArray(data.items)) {
      for (const item of data.items) {
        results.push({
          title: item.title || "Result",
          url: item.link,
          snippet: item.snippet || "",
          source: "google",
        });
      }
    }

    console.log(`[webSearch] Google returned ${results.length} results`);
    return results;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    if (isTimeout) {
      console.warn("[webSearch] Google Search timed out (10s)");
    } else {
      console.warn("[webSearch] Google search failed:", err instanceof Error ? err.message : String(err));
    }
    return [];
  }
}

/**
 * Search the web with intelligent multi-provider fallback
 * Tries: Brave → Google → DuckDuckGo
 */
export async function searchWeb(query: string, maxResults = 5, options?: SearchOptions): Promise<SearchResult[]> {
  const response = await searchWebWithStatus(query, maxResults, options);
  return response.results;
}

export async function searchWebWithStatus(
  query: string,
  maxResults = 5,
  options?: SearchOptions,
): Promise<SearchResponse> {
  const config = await resolveSearchProvider();
  let rateLimitMeta: SearchMeta | undefined;

  if (config.provider === "brave" && config.apiKey) {
    const braveResponse = await searchWebBrave(config.apiKey, query, maxResults, options);
    if (braveResponse.results.length > 0) {
      return braveResponse;
    }
    if (braveResponse.meta?.rateLimited) {
      rateLimitMeta = {
        rateLimited: true,
        rateLimitedProvider: "brave",
        retryAfterMs: braveResponse.meta.retryAfterMs,
        attemptCount: braveResponse.meta.attemptCount,
      };
    }
    console.log("[webSearch] Brave returned no results, falling back to secondary provider");
  }

  if (config.provider === "google" && config.apiKey && config.engineId) {
    const results = await searchWebGoogle(config.apiKey, config.engineId, query, maxResults);
    if (results.length > 0) {
      return { results, meta: { provider: "google", ...rateLimitMeta } };
    }
    console.log("[webSearch] Google returned no results, falling back to DuckDuckGo");
  }

  const duckResults = await searchWebDuckDuckGo(query, maxResults);
  return { results: duckResults, meta: { provider: "duckduckgo", ...rateLimitMeta } };
}

/**
 * Strip HTML tags from text
 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

/**
 * Format search results into a context block for the advisor
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No search results available.";
  }

  const sourceInfo = results[0]?.source 
    ? ` (Source: ${results[0].source === "brave" ? "🌐 Brave Search" : results[0].source === "google" ? "🔍 Google Search" : "📦 DuckDuckGo"})`
    : "";

  return (
    `### Search Results${sourceInfo} ###\n` +
    results
      .map(
        (r, i) =>
          `[${i + 1}] "${r.title}"\nURL: ${r.url}\nSnippet: ${r.snippet}`
      )
      .join("\n\n") +
    "\n"
  );
}
