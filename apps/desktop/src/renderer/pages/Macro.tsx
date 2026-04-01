import React, { useEffect, useMemo, useState } from "react";

const COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24"];
const COMPARE_COLORS = ["#f59e0b", "#60a5fa", "#34d399", "#f472b6", "#a78bfa", "#f87171"];
const MAX_ZOOM = 8;

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
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [windowYears, setWindowYears] = useState(3);
  const [compareYears, setCompareYears] = useState(1);
  const [focusSeriesId, setFocusSeriesId] = useState<string>("");
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomOffsetMonths, setZoomOffsetMonths] = useState(0);
  const [maxZoomOffsetMonths, setMaxZoomOffsetMonths] = useState(0);

  const fetchSeries = async (forceRefresh = false) => {
    if (!window.cockpit?.externalFeeds?.getJoltsSeries) return;
    setLoading(true);
    try {
      const data = await window.cockpit.externalFeeds.getJoltsSeries({ forceRefresh });
      setSeries(data as MacroSeries[]);
      setLastChecked(new Date());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSeries();
    // Re-check every 4 hours — BLS publishes monthly but we want to catch it promptly
    const timer = setInterval(() => fetchSeries(), 4 * 60 * 60 * 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastUpdated = useMemo(() => {
    const last = series
      .flatMap((s) => s.points)
      .sort((a, b) => a.date.localeCompare(b.date))
      .pop();
    return last?.date ?? "—";
  }, [series]);

  useEffect(() => {
    if (!series.length) return;
    if (!focusSeriesId || !series.some((s) => s.seriesId === focusSeriesId)) {
      setFocusSeriesId(series[0].seriesId);
    }
  }, [series, focusSeriesId]);

  useEffect(() => {
    setZoomOffsetMonths(0);
  }, [windowYears, zoomLevel]);

  useEffect(() => {
    setZoomOffsetMonths((prev) => Math.min(prev, maxZoomOffsetMonths));
  }, [maxZoomOffsetMonths]);

  const focusSeries = useMemo(
    () => series.find((s) => s.seriesId === focusSeriesId) ?? series[0] ?? null,
    [series, focusSeriesId],
  );

  const hasLiveData = useMemo(
    () => series.some((s) => s.points.length > 0),
    [series],
  );

  const latestPointDate = useMemo(() => {
    const latest = series
      .flatMap((s) => s.points)
      .map((p) => p.date)
      .sort((a, b) => a.localeCompare(b))
      .at(-1);
    return latest ?? null;
  }, [series]);

  const onWheelZoom = (direction: "in" | "out") => {
    setZoomLevel((prev) => {
      if (direction === "in") return clamp(prev + 1, 1, MAX_ZOOM);
      return clamp(prev - 1, 1, MAX_ZOOM);
    });
  };

  return (
    <div className="page">
      <div className="pageTitleRow">
        <h1 className="pageTitle">MACRO</h1>
        <div className="pageSubtitle">BLS JOLTS overview (Phase‑1)</div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 13, opacity: 0.7 }}>
            Latest series point: {lastUpdated}
            {lastChecked && (
              <span style={{ marginLeft: 12, opacity: 0.5 }}>
                · checked {lastChecked.toLocaleTimeString()}
              </span>
            )}
          </div>
          <button
            onClick={() => fetchSeries(true)}
            disabled={loading}
            style={{
              padding: "4px 12px",
              fontSize: 12,
              borderRadius: 6,
              opacity: loading ? 0.5 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(255,255,255,0.1)",
            background:
              "linear-gradient(140deg, rgba(17,24,39,0.82), rgba(15,23,42,0.6))",
          }}
        >
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span style={{ opacity: 0.7 }}>Time window (years)</span>
            <select
              value={windowYears}
              onChange={(e) => setWindowYears(Number(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 6 }}
            >
              {[1, 2, 3, 4, 5, 7, 10].map((y) => (
                <option key={y} value={y}>
                  Last {y} year{y > 1 ? "s" : ""}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span style={{ opacity: 0.7 }}>Comparison metric</span>
            <select
              value={focusSeries?.seriesId ?? ""}
              onChange={(e) => setFocusSeriesId(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: 6 }}
            >
              {series.map((s) => (
                <option key={s.seriesId} value={s.seriesId}>
                  {friendlySeriesName(s.seriesId)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span style={{ opacity: 0.7 }}>Compare against previous years</span>
            <select
              value={compareYears}
              onChange={(e) => setCompareYears(Number(e.target.value))}
              style={{ padding: "8px 10px", borderRadius: 6 }}
            >
              {[0, 1, 2, 3, 4, 5].map((y) => (
                <option key={y} value={y}>
                  {y === 0 ? "None" : `${y} year${y > 1 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </label>

          <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span style={{ opacity: 0.7 }}>Timeline zoom</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={() => setZoomLevel((z) => clamp(z - 1, 1, MAX_ZOOM))} disabled={zoomLevel === 1} style={miniButtonStyle}>
                -
              </button>
              <div style={{ minWidth: 72, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                {zoomLevel.toFixed(1)}x
              </div>
              <button onClick={() => setZoomLevel((z) => clamp(z + 1, 1, MAX_ZOOM))} disabled={zoomLevel === MAX_ZOOM} style={miniButtonStyle}>
                +
              </button>
              <button onClick={() => { setZoomLevel(1); setZoomOffsetMonths(0); }} style={miniButtonStyle}>
                Reset
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
            <span style={{ opacity: 0.7 }}>Pan within zoomed window</span>
            <input
              type="range"
              min={0}
              max={Math.max(0, maxZoomOffsetMonths)}
              value={Math.min(zoomOffsetMonths, maxZoomOffsetMonths)}
              onChange={(e) => setZoomOffsetMonths(Number(e.target.value))}
              disabled={maxZoomOffsetMonths === 0}
            />
          </div>
        </div>

        {!hasLiveData && (
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(248,113,113,0.45)", background: "rgba(127,29,29,0.22)", fontSize: 12 }}>
            No live BLS JOLTS data is currently loaded. Mock/synthetic fallback is disabled. Enable BLS in Settings and add a valid API key.
          </div>
        )}

        <JoltsChart
          series={series}
          windowYears={windowYears}
          zoomLevel={zoomLevel}
          zoomOffsetMonths={zoomOffsetMonths}
          onZoomBoundsChange={(maxOffset) => setMaxZoomOffsetMonths(maxOffset)}
          onWheelZoom={onWheelZoom}
        />

        <YoYComparisonChart series={focusSeries} compareYears={compareYears} />

        <SeriesDetailPanel series={series} latestPointDate={latestPointDate} />

        <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)", fontSize: 12, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Data source context</div>
          <div style={{ opacity: 0.8 }}>
            Source: U.S. Bureau of Labor Statistics (BLS) Public API v2, JOLTS monthly series (Openings, Hires,
            Quits, Layoffs). Data is fetched through the desktop main process and cached locally for 4 hours.
            Manual Refresh bypasses cache and requests the latest available BLS monthly release.
          </div>
        </div>

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

function JoltsChart({
  series,
  windowYears,
  zoomLevel,
  zoomOffsetMonths,
  onZoomBoundsChange,
  onWheelZoom,
}: {
  series: MacroSeries[];
  windowYears: number;
  zoomLevel: number;
  zoomOffsetMonths: number;
  onZoomBoundsChange: (maxOffset: number) => void;
  onWheelZoom: (direction: "in" | "out") => void;
}) {
  if (!series.length) {
    return (
      <div style={{ padding: 16, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.2)", opacity: 0.7 }}>
        No BLS JOLTS data loaded from the provider.
      </div>
    );
  }

  const allPoints = series.flatMap((s) => s.points);
  const latestDate = allPoints
    .map((p) => p.date)
    .sort((a, b) => a.localeCompare(b))
    .at(-1);

  if (!latestDate) {
    return null;
  }

  const windowEnd = latestDate;
  const windowStart = shiftYearMonth(windowEnd, -(windowYears * 12) + 1);
  const baseMonths = monthDiffInclusive(windowStart, windowEnd);
  const zoomedMonths = clamp(Math.floor(baseMonths / zoomLevel), 6, baseMonths);
  const maxOffset = Math.max(0, baseMonths - zoomedMonths);
  const effectiveOffset = clamp(zoomOffsetMonths, 0, maxOffset);
  if (maxOffset !== undefined) {
    onZoomBoundsChange(maxOffset);
  }

  const zoomStart = shiftYearMonth(windowStart, effectiveOffset);
  const zoomEnd = shiftYearMonth(zoomStart, zoomedMonths - 1);

  const filteredSeries = series.map((s) => ({
    ...s,
    points: s.points.filter((p) => p.date >= zoomStart && p.date <= zoomEnd),
  }));

  const filteredPoints = filteredSeries.flatMap((s) => s.points);
  if (!filteredPoints.length) {
    return null;
  }

  const exactWindowMonths = monthDiffInclusive(zoomStart, zoomEnd);

  const xAxisDates = buildXAxisDates(zoomStart, zoomEnd);
  const minValue = Math.min(...filteredPoints.map((p) => p.value));
  const maxValue = Math.max(...filteredPoints.map((p) => p.value));

  const viewWidth = 800;
  const viewHeight = 260;
  const padding = 40;

  const scaleX = (index: number, length: number) => {
    if (length <= 1) return padding;
    return padding + (index / (length - 1)) * (viewWidth - padding * 2);
  };

  const scaleY = (value: number) => {
    if (maxValue === minValue) return viewHeight / 2;
    return padding + (1 - (value - minValue) / (maxValue - minValue)) * (viewHeight - padding * 2);
  };

  return (
    <div
      onWheel={(event) => {
        event.preventDefault();
        onWheelZoom(event.deltaY < 0 ? "in" : "out");
      }}
      style={{ padding: 12, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(0,0,0,0.25)" }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>JOLTS timeline</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Window: {formatYearMonth(zoomStart)} to {formatYearMonth(zoomEnd)} ({exactWindowMonths} months)
        </div>
      </div>
      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} width="100%" height="260">
        <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="rgba(0,0,0,0.15)" rx="8" />
        {Array.from({ length: 5 }).map((_, i) => {
          const y = padding + (i / 4) * (viewHeight - padding * 2);
          const value = maxValue - (i / 4) * (maxValue - minValue);
          return (
            <g key={i}>
              <line x1={padding} y1={y} x2={viewWidth - padding} y2={y} stroke="rgba(255,255,255,0.08)" />
              <text x={padding - 8} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.5)" fontSize="10">
                {formatCompactValue(value)}
              </text>
            </g>
          );
        })}
        <line x1={padding} y1={padding} x2={padding} y2={viewHeight - padding} stroke="rgba(255,255,255,0.15)" />
        <line x1={padding} y1={viewHeight - padding} x2={viewWidth - padding} y2={viewHeight - padding} stroke="rgba(255,255,255,0.15)" />
        {filteredSeries.map((s, idx) => {
          const path = s.points
            .map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(i, s.points.length)} ${scaleY(p.value)}`)
            .join(" ");
          return <path key={s.seriesId} d={path} fill="none" stroke={COLORS[idx % COLORS.length]} strokeWidth="2.2" />;
        })}
        {xAxisDates.map((dateLabel, index) => {
          const x = scaleX(index, xAxisDates.length);
          return (
            <text key={dateLabel} x={x} y={viewHeight - 8} textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize="10">
              {shortYearMonth(dateLabel)}
            </text>
          );
        })}
      </svg>
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.65 }}>
        Use mouse wheel to zoom. Pan slider above shifts the visible window.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        {filteredSeries.map((s, idx) => (
          <div key={s.seriesId} style={{ fontSize: 12, opacity: 0.8, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: COLORS[idx % COLORS.length], display: "inline-block" }} />
            {friendlySeriesName(s.seriesId)}
          </div>
        ))}
      </div>
    </div>
  );
}

function YoYComparisonChart({
  series,
  compareYears,
}: {
  series: MacroSeries | null;
  compareYears: number;
}) {
  if (!series?.points?.length) {
    return null;
  }

  const latestYm = series.points[series.points.length - 1]?.date;
  if (!latestYm) return null;

  const layers = Array.from({ length: compareYears + 1 }).map((_, offset) => {
    const points = Array.from({ length: 12 }).map((__, idx) => {
      const ym = shiftYearMonth(latestYm, -(11 - idx) - offset * 12);
      const point = series.points.find((p) => p.date === ym);
      return {
        date: ym,
        value: point?.value ?? null,
      };
    });
    return {
      label: offset === 0 ? "Current 12M" : `${offset}Y ago`,
      points,
    };
  });

  const values = layers.flatMap((l) => l.points.map((p) => p.value).filter((v): v is number => v !== null));
  if (!values.length) return null;

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const viewWidth = 800;
  const viewHeight = 240;
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
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>
          Same-timeframe comparison: {friendlySeriesName(series.seriesId)}
        </div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          Base window: {formatYearMonth(shiftYearMonth(latestYm, -11))} to {formatYearMonth(latestYm)}
        </div>
      </div>

      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} width="100%" height="240">
        <rect x="0" y="0" width={viewWidth} height={viewHeight} fill="rgba(0,0,0,0.15)" rx="8" />
        <line x1={padding} y1={padding} x2={padding} y2={viewHeight - padding} stroke="rgba(255,255,255,0.15)" />
        <line x1={padding} y1={viewHeight - padding} x2={viewWidth - padding} y2={viewHeight - padding} stroke="rgba(255,255,255,0.15)" />

        {layers.map((layer, idx) => {
          const path = layer.points
            .map((p, i) => {
              if (p.value === null) return null;
              return `${i === 0 ? "M" : "L"}${scaleX(i, layer.points.length)} ${scaleY(p.value)}`;
            })
            .filter(Boolean)
            .join(" ");

          return (
            <path
              key={layer.label}
              d={path}
              fill="none"
              stroke={COMPARE_COLORS[idx % COMPARE_COLORS.length]}
              strokeWidth={idx === 0 ? "3" : "2"}
              strokeOpacity={idx === 0 ? "1" : "0.75"}
            />
          );
        })}

        {layers[0].points.map((p, idx) => {
          const x = scaleX(idx, layers[0].points.length);
          return (
            <text key={p.date} x={x} y={viewHeight - 8} textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize="10">
              {shortYearMonth(p.date)}
            </text>
          );
        })}
      </svg>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
        {layers.map((layer, idx) => (
          <div key={layer.label} style={{ fontSize: 12, opacity: 0.85, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: COMPARE_COLORS[idx % COMPARE_COLORS.length], display: "inline-block" }} />
            {layer.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function SeriesDetailPanel({
  series,
  latestPointDate,
}: {
  series: MacroSeries[];
  latestPointDate: string | null;
}) {
  if (!series.length) return null;

  const rows = series
    .map((s) => {
      const last = s.points[s.points.length - 1];
      const prev = s.points[s.points.length - 2];
      const oneYearAgo = s.points.find((p) => p.date === shiftYearMonth(last?.date ?? "", -12));
      if (!last) {
        return {
          seriesId: s.seriesId,
          name: friendlySeriesName(s.seriesId),
          lastValue: null,
          mom: null,
          yoy: null,
          latestDate: null,
        };
      }
      return {
        seriesId: s.seriesId,
        name: friendlySeriesName(s.seriesId),
        lastValue: last.value,
        mom: typeof prev?.value === "number" ? ((last.value - prev.value) / Math.abs(prev.value || 1)) * 100 : null,
        yoy:
          typeof oneYearAgo?.value === "number"
            ? ((last.value - oneYearAgo.value) / Math.abs(oneYearAgo.value || 1)) * 100
            : null,
        latestDate: last.date,
      };
    })
    .sort((a, b) => a.seriesId.localeCompare(b.seriesId));

  return (
    <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>Series details</div>
        <div style={{ fontSize: 11, opacity: 0.65 }}>
          Latest BLS observation: {latestPointDate ? formatYearMonth(latestPointDate) : "none"}
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={tableHeadCellStyle}>Series</th>
              <th style={tableHeadCellStyle}>Last value</th>
              <th style={tableHeadCellStyle}>MoM</th>
              <th style={tableHeadCellStyle}>YoY</th>
              <th style={tableHeadCellStyle}>As of</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.seriesId}>
                <td style={tableCellStyle}>{r.name}</td>
                <td style={tableCellStyle}>{r.lastValue === null ? "No live value" : formatCompactValue(r.lastValue)}</td>
                <td style={tableCellStyle}>{formatSignedPercent(r.mom)}</td>
                <td style={tableCellStyle}>{formatSignedPercent(r.yoy)}</td>
                <td style={tableCellStyle}>{r.latestDate ? formatYearMonth(r.latestDate) : "No live value"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function shiftYearMonth(ym: string, deltaMonths: number): string {
  const [yearRaw, monthRaw] = ym.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return ym;
  const index = year * 12 + (month - 1) + deltaMonths;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}`;
}

function monthDiffInclusive(startYm: string, endYm: string): number {
  const [startYear, startMonth] = startYm.split("-").map(Number);
  const [endYear, endMonth] = endYm.split("-").map(Number);
  return endYear * 12 + endMonth - (startYear * 12 + startMonth) + 1;
}

function buildXAxisDates(startYm: string, endYm: string): string[] {
  const total = monthDiffInclusive(startYm, endYm);
  const marks = Math.min(6, total);
  if (marks <= 1) return [startYm];
  return Array.from({ length: marks }).map((_, idx) => {
    const step = Math.round((idx * (total - 1)) / (marks - 1));
    return shiftYearMonth(startYm, step);
  });
}

function formatYearMonth(ym: string): string {
  const [yearRaw, monthRaw] = ym.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!year || !month) return ym;
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleString(undefined, { month: "short", year: "numeric" });
}

function shortYearMonth(ym: string): string {
  const [yearRaw, monthRaw] = ym.split("-");
  const month = Number(monthRaw);
  if (!month) return ym;
  const shortYear = yearRaw.slice(-2);
  const monthLabel = new Date(Date.UTC(2000, month - 1, 1)).toLocaleString(undefined, { month: "short" });
  return `${monthLabel} '${shortYear}`;
}

function formatCompactValue(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const miniButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid rgba(255,255,255,0.2)",
  background: "rgba(255,255,255,0.08)",
  color: "white",
  cursor: "pointer",
};

const tableHeadCellStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  opacity: 0.75,
  whiteSpace: "nowrap",
};

const tableCellStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  whiteSpace: "nowrap",
};

function friendlySeriesName(seriesId: string): string {
  if (seriesId.endsWith("JOL")) return "Job Openings";
  if (seriesId.endsWith("HIL")) return "Hires";
  if (seriesId.endsWith("QUL")) return "Quits";
  if (seriesId.endsWith("LDL")) return "Layoffs and Discharges";
  return seriesId;
}
