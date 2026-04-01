import { create } from "zustand";
import type { SupplyChainGraph } from "@tc/shared/supplyChain";
import { ensureCanonicalStructures } from "@tc/shared/supplyChainGraph";
import {
  findTopDependencyPaths,
  runShockSimulation,
} from "@tc/shared/supplyChainSimulation";
import {
  composeExposureBrief,
  type ExposureBrief,
  type ExposureBriefDependencyPath,
  type ExposureBriefNodeEnrichment,
  type ExposureBriefRiskSignal,
  type ExposureBriefSource,
} from "@tc/shared/exposureBrief";
import { useGwmdMapStore } from "./gwmdMapStore";
import { useSupplyChainStore } from "./supplyChainStore";

interface GenerateBriefInput {
  source: ExposureBriefSource;
  shockNodeIds?: string[];
  severity?: number;
  damping?: number;
  limit?: number;
}

interface ExposureBriefState {
  status: "idle" | "loading" | "ready" | "error";
  phase:
    | "idle"
    | "loading_graph"
    | "simulating"
    | "enriching"
    | "scoring"
    | "ready";
  brief: ExposureBrief | null;
  error: string | null;
  setIdle: () => void;
  generateBrief: (input: GenerateBriefInput) => Promise<void>;
}

const toError = (value: unknown) =>
  value instanceof Error ? value.message : String(value);

const isSupplyChainGraph = (value: unknown): value is SupplyChainGraph => {
  if (!value || typeof value !== "object") return false;
  const graph = value as { nodes?: unknown; edges?: unknown };
  return Array.isArray(graph.nodes) && Array.isArray(graph.edges);
};

const getGraphForSource = (
  source: ExposureBriefSource,
): SupplyChainGraph | null => {
  if (source === "gwmd") {
    const graph = useGwmdMapStore.getState().graph;
    if (!graph || !isSupplyChainGraph(graph)) return null;
    return (
      ensureCanonicalStructures({
        centerTicker: "GWMD",
        centerName: "GWMD",
        generatedAt: new Date().toISOString(),
        categories: [],
        graph,
      }).graph ?? graph
    );
  }

  const graph = useSupplyChainStore.getState().mindMapData?.graph;
  if (!graph || !isSupplyChainGraph(graph)) return null;
  return (
    ensureCanonicalStructures({
      centerTicker: "SC",
      centerName: "Supply Chain",
      generatedAt: new Date().toISOString(),
      categories: [],
      graph,
    }).graph ?? graph
  );
};

const getDefaultShockNodes = (
  source: ExposureBriefSource,
  graph: SupplyChainGraph,
): string[] => {
  const preferred =
    source === "gwmd"
      ? useGwmdMapStore.getState().selectedNodeId
      : useSupplyChainStore.getState().selectedNodeId;

  if (preferred && graph.nodes.some((node) => node.id === preferred)) {
    return [preferred];
  }

  return graph.nodes.length > 0 ? [graph.nodes[0]!.id] : [];
};

const normalizeNodeKey = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
};

const toFreshnessDays = (value: unknown): number | undefined => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return undefined;
  const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  if (!Number.isFinite(days)) return undefined;
  return Math.max(0, days);
};

const buildDependencyPaths = (
  graph: SupplyChainGraph,
  shockNodeIds: string[],
  rankedTargetRows: Array<{ nodeId: string }>,
): ExposureBriefDependencyPath[] => {
  const byNodeId = new Map(graph.nodes.map((node) => [node.id, node]));
  const results: ExposureBriefDependencyPath[] = [];

  const targetIds = rankedTargetRows
    .map((row) => row.nodeId)
    .filter((id) => !shockNodeIds.includes(id))
    .slice(0, 10);

  shockNodeIds.forEach((sourceId) => {
    targetIds.forEach((targetId) => {
      const top = findTopDependencyPaths(graph, sourceId, targetId, 1, 4)[0];
      if (!top || top.steps.length === 0) return;
      const target = byNodeId.get(targetId);
      results.push({
        sourceNodeId: sourceId,
        targetNodeId: targetId,
        targetName: target?.label || targetId,
        score: top.score,
        steps: top.steps,
      });
    });
  });

  return results.sort((a, b) => b.score - a.score).slice(0, 8);
};

