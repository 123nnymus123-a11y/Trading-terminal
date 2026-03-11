import React, { useEffect, useMemo, useState } from "react";

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24"];

type MacroPoint = { date: string; value: number };

type MacroSeries = {
  seriesId: string;
  name: string;
  frequency: string;
  points: MacroPoint[];
};

export function Macro() {
  const [series, setSeries] = useState<MacroSeries[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchSeries = async () => {
      if (!window.cockpit?.externalFeeds?.getJoltsSeries) return;
      setLoading(true);
      try {
        const data = await window.cockpit.externalFeeds.getJoltsSeries();
        if (!cancelled) setSeries(data as MacroSeries[]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchSeries();
    const timer = setInterval(fetchSeries, 24 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const lastUpdated = useMemo(() => {
    const last = series
      .flatMap((s) => s.points)
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop();
    return last?.date ?? "—";
  }, [series]);

  return (
    <div className="page">
      <div className="pageTitleRow">
        <h1 className="pageTitle">MACRO</h1>
        <div className="pageSubtitle">BLS JOLTS overview (Phase‑1)</div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>Last update: {lastUpdated}</div>
          {loading && <div style={{ fontSize: 12, opacity: 0.6 }}>Loading…</div>}
        </div>

        <JoltsChart series={series} />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {series.map((s, idx) => {
            const lastPoint = s.points[s.points.length - 1];
            return (
              <div key={s.seriesId} style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
                <div style={{ fontSize: 12, opacity: 0.7 }}>{s.seriesId}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: COLORS[idx % COLORS.length] }}>{lastPoint?.value ?? "—"}</div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>{lastPoint?.date ?? "—"}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function JoltsChart({ series }: { series: MacroSeries[] }) {
  if (!series.length) {
    return (
      <div style={{ padding: 16, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.2)", opacity: 0.7 }}>
        No JOLTS data yet. Add your BLS key and enable BLS in Settings.
      </div>
    );
  }

  const allPoints = series.flatMap((s) => s.points);
  const minValue = Math.min(...allPoints.map((p) => p.value));
  const maxValue = Math.max(...allPoints.map((p) => p.value));

  const viewWidth = 800;
  const viewHeight = 260;
  const padding = 30;

  const scaleX = (index: number, length: number) => {
    if (length <= 1) return padding;
    return padding + (index / (length - 1)) * (viewWidth - padding * 2);
  };

  const scaleY = (value: number) => {
    if (maxValue === minValue) return viewHeight / 2;
    return padding + (1 - (value - minValue) / (maxValue - minValue)) * (viewHeight - padding * 2);
  };

  return (
    <div style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.25)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>JOLTS: Openings, Hires, Quits, Layoffs</div>
      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} width="100%" height="260">
        <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="rgba(0,0,0,0.15)" rx="8" />
        <line x1={padding} y1={padding} x2={padding} y2={viewHeight - padding} stroke="rgba(255,255,255,0.15)" />
        <line x1={padding} y1={viewHeight - padding} x2={viewWidth - padding} y2={viewHeight - padding} stroke="rgba(255,255,255,0.15)" />
        {series.map((s, idx) => {
          const path = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i, s.points.length)} ${scaleY(p.value)}`)
            .join(" ");
          return <path key={s.seriesId} d={path} fill="none" stroke={COLORS[idx % COLORS.length]} strokeWidth="2" />;
        })}
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        {series.map((s, idx) => (
          <div key={s.seriesId} style={{ fontSize: 12, opacity: 0.8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: COLORS[idx % COLORS.length], display: "inline-block" }} />
            {s.seriesId}
          </div>
        ))}
      </div>
    </div>
  );
}
