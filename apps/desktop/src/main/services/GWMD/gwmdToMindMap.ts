import type {
  DependencyKind,
  MindMapData,
  SupplyChainEvidenceStatus,
  SupplyChainEntityType,
  SupplyChainGraphEdge,
  SupplyChainGraphNode,
} from "@tc/shared/supplyChain";
import type {
  GwmdCompany,
  GwmdRelationshipEdge,
} from "./companyRelationshipService";

const DEFAULT_CONFIDENCE = 0.6;

const RELATION_KIND_MAP: Record<string, DependencyKind> = {
  supplier: "supplier",
  customer: "customer",
  partner: "partner",
  competitor: "competitor",
  financing: "financing",
  license: "license",
};

const ENTITY_TYPE_MAP: Record<string, SupplyChainEntityType> = {
  company: "company",
  facility: "facility",
  subsidiary: "company",
  regulator: "region",
  supplier_network: "infrastructure",
};

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONFIDENCE;
  return Math.max(0, Math.min(1, value));
}

function normalizeConfidence(value: number | undefined): number {
  if (typeof value !== "number") return DEFAULT_CONFIDENCE;
  if (value > 1 && value <= 100) {
    return clamp01(value / 100);
  }
  return clamp01(value);
}

function resolveNodeConfidence(
  ticker: string,
  healthScore: number | undefined,
  connectedEdgeConfidences: number[],
): number {
  if (typeof healthScore === "number") {
    return normalizeConfidence(healthScore);
  }
  if (connectedEdgeConfidences.length === 0) {
    return DEFAULT_CONFIDENCE;
  }
  const total = connectedEdgeConfidences.reduce((sum, value) => sum + value, 0);
  return clamp01(total / connectedEdgeConfidences.length);
}

export function mapGwmdToMindMap(
  ticker: string,
  companies: GwmdCompany[],
  edges: GwmdRelationshipEdge[],
): MindMapData {
  const now = new Date().toISOString();
  const centerTicker = normalizeTicker(ticker);

  const companiesByTicker = new Map<string, GwmdCompany>();
  companies.forEach((company) => {
    companiesByTicker.set(normalizeTicker(company.ticker), {
      ...company,
      ticker: normalizeTicker(company.ticker),
    });
  });

  if (!companiesByTicker.has(centerTicker)) {
    companiesByTicker.set(centerTicker, {
      ticker: centerTicker,
      name: centerTicker,
    });
  }

  const connectedConfidenceByTicker = new Map<string, number[]>();
  const edgeEntityTypeByTicker = new Map<string, SupplyChainEntityType>();

  edges.forEach((edge) => {
    const from = normalizeTicker(edge.from_ticker);
    const to = normalizeTicker(edge.to_ticker);
    const confidence = normalizeConfidence(edge.confidence);

    connectedConfidenceByTicker.set(from, [
      ...(connectedConfidenceByTicker.get(from) ?? []),
      confidence,
    ]);
    connectedConfidenceByTicker.set(to, [
      ...(connectedConfidenceByTicker.get(to) ?? []),
      confidence,
    ]);

    if (edge.entity_type) {
      edgeEntityTypeByTicker.set(
        to,
        ENTITY_TYPE_MAP[edge.entity_type] ?? "company",
      );
    }

    if (!companiesByTicker.has(from)) {
      companiesByTicker.set(from, { ticker: from, name: from });
    }
    if (!companiesByTicker.has(to)) {
      companiesByTicker.set(to, { ticker: to, name: to });
    }
  });

  const nodes: SupplyChainGraphNode[] = Array.from(
    companiesByTicker.values(),
  ).map((company) => {
    const normalizedTicker = normalizeTicker(company.ticker);
    const confidence = resolveNodeConfidence(
      normalizedTicker,
      company.health_score,
      connectedConfidenceByTicker.get(normalizedTicker) ?? [],
    );

    return {
      id: normalizedTicker,
      label: company.name,
      canonicalName: company.name,
      entityType: edgeEntityTypeByTicker.get(normalizedTicker) ?? "company",
      tier: "direct",
      confidence,
      verified: confidence >= 0.75,
      tickers: [normalizedTicker],
      lastUpdated: now,
      metadata: {
        hqLat: company.hq_lat,
        hqLon: company.hq_lon,
        hqCity: company.hq_city,
        hqCountry: company.hq_country,
        industry: company.industry,
        geoSource: company.geo_source,
        geoConfidence: company.geo_confidence,
        dataStatus: company.data_status,
      },
    };
  });

  const mappedEdges: SupplyChainGraphEdge[] = edges
    .map((edge) => {
      const relationType = (edge.relation_type || "").trim().toLowerCase();
      const confidence = normalizeConfidence(edge.confidence);
      const dataStatus = edge.data_status ?? "candidate";
      const evidenceStatus: SupplyChainEvidenceStatus =
        dataStatus === "production" || dataStatus === "validated"
          ? "verified_official"
          : "hypothesis";
      const sourceCitation = edge.source_citation?.trim();
      const explanation =
        edge.evidence?.trim() ||
        (sourceCitation ? `Source: ${sourceCitation}` : "No evidence provided");

      return {
        id: edge.id,
        from: normalizeTicker(edge.from_ticker),
        to: normalizeTicker(edge.to_ticker),
        kind: RELATION_KIND_MAP[relationType] ?? "other",
        weight:
          typeof edge.relationship_strength === "number"
            ? clamp01(edge.relationship_strength)
            : typeof edge.weight === "number"
              ? normalizeConfidence(edge.weight)
              : confidence,
        confidence,
        evidenceStatus,
        explanation,
        source: sourceCitation,
        metadata: {
          relationType,
          sourceType: edge.source_type,
          sourceCitation,
          relationshipStrength: edge.relationship_strength,
          directness: edge.directness,
          productOrService: edge.product_or_service,
          dependencySummary: edge.dependency_summary,
          logisticsMode: edge.logistics_mode,
          logisticsNodes: edge.logistics_nodes ?? [],
          chokepoints: edge.chokepoints ?? [],
          exposureRegions: edge.exposure_regions ?? [],
          relatedCompanyAliases: edge.related_company_aliases ?? [],
          relatedCompanyIndustry: edge.related_company_industry,
          fieldStatuses: edge.field_statuses ?? {},
          dataStatus,
        },
      };
    })
    .filter((edge) => edge.from !== edge.to);

  const centerName = companiesByTicker.get(centerTicker)?.name ?? centerTicker;

  return {
    centerTicker,
    centerName,
    centerNodeId: centerTicker,
    generatedAt: now,
    categories: [],
    graph: {
      nodes,
      edges: mappedEdges,
    },
    strictMode: true,
    includeHypothesis: true,
    hypothesisAvailable: mappedEdges.some(
      (edge) => edge.evidenceStatus === "hypothesis",
    ),
  };
}
