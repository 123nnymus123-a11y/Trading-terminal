/**
 * useMarketConfig Hook
 * Provides reactive access to market-specific configurations
 */

import { useMemo } from "react";
import { useSettingsStore } from "../store/settingsStore";
import { getMarketConfig, getDefaultIndicators, getMarketSymbols } from "../config/marketConfigs";

export function useMarketConfig() {
  const marketFocus = useSettingsStore((s) => s.marketFocus);
  const getMarketFocusConfig = useSettingsStore((s) => s.getMarketFocusConfig);

  const config = useMemo(() => {
    return getMarketConfig(marketFocus);
  }, [marketFocus]);

  const marketConfig = useMemo(() => {
    return getMarketFocusConfig();
  }, [getMarketFocusConfig]);

  const defaultIndicators = useMemo(() => {
    return getDefaultIndicators(marketFocus);
  }, [marketFocus]);

  const symbols = useMemo(() => {
    return getMarketSymbols(marketFocus);
  }, [marketFocus]);

  const isSophisticated = useMemo(() => {
    return marketConfig.sophisticationLevel === "sophisticated";
  }, [marketConfig]);

  const isSimple = useMemo(() => {
    return marketConfig.sophisticationLevel === "simple";
  }, [marketConfig]);

  return {
    // Current market
    marketFocus,
    marketConfig,
    config,

    // Configuration details
    defaultIndicators,
    symbols,
    isSophisticated,
    isSimple,

    // Helper flags
    supportsFundamental: config?.analysisTools.fundamental || false,
    supportsSentiment: config?.analysisTools.sentiment || false,
    supportsOrderFlow: config?.analysisTools.orderFlow || false,
    supportsNews: (config?.dataFeeds.optional || []).includes("finnhub-news"),
  };
}

/**
 * Hook for accessing market-specific UI visibility
 */
export function useMarketUIVisibility() {
  const { isSophisticated, isSimple } = useMarketConfig();

  return {
    // Show these for sophisticated market (US Large Cap)
    showFundamentalPanel: isSophisticated,
    showSentimentIndicators: isSophisticated,
    showAdvancedCharts: isSophisticated,
    showNewsSection: isSophisticated,
    showAdvancedAlerts: isSophisticated,

    // Show these for simple market (Index Futures)
    showSimplifiedCharts: isSimple,
    showEssentialMetrics: isSimple,
    showOrderFlow: isSimple,

    // Show for both
    showTechnicalIndicators: true,
    showVolume: true,
  };
}
