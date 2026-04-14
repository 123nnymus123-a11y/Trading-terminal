import React, { useEffect, useMemo, useState } from "react";
import type {
  TedIntelAIInsight,
  TedIntelConcentrationRisk,
  TedIntelLifecycleStage,
  TedIntelMapFlow,
  TedIntelMomentumTimeline,
  TedIntelSecondOrder,
  TedIntelSignal,
  TedIntelSnapshot,
  TedIntelSupplyChainOverlay,
  TedIntelTimeWindow,
  TedIntelVaultRecord,
} from "@tc/shared";
import { useTedIntelStore } from "../../store/tedIntelStore";

// ─── Shared Styles ────────────────────────────────────────────────────────────

const shellStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: 14,
  background: "linear-gradient(180deg, rgba(17,24,39,0.92), rgba(15,23,42,0.88))",
};

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 10,
  padding: 12,
  background: "rgba(255,255,255,0.03)",
  minWidth: 0,
};

// ─── Colors ───────────────────────────────────────────────────────────────────

function toneColor(tone: "positive" | "neutral" | "elevated"): string {
  if (tone === "positive") return "#4ade80";
  if (tone === "elevated") return "#f59e0b";
  return "#93c5fd";
}

function riskColor(level: "low" | "medium" | "high"): string {
  if (level === "high") return "#f87171";
  if (level === "medium") return "#fbbf24";
  return "#4ade80";
}

function trendColor(trend: "accelerating" | "stable" | "decelerating"): string {
  if (trend === "accelerating") return "#4ade80";
  if (trend === "decelerating") return "#f87171";
  return "#93c5fd";
}

function priorityColor(priority: number): string {
  if (priority >= 75) return "#f87171";
  if (priority >= 55) return "#fbbf24";
  return "#93c5fd";
}

function zoneColor(zone: "raw" | "candidate" | "validated" | "production"): string {
  if (zone === "production") return "#4ade80";
  if (zone === "validated") return "#93c5fd";
  if (zone === "candidate") return "#fbbf24";
  return "#6b7280";
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatMoney(value: number): string {
  if (value >= 1_000_000_000) return `EUR ${(value / 1_000_000_000).toFixed(2)}bn`;
  return `EUR ${(value / 1_000_000).toFixed(0)}m`;
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

// ─── Shared Hook ─────────────────────────────────────────────────────────────

function useTedIntel(windowDays: TedIntelTimeWindow) {
  const snapshot = useTedIntelStore((state) => state.snapshots[windowDays]);
  const loading = useTedIntelStore((state) => state.loading[windowDays]);
  const error = useTedIntelStore((state) => state.errors[windowDays]);
  const loadSnapshot = useTedIntelStore((state) => state.loadSnapshot);

  useEffect(() => {
    void loadSnapshot(windowDays);
  }, [loadSnapshot, windowDays]);

  return { snapshot, loading: Boolean(loading), error };
}

// ─── Shared Sub-Components ────────────────────────────────────────────────────

function LoadingState({ label }: { label: string }) {
  return <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>;
}

function ErrorState({ error }: { error: string }) {
  return (
    <div style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(248,113,113,0.35)", background: "rgba(127,29,29,0.22)", color: "#fecaca", fontSize: 12 }}>
      {error}
    </div>
  );
}

function LiveDataBanner() {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(74,222,128,0.35)",
        background: "rgba(20,83,45,0.22)",
        color: "#bbf7d0",
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase" }}>
        Live TED Data
      </div>
      <div style={{ marginTop: 4 }}>
        TED intelligence requires a working live API configuration. No fallback mock data is used.
      </div>
    </div>
  );
}

function SummaryCard({ label, value, delta, tone, detail }: TedIntelSnapshot["summaryCards"][number]) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 10, opacity: 0.62, textTransform: "uppercase", letterSpacing: 0.7 }}>{label}</div>
      <div style={{ marginTop: 6, display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{value}</div>
        <div style={{ fontSize: 11, color: toneColor(tone), whiteSpace: "nowrap" }}>{delta}</div>
      </div>
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.72, lineHeight: 1.45 }}>{detail}</div>
    </div>
  );
}

