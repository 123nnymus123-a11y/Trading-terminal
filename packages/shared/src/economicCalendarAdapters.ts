/**
 * Economic Calendar API Adapters
 * Fetches macro event data from multiple sources and normalizes to EconomicEvent format
 */

import {
  EconomicEvent,
  FetcherConfig,
  FetcherResult,
} from "./economicCalendar.js";
import { createLogger } from "./logger.js";

const logger = createLogger({ scope: "EconCalendarAdapters" });

type FredObservation = { date?: string; value?: string };
type FredResponse = { observations?: FredObservation[] };

type BLSDataPoint = { value?: string; periodName?: string; year?: string };
type BLSSeries = { data?: BLSDataPoint[] };
type BLSResponse = { Results?: { series?: BLSSeries[] } };

type BEADataPoint = { DataValue?: string; TimePeriod?: string };
type BEAResponse = { Results?: { Data?: BEADataPoint[] } };

type CensusResponse = Array<string[]>;

type TradingEconomicsEvent = {
  CountryCode?: string;
  Event?: string;
  Region?: string;
  Category?: string;
  DateTime?: string;
  Actual?: string | number;
  Forecast?: string | number;
  Previous?: string | number;
  Importance?: string;
};
type TradingEconomicsResponse = TradingEconomicsEvent[];

type FinnhubEvent = {
  country?: string;
  event?: string;
  date?: number | string;
  impact?: string;
  actual?: string | number;
  forecast?: string | number;
  previous?: string | number;
};
type FinnhubResponse = { economicCalendar?: FinnhubEvent[] };

type AlphaVantagePoint = { date?: string; value?: string };
type AlphaVantageResponse = { data?: AlphaVantagePoint[]; Note?: string };

const parseNumber = (
  value: string | number | undefined | null,
): number | null => {
  if (value === null || value === undefined) return null;
  const num = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(num) ? num : null;
};

const parseDate = (value?: string | number): Date => {
  if (typeof value === "number") {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms);
  }
  if (typeof value === "string") return new Date(value);
  return new Date();
};

// ============================================================================
// FRED (Federal Reserve Economic Data) - US Focus
// ============================================================================

export interface FREDAdapter {
  fetch(config: FetcherConfig): Promise<FetcherResult>;
}

