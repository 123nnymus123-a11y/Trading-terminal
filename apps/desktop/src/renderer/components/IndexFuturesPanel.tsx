/**
 * Index Futures Trading Panel - Simple Version
 * Fast-paced, streamlined interface for index futures traders
 */

import React, { useState, useMemo } from "react";
import { useMarketConfig } from "../hooks/useMarketConfig";

export function IndexFuturesPanel() {
  const { symbols } = useMarketConfig();
  const [selectedSymbol, setSelectedSymbol] = useState("ES");
  const [selectedTimeframe, setSelectedTimeframe] = useState("5m");

  const timeframes = useMemo(() => ["1m", "5m", "15m", "1h", "4h"], []);

  // Mock real-time data
  const marketData = useMemo(() => {
    return {
      price: 4850.5,
      change: 12.3,
      changePercent: 0.25,
      bid: 4850.25,
      ask: 4850.75,
      volume: "1.2M",
      openInterest: "2.5M",
    };
  }, []);

  const technicalStatus = useMemo(() => {
    return {
      rsi: 65,
      macd: "bullish",
      trend: "up",
      resistance1: 4860,
      resistance2: 4880,
      support1: 4840,
      support2: 4820,
    };
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div>
        <h3 style={{ margin: "0 0 4px 0", fontSize: 18 }}>⚡ Index Futures Trading</h3>
        <div style={{ fontSize: 12, opacity: 0.6 }}>Fast-paced, streamlined trading interface</div>
      </div>

      {/* Quick Symbol & Timeframe Selector */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <select
          value={selectedSymbol}
          onChange={(e) => setSelectedSymbol(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.02)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {symbols.map((sym) => (
            <option key={sym} value={sym}>
              {sym}
            </option>
          ))}
        </select>
        <select
          value={selectedTimeframe}
          onChange={(e) => setSelectedTimeframe(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.1)",
            background: "rgba(255,255,255,0.02)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {timeframes.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
      </div>

      {/* Price & Order Flow Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 8 }}>
        <div
          style={{
            padding: 10,
            background: "rgba(255,255,255,0.02)",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Last</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{marketData.price}</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, color: "#86efac" }}>
            +{marketData.change} ({marketData.changePercent}%)
          </div>
        </div>

        <div
          style={{
            padding: 10,
            background: "rgba(255,255,255,0.02)",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Bid/Ask</div>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{marketData.bid}/{marketData.ask}</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Spread: 0.5</div>
        </div>

        <div
          style={{
            padding: 10,
            background: "rgba(255,255,255,0.02)",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Volume</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{marketData.volume}</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>OI: {marketData.openInterest}</div>
        </div>

        <div
          style={{
            padding: 10,
            background: "rgba(255,255,255,0.02)",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>RSI(14)</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: technicalStatus.rsi > 70 ? "#fca5a5" : "#86efac" }}>
            {technicalStatus.rsi}
          </div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
            {technicalStatus.rsi > 70 ? "Overbought" : technicalStatus.rsi < 30 ? "Oversold" : "Neutral"}
          </div>
        </div>
      </div>

      {/* Quick Technical Levels */}
      <div
        style={{
          padding: 10,
          background: "rgba(59,130,246,0.08)",
          border: "1px solid rgba(59,130,246,0.2)",
          borderRadius: 6,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>📍 Key Levels</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
          <div>
            <div style={{ opacity: 0.6, marginBottom: 2 }}>Resistance</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{technicalStatus.resistance1} / {technicalStatus.resistance2}</div>
          </div>
          <div>
            <div style={{ opacity: 0.6, marginBottom: 2 }}>Support</div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{technicalStatus.support1} / {technicalStatus.support2}</div>
          </div>
        </div>
      </div>

      {/* Trend & MACD Status */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div
          style={{
            padding: 10,
            background: "rgba(134,239,172,0.08)",
            border: "1px solid rgba(134,239,172,0.2)",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>Trend</div>
          <div style={{ fontSize: 14, fontWeight: 700, textTransform: "capitalize", color: "#86efac" }}>
            {technicalStatus.trend} ↑
          </div>
        </div>
        <div
          style={{
            padding: 10,
            background: "rgba(134,239,172,0.08)",
            border: "1px solid rgba(134,239,172,0.2)",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>MACD</div>
          <div style={{ fontSize: 14, fontWeight: 700, textTransform: "capitalize", color: "#86efac" }}>
            {technicalStatus.macd}
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button style={{ flex: 1, minWidth: 100, padding: "6px 8px", fontSize: 12 }}>Buy</button>
        <button style={{ flex: 1, minWidth: 100, padding: "6px 8px", fontSize: 12 }}>Sell</button>
        <button style={{ flex: 1, minWidth: 100, padding: "6px 8px", fontSize: 12 }}>Close</button>
        <button style={{ flex: 1, minWidth: 100, padding: "6px 8px", fontSize: 12 }}>Alerts</button>
      </div>

      {/* Info Badge */}
      <div style={{ fontSize: 11, opacity: 0.6, textAlign: "center", paddingTop: 4 }}>
        ES = S&P 500 Futures | NQ = Nasdaq 100 Futures | YM = Dow Futures | RTY = Russell 2000 Futures
      </div>
    </div>
  );
}
