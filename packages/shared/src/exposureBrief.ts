import type { SupplyChainGraph, SupplyChainTier } from "./supplyChain.js";
import type {
  ShockPath,
  ShockSimulationParams,
  ShockSimulationResult,
} from "./supplyChainSimulation.js";

export type ExposureBriefSource = "gwmd" | "supplyChain";

export type ExposureBriefZone =
  | "production"
  | "validation"
  | "candidate"
  | "unknown";

export type ExposureBriefConfidenceBand =
  | "very_low"
  | "low"
  | "medium"
  | "high"
  | "very_high";

export type ExposureBriefTrustGate = "pass" | "warn" | "block";

export type ExposureBriefRiskSeverity = "low" | "medium" | "high";

export interface ExposureBriefItem {
  nodeId: string;
  ticker: string | null;
  name: string;
  tier: SupplyChainTier;
  impactScore: number;
  minImpactScore?: number;
  maxImpactScore?: number;
  attentionGapScore: number;
  concentrationBonus: number;
  compositeScore: number;
  confidence: number;
  confidenceBand: ExposureBriefConfidenceBand;
  zone: ExposureBriefZone;
  evidenceCount: number;
  freshnessDays?: number;
}

export interface ExposureBriefTrustSummary {
  averageConfidence: number;
  productionCount: number;
  validationCount: number;
  candidateCount: number;
  unknownCount: number;
  candidateRatio: number;
  lowConfidenceRatio: number;
  staleRatio: number;
  staleItemCount: number;
}

export interface ExposureBriefTrustIssue {
  code:
    | "candidate_heavy"
    | "low_confidence_heavy"
    | "stale_data_heavy"
    | "weak_average_confidence"
    | "no_verified_items";
  severity: "warning" | "critical";
  message: string;
}

export interface ExposureBriefDependencyPath {
  sourceNodeId: string;
  targetNodeId: string;
  targetName: string;
  score: number;
  steps: ShockPath["steps"];
}

export interface ExposureBriefRiskSignal {
  nodeId: string;
  name: string;
  severity: ExposureBriefRiskSeverity;
  score: number;
  reasons: string[];
}

export interface ExposureBrief {
  id: string;
  source: ExposureBriefSource;
  generatedAt: string;
  shockNodeIds: string[];
  params: ShockSimulationParams;
  totalNodes: number;
  impactedNodeCount: number;
  items: ExposureBriefItem[];
  trust: ExposureBriefTrustSummary;
  trustGate: ExposureBriefTrustGate;
  trustIssues: ExposureBriefTrustIssue[];
  dependencyPaths: ExposureBriefDependencyPath[];
  riskSignals: ExposureBriefRiskSignal[];
}

export interface ExposureBriefNodeEnrichment {
  confidence?: number;
  zone?: ExposureBriefZone;
  evidenceCount?: number;
  freshnessDays?: number;
}

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const STALE_DAYS_THRESHOLD = 45;

const toConfidenceBand = (confidence: number): ExposureBriefConfidenceBand => {
  const v = clamp(confidence);
  if (v >= 0.9) return "very_high";
  if (v >= 0.75) return "high";
  if (v >= 0.5) return "medium";
  if (v >= 0.25) return "low";
  return "very_low";
};

const tierVisibility = (tier: SupplyChainTier): number => {
  switch (tier) {
    case "direct":
      return 0.8;
    case "indirect":
      return 0.4;
    case "systemic":
      return 0.2;
    default:
      return 0.5;
  }
};

const estimateDirectnessVisibility = (
  graph: SupplyChainGraph,
  nodeId: string,
): number => {
  const connected = graph.edges.filter(
    (edge) => edge.from === nodeId || edge.to === nodeId,
  );
  if (connected.length === 0) return 0.5;

  const directnessVotes = connected.map((edge) => {
    const raw =
      typeof edge.metadata?.directness === "string"
        ? edge.metadata.directness
        : null;
    const value = raw ? raw.toLowerCase() : "";
    if (value === "direct") return 0.7;
    if (value === "indirect") return 0.3;
    if (value === "inferred") return 0.1;
    return 0.4;
  });

  return clamp(
    directnessVotes.reduce((sum, item) => sum + item, 0) /
      directnessVotes.length,
  );
};

