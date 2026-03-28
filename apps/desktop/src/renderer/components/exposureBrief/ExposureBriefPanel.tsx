import React, { useMemo } from "react";
import { useExposureBriefStore } from "../../store/exposureBriefStore";
import { useGwmdMapStore } from "../../store/gwmdMapStore";
import { useSupplyChainStore } from "../../store/supplyChainStore";
import type {
  ExposureBriefItem,
  ExposureBriefSource,
  ExposureBriefTrustGate,
} from "@tc/shared/exposureBrief";
import { serializeExposureBriefCsv } from "@tc/shared/exposureBrief";

const COLORS = {
  border: "#1f2937",
  text: "#e5e7eb",
  textMuted: "#9ca3af",
  accent: "#3b82f6",
  success: "#22c55e",
  warning: "#eab308",
  error: "#ef4444",
  bg: "#0b1222",
};

const formatPct = (value: number) => `${Math.round(value * 100)}%`;

const zoneColor = (zone: ExposureBriefItem["zone"]) => {
  if (zone === "production") return COLORS.success;
  if (zone === "validation") return COLORS.accent;
  if (zone === "candidate") return COLORS.warning;
  return COLORS.textMuted;
};

const trustGateColor = (gate: ExposureBriefTrustGate) => {
  if (gate === "pass") return COLORS.success;
  if (gate === "warn") return COLORS.warning;
  return COLORS.error;
};

