import React, { useMemo, useState } from "react";
import { useStrategyStore } from "../store/strategyStore";
import type {
  CamInfluenceTier,
  CamBuyVsSellChannel,
  CamHerdingState,
  CapitalMomentumSignal,
} from "@tc/shared";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCamDate(ts: number | null | undefined): string {
  if (ts == null) return "n/a";
  return new Date(ts).toISOString().slice(0, 10);
}

function formatMs(ms: number): string {
  if (ms < 60_000) return `${ms}ms`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)}h`;
  return `${(ms / 86_400_000).toFixed(1)}d`;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

const TIER_COLOR: Record<CamInfluenceTier, string> = {
  "leadership": "#f59e0b",
  "committee-key": "#a78bfa",
  "committee-standard": "#60a5fa",
  "rank-and-file": "#94a3b8",
};

const HERDING_COLOR: Record<CamHerdingState, string> = {
  "low": "#4ade80",
  "moderate": "#facc15",
  "high": "#fb923c",
  "extreme": "#f87171",
};

const DIRECTION_COLOR: Record<string, string> = {
  "positive": "#4ade80",
  "negative": "#f87171",
  "neutral": "#94a3b8",
};

const CHANNEL_COLOR: Record<CamBuyVsSellChannel, string> = {
  "buy": "#4ade80",
  "sell": "#f87171",
  "exchange": "#60a5fa",
  "unknown": "#94a3b8",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 4 }}>
      {children}
    </div>
  );
}

function Chip({ label, color = "rgba(255,255,255,0.12)", textColor = "#fff" }: { label: string; color?: string; textColor?: string }) {
  return (
    <span style={{ display: "inline-block", padding: "1px 7px", borderRadius: 6, background: color, color: textColor, fontSize: 11, fontWeight: 600 }}>
      {label}
    </span>
  );
}

function StatGrid({ items }: { items: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 6, fontSize: 12 }}>
      {items.map(({ label, value }) => (
        <div key={label} style={{ color: "rgba(255,255,255,0.75)" }}>
          {label}: <b style={{ color: "#fff" }}>{value}</b>
        </div>
      ))}
    </div>
  );
}

// ─── Signal card ──────────────────────────────────────────────────────────────

interface SignalCardProps {
  signal: CapitalMomentumSignal;
  transition: "pass-to-blocked" | "blocked-to-pass" | null;
}

function SignalCard({ signal, transition }: SignalCardProps) {
  const [expanded, setExpanded] = useState(false);

  const passColor = signal.passes ? "#4ade80" : "#fbbf24";
  const transitionBadge = transition === "blocked-to-pass"
    ? { label: "↑ UNBLOCKED", color: "#4ade80" }
    : transition === "pass-to-blocked"
    ? { label: "↓ BLOCKED", color: "#f87171" }
    : null;

  const tier = signal.influenceTierBreakdown?.influenceTier;
  const lag = signal.lagAdjustedConfidence;
  const explain = signal.explainabilityPayload;
  const event = signal.eventWindowFeatures;
  const polFlags = signal.politicalConnectionFlags;
  const herding = signal.herdingState;
  const uncertaintyPenalty = signal.uncertaintyRegimePenalty;

  return (
    <div
      style={{
        border: `1px solid ${signal.passes ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.1)"}`,
        borderRadius: 12,
        padding: 12,
        background: "rgba(255,255,255,0.025)",
        display: "grid",
        gap: 10,
      }}
    >
      {/* ─── Header row ─── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{signal.symbol}</span>
          {tier && (
            <Chip label={tier} color={`${TIER_COLOR[tier]}33`} textColor={TIER_COLOR[tier]} />
          )}
          {explain?.buyVsSellChannel && explain.buyVsSellChannel !== "unknown" && (
            <Chip
              label={explain.buyVsSellChannel.toUpperCase()}
              color={`${CHANNEL_COLOR[explain.buyVsSellChannel]}33`}
              textColor={CHANNEL_COLOR[explain.buyVsSellChannel]}
            />
          )}
          {transitionBadge && (
            <Chip label={transitionBadge.label} color={`${transitionBadge.color}33`} textColor={transitionBadge.color} />
          )}
          {signal.crashKillTriggered && (
            <Chip label="CRASH KILL" color="rgba(248,113,113,0.2)" textColor="#f87171" />
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: passColor, fontWeight: 700 }}>
            {signal.passes ? "PASS" : "BLOCKED"}
          </span>
          <button
            onClick={() => setExpanded((e) => !e)}
            style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 6, padding: "2px 8px", color: "rgba(255,255,255,0.7)", fontSize: 11, cursor: "pointer" }}
          >
            {expanded ? "Less" : "More"}
          </button>
        </div>
      </div>

      {/* ─── Core scores ─── */}
      <StatGrid items={[
        { label: "Score", value: `${signal.compositeScore.toFixed(1)} / ${signal.threshold}` },
        { label: "Trend", value: signal.trendScore.toFixed(2) },
        { label: "Flow", value: signal.flowScore.toFixed(2) },
        { label: "Vol", value: `${signal.volatilityScore.toFixed(2)} (${signal.volatilityState})` },
        { label: "Breakout", value: signal.breakoutScore.toFixed(2) },
        { label: "Regime", value: signal.regimeMode },
      ]} />

      {/* ─── Confidence decomposition ─── */}
      {lag != null ? (
        <div>
          <SectionLabel>Confidence Decomposition</SectionLabel>
          <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>Model: <b style={{ color: "#fff" }}>{pct(lag.modelConfidence)}</b></span>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>Staleness −<b style={{ color: "#fbbf24" }}>{pct(lag.stalenessPenalty)}</b></span>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>Lag adj: <b style={{ color: "#f87171" }}>{pct(lag.disclosureLagAdjustment)}</b></span>
            <span style={{ color: "rgba(255,255,255,0.7)" }}>
              Effective: <b style={{ color: lag.effectiveConfidence >= 0.6 ? "#4ade80" : lag.effectiveConfidence >= 0.35 ? "#fbbf24" : "#f87171" }}>
                {pct(lag.effectiveConfidence)}
              </b>
            </span>
            {lag.disclosureLagDays != null && (
              <span style={{ color: "rgba(255,255,255,0.7)" }}>Disclosure lag: <b style={{ color: "#fff" }}>{lag.disclosureLagDays}d</b></span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
          Confidence: <b style={{ color: "#fff" }}>{pct(signal.confidence)}</b>
        </div>
      )}

      {/* ─── Gates ─── */}
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
        Gates: <span style={{ color: signal.gatesFailed.length ? "#fbbf24" : "#4ade80" }}>
          {signal.gatesFailed.length ? signal.gatesFailed.join(" · ") : "All clear"}
        </span>
      </div>

      {/* ─── Why Now (explainability) ─── */}
      {explain?.whyNow && (
        <div>
          <SectionLabel>Why Now</SectionLabel>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.85)", lineHeight: 1.5, padding: "6px 8px", background: "rgba(255,255,255,0.04)", borderRadius: 8 }}>
            {explain.whyNow}
          </div>
        </div>
      )}

      {/* ─── Signed Contributors ─── */}
      {explain?.topSignedContributors && explain.topSignedContributors.length > 0 && (
        <div>
          <SectionLabel>Signal Contributors</SectionLabel>
          <div style={{ display: "grid", gap: 4 }}>
            {explain.topSignedContributors.map((c) => (
              <div key={c.key} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }}>
                <span style={{ color: "rgba(255,255,255,0.8)" }}>{c.label}</span>
                <span style={{ color: DIRECTION_COLOR[c.direction] ?? "#fff", fontWeight: 600 }}>
                  {c.direction === "positive" ? "+" : c.direction === "negative" ? "−" : "~"}{Math.abs(c.value).toFixed(2)}
                  <span style={{ color: "rgba(255,255,255,0.4)", fontWeight: 400, marginLeft: 4 }}>w={c.weight.toFixed(2)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Event Context ─── */}
      {event != null && event.phase !== "none" && (
        <div>
          <SectionLabel>Event Context</SectionLabel>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, alignItems: "center" }}>
            <Chip label={event.phase} color="rgba(96,165,250,0.15)" textColor="#60a5fa" />
            {event.eventType && <span style={{ color: "rgba(255,255,255,0.75)" }}>{event.eventType}</span>}
            {event.daysToEvent != null && <span style={{ color: "rgba(255,255,255,0.6)" }}>{event.daysToEvent >= 0 ? `T−${event.daysToEvent}d` : `T+${Math.abs(event.daysToEvent)}d`}</span>}
            {event.procurementEventLinked && <Chip label="Procurement" color="rgba(251,191,36,0.15)" textColor="#fbbf24" />}
            {event.regulatoryEventLinked && <Chip label="Regulatory" color="rgba(167,139,250,0.15)" textColor="#a78bfa" />}
          </div>
          {event.eventDescription && (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 4 }}>{event.eventDescription}</div>
          )}
        </div>
      )}

      {/* ─── Herding & Uncertainty ─── */}
      {(herding != null || uncertaintyPenalty != null) && (
        <div>
          <SectionLabel>Structural Uncertainty</SectionLabel>
          <div style={{ display: "flex", gap: 12, fontSize: 12, flexWrap: "wrap" }}>
            {herding != null && (
              <span>Herding: <b style={{ color: HERDING_COLOR[herding] }}>{herding}</b></span>
            )}
            {uncertaintyPenalty != null && (
              <span style={{ color: "rgba(255,255,255,0.7)" }}>Uncertainty penalty: <b style={{ color: uncertaintyPenalty > 0.4 ? "#f87171" : "#fbbf24" }}>−{pct(uncertaintyPenalty)}</b></span>
            )}
          </div>
        </div>
      )}

      {/* ─── Influence Tier (expanded) ─── */}
      {signal.influenceTierBreakdown != null && (
        <div>
          <SectionLabel>Influence</SectionLabel>
          <StatGrid items={[
            { label: "Committee power", value: pct(signal.influenceTierBreakdown.committeePowerScore) },
            { label: "Seniority", value: pct(signal.influenceTierBreakdown.seniorityScore) },
            { label: "Network prox.", value: pct(signal.influenceTierBreakdown.networkProximityScore) },
            ...(signal.influenceTierBreakdown.leadershipRole
              ? [{ label: "Role", value: signal.influenceTierBreakdown.leadershipRole }]
              : []),
          ]} />
          {signal.influenceTierBreakdown.committeeJurisdictions.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
              Committees: {signal.influenceTierBreakdown.committeeJurisdictions.join(", ")}
            </div>
          )}
        </div>
      )}

      {/* ─── Political connections ─── */}
      {polFlags != null && (polFlags.localityLink || polFlags.contributorLink || polFlags.contractChannelIndicator || polFlags.divestmentShockFlag) && (
        <div>
          <SectionLabel>Political Connections</SectionLabel>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {polFlags.localityLink && <Chip label="Home-state" color="rgba(251,191,36,0.12)" textColor="#fbbf24" />}
            {polFlags.contributorLink && <Chip label="Contributor" color="rgba(167,139,250,0.12)" textColor="#a78bfa" />}
            {polFlags.contractChannelIndicator && <Chip label="Contract channel" color="rgba(248,113,113,0.12)" textColor="#f87171" />}
            {polFlags.divestmentShockFlag && <Chip label="Divestment shock" color="rgba(248,113,113,0.2)" textColor="#f87171" />}
          </div>
        </div>
      )}

      {/* ─── Explain metadata (archetype, copycat) ─── */}
      {explain != null && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Chip label={explain.tradeArchetype} color="rgba(255,255,255,0.07)" />
          {explain.copycatRiskScore > 0.4 && (
            <Chip
              label={`Copycat risk ${pct(explain.copycatRiskScore)}`}
              color="rgba(251,191,36,0.15)"
              textColor="#fbbf24"
            />
          )}
          {explain.repeatedTradePattern && (
            <Chip label="Repeated-trade pattern" color="rgba(167,139,250,0.12)" textColor="#a78bfa" />
          )}
          {explain.episodicInformedTradeProbability != null && explain.episodicInformedTradeProbability > 0.3 && (
            <Chip
              label={`Episodic p=${pct(explain.episodicInformedTradeProbability)}`}
              color="rgba(248,113,113,0.12)"
              textColor="#f87171"
            />
          )}
          {explain.informationAsymmetryProxy != null && explain.informationAsymmetryProxy > 0.4 && (
            <Chip label={`Info asym. ${pct(explain.informationAsymmetryProxy)}`} color="rgba(96,165,250,0.12)" textColor="#60a5fa" />
          )}
        </div>
      )}

      {/* ─── Congress dates ─── */}
      <div style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
        Congress: Trade <b>{formatCamDate(signal.transactionDate)}</b> · Disclosure <b>{formatCamDate(signal.disclosureDate)}</b> · Tradable from <b>{formatCamDate(signal.effectiveForTradingAt)}</b>
      </div>

      {/* ─── Expanded section ─── */}
      {expanded && (
        <div style={{ display: "grid", gap: 8, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 8 }}>

          {/* Execution sizing */}
          <div>
            <SectionLabel>Execution</SectionLabel>
            <StatGrid items={[
              { label: "Entry", value: signal.suggestedEntry > 0 ? `$${signal.suggestedEntry.toFixed(2)}` : "n/a" },
              { label: "Stop", value: signal.stopLoss > 0 ? `$${signal.stopLoss.toFixed(2)}` : "n/a" },
              { label: "Risk $", value: signal.riskSizeDollars > 0 ? `$${signal.riskSizeDollars.toFixed(0)}` : "n/a" },
            ]} />
          </div>

          {/* Legacy topContributors */}
          {signal.topContributors.length > 0 && (
            <div>
              <SectionLabel>Raw Contributors</SectionLabel>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
                {signal.topContributors.map((c) => (
                  <span key={c.key} style={{ color: "rgba(255,255,255,0.7)" }}>{c.key}: <b style={{ color: "#fff" }}>{c.value.toFixed(3)}</b></span>
                ))}
              </div>
            </div>
          )}

          {/* Freshness */}
          <div>
            <SectionLabel>Freshness</SectionLabel>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>Public flow: <b>{formatMs(signal.dataFreshness.publicFlowAgeMs)}</b></span>
              <span>Congress: <b>{formatMs(signal.dataFreshness.congressAgeMs)}</b></span>
              <span>Theme: <b>{formatMs(signal.dataFreshness.themeAgeMs)}</b></span>
              <span>2nd order: <b>{formatMs(signal.dataFreshness.secondOrderAgeMs)}</b></span>
            </div>
          </div>

          {/* Feature delays */}
          <div>
            <SectionLabel>Feature Delays</SectionLabel>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", display: "flex", gap: 12, flexWrap: "wrap" }}>
              <span>PF delay: <b>{formatMs(signal.featureDelays.publicFlowDelayMs)}</b></span>
              <span>Congress: <b>{formatMs(signal.featureDelays.congressDelayMs)}</b></span>
              <span>Theme: <b>{formatMs(signal.featureDelays.themeDelayMs)}</b></span>
              <span>2nd order: <b>{formatMs(signal.featureDelays.secondOrderDelayMs)}</b></span>
            </div>
          </div>

          {/* Notes */}
          {signal.notes.length > 0 && (
            <div>
              <SectionLabel>Notes</SectionLabel>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                {signal.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Filter bar ───────────────────────────────────────────────────────────────

interface Filters {
  passOnly: boolean;
  influenceTier: CamInfluenceTier | "all";
  buyVsSell: CamBuyVsSellChannel | "all";
  freshnessMaxMs: number;
  showCrashKilled: boolean;
}

const FRESHNESS_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: "Any", ms: Infinity },
  { label: "< 1h", ms: 3_600_000 },
  { label: "< 6h", ms: 21_600_000 },
  { label: "< 1d", ms: 86_400_000 },
];

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const select = (k: keyof Filters, v: unknown) => onChange({ ...filters, [k]: v });

  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 6,
    color: active ? "#fff" : "rgba(255,255,255,0.55)",
    padding: "3px 10px",
    fontSize: 11,
    cursor: "pointer",
    fontWeight: active ? 700 : 400,
  });

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "6px 0", fontSize: 12 }}>
      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>FILTER</span>

      <button style={btnStyle(filters.passOnly)} onClick={() => select("passOnly", !filters.passOnly)}>
        PASS only
      </button>
      <button style={btnStyle(!filters.showCrashKilled)} onClick={() => select("showCrashKilled", !filters.showCrashKilled)}>
        Hide crash-kill
      </button>

      <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>

      {(["all", "leadership", "committee-key", "committee-standard", "rank-and-file"] as const).map((t) => (
        <button key={t} style={btnStyle(filters.influenceTier === t)} onClick={() => select("influenceTier", t)}>
          {t === "all" ? "All tiers" : t}
        </button>
      ))}

      <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>

      {(["all", "buy", "sell"] as const).map((ch) => (
        <button key={ch} style={btnStyle(filters.buyVsSell === ch)} onClick={() => select("buyVsSell", ch)}>
          {ch === "all" ? "Buy+Sell" : ch.toUpperCase()}
        </button>
      ))}

      <span style={{ color: "rgba(255,255,255,0.3)" }}>|</span>

      {FRESHNESS_OPTIONS.map((opt) => (
        <button key={opt.label} style={btnStyle(filters.freshnessMaxMs === opt.ms)} onClick={() => select("freshnessMaxMs", opt.ms)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main CAM page ─────────────────────────────────────────────────────────────

export default function Cam() {
  const camSignals = useStrategyStore((s) => s.camSignals);
  const camStateTransitions = useStrategyStore((s) => s.camStateTransitions);

  const [filters, setFilters] = useState<Filters>({
    passOnly: false,
    influenceTier: "all",
    buyVsSell: "all",
    freshnessMaxMs: Infinity,
    showCrashKilled: true,
  });

  const ranked = useMemo(() => {
    let list = Object.values(camSignals).sort((a, b) => b.compositeScore - a.compositeScore);

    if (filters.passOnly) list = list.filter((s) => s.passes);
    if (!filters.showCrashKilled) list = list.filter((s) => !s.crashKillTriggered);
    if (filters.influenceTier !== "all") {
      list = list.filter((s) => s.influenceTierBreakdown?.influenceTier === filters.influenceTier);
    }
    if (filters.buyVsSell !== "all") {
      list = list.filter((s) => s.explainabilityPayload?.buyVsSellChannel === filters.buyVsSell);
    }
    if (isFinite(filters.freshnessMaxMs)) {
      list = list.filter((s) => s.dataFreshness.congressAgeMs <= filters.freshnessMaxMs);
    }

    return list.slice(0, 20);
  }, [camSignals, filters]);

  const passCount = useMemo(() => Object.values(camSignals).filter((s) => s.passes).length, [camSignals]);
  const totalCount = Object.keys(camSignals).length;

  return (
    <div style={{ display: "grid", gap: 12, opacity: 0.95, maxWidth: 900 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 4 }}>
        <div>
          <h2 style={{ margin: 0 }}>CAM — Capital Momentum</h2>
          <div style={{ fontSize: 12, opacity: 0.55, marginTop: 2 }}>
            Policy-intelligence execution panel · influence-aware · disclosure-lag adjusted
          </div>
        </div>
        {totalCount > 0 && (
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>
            <span style={{ color: "#4ade80", fontWeight: 700 }}>{passCount}</span>/{totalCount} pass · showing {ranked.length}
          </div>
        )}
      </div>

      <FilterBar filters={filters} onChange={setFilters} />

      {ranked.length === 0 ? (
        <div style={{ padding: 14, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, opacity: 0.6, fontSize: 13 }}>
          {totalCount === 0 ? "Waiting for CAM signals…" : "No signals match current filters."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {ranked.map((signal) => (
            <SignalCard
              key={`${signal.symbol}-${signal.ts}`}
              signal={signal}
              transition={camStateTransitions[signal.symbol] ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

