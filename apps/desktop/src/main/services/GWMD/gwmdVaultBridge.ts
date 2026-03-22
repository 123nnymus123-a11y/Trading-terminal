import { getDb } from "../../persistence/db";
import type {
  GwmdCompany,
  GwmdRelationshipEdge,
} from "./companyRelationshipService";

export type GwmdDataStatus =
  | "production"
  | "validated"
  | "candidate"
  | "contradicted"
  | "rejected"
  | "unknown";

type GraphZone = "candidate" | "validation" | "production";
type ValidationStatus =
  | "unvalidated"
  | "pending_validation"
  | "validated"
  | "contradicted"
  | "rejected";

type VaultCompanyRow = {
  entity_id: string;
  canonical_name: string;
  zone: GraphZone;
  validation_status: ValidationStatus;
  confidence_score: number;
  stale_flag: number;
  metadata_json: string | null;
};

type VaultEdgeRow = {
  edge_id: string;
  relation_type: string;
  from_entity_id: string;
  to_entity_id: string;
  zone: GraphZone;
  validation_status: ValidationStatus;
  confidence_score: number;
  stale_flag: number;
  metadata_json: string | null;
};

export type GwmdVaultCompanyMatch = {
  entityId: string;
  ticker: string;
  name: string;
  hqCity?: string;
  hqCountry?: string;
  hqLat?: number;
  hqLon?: number;
  zone: GraphZone;
  validationStatus: ValidationStatus;
  confidence: number;
  stale: boolean;
  dataStatus: GwmdDataStatus;
  metadata: Record<string, unknown>;
};

export type GwmdVaultEdgeMatch = {
  edgeId: string;
  semanticKey: string;
  fromTicker: string;
  toTicker: string;
  relationType: string;
  confidence: number;
  evidence?: string;
  sourceType?: GwmdRelationshipEdge["source_type"];
  sourceCitation?: string;
  relationshipStrength?: number;
  zone: GraphZone;
  validationStatus: ValidationStatus;
  stale: boolean;
  dataStatus: GwmdDataStatus;
  metadata: Record<string, unknown>;
};

export type GwmdResearchScope = {
  tickers: string[];
  bestCompanyByTicker: Map<string, GwmdVaultCompanyMatch>;
  allCompaniesByTicker: Map<string, GwmdVaultCompanyMatch[]>;
  bestEdgeBySemanticKey: Map<string, GwmdVaultEdgeMatch>;
  allEdgesBySemanticKey: Map<string, GwmdVaultEdgeMatch[]>;
  existingRelationshipKeys: Set<string>;
  missingFieldRefs: Array<{ ticker: string; field: string }>;
  staleFieldRefs: Array<{ ticker: string; field: string }>;
};

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

function edgeSemanticKey(
  fromTicker: string,
  toTicker: string,
  relationType: string,
): string {
  return `${normalizeTicker(fromTicker)}|${normalizeTicker(toTicker)}|${relationType.toLowerCase()}`;
}

function safeJsonParse(input: string | null): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function getNestedString(
  input: Record<string, unknown>,
  keys: string[],
): string | undefined {
  let cursor: unknown = input;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return stringValue(cursor);
}

function getNestedNumber(
  input: Record<string, unknown>,
  keys: string[],
): number | undefined {
  let cursor: unknown = input;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return numberValue(cursor);
}

function getNestedRecord(
  input: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  let cursor: unknown = input;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
    return undefined;
  }
  return cursor as Record<string, unknown>;
}

function getNestedStringArray(
  input: Record<string, unknown>,
  keys: string[],
): string[] | undefined {
  let cursor: unknown = input;
  for (const key of keys) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  if (!Array.isArray(cursor)) return undefined;
  const normalized = cursor
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
  return normalized;
}

