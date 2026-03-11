/**
 * US Large Cap Trading Panel - Sophisticated Version
 * Full-featured equity trading interface with advanced analytics
 */

import React, { useState, useMemo } from "react";
import { useMarketConfig } from "../hooks/useMarketConfig";

export function USLargeCapPanel() {
  const { symbols, defaultIndicators } = useMarketConfig();
  const [selectedSymbol, setSelectedSymbol] = useState("AAPL");
  const [selectedTimeframe, setSelectedTimeframe] = useState("1d");
  const [showFundamental, setShowFundamental] = useState(true);
  const [showSentiment, setShowSentiment] = useState(true);

  const timeframes = useMemo(() => ["1m", "5m", "15m", "1h", "4h", "1d", "1w"], []);

  const fundamentalMetrics = useMemo(() => {
    // These would be populated from data feeds
    return {
      pe: 28.5,
      eps: 6.05,
      dividend: 0.24,
      marketCap: "3.4T",
      beta: 1.1,
    };
  }, []);

  const sentimentData = useMemo(() => {
    return {
      overall: "bullish",
      institutional: 78,
      retail: 65,
      newsScore: 72,
      socialScore: 68,
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h3 style={{ margin: "0 0 4px 0", fontSize: 18 }}>📊 US Large Cap Trading</h3>
          <div style={{ fontSize: 12, opacity: 0.6 }}>Sophisticated equity analysis platform</div>
        </div>
      </div>

      {/* Symbol & Timeframe Selector */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={{ display: "block", fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Symbol</label>
          <select
            value={selectedSymbol}
            onChange={(e) => setSelectedSymbol(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.02)",
              color: "white",
              fontSize: 13,
            }}
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Timeframe</label>
          <select
            value={selectedTimeframe}
            onChange={(e) => setSelectedTimeframe(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.02)",
              color: "white",
              fontSize: 13,
            }}
          >
            {timeframes.map((tf) => (
              <option key={tf} value={tf}>
                {tf}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Default Indicators */}
      <div style={{ padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>📈 Default Indicators</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {defaultIndicators.map((ind) => (
            <div
              key={ind}
              style={{
                padding: "4px 8px",
                background: "rgba(59,130,246,0.1)",
                border: "1px solid rgba(59,130,246,0.3)",
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              {ind}
            </div>
          ))}
        </div>
      </div>

      {/* Fundamental Analysis Panel */}
      <div style={{ padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            cursor: "pointer",
          }}
          onClick={() => setShowFundamental(!showFundamental)}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>💼 Fundamental Analysis</div>
          <span style={{ opacity: 0.6 }}>{showFundamental ? "▼" : "▶"}</span>
        </div>
        {showFundamental && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 12, fontSize: 12 }}>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>P/E Ratio</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fundamentalMetrics.pe}</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>EPS</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>${fundamentalMetrics.eps}</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>Dividend</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>${fundamentalMetrics.dividend}</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>Market Cap</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fundamentalMetrics.marketCap}</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>Beta</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{fundamentalMetrics.beta}</div>
            </div>
          </div>
        )}
      </div>

      {/* Sentiment Analysis Panel */}
      <div style={{ padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 8 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            cursor: "pointer",
          }}
          onClick={() => setShowSentiment(!showSentiment)}
        >
          <div style={{ fontSize: 12, fontWeight: 600 }}>🎯 Sentiment Analysis</div>
          <span style={{ opacity: 0.6 }}>{showSentiment ? "▼" : "▶"}</span>
        </div>
        {showSentiment && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, fontSize: 12 }}>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>Overall</div>
              <div style={{ fontSize: 14, fontWeight: 700, textTransform: "capitalize", color: "#86efac" }}>
                {sentimentData.overall}
              </div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>Institutional</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{sentimentData.institutional}%</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>Retail</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{sentimentData.retail}%</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>News Score</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{sentimentData.newsScore}/100</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 4 }}>Social Score</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{sentimentData.socialScore}/100</div>
            </div>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={{ flex: 1, minWidth: 120 }}>View Advanced Charts</button>
        <button style={{ flex: 1, minWidth: 120 }}>Show News</button>
        <button style={{ flex: 1, minWidth: 120 }}>Set Alerts</button>
      </div>
    </div>
  );
}
