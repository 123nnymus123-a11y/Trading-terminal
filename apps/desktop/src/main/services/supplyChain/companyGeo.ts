import crypto from "node:crypto";

/**
 * Rate limiter for Nominatim API.
 * Nominatim allows ~1 request/second. Track timing and enforce minimum inter-request delay.
 */
class NominatimRateLimiter {
  private lastRequestTime = 0;
  private minDelayMs = 1100; // 1.1s = slightly more than 1 req/sec
  private rateLimitRetryDelayMs = 5000; // When we hit 429, wait 5s before next retry
  private requestQueue: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];
  private isProcessing = false;

  async acquire(for429: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject });
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  private async processQueue(): Promise<void> {
    this.isProcessing = true;
    while (this.requestQueue.length > 0) {
      const item = this.requestQueue.shift();
      if (!item) continue;

      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;
      const delayNeeded = this.minDelayMs - timeSinceLastRequest;

      if (delayNeeded > 0) {
        await new Promise((r) => setTimeout(r, delayNeeded));
      }

      this.lastRequestTime = Date.now();
      item.resolve();
    }
    this.isProcessing = false;
  }

  incrementRetryDelay(): void {
    // When we get 429, increase the minimum delay
    this.minDelayMs = Math.min(10000, this.minDelayMs + 2000);
  }

  decrementRetryDelay(): void {
    // Gradually lower it back when requests succeed
    this.minDelayMs = Math.max(1100, this.minDelayMs - 100);
  }
}

const nominatimLimiter = new NominatimRateLimiter();

// Simple LRU cache for recent geocoding requests
class GeoCache {
  private cache = new Map<
    string,
    { result: CompanyGeo | null; timestamp: number }
  >();
  private maxAge = 3600000; // 1 hour

  get(key: string): CompanyGeo | null | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp > this.maxAge) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }

  set(key: string, result: CompanyGeo | null): void {
    this.cache.set(key, { result, timestamp: Date.now() });
  }

  private getCacheKey(name: string, hints?: CompanyGeoHints): string {
    const hintsStr = hints
      ? `${hints.city}|${hints.state}|${hints.country}`
      : "";
    return `${name}|${hintsStr}`;
  }

  getFor(name: string, hints?: CompanyGeoHints): CompanyGeo | null | undefined {
    return this.get(this.getCacheKey(name, hints));
  }

  setFor(
    name: string,
    hints: CompanyGeoHints | undefined,
    result: CompanyGeo | null,
  ): void {
    this.set(this.getCacheKey(name, hints), result);
  }
}

const geoCache = new GeoCache();

export interface CompanyGeo {
  lat: number;
  lon: number;
  city?: string;
  state?: string;
  country?: string;
  source: string;
  retrievalHash: string;
}

export interface CompanyGeoHints {
  city?: string;
  state?: string;
  country?: string;
}

const LEGAL_SUFFIX_PATTERN =
  /\b(incorporated|inc|corp|corporation|ltd|limited|llc|plc|ag|sa|nv|co|company|holdings?|group)\b/gi;
const COUNTRY_ALIASES: Record<string, string> = {
  usa: "united states",
  us: "united states",
  "u.s.": "united states",
  "u.s.a.": "united states",
  "united states of america": "united states",
  uk: "united kingdom",
  "u.k.": "united kingdom",
  uae: "united arab emirates",
};