function toDataStatus(
  zone: GraphZone,
  validationStatus: ValidationStatus,
): GwmdDataStatus {
  if (validationStatus === "rejected") return "rejected";
  if (validationStatus === "contradicted") return "contradicted";
  if (zone === "production" && validationStatus === "validated") {
    return "production";
  }
  if (
    zone === "validation" ||
    validationStatus === "pending_validation" ||
    validationStatus === "validated"
  ) {
    return "validated";
  }
  if (zone === "candidate" || validationStatus === "unvalidated") {
    return "candidate";
  }
  return "unknown";
}

function statusRank(status: GwmdDataStatus): number {
  switch (status) {
    case "production":
      return 5;
    case "validated":
      return 4;
    case "candidate":
      return 3;
    case "contradicted":
      return 2;
    case "rejected":
      return 1;
    default:
      return 0;
  }
}

function pickBestByStatus<
  T extends { dataStatus: GwmdDataStatus; confidence: number },
>(records: T[]): T | undefined {
  return [...records].sort((left, right) => {
    const statusDelta =
      statusRank(right.dataStatus) - statusRank(left.dataStatus);
    if (statusDelta !== 0) return statusDelta;
    return (right.confidence ?? 0) - (left.confidence ?? 0);
  })[0];
}

function buildTickersPlaceholders(values: string[]): string {
  return values.map(() => "?").join(",");
}

function readDb(): ReturnType<typeof getDb> | null {
  try {
    return getDb();
  } catch {
    return null;
  }
}

function hydrateVaultCompany(row: VaultCompanyRow): GwmdVaultCompanyMatch {
  const metadata = safeJsonParse(row.metadata_json);
  const ticker = normalizeTicker(
    getNestedString(metadata, ["ticker"]) ??
      getNestedString(metadata, ["identity", "ticker"]) ??
      row.canonical_name,
  );
  return {
    entityId: row.entity_id,
    ticker,
    name:
      getNestedString(metadata, ["canonical_name"]) ??
      getNestedString(metadata, ["identity", "canonical_name"]) ??
      row.canonical_name,
    hqCity:
      getNestedString(metadata, ["hq_city"]) ??
      getNestedString(metadata, ["geography", "headquarters_city"]),
    hqCountry:
      getNestedString(metadata, ["hq_country"]) ??
      getNestedString(metadata, ["geography", "headquarters_country"]),
    hqLat:
      getNestedNumber(metadata, ["hq_lat"]) ??
      getNestedNumber(metadata, [
        "geography",
        "headquarters_coordinates",
        "lat",
      ]),
    hqLon:
      getNestedNumber(metadata, ["hq_lon"]) ??
      getNestedNumber(metadata, [
        "geography",
        "headquarters_coordinates",
        "lon",
      ]),
    zone: row.zone,
    validationStatus: row.validation_status,
    confidence: row.confidence_score,
    stale: row.stale_flag === 1,
    dataStatus: toDataStatus(row.zone, row.validation_status),
    metadata,
  };
}

function hydrateVaultEdge(
  row: VaultEdgeRow,
  companyByEntityId: Map<string, GwmdVaultCompanyMatch>,
): GwmdVaultEdgeMatch | null {
  const fromCompany = companyByEntityId.get(row.from_entity_id);
  const toCompany = companyByEntityId.get(row.to_entity_id);
  if (!fromCompany || !toCompany) return null;

  const metadata = safeJsonParse(row.metadata_json);
  const relationType =
    getNestedString(metadata, ["gwmd_relation_type"]) ??
    getNestedString(metadata, ["relation_type"]) ??
    row.relation_type;
  return {
    edgeId: row.edge_id,
    semanticKey: edgeSemanticKey(
      fromCompany.ticker,
      toCompany.ticker,
      relationType,
    ),
    fromTicker: fromCompany.ticker,
    toTicker: toCompany.ticker,
    relationType,
    confidence: row.confidence_score,
    evidence:
      getNestedString(metadata, ["evidence", "quote"]) ??
      getNestedString(metadata, ["evidence", "summary"]) ??
      getNestedString(metadata, ["raw_evidence"]),
    sourceType:
      (getNestedString(metadata, ["source_type"]) as
        | GwmdRelationshipEdge["source_type"]
        | undefined) ?? undefined,
    sourceCitation: getNestedString(metadata, ["source_citation"]),
    relationshipStrength:
      getNestedNumber(metadata, ["relationship_strength"]) ??
      getNestedNumber(metadata, ["estimated_importance"]),
    zone: row.zone,
    validationStatus: row.validation_status,
    stale: row.stale_flag === 1,
    dataStatus: toDataStatus(row.zone, row.validation_status),
    metadata,
  };
}

