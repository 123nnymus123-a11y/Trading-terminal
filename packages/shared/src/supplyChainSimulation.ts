import type { SupplyChainGraph, SupplyChainGraphEdge } from "./supplyChain";

export interface ShockSimulationParams {
  severity: number; // 0..1
  damping: number; // 0..1
  maxSteps?: number;
  includeKinds?: SupplyChainGraphEdge["kind"][];
}

export interface ShockImpactResult {
  nodeId: string;
  score: number;
  minScore?: number;
  maxScore?: number;
  topPaths?: ShockPath[];
}

export interface ShockPathStep {
  edgeId: string;
  from: string;
  to: string;
  score: number;
}

export interface ShockPath {
  score: number;
  steps: ShockPathStep[];
}

export interface ShockSimulationResult {
  impacts: Record<string, ShockImpactResult>;
  ranked: ShockImpactResult[];
  impactedEdgeIds: string[];
}

function normalizeEdgeWeight(edge: SupplyChainGraphEdge): number {
  if (edge.weightRange) {
    const mid = (edge.weightRange.min + edge.weightRange.max) / 2;
    return clampWeight(mid, edge.criticality);
  }
  if (typeof edge.weight === "number") {
    return clampWeight(edge.weight, edge.criticality);
  }
  if (typeof edge.criticality === "number") {
    return Math.min(1, Math.max(0.2, edge.criticality / 5));
  }
  return 0.2;
}

function clampWeight(raw: number, criticality?: number): number {
  if (raw <= 1) return Math.min(1, Math.max(0, raw));
  if (raw > 1) {
    const normalized = Math.min(1, raw / 1_000_000_000);
    if (normalized > 0) return normalized;
  }
  if (typeof criticality === "number") {
    return Math.min(1, Math.max(0.2, criticality / 5));
  }
  return 0.25;
}

function buildAdjacency(graph: SupplyChainGraph, includeKinds?: SupplyChainGraphEdge["kind"][]) {
  const edges = includeKinds && includeKinds.length > 0
    ? graph.edges.filter((edge) => includeKinds.includes(edge.kind))
    : graph.edges;

  const adjacency = new Map<string, Array<{ edge: SupplyChainGraphEdge; weight: number }>>();
  const reverseAdjacency = new Map<string, Array<{ edge: SupplyChainGraphEdge; weight: number }>>();

  edges.forEach((edge) => {
    const weight = normalizeEdgeWeight(edge) * Math.max(0.1, edge.confidence ?? 0.7);
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!reverseAdjacency.has(edge.to)) reverseAdjacency.set(edge.to, []);
    adjacency.get(edge.from)!.push({ edge, weight });
    reverseAdjacency.get(edge.to)!.push({ edge, weight });
  });

  return { adjacency, reverseAdjacency, edges };
}

function simulate(graph: SupplyChainGraph, failedNodeIds: string[], params: ShockSimulationParams, weightOverride?: (edge: SupplyChainGraphEdge) => number) {
  const severity = Math.min(1, Math.max(0, params.severity));
  const damping = Math.min(1, Math.max(0, params.damping));
  const steps = params.maxSteps ?? 6;

  const { adjacency, edges } = buildAdjacency(graph, params.includeKinds);
  const nodes = graph.nodes.map((n) => n.id);
  const scores: Record<string, number> = {};

  nodes.forEach((id) => {
    scores[id] = failedNodeIds.includes(id) ? severity : 0;
  });

  for (let step = 0; step < steps; step += 1) {
    const nextScores: Record<string, number> = { ...scores };
    for (const from of nodes) {
      const outgoing = adjacency.get(from) ?? [];
      if (outgoing.length === 0) continue;
      const fromScore = scores[from] ?? 0;
      for (const { edge, weight } of outgoing) {
        const w = weightOverride ? weightOverride(edge) : weight;
        const propagated = fromScore * damping * w;
        if (propagated <= 0) continue;
        const existing = nextScores[edge.to] ?? 0;
        nextScores[edge.to] = Math.min(1, Math.max(existing, propagated));
      }
    }
    Object.assign(scores, nextScores);
  }

  const impactedEdgeIds = edges
    .filter((edge) => (scores[edge.from] ?? 0) > 0 || (scores[edge.to] ?? 0) > 0)
    .map((edge) => edge.id);

  return { scores, impactedEdgeIds };
}

export function runShockSimulation(
  graph: SupplyChainGraph,
  failedNodeIds: string[],
  params: ShockSimulationParams
): ShockSimulationResult {
  const base = simulate(graph, failedNodeIds, params);
  const impacts: Record<string, ShockImpactResult> = {};

  graph.nodes.forEach((node) => {
    impacts[node.id] = {
      nodeId: node.id,
      score: base.scores[node.id] ?? 0,
    };
  });

  const minRun = simulate(graph, failedNodeIds, params, (edge) => {
    if (edge.weightRange) return clampWeight(edge.weightRange.min, edge.criticality) * Math.max(0.1, edge.confidence ?? 0.7);
    return normalizeEdgeWeight(edge) * Math.max(0.1, edge.confidence ?? 0.7);
  });

  const maxRun = simulate(graph, failedNodeIds, params, (edge) => {
    if (edge.weightRange) return clampWeight(edge.weightRange.max, edge.criticality) * Math.max(0.1, edge.confidence ?? 0.7);
    return normalizeEdgeWeight(edge) * Math.max(0.1, edge.confidence ?? 0.7);
  });

  graph.nodes.forEach((node) => {
    const impact = impacts[node.id];
    if (!impact) return;
    impact.minScore = minRun.scores[node.id] ?? impact.score;
    impact.maxScore = maxRun.scores[node.id] ?? impact.score;
  });

  const ranked = Object.values(impacts)
    .filter((impact) => impact.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    impacts,
    ranked,
    impactedEdgeIds: base.impactedEdgeIds,
  };
}

export function findTopDependencyPaths(
  graph: SupplyChainGraph,
  sourceId: string,
  targetId: string | null,
  limit = 5,
  maxDepth = 3
): ShockPath[] {
  const { adjacency } = buildAdjacency(graph);
  const results: ShockPath[] = [];

  function dfs(current: string, depth: number, score: number, steps: ShockPathStep[], visited: Set<string>) {
    if (depth > maxDepth) return;
    if (targetId && current === targetId && steps.length > 0) {
      results.push({ score, steps: [...steps] });
      return;
    }
    const outgoing = adjacency.get(current) ?? [];
    for (const { edge, weight } of outgoing) {
      if (visited.has(edge.to)) continue;
      const nextScore = score * weight;
      const nextStep: ShockPathStep = {
        edgeId: edge.id,
        from: edge.from,
        to: edge.to,
        score: weight,
      };
      visited.add(edge.to);
      dfs(edge.to, depth + 1, nextScore, [...steps, nextStep], visited);
      visited.delete(edge.to);
    }
  }

  dfs(sourceId, 0, 1, [], new Set<string>([sourceId]));

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
