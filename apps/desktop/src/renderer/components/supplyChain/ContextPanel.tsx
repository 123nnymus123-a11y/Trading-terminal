import React, { useEffect, useMemo, useState } from "react";
import type { MindMapData, CompanyNode, SupplyChainEvidence, SupplyChainGraph, SupplyChainGraphEdge, SupplyChainGraphNode } from "@tc/shared/supplyChain";
import { findTopDependencyPaths } from "@tc/shared/supplyChainSimulation";
import GwmdPathsPanel from "./GwmdPathsPanel";

interface Props {
  mindMap: MindMapData;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  viewMode: "hierarchy" | "flow" | "impact" | "radial" | "risk" | "shock" | "global";
  strictMode: boolean;
  includeHypothesis: boolean;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactRanges?: Record<string, { min: number; max: number }>;
    impactedEdgeIds?: string[];
    rankedImpacts?: Array<{ nodeId: string; score: number; minScore?: number; maxScore?: number }>;
    params: { severity: number; damping: number; includeKinds?: SupplyChainGraphEdge["kind"][] };
  };
  gwmdFilters: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
    hops?: number;
    minConfidence?: number;
    showUnresolved?: boolean;
    sourceMode?: "cache_only" | "hybrid" | "fresh";
  };
  onGwmdFiltersChange: (next: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
    hops?: number;
    minConfidence?: number;
    showUnresolved?: boolean;
    sourceMode?: "cache_only" | "hybrid" | "fresh";
  }) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
  onSimulateNode: (nodeId: string) => void;
  onSimulateEdge: (edgeId: string) => void;
  onRunShock: (nodeId: string) => void;
  onSetShockSeverity: (value: number) => void;
  onSetShockDamping: (value: number) => void;
  onSetShockIncludeKinds: (kinds: SupplyChainGraphEdge["kind"][] | undefined) => void;
  onResetSimulation: () => void;
  intelligenceSettings: {
    confidenceThreshold: number;
    dataStyle: string;
    scenario: string;
    timeHorizon: string;
    rankingMethod: string;
    exposureMethod: string;
    activeOverlays: string[];
  };
  layout?: "side" | "stacked";
}

const panelStyle: React.CSSProperties = {
  width: "clamp(280px, 32vw, 460px)",
  minWidth: 280,
  maxWidth: "100%",
  flex: "0 0 clamp(280px, 32vw, 460px)",
  background: "rgba(10,14,26,0.95)",
  borderLeft: "1px solid rgba(148,163,184,0.1)",
  padding: 20,
  display: "flex",
  flexDirection: "column",
  gap: 16,
  position: "relative",
  zIndex: 150,
};

const SUPPLY_CHAIN_ALERT_RULES_KEY = "tc.supplyChain.alertRules.v1";

type AlertSeverity = "watch" | "warning" | "critical";

type AlertRule = {
  id: string;
  name: string;
  nodeId: string;
  threshold: number;
  severity: AlertSeverity;
  scenario: string;
  enabled: boolean;
  createdAt: string;
};

type AlertRuleStatus = {
  rule: AlertRule;
  currentImpact: number;
  isTriggered: boolean;
};

type GwmdFieldStatus =
  | "present"
  | "unknown"
  | "not_found"
  | "not_applicable"
  | "low_confidence_inference"
  | "contradicted";

function normalizeGwmdFieldStatus(value: unknown): GwmdFieldStatus | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "present") return "present";
  if (normalized === "unknown") return "unknown";
  if (normalized === "not_found") return "not_found";
  if (normalized === "not_applicable") return "not_applicable";
  if (normalized === "low_confidence_inference") {
    return "low_confidence_inference";
  }
  if (normalized === "contradicted") return "contradicted";
  return null;
}

function formatBadgeLabel(value?: string): string {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function gwmdStatusTone(value?: string) {
  switch ((value ?? "").toLowerCase()) {
    case "production":
      return { border: "rgba(34,197,94,0.45)", bg: "rgba(20,83,45,0.35)", text: "#86efac" };
    case "validated":
      return { border: "rgba(56,189,248,0.45)", bg: "rgba(14,116,144,0.28)", text: "#7dd3fc" };
    case "candidate":
      return { border: "rgba(251,191,36,0.45)", bg: "rgba(120,53,15,0.28)", text: "#fcd34d" };
    case "contradicted":
      return { border: "rgba(239,68,68,0.45)", bg: "rgba(127,29,29,0.35)", text: "#fca5a5" };
    case "rejected":
      return { border: "rgba(244,63,94,0.45)", bg: "rgba(136,19,55,0.35)", text: "#fda4af" };
    default:
      return { border: "rgba(148,163,184,0.35)", bg: "rgba(30,41,59,0.6)", text: "#cbd5e1" };
  }
}

function gwmdFieldStatusTone(value: GwmdFieldStatus) {
  switch (value) {
    case "present":
      return { border: "rgba(34,197,94,0.45)", bg: "rgba(20,83,45,0.35)", text: "#86efac" };
    case "unknown":
      return { border: "rgba(148,163,184,0.35)", bg: "rgba(30,41,59,0.6)", text: "#cbd5e1" };
    case "not_found":
      return { border: "rgba(251,191,36,0.45)", bg: "rgba(120,53,15,0.28)", text: "#fcd34d" };
    case "not_applicable":
      return { border: "rgba(168,85,247,0.45)", bg: "rgba(88,28,135,0.28)", text: "#d8b4fe" };
    case "low_confidence_inference":
      return { border: "rgba(249,115,22,0.45)", bg: "rgba(124,45,18,0.3)", text: "#fdba74" };
    case "contradicted":
      return { border: "rgba(239,68,68,0.45)", bg: "rgba(127,29,29,0.35)", text: "#fca5a5" };
    default:
      return { border: "rgba(148,163,184,0.35)", bg: "rgba(30,41,59,0.6)", text: "#cbd5e1" };
  }
}

function parseFieldStatusMap(value: unknown): Array<{ field: string; status: GwmdFieldStatus }> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .map(([field, status]) => ({
      field,
      status: normalizeGwmdFieldStatus(status),
    }))
    .filter(
      (entry): entry is { field: string; status: GwmdFieldStatus } =>
        entry.status !== null,
    )
    .sort((a, b) => a.field.localeCompare(b.field));
}

