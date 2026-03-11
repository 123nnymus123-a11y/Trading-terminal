import React from "react";
import type { DisclosureEvent, ValuationTag } from "@tc/shared";

type Props = {
  events: DisclosureEvent[];
  valuations: Record<string, ValuationTag>;
  loading?: boolean;
  emptyHint?: string;
};

function formatMoney(min?: number | null, max?: number | null): string {
  if (min == null && max == null) return "n/a";
  const fmt = (v: number) => {
    if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
    return `$${v.toFixed(0)}`;
  };
  if (min != null && max != null) return `${fmt(min)}-${fmt(max)}`;
  return fmt((min ?? max) as number);
}

function renderValuation(tag?: ValuationTag): JSX.Element | null {
  if (!tag) return null;
  const color = tag.tag === "undervalued" ? "#34d399" : tag.tag === "overvalued" ? "#f59e0b" : "#a78bfa";
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 12,
        background: `${color}22`,
        color,
        fontSize: 11,
        marginLeft: 8,
      }}
    >
      {tag.tag} • {(tag.confidence * 100).toFixed(0)}%
    </span>
  );
}

export function DisclosureList({ events, valuations, loading = false, emptyHint }: Props) {
  if (loading) {
    return <div style={{ opacity: 0.8 }}>Loading disclosures…</div>;
  }

  if (!events.length) {
    return (
      <div style={{
        padding: 12,
        border: "1px dashed rgba(255,255,255,0.18)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        color: "#cbd5e1",
        fontSize: 13,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>No disclosures available</div>
        <div style={{ opacity: 0.75 }}>{emptyHint ?? "Try Refresh or import new CSV/JSON files in the drop folder."}</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {events.map((evt) => (
        <div
          key={`${evt.id}-${evt.ticker ?? "na"}`}
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: 10,
            background: "linear-gradient(135deg, rgba(15,23,42,0.75), rgba(30,41,59,0.9))",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>
              {evt.ticker ?? "(no ticker)"}
              {renderValuation(evt.ticker ? valuations[evt.ticker.toUpperCase()] : undefined)}
            </div>
            <div
              style={{
                padding: "2px 8px",
                borderRadius: 8,
                fontSize: 11,
                background: evt.action === "BUY" ? "rgba(34,197,94,0.12)" : "rgba(248,113,113,0.12)",
                color: evt.action === "BUY" ? "#34d399" : "#f87171",
                fontWeight: 700,
              }}
            >
              {evt.action}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 6, fontSize: 12, opacity: 0.9 }}>
            <div>Entity: <b>{evt.entity_name}</b></div>
            <div>Sector: <b>{evt.sector ?? "Unknown"}</b></div>
            <div>Report: <b>{new Date(evt.report_date).toLocaleDateString()}</b></div>
            <div>Tx Date: <b>{new Date(evt.tx_date).toLocaleDateString()}</b></div>
            <div>Value: <b>{formatMoney(evt.amount_min, evt.amount_max)}</b></div>
            {evt.source && (
              <div>Source: <b>{evt.source}</b></div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