export const fredAdapter: FREDAdapter = {
  async fetch(config: FetcherConfig): Promise<FetcherResult> {
    if (!config.enabled || !config.apiKey) {
      return {
        events: [],
        source: "FRED",
        fetchedAt: new Date(),
        errors: ["FRED disabled or no API key"],
      };
    }

    try {
      const events: EconomicEvent[] = [];

      // Key FRED series for macro events
      const series = [
        {
          id: "CPIAUCSL",
          title: "CPI - All Urban Consumers",
          category: "inflation" as const,
        },
        {
          id: "PAYEMS",
          title: "Total Nonfarm Payroll",
          category: "employment" as const,
        },
        {
          id: "ICSA",
          title: "Initial Claims",
          category: "employment" as const,
        },
        { id: "RSXFS", title: "Retail Sales", category: "growth" as const },
        { id: "HOUST", title: "Housing Starts", category: "housing" as const },
        {
          id: "UMCSENT",
          title: "University of Michigan: Consumer Sentiment",
          category: "confidence" as const,
        },
      ];

      for (const ser of series) {
        try {
          const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${ser.id}&api_key=${config.apiKey}&file_type=json`;
          const response = await fetch(url);
          if (!response.ok) continue;

          const data: FredResponse = await response.json();
          if (data.observations && data.observations.length > 0) {
            const latest = data.observations[data.observations.length - 1];
            if (!latest?.date) continue;
            const prevIdx = Math.max(0, data.observations.length - 2);
            const prev = data.observations[prevIdx];

            const event: EconomicEvent = {
              id: `fred-${ser.id}-${latest.date}`,
              title: ser.title,
              country: "US",
              eventCategory: ser.category,
              releaseDateTime: parseDate(latest.date),
              timezone: "America/New_York",
              actualValue: parseNumber(latest.value),
              previousValue: parseNumber(prev?.value),
              importance: 2,
              sources: [
                { name: "FRED", sourceId: ser.id, fetchedAt: new Date() },
              ],
              lastFetched: new Date(),
              status: "released",
            };

            events.push(event);
          }
        } catch (e) {
          logger.warn(`Failed to fetch FRED series ${ser.id}:`, e);
        }
      }

      return { events, source: "FRED", fetchedAt: new Date() };
    } catch (error) {
      logger.error("FRED adapter error:", error);
      return {
        events: [],
        source: "FRED",
        fetchedAt: new Date(),
        errors: [String(error)],
      };
    }
  },
};

// ============================================================================
// BLS (Bureau of Labor Statistics) - US Employment & CPI Detail
// ============================================================================

export interface BLSAdapter {
  fetch(config: FetcherConfig): Promise<FetcherResult>;
}

export const blsAdapter: BLSAdapter = {
  async fetch(config: FetcherConfig): Promise<FetcherResult> {
    if (!config.enabled || !config.apiKey) {
      return {
        events: [],
        source: "BLS",
        fetchedAt: new Date(),
        errors: ["BLS disabled or no API key"],
      };
    }

    try {
      const events: EconomicEvent[] = [];

      // Key BLS series (BLS series IDs)
      const series = [
        {
          id: "CUUR0000SA0",
          title: "CPI-U - All Items",
          category: "inflation" as const,
        },
        {
          id: "CUUR0000SA0L1E",
          title: "CPI-U - Core (ex-food,energy)",
          category: "inflation" as const,
        },
        {
          id: "CES0000000001",
          title: "Total Nonfarm Employment",
          category: "employment" as const,
        },
        {
          id: "LNS14000000",
          title: "Unemployment Rate",
          category: "employment" as const,
        },
      ];

      for (const ser of series) {
        try {
          const body = {
            seriesid: [ser.id],
            startyear: new Date().getFullYear() - 1,
            endyear: new Date().getFullYear(),
            registrationkey: config.apiKey,
          };

          const response = await fetch(
            "https://api.bls.gov/publicAPI/v2/timeseries/data/",
            {
              method: "POST",
              body: JSON.stringify(body),
              headers: { "Content-Type": "application/json" },
            },
          );

          if (!response.ok) continue;

          const data: BLSResponse = await response.json();
          if (data.Results?.series?.[0]?.data?.[0]) {
            const latest = data.Results.series[0].data[0];
            const prev = data.Results.series[0].data[1] || {};

            const event: EconomicEvent = {
              id: `bls-${ser.id}-${latest.periodName}`,
              title: ser.title,
              country: "US",
              eventCategory: ser.category,
              releaseDateTime: new Date(),
              timezone: "America/New_York",
              actualValue: latest.value ? parseFloat(latest.value) : null,
              previousValue: prev.value ? parseFloat(prev.value) : null,
              period: `${latest.periodName} ${latest.year}`,
              importance: 2,
              sources: [
                { name: "BLS", sourceId: ser.id, fetchedAt: new Date() },
              ],
              lastFetched: new Date(),
              status: "released",
            };

            events.push(event);
          }
        } catch (e) {
          logger.warn(`Failed to fetch BLS series ${ser.id}:`, e);
        }
      }

      return { events, source: "BLS", fetchedAt: new Date() };
    } catch (error) {
      logger.error("BLS adapter error:", error);
      return {
        events: [],
        source: "BLS",
        fetchedAt: new Date(),
        errors: [String(error)],
      };
    }
  },
};

// ============================================================================
// BEA (Bureau of Economic Analysis) - GDP & Trade
// ============================================================================

export interface BEAAdapter {
  fetch(config: FetcherConfig): Promise<FetcherResult>;
}

export const beaAdapter: BEAAdapter = {
  async fetch(config: FetcherConfig): Promise<FetcherResult> {
    if (!config.enabled || !config.apiKey) {
      return {
        events: [],
        source: "BEA",
        fetchedAt: new Date(),
        errors: ["BEA disabled or no API key"],
      };
    }

    try {
      const events: EconomicEvent[] = [];

      // GDP and key trade series
      const datasets = [
        {
          name: "NIPA",
          table: "T10101",
          title: "Real GDP",
          category: "growth" as const,
        },
        {
          name: "ITA",
          table: "ITAsb1",
          title: "International Trade in Services",
          category: "trade" as const,
        },
      ];

      for (const ds of datasets) {
        try {
          const url = `https://apps.bea.gov/api/data?UserID=${config.apiKey}&dataset=${ds.name}&table=${ds.table}&frequency=Q&format=JSON`;
          const response = await fetch(url);
          if (!response.ok) continue;

          const data: BEAResponse = await response.json();
          // BEA API returns complex hierarchical data; simplified extraction here
          if (data.Results?.Data?.[0]) {
            const latest = data.Results.Data[0];

            const event: EconomicEvent = {
              id: `bea-${ds.name}-${ds.table}`,
              title: ds.title,
              country: "US",
              eventCategory: ds.category,
              releaseDateTime: new Date(),
              timezone: "America/New_York",
              actualValue: parseNumber(latest.DataValue),
              importance: 3,
              sources: [
                { name: "BEA", sourceId: ds.table, fetchedAt: new Date() },
              ],
              lastFetched: new Date(),
              status: "released",
            };

            if (latest.TimePeriod) {
              event.period = latest.TimePeriod;
            }

            events.push(event);
          }
        } catch (e) {
          logger.warn(`Failed to fetch BEA dataset ${ds.name}:`, e);
        }
      }

      return { events, source: "BEA", fetchedAt: new Date() };
    } catch (error) {
      logger.error("BEA adapter error:", error);
      return {
        events: [],
        source: "BEA",
        fetchedAt: new Date(),
        errors: [String(error)],
      };
    }
  },
};