function defaultScope(tickers: string[]): GwmdResearchScope {
  return {
    tickers,
    bestCompanyByTicker: new Map(),
    allCompaniesByTicker: new Map(),
    bestEdgeBySemanticKey: new Map(),
    allEdgesBySemanticKey: new Map(),
    existingRelationshipKeys: new Set(),
    missingFieldRefs: [],
    staleFieldRefs: [],
  };
}

export function canUseGwmdVault(): boolean {
  return readDb() !== null;
}

export function lookupGwmdResearchScope(
  inputTickers: string[],
): GwmdResearchScope {
  const tickers = [
    ...new Set(inputTickers.map(normalizeTicker).filter(Boolean)),
  ];
  const db = readDb();
  if (!db || tickers.length === 0) return defaultScope(tickers);

  const placeholders = buildTickersPlaceholders(tickers);
  const lowerTickers = tickers.map((ticker) => ticker.toLowerCase());

  const companyRows = db
    .prepare(
      `SELECT DISTINCT
         e.id AS entity_id,
         e.canonical_name,
         e.zone,
         e.validation_status,
         e.confidence_score,
         e.stale_flag,
         e.metadata_json
       FROM graph_enrichment_entity e
       WHERE e.id IN (
         SELECT entity_id
         FROM graph_enrichment_alias
         WHERE LOWER(alias) IN (${placeholders})
       )
       OR LOWER(COALESCE(
         json_extract(e.metadata_json, '$.ticker'),
         json_extract(e.metadata_json, '$.identity.ticker'),
         ''
       )) IN (${placeholders})`,
    )
    .all(...lowerTickers, ...lowerTickers) as VaultCompanyRow[];

  const companyMatches = companyRows.map(hydrateVaultCompany);
  const companyByEntityId = new Map(
    companyMatches.map((company) => [company.entityId, company]),
  );

  const scope = defaultScope(tickers);
  companyMatches.forEach((company) => {
    const list = scope.allCompaniesByTicker.get(company.ticker) ?? [];
    list.push(company);
    scope.allCompaniesByTicker.set(company.ticker, list);

    if (!company.hqCity) {
      scope.missingFieldRefs.push({ ticker: company.ticker, field: "hq_city" });
    }
    if (!company.hqCountry) {
      scope.missingFieldRefs.push({
        ticker: company.ticker,
        field: "hq_country",
      });
    }
    if (company.hqLat == null || company.hqLon == null) {
      scope.missingFieldRefs.push({
        ticker: company.ticker,
        field: "hq_coordinates",
      });
    }
    if (company.stale) {
      scope.staleFieldRefs.push({ ticker: company.ticker, field: "entity" });
    }
  });

  scope.allCompaniesByTicker.forEach((records, ticker) => {
    const best = pickBestByStatus(records);
    if (best) scope.bestCompanyByTicker.set(ticker, best);
  });

  const entityIds = companyMatches.map((company) => company.entityId);
  if (entityIds.length === 0) {
    return scope;
  }

  const edgePlaceholders = buildTickersPlaceholders(entityIds);
  const edgeRows = db
    .prepare(
      `SELECT
         ed.id AS edge_id,
         ed.relation_type,
         ed.from_entity_id,
         ed.to_entity_id,
         ed.zone,
         ed.validation_status,
         ed.confidence_score,
         ed.stale_flag,
         ed.metadata_json
       FROM graph_enrichment_edge ed
       WHERE ed.from_entity_id IN (${edgePlaceholders})
          OR ed.to_entity_id IN (${edgePlaceholders})`,
    )
    .all(...entityIds, ...entityIds) as VaultEdgeRow[];

  edgeRows.forEach((row) => {
    const hydrated = hydrateVaultEdge(row, companyByEntityId);
    if (!hydrated) return;
    const list = scope.allEdgesBySemanticKey.get(hydrated.semanticKey) ?? [];
    list.push(hydrated);
    scope.allEdgesBySemanticKey.set(hydrated.semanticKey, list);
    scope.existingRelationshipKeys.add(hydrated.semanticKey);
    if (hydrated.stale) {
      scope.staleFieldRefs.push({
        ticker: `${hydrated.fromTicker}->${hydrated.toTicker}`,
        field: "relationship",
      });
    }
  });

  scope.allEdgesBySemanticKey.forEach((records, semanticKey) => {
    const best = pickBestByStatus(records);
    if (best) scope.bestEdgeBySemanticKey.set(semanticKey, best);
  });

  return scope;
}