const buildRiskSignals = (
  graph: SupplyChainGraph,
  briefItems: ExposureBrief["items"],
): ExposureBriefRiskSignal[] => {
  const byNodeId = new Map(graph.nodes.map((node) => [node.id, node]));

  return briefItems.slice(0, 8).map((item) => {
    const node = byNodeId.get(item.nodeId);
    const reasons: string[] = [];

    if (item.attentionGapScore >= 0.45) {
      reasons.push("High attention gap");
    }
    if (item.zone === "candidate") {
      reasons.push("Candidate-zone dependency");
    }
    if (typeof node?.healthScore === "number" && node.healthScore < 55) {
      reasons.push(`Low health score (${Math.round(node.healthScore)})`);
    }
    if (typeof item.freshnessDays === "number" && item.freshnessDays >= 45) {
      reasons.push(`Stale enrichment (${Math.round(item.freshnessDays)}d)`);
    }
    if (item.evidenceCount <= 1) {
      reasons.push("Sparse evidence");
    }
    if (reasons.length === 0) {
      reasons.push("Elevated propagation impact");
    }

    const weighted =
      item.compositeScore * 0.55 +
      item.attentionGapScore * 0.25 +
      (1 - item.confidence) * 0.2;

    const severity: ExposureBriefRiskSignal["severity"] =
      weighted >= 0.7 ? "high" : weighted >= 0.45 ? "medium" : "low";

    return {
      nodeId: item.nodeId,
      name: item.name,
      severity,
      score: Math.max(0, Math.min(1, weighted)),
      reasons,
    };
  });
};

const buildEnrichmentByNode = async (
  graph: SupplyChainGraph,
  shockNodeIds: string[],
): Promise<Record<string, ExposureBriefNodeEnrichment>> => {
  const api = window.cockpit?.supplyChain?.getEnrichmentCachedSubgraph;
  if (!api || graph.nodes.length === 0) return {};

  const focusNode =
    graph.nodes.find((node) => shockNodeIds.includes(node.id)) ??
    graph.nodes[0];
  if (!focusNode) return {};

  const query =
    (typeof focusNode.label === "string" && focusNode.label.trim().length > 0
      ? focusNode.label
      : focusNode.id) ?? focusNode.id;

  try {
    const response = await api({ query, hops: 2 });
    if (!response?.success || !response.data) return {};

    const entities = Array.isArray(response.data.entities)
      ? response.data.entities
      : [];

    const byKey = new Map<string, ExposureBriefNodeEnrichment>();

    entities.forEach((entity) => {
      const row = entity as Record<string, unknown>;
      const confidence =
        typeof row.confidence_score === "number"
          ? row.confidence_score
          : typeof row.confidenceScore === "number"
            ? row.confidenceScore
            : undefined;

      const rawZone =
        typeof row.zone === "string"
          ? row.zone
          : typeof row.data_status === "string"
            ? row.data_status
            : typeof row.dataStatus === "string"
              ? row.dataStatus
              : "";
      const zone =
        rawZone === "production" ||
        rawZone === "validation" ||
        rawZone === "candidate"
          ? rawZone
          : undefined;

      const evidenceCount =
        typeof row.evidence_count === "number"
          ? row.evidence_count
          : typeof row.evidenceCount === "number"
            ? row.evidenceCount
            : 0;

      const freshnessDays =
        typeof row.freshness_days === "number"
          ? row.freshness_days
          : typeof row.freshnessDays === "number"
            ? row.freshnessDays
            : (toFreshnessDays(row.last_seen_at) ??
              toFreshnessDays(row.lastSeenAt) ??
              toFreshnessDays(row.updated_at) ??
              toFreshnessDays(row.updatedAt));

      const keys = [
        normalizeNodeKey(row.id),
        normalizeNodeKey(row.canonical_name),
        normalizeNodeKey(row.canonicalName),
      ].filter((value): value is string => Boolean(value));

      keys.forEach((key) => {
        const current = byKey.get(key) ?? {};
        const existingFreshness =
          typeof current.freshnessDays === "number"
            ? current.freshnessDays
            : undefined;
        const mergedFreshness =
          typeof freshnessDays === "number"
            ? typeof existingFreshness === "number"
              ? Math.min(existingFreshness, freshnessDays)
              : freshnessDays
            : existingFreshness;

        byKey.set(key, {
          confidence:
            typeof confidence === "number" ? confidence : current.confidence,
          zone: zone ?? current.zone,
          evidenceCount: Math.max(evidenceCount, current.evidenceCount ?? 0),
          freshnessDays: mergedFreshness,
        });
      });
    });

    const mapped: Record<string, ExposureBriefNodeEnrichment> = {};
    graph.nodes.forEach((node) => {
      const keys = [
        normalizeNodeKey(node.id),
        normalizeNodeKey(node.label),
        ...(Array.isArray(node.tickers)
          ? node.tickers
              .map((ticker) => normalizeNodeKey(ticker))
              .filter((value): value is string => Boolean(value))
          : []),
      ];

      for (const key of keys) {
        const hit = byKey.get(key);
        if (hit) {
          mapped[node.id] = hit;
          break;
        }
      }
    });

    return mapped;
  } catch {
    return {};
  }
};

