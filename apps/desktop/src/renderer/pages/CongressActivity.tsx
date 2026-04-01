import React, { useCallback, useEffect, useState } from "react";
import type { AiCongressIntel as CongressAiScanPayload } from "../../main/services/congress/aiCongressIntel";
import type { 
  CongressionalTrade, 
  CongressionalMember, 
  LobbyingActivity, 
  FederalContract 
} from "@tc/shared";

export function CongressActivity() {
  const [selectedTab, setSelectedTab] = useState<"trades" | "lobbying" | "contracts">("trades");
  const [trades, setTrades] = useState<CongressionalTrade[]>([]);
  const [_members, setMembers] = useState<CongressionalMember[]>([]);
  const [lobbying, setLobbying] = useState<LobbyingActivity[]>([]);
  const [contracts, setContracts] = useState<FederalContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiMode, setAiMode] = useState(false);
  const [aiIntel, setAiIntel] = useState<CongressAiScanPayload | null>(null);
  const [aiIntelLoading, setAiIntelLoading] = useState(false);
  const [aiIntelError, setAiIntelError] = useState<string | null>(null);
  const [aiDebugCopied, setAiDebugCopied] = useState(false);
  
  // Filter states
  const [personFilter, setPersonFilter] = useState("");
  const [chamberFilter, setChamberFilter] = useState<"" | "House" | "Senate">("");
  const [_partyFilter, setPartyFilter] = useState("");
  const [tickerFilter, setTickerFilter] = useState("");
  const [dateStartFilter, setDateStartFilter] = useState("");
  const [dateEndFilter, setDateEndFilter] = useState("");

  // Fetch state
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  // Stats
  const [tradeStats, setTradeStats] = useState<{
    mostTraded: Array<{ ticker: string; trade_count: number; buy_count: number; sell_count: number }>;
    lagStats: { avg_lag_days: number; median_lag_days: number; max_lag_days: number } | null;
  }>({ mostTraded: [], lagStats: null });

  // Section expansion state
  const [expandedSections, setExpandedSections] = useState<{
    high: boolean;
    medium: boolean;
    low: boolean;
  }>({
    high: true,
    medium: false,
    low: false,
  });

  useEffect(() => {
    loadData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildAiDebugPayload = (payload: CongressAiScanPayload) => ({
    generatedAt: payload.generatedAt,
    model: payload.model,
    dataQualityNote: payload.dataQualityNote,
    rateLimit: payload.rateLimit,
    localTradeCount: payload.localTradeCount,
    localTradeWindowDays: payload.localTradeWindowDays,
    sources: payload.sources?.map((source) => ({
      id: source.id,
      name: source.name,
      provider: source.provider,
      dataSource: source.dataSource,
      note: source.note,
      hitCount: source.hits?.length ?? 0,
      topHits: source.hits?.slice(0, 3) ?? [],
    })) ?? [],
    contextPreview: payload.contextPreview?.slice(0, 1200) ?? "",
  });

  const runAiScan = useCallback(async () => {
    if (!window.cockpit?.congress?.scanAiSources) {
      setAiIntelError("AI scanning bridge unavailable.");
      return;
    }
    setAiIntelError(null);
    setAiIntelLoading(true);
    try {
      const response = await window.cockpit.congress.scanAiSources();
      if (!response?.success || !response.data) {
        throw new Error(response?.error ?? "AI scan failed.");
      }
      const payload = response.data as CongressAiScanPayload;
      setAiIntel(payload);
      console.log("[CongressActivity] AI debug payload:", buildAiDebugPayload(payload));
    } catch (err) {
      setAiIntelError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiIntelLoading(false);
    }
  }, []);

  const handleCopyAiDebug = useCallback(async () => {
    if (!aiIntel || !navigator.clipboard) {
      console.warn("[CongressActivity] Clipboard unavailable or AI data missing.");
      return;
    }
    try {
      const payload = buildAiDebugPayload(aiIntel);
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setAiDebugCopied(true);
      setTimeout(() => setAiDebugCopied(false), 1500);
    } catch (err) {
      console.warn("[CongressActivity] Failed to copy AI debug payload:", err);
    }
  }, [aiIntel]);

  useEffect(() => {
    if (aiMode) {
      void runAiScan();
    }
  }, [aiMode, runAiScan]);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load congressional trades with filters
      const tradesData = await window.cockpit?.congress?.queryTrades?.({
        person_name: personFilter || undefined,
        chamber: chamberFilter || undefined,
        ticker: tickerFilter || undefined,
        transaction_date_start: dateStartFilter || undefined,
        transaction_date_end: dateEndFilter || undefined,
        limit: 100,
      });
      setTrades(tradesData || []);

      // Load members
      const membersData = await window.cockpit?.congress?.queryMembers?.({ limit: 100 });
      setMembers(membersData || []);

      // Load lobbying
      const lobbyingData = await window.cockpit?.congress?.queryLobbying?.({ limit: 100 });
      setLobbying(lobbyingData || []);

      // Load contracts
      const contractsData = await window.cockpit?.congress?.queryContracts?.({ limit: 100 });
      setContracts(contractsData || []);

      // Load stats
      const mostTradedData = await window.cockpit?.congress?.getMostTradedTickers?.({
        ...(dateStartFilter && { dateStart: dateStartFilter }),
        ...(dateEndFilter && { dateEnd: dateEndFilter }),
        limit: 10,
      });
      const lagStatsData = await window.cockpit?.congress?.getDisclosureLagStats?.();
      setTradeStats({ mostTraded: mostTradedData || [], lagStats: lagStatsData || null });
    } catch (err) {
      console.error("Failed to load congress data:", err);
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = () => {
    loadData();
  };

  const clearFilters = () => {
    setPersonFilter("");
    setChamberFilter("");
    setPartyFilter("");
    setTickerFilter("");
    setDateStartFilter("");
    setDateEndFilter("");
  };

  const fetchRealData = async (source: "house" | "senate" | "all") => {
    setFetching(true);
    setFetchResult(null);
    
    try {
      let result;
      
      if (source === "all") {
        result = await window.cockpit?.congress?.fetchAllTrades?.(200);
        if (result) {
          const houseMsg = result.house.cached 
            ? `House: Using cache (${result.house.cacheAge}min old)` 
            : `House: ${result.house.inserted} new`;
          const senateMsg = result.senate.cached 
            ? `Senate: Using cache (${result.senate.cacheAge}min old)` 
            : `Senate: ${result.senate.inserted} new`;
          const lobbyingMsg = result.lobbying.cached
            ? `Lobbying: Using cache (${result.lobbying.cacheAge}min old)`
            : `Lobbying: ${result.lobbying.inserted} new`;
          const contractsMsg = result.contracts.cached
            ? `Contracts: Using cache (${result.contracts.cacheAge}min old)`
            : `Contracts: ${result.contracts.inserted} new`;
          const icon = (result.house.cached || result.house.inserted === 0) ? "📦" : "✅";
          
          setFetchResult({
            message: `${icon} Loaded ${result.total.inserted} records! (${houseMsg}, ${senateMsg}, ${lobbyingMsg}, ${contractsMsg})`,
            type: result.house.cached && result.senate.cached ? "info" : "success",
          });
        }
      } else if (source === "house") {
        result = await window.cockpit?.congress?.fetchHouseTrades?.(100);
        if (result) {
          const icon = result.cached ? "📦" : "✅";
          const msg = result.cached 
            ? `Using cached House data (${result.cacheAge}min old, still fresh!)` 
            : `Loaded ${result.inserted} new House trades from official disclosures!`;
          
          setFetchResult({
            message: `${icon} ${msg}`,
            type: result.cached ? "info" : "success",
          });
        }
      } else {
        result = await window.cockpit?.congress?.fetchSenateTrades?.(100);
        if (result) {
          const icon = result.cached ? "📦" : "✅";
          const msg = result.cached 
            ? `Using cached Senate data (${result.cacheAge}min old, still fresh!)` 
            : `Loaded ${result.inserted} new Senate trades from official disclosures!`;
          
          setFetchResult({
            message: `${icon} ${msg}`,
            type: result.cached ? "info" : "success",
          });
        }
      }

      // Reload the data from database
      await loadData();
    } catch (err) {
      console.error("Failed to fetch real data:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      
      // Check if it's a "fetch in progress" error
      if (errMsg.includes("already in progress")) {
        setFetchResult({
          message: `⏳ ${errMsg}`,
          type: "info",
        });
      } else {
        setFetchResult({
          message: `❌ Failed to fetch data: ${errMsg}`,
          type: "error",
        });
      }
    } finally {
      setFetching(false);
    }
  };

  const formatAmount = (low: number | null, high: number | null, _currency = "USD") => {
    if (!low && !high) return "Not disclosed";
    if (low && high) return `$${low.toLocaleString()} - $${high.toLocaleString()}`;
    if (low) return `$${low.toLocaleString()}+`;
    return "Unknown";
  };

  const formatDate = (isoString: string | null | undefined) => {
    if (!isoString) return "N/A";
    try {
      return new Date(isoString).toLocaleDateString();
    } catch {
      return isoString;
    }
  };

  const formatLag = (value: number | null | undefined, decimals = 0) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "N/A";
    }
    return value.toFixed(decimals);
  };

  const getQualityBadge = (flag: string) => {
    const colors = {
      confident: "#10b981",
      high: "#10b981",
      ambiguous: "#f59e0b",
      medium: "#f59e0b",
      unmatched: "#ef4444",
      low: "#ef4444",
      complete: "#10b981",
      partial: "#f59e0b",
      missing: "#ef4444",
    };
    return (
      <span style={{
        padding: "2px 6px",
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 600,
        background: colors[flag as keyof typeof colors] || "#6b7280",
        color: "white",
      }}>
        {flag}
      </span>
    );
  };

  const getSentimentColor = (sentiment: string) => {
    const colors = {
      bullish: "#10b981",
      bearish: "#ef4444",
      neutral: "#6b7280",
      mixed: "#f59e0b",
    };
    return colors[sentiment as keyof typeof colors] || "#6b7280";
  };

  const getSentimentEmoji = (sentiment: string) => {
    const emojis = {
      bullish: "🟢",
      bearish: "🔴",
      neutral: "⚪",
      mixed: "🟡",
    };
    return emojis[sentiment as keyof typeof emojis] || "⚪";
  };

  const renderMetricCard = (title: string, value: string | number, subtitle?: string) => (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(15,23,42,0.6)",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", opacity: 0.6, letterSpacing: "0.5px", marginBottom: 4 }}>
        {title}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, opacity: 0.7 }}>{subtitle}</div>}
    </div>
  );

  const renderTradeCard = (trade: any, impactLevel: "high" | "medium" | "low") => {
    const borderColors = {
      high: "#ef4444",
      medium: "#f59e0b",
      low: "#3b82f6",
    };
    
    const txType = trade.transactionType?.toLowerCase() || "";
    const isBuy = txType.includes("purchase") || txType.includes("buy");
    const isSell = txType.includes("sale") || txType.includes("sell");
    
    return (
      <div
        key={`${trade.url}-${trade.politician}`}
        style={{
          padding: 14,
          borderRadius: 10,
          border: `1px solid ${borderColors[impactLevel]}40`,
          borderLeft: `4px solid ${borderColors[impactLevel]}`,
          background: "rgba(0,0,0,0.35)",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{
              padding: "4px 10px",
              borderRadius: 999,
              background: "rgba(59,130,246,0.3)",
              border: "1px solid rgba(59,130,246,0.5)",
              fontSize: 12,
              fontWeight: 700,
            }}>
              {trade.ticker}
            </span>
            <span style={{
              padding: "3px 8px",
              borderRadius: 4,
              background: isBuy ? "rgba(16,185,129,0.2)" : isSell ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
              border: `1px solid ${isBuy ? "#10b981" : isSell ? "#ef4444" : "#f59e0b"}40`,
              fontSize: 11,
              fontWeight: 600,
              color: isBuy ? "#10b981" : isSell ? "#ef4444" : "#f59e0b",
            }}>
              {trade.transactionType}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
          {trade.politician}
          {trade.party && <span style={{ opacity: 0.6, fontWeight: 400 }}> ({trade.party})</span>}
          {trade.chamber && <span style={{ opacity: 0.6, fontWeight: 400 }}> • {trade.chamber}</span>}
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 8 }}>
          Amount: <span style={{ fontWeight: 600 }}>{trade.amount}</span> • 
          Filed: {trade.filedDate}
          {trade.lagDays !== undefined && <span> • Lag: {trade.lagDays} days</span>}
        </div>
        <div
          style={{
            fontSize: 12,
            padding: 8,
            borderRadius: 6,
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.2)",
            marginBottom: 8,
          }}
        >
          <strong>💡 {impactLevel.toUpperCase()} Priority:</strong> {trade.impactReason}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11, opacity: 0.6 }}>
          <span>Source: {trade.source}</span>
          <a
            href={trade.url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#93c5fd", textDecoration: "none", fontWeight: 600 }}
          >
            View Details →
          </a>
        </div>
      </div>
    );
  };

  const renderCategorySection = (
    title: string,
    trades: any[],
    impactLevel: "high" | "medium" | "low",
  ) => {
    const expanded = expandedSections[impactLevel];
    const toggleExpanded = () => {
      setExpandedSections(prev => ({
        ...prev,
        [impactLevel]: !prev[impactLevel]
      }));
    };
    
    const borderColors = {
      high: "#ef4444",
      medium: "#f59e0b",
      low: "#3b82f6",
    };
    const icons = {
      high: "🔴",
      medium: "🟡",
      low: "🔵",
    };

    if (!trades || trades.length === 0) return null;

    return (
      <div style={{ marginBottom: 20 }}>
        <div
          onClick={toggleExpanded}
          style={{
            padding: 14,
            borderRadius: 10,
            border: `1px solid ${borderColors[impactLevel]}50`,
            background: `${borderColors[impactLevel]}15`,
            cursor: "pointer",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: expanded ? 12 : 0,
          }}
        >
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ fontSize: 16 }}>{icons[impactLevel]}</span>
            <span style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {title}
            </span>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 999,
                background: borderColors[impactLevel],
                color: "white",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {trades.length}
            </span>
          </div>
          <span style={{ fontSize: 18, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "rotate(0deg)" }}>
            ▼
          </span>
        </div>
        {expanded && (
          <div style={{ paddingLeft: 8 }}>
            {trades.map((trade) => renderTradeCard(trade, impactLevel))}
          </div>
        )}
      </div>
    );
  };

  const renderAiInsights = () => {
    try {
      // If we're still loading, show loading state
      if (aiIntelLoading) {
        return (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.6 }}>
            <div style={{ fontSize: 14 }}>🔍 Scanning Capitol Trades and QuiverQuant...</div>
            <div style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>This may take 30-60 seconds on first scan</div>
          </div>
        );
      }

      // If there's an error, show it
      if (aiIntelError) {
        return (
          <div style={{
            padding: 20,
            borderRadius: 10,
            border: "1px solid rgba(239,68,68,0.3)",
            background: "rgba(239,68,68,0.1)"
          }}>
            <div style={{ color: "#fca5a5", fontSize: 13 }}>
              ⚠️ <strong>Error:</strong> {aiIntelError}
            </div>
            <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8, opacity: 0.8 }}>
              Please try the "Force Scan" button to retry, or check the browser console for details.
            </div>
          </div>
        );
      }

      // If no data available yet, show initial prompt
      if (!aiIntel) {
        return (
          <div style={{ padding: 40, textAlign: "center", opacity: 0.6, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ fontSize: 14, marginBottom: 12 }}>📡 AI Congressional Intel Scanner</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              Click the "Force Scan" button above to scan the latest congressional trading activity from Capitol Trades and QuiverQuant.
            </div>
            <div style={{ fontSize: 11, marginTop: 12, opacity: 0.6, fontStyle: "italic" }}>
              First scan may take 30-60 seconds while fetching web data.
            </div>
          </div>
        );
      }

      return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {aiIntel?.rateLimit?.active && (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            border: "1px solid rgba(251,191,36,0.4)",
            background: "rgba(251,191,36,0.12)",
            fontSize: 12,
            color: "#fde68a",
          }}
        >
          <strong>Brave Search rate limit:</strong> {aiIntel.rateLimit.message || "Free tier throttling detected."}
          {aiIntel.rateLimit.retryAfterMs && (
            <span> Retrying in ~{Math.ceil(aiIntel.rateLimit.retryAfterMs / 1000)}s.</span>
          )}
        </div>
      )}
      {/* Stats Dashboard */}
      {aiIntel?.metrics && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
          {renderMetricCard("Total Trades", aiIntel.metrics.totalTrades)}
          {renderMetricCard("Avg Disclosure Lag", aiIntel.metrics.avgLagDays !== null ? `${aiIntel.metrics.avgLagDays} days` : "N/A")}
          {renderMetricCard("Buy/Sell Ratio", `${aiIntel.metrics.buyVsSell.buys}/${aiIntel.metrics.buyVsSell.sells}`)}
          {renderMetricCard("Total Volume", aiIntel.metrics.totalVolume || "$0")}
          {aiIntel.categorizedTrades && renderMetricCard(
            "High Impact",
            aiIntel.categorizedTrades.highImpact?.length || 0,
            "Requires attention"
          )}
        </div>
      )}

      {/* Status Bar */}
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          border: "1px solid rgba(59,130,246,0.3)",
          background: "rgba(37, 99, 235, 0.15)",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>AI Briefing Status</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            {aiIntel?.generatedAt
              ? `Last updated ${new Date(aiIntel.generatedAt).toLocaleString()}`
              : "No AI scan has been run yet."}
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
            Model: {aiIntel?.model || "Default"}
          </div>
          {aiIntel?.dataQualityNote && (
            <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6, fontWeight: 500 }}>
              {aiIntel.dataQualityNote}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => runAiScan()}
            disabled={aiIntelLoading}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.2)",
              background: aiIntelLoading ? "rgba(255,255,255,0.1)" : "rgba(59,130,246,0.3)",
              color: "#fff",
              fontWeight: 600,
              cursor: aiIntelLoading ? "not-allowed" : "pointer",
            }}
          >
            {aiIntelLoading ? "Scanning…" : "🔁 Rescan Sources"}
          </button>
        </div>
      </div>

      {aiIntelError && (
        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: "1px solid rgba(248,113,113,0.5)",
            background: "rgba(248,113,113,0.15)",
            color: "#fecaca",
            fontSize: 13,
          }}
        >
          ⚠️ {aiIntelError}
        </div>
      )}

      {aiIntel && (
        <>
          {/* Executive Summary */}
          <div
            style={{
              padding: 18,
              borderRadius: 10,
              border: `2px solid ${getSentimentColor(aiIntel.sentiment)}40`,
              background: `${getSentimentColor(aiIntel.sentiment)}10`,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 20 }}>{getSentimentEmoji(aiIntel.sentiment)}</span>
              <span style={{ fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Market Sentiment: {aiIntel.sentiment}
              </span>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>{aiIntel.summary}</div>
            {aiIntel.highlights.length > 0 && (
              <div style={{ fontSize: 12, opacity: 0.9 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>Key Highlights:</div>
                <ul style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
                  {aiIntel.highlights.map((highlight, idx) => (
                    <li key={idx}>{highlight}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Categorized Trades */}
          {aiIntel.categorizedTrades && (
            <>
              {renderCategorySection(
                "High Impact Trades",
                aiIntel.categorizedTrades.highImpact,
                "high"
              )}
              {renderCategorySection(
                "Medium Impact Trades",
                aiIntel.categorizedTrades.mediumImpact,
                "medium"
              )}
              {renderCategorySection(
                "Monitoring",
                aiIntel.categorizedTrades.monitoring,
                "low"
              )}
            </>
          )}

          {/* Patterns Detected */}
          {aiIntel.patterns && aiIntel.patterns.length > 0 && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                🔍 Patterns Detected
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {aiIntel.patterns.map((pattern, idx) => {
                  const patternColors = {
                    cluster: "#f59e0b",
                    unusual_timing: "#ef4444",
                    large_volume: "#8b5cf6",
                    committee_chair: "#ec4899",
                    other: "#6b7280",
                  };
                  const patternIcons = {
                    cluster: "📊",
                    unusual_timing: "⏱️",
                    large_volume: "💰",
                    committee_chair: "👔",
                    other: "🔎",
                  };
                  return (
                    <div
                      key={idx}
                      style={{
                        padding: 14,
                        borderRadius: 10,
                        border: `1px solid ${patternColors[pattern.type]}40`,
                        background: "rgba(0,0,0,0.35)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                        <span style={{ fontSize: 18 }}>{patternIcons[pattern.type]}</span>
                        <span
                          style={{
                            padding: "2px 8px",
                            borderRadius: 4,
                            background: patternColors[pattern.type],
                            color: "white",
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                          }}
                        >
                          {pattern.type.replace("_", " ")}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, marginBottom: 8, lineHeight: 1.5 }}>{pattern.description}</div>
                      {pattern.tickers.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {pattern.tickers.map((ticker) => (
                            <span
                              key={ticker}
                              style={{
                                padding: "2px 6px",
                                borderRadius: 4,
                                background: "rgba(59,130,246,0.2)",
                                border: "1px solid rgba(59,130,246,0.3)",
                                fontSize: 10,
                                fontWeight: 600,
                              }}
                            >
                              {ticker}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Top Tickers */}
          {aiIntel.metrics?.topTickers && aiIntel.metrics.topTickers.length > 0 && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                📈 Most Traded Tickers
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {aiIntel.metrics.topTickers.slice(0, 15).map((item) => (
                  <div
                    key={item.ticker}
                    style={{
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid rgba(59,130,246,0.3)",
                      background: "rgba(59,130,246,0.15)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{item.ticker}</span>
                    <span style={{ fontSize: 11, opacity: 0.7 }}>×{item.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Watchlist */}
          {aiIntel.watchlist.length > 0 && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                ⭐ Watchlist Ideas
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
                {aiIntel.watchlist.map((item, idx) => (
                  <div
                    key={`${item.title}-${idx}`}
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.12)",
                      background: "rgba(0,0,0,0.35)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {item.title}
                      {item.ticker && (
                        <span
                          style={{
                            marginLeft: 8,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: "rgba(59,130,246,0.3)",
                            fontSize: 10,
                            fontWeight: 600,
                          }}
                        >
                          {item.ticker}
                        </span>
                      )}
                    </div>
                    {item.reason && <div style={{ opacity: 0.8, lineHeight: 1.5 }}>{item.reason}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Sources */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              📡 Data Sources
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
              {aiIntel.sources.map((source) => (
                <div
                  key={source.id}
                  style={{
                    padding: 14,
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(0,0,0,0.35)",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>{source.name}</div>
                  {source.note && (
                    <div style={{ fontSize: 11, opacity: 0.65, marginBottom: 8, fontStyle: "italic" }}>{source.note}</div>
                  )}
                  {source.hits.length === 0 ? (
                    <div style={{ fontSize: 11, opacity: 0.6 }}>No recent items discovered.</div>
                  ) : (
                    <div style={{ fontSize: 11, opacity: 0.8 }}>
                      {source.hits.length} item{source.hits.length !== 1 ? "s" : ""} found
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!aiIntel && !aiIntelLoading && !aiIntelError && (
        <div style={{ fontSize: 12, opacity: 0.75 }}>Click "Force Scan" above to fetch AI insights.</div>
      )}
    </div>
      );
    } catch (err) {
      console.error("[renderAiInsights] Error rendering AI insights:", err);
      return (
        <div style={{ padding: 20, borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.1)" }}>
          <div style={{ color: "#fca5a5", fontSize: 13 }}>
            ⚠️ <strong>Error rendering AI insights:</strong> {err instanceof Error ? err.message : String(err)}
          </div>
          <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 8, opacity: 0.8 }}>
            Please check the browser console (F12) for more details.
          </div>
        </div>
      );
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #0f172a 0%, #1a1f3a 100%)", color: "#e2e8f0", padding: 20 }}>
      <h1 className="pageTitle">CONGRESS ACTIVITY</h1>
      <div className="pageSubtitle">
        Public disclosures: Trading, Lobbying, Federal Contracts
      </div>

      {/* Disclaimer Banner */}
      <div style={{
        padding: 12,
        background: "rgba(59, 130, 246, 0.1)",
        border: "1px solid rgba(59, 130, 246, 0.3)",
        borderRadius: 8,
        marginBottom: 20,
        fontSize: 12,
        color: "#93c5fd",
      }}>
        ⚠️ <b>Transparency Tool:</b> This data represents PUBLIC, DELAYED disclosures from official sources.
        Not real-time trading signals. No accusations or implications of wrongdoing are made.
      </div>

      {/* AI mode toggle */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: 16,
          borderRadius: 10,
          background: "rgba(15,23,42,0.5)",
          border: "1px solid rgba(255,255,255,0.08)",
          marginBottom: 20,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>Viewing mode</div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Toggle AI Powered mode to scan Capitol Trades and QuiverQuant for fresh congressional intel.
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label
            style={{
              position: "relative",
              display: "inline-block",
              width: 56,
              height: 28,
            }}
          >
            <input
              type="checkbox"
              checked={aiMode}
              onChange={(e) => setAiMode(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: "absolute",
                cursor: "pointer",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: aiMode ? "#22c55e" : "rgba(148,163,184,0.6)",
                transition: ".2s",
                borderRadius: 999,
              }}
            />
            <span
              style={{
                position: "absolute",
                left: aiMode ? 30 : 4,
                top: 4,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "#0f172a",
                transition: ".2s",
              }}
            />
          </label>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{aiMode ? "AI POWERED" : "CLASSIC"}</div>
          {aiMode && (
            <>
              <button
                onClick={() => runAiScan()}
                disabled={aiIntelLoading}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid rgba(59,130,246,0.4)",
                  background: "rgba(59,130,246,0.2)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: aiIntelLoading ? "not-allowed" : "pointer",
                }}
              >
                {aiIntelLoading ? "Scanning…" : "Force Scan"}
              </button>
              {aiIntel && (
                <button
                  onClick={handleCopyAiDebug}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid rgba(148,163,184,0.4)",
                    background: "rgba(148,163,184,0.12)",
                    color: "#e2e8f0",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {aiDebugCopied ? "Copied" : "Copy Debug"}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {aiMode ? (
        renderAiInsights()
      ) : (
        <>
      {/* Data Fetch Controls */}
      <div style={{
        padding: 16,
        background: "rgba(34, 197, 94, 0.1)",
        border: "1px solid rgba(34, 197, 94, 0.3)",
        borderRadius: 8,
        marginBottom: 20,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12, color: "#86efac" }}>
          📊 Load Real Congressional Trading Data
        </div>
        <div style={{ fontSize: 12, marginBottom: 12, color: "#d1fae5" }}>
          Click below to fetch ACTUAL disclosure data from official government sources:
          House Stock Watcher, Senate Stock Watcher, House Clerk Lobbying Disclosures, and Federal Contracts Database.
        </div>
        
        {fetchResult && (
          <div style={{
            padding: 10,
            marginBottom: 12,
            borderRadius: 6,
            background: 
              fetchResult.type === "success" ? "rgba(34, 197, 94, 0.2)" : 
              fetchResult.type === "info" ? "rgba(59, 130, 246, 0.2)" :
              "rgba(239, 68, 68, 0.2)",
            border: `1px solid ${
              fetchResult.type === "success" ? "rgba(34, 197, 94, 0.4)" : 
              fetchResult.type === "info" ? "rgba(59, 130, 246, 0.4)" :
              "rgba(239, 68, 68, 0.4)"
            }`,
            fontSize: 12,
            color: 
              fetchResult.type === "success" ? "#86efac" : 
              fetchResult.type === "info" ? "#93c5fd" :
              "#fca5a5",
          }}>
            {fetchResult.message}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => fetchRealData("all")}
            disabled={fetching}
            style={{
              padding: "8px 16px",
              background: fetching ? "rgba(34, 197, 94, 0.3)" : "#22c55e",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: fetching ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {fetching ? "⏳ Fetching..." : "🏛️ Fetch All (House + Senate)"}
          </button>
          <button
            onClick={() => fetchRealData("house")}
            disabled={fetching}
            style={{
              padding: "8px 16px",
              background: fetching ? "rgba(59, 130, 246, 0.3)" : "#3b82f6",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: fetching ? "not-allowed" : "pointer",
            }}
          >
            {fetching ? "..." : "🏛️ House Only"}
          </button>
          <button
            onClick={() => fetchRealData("senate")}
            disabled={fetching}
            style={{
              padding: "8px 16px",
              background: fetching ? "rgba(59, 130, 246, 0.3)" : "#3b82f6",
              border: "none",
              borderRadius: 6,
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: fetching ? "not-allowed" : "pointer",
            }}
          >
            {fetching ? "..." : "🏛️ Senate Only"}
          </button>
        </div>
        
        <div style={{ fontSize: 11, marginTop: 10, opacity: 0.7, color: "#d1fae5" }}>
          Data sources: House Stock Watcher & Senate Stock Watcher (unofficial aggregators of official PTR filings)
        </div>
      </div>
        </>
      )}

      {/* Tab Navigation */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        {["trades", "lobbying", "contracts"].map((tab) => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab as typeof selectedTab)}
            style={{
              padding: "8px 16px",
              background: selectedTab === tab ? "rgba(59, 130, 246, 0.2)" : "transparent",
              border: "none",
              borderBottom: selectedTab === tab ? "2px solid #3b82f6" : "2px solid transparent",
              color: selectedTab === tab ? "#fff" : "rgba(255,255,255,0.6)",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Filters Section */}
      {selectedTab === "trades" && (
        <div style={{
          padding: 16,
          background: "rgba(0,0,0,0.3)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 8,
          marginBottom: 20,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <input
              type="text"
              placeholder="Person name..."
              value={personFilter}
              onChange={(e) => setPersonFilter(e.target.value)}
              style={{
                padding: "6px 10px",
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
              }}
            />
            <select
              value={chamberFilter}
              onChange={(e) => setChamberFilter(e.target.value as "" | "House" | "Senate")}
              style={{
                padding: "6px 10px",
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
              }}
            >
              <option value="">All Chambers</option>
              <option value="House">House</option>
              <option value="Senate">Senate</option>
            </select>
            <input
              type="text"
              placeholder="Ticker..."
              value={tickerFilter}
              onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
              style={{
                padding: "6px 10px",
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
              }}
            />
            <input
              type="date"
              placeholder="Start Date"
              value={dateStartFilter}
              onChange={(e) => setDateStartFilter(e.target.value)}
              style={{
                padding: "6px 10px",
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
              }}
            />
            <input
              type="date"
              placeholder="End Date"
              value={dateEndFilter}
              onChange={(e) => setDateEndFilter(e.target.value)}
              style={{
                padding: "6px 10px",
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={applyFilters}
              style={{
                padding: "6px 16px",
                background: "#3b82f6",
                border: "none",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Apply Filters
            </button>
            <button
              onClick={clearFilters}
              style={{
                padding: "6px 16px",
                background: "rgba(255,255,255,0.1)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: 4,
                color: "#fff",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Stats Section */}
      {selectedTab === "trades" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
          {/* Most Traded Tickers */}
          <div style={{
            padding: 16,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Most Traded Tickers</h3>
            {tradeStats.mostTraded.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.6 }}>No data available</div>
            ) : (
              <table style={{ width: "100%", fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                    <th style={{ textAlign: "left", padding: "4px 0" }}>Ticker</th>
                    <th style={{ textAlign: "right", padding: "4px 0" }}>Total</th>
                    <th style={{ textAlign: "right", padding: "4px 0" }}>Buys</th>
                    <th style={{ textAlign: "right", padding: "4px 0" }}>Sells</th>
                  </tr>
                </thead>
                <tbody>
                  {tradeStats.mostTraded.map((item) => (
                    <tr key={item.ticker} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                      <td style={{ padding: "6px 0", fontWeight: 600 }}>{item.ticker}</td>
                      <td style={{ textAlign: "right", padding: "6px 0" }}>{item.trade_count}</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: "#10b981" }}>{item.buy_count}</td>
                      <td style={{ textAlign: "right", padding: "6px 0", color: "#ef4444" }}>{item.sell_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Disclosure Lag Stats */}
          <div style={{
            padding: 16,
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Disclosure Lag Statistics</h3>
            {!tradeStats.lagStats ? (
              <div style={{ fontSize: 12, opacity: 0.6 }}>No data available</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Average Lag:</span>
                  <span style={{ fontWeight: 600 }}>{formatLag(tradeStats.lagStats.avg_lag_days, 1)} days</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Median Lag:</span>
                  <span style={{ fontWeight: 600 }}>{formatLag(tradeStats.lagStats.median_lag_days, 0)} days</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>Max Lag:</span>
                  <span style={{ fontWeight: 600, color: "#ef4444" }}>{formatLag(tradeStats.lagStats.max_lag_days, 0)} days</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content Sections */}
      {loading ? (
        <div style={{ textAlign: "center", padding: 40, fontSize: 14, opacity: 0.6 }}>
          Loading data...
        </div>
      ) : (
        <>
          {selectedTab === "trades" && (
            <div style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              overflow: "hidden",
            }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead style={{ background: "rgba(0,0,0,0.4)" }}>
                    <tr>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Member</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Chamber</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Ticker</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Asset</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Type</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Transaction</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Amount Range</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Tx Date</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Disclosed</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Quality</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.length === 0 ? (
                      <tr>
                        <td colSpan={10} style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>
                          No congressional trades found. Data will appear here when loaded.
                        </td>
                      </tr>
                    ) : (
                      trades.map((trade) => {
                        const transactionType = trade.transaction_type || "Unknown";
                        const isBuy = transactionType.toLowerCase().includes("buy");
                        return (
                        <tr key={trade.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600 }}>{trade.person_name}</td>
                          <td style={{ padding: "10px 12px" }}>{trade.chamber}</td>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "#3b82f6" }}>
                            {trade.ticker_normalized || "-"}
                          </td>
                          <td style={{ padding: "10px 12px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {trade.asset_name_raw}
                          </td>
                          <td style={{ padding: "10px 12px" }}>{trade.asset_type}</td>
                          <td style={{ padding: "10px 12px" }}>
                            <span style={{
                              color: isBuy ? "#10b981" : "#ef4444",
                              fontWeight: 600,
                            }}>
                              {transactionType}
                            </span>
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {formatAmount(trade.amount_range_low, trade.amount_range_high)}
                          </td>
                          <td style={{ padding: "10px 12px" }}>{formatDate(trade.transaction_date)}</td>
                          <td style={{ padding: "10px 12px" }}>{formatDate(trade.disclosure_date)}</td>
                          <td style={{ padding: "10px 12px" }}>
                            {getQualityBadge(trade.quality_flag_ticker_match)}
                          </td>
                        </tr>
                      );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedTab === "lobbying" && (
            <div style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              overflow: "hidden",
            }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead style={{ background: "rgba(0,0,0,0.4)" }}>
                    <tr>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Client</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Reporting Entity</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Ticker</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Amount</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Period</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Issues/Topics</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lobbying.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>
                          No lobbying data available yet.
                        </td>
                      </tr>
                    ) : (
                      lobbying.map((activity) => (
                        <tr key={activity.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600 }}>{activity.client_name}</td>
                          <td style={{ padding: "10px 12px" }}>{activity.reporting_entity_name}</td>
                          <td style={{ padding: "10px 12px", color: "#3b82f6" }}>
                            {activity.ticker_normalized || "-"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {activity.lobbying_amount ? `$${activity.lobbying_amount.toLocaleString()}` : "N/A"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {activity.period_start && activity.period_end 
                              ? `${formatDate(activity.period_start)} - ${formatDate(activity.period_end)}`
                              : "N/A"}
                          </td>
                          <td style={{ padding: "10px 12px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {activity.issues_topics_raw || "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {selectedTab === "contracts" && (
            <div style={{
              background: "rgba(0,0,0,0.3)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              overflow: "hidden",
            }}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                  <thead style={{ background: "rgba(0,0,0,0.4)" }}>
                    <tr>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Recipient</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Agency</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Ticker</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Amount</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Award Date</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>Category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contracts.length === 0 ? (
                      <tr>
                        <td colSpan={6} style={{ padding: 20, textAlign: "center", opacity: 0.6 }}>
                          No federal contract data available yet.
                        </td>
                      </tr>
                    ) : (
                      contracts.map((contract) => (
                        <tr key={contract.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600 }}>{contract.recipient_name}</td>
                          <td style={{ padding: "10px 12px" }}>{contract.agency_name}</td>
                          <td style={{ padding: "10px 12px", color: "#3b82f6" }}>
                            {contract.ticker_normalized || "-"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {contract.award_amount ? `$${contract.award_amount.toLocaleString()}` : "N/A"}
                          </td>
                          <td style={{ padding: "10px 12px" }}>
                            {contract.award_date ? formatDate(contract.award_date) : "N/A"}
                          </td>
                          <td style={{ padding: "10px 12px", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {contract.category_description || "-"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