const formatDayAge = (value?: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value)}d`;
};

const downloadText = (fileName: string, mime: string, content: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};

const buildBriefBaseName = (source: ExposureBriefSource, generatedAt: string) =>
  `exposure-brief-${source}-${new Date(generatedAt)
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-")}`;

const renderImpactBar = (item: ExposureBriefItem) => {
  const base = Math.max(4, Math.round(item.impactScore * 100));
  const min =
    typeof item.minImpactScore === "number"
      ? Math.round(item.minImpactScore * 100)
      : base;
  const max =
    typeof item.maxImpactScore === "number"
      ? Math.round(item.maxImpactScore * 100)
      : base;

  const left = Math.max(0, Math.min(100, min));
  const right = Math.max(left, Math.min(100, max));

  return (
    <div style={{ minWidth: 150 }}>
      <div
        style={{
          position: "relative",
          width: "100%",
          height: 8,
          borderRadius: 999,
          background: "rgba(148,163,184,0.2)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: `${base}%`,
            borderRadius: 999,
            background: "linear-gradient(90deg, rgba(59,130,246,0.65), rgba(59,130,246,1))",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: -2,
            bottom: -2,
            left: `${left}%`,
            width: `${Math.max(1, right - left)}%`,
            borderRadius: 999,
            border: "1px dashed rgba(226,232,240,0.8)",
          }}
        />
      </div>
      <div style={{ marginTop: 4, fontSize: 11, color: COLORS.textMuted }}>
        {formatPct(item.impactScore)}
        {typeof item.minImpactScore === "number" && typeof item.maxImpactScore === "number"
          ? ` (min ${formatPct(item.minImpactScore)} / max ${formatPct(item.maxImpactScore)})`
          : ""}
      </div>
    </div>
  );
};

interface ExposureBriefPanelProps {
  open: boolean;
  onClose: () => void;
  preferredSource?: ExposureBriefSource;
}

export default function ExposureBriefPanel({
  open,
  onClose,
  preferredSource,
}: ExposureBriefPanelProps) {
  const gwmdSelectedNodeId = useGwmdMapStore((s) => s.selectedNodeId);
  const supplySelectedNodeId = useSupplyChainStore((s) => s.selectedNodeId);
  const { status, phase, brief, error, generateBrief, setIdle } =
    useExposureBriefStore();
  const primarySource = preferredSource ?? "gwmd";
  const secondarySource: ExposureBriefSource =
    primarySource === "gwmd" ? "supplyChain" : "gwmd";

  const preferredSelectedNodeId =
    primarySource === "gwmd" ? gwmdSelectedNodeId : supplySelectedNodeId;

  const topItems = useMemo(() => brief?.items ?? [], [brief]);

  if (!open) return null;

  const generatedAt = brief
    ? new Date(brief.generatedAt).toLocaleString()
    : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1700,
        display: "flex",
        justifyContent: "flex-end",
        background: "rgba(2,6,23,0.4)",
      }}
    >
      <div
        style={{
          width: "min(760px, 94vw)",
          height: "100%",
          background: COLORS.bg,
          borderLeft: `1px solid ${COLORS.border}`,
          color: COLORS.text,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Exposure Brief</div>
            <div style={{ color: COLORS.textMuted, fontSize: 12 }}>
              Shock-to-exposure ranking for decision support
            </div>
          </div>
          <button
            onClick={() => {
              setIdle();
              onClose();
            }}
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              background: "transparent",
              color: COLORS.text,
              padding: "7px 11px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Close
          </button>
        </div>

        <div
          style={{
            padding: 16,
            borderBottom: `1px solid ${COLORS.border}`,
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() =>
              void generateBrief({
                source: primarySource,
                shockNodeIds: preferredSelectedNodeId
                  ? [preferredSelectedNodeId]
                  : undefined,
              })
            }
            disabled={status === "loading"}
            style={{
              border: "none",
              borderRadius: 6,
              background: COLORS.accent,
              color: "white",
              padding: "8px 12px",
              cursor: status === "loading" ? "not-allowed" : "pointer",
              opacity: status === "loading" ? 0.7 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {status === "loading"
              ? `Generating (${phase})...`
              : `Generate from ${primarySource === "gwmd" ? "GWMD" : "Supply Chain"}`}
          </button>

          <button
            onClick={() =>
              void generateBrief({
                source: secondarySource,
              })
            }
            disabled={status === "loading"}
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              background: "transparent",
              color: COLORS.text,
              padding: "8px 12px",
              cursor: status === "loading" ? "not-allowed" : "pointer",
              opacity: status === "loading" ? 0.7 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {`Generate from ${secondarySource === "gwmd" ? "GWMD" : "Supply Chain"}`}
          </button>

          <button
            onClick={() => {
              if (!brief) return;
              const baseName = buildBriefBaseName(brief.source, brief.generatedAt);
              downloadText(
                `${baseName}.json`,
                "application/json;charset=utf-8",
                JSON.stringify(brief, null, 2),
              );
            }}
            disabled={!brief || status === "loading"}
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              background: "transparent",
              color: COLORS.text,
              padding: "8px 12px",
              cursor: !brief || status === "loading" ? "not-allowed" : "pointer",
              opacity: !brief || status === "loading" ? 0.6 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Export JSON
          </button>

          <button
            onClick={() => {
              if (!brief) return;
              const baseName = buildBriefBaseName(brief.source, brief.generatedAt);
              downloadText(
                `${baseName}.csv`,
                "text/csv;charset=utf-8",
                serializeExposureBriefCsv(brief),
              );
            }}
            disabled={!brief || status === "loading"}
            style={{
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              background: "transparent",
              color: COLORS.text,
              padding: "8px 12px",
              cursor: !brief || status === "loading" ? "not-allowed" : "pointer",
              opacity: !brief || status === "loading" ? 0.6 : 1,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Export CSV
          </button>

          <button
            onClick={() => {
              if (!brief) return;
              const baseName = buildBriefBaseName(brief.source, brief.generatedAt);
              downloadText(
                `${baseName}.json`,
                "application/json;charset=utf-8",
                JSON.stringify(brief, null, 2),
              );
              downloadText(
                `${baseName}.csv`,
                "text/csv;charset=utf-8",
                serializeExposureBriefCsv(brief),
              );
            }}
            disabled={!brief || status === "loading"}
            style={{
              border: `1px solid ${COLORS.accent}`,
              borderRadius: 6,
              background: "rgba(59,130,246,0.12)",
              color: COLORS.accent,
              padding: "8px 12px",
              cursor: !brief || status === "loading" ? "not-allowed" : "pointer",
              opacity: !brief || status === "loading" ? 0.6 : 1,
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            Export Bundle
          </button>

          <div style={{ fontSize: 11, color: COLORS.textMuted, alignSelf: "center" }}>
            Shock node: {preferredSelectedNodeId ?? "auto-select"}
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
          {status === "idle" && (
            <div style={{ color: COLORS.textMuted, fontSize: 13 }}>
              Generate a brief from GWMD or Supply Chain. The current selected node is used as the default shock source.
            </div>
          )}

          {status === "loading" && (
            <div style={{ color: COLORS.textMuted, fontSize: 13 }}>
              Building brief... phase: {phase}
            </div>
          )}

          {status === "error" && (
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${COLORS.error}`,
                background: "rgba(239,68,68,0.12)",
                color: COLORS.error,
                fontSize: 13,
              }}
            >
              {error || "Failed to generate brief."}
            </div>
          )}

          {brief && status === "ready" && (
            <div style={{ display: "grid", gap: 14 }}>
              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  padding: 12,
                  background: "rgba(15,23,42,0.6)",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700 }}>Brief Summary</div>
                <div style={{ marginTop: 6, fontSize: 12, color: COLORS.textMuted }}>
                  Source: {brief.source} • Generated: {generatedAt}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: COLORS.textMuted }}>
                  Shocked nodes: {brief.shockNodeIds.join(", ")} • Impacted nodes: {brief.impactedNodeCount}/{brief.totalNodes}
                </div>
                <div style={{ marginTop: 6, fontSize: 12, color: COLORS.textMuted }}>
                  Trust: avg confidence {formatPct(brief.trust.averageConfidence)} • candidate ratio {formatPct(brief.trust.candidateRatio)} • low-confidence ratio {formatPct(brief.trust.lowConfidenceRatio)} • stale ratio {formatPct(brief.trust.staleRatio)}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    display: "inline-flex",
                    borderRadius: 999,
                    border: `1px solid ${trustGateColor(brief.trustGate)}`,
                    color: trustGateColor(brief.trustGate),
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                    padding: "3px 10px",
                    fontWeight: 700,
                  }}
                >
                  Trust Gate: {brief.trustGate}
                </div>
                {brief.trustIssues.length > 0 && (
                  <div
                    style={{
                      marginTop: 8,
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    {brief.trustIssues.map((issue) => (
                      <div
                        key={issue.code}
                        style={{
                          fontSize: 12,
                          borderRadius: 8,
                          padding: "6px 8px",
                          border: `1px solid ${
                            issue.severity === "critical" ? COLORS.error : COLORS.warning
                          }`,
                          background:
                            issue.severity === "critical"
                              ? "rgba(239,68,68,0.12)"
                              : "rgba(234,179,8,0.08)",
                          color: issue.severity === "critical" ? COLORS.error : COLORS.warning,
                        }}
                      >
                        {issue.message}
                      </div>
                    ))}
                  </div>
                )}
                {brief.trust.candidateRatio > 0.8 && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: COLORS.warning,
                      border: `1px solid ${COLORS.warning}`,
                      borderRadius: 8,
                      padding: "6px 8px",
                      background: "rgba(234,179,8,0.08)",
                    }}
                  >
                    This brief is primarily based on AI-inferred candidate relationships.
                  </div>
                )}
              </div>

              <div
                style={{
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: 12,
                  }}
                >
                  <thead style={{ background: "rgba(15,23,42,0.75)" }}>
                    <tr>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Rank</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Company</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Impact</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Attention Gap</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Confidence</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Freshness</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Zone</th>
                      <th style={{ textAlign: "left", padding: "8px 10px" }}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topItems.map((item, index) => (
                      <tr key={item.nodeId} style={{ borderTop: `1px solid ${COLORS.border}` }}>
                        <td style={{ padding: "10px" }}>{index + 1}</td>
                        <td style={{ padding: "10px" }}>
                          <div style={{ fontWeight: 600 }}>{item.name}</div>
                          <div style={{ color: COLORS.textMuted, fontSize: 11 }}>
                            {item.ticker ?? item.nodeId}
                          </div>
                        </td>
                        <td style={{ padding: "10px" }}>{renderImpactBar(item)}</td>
                        <td style={{ padding: "10px" }}>{formatPct(item.attentionGapScore)}</td>
                        <td style={{ padding: "10px" }}>
                          {formatPct(item.confidence)}
                          <div style={{ color: COLORS.textMuted, fontSize: 11 }}>
                            {item.confidenceBand}
                          </div>
                        </td>
                        <td style={{ padding: "10px" }}>{formatDayAge(item.freshnessDays)}</td>
                        <td style={{ padding: "10px" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              borderRadius: 999,
                              border: `1px solid ${zoneColor(item.zone)}`,
                              color: zoneColor(item.zone),
                              padding: "2px 8px",
                              fontSize: 11,
                              textTransform: "uppercase",
                              letterSpacing: 0.3,
                            }}
                          >
                            {item.zone}
                          </span>
                        </td>
                        <td style={{ padding: "10px" }}>{item.evidenceCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {(brief.dependencyPaths.length > 0 || brief.riskSignals.length > 0) && (
                <div style={{ display: "grid", gap: 12 }}>
                  {brief.dependencyPaths.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 10,
                        padding: 12,
                        background: "rgba(15,23,42,0.45)",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Top Dependency Paths</div>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {brief.dependencyPaths.map((path, index) => (
                          <div
                            key={`${path.sourceNodeId}-${path.targetNodeId}-${index}`}
                            style={{ fontSize: 12, color: COLORS.textMuted }}
                          >
                            <span style={{ color: COLORS.text, fontWeight: 600 }}>{index + 1}. {path.targetName}</span>
                            {` • score ${formatPct(path.score)} • `}
                            {path.steps.map((step) => `${step.from} -> ${step.to}`).join(" -> ")}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {brief.riskSignals.length > 0 && (
                    <div
                      style={{
                        border: `1px solid ${COLORS.border}`,
                        borderRadius: 10,
                        padding: 12,
                        background: "rgba(15,23,42,0.45)",
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 700 }}>Risk Signals</div>
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {brief.riskSignals.map((signal) => (
                          <div
                            key={signal.nodeId}
                            style={{
                              border: `1px solid ${COLORS.border}`,
                              borderRadius: 8,
                              padding: "8px 10px",
                              background: "rgba(2,6,23,0.45)",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{signal.name}</div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color:
                                    signal.severity === "high"
                                      ? COLORS.error
                                      : signal.severity === "medium"
                                        ? COLORS.warning
                                        : COLORS.success,
                                  textTransform: "uppercase",
                                }}
                              >
                                {signal.severity} ({formatPct(signal.score)})
                              </div>
                            </div>
                            <div style={{ marginTop: 4, fontSize: 11, color: COLORS.textMuted }}>
                              {signal.reasons.join(" | ")}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
