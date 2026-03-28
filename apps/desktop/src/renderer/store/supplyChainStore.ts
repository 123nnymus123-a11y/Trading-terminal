/**
 * Supply Chain Store
 * Manages UI state for supply chain mind-map visualization
 */

import { create } from "zustand";
import type {
  MindMapData,
  SupplyChainGenerationOptions,
  SupplyChainGenerationResponse,
  SupplyChainGraph,
} from "@tc/shared/supplyChain";
import { runShockSimulation } from "@tc/shared/supplyChainSimulation";
import { ensureCanonicalStructures } from "@tc/shared/supplyChainGraph";

export type SupplyChainViewMode =
  | "hierarchy"
  | "flow"
  | "impact"
  | "radial"
  | "risk"
  | "shock"
  | "global";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const SUPPLY_CHAIN_REQUEST_TIMEOUT_MS = 45_000;
let latestGenerateRequestId = 0;

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(message));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function deriveShockParams(graph: SupplyChainGraph, nodeId: string) {
  const nodeEdges = graph.edges.filter(
    (edge) => edge.from === nodeId || edge.to === nodeId,
  );
  const degree = nodeEdges.length;
  const degreeByNode = new Map<string, number>();
  graph.nodes.forEach((node) => {
    const count = graph.edges.filter(
      (edge) => edge.from === node.id || edge.to === node.id,
    ).length;
    degreeByNode.set(node.id, count);
  });
  const maxDegree = Math.max(1, ...Array.from(degreeByNode.values()));
  const degreeRatio = degree / maxDegree;

  const avgWeight = nodeEdges.length
    ? nodeEdges.reduce(
        (sum, edge) =>
          sum +
          (typeof edge.weight === "number"
            ? edge.weight
            : (edge.criticality ?? 1)),
        0,
      ) / nodeEdges.length
    : 0;
  const weightNorm = clamp(Math.log1p(avgWeight) / 6, 0, 1);

  const maxEdges = Math.max(1, graph.nodes.length * (graph.nodes.length - 1));
  const density = clamp(graph.edges.length / maxEdges, 0, 1);

  const severity = clamp(
    0.35 + 0.45 * degreeRatio + 0.2 * weightNorm,
    0.2,
    0.95,
  );
  const damping = clamp(0.25 + 0.55 * density + 0.15 * weightNorm, 0.2, 0.9);

  return { severity, damping };
}

interface SupplyChainState {
  // Input state
  searchTicker: string;
  globalTickers: string[];

  // Loading & error states
  loading: boolean;
  error: string | null;

  // Data state
  mindMapData: MindMapData | null;
  fromCache: boolean;

  // UI state
  selectedCategory: string | null;
  selectedCompany: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  viewMode: SupplyChainViewMode;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactRanges?: Record<string, { min: number; max: number }>;
    impactedEdgeIds?: string[];
    rankedImpacts?: Array<{
      nodeId: string;
      score: number;
      minScore?: number;
      maxScore?: number;
    }>;
    params: {
      severity: number;
      damping: number;
      includeKinds?: SupplyChainGraph["edges"][number]["kind"][];
    };
  };
  strictMode: boolean;
  includeHypothesis: boolean;
  hops: number;
  minEdgeWeight: number;

  // Actions
  setSearchTicker: (ticker: string) => void;
  generate: () => Promise<void>;
  clearCache: () => Promise<void>;
  reset: () => void;
  setSelectedCategory: (categoryId: string | null) => void;
  setSelectedCompany: (companyId: string | null) => void;
  setViewMode: (mode: SupplyChainViewMode) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedEdge: (edgeId: string | null) => void;
  toggleNodeFailure: (nodeId: string) => void;
  toggleEdgeFailure: (edgeId: string) => void;
  setStrictMode: (value: boolean) => void;
  setIncludeHypothesis: (value: boolean) => void;
  setHops: (value: number) => void;
  setMinEdgeWeight: (value: number) => void;
  setShockSeverity: (value: number) => void;
  setShockDamping: (value: number) => void;
  setShockIncludeKinds: (
    kinds: SupplyChainGraph["edges"][number]["kind"][] | undefined,
  ) => void;
  seedShockParamsFromNode: (nodeId: string) => void;
  runShockSimulation: (nodeId: string) => void;
  resetSimulation: () => void;
  loadGlobalGraph: (tickers: string[]) => Promise<void>;
  openGlobalMap: () => Promise<void>;
}