function formatGeoSourceLabel(value?: string) {
  if (!value) return "Unknown";
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getGeoProvenanceTone(value?: string) {
  switch (value) {
    case "curated":
      return { label: "Curated", border: "rgba(34,197,94,0.45)", bg: "rgba(20,83,45,0.35)", text: "#86efac" };
    case "nominatim":
      return { label: "Nominatim", border: "rgba(56,189,248,0.45)", bg: "rgba(14,116,144,0.28)", text: "#7dd3fc" };
    case "ai_model":
      return { label: "AI Model", border: "rgba(251,146,60,0.45)", bg: "rgba(124,45,18,0.3)", text: "#fdba74" };
    case "stored_snapshot":
      return { label: "Stored Snapshot", border: "rgba(168,85,247,0.45)", bg: "rgba(88,28,135,0.28)", text: "#d8b4fe" };
    case "unresolved":
      return { label: "Unresolved", border: "rgba(148,163,184,0.35)", bg: "rgba(30,41,59,0.6)", text: "#cbd5e1" };
    default:
      return { label: formatGeoSourceLabel(value), border: "rgba(148,163,184,0.35)", bg: "rgba(30,41,59,0.6)", text: "#cbd5e1" };
  }
}

function formatGeoQuality(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return `${percent}%`;
}

function loadAlertRules(): AlertRule[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SUPPLY_CHAIN_ALERT_RULES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AlertRule[];
    return Array.isArray(parsed) ? parsed.filter((rule) => typeof rule?.id === "string") : [];
  } catch {
    return [];
  }
}

function saveAlertRules(rules: AlertRule[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SUPPLY_CHAIN_ALERT_RULES_KEY, JSON.stringify(rules.slice(0, 50)));
  } catch {
    // Ignore storage write failures in private browsing or quota-limited sessions.
  }
}