const estimateMarketVisibility = (healthScore?: number): number => {
  if (typeof healthScore !== "number" || !Number.isFinite(healthScore)) {
    return 0.5;
  }
  return clamp(healthScore / 100);
};

export const computeAttentionGap = (input: {
  exposureScore: number;
  tier: SupplyChainTier;
  graph: SupplyChainGraph;
  nodeId: string;
  healthScore?: number;
}): number => {
  const visibility =
    0.4 * tierVisibility(input.tier) +
    0.3 * estimateDirectnessVisibility(input.graph, input.nodeId) +
    0.3 * estimateMarketVisibility(input.healthScore);
  return clamp(clamp(input.exposureScore) * (1 - clamp(visibility)));
};

export const computeConcentrationBonus = (
  nodeId: string,
  graph: SupplyChainGraph,
): number => {
  const outgoing = graph.edges.filter((edge) => edge.from === nodeId);
  if (outgoing.length === 0) return 0;

  const weighted = outgoing.map((edge) => {
    if (typeof edge.weight === "number" && Number.isFinite(edge.weight)) {
      return Math.max(0, edge.weight);
    }
    if (
      edge.weightRange &&
      Number.isFinite(edge.weightRange.min) &&
      Number.isFinite(edge.weightRange.max)
    ) {
      return Math.max(0, (edge.weightRange.min + edge.weightRange.max) / 2);
    }
    if (
      typeof edge.criticality === "number" &&
      Number.isFinite(edge.criticality)
    ) {
      return Math.max(0, edge.criticality / 5);
    }
    return 0.25;
  });

  const total = weighted.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;

  const shares = weighted.map((value) => value / total);
  const hhi = shares.reduce((sum, share) => sum + share * share, 0);
  if (hhi <= 0.25) return 0;
  return clamp((hhi - 0.25) / 0.75);
};

const inferZoneFromNode = (
  node: SupplyChainGraph["nodes"][number],
): ExposureBriefZone => {
  if (node.verified === true) return "production";
  if (node.verified === false) return "candidate";
  return "unknown";
};

const inferTicker = (
  node: SupplyChainGraph["nodes"][number],
): string | null => {
  if (node.tickers && node.tickers.length > 0) return node.tickers[0] ?? null;
  if (/^[A-Z.]{1,10}$/.test(node.id)) return node.id;
  return null;
};

export const computeExposureBriefRanking = (input: {
  graph: SupplyChainGraph;
  simulationResult: ShockSimulationResult;
  enrichmentByNode?: Record<string, ExposureBriefNodeEnrichment>;
  limit?: number;
}): ExposureBriefItem[] => {
  const { graph, simulationResult, enrichmentByNode = {}, limit = 20 } = input;

  const byNodeId = new Map(graph.nodes.map((node) => [node.id, node]));

  const items = simulationResult.ranked
    .map((impact) => {
      const node = byNodeId.get(impact.nodeId);
      if (!node) return null;

      const enrichment = enrichmentByNode[node.id] ?? {};
      const exposureScore = clamp(impact.score);
      const attentionGapScore =
        typeof node.healthScore === "number"
          ? computeAttentionGap({
              exposureScore,
              tier: node.tier,
              graph,
              nodeId: node.id,
              healthScore: node.healthScore,
            })
          : computeAttentionGap({
              exposureScore,
              tier: node.tier,
              graph,
              nodeId: node.id,
            });
      const concentrationBonus = computeConcentrationBonus(node.id, graph);
      const compositeScore = clamp(
        exposureScore * 0.6 +
          attentionGapScore * 0.3 +
          concentrationBonus * 0.1,
      );

      const confidence = clamp(
        typeof enrichment.confidence === "number"
          ? enrichment.confidence
          : typeof node.confidence === "number"
            ? node.confidence
            : 0.5,
      );
      const zone = enrichment.zone ?? inferZoneFromNode(node);

      const baseItem: ExposureBriefItem = {
        nodeId: node.id,
        ticker: inferTicker(node),
        name: node.label || node.id,
        tier: node.tier,
        impactScore: exposureScore,
        attentionGapScore,
        concentrationBonus,
        compositeScore,
        confidence,
        confidenceBand: toConfidenceBand(confidence),
        zone,
        evidenceCount: Math.max(0, Math.floor(enrichment.evidenceCount ?? 0)),
      };

      if (typeof enrichment.freshnessDays === "number") {
        baseItem.freshnessDays = Math.max(0, enrichment.freshnessDays);
      }

      if (typeof impact.minScore === "number") {
        baseItem.minImpactScore = impact.minScore;
      }
      if (typeof impact.maxScore === "number") {
        baseItem.maxImpactScore = impact.maxScore;
      }

      return baseItem;
    })
    .filter((item): item is ExposureBriefItem => Boolean(item))
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, Math.max(1, limit));

  return items;
};

