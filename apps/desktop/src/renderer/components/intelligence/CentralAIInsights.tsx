/**
 * Central AI Insights Component
 * Displays AI predictions and learning insights
 */

import React, { useEffect, useState } from "react";

interface PredictionResult {
  symbol: string;
  confidence: number;
  reason: string;
  relatedSymbols: string[];
}

interface AIStats {
  totalInteractions: number;
  uniqueSymbols: number;
  portfolioSize: number;
  topSymbols: Array<{ symbol: string; score: number }>;
  predictions: PredictionResult[];
}

interface PersonalizedIntelligence {
  focusSymbols: string[];
  sectorAlerts: string[];
  tradingReminders: string[];
}

export function CentralAIInsights() {
  const [stats, setStats] = useState<AIStats | null>(null);
  const [intelligence, setIntelligence] = useState<PersonalizedIntelligence | null>(null);
  const [loading, setLoading] = useState(true);

  const api = window.cockpit;

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    if (!api?.centralAI) return;

    try {
      const [statsResult, intelResult] = await Promise.all([
        api.centralAI.getStats(),
        api.centralAI.getIntelligence(),
      ]);

      if (statsResult.success) {
        setStats(statsResult.stats);
      }

      if (intelResult.success) {
        setIntelligence(intelResult.intelligence);
      }
    } catch (err) {
      console.error("Failed to load Central AI data:", err);
    } finally {
      setLoading(false);
    }
  }

  const trackInteraction = async (symbol: string) => {
    if (!api?.centralAI) return;

    try {
      await api.centralAI.track({
        type: "symbol_search",
        symbol,
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Failed to track interaction:", err);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 20, textAlign: "center", opacity: 0.7 }}>
        Loading AI insights...
      </div>
    );
  }

  if (!stats || !intelligence) {
    return (
      <div style={{ padding: 20, textAlign: "center", opacity: 0.7 }}>
        Central AI not available
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* AI Predictions */}
      <div
        style={{
          border: "1px solid rgba(139,92,246,0.3)",
          borderRadius: 12,
          padding: 16,
          background: "linear-gradient(135deg, rgba(139,92,246,0.08), rgba(167,139,250,0.05))",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>🧠</span>
          <div style={{ fontWeight: 700, fontSize: 15 }}>AI Predictions</div>
          <div
            style={{
              fontSize: 11,
              opacity: 0.7,
              marginLeft: "auto",
              padding: "3px 8px",
              background: "rgba(139,92,246,0.2)",
              borderRadius: 4,
            }}
          >
            Learning Enabled
          </div>
        </div>

        {stats.predictions.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.7, fontStyle: "italic" }}>
            Build your trading history to receive AI predictions
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {stats.predictions.map((pred) => (
              <div
                key={pred.symbol}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
                onClick={() => trackInteraction(pred.symbol)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(139,92,246,0.15)";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{pred.symbol}</div>
                  <div
                    style={{
                      fontSize: 11,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: `rgba(139,92,246,${pred.confidence * 0.3})`,
                      border: `1px solid rgba(139,92,246,${pred.confidence * 0.5})`,
                    }}
                  >
                    {Math.round(pred.confidence * 100)}% confidence
                  </div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.75 }}>{pred.reason}</div>
                {pred.relatedSymbols.length > 0 && (
                  <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
                    Related: {pred.relatedSymbols.join(", ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Personalized Focus */}
      {intelligence.focusSymbols.length > 0 && (
        <div
          style={{
            border: "1px solid rgba(59,130,246,0.3)",
            borderRadius: 12,
            padding: 16,
            background: "linear-gradient(135deg, rgba(59,130,246,0.08), rgba(96,165,250,0.05))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>🎯</span>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Focus Symbols</div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {intelligence.focusSymbols.map((symbol) => (
              <div
                key={symbol}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  background: "rgba(59,130,246,0.15)",
                  border: "1px solid rgba(59,130,246,0.3)",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
                onClick={() => trackInteraction(symbol)}
              >
                {symbol}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trading Insights */}
      {(intelligence.tradingReminders.length > 0 || intelligence.sectorAlerts.length > 0) && (
        <div
          style={{
            border: "1px solid rgba(34,197,94,0.3)",
            borderRadius: 12,
            padding: 16,
            background: "linear-gradient(135deg, rgba(34,197,94,0.08), rgba(74,222,128,0.05))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 20 }}>💡</span>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Insights</div>
          </div>

          <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
            {intelligence.tradingReminders.map((reminder, idx) => (
              <div key={`reminder-${idx}`} style={{ opacity: 0.9 }}>
                • {reminder}
              </div>
            ))}
            {intelligence.sectorAlerts.map((alert, idx) => (
              <div key={`alert-${idx}`} style={{ opacity: 0.9 }}>
                • {alert}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Stats */}
      <div
        style={{
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 12,
          padding: 16,
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 20 }}>📊</span>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Learning Stats</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, fontSize: 13 }}>
          <div>
            <div style={{ opacity: 0.7, fontSize: 11, marginBottom: 4 }}>Interactions (7d)</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#7dd3fc" }}>{stats.totalInteractions}</div>
          </div>
          <div>
            <div style={{ opacity: 0.7, fontSize: 11, marginBottom: 4 }}>Symbols Tracked</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#a78bfa" }}>{stats.uniqueSymbols}</div>
          </div>
          <div>
            <div style={{ opacity: 0.7, fontSize: 11, marginBottom: 4 }}>Portfolio Size</div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "#86efac" }}>{stats.portfolioSize}</div>
          </div>
        </div>

        {stats.topSymbols.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Most Active Symbols:</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {stats.topSymbols.slice(0, 5).map((item) => (
                <div
                  key={item.symbol}
                  style={{
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.05)",
                    fontSize: 11,
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{item.symbol}</span>
                  <span style={{ opacity: 0.6, marginLeft: 6 }}>×{item.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
