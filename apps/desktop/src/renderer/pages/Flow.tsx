import React, { useEffect, useMemo, useState } from "react";
import type { EdgarFlowGraphMode, EdgarFlowIntelPayload } from "@tc/shared";

type SecEvent = {
  source: "SEC";
  type: "FORM4" | "8K";
  cik: string;
  ticker?: string;
  filedAt: string;
  title: string;
  url: string;
};

const GRAPH_MODES: Array<{ mode: EdgarFlowGraphMode; label: string }> = [
  { mode: "filings_timeline", label: "Filings Timeline" },
  { mode: "entity_relationship", label: "Entity Relationship Graph" },
  { mode: "anomaly_heatmap", label: "Anomaly Heatmap" },
  { mode: "sector_pattern", label: "Sector Pattern Graph" },
];

const panelStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.02)",
};

function buildFallbackPayload(events: SecEvent[], windowDays: number): EdgarFlowIntelPayload {
  const timeline = events.map((event, index) => ({
    filing_id: `fallback-${index}`,
    ...(event.ticker ? { ticker: event.ticker.toUpperCase() } : {}),
    company_name: event.title,
    form_type: (event.type === "FORM4" ? "4" : "8-K") as "4" | "8-K",
    filing_date: event.filedAt,
    materiality_score: event.type === "8K" ? 66 : 52,
    unusual_language_score: event.type === "8K" ? 58 : 42,
    route_priority: event.type === "8K" ? 62 : 47,
    anomaly_score: event.type === "8K" ? 62 : 44,
    is_anomaly: event.type === "8K",
  }));
  const anomalies = timeline
    .filter((item) => item.is_anomaly)
    .slice(0, 15)
    .map((item) => ({
      id: `fallback-anomaly-${item.filing_id}`,
      filing_id: item.filing_id,
      ...(item.ticker ? { ticker: item.ticker } : {}),
      company_name: item.company_name,
      severity: (item.anomaly_score >= 70 ? "critical" : "warning") as
        | "critical"
        | "warning",
      anomaly_score: item.anomaly_score,
      triggers: ["fallback_event_classification"],
      rationale: "Generated from legacy SEC event stream while FLOW intelligence endpoint is unavailable.",
      filed_at: item.filing_date,
    }));

  return {
    generated_at: new Date().toISOString(),
    window_days: windowDays,
    summary: {
      total_filings: timeline.length,
      anomaly_count: anomalies.length,
      critical_count: anomalies.filter((item) => item.severity === "critical").length,
      routed_to_flow: timeline.length,
    },
    timeline,
    entity_graph: {
      nodes: [],
      edges: [],
    },
    anomaly_heatmap: [],
    sector_patterns: [],
    anomalies,
    advice: {
      headline: "FLOW intelligence running in compatibility mode",
      synopsis: "Full anomaly engine endpoint is unavailable; using SEC event fallback stream.",
      recommendation: anomalies.length > 0 ? "watch" : "do",
      confidence: 0.46,
      why_it_matters: [
        "Fallback mode does not include cross-filing clustering.",
        "Language and materiality scoring are approximated from event type.",
      ],
      what_to_watch: [
        "Bring /api/sec/edgar/flow-intel online for full pattern detection.",
        "Monitor repeated 8-K events from the same ticker.",
      ],
    },
    intelligence_digest: {
      title: "Compatibility digest",
      bullets: [
        `${anomalies.length} provisional anomalies detected.`,
        "Switches to full digest automatically when endpoint is available.",
      ],
    },
  };
}

function GraphModeButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  const { active, label, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 999,
        padding: "8px 12px",
        border: active
          ? "1px solid rgba(96,165,250,0.8)"
          : "1px solid rgba(255,255,255,0.15)",
        background: active ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
        color: "inherit",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function TimelineView(props: { payload: EdgarFlowIntelPayload; filter: string }) {
  const rows = useMemo(() => {
    const needle = props.filter.trim().toUpperCase();
    const source = props.payload.timeline;
    if (!needle) return source;
    return source.filter(
      (item) =>
        item.ticker?.toUpperCase().includes(needle) ||
        item.company_name.toUpperCase().includes(needle),
    );
  }, [props.filter, props.payload.timeline]);

  return (
    <div style={{ ...panelStyle, minHeight: 440 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Timeline Stream</div>
      <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
        {rows.length === 0 && (
          <div style={{ fontSize: 12, opacity: 0.7 }}>No events matched this filter.</div>
        )}
        {rows.map((item) => (
          <div
            key={item.filing_id}
            style={{
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.1)",
              padding: 10,
              background: "rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontWeight: 600 }}>
                {item.ticker ?? "NO-TICKER"} · {item.form_type}
              </div>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {new Date(item.filing_date).toLocaleString()}
              </div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.82, marginTop: 4 }}>
              {item.company_name}
            </div>
            <div style={{ marginTop: 8 }}>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.08)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.min(100, item.anomaly_score)}%`,
                    height: "100%",
                    background:
                      item.anomaly_score >= 80
                        ? "#f87171"
                        : item.anomaly_score >= 60
                          ? "#fbbf24"
                          : "#34d399",
                  }}
                />
              </div>
              <div style={{ fontSize: 11, opacity: 0.7, marginTop: 5 }}>
                Anomaly score {item.anomaly_score.toFixed(1)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EntityGraphView(props: { payload: EdgarFlowIntelPayload }) {
  const nodes = props.payload.entity_graph.nodes.slice(0, 20);
  const edges = props.payload.entity_graph.edges.slice(0, 25);
  return (
    <div style={{ ...panelStyle, minHeight: 440 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Entity Relationship Graph</div>
      {nodes.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Entity graph is waiting for enriched EDGAR records.
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            {nodes.map((node) => (
              <div
                key={node.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  padding: "6px 10px",
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                }}
              >
                <div>
                  <strong>{node.label}</strong> ({node.type})
                </div>
                <div style={{ opacity: 0.75 }}>
                  filings {node.filing_count} · anomalies {node.anomaly_count}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Top active edges</div>
          <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
            {edges.map((edge) => (
              <div key={edge.id} style={{ fontSize: 12, opacity: 0.86 }}>
                {edge.source.replace(/^company:|^signal:/, "")} → {edge.target.replace(/^company:|^signal:/, "")} ({edge.relation_type}, w={edge.weight})
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function HeatmapView(props: { payload: EdgarFlowIntelPayload }) {
  const cells = props.payload.anomaly_heatmap.slice(0, 50);
  return (
    <div style={{ ...panelStyle, minHeight: 440 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Anomaly Heatmap</div>
      {cells.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Heatmap will populate after anomaly aggregation starts returning bins.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
          {cells.map((cell, index) => {
            const intensity = Math.min(1, cell.anomaly_count / Math.max(1, cell.value));
            return (
              <div
                key={`${cell.row_label}:${cell.column_label}:${index}`}
                style={{
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.1)",
                  padding: "8px 10px",
                  background: `rgba(248, 113, 113, ${0.08 + intensity * 0.32})`,
                  fontSize: 12,
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  {cell.row_label} · {cell.column_label}
                </div>
                <div>
                  filings {cell.value} · anomalies {cell.anomaly_count}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SectorPatternView(props: { payload: EdgarFlowIntelPayload }) {
  const clusters = props.payload.sector_patterns.slice(0, 16);
  return (
    <div style={{ ...panelStyle, minHeight: 440 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Sector Pattern Graph</div>
      {clusters.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          No sector clusters yet in this window.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {clusters.map((cluster) => (
            <div
              key={cluster.id}
              style={{
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.12)",
                padding: 10,
                background: "rgba(0,0,0,0.2)",
              }}
            >
              <div style={{ fontWeight: 600 }}>{cluster.label}</div>
              <div style={{ fontSize: 12, opacity: 0.76, marginTop: 4 }}>
                events {cluster.event_count} · anomalies {cluster.anomaly_count}
              </div>
              <div style={{ fontSize: 12, opacity: 0.76 }}>
                avg anomaly {cluster.avg_anomaly_score.toFixed(1)}
              </div>
              <div style={{ fontSize: 11, opacity: 0.72, marginTop: 6 }}>
                tickers: {cluster.tickers.join(", ") || "n/a"}
              </div>
              <div style={{ fontSize: 11, opacity: 0.72 }}>
                top signals: {cluster.top_signals.join(", ") || "n/a"}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdvicePanel(props: { payload: EdgarFlowIntelPayload }) {
  const { advice } = props.payload;
  const recommendationColor =
    advice.recommendation === "avoid"
      ? "#f87171"
      : advice.recommendation === "watch"
        ? "#fbbf24"
        : "#34d399";

  return (
    <div style={{ ...panelStyle, minHeight: 440 }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>Conclusion + Direct Advice</div>
      <div style={{ fontSize: 16, fontWeight: 700 }}>{advice.headline}</div>
      <div style={{ fontSize: 13, opacity: 0.82, marginTop: 8 }}>{advice.synopsis}</div>

      <div
        style={{
          marginTop: 12,
          borderRadius: 8,
          border: `1px solid ${recommendationColor}`,
          background: `${recommendationColor}22`,
          padding: "8px 10px",
          fontSize: 12,
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        Recommendation: {advice.recommendation}
      </div>

      <div style={{ fontSize: 12, opacity: 0.78, marginTop: 8 }}>
        Confidence {(advice.confidence * 100).toFixed(0)}%
      </div>

      <div style={{ marginTop: 12 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>Why it matters</div>
        <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12, opacity: 0.85 }}>
          {advice.why_it_matters.map((item, idx) => (
            <li key={`why-${idx}`}>{item}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>What to watch next</div>
        <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 12, opacity: 0.85 }}>
          {advice.what_to_watch.map((item, idx) => (
            <li key={`watch-${idx}`}>{item}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>
          Unusual pattern report
        </div>
        <div style={{ display: "grid", gap: 6, maxHeight: 180, overflowY: "auto" }}>
          {props.payload.anomalies.slice(0, 8).map((anomaly) => (
            <div
              key={anomaly.id}
              style={{
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.1)",
                padding: 8,
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong>{anomaly.ticker ?? "NO-TICKER"}</strong>
                <span style={{ opacity: 0.72 }}>{anomaly.severity}</span>
              </div>
              <div style={{ opacity: 0.85 }}>{anomaly.triggers.join(", ")}</div>
            </div>
          ))}
          {props.payload.anomalies.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.72 }}>No unusual patterns flagged in current window.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Flow() {
  const [mode, setMode] = useState<EdgarFlowGraphMode>("filings_timeline");
  const [windowDays, setWindowDays] = useState<7 | 14 | 30>(14);
  const [filter, setFilter] = useState("");
  const [payload, setPayload] = useState<EdgarFlowIntelPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadIntel = async () => {
      setLoading(true);
      setError(null);
      try {
        if (window.cockpit?.edgarIntel?.getFlowIntel) {
          const result = await window.cockpit.edgarIntel.getFlowIntel(windowDays, 220);
          if (!cancelled) {
            setPayload(result);
          }
          return;
        }

        const events = window.cockpit?.externalFeeds?.getSecEvents
          ? await window.cockpit.externalFeeds.getSecEvents({ limit: 120 })
          : [];
        if (!cancelled) {
          setPayload(buildFallbackPayload(events as SecEvent[], windowDays));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "flow_intel_load_failed");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadIntel();
    const timer = setInterval(() => {
      void loadIntel();
    }, 2 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [windowDays]);

  return (
    <div className="page">
      <div className="pageTitleRow">
        <h1 className="pageTitle">FLOW</h1>
        <div className="pageSubtitle">
          Structured filing intelligence with activatable graphs and anomaly advice
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <input
          placeholder="Filter ticker or company"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          style={{ padding: "8px 12px", borderRadius: 8, minWidth: 220 }}
        />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12 }}>
          Window
          <select
            value={windowDays}
            onChange={(event) => setWindowDays(Number(event.target.value) as 7 | 14 | 30)}
            style={{ borderRadius: 8, padding: "6px 8px" }}
          >
            <option value={7}>7d</option>
            <option value={14}>14d</option>
            <option value={30}>30d</option>
          </select>
        </label>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {GRAPH_MODES.map((graphMode) => (
            <GraphModeButton
              key={graphMode.mode}
              active={mode === graphMode.mode}
              label={graphMode.label}
              onClick={() => setMode(graphMode.mode)}
            />
          ))}
        </div>

        {payload && (
          <div style={{ fontSize: 12, opacity: 0.72 }}>
            Filings {payload.summary.total_filings} · anomalies {payload.summary.anomaly_count} · critical {payload.summary.critical_count}
          </div>
        )}
      </div>

      {error && (
        <div style={{ ...panelStyle, borderColor: "rgba(248,113,113,0.6)", marginBottom: 12 }}>
          Unable to load FLOW intelligence: {error}
        </div>
      )}

      {loading && !payload && (
        <div style={{ ...panelStyle, marginBottom: 12 }}>Loading FLOW intelligence...</div>
      )}

      {payload && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 2fr) minmax(320px, 1fr)",
            gap: 12,
          }}
        >
          {mode === "filings_timeline" && <TimelineView payload={payload} filter={filter} />}
          {mode === "entity_relationship" && <EntityGraphView payload={payload} />}
          {mode === "anomaly_heatmap" && <HeatmapView payload={payload} />}
          {mode === "sector_pattern" && <SectorPatternView payload={payload} />}
          <AdvicePanel payload={payload} />
        </div>
      )}
    </div>
  );
}