function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeCompanyKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizeHintText(value?: string) {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCountry(value?: string) {
  const normalized = normalizeHintText(value);
  if (!normalized) return "";
  return COUNTRY_ALIASES[normalized] ?? normalized;
}

function stripLegalSuffixes(value: string) {
  return value
    .replace(LEGAL_SUFFIX_PATTERN, " ")
    .replace(/[^a-zA-Z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCompanyTokens(value: string) {
  return stripLegalSuffixes(value)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

const curatedGeo: Record<string, Omit<CompanyGeo, "retrievalHash">> = {
  siemens: {
    lat: 48.1351,
    lon: 11.582,
    city: "Munich",
    country: "Germany",
    source: "curated",
  },
  siemensag: {
    lat: 48.1351,
    lon: 11.582,
    city: "Munich",
    country: "Germany",
    source: "curated",
  },
  apple: {
    lat: 37.3349,
    lon: -122.009,
    city: "Cupertino",
    state: "California",
    country: "United States",
    source: "curated",
  },
  aapl: {
    lat: 37.3349,
    lon: -122.009,
    city: "Cupertino",
    state: "California",
    country: "United States",
    source: "curated",
  },
  appleinc: {
    lat: 37.3349,
    lon: -122.009,
    city: "Cupertino",
    state: "California",
    country: "United States",
    source: "curated",
  },
};

function getCuratedGeo(companyName: string): CompanyGeo | null {
  const key = normalizeCompanyKey(companyName);
  const strippedKey = normalizeCompanyKey(stripLegalSuffixes(companyName));
  const hit =
    curatedGeo[key] ?? (strippedKey ? curatedGeo[strippedKey] : undefined);
  if (!hit) return null;
  return {
    ...hit,
    retrievalHash: hash(`curated|${key}|${hit.lat}|${hit.lon}`),
  };
}

async function fetchCandidates(query: string) {
  // Acquire rate limiter slot
  await nominatimLimiter.acquire();

  const controller = new AbortController();
  const timeoutMs = 8000;
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=6&addressdetails=1`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TradingCockpit/1.0 (supply-chain-geocoder)",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      // 429 = rate limited, other 5xx = transient server error
      if (res.status === 429 || res.status >= 500) {
        if (res.status === 429) {
          nominatimLimiter.incrementRetryDelay();
        }
        throw new Error(`nominatim_http_${res.status}`);
      }
      return [] as Array<{
        lat: string;
        lon: string;
        display_name?: string;
        importance?: number;
        class?: string;
        type?: string;
        address?: {
          city?: string;
          town?: string;
          village?: string;
          state?: string;
          country?: string;
        };
      }>;
    }

    return (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name?: string;
      importance?: number;
      class?: string;
      type?: string;
      address?: {
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        country?: string;
      };
    }>;
  } catch (error) {
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCandidatesWithRetry(query: string) {
  // Keep retries short so supply-chain generation does not block for minutes.
  const retryConfig = [
    { delayMs: 0, maxRetries: 1 },
    { delayMs: 600, maxRetries: 1 },
    { delayMs: 1400, maxRetries: 1 },
  ];

  let lastError: unknown = null;
  let is429 = false;

  for (const config of retryConfig) {
    for (let attempt = 0; attempt < config.maxRetries; attempt += 1) {
      if (config.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      }

      try {
        const result = await fetchCandidates(query);
        if (result.length > 0) {
          // Success: gradually relax the rate limiter
          nominatimLimiter.decrementRetryDelay();
          return result;
        }
      } catch (error) {
        lastError = error;
        const errStr = String(error);
        is429 = errStr.includes("429");
        if (!is429) {
          // Non-rate-limit errors: don't retry aggressively.
          break;
        }
      }
    }

    if (is429 && config.delayMs >= 1400) {
      // Avoid long user-facing stalls under sustained rate limiting.
      break;
    }
  }

  if (lastError) {
    console.warn("[companyGeo] geocode request failed after retries", {
      query,
      error: String(lastError),
    });
  }

  return [] as Array<{
    lat: string;
    lon: string;
    display_name?: string;
    importance?: number;
    class?: string;
    type?: string;
    address?: {
      city?: string;
      town?: string;
      village?: string;
      state?: string;
      country?: string;
    };
  }>;
}

function scoreCandidates(
  companyName: string,
  hints: CompanyGeoHints | undefined,
  candidates: Array<{
    lat: string;
    lon: string;
    display_name?: string;
    importance?: number;
    class?: string;
    type?: string;
    address?: {
      city?: string;
      town?: string;
      village?: string;
      state?: string;
      country?: string;
    };
  }>,
) {
  const normalizedName = normalizeHintText(companyName);
  const nameTokens = buildCompanyTokens(companyName);
  const hintCity = normalizeHintText(hints?.city);
  const hintState = normalizeHintText(hints?.state);
  const hintCountry = normalizeCountry(hints?.country);

  return candidates.map((hit) => {
    let score = hit.importance ?? 0;
    const display = normalizeHintText(hit.display_name ?? "");
    const address = hit.address ?? {};
    const addressCity = normalizeHintText(
      address.city ?? address.town ?? address.village ?? "",
    );
    const addressState = normalizeHintText(address.state ?? "");
    const addressCountry = normalizeCountry(address.country ?? "");

    if (display.includes(normalizedName)) score += 0.6;
    if (nameTokens.length > 0) {
      const matched = nameTokens.filter((token) =>
        display.includes(token),
      ).length;
      score += Math.min(0.5, matched * 0.18);
    }
    if (
      hintCity &&
      (display.includes(hintCity) || addressCity.includes(hintCity))
    )
      score += 0.45;
    if (
      hintState &&
      (display.includes(hintState) || addressState.includes(hintState))
    )
      score += 0.35;
    if (
      hintCountry &&
      (display.includes(hintCountry) || addressCountry.includes(hintCountry))
    )
      score += 0.3;
    if (hit.class === "office" || hit.type === "office") score += 0.5;
    if (hit.type === "company") score += 0.4;
    if (display.includes("headquarters") || display.includes("hq"))
      score += 0.2;
    return { hit, score };
  });
}

export async function resolveCompanyGeo(
  companyName: string,
  hints?: CompanyGeoHints,
): Promise<CompanyGeo | null> {
  const curated = getCuratedGeo(companyName);
  if (curated) return curated;

  // Check cache first to avoid redundant Nominatim calls
  const cached = geoCache.getFor(companyName, hints);
  if (cached !== undefined) {
    return cached;
  }

  const cleanedName = stripLegalSuffixes(companyName) || companyName;
  const isTickerLike = /^[A-Z0-9]{1,5}$/.test(cleanedName.trim());
  const baseName = isTickerLike ? `${cleanedName} company` : cleanedName;
  const hintParts = [hints?.city, hints?.state, hints?.country]
    .filter(Boolean)
    .join(", ");
  const firstQuery = hintParts
    ? `${baseName} headquarters, ${hintParts}`
    : `${baseName} headquarters`;
  const secondQuery = hintParts
    ? `${baseName} HQ ${hintParts}`
    : `${baseName} headquarters address`;

  const firstCandidates = await fetchCandidatesWithRetry(firstQuery);
  const firstScored = scoreCandidates(companyName, hints, firstCandidates).sort(
    (a, b) => b.score - a.score,
  );
  const firstBest = firstScored[0];

  const needSecondPass = !firstBest || (firstBest.score < 0.35 && hintParts);
  const secondCandidates = needSecondPass
    ? await fetchCandidatesWithRetry(secondQuery)
    : [];
  const secondScored = scoreCandidates(
    companyName,
    hints,
    secondCandidates,
  ).sort((a, b) => b.score - a.score);

  const best =
    secondScored[0] &&
    (!firstBest || secondScored[0].score > firstBest.score + 0.05)
      ? secondScored[0]
      : firstBest;

  const hit = best?.hit;
  let result: CompanyGeo | null = null;

  if (hit) {
    const lat = Number(hit.lat);
    const lon = Number(hit.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      const address = hit.address ?? {};
      const city = address.city ?? address.town ?? address.village;
      const state = address.state;
      const country = address.country;
      result = {
        lat,
        lon,
        ...(city ? { city } : {}),
        ...(state ? { state } : {}),
        ...(country ? { country } : {}),
        source: "nominatim",
        retrievalHash: hash(`${companyName}|${hit.lat}|${hit.lon}`),
      };
    }
  }

  // Cache result (including null) to avoid re-requesting
  geoCache.setFor(companyName, hints, result);
  return result;
}