// ============================================================================
// Census Bureau - Housing, Retail, Manufacturing
// ============================================================================

export interface CensusAdapter {
  fetch(config: FetcherConfig): Promise<FetcherResult>;
}

export const censusAdapter: CensusAdapter = {
  async fetch(config: FetcherConfig): Promise<FetcherResult> {
    if (!config.enabled || !config.apiKey) {
      return {
        events: [],
        source: "Census",
        fetchedAt: new Date(),
        errors: ["Census disabled or no API key"],
      };
    }

    try {
      const events: EconomicEvent[] = [];

      // Sample Census series (Housing Starts, Building Permits, Retail Sales)
      const series = [
        { id: "HOUST", title: "Housing Starts", category: "housing" as const },
        {
          id: "PERMIT",
          title: "Building Permits",
          category: "housing" as const,
        },
        {
          id: "RSXFS",
          title: "Retail Sales - Total",
          category: "growth" as const,
        },
      ];

      // Census API requires authenticated requests; simplified approach using public endpoints
      for (const ser of series) {
        try {
          // This is a simplified call; real Census API calls require deeper integration
          const url = `https://api.census.gov/data/timeseries/eits/manufacturing?get=data_type_code,time_period_year,time_period_month,value&for=*&key=${config.apiKey}`;
          const response = await fetch(url);
          if (!response.ok) continue;

          const data: CensusResponse = await response.json();
          if (Array.isArray(data) && data.length > 1) {
            const latest = data[1];
            if (!latest) continue;

            const event: EconomicEvent = {
              id: `census-${ser.id}`,
              title: ser.title,
              country: "US",
              eventCategory: ser.category,
              releaseDateTime: new Date(),
              timezone: "America/New_York",
              actualValue: parseNumber(latest[3]),
              importance: 2,
              sources: [
                { name: "Census", sourceId: ser.id, fetchedAt: new Date() },
              ],
              lastFetched: new Date(),
              status: "released",
            };

            events.push(event);
          }
        } catch (e) {
          logger.warn(`Failed to fetch Census series ${ser.id}:`, e);
        }
      }

      return { events, source: "Census", fetchedAt: new Date() };
    } catch (error) {
      logger.error("Census adapter error:", error);
      return {
        events: [],
        source: "Census",
        fetchedAt: new Date(),
        errors: [String(error)],
      };
    }
  },
};

// ============================================================================
// Trading Economics - Global Economic Calendar (Upcoming Events)
// ============================================================================

export interface TradingEconomicsAdapter {
  fetch(config: FetcherConfig): Promise<FetcherResult>;
}