function mergeCompanyRecord(
  generated: GwmdCompany | undefined,
  vault: GwmdVaultCompanyMatch | undefined,
): GwmdCompany | null {
  if (!generated && !vault) return null;
  const dataStatus = vault?.dataStatus ?? generated?.data_status ?? "candidate";
  const shouldPreferVault =
    vault !== undefined &&
    vault.dataStatus !== "rejected" &&
    vault.dataStatus !== "contradicted";

  const ticker = normalizeTicker(vault?.ticker ?? generated?.ticker ?? "");
  if (!ticker) return null;
  return {
    ticker,
    name:
      (shouldPreferVault ? vault?.name : undefined) ??
      generated?.name ??
      vault?.name ??
      ticker,
    hq_lat: (shouldPreferVault ? vault?.hqLat : undefined) ?? generated?.hq_lat,
    hq_lon: (shouldPreferVault ? vault?.hqLon : undefined) ?? generated?.hq_lon,
    hq_city:
      (shouldPreferVault ? vault?.hqCity : undefined) ?? generated?.hq_city,
    hq_country:
      (shouldPreferVault ? vault?.hqCountry : undefined) ??
      generated?.hq_country,
    industry: generated?.industry,
    health_score: generated?.health_score,
    geo_source: generated?.geo_source,
    geo_confidence: generated?.geo_confidence,
    data_status: dataStatus,
  };
}