export const useSupplyChainStore = create<SupplyChainState>((set, get) => ({
  // Initial state
  searchTicker: "",
  globalTickers: [],
  loading: false,
  error: null,
  mindMapData: null,
  fromCache: false,
  selectedCategory: null,
  selectedCompany: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  viewMode: "flow",
  simulation: {
    failedNodeIds: [],
    failedEdgeIds: [],
    params: {
      severity: 0.6,
      damping: 0.55,
    },
  },
  strictMode: true,
  includeHypothesis: false,
  hops: 2,
  minEdgeWeight: 0,

  // Actions
  setSearchTicker: (ticker: string) => {
    set({ searchTicker: ticker.toUpperCase(), error: null });
  },

  generate: async () => {
    const api = window.cockpit?.supplyChain;
    if (!api?.generate) {
      set({ error: "Supply Chain API not available" });
      return;
    }

    const ticker = get().searchTicker.trim();
    if (!ticker) {
      set({ error: "Please enter a ticker symbol" });
      return;
    }

    const requestId = ++latestGenerateRequestId;
    set({ loading: true, error: null });

    try {
      const baseOptions: SupplyChainGenerationOptions = {
        ticker,
        strictMode: get().strictMode,
        includeHypothesis: get().includeHypothesis,
        hops: get().hops,
        minEdgeWeight: get().minEdgeWeight,
        refresh: false,
      };
      const response = (await withTimeout(
        api.generate(baseOptions) as Promise<SupplyChainGenerationResponse>,
        SUPPLY_CHAIN_REQUEST_TIMEOUT_MS,
        "Supply chain request timed out",
      )) as SupplyChainGenerationResponse;

      if (requestId !== latestGenerateRequestId) {
        return;
      }

      if (response.success && response.data) {
        const hydrated = ensureCanonicalStructures(response.data);
        set({
          mindMapData: hydrated,
          fromCache: response.fromCache,
          loading: false,
          error: null,
          globalTickers: [ticker],
          selectedCategory: null,
          selectedCompany: null,
          selectedNodeId: null,
          selectedEdgeId: null,
          simulation: {
            failedNodeIds: [],
            failedEdgeIds: [],
            params: get().simulation.params,
          },
        });

        if (response.fromCache && response.needsRefresh) {
          api
            .generate({ ...baseOptions, refresh: true })
            .then((refreshResponse: SupplyChainGenerationResponse) => {
              if (requestId !== latestGenerateRequestId) {
                return;
              }
              if (refreshResponse.success && refreshResponse.data) {
                const refreshed = ensureCanonicalStructures(
                  refreshResponse.data,
                );
                set({ mindMapData: refreshed, fromCache: false });
              }
            })
            .catch((err: unknown) => {
              console.warn("[supplyChainStore] refresh error:", err);
            });
        }
      } else {
        set({
          loading: false,
          error: response.error || "Failed to generate supply chain map",
        });
      }
    } catch (err) {
      if (requestId !== latestGenerateRequestId) {
        return;
      }
      console.error("[supplyChainStore] generate error:", err);
      set({
        loading: false,
        error: String(err),
      });
    }
  },

  clearCache: async () => {
    const api = window.cockpit?.supplyChain;
    if (!api?.clearCache) return;

    const ticker = get().searchTicker.trim();
    if (!ticker) return;

    try {
      await api.clearCache(ticker);
      const globalKey =
        get().globalTickers.length > 1
          ? `GLOBAL:${get().globalTickers.join("|")}`
          : null;
      if (globalKey) {
        await api.clearCache(globalKey);
      }
      set({ mindMapData: null, fromCache: false });
    } catch (err) {
      console.error("[supplyChainStore] clearCache error:", err);
    }
  },

  reset: () => {
    set({
      searchTicker: "",
      globalTickers: [],
      loading: false,
      error: null,
      mindMapData: null,
      fromCache: false,
      selectedCategory: null,
      selectedCompany: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      viewMode: "flow",
      simulation: {
        failedNodeIds: [],
        failedEdgeIds: [],
        params: get().simulation.params,
      },
    });
  },

  setSelectedCategory: (categoryId: string | null) => {
    set({
      selectedCategory: categoryId,
      selectedCompany: null,
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  setSelectedCompany: (companyId: string | null) => {
    set({ selectedCompany: companyId, selectedNodeId: companyId });
  },

  setViewMode: (mode: SupplyChainViewMode) => {
    set({ viewMode: mode });
  },

  setSelectedNode: (nodeId: string | null) => {
    set({
      selectedNodeId: nodeId,
      selectedEdgeId: null,
      selectedCompany: nodeId,
    });
  },

  setSelectedEdge: (edgeId: string | null) => {
    set({ selectedEdgeId: edgeId, selectedNodeId: null });
  },

  toggleNodeFailure: (nodeId: string) => {
    set((state) => {
      const exists = state.simulation.failedNodeIds.includes(nodeId);
      const failedNodeIds = exists
        ? state.simulation.failedNodeIds.filter((id) => id !== nodeId)
        : [...state.simulation.failedNodeIds, nodeId];
      return { simulation: { ...state.simulation, failedNodeIds } };
    });
  },

  toggleEdgeFailure: (edgeId: string) => {
    set((state) => {
      const exists = state.simulation.failedEdgeIds.includes(edgeId);
      const failedEdgeIds = exists
        ? state.simulation.failedEdgeIds.filter((id) => id !== edgeId)
        : [...state.simulation.failedEdgeIds, edgeId];
      return { simulation: { ...state.simulation, failedEdgeIds } };
    });
  },

  setStrictMode: (value: boolean) => {
    set({ strictMode: value });
  },

  setIncludeHypothesis: (value: boolean) => {
    set({ includeHypothesis: value });
  },

  setHops: (value: number) => {
    set({ hops: value });
  },

  setMinEdgeWeight: (value: number) => {
    set({ minEdgeWeight: value });
  },

  setShockSeverity: (value: number) => {
    set((state) => ({
      simulation: {
        ...state.simulation,
        params: {
          ...state.simulation.params,
          severity: value,
        },
      },
    }));
  },

  setShockDamping: (value: number) => {
    set((state) => ({
      simulation: {
        ...state.simulation,
        params: {
          ...state.simulation.params,
          damping: value,
        },
      },
    }));
  },

  setShockIncludeKinds: (kinds) => {
    set((state) => ({
      simulation: {
        ...state.simulation,
        params: {
          ...state.simulation.params,
          includeKinds: kinds,
        },
      },
    }));
  },

  seedShockParamsFromNode: (nodeId: string) => {
    const state = get();
    const graph = state.mindMapData?.graph;
    if (!graph) return;
    const autoParams = deriveShockParams(graph, nodeId);
    set((state) => ({
      simulation: {
        ...state.simulation,
        params: {
          ...state.simulation.params,
          severity: autoParams.severity,
          damping: autoParams.damping,
        },
      },
    }));
  },

  runShockSimulation: (nodeId: string) => {
    const state = get();
    const graph = state.mindMapData?.graph;
    if (!graph) return;
    const params = state.simulation.params;
    const result = runShockSimulation(graph, [nodeId], {
      severity: params.severity,
      damping: params.damping,
      includeKinds: params.includeKinds,
    });
    const impactScores: Record<string, number> = {};
    const impactRanges: Record<string, { min: number; max: number }> = {};
    result.ranked.forEach((impact) => {
      impactScores[impact.nodeId] = impact.score;
      if (
        typeof impact.minScore === "number" &&
        typeof impact.maxScore === "number"
      ) {
        impactRanges[impact.nodeId] = {
          min: impact.minScore,
          max: impact.maxScore,
        };
      }
    });
    set((state) => ({
      simulation: {
        ...state.simulation,
        params,
        impactScores,
        impactRanges,
        impactedEdgeIds: result.impactedEdgeIds,
        rankedImpacts: result.ranked,
      },
    }));
  },

  resetSimulation: () => {
    set((state) => ({
      simulation: {
        failedNodeIds: [],
        failedEdgeIds: [],
        params: state.simulation.params,
      },
    }));
  },

  loadGlobalGraph: async (tickers: string[]) => {
    const api = window.cockpit?.supplyChain;
    if (!api?.generate) {
      set({ error: "Supply Chain API not available" });
      return;
    }
    const cleaned = Array.from(
      new Set(tickers.map((t) => t.trim().toUpperCase())),
    ).filter(Boolean);
    if (cleaned.length === 0) {
      set({ error: "No tickers provided" });
      return;
    }
    const requestId = ++latestGenerateRequestId;
    set({ loading: true, error: null });
    try {
      const baseOptions: SupplyChainGenerationOptions = {
        ticker: cleaned[0],
        globalTickers: cleaned,
        strictMode: get().strictMode,
        includeHypothesis: get().includeHypothesis,
        hops: get().hops,
        minEdgeWeight: get().minEdgeWeight,
        refresh: false,
      };
      const response = (await withTimeout(
        api.generate(baseOptions) as Promise<SupplyChainGenerationResponse>,
        SUPPLY_CHAIN_REQUEST_TIMEOUT_MS,
        "Global supply chain request timed out",
      )) as SupplyChainGenerationResponse;
      if (requestId !== latestGenerateRequestId) {
        return;
      }
      if (response.success && response.data) {
        const hydrated = ensureCanonicalStructures(response.data);
        set({
          mindMapData: hydrated,
          fromCache: response.fromCache,
          loading: false,
          error: null,
          globalTickers: cleaned,
          viewMode: "global",
          selectedCategory: null,
          selectedCompany: null,
          selectedNodeId: null,
          selectedEdgeId: null,
          simulation: {
            failedNodeIds: [],
            failedEdgeIds: [],
            params: get().simulation.params,
          },
        });
      } else {
        set({
          loading: false,
          error: response.error || "Failed to generate global graph",
        });
      }
    } catch (err) {
      if (requestId !== latestGenerateRequestId) {
        return;
      }
      set({ loading: false, error: String(err) });
    }
  },

  openGlobalMap: async () => {
    const tickers = get().globalTickers;
    if (tickers.length === 0) return;

    const api = window.cockpit?.supplyChain;
    if (!api?.openGlobalMap) return;
    await api.openGlobalMap(tickers);
  },
}));