export const useExposureBriefStore = create<ExposureBriefState>((set) => ({
  status: "idle",
  phase: "idle",
  brief: null,
  error: null,

  setIdle: () => {
    set({
      status: "idle",
      phase: "idle",
      error: null,
    });
  },

  generateBrief: async (input) => {
    const source = input.source;
    set({
      status: "loading",
      phase: "loading_graph",
      error: null,
    });

    try {
      const graph = getGraphForSource(source);
      if (!graph || graph.nodes.length === 0) {
        throw new Error("No graph is loaded for the selected source.");
      }

      const shockNodeIdsRaw =
        input.shockNodeIds && input.shockNodeIds.length > 0
          ? input.shockNodeIds
          : getDefaultShockNodes(source, graph);

      const shockNodeIds = shockNodeIdsRaw.filter((nodeId) =>
        graph.nodes.some((node) => node.id === nodeId),
      );

      if (shockNodeIds.length === 0) {
        throw new Error("Select at least one node to simulate a shock.");
      }

      const params = {
        severity: typeof input.severity === "number" ? input.severity : 0.6,
        damping: typeof input.damping === "number" ? input.damping : 0.55,
      };

      set({ phase: "simulating" });
      const simulationResult = runShockSimulation(graph, shockNodeIds, params);

      set({ phase: "enriching" });
      const enrichmentByNode = await buildEnrichmentByNode(graph, shockNodeIds);

      set({ phase: "scoring" });
      const dependencyPaths = buildDependencyPaths(
        graph,
        shockNodeIds,
        simulationResult.ranked,
      );
      const baseBrief = composeExposureBrief({
        source,
        graph,
        simulationResult,
        params,
        shockNodeIds,
        enrichmentByNode,
        dependencyPaths,
        limit: input.limit ?? 15,
      });

      const brief: ExposureBrief = {
        ...baseBrief,
        riskSignals: buildRiskSignals(graph, baseBrief.items),
      };

      set({
        status: "ready",
        phase: "ready",
        brief,
        error: null,
      });
    } catch (error) {
      set({
        status: "error",
        phase: "idle",
        error: toError(error),
      });
    }
  },
}));
