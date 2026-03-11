/**
 * Economic Calendar - AI-powered macro event ingestion and normalization
 */

export interface EconomicEvent {
  id: string; // Unique ID (hash of source + datetime + event)
  title: string; // Event name (e.g., "CPI MoM", "Non-Farm Payrolls")
  country: string; // ISO-3166 code (US, GB, DE, etc.)
  region?: string; // Region/state if applicable (e.g., "Eurozone" for EU)
  eventCategory: 'inflation' | 'employment' | 'growth' | 'trade' | 'housing' | 'confidence' | 'other';
  
  releaseDateTime: Date; // When the data will be/was released
  timezone: string; // IANA timezone (e.g., "America/New_York")
  
  // Data values
  previousValue?: number | null;
  forecastValue?: number | null;
  actualValue?: number | null;
  
  unit?: string; // Unit of measurement (%, millions, etc.)
  period?: string; // Period covered (e.g., "Jan 2025", "Q4 2024")
  
  // Importance (1-3 where 3 is most important)
  importance: 1 | 2 | 3;
  
  // Source tracking
  sources: EventSource[];
  lastFetched: Date;
  
  // Status
  status: 'upcoming' | 'released' | 'revised';
  
  // Optional enrichment
  summary?: string; // AI-generated summary (e.g., "Beat forecast by 0.5pp")
  changeVsForcast?: number | null; // actual - forecast
  changeVsPrevious?: number | null; // actual - previous
  confidenceScore?: number; // 0-1 score describing adapter + data quality
  confidenceLabel?: 'low' | 'medium' | 'high' | 'critical';
  adapterConfidence?: AdapterConfidence[];
  
  metadata?: Record<string, string | number | boolean>;
}

export interface EventSource {
  name: 'FRED' | 'BLS' | 'BEA' | 'Census' | 'TradingEconomics' | 'Finnhub' | 'AlphaVantage' | 'ECB' | 'Other';
  url?: string;
  sourceId?: string; // Identifier in the source system
  fetchedAt: Date;
  latencyMs?: number;
  confidenceHint?: number;
}

export interface AdapterConfidence {
  source: EventSource['name'];
  score: number;
  reason: string;
}

export interface CalendarFilters {
  startDate?: Date;
  endDate?: Date;
  countries?: string[];
  categories?: EconomicEvent['eventCategory'][];
  importance?: 1 | 2 | 3;
  status?: 'upcoming' | 'released' | 'revised';
}

export interface FetcherConfig {
  enabled: boolean;
  apiKey?: string;
  secret?: string;
  rateLimit?: number; // requests per minute
  cacheTTL?: number; // seconds
}

export interface FetcherResult {
  events: EconomicEvent[];
  source: EventSource['name'];
  fetchedAt: Date;
  errors?: string[];
}

export type CalendarInsightFocus = 'upcoming' | 'released';

export interface CalendarInsightRequestEvent {
  id: string;
  title: string;
  releaseDateTime: string;
  status: EconomicEvent['status'];
  importance: EconomicEvent['importance'];
  eventCategory: EconomicEvent['eventCategory'];
  country: string;
  confidenceScore?: number;
  summary?: string;
}

export interface CalendarInsightRequest {
  focus: CalendarInsightFocus;
  windowHours: number;
  events: CalendarInsightRequestEvent[];
  model?: string;
}

export interface CalendarInsightResponse {
  aiEngine: 'cloud' | 'local' | 'heuristic';
  generatedAt: string;
  headline: string;
  synopsis: string;
  bullets: string[];
  riskSignals: Array<{ label: string; detail: string; severity: 'low' | 'medium' | 'high' }>;
  focusEvents: Array<{
    id: string;
    title: string;
    eta: string;
    status: EconomicEvent['status'];
    importance: EconomicEvent['importance'];
    aiView: string;
  }>;
}