function PanelHeader({ title, subtitle, badge, snapshot }: { title: string; subtitle: string; badge?: string; snapshot?: TedIntelSnapshot }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
      <div>
        <div style={{ fontSize: 16, fontWeight: 800 }}>{title}</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{subtitle}</div>
        {snapshot && (
          <div style={{ fontSize: 11, opacity: 0.58, marginTop: 4 }}>
            Source: Live feed • {snapshot.sourceLabel} • Data as of {formatTimestamp(snapshot.sourceUpdatedAt)} • Snapshot built {formatTimestamp(snapshot.generatedAt)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {badge && <div style={{ fontSize: 11, opacity: 0.6, whiteSpace: "nowrap" }}>{badge}</div>}
      </div>
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={{ fontSize: 10, opacity: 0.55, textTransform: "uppercase", letterSpacing: 0.9, marginBottom: 8 }}>{text}</div>
  );
}

function FlowRow({ flow }: { flow: TedIntelMapFlow }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr) auto", gap: 10, alignItems: "center", padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 12 }}>{flow.buyerName}</div>
        <div style={{ fontSize: 11, opacity: 0.68 }}>{flow.buyerCountry} → {flow.winnerCountry}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12 }}>{flow.winnerName}</div>
        <div style={{ fontSize: 11, opacity: 0.68 }}>{flow.theme}</div>
      </div>
      <div style={{ fontSize: 11, color: "#93c5fd", whiteSpace: "nowrap" }}>{formatMoney(flow.valueEur)}</div>
    </div>
  );
}

function matchOverlay(snapshot: TedIntelSnapshot | undefined, tickerOrName?: string | null): TedIntelSupplyChainOverlay[] {
  if (!snapshot) return [];
  if (!tickerOrName) return snapshot.supplyChainOverlay.slice(0, 3);
  const needle = tickerOrName.trim().toUpperCase();
  const matched = snapshot.supplyChainOverlay.filter(
    (overlay) => overlay.ticker.toUpperCase() === needle || overlay.company.toUpperCase().includes(needle),
  );
  return matched.length > 0 ? matched : snapshot.supplyChainOverlay.slice(0, 3);
}

// ─── Lifecycle Filter Pills ────────────────────────────────────────────────────

function LifecyclePills({ stages, active, onChange }: { stages: TedIntelLifecycleStage[]; active: TedIntelLifecycleStage | "all"; onChange: (s: TedIntelLifecycleStage | "all") => void }) {
  const allStages: (TedIntelLifecycleStage | "all")[] = ["all", ...stages];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {allStages.map((s) => (
        <button key={s} onClick={() => onChange(s)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: active === s ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.04)", color: active === s ? "#93c5fd" : "#9ca3af", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.6 }}>
          {s}
        </button>
      ))}
    </div>
  );
}

// ─── Signal Card ──────────────────────────────────────────────────────────────