export const tradingEconomicsAdapter: TradingEconomicsAdapter = {
  async fetch(config: FetcherConfig): Promise<FetcherResult> {
    if (!config.enabled || !config.apiKey) {
      return {
        events: [],
        source: "TradingEconomics",
        fetchedAt: new Date(),
        errors: ["Trading Economics disabled or no API key"],
      };
    }

    try {
      const events: EconomicEvent[] = [];

      // Trading Economics Calendar API
      const url = `https://api.tradingeconomics.com/calendar?c=${config.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        return {
          events: [],
          source: "TradingEconomics",
          fetchedAt: new Date(),
          errors: ["API call failed"],
        };
      }

      const data: TradingEconomicsResponse = await response.json();

      if (Array.isArray(data)) {
        const categoryMap: Record<string, EconomicEvent["eventCategory"]> = {
          inflation: "inflation",
          employment: "employment",
          growth: "growth",
          trade: "trade",
          housing: "housing",
          confidence: "confidence",
        };

        for (const item of data.slice(0, 50)) {
          // Limit to 50 most recent
          try {
            const categoryKey = item.Category
              ? item.Category.toLowerCase()
              : undefined;
            const event: EconomicEvent = {
              id: `te-${item.CountryCode ?? "XX"}-${item.Event ?? "event"}-${item.DateTime ?? "unknown"}`,
              title: item.Event || "Unknown Event",
              country: item.CountryCode || "Unknown",
              eventCategory:
                categoryKey && categoryMap[categoryKey]
                  ? categoryMap[categoryKey]
                  : "other",
              releaseDateTime: parseDate(item.DateTime),
              timezone: "UTC",
              actualValue: parseNumber(item.Actual),
              forecastValue: parseNumber(item.Forecast),
              previousValue: parseNumber(item.Previous),
              importance:
                item.Importance === "High"
                  ? 3
                  : item.Importance === "Medium"
                    ? 2
                    : 1,
              sources: [
                {
                  name: "TradingEconomics",
                  ...(item.Event ? { sourceId: item.Event } : {}),
                  fetchedAt: new Date(),
                },
              ],
              lastFetched: new Date(),
              status: item.Actual !== undefined ? "released" : "upcoming",
            };

            if (item.Region) {
              event.region = item.Region;
            }

            if (item.Actual && item.Forecast) {
              event.changeVsForcast = event.actualValue! - event.forecastValue!;
            }

            events.push(event);
          } catch (e) {
            logger.warn("Failed to parse Trading Economics event:", e);
          }
        }
      }

      return { events, source: "TradingEconomics", fetchedAt: new Date() };
    } catch (error) {
      logger.error("Trading Economics adapter error:", error);
      return {
        events: [],
        source: "TradingEconomics",
        fetchedAt: new Date(),
        errors: [String(error)],
      };
    }
  },
};

// ============================================================================
// Finnhub - Global market & macro events
// ============================================================================

export interface FinnhubAdapter {
  fetch(config: FetcherConfig): Promise<FetcherResult>;
}

export const finnhubAdapter: FinnhubAdapter = {
  async fetch(config: FetcherConfig): Promise<FetcherResult> {
    if (!config.enabled || !config.apiKey) {
      return {
        events: [],
        source: "Finnhub",
        fetchedAt: new Date(),
        errors: ["Finnhub disabled or no API key"],
      };
    }

    try {
      const events: EconomicEvent[] = [];

      // Finnhub Economic Calendar
      const url = `https://finnhub.io/api/v1/calendar/economic?token=${config.apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        return {
          events: [],
          source: "Finnhub",
          fetchedAt: new Date(),
          errors: ["API call failed"],
        };
      }

      const data: FinnhubResponse = await response.json();

      if (data.economicCalendar && Array.isArray(data.economicCalendar)) {
        for (const item of data.economicCalendar.slice(0, 50)) {
          try {
            const event: EconomicEvent = {
              id: `finnhub-${item.country ?? "XX"}-${item.event ?? "event"}-${item.date ?? "unknown"}`,
              title: item.event || "Unknown Event",
              country: item.country || "Unknown",
              eventCategory: "other" as const, // Finnhub doesn't categorize; would need additional mapping
              releaseDateTime: parseDate(item.date),
              timezone: "UTC",
              actualValue: parseNumber(item.actual),
              forecastValue: parseNumber(item.forecast),
              previousValue: parseNumber(item.previous),
              importance:
                item.impact === "High" ? 3 : item.impact === "Medium" ? 2 : 1,
              sources: [
                {
                  name: "Finnhub",
                  ...(item.event ? { sourceId: item.event } : {}),
                  fetchedAt: new Date(),
                },
              ],
              lastFetched: new Date(),
              status: item.actual ? "released" : "upcoming",
            };

            events.push(event);
          } catch (e) {
            logger.warn("Failed to parse Finnhub event:", e);
          }
        }
      }

      return { events, source: "Finnhub", fetchedAt: new Date() };
    } catch (error) {
      logger.error("Finnhub adapter error:", error);
      return {
        events: [],
        source: "Finnhub",
        fetchedAt: new Date(),
        errors: [String(error)],
      };
    }
  },
};

