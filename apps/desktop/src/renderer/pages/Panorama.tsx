import React, { useState, useEffect, useMemo, useRef } from "react";
import { useStreamStore } from "../store/streamStore";
import { IndicesCarousel } from "../panorama/IndicesCarousel";
import { BreadthHeatmap } from "../panorama/BreadthHeatmap";
import { SectorMatrixComponent } from "../panorama/SectorMatrix";
import { CrossAssetMonitorComponent } from "../panorama/CrossAssetMonitor";
import { RegimeLabelComponent } from "../panorama/RegimeLabel";
import { EconomicCalendar } from "../panorama/EconomicCalendar";
import {
  generateDemoPanoramaSnapshot,
} from "../panorama/demoProvider";
import type { EconomicCalendarData, EconomicEvent, PanoramaSnapshot, RegimeLabel as UiRegimeLabel } from "../panorama/types";
import type { AlphaSignal, CapitalMomentumSignal, EconomicEvent as SharedEconomicEvent, RegimeUpdate } from "@tc/shared";
import { fetchEconomicEvents, initializeEconomicCalendar, queryEconomicEvents } from "@tc/shared";
import { useStrategyUpdates } from "../hooks/useStrategyUpdates";
import { useRiskEvents } from "../hooks/useRiskEvents";
import { useStrategyStore } from "../store/strategyStore";
import { useRiskStore, type RiskState } from "../store/riskStore";

