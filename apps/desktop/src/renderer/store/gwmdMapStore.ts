/**
 * GWMD Map Store
 * Manages company relationships, graph visualization, and search state
 * Persists to SQLite and browser memory
 */

import { create } from "zustand";
import type { SupplyChainGraph } from "@tc/shared/supplyChain";
import type { CloudAiModelConfig } from "./settingsStore";
import { authRequest } from "../lib/apiClient";

const isGwmdDebugEnabled = () => {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return window.sessionStorage.getItem("gwmd:debug") === "1";
};

const gwmdDebugLog = (...args: unknown[]) => {
  if (!isGwmdDebugEnabled()) return;
  console.log(...args);
};

export interface GwmdCompany {
  ticker: string;
  name: string;
  hqLat?: number;
  hqLon?: number;
  hqCity?: string;
  hqCountry?: string;
  industry?: string;
  healthScore?: number;
  geoSource?: string;
  geoConfidence?: number;
}

type GwmdRunStatus = "idle" | "ok" | "degraded_cache" | "parse_fail" | "error";

type GwmdRawCompany = {
  ticker: string;
  name: string;
  confidence?: number;
  hq_lat?: number;
  hq_lon?: number;
  hq_city?: string;
  hq_country?: string;
  hqLat?: number;
  hqLon?: number;
  hqCity?: string;
  hqCountry?: string;
  industry?: string;
  geo_source?: string;
  geoSource?: string;
  geo_confidence?: number;
  geoConfidence?: number;
};

type GwmdSearchResult = {
  success: boolean;
  status?: "ok" | "degraded_cache" | "parse_fail" | "error";
  companies?: GwmdRawCompany[];
  edges?: SupplyChainGraph["edges"];
  meta?: Record<string, unknown>;
  error?: string;
};

type GwmdLoadAllResult = {
  success: boolean;
  status?: "ok" | "error";
  companies?: Array<Record<string, unknown>>;
  graph?: { nodes: SupplyChainGraph["nodes"]; edges: SupplyChainGraph["edges"] } | null;
  meta?: { unlocatedCount?: number };
  error?: string;
};

const toNumber = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const toString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const normalizeTicker = (value: string) => value.trim().toUpperCase();
const semanticEdgeKey = (edge: { from: string; to: string; kind: string }) => `${normalizeTicker(edge.from)}|${normalizeTicker(edge.to)}|${edge.kind.toLowerCase()}`;

const normalizeGwmdCompany = (value: Record<string, unknown>): GwmdCompany | null => {
  const ticker = toString(value.ticker);
  const name = toString(value.name);
  if (!ticker || !name) return null;

  const hqLat = toNumber(value.hqLat) ?? toNumber(value.hq_lat);
  const hqLon = toNumber(value.hqLon) ?? toNumber(value.hq_lon);
  const hqCity = toString(value.hqCity) ?? toString(value.hq_city);
  const hqCountry = toString(value.hqCountry) ?? toString(value.hq_country);
  const industry = toString(value.industry);
  const healthScore = toNumber(value.healthScore) ?? toNumber(value.health_score);
  const geoSource = toString(value.geoSource) ?? toString(value.geo_source);
  const geoConfidence = toNumber(value.geoConfidence) ?? toNumber(value.geo_confidence);

  return {
    ticker: normalizeTicker(ticker),
    name,
    ...(hqLat !== undefined ? { hqLat } : {}),
    ...(hqLon !== undefined ? { hqLon } : {}),
    ...(hqCity ? { hqCity } : {}),
    ...(hqCountry ? { hqCountry } : {}),
    ...(industry ? { industry } : {}),
    ...(healthScore !== undefined ? { healthScore } : {}),
    ...(geoSource ? { geoSource } : {}),
    ...(geoConfidence !== undefined ? { geoConfidence } : {}),
  };
};

export interface GwmdMapState {
  // Search and loading
  searchTicker: string | null;
  loading: boolean;
  error: string | null;
  runStatus: GwmdRunStatus;
  runMeta: Record<string, unknown> | null;