export default function ContextPanel(props: Props) {
  const layout = props.layout ?? "side";
  const resolvedPanelStyle = useMemo<React.CSSProperties>(() => {
    if (layout !== "stacked") return panelStyle;
    return {
      ...panelStyle,
      width: "100%",
      minWidth: 0,
      maxWidth: "100%",
      flex: "1 1 auto",
      borderLeft: "none",
      borderTop: "1px solid rgba(148,163,184,0.1)",
      padding: 16,
      maxHeight: "100%",
      overflow: "auto",
    };
  }, [layout]);

  const graph = props.mindMap.graph;
  const [activeImpactNodeId, setActiveImpactNodeId] = useState<string | null>(null);
  const [alertRules, setAlertRules] = useState<AlertRule[]>(() => loadAlertRules());
  const selectedNode: SupplyChainGraphNode | undefined = graph?.nodes.find((node) => node.id === props.selectedNodeId);
  const selectedEdge: SupplyChainGraphEdge | undefined = graph?.edges.find((edge) => edge.id === props.selectedEdgeId);
  const companyDetails = findCompanyDetails(props.mindMap, props.selectedNodeId);
  const nodeIndex = useMemo(() => (graph ? new Map(graph.nodes.map((node) => [node.id, node])) : new Map()), [graph]);

  useEffect(() => {
    saveAlertRules(alertRules);
  }, [alertRules]);

  const selectedPartners = useMemo(() => {
    if (!graph || !props.selectedNodeId) return [] as Array<{ id: string; label: string; kind: string; weight: number }>;
    return graph.edges
      .filter((edge) => edge.from === props.selectedNodeId || edge.to === props.selectedNodeId)
      .map((edge) => {
        const otherId = edge.from === props.selectedNodeId ? edge.to : edge.from;
        const otherNode = nodeIndex.get(otherId);
        return {
          id: otherId,
          label: otherNode?.label ?? otherId,
          kind: edge.kind,
          weight: edgeMagnitude(edge),
        };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }, [graph, nodeIndex, props.selectedNodeId]);

  const availableKinds = useMemo(() => {
    return graph ? Array.from(new Set(graph.edges.map((edge) => edge.kind))) : [];
  }, [graph]);

  const contributingTargetId = activeImpactNodeId ?? props.selectedNodeId;
  const contributingPaths = useMemo(() => {
    if (!graph || !contributingTargetId) return [];
    const centerNodeId = graph.nodes.find((node) => node.tickers?.includes(props.mindMap.centerTicker) || node.id === props.mindMap.centerTicker)?.id ?? null;
    return findTopDependencyPaths(graph, contributingTargetId, centerNodeId, 4, 3);
  }, [graph, contributingTargetId, props.mindMap.centerTicker]);

  const alertStatuses = useMemo(() => {
    return alertRules
      .map((rule) => {
        const currentImpact = props.simulation.impactScores?.[rule.nodeId] ?? 0;
        return {
          rule,
          currentImpact,
          isTriggered: rule.enabled && currentImpact >= rule.threshold,
        } satisfies AlertRuleStatus;
      })
      .sort((a, b) => Number(b.isTriggered) - Number(a.isTriggered) || b.currentImpact - a.currentImpact);
  }, [alertRules, props.simulation.impactScores]);

  const handleCreateAlertRule = (input: {
    nodeId: string;
    name: string;
    threshold: number;
    severity: AlertSeverity;
    scenario: string;
  }) => {
    const sanitizedThreshold = Math.max(0.05, Math.min(1, input.threshold));
    const id = `${input.nodeId}-${Date.now()}`;
    setAlertRules((prev) => {
      const nextRule: AlertRule = {
        id,
        nodeId: input.nodeId,
        name: input.name.trim() || `Alert: ${input.nodeId}`,
        threshold: sanitizedThreshold,
        severity: input.severity,
        scenario: input.scenario,
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      return [nextRule, ...prev].slice(0, 50);
    });
  };

  const handleToggleAlertRule = (ruleId: string) => {
    setAlertRules((prev) => prev.map((rule) => (rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule)));
  };

  const handleDeleteAlertRule = (ruleId: string) => {
    setAlertRules((prev) => prev.filter((rule) => rule.id !== ruleId));
  };

  if (!graph) {
    return (
      <aside style={resolvedPanelStyle}>
        <Placeholder text="No graph loaded" />
      </aside>
    );
  }

  if (props.viewMode === "global") {
    return (
      <aside style={resolvedPanelStyle}>
        <header>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Global Paths</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Trade flows & supply chains</div>
        </header>
        <GwmdPathsPanel
          graph={graph}
          simulation={props.simulation}
          selectedNode={selectedNode}
          selectedEdge={selectedEdge}
          filters={props.gwmdFilters}
          onSelectNode={props.onSelectNode}
          onSelectEdge={props.onSelectEdge}
        />
      </aside>
    );
  }

  return (
    <aside style={resolvedPanelStyle}>
      <header>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Shock Simulation</div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>Inspector + propagation</div>
      </header>

      <ContextDrawer
        node={selectedNode}
        edge={selectedEdge}
        company={companyDetails}
        partners={selectedPartners}
        strictMode={props.strictMode}
        includeHypothesis={props.includeHypothesis}
        mindMap={props.mindMap}
        simulation={props.simulation}
        onSimulateNode={props.onSimulateNode}
        onSimulateEdge={props.onSimulateEdge}
      />

      {props.selectedNodeId && (
        <ShockSimulationPanel
          nodeId={props.selectedNodeId}
          params={props.simulation.params}
          rankedImpacts={props.simulation.rankedImpacts ?? []}
          impactRanges={props.simulation.impactRanges ?? {}}
          availableKinds={availableKinds}
          onRunShock={() => props.onRunShock(props.selectedNodeId!)}
          onSetSeverity={props.onSetShockSeverity}
          onSetDamping={props.onSetShockDamping}
          onSetIncludeKinds={props.onSetShockIncludeKinds}
          onSelectImpact={(nodeId) => {
            setActiveImpactNodeId(nodeId);
            props.onSelectNode(nodeId);
          }}
          graph={graph}
        />
      )}

      <ContributingPathsPanel
        targetNodeId={contributingTargetId}
        graph={graph}
        paths={contributingPaths}
      />

      <IntelligenceBriefingPanel
        graph={graph}
        selectedNodeId={props.selectedNodeId}
        simulation={props.simulation}
        mindMap={props.mindMap}
        settings={props.intelligenceSettings}
      />

      <AlertMonitorPanel
        selectedNode={selectedNode}
        settings={props.intelligenceSettings}
        statuses={alertStatuses}
        onCreateRule={handleCreateAlertRule}
        onToggleRule={handleToggleAlertRule}
        onDeleteRule={handleDeleteAlertRule}
      />

      <div style={{ marginTop: "auto" }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
          Generated {new Date(props.mindMap.generatedAt).toLocaleString()}
        </div>
        <button style={resetButtonStyle} onClick={props.onResetSimulation}>Reset Simulation</button>
      </div>
    </aside>
  );
}

function ContextDrawer({
  node,
  edge,
  company,
  partners,
  strictMode,
  includeHypothesis,
  mindMap,
  simulation,
  onSimulateNode,
  onSimulateEdge,
}: {
  node: SupplyChainGraphNode | undefined;
  edge: SupplyChainGraphEdge | undefined;
  company: CompanyNode | null | undefined;
  partners: Array<{ id: string; label: string; kind: string; weight: number }>;
  strictMode: boolean;
  includeHypothesis: boolean;
  mindMap: MindMapData;
  simulation: Props["simulation"];
  onSimulateNode: (nodeId: string) => void;
  onSimulateEdge: (edgeId: string) => void;
}) {
  if (!node && !edge) {
    return <Placeholder text="Select a node or edge to inspect details" />;
  }

  if (edge) {
    const edgeMeta = (edge.metadata ?? {}) as {
      dataStatus?: string;
      fieldStatuses?: Record<string, unknown>;
    };
    const edgeFieldStatuses = parseFieldStatusMap(edgeMeta.fieldStatuses);

    return (
      <section style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={subheadingStyle}>Edge details</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{edge.kind}</div>
          </div>
          <button
            style={{
              ...pillButtonStyle,
              background: simulation.failedEdgeIds.includes(edge.id) ? "rgba(239,68,68,0.2)" : "rgba(120,53,15,0.2)",
              color: simulation.failedEdgeIds.includes(edge.id) ? "#ef4444" : "#fb923c",
            }}
            onClick={() => onSimulateEdge(edge.id)}
          >
            {simulation.failedEdgeIds.includes(edge.id) ? "Restore" : "Simulate Break"}
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{edge.explanation ?? "No explanation"}</div>
        <div style={detailGrid}>
          <DetailItem label="Direction" value={`${edge.from} → ${edge.to}`} />
          <DetailItem label="Confidence" value={`${Math.round((edge.confidence ?? 0) * 100)}%`} />
          <DetailItem label="Weight" value={formatWeight(edge)} />
          <DetailItem label="Status" value={edge.evidenceStatus ?? (strictMode ? "verified_official" : "mixed")} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <StatusBadge
            label={`Data: ${formatBadgeLabel(edgeMeta.dataStatus)}`}
            tone={gwmdStatusTone(edgeMeta.dataStatus)}
          />
        </div>
        {edgeFieldStatuses.length > 0 && (
          <div>
            <div style={subheadingStyle}>Field statuses</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {edgeFieldStatuses.map((entry) => (
                <StatusBadge
                  key={`${entry.field}-${entry.status}`}
                  label={`${formatBadgeLabel(entry.field)}: ${formatBadgeLabel(entry.status)}`}
                  tone={gwmdFieldStatusTone(entry.status)}
                />
              ))}
            </div>
          </div>
        )}
        {edge.evidence && edge.evidence.length > 0 && (
          <div>
            <div style={subheadingStyle}>Official evidence</div>
            {edge.evidence.map((ev) => (
              <EvidenceCard key={ev.evidenceId} evidence={ev} />
            ))}
          </div>
        )}
        {!edge.evidence?.length && strictMode && !includeHypothesis && (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Evidence required for strict mode.</div>
        )}
      </section>
    );
  }

  if (!node) return null;

  const neighbors = buildNeighborsByKind(mindMap.graph!, node.id);
  const failed = simulation.failedNodeIds.includes(node.id);
  const impactScore = simulation.impactScores?.[node.id];
  const meta = node.metadata as {
    hqCity?: string;
    hqState?: string;
    hqCountry?: string;
    industry?: string;
    foundedYear?: number;
    subsidiaries?: string[];
    geoSource?: string;
    geoConfidence?: number;
    dataStatus?: string;
    fieldStatuses?: Record<string, unknown>;
  } | undefined;
  const nodeFieldStatuses = parseFieldStatusMap(meta?.fieldStatuses);
  const hq = [meta?.hqCity, meta?.hqState, meta?.hqCountry].filter(Boolean).join(", ");
  const subsidiaries = meta?.subsidiaries ?? [];

  return (
    <section style={sectionStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={subheadingStyle}>Company</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{node.label}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{company?.name ?? node.canonicalName ?? ""}</div>
        </div>
        <button
          style={{
            ...pillButtonStyle,
            background: failed ? "rgba(239,68,68,0.2)" : "rgba(127,29,29,0.2)",
            color: failed ? "#ef4444" : "#f87171",
          }}
          onClick={() => onSimulateNode(node.id)}
        >
          {failed ? "Restore" : "Simulate Failure"}
        </button>
      </div>
      <div style={detailGrid}>
        <DetailItem label="Role" value={node.role ?? company?.role ?? "n/a"} />
        <DetailItem label="Criticality" value={node.criticality ? `${node.criticality}/5` : "-"} />
        <DetailItem label="Confidence" value={`${Math.round((node.confidence ?? 0) * 100)}%`} />
        <DetailItem label="Impact" value={impactScore !== undefined ? `${Math.round(impactScore * 100)}%` : "n/a"} />
      </div>
      {(hq ||
        meta?.industry ||
        meta?.foundedYear ||
        meta?.geoSource ||
        typeof meta?.geoConfidence === "number" ||
        meta?.dataStatus ||
        nodeFieldStatuses.length > 0) && (
        <div>
          <div style={subheadingStyle}>Company profile</div>
          {hq && <div style={{ fontSize: 12, color: "#cbd5f5", marginBottom: 4 }}>HQ: {hq}</div>}
          {meta?.industry && <div style={{ fontSize: 12, color: "#cbd5f5", marginBottom: 4 }}>Industry: {meta.industry}</div>}
          {meta?.foundedYear && <div style={{ fontSize: 12, color: "#cbd5f5" }}>Founded: {meta.foundedYear}</div>}
          {(meta?.geoSource || typeof meta?.geoConfidence === "number") && (
            <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {(() => {
                const tone = getGeoProvenanceTone(meta?.geoSource);
                return (
                  <span
                    style={{
                      fontSize: 10,
                      padding: "3px 8px",
                      borderRadius: 999,
                      border: `1px solid ${tone.border}`,
                      background: tone.bg,
                      color: tone.text,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Geo: {tone.label}
                  </span>
                );
              })()}
              <span style={{ fontSize: 12, color: "#cbd5f5" }}>
                Quality: {formatGeoQuality(meta?.geoConfidence)}
              </span>
            </div>
          )}
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StatusBadge
              label={`Data: ${formatBadgeLabel(meta?.dataStatus)}`}
              tone={gwmdStatusTone(meta?.dataStatus)}
            />
          </div>
          {nodeFieldStatuses.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {nodeFieldStatuses.map((entry) => (
                <StatusBadge
                  key={`${entry.field}-${entry.status}`}
                  label={`${formatBadgeLabel(entry.field)}: ${formatBadgeLabel(entry.status)}`}
                  tone={gwmdFieldStatusTone(entry.status)}
                />
              ))}
            </div>
          )}
        </div>
      )}
      <div>
        <div style={subheadingStyle}>Main trade partners</div>
        {partners.length === 0 ? (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>No partners found in current graph.</div>
        ) : (
          partners.map((partner) => (
            <div key={`${partner.id}-${partner.kind}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#e2e8f0", marginBottom: 6 }}>
              <span>{partner.label}</span>
              <span style={{ color: "#94a3b8" }}>{partner.kind}</span>
            </div>
          ))
        )}
      </div>
      <div>
        <div style={subheadingStyle}>Subsidiaries</div>
        {subsidiaries.length === 0 ? (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>No subsidiary data available.</div>
        ) : (
          subsidiaries.slice(0, 6).map((name) => (
            <div key={name} style={{ fontSize: 11, color: "#e2e8f0", marginBottom: 6 }}>{name}</div>
          ))
        )}
      </div>
      <div>
        <div style={subheadingStyle}>Immediate neighbors</div>
        {Object.entries(neighbors).map(([kind, nodes]) => (
          <div key={kind} style={{ fontSize: 12, color: "#cbd5f5", marginBottom: 6 }}>
            <strong>{kind}</strong>: {nodes.join(" • ")}
          </div>
        ))}
      </div>
      {mindMap.dataFreshness && (
        <div>
          <div style={subheadingStyle}>Data freshness</div>
          <DetailItem label="Last doc" value={mindMap.dataFreshness.lastIngestedDocDate ?? "n/a"} />
          <DetailItem label="Last extraction" value={mindMap.dataFreshness.lastExtractionAt ?? "n/a"} />
        </div>
      )}
    </section>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div style={{
      border: "1px dashed rgba(148,163,184,0.3)",
      borderRadius: 16,
      padding: 16,
      color: "#64748b",
      fontSize: 13,
      textAlign: "center",
    }}>
      {text}
    </div>
  );
}

function findCompanyDetails(data: MindMapData, nodeId: string | null): CompanyNode | null {
  if (!nodeId) return null;
  for (const category of data.categories) {
    const match = category.companies.find((company) => company.id === nodeId);
    if (match) return match;
  }
  return null;
}

const sectionStyle: React.CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(148,163,184,0.15)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
  background: "rgba(15,23,42,0.8)",
};

const detailGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const subheadingStyle: React.CSSProperties = {
  fontSize: 12,
  textTransform: "uppercase",
  color: "#94a3b8",
  marginBottom: 6,
};

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: "uppercase", color: "#94a3b8" }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: { border: string; bg: string; text: string };
}) {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "3px 8px",
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.text,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}
    >
      {label}
    </span>
  );
}

function ShockSimulationPanel({
  nodeId,
  params,
  rankedImpacts,
  impactRanges,
  availableKinds,
  onRunShock,
  onSetSeverity,
  onSetDamping,
  onSetIncludeKinds,
  onSelectImpact,
  graph,
}: {
  nodeId: string;
  params: { severity: number; damping: number; includeKinds?: SupplyChainGraphEdge["kind"][] };
  rankedImpacts: Array<{ nodeId: string; score: number; minScore?: number; maxScore?: number }>;
  impactRanges: Record<string, { min: number; max: number }>;
  availableKinds: SupplyChainGraphEdge["kind"][];
  onRunShock: () => void;
  onSetSeverity: (value: number) => void;
  onSetDamping: (value: number) => void;
  onSetIncludeKinds: (kinds: SupplyChainGraphEdge["kind"][] | undefined) => void;
  onSelectImpact: (nodeId: string) => void;
  graph: SupplyChainGraph;
}) {
  const selectedKinds = params.includeKinds ?? [];

  const scenarioPresets: Array<{ label: string; severity: number; damping: number }> = [
    { label: "Supplier Disruption", severity: 0.8, damping: 0.55 },
    { label: "Country Shutdown", severity: 0.9, damping: 0.72 },
    { label: "Tariff Shock", severity: 0.65, damping: 0.5 },
    { label: "Shipping Delay", severity: 0.55, damping: 0.8 },
  ];

  return (
    <section style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Shock Simulation</div>
      <div style={{ fontSize: 12, color: "#cbd5f5" }}>
        By: {nodeId} → Simulated {Math.round(params.severity * 100)}% Failure
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={{ fontSize: 11, color: "#94a3b8" }}>Severity {Math.round(params.severity * 100)}%</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={params.severity}
          onChange={(e) => onSetSeverity(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <label style={{ fontSize: 11, color: "#94a3b8" }}>Damping {Math.round(params.damping * 100)}%</label>
        <input
          type="range"
          min={0.2}
          max={0.95}
          step={0.05}
          value={params.damping}
          onChange={(e) => onSetDamping(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={subheadingStyle}>Layers included</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {availableKinds.map((kind) => {
            const active = selectedKinds.includes(kind);
            return (
              <button
                key={kind}
                onClick={() => {
                  const next = active ? selectedKinds.filter((k) => k !== kind) : [...selectedKinds, kind];
                  onSetIncludeKinds(next.length ? next : undefined);
                }}
                style={{
                  padding: "4px 8px",
                  borderRadius: 999,
                  border: active ? "1px solid rgba(59,130,246,0.6)" : "1px solid rgba(148,163,184,0.2)",
                  background: active ? "rgba(59,130,246,0.2)" : "transparent",
                  color: active ? "#bfdbfe" : "#94a3b8",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                {kind}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button style={resetButtonStyle} onClick={onRunShock}>Run</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <div style={subheadingStyle}>Scenario Shortcuts</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {scenarioPresets.map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                onSetSeverity(preset.severity);
                onSetDamping(preset.damping);
              }}
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.25)",
                background: "rgba(15,23,42,0.7)",
                color: "#e2e8f0",
                fontSize: 10,
                cursor: "pointer",
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {rankedImpacts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={subheadingStyle}>Ranked by Expected Overall Impairment</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 6 }}>Rank | Company | Impact | Confidence</div>
          {rankedImpacts.slice(0, 10).map((impact, idx) => {
            const range = impactRanges?.[impact.nodeId];
            const rangeText = range ? `${(range.min * 100).toFixed(0)}–${(range.max * 100).toFixed(0)}%` : `${(impact.score * 100).toFixed(0)}%`;
            const node = graph?.nodes.find((n) => n.id === impact.nodeId);
            return (
              <div
                key={impact.nodeId}
                style={{
                  display: "grid",
                  gridTemplateColumns: "28px 1fr 72px 64px",
                  gap: 6,
                  fontSize: 11,
                  color: "#e2e8f0",
                  padding: "6px 0",
                  borderBottom: "1px solid rgba(148,163,184,0.08)",
                  cursor: "pointer",
                }}
                onClick={() => onSelectImpact(impact.nodeId)}
              >
                <span>{idx + 1}</span>
                <span>{node?.label ?? impact.nodeId}</span>
                <span style={{ color: "#f97316" }}>{rangeText}</span>
                <span>{Math.round((node?.confidence ?? 0) * 100)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function IntelligenceBriefingPanel({
  graph,
  selectedNodeId,
  simulation,
  mindMap,
  settings,
}: {
  graph: SupplyChainGraph;
  selectedNodeId: string | null;
  simulation: Props["simulation"];
  mindMap: MindMapData;
  settings: Props["intelligenceSettings"];
}) {
  const focalNodeId = selectedNodeId ?? mindMap.centerNodeId ?? mindMap.centerTicker;
  const focalNode = graph.nodes.find((node) => node.id === focalNodeId) ?? graph.nodes[0];
  const linkedEdges = graph.edges.filter((edge) => edge.from === focalNode?.id || edge.to === focalNode?.id);
  const weighted = linkedEdges.map((edge) => {
    const base = edge.weightRange
      ? (edge.weightRange.min + edge.weightRange.max) / 2
      : typeof edge.weight === "number"
      ? edge.weight
      : edge.criticality ?? 1;
    const normalized = base <= 1 ? Math.max(0, base) : Math.min(1, Math.log1p(base) / 6);
    return {
      edge,
      normalized: Math.max(0.001, normalized * Math.max(0.2, edge.confidence ?? 0.65)),
    };
  });
  const totalWeight = weighted.reduce((sum, item) => sum + item.normalized, 0) || 1;
  const maxExposure = weighted
    .map((item) => ({
      item,
      exposure: item.normalized / totalWeight,
    }))
    .sort((a, b) => b.exposure - a.exposure)[0];
  const concentrationHHI = weighted.reduce((sum, item) => {
    const w = item.normalized / totalWeight;
    return sum + w * w;
  }, 0);
  const firstOrderImpact = weighted.reduce((sum, item) => {
    const targetId = item.edge.from === focalNode?.id ? item.edge.to : item.edge.from;
    const shock = simulation.impactScores?.[targetId] ?? 0;
    return sum + (item.normalized / totalWeight) * shock;
  }, 0);
  const estimatedSpilloverPD = 1 - weighted.reduce((product, item) => {
    const impliedPD = Math.min(0.35, Math.max(0.01, (item.edge.criticality ?? 2) / 15));
    const w = item.normalized / totalWeight;
    return product * (1 - w * impliedPD);
  }, 1);
  const marginAtRisk = -weighted.reduce((sum, item) => {
    const proxyCostShock = 0.02 + 0.06 * (simulation.impactScores?.[item.edge.to] ?? 0);
    return sum + (item.normalized / totalWeight) * proxyCostShock;
  }, 0);

  const regions = graph.nodes
    .map((node) => {
      const metadata = node.metadata as { hqRegion?: string; hqCountry?: string } | undefined;
      return metadata?.hqRegion ?? metadata?.hqCountry ?? "Unlocated";
    })
    .filter(Boolean);
  const regionCounts = new Map<string, number>();
  regions.forEach((region) => regionCounts.set(region, (regionCounts.get(region) ?? 0) + 1));
  const totalRegions = regions.length || 1;
  const entropy = Array.from(regionCounts.values()).reduce((sum, count) => {
    const p = count / totalRegions;
    return sum + (p > 0 ? -p * Math.log(p) : 0);
  }, 0);

  const topDependencyNodeId = maxExposure
    ? (maxExposure.item.edge.from === focalNode?.id ? maxExposure.item.edge.to : maxExposure.item.edge.from)
    : null;
  const topDependencyLabel = topDependencyNodeId
    ? graph.nodes.find((node) => node.id === topDependencyNodeId)?.label ?? topDependencyNodeId
    : "n/a";

  const evidenceCount = graph.edges.reduce((sum, edge) => sum + (edge.evidence?.length ?? 0), 0);
  const avgConfidence = graph.edges.length
    ? graph.edges.reduce((sum, edge) => sum + (edge.confidence ?? 0), 0) / graph.edges.length
    : 0;
  const impactedPeers = (simulation.rankedImpacts ?? [])
    .filter((impact) => impact.nodeId !== focalNode?.id)
    .slice(0, 3)
    .map((impact) => {
      const node = graph.nodes.find((candidate) => candidate.id === impact.nodeId);
      return `${node?.label ?? impact.nodeId} (${Math.round(impact.score * 100)}%)`;
    });

  return (
    <section style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Intelligence Briefing</div>
      <div style={{ fontSize: 12, color: "#cbd5f5", lineHeight: 1.5 }}>
        Highest dependency currently points to <strong>{topDependencyLabel}</strong>. Concentration reads
        <strong> {concentrationHHI.toFixed(2)}</strong> with first-order propagation at
        <strong> {(firstOrderImpact * 100).toFixed(0)}%</strong>.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ModelCard title="Exposure Weight" formula="w_ij = R_ij / Σ_k R_ik" value={`${maxExposure ? (maxExposure.exposure * 100).toFixed(1) : "0.0"}%`} interpretation={`Top link: ${topDependencyLabel}`} />
        <ModelCard title="Concentration Risk" formula="HHI_i = Σ_j w_ij^2" value={concentrationHHI.toFixed(2)} interpretation={concentrationHHI > 0.25 ? "High concentration" : "Moderate diversification"} />
        <ModelCard title="Shock Propagation" formula="Impact_i = Σ_j w_ij Δ_j" value={`${(firstOrderImpact * 100).toFixed(1)}%`} interpretation="First-order impact estimate" />
        <ModelCard title="Default Spillover" formula="PD_i^SC = 1 - Π_j(1 - w_ij PD_j)" value={`${(estimatedSpilloverPD * 100).toFixed(1)}%`} interpretation="Dependency-linked default channel" />
        <ModelCard title="Margin Sensitivity" formula="ΔGM_i ≈ -Σ_j w_ij ΔC_j" value={`${(marginAtRisk * 100).toFixed(1)} bps`} interpretation="Estimated margin-at-risk" />
        <ModelCard title="Geo Fragility" formula="Entropy_i = -Σ_r p_ir ln(p_ir)" value={entropy.toFixed(2)} interpretation={entropy < 1 ? "Regionally concentrated" : "Diversified footprint"} />
      </div>
      <div>
        <div style={subheadingStyle}>Evidence and Trade Relevance</div>
        <div style={{ fontSize: 11, color: "#cbd5f5", marginBottom: 4 }}>
          Evidence items: {evidenceCount} • Avg confidence: {Math.round(avgConfidence * 100)}% • Data style: {settings.dataStyle}
        </div>
        <div style={{ fontSize: 11, color: "#cbd5f5", marginBottom: 4 }}>
          Scenario: {settings.scenario} • Horizon: {settings.timeHorizon} • Overlays: {settings.activeOverlays.join(", ") || "None"}
        </div>
        <div style={{ fontSize: 11, color: "#94a3b8" }}>
          Secondary names: {impactedPeers.length ? impactedPeers.join(" • ") : "Run simulation to surface second-order names."}
        </div>
      </div>
    </section>
  );
}

function AlertMonitorPanel({
  selectedNode,
  settings,
  statuses,
  onCreateRule,
  onToggleRule,
  onDeleteRule,
}: {
  selectedNode: SupplyChainGraphNode | undefined;
  settings: Props["intelligenceSettings"];
  statuses: AlertRuleStatus[];
  onCreateRule: (input: {
    nodeId: string;
    name: string;
    threshold: number;
    severity: AlertSeverity;
    scenario: string;
  }) => void;
  onToggleRule: (ruleId: string) => void;
  onDeleteRule: (ruleId: string) => void;
}) {
  const [threshold, setThreshold] = useState(0.35);
  const [severity, setSeverity] = useState<AlertSeverity>("warning");

  const severityTone: Record<AlertSeverity, { border: string; bg: string; text: string }> = {
    watch: { border: "rgba(56,189,248,0.45)", bg: "rgba(14,116,144,0.24)", text: "#bae6fd" },
    warning: { border: "rgba(251,146,60,0.45)", bg: "rgba(124,45,18,0.28)", text: "#fed7aa" },
    critical: { border: "rgba(248,113,113,0.55)", bg: "rgba(127,29,29,0.32)", text: "#fecaca" },
  };

  return (
    <section style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Alert Monitor</div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>
        Rule triggers when simulated impact exceeds threshold for the watched node.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "end" }}>
        <div>
          <label style={{ fontSize: 11, color: "#94a3b8" }}>Trigger threshold {Math.round(threshold * 100)}%</label>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
            style={{ width: "100%" }}
          />
        </div>
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value as AlertSeverity)}
          style={{
            borderRadius: 8,
            border: "1px solid rgba(148,163,184,0.35)",
            background: "rgba(15,23,42,0.75)",
            color: "#e2e8f0",
            padding: "8px 10px",
            fontSize: 12,
          }}
        >
          <option value="watch">Watch</option>
          <option value="warning">Warning</option>
          <option value="critical">Critical</option>
        </select>
      </div>

      <button
        style={resetButtonStyle}
        disabled={!selectedNode}
        onClick={() => {
          if (!selectedNode) return;
          onCreateRule({
            nodeId: selectedNode.id,
            name: `Alert: ${selectedNode.label}`,
            threshold,
            severity,
            scenario: settings.scenario,
          });
        }}
      >
        {selectedNode ? `Create Rule for ${selectedNode.label}` : "Select a node to create alert"}
      </button>

      {statuses.length === 0 ? (
        <div style={{ fontSize: 11, color: "#94a3b8" }}>No active rules yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {statuses.slice(0, 8).map((entry) => {
            const tone = severityTone[entry.rule.severity];
            return (
              <div
                key={entry.rule.id}
                style={{
                  border: `1px solid ${tone.border}`,
                  background: tone.bg,
                  borderRadius: 10,
                  padding: 10,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: tone.text }}>{entry.rule.name}</div>
                  <div style={{ fontSize: 10, color: "#cbd5e1" }}>
                    Node: {entry.rule.nodeId} • Scenario: {entry.rule.scenario}
                  </div>
                  <div style={{ fontSize: 11, color: entry.isTriggered ? "#fca5a5" : "#94a3b8" }}>
                    Impact {Math.round(entry.currentImpact * 100)}% vs threshold {Math.round(entry.rule.threshold * 100)}%
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <button
                    onClick={() => onToggleRule(entry.rule.id)}
                    style={{
                      ...pillButtonStyle,
                      border: "1px solid rgba(148,163,184,0.35)",
                      background: "rgba(15,23,42,0.65)",
                      color: "#e2e8f0",
                      padding: "4px 10px",
                    }}
                  >
                    {entry.rule.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    onClick={() => onDeleteRule(entry.rule.id)}
                    style={{
                      ...pillButtonStyle,
                      border: "1px solid rgba(239,68,68,0.45)",
                      background: "rgba(127,29,29,0.35)",
                      color: "#fecaca",
                      padding: "4px 10px",
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ModelCard({
  title,
  formula,
  value,
  interpretation,
}: {
  title: string;
  formula: string;
  value: string;
  interpretation: string;
}) {
  return (
    <div
      style={{
        border: "1px solid rgba(148,163,184,0.2)",
        borderRadius: 12,
        padding: 10,
        background: "rgba(2,6,23,0.6)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ fontSize: 11, color: "#94a3b8", textTransform: "uppercase" }}>{title}</div>
      <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontSize: 11, color: "#bfdbfe" }}>{formula}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>{value}</div>
      <div style={{ fontSize: 10, color: "#94a3b8" }}>{interpretation}</div>
    </div>
  );
}

function ContributingPathsPanel({
  targetNodeId,
  graph,
  paths,
}: {
  targetNodeId: string | null;
  graph: SupplyChainGraph;
  paths: Array<{ score: number; steps: Array<{ edgeId: string; from: string; to: string; score: number }> }>;
}) {
  if (!targetNodeId) {
    return <Placeholder text="Select an impacted company to reveal contributing paths" />;
  }

  return (
    <section style={sectionStyle}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>Contributing Paths</div>
      <div style={{ fontSize: 11, color: "#94a3b8" }}>for {targetNodeId}</div>
      {paths.length === 0 && (
        <div style={{ fontSize: 11, color: "#94a3b8" }}>No path evidence available.</div>
      )}
      {paths.slice(0, 3).map((path, idx) => (
        <div key={`path-${idx}`} style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: "#cbd5f5", marginBottom: 6 }}>Score {(path.score * 100).toFixed(0)}%</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {path.steps.map((step, stepIdx) => {
              const edge = graph?.edges.find((e) => e.id === step.edgeId);
              return (
                <div key={`${step.edgeId}-${stepIdx}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 12, color: "#e2e8f0" }}>{step.from}</span>
                  <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 999, background: "rgba(59,130,246,0.2)", color: "#bfdbfe" }}>
                    {edge?.kind ?? "link"}
                  </span>
                  <span style={{ fontSize: 12, color: "#e2e8f0" }}>{step.to}</span>
                </div>
              );
            })}
          </div>
          {path.steps.map((step) => {
            const edge = graph?.edges.find((e) => e.id === step.edgeId);
            if (!edge?.evidence?.length) return null;
            return edge.evidence.map((ev) => (
              <div key={ev.evidenceId} style={{ marginBottom: 8 }}>
                <EvidenceCard evidence={ev} showCopy />
              </div>
            ));
          })}
        </div>
      ))}
    </section>
  );
}

