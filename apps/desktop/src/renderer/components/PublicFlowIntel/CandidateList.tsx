import React from "react";
import type { WatchlistCandidate, ValuationTag } from "@tc/shared";

type Props = {
  candidates: WatchlistCandidate[];
  valuations: Record<string, ValuationTag>;
  valuationFilter: "all" | "undervalued" | "fair" | "overvalued";
  loading?: boolean;
};

const relationColor: Record<WatchlistCandidate["relation_type"], string> = {
  peer: "#34d399",
  supplier: "#f97316",
  customer: "#a855f7",
  "etf-constituent": "#38bdf8",
};

function ValuationPill({ tag }: { tag?: ValuationTag }) {
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
      }}
    >
      {tag.tag}
    </span>
  );
}

export function CandidateList({ candidates, valuations, valuationFilter, loading = false }: Props) {
  const filtered = valuationFilter === "all"
    ? candidates
    : candidates.filter((c) => valuations[c.ticker.toUpperCase()]?.tag === valuationFilter);

  if (loading) {
    return <div style={{ opacity: 0.8 }}>Loading watchlist candidates…</div>;
  }

  if (!filtered.length) {
    return (
      <div style={{
        padding: 12,
        border: "1px dashed rgba(255,255,255,0.18)",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        color: "#cbd5e1",
        fontSize: 13,
      }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>No candidates for this theme</div>
        <div style={{ opacity: 0.75 }}>
          Adjust the valuation filter or refresh. If this stays empty, the selected theme may not have second-order ideas yet.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {filtered.map((c) => {
        const relation = relationColor[c.relation_type];
        return (
          <div
            key={`${c.theme_id}-${c.ticker}`}
            style={{
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 10,
              padding: 10,
              background: "linear-gradient(135deg, rgba(12, 16, 32, 0.9), rgba(15, 23, 42, 0.92))",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{c.ticker}</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 11,
                    background: `${relation}22`,
                    color: relation,
                    fontWeight: 700,
                  }}
                >
                  {c.relation_type}
                </span>
                <ValuationPill tag={valuations[c.ticker.toUpperCase()]} />
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.82, marginTop: 6 }}>{c.rationale}</div>
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
              Added: {new Date(c.created_at).toLocaleDateString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
