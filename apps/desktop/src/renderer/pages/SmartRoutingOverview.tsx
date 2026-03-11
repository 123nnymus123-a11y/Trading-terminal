import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiCredentialRecord, ApiKeyProvider } from "../../shared/apiHub";

type WorkflowSource = "apis" | "internet" | "agents";

type RoutingDestination = "marketDataLayer" | "aiBriefings" | "aiSteward" | "externalFeeds";

interface ProviderCategoryMeta {
  label: string;
  category: string;
  color: string;
  destinations: RoutingDestination[];
}

interface CategorySummary {
  category: string;
  color: string;
  count: number;
  providers: string[];
  destinations: RoutingDestination[];
}

interface DestinationSummary {
  id: RoutingDestination;
  label: string;
  description: string;
  icon: string;
  categories: string[];
  active: boolean;
}

interface TreeNode {
  id: string;
  label: string;
  description?: string;
  meta?: Record<string, string>;
  children?: TreeNode[];
}

const WORKFLOW_SOURCES: Array<{ id: WorkflowSource; label: string; description: string; icon: string; accent: string }> = [
  { id: "apis", label: "API Connectors", description: "Provider keys stored in the hub", icon: "🔌", accent: "#38bdf8" },
  { id: "internet", label: "Trusted Internet Feeds", description: "Regulatory drops, macro portals", icon: "🌐", accent: "#fbbf24" },
  { id: "agents", label: "AI + Agents", description: "Research + Steward automations", icon: "🤖", accent: "#a78bfa" },
];

const ROUTING_DESTINATIONS: Record<RoutingDestination, { label: string; description: string; icon: string }> = {
  marketDataLayer: { label: "Market Data Layer", description: "Charts, scanners, and live surfaces", icon: "📊" },
  aiBriefings: { label: "AI Briefings", description: "Research briefings, macro explainers", icon: "🧠" },
  aiSteward: { label: "AI Steward", description: "Compliance guardian + monitors", icon: "🛡️" },
  externalFeeds: { label: "External Feeds", description: "CFTC, SEC, BLS, supply chain modules", icon: "🚚" },
};

const DESTINATION_ACCENTS: Record<RoutingDestination, string> = {
  marketDataLayer: "#38bdf8",
  aiBriefings: "#a78bfa",
  aiSteward: "#34d399",
  externalFeeds: "#f97316",
};

const WORKFLOW_SOURCE_LOOKUP: Record<WorkflowSource, (typeof WORKFLOW_SOURCES)[number]> = WORKFLOW_SOURCES.reduce(
  (acc, source) => ({ ...acc, [source.id]: source }),
  {} as Record<WorkflowSource, (typeof WORKFLOW_SOURCES)[number]>
);

const PROVIDER_CATEGORY_META: Record<string, ProviderCategoryMeta> = {
  alpaca: { label: "Alpaca", category: "Brokerage Execution", color: "#38bdf8", destinations: ["marketDataLayer", "aiSteward"] },
  polygon: { label: "Polygon.io", category: "Market Data", color: "#fbbf24", destinations: ["marketDataLayer", "aiBriefings"] },
  finnhub: { label: "Finnhub", category: "Market Data", color: "#fbbf24", destinations: ["marketDataLayer", "aiBriefings"] },
  quiver: { label: "Quiver", category: "Alternative Data", color: "#f472b6", destinations: ["aiBriefings", "externalFeeds"] },
  "interactive-brokers": { label: "Interactive Brokers", category: "Brokerage Execution", color: "#c084fc", destinations: ["marketDataLayer", "aiSteward"] },
  coinbase: { label: "Coinbase Advanced", category: "Crypto Access", color: "#7dd3fc", destinations: ["marketDataLayer", "aiBriefings"] },
  bls: { label: "BLS JOLTS", category: "Government Data", color: "#34d399", destinations: ["externalFeeds", "aiBriefings"] },
  other: { label: "Custom Integration", category: "Custom", color: "#f97316", destinations: ["marketDataLayer", "externalFeeds"] },
};

const DEFAULT_PROVIDER_META: ProviderCategoryMeta = {
  label: "Custom Integration",
  category: "Custom",
  color: "#f97316",
  destinations: ["marketDataLayer", "externalFeeds"],
};

