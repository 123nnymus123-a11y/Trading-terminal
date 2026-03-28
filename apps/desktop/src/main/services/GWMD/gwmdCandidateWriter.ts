import crypto from "node:crypto";
import { GraphEnrichmentRepository } from "../graphEnrichment/repository";
import type {
  EvidenceSourceType,
  GraphRelationType,
} from "../graphEnrichment/types";
import type {
  GwmdCompany,
  GwmdFieldStatus,
  GwmdRelationshipEdge,
} from "./companyRelationshipService";
import type { GwmdResearchScope } from "./gwmdVaultBridge";

export type GwmdCandidateWriteResult = {
  companyEntityIdsByTicker: Map<string, string>;
  candidateEntityIds: string[];
  candidateEdgeIds: string[];
  entityCount: number;
  edgeCount: number;
  evidenceCount: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function hashValue(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function candidateEntityId(ticker: string): string {
  return `gwmd:company:${normalizeTicker(ticker)}:candidate`;
}

function canonicalEntityId(ticker: string): string {
  return `gwmd:company:${normalizeTicker(ticker)}`;
}

function candidateEdgeId(
  fromTicker: string,
  toTicker: string,
  relationType: string,
): string {
  return `gwmd:edge:${normalizeTicker(fromTicker)}|${normalizeTicker(toTicker)}|${relationType.toLowerCase()}:candidate`;
}

export function canonicalEdgeId(
  fromTicker: string,
  toTicker: string,
  relationType: string,
): string {
  return `gwmd:edge:${normalizeTicker(fromTicker)}|${normalizeTicker(toTicker)}|${relationType.toLowerCase()}`;
}

function stableSemanticKey(
  fromTicker: string,
  toTicker: string,
  relationType: string,
): string {
  return `${normalizeTicker(fromTicker)}|${normalizeTicker(toTicker)}|${relationType.toLowerCase()}`;
}

function mapEvidenceSourceType(
  value: GwmdRelationshipEdge["source_type"],
): EvidenceSourceType {
  if (value === "sec_filing") return "sec_filing";
  if (value === "annual_report") return "annual_report";
  if (value === "press_release") return "press_release";
  if (value === "regulator_dataset") return "regulator_dataset";
  if (value === "industry_analysis") return "other_official";
  return "ai_extraction";
}

function mapRelationType(value: string): GraphRelationType {
  const normalized = value.trim().toLowerCase();
  if (normalized === "supplier") return "linked_to";
  if (normalized === "customer") return "ships_to";
  if (normalized === "partner") return "linked_to";
  if (normalized === "competitor") return "linked_to";
  if (normalized === "financing") return "linked_to";
  if (normalized === "license") return "linked_to";
  return "linked_to";
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  value.forEach((item) => {
    const normalized = normalizeString(item);
    if (normalized) unique.add(normalized);
  });
  return Array.from(unique);
}

function normalizeFieldStatus(value: unknown): GwmdFieldStatus | null {
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

function fieldStatusForValue(value: unknown): GwmdFieldStatus {
  if (value === null || value === undefined || value === "") return "unknown";
  if (Array.isArray(value) && value.length === 0) return "unknown";
  return "present";
}

function mergeFieldStatuses(
  current: GwmdFieldStatus | undefined,
  next: GwmdFieldStatus,
): GwmdFieldStatus {
  if (!current) return next;
  if (current === "contradicted" || next === "contradicted") {
    return "contradicted";
  }
  if (current === "present" && next === "present") return "present";
  if (current === "present" && next === "low_confidence_inference") {
    return "low_confidence_inference";
  }
  if (
    current === "low_confidence_inference" ||
    next === "low_confidence_inference"
  ) {
    return "low_confidence_inference";
  }
  if (current === "present" || next === "present") return "present";
  if (current === "not_found" || next === "not_found") return "not_found";
  if (current === "not_applicable" || next === "not_applicable") {
    return "not_applicable";
  }
  return "unknown";
}

function normalizeFieldStatusMap(
  fieldStatuses: GwmdRelationshipEdge["field_statuses"],
): Record<string, GwmdFieldStatus> {
  if (!fieldStatuses) return {};
  return Object.entries(fieldStatuses).reduce<Record<string, GwmdFieldStatus>>(
    (acc, [key, value]) => {
      const normalized = normalizeFieldStatus(value);
      if (normalized) acc[key] = normalized;
      return acc;
    },
    {},
  );
}

function collectCompanyResearch(edges: GwmdRelationshipEdge[]) {
  const byTicker = new Map<
    string,
    {
      aliases: Set<string>;
      operatingCountries: Set<string>;
      facilityLocations: Set<string>;
      logisticsNodes: Set<string>;
      chokepoints: Set<string>;
      exposureRegions: Set<string>;
      industries: Set<string>;
      productsServices: Set<string>;
      dependencySummaries: Set<string>;
      logisticsModes: Set<string>;
      fieldStatuses: Record<string, GwmdFieldStatus>;
    }
  >();

  edges.forEach((edge) => {
    const ticker = normalizeTicker(edge.to_ticker);
    const existing = byTicker.get(ticker) ?? {
      aliases: new Set<string>(),
      operatingCountries: new Set<string>(),
      facilityLocations: new Set<string>(),
      logisticsNodes: new Set<string>(),
      chokepoints: new Set<string>(),
      exposureRegions: new Set<string>(),
      industries: new Set<string>(),
      productsServices: new Set<string>(),
      dependencySummaries: new Set<string>(),
      logisticsModes: new Set<string>(),
      fieldStatuses: {},
    };

    normalizeStringArray(edge.related_company_aliases).forEach((value) =>
      existing.aliases.add(value),
    );
    normalizeStringArray(edge.operating_countries).forEach((value) =>
      existing.operatingCountries.add(value),
    );
    normalizeStringArray(edge.facility_locations).forEach((value) =>
      existing.facilityLocations.add(value),
    );
    normalizeStringArray(edge.logistics_nodes).forEach((value) =>
      existing.logisticsNodes.add(value),
    );
    normalizeStringArray(edge.chokepoints).forEach((value) =>
      existing.chokepoints.add(value),
    );
    normalizeStringArray(edge.exposure_regions).forEach((value) =>
      existing.exposureRegions.add(value),
    );

    const industry = normalizeString(edge.related_company_industry);
    if (industry) existing.industries.add(industry);
    const productOrService = normalizeString(edge.product_or_service);
    if (productOrService) existing.productsServices.add(productOrService);
    const dependencySummary = normalizeString(edge.dependency_summary);
    if (dependencySummary) existing.dependencySummaries.add(dependencySummary);
    const logisticsMode = normalizeString(edge.logistics_mode);
    if (logisticsMode) existing.logisticsModes.add(logisticsMode);

    const explicitFieldStatuses = normalizeFieldStatusMap(edge.field_statuses);
    Object.entries({
      aliases:
        explicitFieldStatuses.aliases ??
        fieldStatusForValue(edge.related_company_aliases),
      industry:
        explicitFieldStatuses.industry ??
        fieldStatusForValue(edge.related_company_industry),
      operating_countries:
        explicitFieldStatuses.operating_countries ??
        fieldStatusForValue(edge.operating_countries),
      facility_locations:
        explicitFieldStatuses.facility_locations ??
        fieldStatusForValue(edge.facility_locations),
      product_or_service:
        explicitFieldStatuses.product_or_service ??
        fieldStatusForValue(edge.product_or_service),
      dependency_summary:
        explicitFieldStatuses.dependency_summary ??
        fieldStatusForValue(edge.dependency_summary),
      logistics_mode:
        explicitFieldStatuses.logistics_mode ??
        fieldStatusForValue(edge.logistics_mode),
      logistics_nodes:
        explicitFieldStatuses.logistics_nodes ??
        fieldStatusForValue(edge.logistics_nodes),
      chokepoints:
        explicitFieldStatuses.chokepoints ??
        fieldStatusForValue(edge.chokepoints),
      exposure_regions:
        explicitFieldStatuses.exposure_regions ??
        fieldStatusForValue(edge.exposure_regions),
    }).forEach(([fieldName, status]) => {
      existing.fieldStatuses[fieldName] = mergeFieldStatuses(
        existing.fieldStatuses[fieldName],
        status,
      );
    });

    byTicker.set(ticker, existing);
  });

  return byTicker;
}

export function persistGwmdCandidates(input: {
  rootTicker: string;
  companies: GwmdCompany[];
  edges: GwmdRelationshipEdge[];
  scope: GwmdResearchScope;
}): GwmdCandidateWriteResult {
  const rootTicker = normalizeTicker(input.rootTicker);
  const createdAt = nowIso();
  const companyResearch = collectCompanyResearch(input.edges);
  const companyEntityIdsByTicker = new Map<string, string>();
  const candidateEntityIds: string[] = [];
  const candidateEdgeIds: string[] = [];
  let entityCount = 0;
  let edgeCount = 0;
  let evidenceCount = 0;

  input.companies.forEach((company) => {
    const ticker = normalizeTicker(company.ticker);
    const existing = input.scope.bestCompanyByTicker.get(ticker);
    if (
      existing &&
      (existing.dataStatus === "production" ||
        existing.dataStatus === "validated")
    ) {
      companyEntityIdsByTicker.set(ticker, existing.entityId);
      return;
    }

    const entityId = existing?.entityId ?? candidateEntityId(ticker);
    companyEntityIdsByTicker.set(ticker, entityId);
    candidateEntityIds.push(entityId);

    const research = companyResearch.get(ticker);
    const aliases = Array.from(
      new Set<string>([ticker, ...Array.from(research?.aliases ?? [])]),
    );
    const industries = Array.from(research?.industries ?? []);
    const operatingCountries = Array.from(research?.operatingCountries ?? []);
    const facilityLocations = Array.from(research?.facilityLocations ?? []);
    const logisticsNodes = Array.from(research?.logisticsNodes ?? []);
    const chokepoints = Array.from(research?.chokepoints ?? []);
    const exposureRegions = Array.from(research?.exposureRegions ?? []);
    const productsServices = Array.from(research?.productsServices ?? []);
    const dependencySummaries = Array.from(research?.dependencySummaries ?? []);
    const logisticsModes = Array.from(research?.logisticsModes ?? []);
    const companyFieldStatuses = {
      canonical_name: fieldStatusForValue(company.name),
      ticker: fieldStatusForValue(ticker),
      aliases: research?.fieldStatuses.aliases ?? fieldStatusForValue(aliases),
      industry:
        research?.fieldStatuses.industry ??
        fieldStatusForValue(industries[0] ?? null),
      headquarters_city: fieldStatusForValue(company.hq_city),
      headquarters_country: fieldStatusForValue(company.hq_country),
      headquarters_coordinates:
        typeof company.hq_lat === "number" && typeof company.hq_lon === "number"
          ? "present"
          : "unknown",
      operating_countries:
        research?.fieldStatuses.operating_countries ??
        fieldStatusForValue(operatingCountries),
      facility_locations:
        research?.fieldStatuses.facility_locations ??
        fieldStatusForValue(facilityLocations),
      product_or_service:
        research?.fieldStatuses.product_or_service ??
        fieldStatusForValue(productsServices),
      dependency_summary:
        research?.fieldStatuses.dependency_summary ??
        fieldStatusForValue(dependencySummaries),
      logistics_mode:
        research?.fieldStatuses.logistics_mode ??
        fieldStatusForValue(logisticsModes),
      logistics_nodes:
        research?.fieldStatuses.logistics_nodes ??
        fieldStatusForValue(logisticsNodes),
      chokepoints:
        research?.fieldStatuses.chokepoints ?? fieldStatusForValue(chokepoints),
      exposure_regions:
        research?.fieldStatuses.exposure_regions ??
        fieldStatusForValue(exposureRegions),
    };

    const metadataJson = JSON.stringify({
      schema: "gwmd_company_v1",
      ticker,
      canonical_name: company.name,
      source_context: {
        root_ticker: rootTicker,
        pipeline: "gwmd_discovery",
      },
      identity: {
        canonical_name: company.name,
        ticker,
        aliases,
        entity_type: "company",
        industry: industries[0] ?? null,
      },
      geography: {
        headquarters_city: company.hq_city ?? null,
        headquarters_country: company.hq_country ?? null,
        headquarters_coordinates:
          typeof company.hq_lat === "number" &&
          typeof company.hq_lon === "number"
            ? { lat: company.hq_lat, lon: company.hq_lon }
            : null,
        operating_countries: operatingCountries,
        facility_locations: facilityLocations,
      },
      logistics: {
        modes: logisticsModes,
        nodes: logisticsNodes,
        chokepoints,
      },
      exposure: {
        regions: exposureRegions,
        dependency_summaries: dependencySummaries,
      },
      commercial_profile: {
        products_services: productsServices,
      },
      field_statuses: companyFieldStatuses,
    });

    GraphEnrichmentRepository.upsertEntity({
      id: entityId,
      canonicalName: company.name || ticker,
      entityType: "company",
      zone: "candidate",
      sourceType: "ai_extraction",
      sourceRef: rootTicker,
      sourceTitle: `GWMD discovery for ${rootTicker}`,
      sourceUrl: undefined,
      aiInferred: true,
      confidenceScore:
        typeof company.geo_confidence === "number"
          ? company.geo_confidence
          : 0.55,
      freshnessScore: 1,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      ttlDays: 14,
      validationStatus: "unvalidated",
      validationMethod: "gwmd_discovery_model",
      validatorType: "model",
      contradictionFlag: false,
      staleFlag: false,
      promotionEligible: false,
      metadataJson,
    });
    GraphEnrichmentRepository.upsertAlias(
      entityId,
      ticker,
      "ticker",
      "gwmd_discovery",
    );
    entityCount += 1;
  });

  input.edges.forEach((edge) => {
    const semanticKey = stableSemanticKey(
      edge.from_ticker,
      edge.to_ticker,
      edge.relation_type,
    );
    const existing = input.scope.bestEdgeBySemanticKey.get(semanticKey);
    if (
      existing &&
      (existing.dataStatus === "production" ||
        existing.dataStatus === "validated")
    ) {
      return;
    }

    const fromTicker = normalizeTicker(edge.from_ticker);
    const toTicker = normalizeTicker(edge.to_ticker);
    const fromEntityId =
      companyEntityIdsByTicker.get(fromTicker) ??
      input.scope.bestCompanyByTicker.get(fromTicker)?.entityId ??
      canonicalEntityId(fromTicker);
    const toEntityId =
      companyEntityIdsByTicker.get(toTicker) ??
      input.scope.bestCompanyByTicker.get(toTicker)?.entityId ??
      canonicalEntityId(toTicker);
    const edgeId =
      existing?.edgeId ??
      candidateEdgeId(fromTicker, toTicker, edge.relation_type);

    const fieldStatuses = {
      relation_type: "present" as GwmdFieldStatus,
      source_ticker: "present" as GwmdFieldStatus,
      target_ticker: "present" as GwmdFieldStatus,
      source_type: fieldStatusForValue(edge.source_type),
      source_citation: fieldStatusForValue(edge.source_citation),
      raw_evidence: fieldStatusForValue(edge.evidence),
      relationship_strength: fieldStatusForValue(
        edge.relationship_strength ?? edge.weight,
      ),
      aliases:
        normalizeFieldStatusMap(edge.field_statuses).aliases ??
        fieldStatusForValue(edge.related_company_aliases),
      industry:
        normalizeFieldStatusMap(edge.field_statuses).industry ??
        fieldStatusForValue(edge.related_company_industry),
      operating_countries:
        normalizeFieldStatusMap(edge.field_statuses).operating_countries ??
        fieldStatusForValue(edge.operating_countries),
      facility_locations:
        normalizeFieldStatusMap(edge.field_statuses).facility_locations ??
        fieldStatusForValue(edge.facility_locations),
      product_or_service:
        normalizeFieldStatusMap(edge.field_statuses).product_or_service ??
        fieldStatusForValue(edge.product_or_service),
      dependency_summary:
        normalizeFieldStatusMap(edge.field_statuses).dependency_summary ??
        fieldStatusForValue(edge.dependency_summary),
      directness:
        normalizeFieldStatusMap(edge.field_statuses).directness ??
        fieldStatusForValue(edge.directness),
      logistics_mode:
        normalizeFieldStatusMap(edge.field_statuses).logistics_mode ??
        fieldStatusForValue(edge.logistics_mode),
      logistics_nodes:
        normalizeFieldStatusMap(edge.field_statuses).logistics_nodes ??
        fieldStatusForValue(edge.logistics_nodes),
      chokepoints:
        normalizeFieldStatusMap(edge.field_statuses).chokepoints ??
        fieldStatusForValue(edge.chokepoints),
      exposure_regions:
        normalizeFieldStatusMap(edge.field_statuses).exposure_regions ??
        fieldStatusForValue(edge.exposure_regions),
    };

    const metadataJson = JSON.stringify({
      schema: "gwmd_edge_v1",
      gwmd_relation_type: edge.relation_type,
      source_ticker: fromTicker,
      target_ticker: toTicker,
      direction: "outbound",
      relationship_strength: edge.relationship_strength ?? edge.weight ?? null,
      source_type: edge.source_type ?? "unknown",
      source_citation: edge.source_citation ?? null,
      raw_evidence: edge.evidence ?? null,
      estimated_importance:
        edge.relationship_strength ?? edge.weight ?? edge.confidence ?? null,
      directness: edge.directness ?? null,
      related_company: {
        ticker: toTicker,
        aliases: normalizeStringArray(edge.related_company_aliases),
        industry: normalizeString(edge.related_company_industry),
      },
      geography: {
        operating_countries: normalizeStringArray(edge.operating_countries),
        facility_locations: normalizeStringArray(edge.facility_locations),
      },
      logistics: {
        mode: normalizeString(edge.logistics_mode),
        nodes: normalizeStringArray(edge.logistics_nodes),
        chokepoints: normalizeStringArray(edge.chokepoints),
      },
      exposure: {
        regions: normalizeStringArray(edge.exposure_regions),
        dependency_summary: normalizeString(edge.dependency_summary),
      },
      commercial_profile: {
        product_or_service: normalizeString(edge.product_or_service),
      },
      field_statuses: fieldStatuses,
    });

    GraphEnrichmentRepository.upsertEdge({
      id: edgeId,
      fromEntityId,
      toEntityId,
      relationType: mapRelationType(edge.relation_type),
      zone: "candidate",
      sourceType: "ai_extraction",
      sourceRef: rootTicker,
      sourceTitle: edge.source_citation ?? `GWMD relationship ${semanticKey}`,
      sourceUrl: undefined,
      aiInferred: true,
      confidenceScore: edge.confidence ?? 0.55,
      freshnessScore: 1,
      firstSeenAt: createdAt,
      lastSeenAt: createdAt,
      ttlDays: 14,
      validationStatus: "unvalidated",
      validationMethod: "gwmd_discovery_model",
      validatorType: "model",
      contradictionFlag: false,
      staleFlag: false,
      promotionEligible: false,
      metadataJson,
    });
    candidateEdgeIds.push(edgeId);
    edgeCount += 1;

    if (edge.evidence || edge.source_citation) {
      const fingerprint = hashValue(
        [
          edgeId,
          edge.source_type ?? "unknown",
          edge.source_citation ?? "",
          edge.evidence ?? "",
        ].join("|"),
      );
      const evidenceId = `gwmd:evidence:${fingerprint.slice(0, 24)}`;
      GraphEnrichmentRepository.upsertEvidence({
        evidenceId,
        sourceType: mapEvidenceSourceType(edge.source_type),
        sourceReference: edge.source_citation ?? semanticKey,
        sourceTitle: edge.source_citation ?? `GWMD evidence for ${semanticKey}`,
        sourceUrl: undefined,
        sourceKey: edge.source_citation,
        snippet: edge.evidence,
        extractedSummary: edge.evidence,
        extractionMethod: "gwmd_discovery_model",
        extractedAt: createdAt,
        fingerprintHash: fingerprint,
        qualityScore: Math.max(0.2, Math.min(1, edge.confidence ?? 0.5)),
      });
      GraphEnrichmentRepository.linkEvidence({
        targetType: "edge",
        targetId: edgeId,
        evidenceId,
      });
      evidenceCount += 1;
    }
  });

  return {
    companyEntityIdsByTicker,
    candidateEntityIds,
    candidateEdgeIds,
    entityCount,
    edgeCount,
    evidenceCount,
  };
}