function SignalCard({ signal }: { signal: TedIntelSignal }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ ...cardStyle, borderLeft: `3px solid ${priorityColor(signal.priority)}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: priorityColor(signal.priority), fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7 }}>P{signal.priority.toFixed(0)}</span>
            <span style={{ fontSize: 10, opacity: 0.55, textTransform: "uppercase" }}>{signal.type.replace(/_/g, " ")}</span>
          </div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>{signal.title}</div>
          <div style={{ marginTop: 5, fontSize: 12, opacity: 0.82, lineHeight: 1.45 }}>{signal.summary}</div>
        </div>
      </div>
      <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px" }}>
        {([["Market", signal.dimensions.marketRelevance], ["Supply Chain", signal.dimensions.supplyChainImpact], ["Geo", signal.dimensions.geoStrategic], ["Confidence", signal.dimensions.confidence]] as [string, number][]).map(([label, val]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ fontSize: 10, opacity: 0.55, width: 60, flexShrink: 0 }}>{label}</div>
            <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.08)" }}>
              <div style={{ width: `${val * 100}%`, height: "100%", borderRadius: 2, background: "#3b82f6" }} />
            </div>
          </div>
        ))}
      </div>
      <button onClick={() => setExpanded((v) => !v)} style={{ marginTop: 8, fontSize: 11, color: "#93c5fd", background: "none", border: "none", cursor: "pointer", padding: 0, opacity: 0.75 }}>
        {expanded ? "▲ Hide evidence" : "▼ Evidence + AI"}
      </button>
      {expanded && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <div>
            <span style={{ fontSize: 10, color: "#93c5fd" }}>FACTS: </span>
            {signal.evidence.map((e, i) => <div key={i} style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.4 }}>{e}</div>)}
          </div>
          <div>
            <span style={{ fontSize: 10, color: "#fbbf24" }}>AI INFERENCE: </span>
            <div style={{ fontSize: 11, opacity: 0.78, lineHeight: 1.4 }}>{signal.aiExplanation}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Momentum Bar ─────────────────────────────────────────────────────────────

function MomentumTimelineCard({ timeline }: { timeline: TedIntelMomentumTimeline }) {
  const maxIdx = Math.max(...timeline.points.map((p) => p.momentumIndex), 1);
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 12 }}>{timeline.theme}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, color: trendColor(timeline.trend) }}>{timeline.trend.toUpperCase()}</span>
          <span style={{ fontSize: 11, color: trendColor(timeline.trend), opacity: 0.8 }}>{formatPct(timeline.changePercent)}</span>
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 48 }}>
        {timeline.points.map((p) => (
          <div key={p.label} style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", height: 40 }}>
              <div style={{ width: "100%", height: `${Math.max(4, (p.momentumIndex / maxIdx) * 100)}%`, borderRadius: "2px 2px 0 0", background: trendColor(timeline.trend) === "#4ade80" ? "rgba(74,222,128,0.45)" : trendColor(timeline.trend) === "#f87171" ? "rgba(248,113,113,0.45)" : "rgba(147,197,253,0.35)", border: `1px solid ${trendColor(timeline.trend)}40` }} />
            </div>
            <div style={{ fontSize: 9, opacity: 0.5, textAlign: "center" }}>{p.label}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, opacity: 0.6 }}>
        {timeline.points.map((p) => p.noticeCount).join(" / ")} notices • {timeline.points.map((p) => p.awardCount).join(" / ")} awards
      </div>
    </div>
  );
}

// ─── Concentration Bar ────────────────────────────────────────────────────────

function ConcentrationRiskCard({ risk }: { risk: TedIntelConcentrationRisk }) {
  return (
    <div style={{ ...cardStyle, borderLeft: `3px solid ${riskColor(risk.riskLevel)}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 10, color: riskColor(risk.riskLevel), fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7 }}>{risk.riskLevel} risk</span>
          <span style={{ fontSize: 10, opacity: 0.55, marginLeft: 8, textTransform: "uppercase" }}>{risk.type} concentration</span>
        </div>
        <div style={{ fontSize: 11, color: "#93c5fd" }}>HHI {risk.herfindahlIndex.toFixed(3)}</div>
      </div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.85, lineHeight: 1.4 }}>{risk.description}</div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 3 }}>Top share: {(risk.topShare * 100).toFixed(1)}%</div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
          <div style={{ width: `${risk.topShare * 100}%`, height: "100%", borderRadius: 3, background: riskColor(risk.riskLevel) }} />
        </div>
      </div>
    </div>
  );
}

// ─── AI Insight Card ──────────────────────────────────────────────────────────

