/**
 * Market Configuration Presets
 * Defines sophisticated vs simple market setups for different trading strategies
 */

export interface MarketConfigPreset {
  id: string;
  name: string;
  description: string;
  sophisticationLevel: "simple" | "sophisticated";
  symbols: string[];
  defaultIndicators: string[];
  chartDefaults: {
    timeframes: string[];
    defaultTimeframe: string;
    showVolume: boolean;
    showOrderbook: boolean;
  };
  alertRules: {
    enabled: boolean;
    conditions: string[];
  };
  dataFeeds: {
    required: string[];
    optional: string[];
  };
  analysisTools: {
    technical: boolean;
    fundamental: boolean;
    sentiment: boolean;
    orderFlow: boolean;
  };
}

/**
 * US Large Cap - SOPHISTICATED VERSION
 * Full-featured equity trading platform for institutional-grade analysis
 */
export const US_LARGE_CAP: MarketConfigPreset = {
  id: "us-large-cap",
  name: "US Large Cap Equities",
  description: "Sophisticated equity trading platform with advanced technical analysis, fundamental data, and institutional-grade insights",
  sophisticationLevel: "sophisticated",
  symbols: [
    // Tech Titans
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META",
    // Growth Leaders
    "TSLA", "NFLX", "ADBE",
    // Financials
    "JPM", "BAC", "WFC",
    // Healthcare
    "JNJ", "UNH", "PFE",
    // Consumer Discretionary
    "AMZN", "MCD", "TSLA",
    // Consumer Staples
    "WMT", "PG", "KO", "PEP",
    // Industrials
    "BA", "CAT", "GE",
    // Diversified
    "V", "MA", "BRK.B",
  ],
  defaultIndicators: [
    "SMA(50)",
    "SMA(200)",
    "RSI(14)",
    "MACD",
    "Bollinger Bands(20,2)",
    "Volume Profile",
    "Price Action Levels",
  ],
  chartDefaults: {
    timeframes: ["1m", "5m", "15m", "1h", "4h", "1d", "1w"],
    defaultTimeframe: "1d",
    showVolume: true,
    showOrderbook: true,
  },
  alertRules: {
    enabled: true,
    conditions: [
      "price_above",
      "price_below",
      "volume_surge",
      "volatility_spike",
      "technical_breakout",
      "support_resistance_touch",
      "news_sentiment_shift",
    ],
  },
  dataFeeds: {
    required: ["alpaca-market-data", "polygon-data"],
    optional: ["finnhub-news", "sentiment-data", "options-flow"],
  },
  analysisTools: {
    technical: true,
    fundamental: true,
    sentiment: true,
    orderFlow: true,
  },
};

/**
 * Index Futures - SIMPLE VERSION
 * Streamlined, fast-paced platform for index futures traders
 */
export const INDEX_FUTURES: MarketConfigPreset = {
  id: "index-futures",
  name: "Index Futures",
  description: "Fast-paced index futures trading with streamlined charts, essential metrics, and real-time order flow",
  sophisticationLevel: "simple",
  symbols: ["ES", "NQ", "YM", "RTY"],
  defaultIndicators: ["SMA(200)", "RSI(14)", "MACD", "Volume Profile"],
  chartDefaults: {
    timeframes: ["1m", "5m", "15m", "1h", "4h"],
    defaultTimeframe: "5m",
    showVolume: true,
    showOrderbook: true,
  },
  alertRules: {
    enabled: true,
    conditions: ["price_above", "price_below", "volume_surge", "volatility_spike"],
  },
  dataFeeds: {
    required: ["alpaca-market-data"],
    optional: [],
  },
  analysisTools: {
    technical: true,
    fundamental: false,
    sentiment: false,
    orderFlow: true,
  },
};

/**
 * Export all market configurations
 */
export const MARKET_CONFIGS = {
  [US_LARGE_CAP.id]: US_LARGE_CAP,
  [INDEX_FUTURES.id]: INDEX_FUTURES,
};

export type MarketConfigId = keyof typeof MARKET_CONFIGS;

/**
 * Get configuration for a specific market type
 */
export function getMarketConfig(id: string): MarketConfigPreset | null {
  return MARKET_CONFIGS[id as MarketConfigId] || null;
}

/**
 * Get all available market configurations
 */
export function getAllMarketConfigs(): MarketConfigPreset[] {
  return Object.values(MARKET_CONFIGS);
}

/**
 * Get default indicators for a market type
 */
export function getDefaultIndicators(marketId: string): string[] {
  const config = getMarketConfig(marketId);
  return config?.defaultIndicators || [];
}

/**
 * Check if market supports fundamental analysis
 */
export function supportsFundamentalAnalysis(marketId: string): boolean {
  const config = getMarketConfig(marketId);
  return config?.analysisTools.fundamental || false;
}

/**
 * Check if market supports sentiment analysis
 */
export function supportsSentimentAnalysis(marketId: string): boolean {
  const config = getMarketConfig(marketId);
  return config?.analysisTools.sentiment || false;
}

/**
 * Get symbols for a market type
 */
export function getMarketSymbols(marketId: string): string[] {
  const config = getMarketConfig(marketId);
  return config?.symbols || [];
}