export default function Panorama() {
  useStrategyUpdates();
  useRiskEvents();

  const [snapshot, setSnapshot] = useState<PanoramaSnapshot | null>(null);
  const [calendarData, setCalendarData] = useState<EconomicCalendarData | null>(null);
  const [calendarCollapsed, setCalendarCollapsed] = useState<boolean>(false);
  const [cotSummary, setCotSummary] = useState<any[]>([]);
  const source = useStreamStore((s) => s.source);
  const replay = useStreamStore((s) => s.replay);
  const hb = useStreamStore((s) => s.lastHeartbeat);
  const llamaCacheRef = useRef<{ ts: number; summaries: Record<string, string> } | null>(null);

  const computeRegime = useStrategyStore((s) => s.regime);
  const alphaSignals = useStrategyStore((s) => s.signals);
  const camSignals = useStrategyStore((s) => s.camSignals);
  const riskState = useRiskStore((s) => s);

  const calendarRefreshMs = useMemo(() => 5 * 60 * 1000, []);

  const regimeForDisplay: UiRegimeLabel | null = useMemo(() => {
    if (computeRegime) return mapRegimeUpdateToLabel(computeRegime);
    if (snapshot?.regime) return snapshot.regime;
    return null;
  }, [computeRegime, snapshot]);

  const primarySignal: AlphaSignal | null = useMemo(() => {
    if (!alphaSignals) return null;
    const preferred = alphaSignals["SPY"] ?? alphaSignals["AAPL"] ?? null;
    if (preferred) return preferred;
    const values = Object.values(alphaSignals);
    return values.length ? (values[0] ?? null) : null;
  }, [alphaSignals]);

  const primaryCamSignal: CapitalMomentumSignal | null = useMemo(() => {
    if (!camSignals) return null;
    const preferred = camSignals["SPY"] ?? camSignals["AAPL"] ?? null;
    if (preferred) return preferred;
    const values = Object.values(camSignals);
    return values.length ? (values[0] ?? null) : null;
  }, [camSignals]);

  const mapImpact = (importance: SharedEconomicEvent["importance"]): EconomicEvent["impact"] => {
    if (importance === 3) return "high";
    if (importance === 2) return "medium";
    return "low";
  };

  const mapSharedEvent = (event: SharedEconomicEvent): EconomicEvent => {
    const mapped: EconomicEvent = {
      id: event.id,
      time: event.releaseDateTime.getTime(),
      country: event.country,
      event: event.title,
      impact: mapImpact(event.importance),
      state: event.status === "released" ? "released" : "upcoming",
    };
    if (event.forecastValue !== null && event.forecastValue !== undefined) {
      mapped.forecast = event.forecastValue;
    }
    if (event.previousValue !== null && event.previousValue !== undefined) {
      mapped.prior = event.previousValue;
    }
    if (event.actualValue !== null && event.actualValue !== undefined) {
      mapped.actual = event.actualValue;
    }
    if (event.summary) {
      mapped.summary = event.summary;
    }
    return mapped;
  };

  const getLlamaSummaries = async (events: EconomicEvent[]): Promise<Record<string, string>> => {
    if (!window?.cockpit?.aiResearch?.checkRuntime || !window?.cockpit?.aiResearch?.getConfig) return {};

    const runtime = await window.cockpit.aiResearch.checkRuntime();
    if (!runtime?.available) return {};

    const config = await window.cockpit.aiResearch.getConfig();
    if (!config?.enabled) return {};

    const cache = llamaCacheRef.current;
    const now = Date.now();
    if (cache && now - cache.ts < 10 * 60 * 1000) {
      return cache.summaries;
    }

    const model = config?.model || "deepseek-r1:14b";
    const prompt = `Summarize each economic event in one short sentence. Return ONLY JSON array with {"id":"...","summary":"..."} items.\nEvents:\n${events
      .slice(0, 5)
      .map((e) => {
        const parts = [
          `id=${e.id}`,
          `event=${e.event}`,
          `country=${e.country}`,
          `impact=${e.impact}`,
          e.forecast !== undefined ? `forecast=${e.forecast}` : "",
          e.prior !== undefined ? `prior=${e.prior}` : "",
          e.actual !== undefined ? `actual=${e.actual}` : "",
        ].filter(Boolean);
        return `- ${parts.join(", ")}`;
      })
      .join("\n")}`;

    try {
      const sliced = events.slice(0, 5);
      if (sliced.length === 0) return {};
      const mappedEvents = sliced.map((e) => ({
        id: e.id,
        title: e.event,
        releaseDateTime: new Date(e.time).toISOString(),
        status: e.state as 'upcoming' | 'released',
        importance: (e.impact === 'high' ? 3 : e.impact === 'medium' ? 2 : 1) as 1 | 2 | 3,
        eventCategory: 'other' as const,
        country: e.country,
        summary: e.summary,
      }));
      const result = await window.cockpit.economicCalendar.generateInsights({
        focus: 'upcoming' as const,
        windowHours: 24,
        events: mappedEvents,
        model: config?.model,
      }).catch(() => null);
      const summaries: Record<string, string> = {};
      if (result?.summary) {
        // Map summary text back to event IDs
        events.forEach((e, i) => {
          if (i === 0 && typeof result.summary === 'string') summaries[e.id] = result.summary;
        });
      }
      llamaCacheRef.current = { ts: now, summaries };
      return summaries;
    } catch {
      return {};
    }
  };

  // Generate demo snapshots at regular intervals
  useEffect(() => {
    // Initial snapshot
    setSnapshot(generateDemoPanoramaSnapshot());

    // Update every 2 seconds
    const interval = setInterval(() => {
      setSnapshot(generateDemoPanoramaSnapshot());
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshCalendar = async () => {
      try {
        console.log("🔄 Refreshing economic calendar...");
        await initializeEconomicCalendar();
        await fetchEconomicEvents();

        const now = Date.now();
        const events = queryEconomicEvents({}) as SharedEconomicEvent[];
        console.log(`📊 Fetched ${events.length} economic events`);
        
        const upcoming = events.filter((e) => {
          const ts = e.releaseDateTime.getTime();
          return ts >= now && ts < now + 24 * 60 * 60 * 1000;
        });

        const recent = events.filter((e) => {
          const ts = e.releaseDateTime.getTime();
          return ts < now && ts > now - 24 * 60 * 60 * 1000;
        });

        const selected = upcoming.length > 0 ? upcoming : recent;
        console.log(`📋 Selected ${selected.length} events for display (${upcoming.length} upcoming, ${recent.length} recent)`);
        
        const mapped = selected.map(mapSharedEvent);
        const summaries = await getLlamaSummaries(mapped);
        const enriched = mapped.map((e) => {
          const summary = summaries[e.id] ?? e.summary;
          return summary ? { ...e, summary } : e;
        });

        const calendar: EconomicCalendarData = {
          timestamp: Date.now(),
          events: enriched,
          source: events.length > 0 ? "configured" : "stub",
          hasApiKey: events.length > 0,
        };

        if (!cancelled) {
          setCalendarData(calendar);
          console.log(`✅ Calendar updated with ${enriched.length} events`);
        }
      } catch (err) {
        console.error("❌ Failed to refresh economic calendar:", err);
        if (!cancelled) setCalendarData(null);
      }
    };

    refreshCalendar();
    const interval = setInterval(refreshCalendar, calendarRefreshMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [calendarRefreshMs]);

  useEffect(() => {
    let cancelled = false;
    const fetchCot = async () => {
      if (!window.cockpit?.externalFeeds?.getCotSummary) return;
      const symbols = ["ES", "NQ", "CL", "NG", "GC", "SI", "ZN", "6E"];
      const data = await window.cockpit.externalFeeds.getCotSummary(symbols);
      if (!cancelled) setCotSummary(data as any[]);
    };
    fetchCot();
    const timer = setInterval(fetchCot, 24 * 60 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!snapshot) {
    return (
      <div style={{ opacity: 0.75 }}>
        <h2 style={{ marginTop: 0 }}>PANORAMA</h2>
        <div>Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div style={{ opacity: 0.95, display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 14px",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          background: "rgba(0,0,0,0.2)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>📊 PANORAMA MVP Dashboard</h2>
        <div
          style={{
            display: "flex",
            gap: 8,
            fontSize: 11,
            opacity: 0.7,
            alignItems: "center",
          }}
        >
          <span>
            Source:{" "}
            <b style={{ textTransform: "uppercase" }}>
              {source === "demo" ? "🟢 DEMO" : source === "replay" ? "🔄 REPLAY" : "❓ Unknown"}
            </b>
          </span>
          {hb && <span>• Seq: {hb.seq}</span>}
        </div>
      </div>

      {/* Decision Support Info */}
      <div
        style={{
          padding: 12,
          background: "rgba(100,150,200,0.1)",
          border: "1px solid rgba(100,150,200,0.2)",
          borderRadius: 8,
          fontSize: 12,
          lineHeight: 1.5,
        }}
      >
        <b>📌 Decision Support Dashboard</b> — Real-time market overview with graceful
        degradation. All data in Demo mode uses synthetic stubs and ETF proxies. Works in Replay mode.
      </div>

      {/* Overview Row */}
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.6 }}>MARKET OVERVIEW</div>
        <RegimeLabelComponent regime={regimeForDisplay ?? snapshot.regime} />
        <StrategyPulseCard regime={computeRegime} signal={primarySignal} risk={riskState} />
        <CamPulseCard signal={primaryCamSignal} />
        <IndicesCarousel indices={snapshot.indices} />
      </div>

      {/* Main Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(420px, 2fr) minmax(320px, 1fr)",
          gap: 16,
          alignItems: "start",
        }}
      >
        {/* Left Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.6 }}>MARKET STRUCTURE</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: 16,
            }}
          >
            <BreadthHeatmap data={snapshot.breadth} />
            <SectorMatrixComponent data={snapshot.sectors} />
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.6 }}>CROSS-ASSET</div>
          <CrossAssetMonitorComponent data={snapshot.crossAsset} />
        </div>

        {/* Right Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.6 }}>CFTC POSITIONING</div>
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.02)" }}>
            {cotSummary.length === 0 ? (
              <div style={{ fontSize: 12, opacity: 0.6 }}>No CoT data yet. Enable CFTC in Settings.</div>
            ) : (
              <div style={{ display: "grid", gap: 8 }}>
                {cotSummary.map((row: any) => (
                  <div key={row.symbol} style={{ display: "grid", gridTemplateColumns: "60px 1fr 1fr 1fr", gap: 8, fontSize: 12, alignItems: "center" }}>
                    <div style={{ fontWeight: 700 }}>{row.symbol}</div>
                    <div style={{ opacity: 0.8 }}>Net: {row.net}</div>
                    <div style={{ opacity: 0.8 }}>Δ4w: {row.delta4w}</div>
                    <div style={{ opacity: 0.8 }}>Pct: {row.percentile ?? "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 12, opacity: 0.7, letterSpacing: 0.6 }}>CALENDAR</div>
            <button
              onClick={() => setCalendarCollapsed((prev) => !prev)}
              style={{
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 999,
                padding: "4px 10px",
                fontSize: 11,
                color: "rgba(255,255,255,0.7)",
                cursor: "pointer",
              }}
            >
              {calendarCollapsed ? "Expand" : "Collapse"}
            </button>
          </div>
          {!calendarCollapsed && <EconomicCalendar data={calendarData ?? snapshot.calendar} />}
        </div>
      </div>

      {/* Replay Info */}
      {replay && (
        <div
          style={{
            marginTop: 16,
            padding: 10,
            background: "rgba(59,130,246,0.1)",
            border: "1px solid rgba(59,130,246,0.2)",
            borderRadius: 6,
            fontSize: 12,
            opacity: 0.85,
          }}
        >
          🔄 Replay Mode: <b>{replay.playing ? "Playing" : "Paused"}</b> @ <b>{replay.speed}x</b> —
          Adjust in Settings & Logs
        </div>
      )}

    </div>
  );
}

function CamPulseCard({ signal }: { signal: CapitalMomentumSignal | null }) {
  const score = signal?.compositeScore ?? 0;
  const pct = `${Math.round(score)}%`;
  const confidence = signal ? `${Math.round(signal.confidence * 100)}%` : "—";
  const status = signal ? (signal.passes ? "Aligned" : "Filtered") : "Waiting";
  const statusColor = signal ? (signal.passes ? "#22c55e" : "#f59e0b") : "#94a3b8";

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 12,
        padding: 14,
        background: "linear-gradient(120deg, rgba(16,185,129,0.12), rgba(20,184,166,0.08))",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, letterSpacing: 0.5 }}>CAM Pulse</div>
        <div style={{ fontSize: 12, color: statusColor, fontWeight: 700 }}>{status}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        <Metric label="Composite" value={pct} />
        <Metric label="Confidence" value={confidence} />
        <Metric label="Vol State" value={signal?.volatilityState ?? "—"} />
        <Metric label="Ticker" value={signal?.symbol ?? "—"} />
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Gates</div>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {signal?.gatesFailed.length ? signal.gatesFailed.join(" · ") : "All gates passed"}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, padding: 10, background: "rgba(0,0,0,0.15)" }}>
      <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function mapRegimeUpdateToLabel(regime: RegimeUpdate): UiRegimeLabel {
  const trend: UiRegimeLabel["trend"] =
    regime.mode === "trend-day"
      ? regime.trendDirection === "down"
        ? "trending-down"
        : "trending-up"
      : "choppy";

  const vol: UiRegimeLabel["vol"] = regime.volState === "high" ? "high-vol" : "low-vol";

  return {
    trend,
    vol,
    confidence: regime.confidence,
    description: regime.notes?.join(" · ") || regime.mode,
    timestamp: regime.ts,
    source: "compute",
  };
}

function StrategyPulseCard({
  regime,
  signal,
  risk,
}: {
  regime: RegimeUpdate | null;
  signal: AlphaSignal | null;
  risk: RiskState;
}) {
  const composite = signal?.compositeScore ?? 0;
  const compositePct = Math.round((composite + 1) * 50);
  const compositeColor = composite >= 0 ? "#22c55e" : "#ef4444";

  const components = signal?.signals ?? [];
  const execution = signal?.execution;
  const riskActive = risk.tripped;
  const riskReason = risk.reason;

  return (
    <div
      style={{
        border: "1px solid rgba(255,255,255,0.12)",
        background: "linear-gradient(120deg, rgba(34,197,94,0.12), rgba(59,130,246,0.08))",
        borderRadius: 12,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, letterSpacing: 0.5 }}>Strategy Pulse</div>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          {regime ? `${regime.mode} · ${(regime.confidence * 100).toFixed(0)}%` : "demo data"}
        </div>
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Composite ({signal?.symbol ?? "waiting"})</div>
        <div
          style={{
            height: 10,
            borderRadius: 6,
            background: "rgba(255,255,255,0.1)",
            overflow: "hidden",
            position: "relative",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${compositePct}%`,
              background: compositeColor,
              transition: "width 0.3s ease",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              color: "#0b1020",
            }}
          >
            {(composite * 100).toFixed(0)} bps bias
          </div>
        </div>
      </div>

      {riskActive && (
        <div style={{
          padding: 10,
          borderRadius: 10,
          background: "rgba(239,68,68,0.12)",
          border: "1px solid rgba(239,68,68,0.35)",
          color: "#fecdd3",
        }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Risk Kill Switch Engaged</div>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            {riskReason
              ? riskReason.kind === "daily-loss"
                ? `Daily loss ${riskReason.value.toFixed(2)} vs limit ${riskReason.threshold.toFixed(2)}`
                : `Drawdown ${riskReason.value.toFixed(2)} vs limit ${riskReason.threshold.toFixed(2)}`
              : "Risk limits exceeded"}
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ fontSize: 12, opacity: 0.7 }}>Signals</div>
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          {components.length === 0 && (
            <div style={{ fontSize: 12, opacity: 0.7 }}>Waiting for live bars...</div>
          )}
          {components.map((s) => {
            const pct = Math.round((s.score + 1) * 50);
            const color = s.score >= 0 ? "#4ade80" : "#f97316";
            const label =
              s.id === "vwap-mean-revert"
                ? "VWAP MR"
                : s.id === "trend-pullback"
                ? "Trend Pullback"
                : "Vol Filter";
            return (
              <div
                key={s.id}
                style={{
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 10,
                  padding: 10,
                  background: "rgba(0,0,0,0.15)",
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.75 }}>{label}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <div style={{ flex: 1, height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999 }}>
                    <div
                      style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 999 }}
                    />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{s.score.toFixed(2)}</div>
                </div>
                {s.detail && <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>{s.detail}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {execution && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Execution</div>
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 10,
          }}>
            <div>
              <div style={{ fontSize: 12, opacity: 0.65 }}>Order</div>
              <div style={{ fontWeight: 700 }}>
                {execution.allowed ? "Go" : "Hold"} · {execution.orderType}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.65 }}>Edge vs Cost</div>
              <div style={{ fontWeight: 700 }}>
                ${execution.expectedEdgeDollars.toFixed(2)} / ${execution.expectedCostDollars.toFixed(2)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, opacity: 0.65 }}>Max Slip</div>
              <div style={{ fontWeight: 700 }}>{execution.maxSlippageBps.toFixed(1)} bps</div>
            </div>
          </div>
          <div style={{ fontSize: 11, opacity: 0.7 }}>
            {execution.reasons.slice(0, 3).join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}