function AIInsightCard({ insight }: { insight: TedIntelAIInsight }) {
  return (
    <div style={{ ...cardStyle, borderLeft: insight.anomalyFlag ? "3px solid #f87171" : "3px solid #3b82f6" }}>
      <div style={{ fontSize: 10, opacity: 0.6, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>
        {insight.anomalyFlag ? "⚠ ANOMALY INSIGHT" : "AI INSIGHT"} • {(insight.confidence * 100).toFixed(0)}% confidence
      </div>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{insight.topic}</div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, color: "#93c5fd", marginBottom: 3 }}>FACTS:</div>
        {insight.factBasis.map((f, i) => <div key={i} style={{ fontSize: 11, opacity: 0.82, lineHeight: 1.4, marginBottom: 2 }}>{f}</div>)}
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, color: "#fbbf24", marginBottom: 3 }}>AI INFERENCE:</div>
        <div style={{ fontSize: 12, opacity: 0.82, lineHeight: 1.5 }}>{insight.inference}</div>
      </div>
      {insight.linkedSystems.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 10, opacity: 0.55 }}>Links: {insight.linkedSystems.join(" • ")}</div>
      )}
    </div>
  );
}

// ─── Second-Order Card ────────────────────────────────────────────────────────

function SecondOrderCard({ item }: { item: TedIntelSecondOrder }) {
  const thesisColors: Record<string, string> = { supply_chain_beneficiary: "#4ade80", sector_demand_support: "#93c5fd", macro_confirmation: "#fbbf24", competitive_displacement: "#f87171", geopolitical_realignment: "#c084fc" };
  const color = thesisColors[item.thesisType] ?? "#9ca3af";
  return (
    <div style={{ ...cardStyle, borderLeft: `3px solid ${color}` }}>
      <div style={{ fontSize: 10, color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 4 }}>{item.thesisType.replace(/_/g, " ")}</div>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{item.headline}</div>
      <div style={{ marginTop: 6, fontSize: 12, opacity: 0.82, lineHeight: 1.5 }}>{item.explanation}</div>
      {item.affectedTickers.length > 0 && (
        <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
          {item.affectedTickers.map((t) => <span key={t} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 5, background: "rgba(59,130,246,0.18)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.25)" }}>{t}</span>)}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 10, opacity: 0.55, display: "flex", gap: 10 }}>
        <span>Confidence: {(item.confidence * 100).toFixed(0)}%</span>
        <span>{item.supportingNoticeIds.length} supporting notices</span>
      </div>
    </div>
  );
}

// ─── Vault Zone Badge ─────────────────────────────────────────────────────────

function VaultZoneBadge({ zone }: { zone: TedIntelVaultRecord["zone"] }) {
  return (
    <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, color: zoneColor(zone), border: `1px solid ${zoneColor(zone)}40`, background: `${zoneColor(zone)}14`, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 700 }}>
      {zone}
    </span>
  );
}

// ─── Panel: TED Radar ─────────────────────────────────────────────────────────