export const composeBriefTrustSummary = (
  items: ExposureBriefItem[],
): ExposureBriefTrustSummary => {
  if (items.length === 0) {
    return {
      averageConfidence: 0,
      productionCount: 0,
      validationCount: 0,
      candidateCount: 0,
      unknownCount: 0,
      candidateRatio: 0,
      lowConfidenceRatio: 0,
      staleRatio: 0,
      staleItemCount: 0,
    };
  }

  const productionCount = items.filter(
    (item) => item.zone === "production",
  ).length;
  const validationCount = items.filter(
    (item) => item.zone === "validation",
  ).length;
  const candidateCount = items.filter(
    (item) => item.zone === "candidate",
  ).length;
  const unknownCount = items.filter((item) => item.zone === "unknown").length;

  const avg =
    items.reduce((sum, item) => sum + item.confidence, 0) /
    Math.max(1, items.length);

  const lowConfidenceCount = items.filter(
    (item) => item.confidence < 0.5,
  ).length;
  const staleItemCount = items.filter(
    (item) =>
      typeof item.freshnessDays === "number" &&
      Number.isFinite(item.freshnessDays) &&
      item.freshnessDays >= STALE_DAYS_THRESHOLD,
  ).length;

  return {
    averageConfidence: clamp(avg),
    productionCount,
    validationCount,
    candidateCount,
    unknownCount,
    candidateRatio: candidateCount / items.length,
    lowConfidenceRatio: lowConfidenceCount / items.length,
    staleRatio: staleItemCount / items.length,
    staleItemCount,
  };
};

export const evaluateExposureBriefTrust = (input: {
  items: ExposureBriefItem[];
  trust: ExposureBriefTrustSummary;
}): {
  trustGate: ExposureBriefTrustGate;
  trustIssues: ExposureBriefTrustIssue[];
} => {
  const { items, trust } = input;
  const issues: ExposureBriefTrustIssue[] = [];

  if (trust.candidateRatio >= 0.75) {
    issues.push({
      code: "candidate_heavy",
      severity: "critical",
      message: "Candidate-inferred links dominate this brief.",
    });
  } else if (trust.candidateRatio >= 0.55) {
    issues.push({
      code: "candidate_heavy",
      severity: "warning",
      message: "Candidate links are a large share of this brief.",
    });
  }

  if (trust.lowConfidenceRatio >= 0.5) {
    issues.push({
      code: "low_confidence_heavy",
      severity: "critical",
      message: "More than half of ranked entities have low confidence.",
    });
  } else if (trust.lowConfidenceRatio >= 0.3) {
    issues.push({
      code: "low_confidence_heavy",
      severity: "warning",
      message: "A material share of ranked entities are low confidence.",
    });
  }

  if (trust.staleRatio >= 0.5) {
    issues.push({
      code: "stale_data_heavy",
      severity: "warning",
      message: "Many ranked entities rely on stale enrichment data.",
    });
  }

  if (trust.averageConfidence < 0.4) {
    issues.push({
      code: "weak_average_confidence",
      severity: "critical",
      message: "Average confidence is too low for high-conviction decisions.",
    });
  } else if (trust.averageConfidence < 0.55) {
    issues.push({
      code: "weak_average_confidence",
      severity: "warning",
      message: "Average confidence is moderate; corroboration is advised.",
    });
  }

  const verifiedCount = trust.productionCount + trust.validationCount;
  if (items.length > 0 && verifiedCount === 0) {
    issues.push({
      code: "no_verified_items",
      severity: "critical",
      message: "No production or validation-zone entities are present.",
    });
  }

  const trustGate: ExposureBriefTrustGate = issues.some(
    (issue) => issue.severity === "critical",
  )
    ? "block"
    : issues.length > 0
      ? "warn"
      : "pass";

  return { trustGate, trustIssues: issues };
};