  // Data
  graph: { nodes: SupplyChainGraph["nodes"]; edges: SupplyChainGraph["edges"] } | null;
  companies: GwmdCompany[];

  // UI state
  showEmpty: boolean;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  gwmdFilters: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
  };

  // Actions
  setSearchTicker: (ticker: string | null) => void;
  setLoading: (value: boolean) => void;
  setError: (error: string | null) => void;
  setGraph: (graph: { nodes: SupplyChainGraph["nodes"]; edges: SupplyChainGraph["edges"] } | null) => void;
  setCompanies: (companies: GwmdCompany[]) => void;
  addCompanies: (companies: GwmdCompany[]) => void;
  addEdges: (edges: SupplyChainGraph["edges"]) => void;
  setShowEmpty: (value: boolean) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedEdge: (edgeId: string | null) => void;
  setGwmdFilters: (filters: { region: string; relation: string; showFlows: boolean; showOnlyImpacted: boolean }) => void;

  // Complex actions
  search: (ticker: string, options: { model: CloudAiModelConfig | null }) => Promise<void>;
  reset: () => void;
  clearPersisted: () => Promise<void>;
  loadFromDb: () => Promise<void>;
}

export const useGwmdMapStore = create<GwmdMapState>((set, get) => ({
  searchTicker: null,
  loading: false,
  error: null,
  runStatus: "idle",
  runMeta: null,
  graph: null,
  companies: [],
  showEmpty: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  gwmdFilters: {
    region: "All",
    relation: "all",
    showFlows: true,
    showOnlyImpacted: false,
  },

  setSearchTicker: (ticker) => set({ searchTicker: ticker }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setGraph: (graph) => set({ graph }),
  setCompanies: (companies) => set({ companies }),
  addCompanies: (newCompanies) => {
    const current = get().companies;
    const map = new Map(current.map((c) => [normalizeTicker(c.ticker), { ...c, ticker: normalizeTicker(c.ticker) }]));
    newCompanies.forEach((c) => map.set(normalizeTicker(c.ticker), { ...c, ticker: normalizeTicker(c.ticker) }));
    set({ companies: Array.from(map.values()) });
  },
  addEdges: (newEdges) => {
    const currentGraph = get().graph;
    if (!currentGraph) {
      const normalized = newEdges.map((edge) => ({
        ...edge,
        from: normalizeTicker(edge.from),
        to: normalizeTicker(edge.to),
      }));
      const map = new Map<string, SupplyChainGraph["edges"][number]>();
      normalized.forEach((edge) => map.set(semanticEdgeKey({ from: edge.from, to: edge.to, kind: edge.kind }), edge));
      set({ graph: { nodes: [], edges: Array.from(map.values()) } });
      return;
    }

    const edgeMap = new Map(
      currentGraph.edges.map((edge) => [semanticEdgeKey({ from: edge.from, to: edge.to, kind: edge.kind }), {
        ...edge,
        from: normalizeTicker(edge.from),
        to: normalizeTicker(edge.to),
      }])
    );
    newEdges.forEach((edge) => {
      const normalized = {
        ...edge,
        from: normalizeTicker(edge.from),
        to: normalizeTicker(edge.to),
      };
      edgeMap.set(semanticEdgeKey({ from: normalized.from, to: normalized.to, kind: normalized.kind }), normalized);
    });
    currentGraph.edges = Array.from(edgeMap.values());

    set({ graph: { ...currentGraph } });
  },
  setShowEmpty: (showEmpty) => set({ showEmpty }),
  setSelectedNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  setSelectedEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),
  setGwmdFilters: (gwmdFilters) => set({ gwmdFilters }),

  search: async (ticker: string, options: { model: CloudAiModelConfig | null }) => {
    const { setSearchTicker, setLoading, setError, addCompanies, addEdges } = get();

    try {
      setSearchTicker(ticker);
      setLoading(true);
      setError(null);

      gwmdDebugLog(`[gwmdMapStore] Searching for ${ticker}...`);

      // Call backend to generate relationships
      const gwmdSearch = window.cockpit?.gwmdMap?.search;
      let result: GwmdSearchResult;

      if (gwmdSearch) {
        result = (await gwmdSearch(ticker, {
          model: options.model,
        })) as GwmdSearchResult;
      } else {
        // Web/browser mode: call backend REST API directly
        gwmdDebugLog(`[gwmdMapStore] IPC unavailable, using HTTP fallback`);
        const backendRes = await authRequest<{
          ok: boolean;
          data?: {
            ticker: string;
            nodes: Array<{ id: string; label: string; type: string }>;
            edges: Array<{ source: string; target: string; type: string; weight: number }>;
            insights: string[];
          };
          error?: string;
        }>('/api/ai/supplychain/generate', {
          method: 'POST',
          body: JSON.stringify({
            ticker,
            model: options.model?.model ?? undefined,
          }),
        });

        if (!backendRes.ok || !backendRes.data) {
          result = { success: false, error: backendRes.error || 'Backend supply chain generation failed', companies: [], edges: [] };
        } else {
          const d = backendRes.data;
          result = {
            success: true,
            status: 'ok',
            companies: d.nodes.map((n) => ({
              ticker: n.id,
              name: n.label,
            })),
            edges: d.edges.map((e) => ({
              from: e.source,
              to: e.target,
              kind: e.type as 'supplier' | 'customer' | 'partner' | 'competitor',
              weight: e.weight,
              confidence: e.weight,
              evidence: '',
            })) as any,
            meta: { status: 'ok' as const, source: 'fresh' as const, degraded: false, unlocatedCount: 0, hypothesisRatio: 0, primaryRelationshipCount: d.edges.length, hop2SeedCount: 0 },
          };
        }
      }

      set({
        runStatus: result.status ?? (result.success ? "ok" : "error"),
        runMeta: result.meta ?? null,
      });

      gwmdDebugLog("[gwmdMapStore] Search result:", result);

      if (!result.success) {
        throw new Error(result.error || "Search failed");
      }

      gwmdDebugLog(`[gwmdMapStore] Found ${result.companies?.length || 0} companies, ${result.edges?.length || 0} edges`);

      // Extract companies from result and add to store
      if (result.companies && result.companies.length > 0) {
        addCompanies(result.companies);
      }

      // Add edges if available
      if (result.edges && result.edges.length > 0) {
        addEdges(result.edges);
      }

      // Ensure graph is initialized or merged
      const currentGraph = get().graph;
      if (!currentGraph) {
        set({
          graph: {
            nodes: (result.companies || []).map((c: GwmdRawCompany) => ({
              id: normalizeTicker(c.ticker),
              label: c.name,
              tickers: [normalizeTicker(c.ticker)],
              entityType: "company" as const,
              tier: "direct" as const,
              confidence: c.confidence || 1.0,
              metadata: {
                hqLat: c.hq_lat ?? c.hqLat,
                hqLon: c.hq_lon ?? c.hqLon,
                hqCity: c.hq_city || c.hqCity,
                hqCountry: c.hq_country || c.hqCountry,
                industry: c.industry,
                geoSource: c.geo_source || c.geoSource,
                geoConfidence: c.geo_confidence ?? c.geoConfidence,
              },
            })),
            edges: result.edges || [],
          },
        });
      } else {
        // Merge new nodes into existing graph
        const nodeMap = new Map(
          currentGraph.nodes.map((n) => {
            const normalizedId = normalizeTicker(n.id);
            return [
              normalizedId,
              {
                ...n,
                id: normalizedId,
                ...(Array.isArray(n.tickers) ? { tickers: n.tickers.map(normalizeTicker) } : {}),
              },
            ] as const;
          })
        );
        (result.companies || []).forEach((c: GwmdRawCompany) => {
          const ticker = normalizeTicker(c.ticker);
          if (!nodeMap.has(ticker)) {
            nodeMap.set(ticker, {
              id: ticker,
              label: c.name,
              tickers: [ticker],
              entityType: "company" as const,
              tier: "direct" as const,
              confidence: c.confidence || 1.0,
              metadata: {
                hqLat: c.hq_lat ?? c.hqLat,
                hqLon: c.hq_lon ?? c.hqLon,
                hqCity: c.hq_city || c.hqCity,
                hqCountry: c.hq_country || c.hqCountry,
                industry: c.industry,
                geoSource: c.geo_source || c.geoSource,
                geoConfidence: c.geo_confidence ?? c.geoConfidence,
              },
            });
          } else {
            const existing = nodeMap.get(ticker);
            if (!existing) return;
            nodeMap.set(ticker, {
              ...existing,
              label: existing.label || c.name,
              metadata: {
                ...(existing.metadata || {}),
                hqLat: (existing.metadata as { hqLat?: number } | undefined)?.hqLat ?? c.hq_lat ?? c.hqLat,
                hqLon: (existing.metadata as { hqLon?: number } | undefined)?.hqLon ?? c.hq_lon ?? c.hqLon,
                hqCity: (existing.metadata as { hqCity?: string } | undefined)?.hqCity ?? c.hq_city ?? c.hqCity,
                hqCountry: (existing.metadata as { hqCountry?: string } | undefined)?.hqCountry ?? c.hq_country ?? c.hqCountry,
                industry: (existing.metadata as { industry?: string } | undefined)?.industry ?? c.industry,
                geoSource: (existing.metadata as { geoSource?: string } | undefined)?.geoSource ?? c.geo_source ?? c.geoSource,
                geoConfidence: (existing.metadata as { geoConfidence?: number } | undefined)?.geoConfidence ?? c.geo_confidence ?? c.geoConfidence,
              },
            });
          }
        });

        set({
          graph: {
            nodes: Array.from(nodeMap.values()),
            edges: currentGraph.edges,
          },
        });
      }

      set({ showEmpty: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const currentStatus = get().runStatus;
      set({
        error: message,
        runStatus: currentStatus === "idle" || currentStatus === "ok" ? "error" : currentStatus,
      });
      console.error("[gwmdMapStore] search error:", err);
    } finally {
      setLoading(false);
    }
  },

  reset: () => {
    set({
      searchTicker: null,
      graph: null,
      companies: [],
      selectedNodeId: null,
      selectedEdgeId: null,
      error: null,
      runStatus: "idle",
      runMeta: null,
      showEmpty: false,
    });
  },

  clearPersisted: async () => {
    try {
      set({ loading: true, error: null });
      const clear = window.cockpit?.gwmdMap?.clear;
      if (clear) {
        const result = await clear();
        if (!result?.success) {
          throw new Error(result?.error || "Failed to clear stored GWMD data");
        }
      }
      // In web mode (no IPC), just reset local state
      get().reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message });
      throw err;
    } finally {
      set({ loading: false });
    }
  },

  loadFromDb: async () => {
    try {
      if (!window.cockpit?.gwmdMap?.loadAll) {
        gwmdDebugLog("[gwmdMapStore] gwmdMap.loadAll not available (web mode)");
        // In web mode, data is not persisted locally — nothing to load
        return;
      }

      gwmdDebugLog("[gwmdMapStore] Loading data from DB...");
      const loadAll = window.cockpit.gwmdMap.loadAll as () => Promise<GwmdLoadAllResult>;
      const result = await loadAll();
      
      if (result.success) {
        gwmdDebugLog(`[gwmdMapStore] Loaded ${result.companies?.length || 0} companies from DB`);
        const companies = (result.companies || [])
          .map((raw) => normalizeGwmdCompany(raw))
          .filter((company): company is GwmdCompany => company !== null);
        set({
          companies,
          graph: result.graph || null,
          runStatus: "ok",
          runMeta: (result.meta as Record<string, unknown> | undefined) ?? null,
        });
      } else {
        console.error("[gwmdMapStore] Failed to load from DB:", result.error);
        set({ runStatus: "error" });
      }
    } catch (err) {
      console.error("[gwmdMapStore] loadFromDb error:", err);
      set({ runStatus: "error" });
    }
  },
}));