export function TedRadarPanel({ windowDays = "90d" }: { windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);
  const [stageFilter, setStageFilter] = useState<TedIntelLifecycleStage | "all">("all");

  const filteredRadar = useMemo(() => {
    if (!snapshot) return [];
    const base = stageFilter === "all" ? snapshot.radar : snapshot.radar.filter((n) => n.stage === stageFilter);
    return base.slice(0, 6);
  }, [snapshot, stageFilter]);

  return (
    <div style={shellStyle}>
      <PanelHeader title="TED Intel Radar" subtitle="Evidence-first procurement intelligence with explainable relevance and cross-system links" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Loading TED procurement intelligence..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 16 }}>
          <LiveDataBanner />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 10 }}>
            {snapshot.summaryCards.map((card) => <SummaryCard key={card.label} {...card} />)}
          </div>

          <div>
            <SectionLabel text="Filter by stage" />
            <LifecyclePills stages={snapshot.availableLifecycleStages} active={stageFilter} onChange={setStageFilter} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(270px,0.85fr) minmax(330px,1.15fr)", gap: 14 }}>
            <div style={{ display: "grid", gap: 10 }}>
              <SectionLabel text="Key Signals" />
              {snapshot.anomalies.slice(0, 2).map((anomaly) => (
                <div key={anomaly.id} style={{ ...cardStyle, borderLeft: `3px solid ${anomaly.severity === "high" ? "#93c5fd" : "#fbbf24"}` }}>
                  <div style={{ fontSize: 10, color: anomaly.severity === "high" ? "#93c5fd" : "#fbbf24", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.7 }}>{anomaly.severity} ANOMALY</div>
                  <div style={{ marginTop: 4, fontWeight: 700 }}>{anomaly.title}</div>
                  <div style={{ marginTop: 5, fontSize: 12, opacity: 0.82, lineHeight: 1.45 }}>{anomaly.detail}</div>
                  <div style={{ marginTop: 5, fontSize: 11, opacity: 0.66 }}>{anomaly.whyItMatters}</div>
                </div>
              ))}
              <SectionLabel text="Top Sectors" />
              {snapshot.sectors.slice(0, 4).map((sector) => (
                <div key={sector.theme} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{sector.theme}</div>
                    <div style={{ opacity: 0.68 }}>{sector.noticeCount} notices • {sector.awardedCount} awards/execution</div>
                  </div>
                  <div style={{ color: "#4ade80", whiteSpace: "nowrap" }}>{formatMoney(sector.totalValueEur)}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <SectionLabel text={`Radar items (${filteredRadar.length})`} />
              {filteredRadar.map((notice) => (
                <div key={notice.id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontSize: 10, opacity: 0.55, textTransform: "uppercase", letterSpacing: 0.7 }}>{notice.stage} • {notice.noticeType.replace(/_/g, " ")}</div>
                      <div style={{ fontWeight: 800, marginTop: 4 }}>{notice.title}</div>
                    </div>
                    <div style={{ fontSize: 11, color: "#93c5fd", whiteSpace: "nowrap" }}>{formatMoney(notice.valueEur)}</div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{notice.buyerName}{notice.winner ? ` → ${notice.winner.name}` : ""}</div>
                  <div style={{ marginTop: 8, display: "grid", gap: 4, fontSize: 11, lineHeight: 1.45 }}>
                    <div><span style={{ color: "#93c5fd" }}>Facts: </span>{notice.evidence.directlyStatedFacts[0]}</div>
                    <div><span style={{ color: "#fbbf24" }}>AI: </span>{notice.evidence.aiInference[0]}</div>
                    <div style={{ opacity: 0.55 }}>{notice.evidence.linkedSystems.join(" • ")}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel: Government Demand Pulse ──────────────────────────────────────────

export function TedDemandPulsePanel({ windowDays = "30d" }: { windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);

  return (
    <div style={shellStyle}>
      <PanelHeader title="Government Demand Pulse" subtitle="TED-driven structural demand context and sector momentum" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Loading government demand pulse..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 14 }}>
          <LiveDataBanner />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 10 }}>
            {snapshot.summaryCards.slice(0, 3).map((card) => <SummaryCard key={card.label} {...card} />)}
          </div>

          <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.4, color: "#e5e7eb" }}>{snapshot.panorama.headline}</div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(220px,1fr) minmax(220px,1fr)", gap: 12 }}>
            <div>
              {snapshot.panorama.bullets.map((bullet) => (
                <div key={bullet} style={{ fontSize: 12, opacity: 0.82, lineHeight: 1.5, marginBottom: 7, paddingLeft: 10, borderLeft: "2px solid rgba(59,130,246,0.4)" }}>{bullet}</div>
              ))}
            </div>
            <div>
              <SectionLabel text="Top Buyers" />
              {snapshot.buyers.slice(0, 4).map((buyer) => (
                <div key={buyer.buyerName} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{buyer.buyerName}</div>
                    <div style={{ opacity: 0.65 }}>{buyer.country} • {buyer.topThemes.join(", ")}</div>
                  </div>
                  <div style={{ color: "#93c5fd", whiteSpace: "nowrap" }}>{buyer.activityScore.toFixed(1)}</div>
                </div>
              ))}
            </div>
          </div>

          {snapshot.momentumTimelines.length > 0 && (
            <div>
              <SectionLabel text="Sector Momentum Timeline" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: 10 }}>
                {snapshot.momentumTimelines.slice(0, 4).map((tl) => <MomentumTimelineCard key={tl.theme} timeline={tl} />)}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel: TED Signal Ranker ─────────────────────────────────────────────────

export function TedSignalRankerPanel({ windowDays = "90d" }: { windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);
  const [filterType, setFilterType] = useState<string>("all");

  const signalTypes = useMemo(() => {
    if (!snapshot) return [];
    return ["all", ...Array.from(new Set(snapshot.signals.map((s) => s.type)))];
  }, [snapshot]);

  const displayedSignals = useMemo(() => {
    if (!snapshot) return [];
    return filterType === "all" ? snapshot.signals : snapshot.signals.filter((s) => s.type === filterType);
  }, [snapshot, filterType]);

  return (
    <div style={shellStyle}>
      <PanelHeader title="Procurement Signal Ranker" subtitle="All signals ranked by strategic priority — market relevance, supply chain impact, geo-strategic weight" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Generating procurement signals..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 12 }}>
          <LiveDataBanner />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {signalTypes.map((t) => (
              <button key={t} onClick={() => setFilterType(t)} style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: filterType === t ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.04)", color: filterType === t ? "#93c5fd" : "#9ca3af", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.6 }}>
                {t.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {displayedSignals.map((signal) => <SignalCard key={signal.id} signal={signal} />)}
            {displayedSignals.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>No signals for this filter in the current window.</div>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel: AI Evidence Intelligence ─────────────────────────────────────────

export function TedAIInsightPanel({ windowDays = "90d" }: { windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);

  return (
    <div style={shellStyle}>
      <PanelHeader title="AI Intelligence Layer" subtitle="Evidence-first AI insights — facts separated from inference, confidence scored" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Building AI insights..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 10 }}>
          <LiveDataBanner />
          {snapshot.aiInsights.map((insight) => <AIInsightCard key={insight.id} insight={insight} />)}
          {snapshot.aiInsights.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>No AI insights generated for this window.</div>}
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel: Second-Order Intelligence ────────────────────────────────────────

export function TedSecondOrderPanel({ windowDays = "90d" }: { windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);

  return (
    <div style={shellStyle}>
      <PanelHeader title="Second-Order Intelligence" subtitle="Indirect implications — sector demand support, supply-chain beneficiaries, geopolitical realignment" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Deriving second-order implications..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 14 }}>
          <LiveDataBanner />
          <div style={{ display: "grid", gap: 10 }}>
            {snapshot.secondOrder.map((item) => <SecondOrderCard key={item.id} item={item} />)}
            {snapshot.secondOrder.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Insufficient data for second-order inference in this window.</div>}
          </div>
          {snapshot.concentrationRisks.length > 0 && (
            <div>
              <SectionLabel text="Concentration Risk" />
              <div style={{ display: "grid", gap: 10 }}>
                {snapshot.concentrationRisks.map((risk) => <ConcentrationRiskCard key={risk.id} risk={risk} />)}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel: Entity Resolution ─────────────────────────────────────────────────

export function TedEntityResolutionPanel({ windowDays = "90d" }: { windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);
  const [view, setView] = useState<"buyers" | "suppliers">("suppliers");

  return (
    <div style={shellStyle}>
      <PanelHeader title="Entity Resolution Layer" subtitle="Normalized buyers and suppliers with classification, ticker mappings, and confidence scores" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Resolving entities..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 12 }}>
          <LiveDataBanner />
          <div style={{ display: "flex", gap: 8 }}>
            {(["suppliers", "buyers"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{ fontSize: 11, padding: "4px 12px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.15)", background: view === v ? "rgba(59,130,246,0.25)" : "rgba(255,255,255,0.04)", color: view === v ? "#93c5fd" : "#9ca3af", cursor: "pointer", textTransform: "capitalize" }}>
                {v}
              </button>
            ))}
          </div>

          {view === "suppliers" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: 10 }}>
              {snapshot.supplierResolutions.map((sr) => (
                <div key={sr.raw} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{sr.normalized}</div>
                      {sr.parentCompany && <div style={{ fontSize: 11, opacity: 0.65 }}>Parent: {sr.parentCompany} ({(sr.parentConfidence * 100).toFixed(0)}%)</div>}
                    </div>
                    <div style={{ fontSize: 10, opacity: 0.55 }}>{sr.country}</div>
                  </div>
                  {sr.tickerMappings.length > 0 && (
                    <div style={{ marginTop: 8, display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {sr.tickerMappings.map((tm) => <span key={tm.ticker} title={`${tm.exchange} • ${(tm.confidence * 100).toFixed(0)}% confidence`} style={{ fontSize: 10, padding: "2px 6px", borderRadius: 5, background: "rgba(59,130,246,0.18)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.25)" }}>{tm.ticker}</span>)}
                    </div>
                  )}
                  <div style={{ marginTop: 6, fontSize: 10, opacity: 0.5 }}>{sr.isCrossBorder ? "✦ Cross-border" : "Domestic"} • {sr.isPubliclyListed ? "Listed" : "Private"}</div>
                </div>
              ))}
            </div>
          )}

          {view === "buyers" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: 10 }}>
              {snapshot.buyerResolutions.map((br) => (
                <div key={br.raw} style={cardStyle}>
                  <div style={{ fontWeight: 700 }}>{br.normalized}</div>
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>{br.country} • {br.region}</div>
                  <div style={{ marginTop: 4, fontSize: 10 }}>
                    <span style={{ padding: "2px 6px", borderRadius: 5, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", fontSize: 10 }}>{br.classification.replace(/_/g, " ")}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 10, opacity: 0.5 }}>Confidence: {(br.confidence * 100).toFixed(0)}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel: Data Vault ────────────────────────────────────────────────────────

export function TedDataVaultPanel({ windowDays = "90d" }: { windowDays?: TedIntelTimeWindow }) {
  return (
    <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 40 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700 }}>TED Vault Layer</div>
        <div style={{ fontSize: 10, opacity: 0.6, marginTop: 2 }}>Cloud-based data lifecycle management</div>
      </div>
      <div style={{
        fontSize: 10,
        padding: "3px 8px",
        borderRadius: 5,
        background: "rgba(251, 191, 36, 0.15)",
        color: "#fbbf24",
        border: "1px solid rgba(251, 191, 36, 0.3)",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        fontWeight: 700,
        whiteSpace: "nowrap"
      }}>
        🚧 Under Construction
      </div>
    </div>
  );
}

// ─── Panel: Supply Chain Overlay ──────────────────────────────────────────────

export function TedSupplyChainOverlayPanel({ tickerOrName, windowDays = "90d" }: { tickerOrName?: string | null; windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);
  const overlays = useMemo(() => matchOverlay(snapshot, tickerOrName), [snapshot, tickerOrName]);

  return (
    <div style={shellStyle}>
      <PanelHeader title="Public Procurement Overlay" subtitle="TED-derived buyer-supplier exposure, concentration risk, and second-order ideas" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Loading procurement overlay..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 12 }}>
          <LiveDataBanner />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(255px,1fr))", gap: 10 }}>
            {overlays.map((overlay) => (
              <div key={overlay.ticker} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{overlay.company}</div>
                    <div style={{ fontSize: 11, opacity: 0.65 }}>{overlay.ticker} • {overlay.exposureLabel}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "#93c5fd", whiteSpace: "nowrap" }}>{formatMoney(overlay.linkedAwardValueEur)}</div>
                </div>
                <div style={{ marginTop: 8, display: "grid", gap: 5 }}>
                  {overlay.buyerRelationships.slice(0, 3).map((rel) => (
                    <div key={`${overlay.ticker}-${rel.buyerName}-${rel.theme}`} style={{ fontSize: 11, opacity: 0.82 }}>{rel.buyerName} • {rel.country} • {rel.theme}</div>
                  ))}
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
                  {overlay.secondOrderIdeas.map((idea) => <div key={idea} style={{ fontSize: 11, opacity: 0.7, lineHeight: 1.4 }}>{idea}</div>)}
                </div>
              </div>
            ))}
          </div>

          {snapshot.concentrationRisks.length > 0 && (
            <div>
              <SectionLabel text="Supply Chain Concentration Risk" />
              <div style={{ display: "grid", gap: 8 }}>
                {snapshot.concentrationRisks.map((risk) => <ConcentrationRiskCard key={risk.id} risk={risk} />)}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel: GWMD Spatial Overlay ──────────────────────────────────────────────

export function TedMapOverlayPanel({ windowDays = "90d" }: { windowDays?: TedIntelTimeWindow }) {
  const { snapshot, loading, error } = useTedIntel(windowDays);

  return (
    <div style={shellStyle}>
      <PanelHeader title="TED Spatial Intelligence" subtitle="Regional procurement heat, buyer-to-winner flow corridors, and sector geography" badge={windowDays.toUpperCase()} snapshot={snapshot} />
      {loading && !snapshot ? <LoadingState label="Loading TED spatial overlay..." /> : null}
      {error ? <ErrorState error={error} /> : null}

      {snapshot ? (
        <div style={{ display: "grid", gap: 14 }}>
          <LiveDataBanner />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px,1fr))", gap: 10 }}>
            {snapshot.summaryCards.slice(0, 3).map((card) => <SummaryCard key={card.label} {...card} />)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(210px,0.9fr) minmax(300px,1.1fr)", gap: 14 }}>
            <div>
              <SectionLabel text="Regional Procurement Heat" />
              {snapshot.regions.slice(0, 7).map((region) => (
                <div key={region.key} style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{region.label}</div>
                      <div style={{ opacity: 0.68 }}>{region.noticeCount} notices • {region.awardCount} awards</div>
                    </div>
                    <div style={{ color: "#93c5fd", whiteSpace: "nowrap" }}>{formatMoney(region.totalValueEur)}</div>
                  </div>
                  <div style={{ marginTop: 4, height: 3, borderRadius: 2, background: "rgba(255,255,255,0.07)" }}>
                    <div style={{ width: `${Math.min(100, region.intensity * 40)}%`, height: "100%", borderRadius: 2, background: "linear-gradient(90deg,#3b82f6,#6366f1)" }} />
                  </div>
                </div>
              ))}
            </div>
            <div>
              <SectionLabel text="Buyer → Winner Corridors" />
              {snapshot.mapFlows.slice(0, 6).map((flow) => <FlowRow key={flow.id} flow={flow} />)}
              {snapshot.mapFlows.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>No awarded contracts with geographic flow data in this window.</div>}
            </div>
          </div>

          {snapshot.regions.length > 0 && (
            <div>
              <SectionLabel text="Sector Clustering by Region" />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px,1fr))", gap: 8 }}>
                {snapshot.regions.slice(0, 4).map((region) => {
                  const regionNotices = snapshot.radar.filter((n) => n.placeOfPerformance.country === region.country && n.placeOfPerformance.region === region.region);
                  const themeCounts = regionNotices.reduce((acc, n) => { acc[n.theme] = (acc[n.theme] ?? 0) + 1; return acc; }, {} as Record<string, number>);
                  const topThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
                  return (
                    <div key={region.key} style={cardStyle}>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{region.label}</div>
                      <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
                        {topThemes.map(([theme, count]) => (
                          <div key={theme} style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
                            <span style={{ opacity: 0.75 }}>{theme}</span>
                            <span style={{ color: "#93c5fd" }}>{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