// ============================================================================
// Alpha Vantage - Time series & technical indicators
// ============================================================================

export interface AlphaVantageAdapter {
  fetch(config: FetcherConfig): Promise<FetcherResult>;
}

export const alphaVantageAdapter: AlphaVantageAdapter = {
  async fetch(config: FetcherConfig): Promise<FetcherResult> {
    if (!config.enabled || !config.apiKey) {
      return {
        events: [],
        source: "AlphaVantage",
        fetchedAt: new Date(),
        errors: ["Alpha Vantage disabled or no API key"],
      };
    }

    try {
      const events: EconomicEvent[] = [];

      // Alpha Vantage offers inflation and employment data via TIME_SERIES_MONTHLY
      const indicators = [
        {
          symbol: "CPIAUCSL",
          title: "CPI - All Urban Consumers",
          category: "inflation" as const,
        },
        {
          symbol: "UNRATE",
          title: "Unemployment Rate",
          category: "employment" as const,
        },
      ];

      for (const ind of indicators) {
        try {
          const url = `https://www.alphavantage.co/query?function=TIME_SERIES_MONTHLY&symbol=${ind.symbol}&apikey=${config.apiKey}`;
          const response = await fetch(url);
          if (!response.ok) continue;

          const data: AlphaVantageResponse = await response.json();
          if (data.data && data.data.length > 0) {
            const latest = data.data[0];
            if (!latest?.date) continue;
            const prev = data.data[1];

            const event: EconomicEvent = {
              id: `av-${ind.symbol}-${latest.date}`,
              title: ind.title,
              country: "US",
              eventCategory: ind.category,
              releaseDateTime: parseDate(latest.date),
              timezone: "America/New_York",
              actualValue: parseNumber(latest.value),
              previousValue: parseNumber(prev?.value),
              importance: 2,
              sources: [
                {
                  name: "AlphaVantage",
                  sourceId: ind.symbol,
                  fetchedAt: new Date(),
                },
              ],
              lastFetched: new Date(),
              status: "released",
            };

            events.push(event);
          }
        } catch (e) {
          logger.warn(
            `Failed to fetch Alpha Vantage indicator ${ind.symbol}:`,
            e,
          );
        }
      }

      // Also fetch stock prices: SPY, QQQ, IWM
      const stocks = [
        { symbol: "SPY", title: "S&P 500 ETF", category: "equity" as const },
        { symbol: "QQQ", title: "Nasdaq 100 ETF", category: "equity" as const },
        {
          symbol: "IWM",
          title: "Russell 2000 ETF",
          category: "equity" as const,
        },
      ];

      for (const stock of stocks) {
        try {
          const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${stock.symbol}&apikey=${config.apiKey}`;
          const response = await fetch(url);
          if (!response.ok) continue;

          const data: any = await response.json();
          if (data["Global Quote"] && data["Global Quote"].price) {
            const quote = data["Global Quote"];
            const price = parseNumber(quote.price);
            const change = parseNumber(quote.change);

            const event: EconomicEvent = {
              id: `av-stock-${stock.symbol}-${new Date().toISOString()}`,
              title: `${stock.symbol} Trading Price`,
              country: "US",
              eventCategory: "other" as EconomicEvent["eventCategory"],
              releaseDateTime: new Date(),
              timezone: "America/New_York",
              actualValue: price,
              previousValue: price && change ? price - change : null,
              importance: 1,
              sources: [
                {
                  name: "AlphaVantage",
                  sourceId: stock.symbol,
                  fetchedAt: new Date(),
                },
              ],
              lastFetched: new Date(),
              status: "released",
            };

            events.push(event);
          }
        } catch (e) {
          logger.warn(`Failed to fetch stock ${stock.symbol}:`, e);
        }
      }

      return { events, source: "AlphaVantage", fetchedAt: new Date() };
    } catch (error) {
      logger.error("Alpha Vantage adapter error:", error);
      return {
        events: [],
        source: "AlphaVantage",
        fetchedAt: new Date(),
        errors: [String(error)],
      };
    }
  },
};
