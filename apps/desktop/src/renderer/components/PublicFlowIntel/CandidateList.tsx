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
  const filtered = (valuationFilter === "all"
    ? candidates
    : candidates.filter((c) => valuations[c.ticker.toUpperCase()]?.tag === valuationFilter))
    .slice()
    .sort((a, b) => {
      const scoreDelta = (b.importance_score ?? 0) - (a.importance_score ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      const confidenceDelta = (b.confidence_score ?? 0) - (a.confidence_score ?? 0);
      if (confidenceDelta !== 0) return confidenceDelta;
      return Date.parse(b.created_at) - Date.parse(a.created_at);
    });

  const priorityTone: Record<string, { fg: string; bg: string }> = {
    critical: { fg: "#f87171", bg: "rgba(248,113,113,0.16)" },
    high: { fg: "#f59e0b", bg: "rgba(245,158,11,0.16)" },
    medium: { fg: "#22d3ee", bg: "rgba(34,211,238,0.14)" },
    low: { fg: "#94a3b8", bg: "rgba(148,163,184,0.16)" },
  };

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
        const priority = c.priority ?? "low";
        const priorityStyle = priorityTone[priority] ?? priorityTone.low;
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
                <span
                  style={{
                    padding: "2px 8px",
                    borderRadius: 10,
                    fontSize: 11,
                    background: priorityStyle.bg,
                    color: priorityStyle.fg,
                    fontWeight: 700,
                    textTransform: "capitalize",
                  }}
                >
                  {priority}
                </span>
                <ValuationPill tag={valuations[c.ticker.toUpperCase()]} />
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.82, marginTop: 6 }}>{c.rationale}</div>
            {(typeof c.importance_score === "number" || typeof c.confidence_score === "number") && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                {typeof c.importance_score === "number" && (
                  <span style={{ fontSize: 11, opacity: 0.82 }}>
                    Score {c.importance_score.toFixed(1)}
                  </span>
                )}
                {typeof c.confidence_score === "number" && (
                  <span style={{ fontSize: 11, opacity: 0.72 }}>
                    Confidence {(c.confidence_score * 100).toFixed(0)}%
                  </span>
                )}
                {typeof c.theme_count === "number" && c.theme_count > 1 && (
                  <span style={{ fontSize: 11, opacity: 0.72 }}>
                    Appears in {c.theme_count} themes
                  </span>
                )}
              </div>
            )}
            <div style={{ fontSize: 11, opacity: 0.6, marginTop: 6 }}>
              Added: {new Date(c.created_at).toLocaleDateString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}
