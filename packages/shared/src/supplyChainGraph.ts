/**
 * Canonical supply chain graph builder utilities
 */

import type {
  CompanyNode,
  MindMapData,
  RelationCategory,
  RiskLensCell,
  RiskSeverity,
  SupplyChainGraph,
  SupplyChainGraphEdge,
  SupplyChainGraphNode,
  SupplyChainRiskType,
  SupplyChainTier,
} from "./supplyChain";

interface CategoryRule {
  tier: SupplyChainTier;
  kind: SupplyChainGraphEdge["kind"];
  direction: "into" | "out";
}

const CATEGORY_RULES: Record<string, CategoryRule> = {
  suppliers: { tier: "direct", kind: "supplies", direction: "into" },
  manufacturers: { tier: "direct", kind: "manufactures", direction: "into" },
  services: { tier: "direct", kind: "supports", direction: "out" },
  technology: { tier: "indirect", kind: "licenses", direction: "out" },
  distribution: { tier: "direct", kind: "distributes", direction: "out" },
};

const RISK_PRIORITY: Record<RiskSeverity, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
};

function normalizeCategoryId(category: RelationCategory): string {
  return (category.id || category.name || "category").trim().toLowerCase().replace(/\s+/g, "-");
}

function resolveCategoryRule(category: RelationCategory): CategoryRule {
  const normalized = normalizeCategoryId(category);
  if (CATEGORY_RULES[normalized]) return CATEGORY_RULES[normalized];
  const name = (category.name || "").toLowerCase();
  if (name.includes("supplier")) return CATEGORY_RULES.suppliers;
  if (name.includes("manufact")) return CATEGORY_RULES.manufacturers;
  if (name.includes("service")) return CATEGORY_RULES.services;
  if (name.includes("tech")) return CATEGORY_RULES.technology;
  if (name.includes("distribution") || name.includes("channel")) return CATEGORY_RULES.distribution;
  return { tier: "indirect", kind: "supports", direction: "out" };
}

function toGraphNode(node: CompanyNode, rule: CategoryRule): SupplyChainGraphNode {
  return {
    id: node.id || node.name,
    label: node.name,
    entityType: "company",
    tier: rule.tier,
    role: node.role,
    criticality: node.criticality,
    confidence: node.confidence,
    verified: node.verified,
    healthScore: node.healthScore,
    status: "normal",
    explanation: node.source,
    metadata: node.metadata,
  };
}

function toGraphEdge(
  sourceId: string,
  targetId: string,
  node: CompanyNode,
  rule: CategoryRule,
  categoryName: string
): SupplyChainGraphEdge {
  const from = rule.direction === "into" ? sourceId : targetId;
  const to = rule.direction === "into" ? targetId : sourceId;
  const weight = typeof node.revenueImpact === "number" && node.revenueImpact > 0
    ? node.revenueImpact
    : node.criticality;

  return {
    id: `${from}->${to}-${rule.kind}`,
    from,
    to,
    kind: rule.kind,
    weight,
    criticality: node.criticality,
    confidence: node.confidence,
    status: "normal",
    explanation: `${categoryName}: ${node.role}`,
    source: node.source,
  };
}

function classifyRiskType(text: string): SupplyChainRiskType {
  const value = text.toLowerCase();
  if (value.includes("geo") || value.includes("taiwan") || value.includes("china") || value.includes("sanction")) {
    return "geopolitical";
  }
  if (value.includes("regulat") || value.includes("compliance")) {
    return "regulatory";
  }
  if (value.includes("capacity") || value.includes("shortage") || value.includes("bottleneck")) {
    return "capacity";
  }
  if (value.includes("single") || value.includes("sole") || value.includes("exclusive")) {
    return "single-supplier";
  }
  if (value.includes("logistics") || value.includes("port") || value.includes("shipping")) {
    return "logistics";
  }
  if (value.includes("cost") || value.includes("margin") || value.includes("financ")) {
    return "financial";
  }
  if (value.includes("cyber") || value.includes("security")) {
    return "cyber";
  }
  return "other";
}

export function buildCanonicalGraphFromMindMap(data: MindMapData): SupplyChainGraph {
  const nodes = new Map<string, SupplyChainGraphNode>();
  const edges = new Map<string, SupplyChainGraphEdge>();

  const centerId = data.centerTicker || data.centerName;
  nodes.set(centerId, {
    id: centerId,
    label: data.centerName,
    entityType: "company",
    tier: "direct",
    role: "Focal company",
    criticality: 5,
    confidence: 1,
    verified: true,
    healthScore: data.healthScore ?? 90,
    status: "normal",
    explanation: "Primary focus",
  });

  for (const category of data.categories) {
    const rule = resolveCategoryRule(category);
    for (const company of category.companies) {
      const nodeId = company.id || company.name;
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, toGraphNode(company, rule));
      }
      const edge = toGraphEdge(nodeId, centerId, company, rule, category.name);
      edges.set(edge.id, edge);
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()),
  };
}

export function buildRiskLensFromMindMap(data: MindMapData): RiskLensCell[] {
  const cells = new Map<string, RiskLensCell>();

  for (const category of data.categories) {
    const categoryId = normalizeCategoryId(category);
    for (const company of category.companies) {
      if (!company.supplyChainRisks) continue;
      for (const risk of company.supplyChainRisks) {
        const riskType = classifyRiskType(risk.risk);
        const key = `${categoryId}:${riskType}`;
        const existing = cells.get(key);
        const nextSeverity = risk.severity;

        if (!existing) {
          cells.set(key, {
            id: key,
            category: category.name,
            riskType,
            severity: nextSeverity,
            affectedNodes: [company.id || company.name],
            explanation: risk.risk,
          });
        } else {
          if (!existing.affectedNodes.includes(company.id || company.name)) {
            existing.affectedNodes.push(company.id || company.name);
          }
          if (RISK_PRIORITY[nextSeverity] > RISK_PRIORITY[existing.severity]) {
            existing.severity = nextSeverity;
            existing.explanation = risk.risk;
          }
        }
      }
    }
  }

  return Array.from(cells.values()).sort((a, b) => RISK_PRIORITY[b.severity] - RISK_PRIORITY[a.severity]);
}

export function ensureCanonicalStructures(data: MindMapData): MindMapData {
  const graph = data.graph ?? buildCanonicalGraphFromMindMap(data);
  const riskLens = data.riskLens ?? buildRiskLensFromMindMap(data);
  if (data.graph && data.riskLens) {
    return data;
  }
  return {
    ...data,
    graph,
    riskLens,
  };
}
