/**
 * Economic Calendar Component
 * Next 24h with placeholder data + plugin interface
 * Shows "requires API key" if not configured
 */

import React, { useMemo } from "react";
import type { EconomicCalendarData } from "./types";

interface EconomicCalendarProps {
  data: EconomicCalendarData;
}

function formatTime(ts: number): string {
  try {
    const date = new Date(ts);
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
    });
  } catch {
    return "—";
  }
}

function getImpactColor(impact: "low" | "medium" | "high"): string {
  switch (impact) {
    case "high":
      return "#ef4444";
    case "medium":
      return "#fbbf24";
    case "low":
      return "#4ade80";
  }
}

export function EconomicCalendar({ data }: EconomicCalendarProps): React.ReactElement {
  const next24h = useMemo(() => {
    const now = typeof data.timestamp === "number" ? data.timestamp : 0;
    return data.events.filter((e) => e.time - now >= 0 && e.time - now < 24 * 60 * 60 * 1000);
  }, [data.events, data.timestamp]);

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: 12,
        background: "rgba(0,0,0,0.3)",
        marginBottom: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>📅 Economic Calendar (24h)</h3>
        <div
          style={{
            fontSize: 10,
            opacity: 0.6,
            padding: "2px 6px",
            background: data.hasApiKey
              ? "rgba(74,222,128,0.2)"
              : "rgba(239,68,68,0.2)",
            borderRadius: 3,
            color: data.hasApiKey ? "#4ade80" : "#ef4444",
          }}
        >
          {data.hasApiKey ? "✓ Configured" : "⚠️ No API Key"}
        </div>
      </div>

      {/* API Key Notice */}
      {!data.hasApiKey && (
        <div
          style={{
            fontSize: 11,
            opacity: 0.7,
            padding: 8,
            background: "rgba(239,68,68,0.1)",
            borderRadius: 4,
            marginBottom: 10,
            borderLeft: "2px solid #ef4444",
            lineHeight: 1.4,
          }}
        >
          📌 <b>Data source not configured.</b> To use real economic calendar data, configure
          your API key in Settings. Using placeholder data for demo.
        </div>
      )}

      {/* Source Note */}
      <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 10 }}>
        Source: {data.source === "configured" ? "📡 Configured API" : "⚪ Placeholder Data"}
      </div>

      {/* Events List */}
      {next24h.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6, padding: 8, textAlign: "center" }}>
          No economic events in next 24 hours
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {next24h.map((event) => (
            <div
              key={event.id}
              style={{
                border: `1px solid ${getImpactColor(event.impact)}33`,
                borderLeft: `3px solid ${getImpactColor(event.impact)}`,
                borderRadius: 4,
                padding: 10,
                background: `${getImpactColor(event.impact)}08`,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto auto",
                  gap: 12,
                  alignItems: "center",
                  marginBottom: 6,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>
                    {event.event}{" "}
                    <span style={{ opacity: 0.6, fontSize: 11 }}>({event.country})</span>
                  </div>
                  {event.summary && (
                    <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>{event.summary}</div>
                  )}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    opacity: 0.7,
                    minWidth: 45,
                  }}
                >
                  {formatTime(event.time)}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    color: getImpactColor(event.impact),
                    textTransform: "uppercase",
                    minWidth: 50,
                    textAlign: "right",
                  }}
                >
                  {event.impact}
                </div>
              </div>

              {/* Forecast/Prior/Actual */}
              {(event.forecast !== undefined || event.prior !== undefined || event.actual !== undefined) && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
                    gap: 8,
                    fontSize: 10,
                    opacity: 0.8,
                  }}
                >
                  {event.forecast !== undefined && (
                    <div>
                      <span style={{ opacity: 0.6 }}>Forecast:</span>{" "}
                      <span style={{ fontWeight: 600 }}>{event.forecast.toFixed(2)}</span>
                    </div>
                  )}
                  {event.prior !== undefined && (
                    <div>
                      <span style={{ opacity: 0.6 }}>Prior:</span>{" "}
                      <span style={{ fontWeight: 600 }}>{event.prior.toFixed(2)}</span>
                    </div>
                  )}
                  {event.actual !== undefined && (
                    <div>
                      <span style={{ opacity: 0.6 }}>Actual:</span>{" "}
                      <span style={{ fontWeight: 600, color: "#4ade80" }}>{event.actual.toFixed(2)}</span>
                    </div>
                  )}
                </div>
              )}

              {/* State badge */}
              <div
                style={{
                  fontSize: 9,
                  opacity: 0.5,
                  marginTop: 6,
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {event.state === "upcoming" ? "⏳ Upcoming" : "✓ Released"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