function mergeEdgeRecord(
  generated: GwmdRelationshipEdge | undefined,
  vault: GwmdVaultEdgeMatch | undefined,
): GwmdRelationshipEdge | null {
  if (!generated && !vault) return null;
  const dataStatus = vault?.dataStatus ?? generated?.data_status ?? "candidate";
  const shouldPreferVault =
    vault !== undefined &&
    vault.dataStatus !== "rejected" &&
    vault.dataStatus !== "contradicted";
  if (dataStatus === "rejected") return null;

  const vaultMetadata = vault?.metadata ?? {};
  const vaultFieldStatuses = getNestedRecord(vaultMetadata, ["field_statuses"]);

  return {
    id: generated?.id ?? vault?.edgeId ?? "",
    from_ticker: normalizeTicker(
      vault?.fromTicker ?? generated?.from_ticker ?? "",
    ),
    to_ticker: normalizeTicker(vault?.toTicker ?? generated?.to_ticker ?? ""),
    relation_type:
      (shouldPreferVault ? vault?.relationType : undefined) ??
      generated?.relation_type ??
      vault?.relationType ??
      "linked_to",
    weight:
      (shouldPreferVault ? vault?.relationshipStrength : undefined) ??
      generated?.weight,
    confidence:
      (shouldPreferVault ? vault?.confidence : undefined) ??
      generated?.confidence,
    evidence:
      (shouldPreferVault ? vault?.evidence : undefined) ?? generated?.evidence,
    entity_type: generated?.entity_type,
    source_type:
      (shouldPreferVault ? vault?.sourceType : undefined) ??
      generated?.source_type,
    source_citation:
      (shouldPreferVault ? vault?.sourceCitation : undefined) ??
      generated?.source_citation,
    relationship_strength:
      (shouldPreferVault ? vault?.relationshipStrength : undefined) ??
      generated?.relationship_strength,
    related_company_aliases:
      generated?.related_company_aliases ??
      getNestedStringArray(vaultMetadata, ["related_company", "aliases"]),
    related_company_industry:
      generated?.related_company_industry ??
      getNestedString(vaultMetadata, ["related_company", "industry"]),
    operating_countries:
      generated?.operating_countries ??
      getNestedStringArray(vaultMetadata, ["geography", "operating_countries"]),
    facility_locations:
      generated?.facility_locations ??
      getNestedStringArray(vaultMetadata, ["geography", "facility_locations"]),
    product_or_service:
      generated?.product_or_service ??
      getNestedString(vaultMetadata, [
        "commercial_profile",
        "product_or_service",
      ]),
    dependency_summary:
      generated?.dependency_summary ??
      getNestedString(vaultMetadata, ["exposure", "dependency_summary"]),
    directness:
      generated?.directness ??
      (getNestedString(vaultMetadata, ["directness"]) as
        | GwmdRelationshipEdge["directness"]
        | undefined),
    logistics_mode:
      generated?.logistics_mode ??
      (getNestedString(vaultMetadata, ["logistics", "mode"]) as
        | GwmdRelationshipEdge["logistics_mode"]
        | undefined),
    logistics_nodes:
      generated?.logistics_nodes ??
      getNestedStringArray(vaultMetadata, ["logistics", "nodes"]),
    chokepoints:
      generated?.chokepoints ??
      getNestedStringArray(vaultMetadata, ["logistics", "chokepoints"]),
    exposure_regions:
      generated?.exposure_regions ??
      getNestedStringArray(vaultMetadata, ["exposure", "regions"]),
    field_statuses:
      generated?.field_statuses ??
      (vaultFieldStatuses as
        | GwmdRelationshipEdge["field_statuses"]
        | undefined),
    data_status: dataStatus,
  };
}

export function mergeGwmdResultsWithVault(input: {
  companies: GwmdCompany[];
  edges: GwmdRelationshipEdge[];
}): {
  companies: GwmdCompany[];
  edges: GwmdRelationshipEdge[];
  scope: GwmdResearchScope;
} {
  const requestedTickers = [
    ...input.companies.map((company) => company.ticker),
    ...input.edges.flatMap((edge) => [edge.from_ticker, edge.to_ticker]),
  ];
  const scope = lookupGwmdResearchScope(requestedTickers);

  const mergedCompanies = new Map<string, GwmdCompany>();
  input.companies.forEach((company) => {
    const ticker = normalizeTicker(company.ticker);
    const merged = mergeCompanyRecord(
      company,
      scope.bestCompanyByTicker.get(ticker),
    );
    if (merged) mergedCompanies.set(ticker, merged);
  });

  scope.bestCompanyByTicker.forEach((company, ticker) => {
    if (mergedCompanies.has(ticker)) return;
    const merged = mergeCompanyRecord(undefined, company);
    if (merged) mergedCompanies.set(ticker, merged);
  });

  const mergedEdges = new Map<string, GwmdRelationshipEdge>();
  input.edges.forEach((edge) => {
    const semanticKey = edgeSemanticKey(
      edge.from_ticker,
      edge.to_ticker,
      edge.relation_type,
    );
    const merged = mergeEdgeRecord(
      edge,
      scope.bestEdgeBySemanticKey.get(semanticKey),
    );
    if (merged) mergedEdges.set(semanticKey, merged);
  });

  scope.bestEdgeBySemanticKey.forEach((edge, semanticKey) => {
    if (mergedEdges.has(semanticKey)) return;
    const merged = mergeEdgeRecord(undefined, edge);
    if (merged) mergedEdges.set(semanticKey, merged);
  });

  return {
    companies: Array.from(mergedCompanies.values()),
    edges: Array.from(mergedEdges.values()),
    scope,
  };
}