export const composeExposureBrief = (input: {
  source: ExposureBriefSource;
  graph: SupplyChainGraph;
  simulationResult: ShockSimulationResult;
  params: ShockSimulationParams;
  shockNodeIds: string[];
  enrichmentByNode?: Record<string, ExposureBriefNodeEnrichment>;
  dependencyPaths?: ExposureBriefDependencyPath[];
  riskSignals?: ExposureBriefRiskSignal[];
  limit?: number;
}): ExposureBrief => {
  const rankingInput: {
    graph: SupplyChainGraph;
    simulationResult: ShockSimulationResult;
    enrichmentByNode?: Record<string, ExposureBriefNodeEnrichment>;
    limit?: number;
  } = {
    graph: input.graph,
    simulationResult: input.simulationResult,
  };
  if (input.enrichmentByNode) {
    rankingInput.enrichmentByNode = input.enrichmentByNode;
  }
  if (typeof input.limit === "number") {
    rankingInput.limit = input.limit;
  }

  const items = computeExposureBriefRanking(rankingInput);
  const trust = composeBriefTrustSummary(items);
  const { trustGate, trustIssues } = evaluateExposureBriefTrust({
    items,
    trust,
  });

  return {
    id: `brief-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    source: input.source,
    generatedAt: new Date().toISOString(),
    shockNodeIds: input.shockNodeIds,
    params: input.params,
    totalNodes: input.graph.nodes.length,
    impactedNodeCount: input.simulationResult.ranked.length,
    items,
    trust,
    trustGate,
    trustIssues,
    dependencyPaths: input.dependencyPaths ?? [],
    riskSignals: input.riskSignals ?? [],
  };
};

const csvEscape = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "";
  const asString = String(value);
  if (!/[",\n]/.test(asString)) return asString;
  return `"${asString.replace(/"/g, '""')}"`;
};

export const serializeExposureBriefCsv = (brief: ExposureBrief): string => {
  const headers = [
    "rank",
    "nodeId",
    "ticker",
    "name",
    "tier",
    "impactScore",
    "minImpactScore",
    "maxImpactScore",
    "attentionGapScore",
    "concentrationBonus",
    "compositeScore",
    "confidence",
    "confidenceBand",
    "zone",
    "evidenceCount",
    "freshnessDays",
    "trustGate",
    "generatedAt",
    "source",
  ];

  const rows = brief.items.map((item, index) => [
    index + 1,
    item.nodeId,
    item.ticker,
    item.name,
    item.tier,
    item.impactScore,
    item.minImpactScore ?? "",
    item.maxImpactScore ?? "",
    item.attentionGapScore,
    item.concentrationBonus,
    item.compositeScore,
    item.confidence,
    item.confidenceBand,
    item.zone,
    item.evidenceCount,
    typeof item.freshnessDays === "number"
      ? Math.round(item.freshnessDays * 100) / 100
      : "",
    brief.trustGate,
    brief.generatedAt,
    brief.source,
  ]);

  const allRows = [headers, ...rows];
  return allRows
    .map((row) => row.map((cell) => csvEscape(cell)).join(","))
    .join("\n");
};
