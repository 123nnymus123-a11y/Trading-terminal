/**
 * Demo/Stub PANORAMA Data Provider
 * Generates synthetic data for development and graceful degradation
 */

import type {
  IndexSnapshot,
  BreadthData,
  SectorMatrix,
  CrossAssetMonitor,
  RegimeLabel,
  EconomicCalendarData,
  PanoramaSnapshot,
  EconomicEvent,
} from "./types";

/**
 * Generate synthetic bar data for demo indices
 */
function generateDemoBars(
  basePrice: number,
  volatility: number,
  numBars: number
): IndexSnapshot["bars"] {
  const bars: IndexSnapshot["bars"] = [];
  let price = basePrice;

  for (let i = 0; i < numBars; i++) {
    const drift = (Math.random() - 0.5) * basePrice * volatility * 0.01;
    const dailyVol = volatility * 0.015;
    const open = price + drift;
    const close = open + (Math.random() - 0.5) * basePrice * dailyVol;
    const high = Math.max(open, close) + Math.random() * (basePrice * dailyVol * 0.5);
    const low = Math.min(open, close) - Math.random() * (basePrice * dailyVol * 0.5);

    bars.push({
      ts: Date.now() - (numBars - i - 1) * 60 * 1000,
      o: open,
      h: high,
      l: low,
      c: close,
    });

    price = close;
  }

  return bars;
}

/**
 * Calculate ATR from bars
 */
function calculateATR(bars: IndexSnapshot["bars"]): number {
  if (bars.length < 2) return 0;
  let sumTR = 0;
  for (let i = 1; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];
    if (!bar || !prevBar) continue;
    const tr = Math.max(
      bar.h - bar.l,
      Math.abs(bar.h - prevBar.c),
      Math.abs(bar.l - prevBar.c)
    );
    sumTR += tr;
  }
  return sumTR / (bars.length - 1);
}

/**
 * Calculate VWAP deviation
 */
function calculateVWAPDeviation(
  bars: IndexSnapshot["bars"],
  currentPrice: number
): number {
  if (bars.length === 0) return 0;
  let sumPV = 0;
  const sumV = 1; // assume vol = 1 per bar
  for (const bar of bars) {
    sumPV += bar.c * 1;
  }
  const vwap = sumPV / sumV / bars.length;
  return ((currentPrice - vwap) / vwap) * 10000; // basis points
}

/**
 * Demo index snapshot generator
 */
export function generateDemoIndexSnapshot(
  symbol: string,
  basePrice: number,
  change: number
): IndexSnapshot {
  const bars = generateDemoBars(basePrice, 15 + Math.random() * 10, 30);
  const currentPrice = basePrice * (1 + change);

  return {
    symbol,
    price: currentPrice,
    pricePrior: basePrice,
    timestamp: Date.now(),
    atr: calculateATR(bars),
    vwapDeviation: calculateVWAPDeviation(bars, currentPrice),
    bars,
  };
}

/**
 * Generate demo breadth heatmap (sector rotation proxy)
 */
export function generateDemoBreadth(): BreadthData {
  const sectors = ["XLV", "XLF", "XLK", "XLI", "XLRE", "XLY", "XLE", "XLU"];
  const components = sectors.map((sym) => ({
    name: sym,
    strength: Math.sin(Date.now() / 5000 + Math.random() * Math.PI) * 0.8,
    label: sym,
  }));

  return {
    timestamp: Date.now(),
    components,
    source: "etf-proxy",
    note: "XLV (Healthcare), XLF (Financials), XLK (Tech), etc.",
  };
}

/**
 * Generate demo sector relative strength
 */
export function generateDemoSectorMatrix(): SectorMatrix {
  const sectorNames = [
    "Technology",
    "Healthcare",
    "Financials",
    "Industrials",
    "Consumer",
    "Energy",
    "Utilities",
  ];
  const sectors = sectorNames.map((name) => {
    const strength = Math.sin(Date.now() / 4000 + Math.random() * Math.PI) * 0.9;
    return {
      name,
      relativeStrength: strength,
      momentum: strength > 0 ? 1 : -1,
      label: name,
    };
  });

  return {
    timestamp: Date.now(),
    sectors,
    source: "factor-proxy",
    note: "Synthetic sector momentum from price action",
  };
}

/**
 * Generate demo cross-asset monitor
 */
export function generateDemoCrossAsset(): CrossAssetMonitor {
  return {
    timestamp: Date.now(),
    yield10Y: 4.2 + (Math.random() - 0.5) * 0.5,
    dxy: 103.5 + (Math.random() - 0.5) * 2,
    vix: 14 + Math.random() * 8,
    crude: 75 + (Math.random() - 0.5) * 5,
    sources: {
      yield10Y: "stub",
      dxy: "stub",
      vix: "stub",
      crude: "stub",
    },
    failedQueries: [],
  };
}

/**
 * Generate demo regime label
 */
export function generateDemoRegime(): RegimeLabel {
  const trend = Date.now() % 3000 < 1500 ? "trending-up" : "choppy";
  const vol = Math.random() > 0.5 ? "high-vol" : "low-vol";

  return {
    trend,
    vol,
    confidence: 0.65 + Math.random() * 0.3,
    description: `${trend} + ${vol}`,
    timestamp: Date.now(),
    source: "stub",
  };
}

/**
 * Generate demo economic calendar (next 24h)
 */
export function generateDemoEconomicCalendar(): EconomicCalendarData {
  const now = Date.now();
  const events: EconomicEvent[] = [
    {
      id: "1",
      time: now + 1 * 60 * 60 * 1000,
      country: "USD",
      event: "Jobless Claims",
      impact: "high",
      forecast: 215000,
      prior: 218000,
      state: "upcoming",
    },
    {
      id: "2",
      time: now + 3 * 60 * 60 * 1000,
      country: "EUR",
      event: "ZEW Sentiment",
      impact: "medium",
      forecast: 41.5,
      state: "upcoming",
    },
    {
      id: "3",
      time: now + 6 * 60 * 60 * 1000,
      country: "GBP",
      event: "Retail Sales",
      impact: "medium",
      forecast: 2.3,
      prior: 1.9,
      state: "upcoming",
    },
    {
      id: "4",
      time: now + 10 * 60 * 60 * 1000,
      country: "JPY",
      event: "CPI YoY",
      impact: "high",
      forecast: 2.5,
      prior: 2.6,
      state: "upcoming",
    },
  ];

  return {
    timestamp: Date.now(),
    events,
    source: "stub",
    hasApiKey: false,
  };
}

/**
 * Generate complete PANORAMA snapshot
 */
export function generateDemoPanoramaSnapshot(): PanoramaSnapshot {
  return {
    timestamp: Date.now(),
    indices: [
      generateDemoIndexSnapshot("SPY", 450, 0.005 + (Math.random() - 0.5) * 0.02),
      generateDemoIndexSnapshot("QQQ", 380, 0.008 + (Math.random() - 0.5) * 0.025),
      generateDemoIndexSnapshot("IWM", 195, 0.003 + (Math.random() - 0.5) * 0.015),
    ],
    breadth: generateDemoBreadth(),
    sectors: generateDemoSectorMatrix(),
    crossAsset: generateDemoCrossAsset(),
    regime: generateDemoRegime(),
    calendar: generateDemoEconomicCalendar(),
    source: "demo",
  };
}
