/**
 * PANORAMA MVP Dashboard Data Types
 * Decision-support dashboard with graceful degradation
 */

/** Index symbol with intraday mini chart data */
export interface IndexSnapshot {
  symbol: string;
  price: number;
  pricePrior: number;
  timestamp: number;
  atr: number;
  vwapDeviation: number; // in basis points
  bars: { ts: number; o: number; h: number; l: number; c: number }[];
}

/** Breadth proxy - can be ETF-based or synthetic sector rotation */
export interface BreadthData {
  timestamp: number;
  components: {
    name: string;
    strength: number; // -1 to +1 (red to green)
    label: string;
  }[];
  source: "etf-proxy" | "sector-proxy" | "stub";
  note: string; // e.g. "XLV, XLF, XLK..." or "Simulated"
}

/** Sector relative strength - proxy acceptable */
export interface SectorMatrix {
  timestamp: number;
  sectors: {
    name: string;
    relativeStrength: number; // -1 to +1
    momentum: number; // trend direction
    label: string;
  }[];
  source: "etf-proxy" | "factor-proxy" | "stub";
  note: string;
}

/** Cross-asset monitor values (10Y yield, DXY, VIX, crude) */
export interface CrossAssetMonitor {
  timestamp: number;
  yield10Y: number | null;
  dxy: number | null;
  vix: number | null;
  crude: number | null;
  sources: {
    yield10Y: "live" | "delayed" | "stub";
    dxy: "live" | "delayed" | "stub";
    vix: "live" | "delayed" | "stub";
    crude: "live" | "delayed" | "stub";
  };
  failedQueries: string[];
}

/** Market regime: Trend/Chop + High/Low Vol quadrant */
export type TrendType = "trending-up" | "trending-down" | "choppy";
export type VolType = "low-vol" | "high-vol";

export interface RegimeLabel {
  trend: TrendType;
  vol: VolType;
  confidence: number; // 0-1
  description: string;
  timestamp: number;
  source: "compute" | "stub";
}

/** Economic calendar event */
export interface EconomicEvent {
  id: string;
  time: number;
  country: string;
  event: string;
  summary?: string;
  impact: "low" | "medium" | "high";
  forecast?: number;
  prior?: number;
  actual?: number;
  state: "upcoming" | "released";
}

export interface EconomicCalendarData {
  timestamp: number;
  events: EconomicEvent[];
  source: "configured" | "stub";
  hasApiKey: boolean;
}

/** Complete PANORAMA snapshot */
export interface PanoramaSnapshot {
  timestamp: number;
  indices: IndexSnapshot[];
  breadth: BreadthData;
  sectors: SectorMatrix;
  crossAsset: CrossAssetMonitor;
  regime: RegimeLabel;
  calendar: EconomicCalendarData;
  source: "demo" | "replay" | "live";
}