const STATIC_SOURCE_CATEGORIES: Record<Exclude<WorkflowSource, "apis">, Array<{ title: string; providers: string[]; destinations: RoutingDestination[] }>> = {
  internet: [
    { title: "Regulatory Data", providers: ["CFTC CoT", "SEC EDGAR", "BLS JOLTS"], destinations: ["externalFeeds", "aiSteward"] },
    { title: "Macro Releases", providers: ["FRED", "Treasury", "Bureau of Labor"], destinations: ["aiBriefings", "marketDataLayer"] },
  ],
  agents: [
    { title: "AI Research", providers: ["Briefing Engine", "Macro Explainers"], destinations: ["aiBriefings", "marketDataLayer"] },
    { title: "AI Steward", providers: ["Compliance Guardian", "Congress Watch"], destinations: ["aiSteward", "externalFeeds"] },
  ],
};

const TREE_GENERATION_DELAY_MS = 400;

function getProviderMeta(provider: string | ApiKeyProvider): ProviderCategoryMeta {
  return PROVIDER_CATEGORY_META[provider] ?? DEFAULT_PROVIDER_META;
}

function summarizeCategories(records: ApiCredentialRecord[]): CategorySummary[] {
  if (!records.length) return [];
  const map = new Map<string, { color: string; count: number; providers: Set<string>; destinations: Set<RoutingDestination> }>();
  records.forEach((record) => {
    const meta = getProviderMeta(record.provider);
    if (!map.has(meta.category)) {
      map.set(meta.category, {
        color: meta.color,
        count: 0,
        providers: new Set<string>(),
        destinations: new Set<RoutingDestination>(),
      });
    }
    const bucket = map.get(meta.category);
    if (!bucket) return;
    bucket.count += 1;
    bucket.providers.add(meta.label);
    meta.destinations.forEach((dest) => bucket.destinations.add(dest));
  });

  return Array.from(map.entries()).map(([category, bucket]) => ({
    category,
    color: bucket.color,
    count: bucket.count,
    providers: Array.from(bucket.providers).sort(),
    destinations: Array.from(bucket.destinations),
  }));
}

function summarizeDestinations(records: ApiCredentialRecord[]): DestinationSummary[] {
  const base = new Map<RoutingDestination, DestinationSummary>();
  (Object.entries(ROUTING_DESTINATIONS) as Array<[RoutingDestination, { label: string; description: string; icon: string }]>).forEach(([id, meta]) => {
    base.set(id, { id, label: meta.label, description: meta.description, icon: meta.icon, categories: [], active: false });
  });

  records.forEach((record) => {
    const meta = getProviderMeta(record.provider);
    meta.destinations.forEach((dest) => {
      const entry = base.get(dest);
      if (!entry) return;
      entry.active = true;
      if (!entry.categories.includes(meta.category)) {
        entry.categories.push(meta.category);
      }
    });
  });

  return Array.from(base.values()).map((entry) => ({
    ...entry,
    categories: entry.categories.sort(),
  }));
}

function buildRoutingTree(categories: CategorySummary[], workflowSources: Record<WorkflowSource, boolean>): TreeNode[] {
  const nodes: TreeNode[] = [];

  if (workflowSources.apis) {
    const sourceMeta = WORKFLOW_SOURCE_LOOKUP.apis;
    nodes.push({
      id: "source:apis",
      label: "API Connectors",
      description: "Keys stored in the secure hub",
      meta: { color: sourceMeta?.accent ?? "#38bdf8" },
      children: categories.map((category) => ({
        id: `category:${category.category}`,
        label: `${category.category} (${category.count})`,
        description: category.providers.join(", "),
        meta: { color: category.color },
        children: category.destinations.map((dest) => ({
          id: `dest:${dest}:${category.category}`,
          label: ROUTING_DESTINATIONS[dest]?.label ?? dest,
          description: ROUTING_DESTINATIONS[dest]?.description,
          meta: { target: dest, color: DESTINATION_ACCENTS[dest] },
        })),
      })),
    });
  }

    (Object.entries(STATIC_SOURCE_CATEGORIES) as Array<[
      Exclude<WorkflowSource, "apis">,
      Array<{ title: string; providers: string[]; destinations: RoutingDestination[] }>
    ]>).forEach(([sourceId, groups]) => {
    if (!workflowSources[sourceId]) return;
    const sourceMeta = WORKFLOW_SOURCE_LOOKUP[sourceId];
    nodes.push({
      id: `source:${sourceId}`,
      label: WORKFLOW_SOURCES.find((s) => s.id === sourceId)?.label ?? sourceId,
      description: WORKFLOW_SOURCES.find((s) => s.id === sourceId)?.description,
      meta: { color: sourceMeta?.accent ?? "#fbbf24" },
      children: groups.map((group) => ({
        id: `category:${sourceId}:${group.title}`,
        label: group.title,
        description: group.providers.join(", "),
        meta: { color: sourceMeta?.accent ?? "#fbbf24" },
        children: group.destinations.map((dest) => ({
          id: `dest:${sourceId}:${group.title}:${dest}`,
          label: ROUTING_DESTINATIONS[dest]?.label ?? dest,
          description: ROUTING_DESTINATIONS[dest]?.description,
          meta: { target: dest, color: DESTINATION_ACCENTS[dest] },
        })),
      })),
    });
  });

  return nodes;
}