// RegionalExposurePanel is no longer used (replaced by GwmdPathsPanel)
/*
function RegionalExposurePanel({
  graph,
  simulation,
  selectedNode,
  selectedEdge,
  filters,
  onSelectRegion,
}: {
  graph: SupplyChainGraph;
  simulation: Props["simulation"];
  selectedNode: SupplyChainGraphNode | undefined;
  selectedEdge: SupplyChainGraphEdge | undefined;
  filters: Props["gwmdFilters"];
  onSelectRegion: (region: string) => void;
}) {
  const regionScores = useMemo(() => {
    const scores = new Map<string, { score: number; min?: number; max?: number }>();
    graph?.edges.forEach((edge) => {
      if (filters.relation !== "all" && edge.kind !== filters.relation) return;
      if (filters.showOnlyImpacted && !simulation.impactedEdgeIds?.includes(edge.id)) return;
      const fromNode = graph.nodes.find((n) => n.id === edge.from);
      const toNode = graph.nodes.find((n) => n.id === edge.to);
      if (!fromNode || !toNode) return;
      const fromRegion = resolveNodeRegion(fromNode);
      const toRegion = resolveNodeRegion(toNode);
      const weight = edge.weightRange ? (edge.weightRange.min + edge.weightRange.max) / 2 : (edge.weight ?? edge.criticality ?? 1);
      const contribution = weight * (edge.confidence ?? 0.6);
      [fromRegion, toRegion].forEach((region) => {
        if (filters.region !== "All" && region !== filters.region) return;
        const entry = scores.get(region) ?? { score: 0 };
        entry.score += contribution;
        scores.set(region, entry);
      });
    });
    return Array.from(scores.entries()).sort((a, b) => b[1].score - a[1].score);
  }, [graph, filters, simulation.impactedEdgeIds]);

  const regionImpacts = useMemo(() => {
    if (!simulation.impactScores) return [] as Array<[string, number]>;
    const map = new Map<string, number>();
    graph?.nodes.forEach((node) => {
      const score = simulation.impactScores?.[node.id] ?? 0;
      if (!score) return;
      const region = resolveNodeRegion(node);
      map.set(region, (map.get(region) ?? 0) + score);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [graph, simulation.impactScores]);

  const unlocated = useMemo(() => {
    return graph?.nodes.filter((node) => resolveNodeRegion(node) === "Unlocated") ?? [];
  }, [graph]);

  return (
    <>
      <section style={sectionStyle}>
        <div style={subheadingStyle}>Regional breakdown</div>
        {regionScores.length === 0 && <div style={{ fontSize: 11, color: "#94a3b8" }}>No exposure data.</div>}
        {regionScores.map(([region, entry]) => (
          <div key={region} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#e2e8f0", marginBottom: 6 }}>
            <span>{region}</span>
            <span>{entry.score.toFixed(2)}</span>
          </div>
        ))}
      </section>

      {regionImpacts.length > 0 && (
        <section style={sectionStyle}>
          <div style={subheadingStyle}>Top impacted regions</div>
          {regionImpacts.map(([region, score]) => (
            <div
              key={region}
              style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#e2e8f0", cursor: "pointer" }}
              onClick={() => onSelectRegion(region)}
            >
              <span>{region}</span>
              <span>{(score * 100).toFixed(0)}%</span>
            </div>
          ))}
        </section>
      )}

      <section style={sectionStyle}>
        <div style={subheadingStyle}>Evidence drilldown</div>
        {selectedEdge?.evidence?.length ? (
          selectedEdge.evidence.map((ev) => <EvidenceCard key={ev.evidenceId} evidence={ev} />)
        ) : selectedNode ? (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Selected {selectedNode.label}. Evidence appears on connected edges.</div>
        ) : (
          <div style={{ fontSize: 11, color: "#94a3b8" }}>Select a marker or arc for evidence.</div>
        )}
      </section>

      {unlocated.length > 0 && (
        <section style={sectionStyle}>
          <div style={subheadingStyle}>Unlocated</div>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>
            {unlocated.map((node) => node.label).join(" • ")}
          </div>
        </section>
      )}
    </>
  );
}
*/

