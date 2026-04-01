/**
 * Indices Carousel Component
 * SPY, QQQ, IWM with mini intraday chart + ATR + VWAP deviation
 */

import React, { useMemo } from "react";
import type { IndexSnapshot } from "./types";

interface IndicesCarouselProps {
  indices: IndexSnapshot[];
}

/** Mini chart renderer */
function MiniChart({ bars }: { bars: IndexSnapshot["bars"] }): React.ReactElement {
  if (bars.length === 0) return <div style={{ fontSize: 10, opacity: 0.5 }}>No data</div>;

  const closes = bars.map((b: { c: number }) => b.c);
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const range = high - low || 1;

  const height = 40;
  const width = bars.length * 4;

  // Normalize closes to SVG height
  const points = closes
    .map((c: number, i: number) => {
      const y = height - ((c - low) / range) * height;
      return `${i * 4},${y}`;
    })
    .join(" ");

  const startColor = (closes[0] ?? 0) < (closes[closes.length - 1] ?? 0) ? "#4ade80" : "#ef4444";

  return (
    <svg
      width={width}
      height={height}
      style={{
        border: `1px solid ${startColor}33`,
        borderRadius: 4,
        background: "rgba(0,0,0,0.2)",
      }}
    >
      <polyline points={points} fill="none" stroke={startColor} strokeWidth="1.5" />
    </svg>
  );
}

export function IndicesCarousel({ indices }: IndicesCarouselProps): React.ReactElement {
  const percentChanges = useMemo(() => {
    return indices.map((idx) => ((idx.price - idx.pricePrior) / idx.pricePrior) * 100);
  }, [indices]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
        gap: 14,
        marginBottom: 16,
      }}
    >
      {indices.map((idx, i) => (
        <div
          key={idx.symbol}
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            padding: 12,
            background: "rgba(0,0,0,0.3)",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{idx.symbol}</div>
            <div
              style={{
                color: (percentChanges[i] ?? 0) >= 0 ? "#4ade80" : "#ef4444",
                fontWeight: 600,
              }}
            >
              {(percentChanges[i] ?? 0) >= 0 ? "+" : ""}
              {(percentChanges[i] ?? 0).toFixed(2)}%
            </div>
          </div>

          {/* Price */}
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>
            {idx.price.toFixed(2)}
          </div>

          {/* Mini Chart */}
          <div style={{ marginBottom: 10 }}>
            <MiniChart bars={idx.bars} />
          </div>

          {/* ATR + VWAP */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              fontSize: 12,
              opacity: 0.85,
            }}
          >
            <div>
              <div style={{ opacity: 0.6, marginBottom: 2 }}>ATR</div>
              <div style={{ fontWeight: 600 }}>{idx.atr.toFixed(2)}</div>
            </div>
            <div>
              <div style={{ opacity: 0.6, marginBottom: 2 }}>VWAP Dev (bps)</div>
              <div
                style={{
                  fontWeight: 600,
                  color: idx.vwapDeviation > 0 ? "#4ade80" : "#ef4444",
                }}
              >
                {idx.vwapDeviation > 0 ? "+" : ""}
                {idx.vwapDeviation.toFixed(0)}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