const CONNECTOR_COLOR = "rgba(148,163,184,0.45)";
const DEFAULT_TREE_COLORS = ["#34d399", "#60a5fa", "#fbbf24", "#f472b6"];

function applyAlpha(color: string | undefined, alphaHex: string) {
  if (!color?.startsWith("#")) return color ?? "rgba(248,250,252,0.2)";
  if (color.length === 7) {
    return `${color}${alphaHex}`;
  }
  if (color.length === 4) {
    const [r, g, b] = [color[1], color[2], color[3]].map((v) => `${v}${v}`);
    return `#${r}${g}${b}${alphaHex}`;
  }
  return color;
}

function getNodePalette(level: number, node: TreeNode) {
  const fallback = DEFAULT_TREE_COLORS[level % DEFAULT_TREE_COLORS.length];
  const baseColor = (node.meta?.color as string | undefined) ?? fallback;
  const border = applyAlpha(baseColor, "aa");
  const glow = applyAlpha(baseColor, "33");
  const background = baseColor.startsWith("#")
    ? `linear-gradient(135deg, ${applyAlpha(baseColor, "22")}, rgba(15,23,42,0.95))`
    : "rgba(15,23,42,0.9)";
  return { border, glow, background };
}

const TreeBranch = ({ node, level }: { node: TreeNode; level: number }) => {
  const hasChildren = Boolean(node.children?.length);
  const palette = getNodePalette(level, node);
  const width = level === 0 ? 230 : level === 1 ? 200 : 180;

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "12px 8px", gap: 4 }}>
      <div
        style={{
          minWidth: width,
          maxWidth: 260,
          textAlign: "center",
          borderRadius: 14,
          padding: "14px 16px",
          border: `1px solid ${palette.border}`,
          background: palette.background,
          boxShadow: `0 12px 30px ${palette.glow}`,
        }}
      >
        <div style={{ fontWeight: 600 }}>{node.label}</div>
        {node.description && <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{node.description}</div>}
        {node.meta?.target && (
          <div style={{ fontSize: 11, opacity: 0.8, marginTop: 6 }}>Channel: {ROUTING_DESTINATIONS[node.meta.target as RoutingDestination]?.label}</div>
        )}
      </div>

      {hasChildren && (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div style={{ width: 2, height: 18, background: CONNECTOR_COLOR }} />
          <div
            style={{
              position: "relative",
              display: "inline-flex",
              gap: 32,
              alignItems: "flex-start",
              padding: "12px 18px 0 18px",
            }}
          >
            <div style={{ position: "absolute", top: 12, left: 18, right: 18, height: 2, background: CONNECTOR_COLOR }} />
            {node.children?.map((child) => (
              <div key={child.id} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ width: 2, height: 14, background: CONNECTOR_COLOR }} />
                <TreeBranch node={child} level={level + 1} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const TreeDiagram = ({ root }: { root: TreeNode }) => (
  <div style={{ overflowX: "auto", paddingBottom: 12 }}>
    <div style={{ minWidth: 720, display: "flex", justifyContent: "center" }}>
      <TreeBranch node={root} level={0} />
    </div>
  </div>
);

function formatTime(ts: number | null) {
  if (!ts) return "—";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "—";
  }
}

export default function SmartRoutingOverview() {
  const apiHub = window.cockpit?.apiHub;
  const [records, setRecords] = useState<ApiCredentialRecord[]>([]);
  const [workflowSources, setWorkflowSources] = useState<Record<WorkflowSource, boolean>>({ apis: true, internet: true, agents: true });
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<TreeNode[] | null>(null);
  const [treeGeneratedAt, setTreeGeneratedAt] = useState<number | null>(null);
  const [generatingTree, setGeneratingTree] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    if (!apiHub?.list) {
      setStatus("❌ API Hub service unavailable");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const snapshot = await apiHub.list();
      setRecords(snapshot?.records ?? []);
      setStatus(null);
    } catch (err) {
      console.error("[SmartRouting] failed to load apiHub snapshot", err);
      setStatus("❌ Unable to load credentials");
    } finally {
      setLoading(false);
    }
  }, [apiHub]);

  useEffect(() => {
    document.title = "Smart Routing Overview";
  }, []);

  useEffect(() => {
    let disposed = false;
    fetchSnapshot();
    const unsubscribe = apiHub?.onChanged?.((snapshot) => {
      if (!disposed) {
        setRecords(snapshot?.records ?? []);
      }
    });
    return () => {
      disposed = true;
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    };
  }, [apiHub, fetchSnapshot]);

  const categorySummary = useMemo(() => summarizeCategories(records), [records]);
  const destinationSummary = useMemo(() => summarizeDestinations(records), [records]);
  const activeSourceLabels = useMemo(() => WORKFLOW_SOURCES.filter((src) => workflowSources[src.id]).map((src) => src.label), [workflowSources]);
  const enableAllSelected = activeSourceLabels.length === WORKFLOW_SOURCES.length;
  const computedTree = useMemo(() => buildRoutingTree(categorySummary, workflowSources), [categorySummary, workflowSources]);
  const treeRoot = useMemo<TreeNode | null>(
    () =>
      treeData?.length
        ? {
            id: "root:smart-routing",
            label: "Smart Routing Flow",
            description: "Main goal: deliver every signal into the right cockpit surface",
            meta: { color: "#34d399" },
            children: treeData,
          }
        : null,
    [treeData]
  );

  const handleGenerateTree = useCallback(() => {
    setGeneratingTree(true);
    setTimeout(() => {
      setTreeData(computedTree);
      setTreeGeneratedAt(Date.now());
      setGeneratingTree(false);
      setStatus("✅ Tree diagram ready");
      setTimeout(() => setStatus(null), 2500);
    }, TREE_GENERATION_DELAY_MS);
  }, [computedTree]);

  const handleCopyTree = useCallback(async () => {
    if (!treeData) return;
    try {
      const payload = JSON.stringify({ generatedAt: treeGeneratedAt, sources: treeData }, null, 2);
      await navigator.clipboard?.writeText?.(payload);
      setStatus("📋 Tree JSON copied to clipboard");
      setTimeout(() => setStatus(null), 2500);
    } catch (err) {
      console.error("[SmartRouting] copy failed", err);
      setStatus("❌ Unable to copy tree data");
    }
  }, [treeData, treeGeneratedAt]);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const totalProviders = records.length;

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 32,
        background: "radial-gradient(circle at top left, #111827, #020617)",
        color: "#f8fafc",
        fontFamily: "'Space Grotesk', 'Segoe UI', sans-serif",
      }}
    >
      <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, letterSpacing: 2, textTransform: "uppercase", opacity: 0.65 }}>Routing Intelligence</div>
            <h1 style={{ margin: "4px 0" }}>Smart Routing Overview</h1>
            <div style={{ fontSize: 14, opacity: 0.75 }}>
              Visualize how credentials, internet feeds, and AI agents deliver data into each destination.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={fetchSnapshot} style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid rgba(59,130,246,0.4)", background: "rgba(30,64,175,0.3)", color: "#bfdbfe" }}>
              🔄 Refresh
            </button>
            <button
              onClick={handleGenerateTree}
              disabled={generatingTree || !computedTree.length}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid rgba(16,185,129,0.5)",
                background: generatingTree ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.3)",
                color: "#bbf7d0",
                cursor: generatingTree || !computedTree.length ? "not-allowed" : "pointer",
              }}
            >
              {generatingTree ? "⏳ Generating..." : "🌳 Generate Tree Diagram"}
            </button>
            <button
              onClick={handleCopyTree}
              disabled={!treeData}
              style={{
                padding: "8px 14px",
                borderRadius: 999,
                border: "1px solid rgba(147,197,253,0.4)",
                background: treeData ? "rgba(59,130,246,0.25)" : "rgba(59,130,246,0.1)",
                color: "#dbeafe",
                cursor: treeData ? "pointer" : "not-allowed",
              }}
            >
              📋 Copy Tree JSON
            </button>
            <button onClick={handleClose} style={{ padding: "8px 14px", borderRadius: 999, border: "1px solid rgba(248,113,113,0.4)", background: "rgba(248,113,113,0.15)", color: "#fecaca" }}>
              ✖ Close
            </button>
          </div>
        </header>

        <section style={{ display: "grid", gap: 18, border: "1px solid rgba(148,163,184,0.25)", borderRadius: 16, padding: 18, background: "rgba(15,23,42,0.65)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600 }}>Source Selection</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Active inputs: {activeSourceLabels.length ? activeSourceLabels.join(" • ") : "None"}</div>
            </div>
            <button
              onClick={() => setWorkflowSources({ apis: true, internet: true, agents: true })}
              disabled={enableAllSelected}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                border: "1px solid rgba(59,130,246,0.4)",
                background: enableAllSelected ? "rgba(255,255,255,0.05)" : "rgba(59,130,246,0.2)",
                color: "#c7d2fe",
                cursor: enableAllSelected ? "not-allowed" : "pointer",
              }}
            >
              Enable all sources
            </button>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {WORKFLOW_SOURCES.map((source) => {
              const checked = workflowSources[source.id];
              return (
                <label
                  key={source.id}
                  style={{
                    flex: "1 1 240px",
                    minWidth: 220,
                    borderRadius: 12,
                    border: checked ? `1px solid ${source.accent}` : "1px solid rgba(148,163,184,0.3)",
                    background: checked ? `${source.accent}22` : "rgba(15,23,42,0.4)",
                    padding: 14,
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setWorkflowSources((prev) => ({ ...prev, [source.id]: e.target.checked }))}
                    style={{ width: 18, height: 18, marginTop: 2 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                      <span>{source.icon}</span>
                      <span>{source.label}</span>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>{source.description}</div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <section style={{ display: "grid", gap: 16 }}>
          <div style={{ fontWeight: 600 }}>Category Breakdown</div>
          {categorySummary.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.75, border: "1px dashed rgba(148,163,184,0.4)", borderRadius: 12, padding: 16 }}>
              No API categories detected yet. Add keys in Settings → API Hub to light up this view.
            </div>
          )}
          {categorySummary.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {categorySummary.map((category) => (
                <div key={category.category} style={{ border: `1px solid ${category.color}55`, borderRadius: 12, padding: 14, background: "rgba(15,23,42,0.55)", display: "grid", gap: 6 }}>
                  <div style={{ fontWeight: 600, color: category.color }}>{category.category}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{category.count} credential(s)</div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Providers: {category.providers.join(", ")}</div>
                  <div style={{ fontSize: 11, opacity: 0.8 }}>Routes: {category.destinations.map((dest) => ROUTING_DESTINATIONS[dest]?.label ?? dest).join(" • ")}</div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={{ display: "grid", gap: 16 }}>
          <div style={{ fontWeight: 600 }}>Destination Readiness</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            {destinationSummary.map((destination) => (
              <div
                key={destination.id}
                style={{
                  borderRadius: 12,
                  border: destination.active ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(148,163,184,0.35)",
                  background: destination.active ? "rgba(34,197,94,0.08)" : "rgba(15,23,42,0.5)",
                  padding: 14,
                  display: "grid",
                  gap: 6,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                    <span>{destination.icon}</span>
                    <span>{destination.label}</span>
                  </div>
                  <div style={{ fontSize: 11, opacity: 0.7 }}>{destination.active ? "Ready" : "Waiting"}</div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{destination.description}</div>
                <div style={{ fontSize: 11, opacity: 0.75 }}>
                  {destination.categories.length ? `Powered by: ${destination.categories.join(" • ")}` : "No categories mapped yet"}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section style={{ border: "1px solid rgba(59,130,246,0.25)", borderRadius: 16, padding: 20, background: "rgba(15,23,42,0.65)", display: "grid", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 600 }}>Tree Diagram</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>Last generated: {formatTime(treeGeneratedAt)}</div>
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {totalProviders} stored credential{totalProviders === 1 ? "" : "s"} observed
            </div>
          </div>

          {!treeRoot && (
            <div style={{
              border: "1px dashed rgba(148,163,184,0.4)",
              borderRadius: 12,
              padding: 24,
              textAlign: "center",
              fontSize: 13,
              opacity: 0.8,
            }}>
              Click “Generate Tree Diagram” to render the full routing hierarchy.
            </div>
          )}

          {treeRoot && <TreeDiagram root={treeRoot} />}
        </section>

        {(status || loading) && (
          <div style={{
            padding: 12,
            borderRadius: 10,
            border: "1px solid rgba(148,163,184,0.4)",
            background: "rgba(15,23,42,0.6)",
            fontSize: 13,
          }}>
            {loading ? "Loading latest routing snapshot…" : status}
          </div>
        )}
      </div>
    </div>
  );
}