function EvidenceCard({ evidence, showCopy }: { evidence: SupplyChainEvidence; showCopy?: boolean }) {
  const copyText = `${evidence.sourceKind} • ${evidence.docDate} • ${evidence.locationPointer}\n${evidence.snippet}`;
  return (
    <div style={{ padding: 10, borderRadius: 10, border: "1px solid rgba(148,163,184,0.12)", fontSize: 11, color: "#cbd5f5" }}>
      <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 4 }}>
        {evidence.sourceKind} • {evidence.docDate} • {evidence.locationPointer}
      </div>
      <div style={{ fontStyle: "italic" }}>{evidence.snippet}</div>
      {showCopy && (
        <button
          onClick={() => navigator.clipboard?.writeText(copyText)}
          style={{ marginTop: 6, fontSize: 10, border: "1px solid rgba(148,163,184,0.2)", borderRadius: 6, padding: "4px 6px", background: "transparent", color: "#94a3b8", cursor: "pointer" }}
        >
          Copy citation
        </button>
      )}
    </div>
  );
}

function buildNeighborsByKind(graph: SupplyChainGraph, nodeId: string) {
  const grouped: Record<string, string[]> = {};
  graph?.edges.forEach((edge) => {
    if (edge.from !== nodeId && edge.to !== nodeId) return;
    const neighborId = edge.from === nodeId ? edge.to : edge.from;
    const neighbor = graph.nodes.find((n) => n.id === neighborId)?.label ?? neighborId;
    const bucket = grouped[edge.kind] ?? [];
    if (!bucket.includes(neighbor)) bucket.push(neighbor);
    grouped[edge.kind] = bucket;
  });
  return grouped;
}

function formatWeight(edge: SupplyChainGraphEdge) {
  if (edge.weightRange) {
    return `${edge.weightRange.min.toFixed(2)}–${edge.weightRange.max.toFixed(2)}`;
  }
  if (typeof edge.weight === "number") return edge.weight.toFixed(2);
  return edge.criticality ? `${edge.criticality}/5` : "-";
}

function edgeMagnitude(edge: SupplyChainGraphEdge) {
  if (edge.weightRange) {
    return (edge.weightRange.min + edge.weightRange.max) / 2;
  }
  if (typeof edge.weight === "number") return edge.weight;
  return edge.criticality ?? 1;
}

const pillButtonStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "6px 14px",
  fontSize: 11,
  cursor: "pointer",
};

const resetButtonStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: 12,
  padding: "10px 14px",
  border: "1px solid rgba(148,163,184,0.4)",
  background: "transparent",
  color: "#e2e8f0",
  cursor: "pointer",
};
