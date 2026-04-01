/**
 * GWMD Map Store
 * Manages company relationships, graph visualization, and search state
 * Persists to SQLite and browser memory
 */

import { create } from "zustand";
import type { DependencyKind, SupplyChainGraph } from "@tc/shared/supplyChain";
import { authRequest } from "../lib/apiClient";
import { encodeGeoPlaceCode, makeAddressPlaceCode } from "../lib/gwmdPlaceCode";

type GwmdAiModelSelection =
  | string
  | {
      provider?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  | null
  | undefined;

type GwmdAiModelSelection =
  | string
  | {
      provider?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
    }
  | null
  | undefined;

const isGwmdDebugEnabled = () => {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return window.sessionStorage.getItem("gwmd:debug") === "1";
};

const gwmdDebugLog = (...args: unknown[]) => {
  if (!isGwmdDebugEnabled()) return;
  console.log(...args);
};

const toErrorMessage = (value: unknown): string =>
  value instanceof Error ? value.message : String(value);

export interface GwmdCompany {
  ticker: string;
  name: string;
  hqLat?: number;
  hqLon?: number;
  hqPlaceCode?: string;
  hqAddress?: string;
  hqCity?: string;
  hqCountry?: string;
  industry?: string;
  healthScore?: number;
  geoSource?: string;
  geoConfidence?: number;
  dataStatus?: string;
}

type GwmdRunStatus = "idle" | "ok" | "degraded_cache" | "parse_fail" | "error";
export type GwmdSourceMode = "cache_only" | "hybrid" | "fresh";

type GwmdRawCompany = {
  ticker: string;
  name: string;
  confidence?: number;
  hq_lat?: number;
  hq_lon?: number;
  hq_city?: string;
  hq_country?: string;
  hq_place_code?: string;
  hq_address?: string;
  hqLat?: number;
  hqLon?: number;
  hqPlaceCode?: string;
  hqAddress?: string;
  hqCity?: string;
  hqCountry?: string;
  industry?: string;
  geo_source?: string;
  geoSource?: string;
  geo_confidence?: number;
  geoConfidence?: number;
  data_status?: string;
  dataStatus?: string;
};

type GwmdRawEdge = {
  id?: string;
  from_ticker?: string;
  to_ticker?: string;
  relation_type?: string;
  from?: string;
  to?: string;
  kind?: string;
  source?: string;
  target?: string;
  type?: string;
  weight?: number;
  confidence?: number;
  evidence?: string;
  source_type?: string;
  sourceType?: string;
  source_citation?: string;
  sourceCitation?: string;
  relationship_strength?: number;
  relationshipStrength?: number;
  directness?: string;
  product_or_service?: string;
  productOrService?: string;
  dependency_summary?: string;
  dependencySummary?: string;
  logistics_mode?: string;
  logisticsMode?: string;
  logistics_nodes?: string[];
  logisticsNodes?: string[];
  chokepoints?: string[];
  exposure_regions?: string[];
  exposureRegions?: string[];
  related_company_aliases?: string[];
  relatedCompanyAliases?: string[];
  related_company_industry?: string;
  relatedCompanyIndustry?: string;
  field_statuses?: Record<string, unknown>;
  fieldStatuses?: Record<string, unknown>;
  data_status?: string;
  dataStatus?: string;
  metadata?: Record<string, unknown>;
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
  graph?: {
    nodes: SupplyChainGraph["nodes"];
    edges: SupplyChainGraph["edges"];
  } | null;
  meta?: { unlocatedCount?: number };
  error?: string;
};

type GwmdLoadScopedResult = {
  success: boolean;
  status?: "ok" | "error";
  companies?: Array<Record<string, unknown>>;
  graph?: {
    nodes: SupplyChainGraph["nodes"];
    edges: SupplyChainGraph["edges"];
  } | null;
  meta?: Record<string, unknown>;
  error?: string;
};

type GwmdCloudStatus = {
  cloudVersion?: number;
  lastSyncAt?: string | null;
  companiesCount?: number;
  relationshipsCount?: number;
  syncStatus?: "idle" | "syncing" | "ok" | "error";
};

type GwmdCloudSyncPushResponse = {
  ok: boolean;
  applied?: { companies?: number; relationships?: number };
  status?: GwmdCloudStatus;
};

type GwmdCloudSyncPullResponse = {
  ok: boolean;
  data?: {
    companies?: Array<Record<string, unknown>>;
    relationships?: Array<Record<string, unknown>>;
  };
  status?: GwmdCloudStatus;
};

type GwmdCloudSyncStatusResponse = {
  ok: boolean;
  status?: GwmdCloudStatus;
};

const toNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const toString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const normalizeTicker = (value: string) => value.trim().toUpperCase();
const semanticEdgeKey = (edge: { from: string; to: string; kind: string }) =>
  `${normalizeTicker(edge.from)}|${normalizeTicker(edge.to)}|${edge.kind.toLowerCase()}`;

const buildAddressLabel = (
  city?: string,
  country?: string,
): string | undefined => {
  const parts = [city, country]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .map((part) => part.trim());
  if (parts.length === 0) return undefined;
  return parts.join(", ");
};

const normalizeEdgeKind = (value: unknown): DependencyKind | null => {
  if (typeof value !== "string") return null;
  const kind = value.trim().toLowerCase();
  switch (kind) {
    case "supplies":
    case "manufactures":
    case "assembles":
    case "hosts":
    case "distributes":
    case "transports":
    case "regulates":
    case "finances":
    case "licenses":
    case "supports":
    case "supplier":
    case "customer":
    case "partner":
    case "license":
    case "litigation":
    case "financing":
    case "competitor":
    case "regulatory":
    case "other":
      return kind;
    default:
      return null;
  }
};

const toCloudRelationType = (
  kind: string,
):
  | "supplier"
  | "customer"
  | "partner"
  | "competitor"
  | "financing"
  | "license" => {
  switch (kind) {
    case "supplier":
    case "supplies":
    case "manufactures":
    case "assembles":
    case "transports":
    case "distributes":
    case "supports":
      return "supplier";
    case "customer":
      return "customer";
    case "finances":
    case "financing":
      return "financing";
    case "licenses":
    case "license":
      return "license";
    case "competitor":
      return "competitor";
    default:
      return "partner";
  }
};

const normalizeCloudSnapshot = (payload?: {
  companies?: Array<Record<string, unknown>>;
  relationships?: Array<Record<string, unknown>>;
}) => {
  const companies = (payload?.companies ?? [])
    .map((raw) => normalizeGwmdCompany(raw))
    .filter((company): company is GwmdCompany => company !== null);

  const edges = (payload?.relationships ?? [])
    .map((edge) =>
      normalizeGwmdEdge({
        from_ticker: toString(edge.from_ticker),
        to_ticker: toString(edge.to_ticker),
        relation_type: toString(edge.relation_type),
        weight: toNumber(edge.weight),
        confidence: toNumber(edge.confidence),
        evidence: toString(edge.evidence),
        id: toString(edge.id),
      }),
    )
    .filter((edge): edge is SupplyChainGraph["edges"][number] => edge !== null);

  return {
    companies,
    graph: {
      nodes: buildGraphNodesFromCompanies(companies),
      edges,
    },
  };
};

const mergeCloudSnapshotIntoState = (
  current: GwmdMapState,
  incoming: {
    companies: GwmdCompany[];
    graph: {
      nodes: SupplyChainGraph["nodes"];
      edges: SupplyChainGraph["edges"];
    };
  },
  replace: boolean,
) => {
  if (replace) {
    return {
      companies: incoming.companies,
      graph: incoming.graph,
    };
  }

  const companyMap = new Map(
    current.companies.map((company) => [
      normalizeTicker(company.ticker),
      company,
    ]),
  );
  incoming.companies.forEach((company) => {
    const key = normalizeTicker(company.ticker);
    const existing = companyMap.get(key);
    companyMap.set(key, {
      ...(existing ?? {}),
      ...company,
      ticker: key,
      name: company.name || existing?.name || key,
    });
  });

  const mergedCompanies = Array.from(companyMap.values());

  const currentEdges = current.graph?.edges ?? [];
  const edgeMap = new Map(
    currentEdges.map((edge) => [
      semanticEdgeKey({ from: edge.from, to: edge.to, kind: edge.kind }),
      edge,
    ]),
  );
  incoming.graph.edges.forEach((edge) => {
    edgeMap.set(
      semanticEdgeKey({ from: edge.from, to: edge.to, kind: edge.kind }),
      edge,
    );
  });

  return {
    companies: mergedCompanies,
    graph: {
      nodes: buildGraphNodesFromCompanies(mergedCompanies),
      edges: Array.from(edgeMap.values()),
    },
  };
};

const normalizeGwmdEdge = (
  value: GwmdRawEdge | Record<string, unknown>,
): SupplyChainGraph["edges"][number] | null => {
  const rawMetadata =
    typeof (value as GwmdRawEdge).metadata === "object" &&
    (value as GwmdRawEdge).metadata !== null
      ? ((value as GwmdRawEdge).metadata as Record<string, unknown>)
      : undefined;
  const fromRaw =
    toString((value as GwmdRawEdge).from) ??
    toString((value as GwmdRawEdge).from_ticker) ??
    toString((value as GwmdRawEdge).source);
  const toRaw =
    toString((value as GwmdRawEdge).to) ??
    toString((value as GwmdRawEdge).to_ticker) ??
    toString((value as GwmdRawEdge).target);
  const kindRaw =
    toString((value as GwmdRawEdge).kind) ??
    toString((value as GwmdRawEdge).relation_type) ??
    toString((value as GwmdRawEdge).type);

  if (!fromRaw || !toRaw || !kindRaw) return null;

  const kind = normalizeEdgeKind(kindRaw);
  if (!kind) return null;

  const from = normalizeTicker(fromRaw);
  const to = normalizeTicker(toRaw);
  if (!from || !to || from === to) return null;

  const confidence =
    toNumber((value as GwmdRawEdge).confidence) ??
    toNumber((value as GwmdRawEdge).weight) ??
    0.5;
  const weight = toNumber((value as GwmdRawEdge).weight);
  const rawId = toString((value as GwmdRawEdge).id);
  const id = rawId && rawId.trim().length > 0 ? rawId : `${from}-${to}-${kind}`;
  const evidence = toString((value as GwmdRawEdge).evidence) ?? "";

  const metadata: Record<string, unknown> = {
    ...(rawMetadata ?? {}),
  };
  const relationType =
    toString((value as GwmdRawEdge).relation_type) ??
    toString((value as GwmdRawEdge).type);
  const sourceType =
    toString((value as GwmdRawEdge).source_type) ??
    toString((value as GwmdRawEdge).sourceType);
  const sourceCitation =
    toString((value as GwmdRawEdge).source_citation) ??
    toString((value as GwmdRawEdge).sourceCitation);
  const relationshipStrength =
    toNumber((value as GwmdRawEdge).relationship_strength) ??
    toNumber((value as GwmdRawEdge).relationshipStrength);
  const directness = toString((value as GwmdRawEdge).directness);
  const productOrService =
    toString((value as GwmdRawEdge).product_or_service) ??
    toString((value as GwmdRawEdge).productOrService);
  const dependencySummary =
    toString((value as GwmdRawEdge).dependency_summary) ??
    toString((value as GwmdRawEdge).dependencySummary);
  const logisticsMode =
    toString((value as GwmdRawEdge).logistics_mode) ??
    toString((value as GwmdRawEdge).logisticsMode);
  const logisticsNodes =
    (value as GwmdRawEdge).logistics_nodes ??
    (value as GwmdRawEdge).logisticsNodes ??
    [];
  const chokepoints = (value as GwmdRawEdge).chokepoints ?? [];
  const exposureRegions =
    (value as GwmdRawEdge).exposure_regions ??
    (value as GwmdRawEdge).exposureRegions ??
    [];
  const relatedCompanyAliases =
    (value as GwmdRawEdge).related_company_aliases ??
    (value as GwmdRawEdge).relatedCompanyAliases ??
    [];
  const relatedCompanyIndustry =
    toString((value as GwmdRawEdge).related_company_industry) ??
    toString((value as GwmdRawEdge).relatedCompanyIndustry);
  const fieldStatuses =
    (value as GwmdRawEdge).field_statuses ??
    (value as GwmdRawEdge).fieldStatuses ??
    (rawMetadata?.fieldStatuses as Record<string, unknown> | undefined) ??
    (rawMetadata?.field_statuses as Record<string, unknown> | undefined);
  const dataStatus =
    toString((value as GwmdRawEdge).data_status) ??
    toString((value as GwmdRawEdge).dataStatus) ??
    toString(rawMetadata?.dataStatus) ??
    toString(rawMetadata?.data_status);

  if (relationType) metadata.relationType = relationType;
  if (sourceType) metadata.sourceType = sourceType;
  if (sourceCitation) metadata.sourceCitation = sourceCitation;
  if (relationshipStrength !== undefined) {
    metadata.relationshipStrength = relationshipStrength;
  }
  if (directness) metadata.directness = directness;
  if (productOrService) metadata.productOrService = productOrService;
  if (dependencySummary) metadata.dependencySummary = dependencySummary;
  if (logisticsMode) metadata.logisticsMode = logisticsMode;
  if (Array.isArray(logisticsNodes)) metadata.logisticsNodes = logisticsNodes;
  if (Array.isArray(chokepoints)) metadata.chokepoints = chokepoints;
  if (Array.isArray(exposureRegions))
    metadata.exposureRegions = exposureRegions;
  if (Array.isArray(relatedCompanyAliases)) {
    metadata.relatedCompanyAliases = relatedCompanyAliases;
  }
  if (relatedCompanyIndustry) {
    metadata.relatedCompanyIndustry = relatedCompanyIndustry;
  }
  if (fieldStatuses && typeof fieldStatuses === "object") {
    metadata.fieldStatuses = fieldStatuses;
  }
  if (dataStatus) metadata.dataStatus = dataStatus;

  return {
    id,
    from,
    to,
    kind,
    confidence,
    ...(weight !== undefined ? { weight } : {}),
    ...(evidence ? { explanation: evidence } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
};

const normalizeGwmdCompany = (
  value: Record<string, unknown>,
): GwmdCompany | null => {
  const ticker = toString(value.ticker);
  const name = toString(value.name);
  if (!ticker || !name) return null;

  const hqLat = toNumber(value.hqLat) ?? toNumber(value.hq_lat);
  const hqLon = toNumber(value.hqLon) ?? toNumber(value.hq_lon);
  const hqPlaceCode =
    toString(value.hqPlaceCode) ?? toString(value.hq_place_code);
  const hqAddress = toString(value.hqAddress) ?? toString(value.hq_address);
  const hqCity = toString(value.hqCity) ?? toString(value.hq_city);
  const hqCountry = toString(value.hqCountry) ?? toString(value.hq_country);
  const industry = toString(value.industry);
  const healthScore =
    toNumber(value.healthScore) ?? toNumber(value.health_score);
  const geoSource = toString(value.geoSource) ?? toString(value.geo_source);
  const geoConfidence =
    toNumber(value.geoConfidence) ?? toNumber(value.geo_confidence);
  const dataStatus = toString(value.dataStatus) ?? toString(value.data_status);

  return {
    ticker: normalizeTicker(ticker),
    name,
    ...(hqLat !== undefined ? { hqLat } : {}),
    ...(hqLon !== undefined ? { hqLon } : {}),
    ...(hqPlaceCode ? { hqPlaceCode } : {}),
    ...(hqAddress ? { hqAddress } : {}),
    ...(hqCity ? { hqCity } : {}),
    ...(hqCountry ? { hqCountry } : {}),
    ...(industry ? { industry } : {}),
    ...(healthScore !== undefined ? { healthScore } : {}),
    ...(geoSource ? { geoSource } : {}),
    ...(geoConfidence !== undefined ? { geoConfidence } : {}),
    ...(dataStatus ? { dataStatus } : {}),
  };
};

// Country centroid coordinates used as display-only fallback when a company
// has no geocoded coordinates but has a known hqCountry.  These are NOT written
// to the database — they exist purely to render the node on the map at a
// rough country-centre position, clearly marked as "country_centroid" geo source.
const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  "united states": [38.8951, -77.0364],
  usa: [38.8951, -77.0364],
  us: [38.8951, -77.0364],
  "united kingdom": [51.5074, -0.1278],
  uk: [51.5074, -0.1278],
  "great britain": [51.5074, -0.1278],
  germany: [52.52, 13.405],
  deutschland: [52.52, 13.405],
  france: [48.8566, 2.3522],
  japan: [35.6895, 139.6917],
  china: [39.9042, 116.4074],
  prc: [39.9042, 116.4074],
  taiwan: [25.0478, 121.5319],
  "south korea": [37.5665, 126.978],
  korea: [37.5665, 126.978],
  netherlands: [52.3702, 4.8952],
  holland: [52.3702, 4.8952],
  switzerland: [46.9481, 7.4474],
  sweden: [59.3293, 18.0686],
  denmark: [55.6761, 12.5683],
  norway: [59.9139, 10.7522],
  finland: [60.1699, 24.9384],
  austria: [48.2082, 16.3738],
  belgium: [50.8503, 4.3517],
  ireland: [53.3498, -6.2603],
  italy: [41.9028, 12.4964],
  spain: [40.4168, -3.7038],
  portugal: [38.7223, -9.1393],
  canada: [45.4215, -75.6919],
  australia: [-33.8688, 151.2093],
  "new zealand": [-36.8485, 174.7633],
  singapore: [1.3521, 103.8198],
  "hong kong": [22.3193, 114.1694],
  india: [28.6189, 77.209],
  indonesia: [-6.2088, 106.8456],
  malaysia: [3.1412, 101.6865],
  thailand: [13.7563, 100.5018],
  vietnam: [21.0245, 105.8412],
  philippines: [14.5995, 120.9842],
  brazil: [-15.7975, -47.8919],
  mexico: [19.4326, -99.1332],
  argentina: [-34.6037, -58.3816],
  chile: [-33.4489, -70.6693],
  colombia: [4.711, -74.0721],
  peru: [-12.0464, -77.0428],
  israel: [31.7683, 35.2137],
  "saudi arabia": [24.7136, 46.6753],
  uae: [25.2048, 55.2708],
  "united arab emirates": [25.2048, 55.2708],
  turkey: [39.9334, 32.8597],
  turkiye: [39.9334, 32.8597],
  russia: [55.7558, 37.6176],
  poland: [52.2297, 21.0122],
  "czech republic": [50.0755, 14.4378],
  czechia: [50.0755, 14.4378],
  hungary: [47.4979, 19.0402],
  romania: [44.4268, 26.1025],
  ukraine: [50.4501, 30.5234],
  greece: [37.9838, 23.7275],
  "south africa": [-25.7479, 28.2293],
  nigeria: [6.5244, 3.3792],
  kenya: [-1.2921, 36.8219],
  egypt: [30.0444, 31.2357],
  morocco: [33.9716, -6.8498],
  ghana: [5.6037, -0.187],
  ethiopia: [8.9806, 38.7578],
  tanzania: [-6.369, 34.8888],
  pakistan: [33.6844, 73.0479],
  bangladesh: [23.8103, 90.4125],
  "sri lanka": [6.9271, 79.8612],
  myanmar: [16.8661, 96.1951],
  cambodia: [11.5564, 104.9282],
  laos: [17.9757, 102.6331],
  nepal: [27.7172, 85.324],
  kazakhstan: [51.1801, 71.4598],
  uzbekistan: [41.2995, 69.2401],
  iraq: [33.3152, 44.3661],
  iran: [35.6892, 51.389],
  qatar: [25.2854, 51.5311],
  kuwait: [29.3759, 47.9774],
  bahrain: [26.2154, 50.5832],
  jordan: [31.9566, 35.9456],
  lebanon: [33.8886, 35.4955],
  oman: [23.5859, 58.4059],
  yemen: [15.3694, 44.191],
  libya: [32.9001, 13.1808],
  tunisia: [36.8065, 10.1815],
  algeria: [36.7538, 3.0588],
  zimbabwe: [-17.8252, 31.0335],
  zambia: [-15.3875, 28.3228],
  mozambique: [-25.9692, 32.5732],
  angola: [-8.836, 13.2344],
  cameroon: [3.848, 11.5021],
  "ivory coast": [5.354, -4.0083],
  senegal: [14.7167, -17.4677],
  venezuela: [10.4806, -66.9036],
  ecuador: [-0.2299, -78.5249],
  bolivia: [-16.5, -68.15],
  paraguay: [-25.2867, -57.647],
  uruguay: [-34.9011, -56.1645],
  "costa rica": [9.9282, -84.0907],
  panama: [8.9936, -79.5197],
  guatemala: [14.6349, -90.5069],
  honduras: [14.0818, -87.2068],
  "el salvador": [13.6929, -89.2182],
  nicaragua: [12.1149, -86.2362],
  cuba: [23.1136, -82.3666],
  "dominican republic": [18.4861, -69.9312],
  jamaica: [17.9712, -76.7936],
  haiti: [18.5425, -72.3386],
  "trinidad and tobago": [10.652, -61.4789],
};

function getCountryCentroid(country: string): [number, number] | null {
  const key = country.trim().toLowerCase();
  return COUNTRY_CENTROIDS[key] ?? null;
}

const buildGraphNodesFromCompanies = (
  companies: GwmdCompany[],
): SupplyChainGraph["nodes"] =>
  companies.map((company) => {
    const ticker = normalizeTicker(company.ticker);

    // Resolve an effective place code for map rendering (instead of raw lat/lon fields).
    let effectivePlaceCode = company.hqPlaceCode;
    let effectiveAddress = company.hqAddress;
    let effectiveGeoSource = company.geoSource;
    let effectiveGeoConfidence = company.geoConfidence;

    const hasStoredCoords =
      Number.isFinite(company.hqLat) && Number.isFinite(company.hqLon);
    if (!effectivePlaceCode && hasStoredCoords) {
      effectivePlaceCode = encodeGeoPlaceCode(
        company.hqLat as number,
        company.hqLon as number,
      );
    }

    if (!effectiveAddress) {
      effectiveAddress = buildAddressLabel(company.hqCity, company.hqCountry);
    }

    if (!hasStoredCoords && company.hqCountry) {
      const centroid = getCountryCentroid(company.hqCountry);
      if (centroid) {
        if (!effectivePlaceCode) {
          effectivePlaceCode = encodeGeoPlaceCode(centroid[0], centroid[1]);
        }
        effectiveGeoSource = "country_centroid";
        effectiveGeoConfidence = 0.2;
      }
    }

    if (!effectivePlaceCode) {
      effectivePlaceCode = makeAddressPlaceCode([
        company.hqCity,
        company.hqCountry,
        company.name,
      ]);
    }

    const entityType =
      company.industry === "Facility"
        ? ("facility" as const)
        : company.industry === "Infrastructure"
          ? ("infrastructure" as const)
          : ("company" as const);

    return {
      id: ticker,
      label: company.name,
      tickers: [ticker],
      entityType,
      tier: "direct" as const,
      confidence: company.healthScore ?? 1,
      metadata: {
        ...(effectivePlaceCode !== undefined
          ? { hqPlaceCode: effectivePlaceCode }
          : {}),
        ...(effectiveAddress !== undefined
          ? { hqAddress: effectiveAddress }
          : {}),
        ...(company.hqCity !== undefined ? { hqCity: company.hqCity } : {}),
        ...(company.hqCountry !== undefined
          ? { hqCountry: company.hqCountry }
          : {}),
        ...(company.industry !== undefined
          ? { industry: company.industry }
          : {}),
        ...(effectiveGeoSource !== undefined
          ? { geoSource: effectiveGeoSource }
          : {}),
        ...(effectiveGeoConfidence !== undefined
          ? { geoConfidence: effectiveGeoConfidence }
          : {}),
        ...(company.dataStatus !== undefined
          ? { dataStatus: company.dataStatus }
          : {}),
      },
    };
  });

export interface GwmdMapState {
  // Search and loading
  searchTicker: string | null;
  loading: boolean;
  error: string | null;
  runStatus: GwmdRunStatus;
  runMeta: Record<string, unknown> | null;
  searchTrace: {
    ticker: string | null;
    phase:
      | "idle"
      | "hydrating"
      | "ipc_pending"
      | "ipc_timeout"
      | "http_fallback"
      | "waiting_ipc_after_503"
      | "success"
      | "error";
    source: "unknown" | "ipc" | "http" | "supplyChainIpc" | "cache";
    message: string;
    updatedAt: number;
  };

  // Data
  graph: {
    nodes: SupplyChainGraph["nodes"];
    edges: SupplyChainGraph["edges"];
  } | null;
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
    hops: number;
    minConfidence: number;
    showUnresolved: boolean;
    sourceMode: GwmdSourceMode;
  };
  syncState: {
    busy: boolean;
    mode: "idle" | "pushing" | "pulling";
    status: "idle" | "syncing" | "ok" | "error";
    cloudVersion: number;
    lastSyncAt: string | null;
    companiesCount: number;
    relationshipsCount: number;
    message: string | null;
  };

  // Actions
  setSearchTicker: (ticker: string | null) => void;
  setLoading: (value: boolean) => void;
  setError: (error: string | null) => void;
  setGraph: (
    graph: {
      nodes: SupplyChainGraph["nodes"];
      edges: SupplyChainGraph["edges"];
    } | null,
  ) => void;
  setCompanies: (companies: GwmdCompany[]) => void;
  addCompanies: (companies: Array<GwmdCompany | GwmdRawCompany>) => void;
  addEdges: (edges: SupplyChainGraph["edges"]) => void;
  setShowEmpty: (value: boolean) => void;
  setSelectedNode: (nodeId: string | null) => void;
  setSelectedEdge: (edgeId: string | null) => void;
  setGwmdFilters: (filters: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
    hops: number;
    minConfidence: number;
    showUnresolved: boolean;
    sourceMode: GwmdSourceMode;
  }) => void;
  pushToCloud: (replace?: boolean) => Promise<void>;
  pullFromCloud: (options?: {
    since?: string;
    replace?: boolean;
  }) => Promise<void>;
  refreshCloudSyncStatus: () => Promise<void>;

  // Complex actions
  search: (
    ticker: string,
    options: {
      model: GwmdAiModelSelection;
      hops?: number;
      sourceMode?: GwmdSourceMode;
    },
  ) => Promise<void>;
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
  searchTrace: {
    ticker: null,
    phase: "idle",
    source: "unknown",
    message: "Idle",
    updatedAt: Date.now(),
  },
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
    hops: 2,
    minConfidence: 0,
    showUnresolved: true,
    sourceMode: "hybrid",
  },
  syncState: {
    busy: false,
    mode: "idle",
    status: "idle",
    cloudVersion: 0,
    lastSyncAt: null,
    companiesCount: 0,
    relationshipsCount: 0,
    message: null,
  },

  setSearchTicker: (ticker) => set({ searchTicker: ticker }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setGraph: (graph) => set({ graph }),
  setCompanies: (companies) => {
    const normalized = (companies as unknown as Array<Record<string, unknown>>)
      .map((item) => normalizeGwmdCompany(item))
      .filter((company): company is GwmdCompany => company !== null);
    set({ companies: normalized });
  },
  addCompanies: (newCompanies) => {
    const current = get().companies;
    const map = new Map(
      current.map((c) => [
        normalizeTicker(c.ticker),
        { ...c, ticker: normalizeTicker(c.ticker) },
      ]),
    );
    (newCompanies as Array<Record<string, unknown>>).forEach((rawCompany) => {
      const normalized = normalizeGwmdCompany(rawCompany);
      if (!normalized) return;
      map.set(normalizeTicker(normalized.ticker), {
        ...(map.get(normalizeTicker(normalized.ticker)) ?? {}),
        ...normalized,
        ticker: normalizeTicker(normalized.ticker),
      });
    });
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
      normalized.forEach((edge) =>
        map.set(
          semanticEdgeKey({ from: edge.from, to: edge.to, kind: edge.kind }),
          edge,
        ),
      );
      set({ graph: { nodes: [], edges: Array.from(map.values()) } });
      return;
    }

    const edgeMap = new Map(
      currentGraph.edges.map((edge) => [
        semanticEdgeKey({ from: edge.from, to: edge.to, kind: edge.kind }),
        {
          ...edge,
          from: normalizeTicker(edge.from),
          to: normalizeTicker(edge.to),
        },
      ]),
    );
    newEdges.forEach((edge) => {
      const normalized = {
        ...edge,
        from: normalizeTicker(edge.from),
        to: normalizeTicker(edge.to),
      };
      edgeMap.set(
        semanticEdgeKey({
          from: normalized.from,
          to: normalized.to,
          kind: normalized.kind,
        }),
        normalized,
      );
    });
    currentGraph.edges = Array.from(edgeMap.values());

    set({ graph: { ...currentGraph } });
  },
  setShowEmpty: (showEmpty) => set({ showEmpty }),
  setSelectedNode: (nodeId) =>
    set({ selectedNodeId: nodeId, selectedEdgeId: null }),
  setSelectedEdge: (edgeId) =>
    set({ selectedEdgeId: edgeId, selectedNodeId: null }),
  setGwmdFilters: (gwmdFilters) => set({ gwmdFilters }),

  pushToCloud: async (replace = true) => {
    const syncPush = window.cockpit?.gwmdMap?.syncPush;

    try {
      set((state) => ({
        syncState: {
          ...state.syncState,
          busy: true,
          mode: "pushing",
          message: null,
        },
      }));

      const state = get();
      const companyMap = new Map<string, GwmdCompany>();
      state.companies.forEach((company) => {
        const ticker = normalizeTicker(company.ticker);
        companyMap.set(ticker, { ...company, ticker });
      });

      (state.graph?.nodes ?? []).forEach((node) => {
        const ticker = normalizeTicker(node.id);
        const metadata = (node.metadata ?? {}) as {
          hqLat?: number;
          hqLon?: number;
          hqCity?: string;
          hqCountry?: string;
          industry?: string;
        };
        const existing = companyMap.get(ticker);
        companyMap.set(ticker, {
          ticker,
          name: existing?.name ?? node.label,
          hqLat: existing?.hqLat ?? metadata.hqLat,
          hqLon: existing?.hqLon ?? metadata.hqLon,
          hqCity: existing?.hqCity ?? metadata.hqCity,
          hqCountry: existing?.hqCountry ?? metadata.hqCountry,
          industry: existing?.industry ?? metadata.industry,
          healthScore: existing?.healthScore,
        });
      });

      const companiesPayload = Array.from(companyMap.values()).map(
        (company) => ({
          ticker: normalizeTicker(company.ticker),
          name: company.name,
          ...(company.hqLat !== undefined ? { hq_lat: company.hqLat } : {}),
          ...(company.hqLon !== undefined ? { hq_lon: company.hqLon } : {}),
          ...(company.hqCity !== undefined ? { hq_city: company.hqCity } : {}),
          ...(company.hqCountry !== undefined
            ? { hq_country: company.hqCountry }
            : {}),
          ...(company.industry !== undefined
            ? { industry: company.industry }
            : {}),
          ...(company.healthScore !== undefined
            ? { health_score: company.healthScore }
            : {}),
        }),
      );

      const relationshipsPayload = (state.graph?.edges ?? []).map(
        (edge, index) => {
          const normalizedRelationType = toCloudRelationType(edge.kind);

          const evidenceText = Array.isArray(edge.evidence)
            ? edge.evidence
                .map((item) => item.snippet)
                .filter(
                  (snippet): snippet is string =>
                    typeof snippet === "string" && snippet.length > 0,
                )
                .slice(0, 3)
                .join(" | ")
            : undefined;

          return {
            id:
              edge.id ||
              `${normalizeTicker(edge.from)}-${normalizeTicker(edge.to)}-${edge.kind}-${index}`,
            from_ticker: normalizeTicker(edge.from),
            to_ticker: normalizeTicker(edge.to),
            relation_type: normalizedRelationType,
            ...(edge.weight !== undefined ? { weight: edge.weight } : {}),
            ...(edge.confidence !== undefined
              ? { confidence: edge.confidence }
              : {}),
            ...(evidenceText !== undefined ? { evidence: evidenceText } : {}),
          };
        },
      );

      const result = syncPush
        ? await syncPush({
            companies: companiesPayload,
            relationships: relationshipsPayload,
            replace,
          })
        : await (async () => {
            const response = await authRequest<GwmdCloudSyncPushResponse>(
              "/api/ai/gwmd/sync/push",
              {
                method: "POST",
                body: JSON.stringify({
                  companies: companiesPayload,
                  relationships: relationshipsPayload,
                  replace,
                }),
              },
            );
            if (!response.ok) {
              return {
                success: false,
                error: "Failed to sync GWMD data to cloud",
              };
            }
            return {
              success: true,
              status: response.status,
              applied: response.applied,
            };
          })();

      if (!result?.success || !result.status) {
        throw new Error(result?.error || "Failed to sync GWMD data to cloud");
      }

      set((current) => ({
        syncState: {
          ...current.syncState,
          busy: false,
          mode: "idle",
          status: result.status?.syncStatus ?? "ok",
          cloudVersion:
            result.status?.cloudVersion ?? current.syncState.cloudVersion,
          lastSyncAt: result.status?.lastSyncAt ?? current.syncState.lastSyncAt,
          companiesCount:
            result.status?.companiesCount ?? current.syncState.companiesCount,
          relationshipsCount:
            result.status?.relationshipsCount ??
            current.syncState.relationshipsCount,
          message: `Pushed ${result.applied?.companies ?? 0} companies and ${result.applied?.relationships ?? 0} relationships`,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) => ({
        syncState: {
          ...state.syncState,
          busy: false,
          mode: "idle",
          status: "error",
          message,
        },
      }));
      throw err;
    }
  },

  pullFromCloud: async (options = {}) => {
    const syncPull = window.cockpit?.gwmdMap?.syncPull;

    try {
      set((state) => ({
        syncState: {
          ...state.syncState,
          busy: true,
          mode: "pulling",
          message: null,
        },
      }));

      const result = syncPull
        ? await syncPull({
            ...(options.since ? { since: options.since } : {}),
            replace: options.replace ?? true,
          })
        : await (async () => {
            const query = options.since
              ? `?since=${encodeURIComponent(options.since)}`
              : "";
            const response = await authRequest<GwmdCloudSyncPullResponse>(
              `/api/ai/gwmd/sync/pull${query}`,
              { method: "GET" },
            );
            if (!response.ok) {
              return {
                success: false,
                error: "Failed to pull GWMD data from cloud",
              };
            }
            return {
              success: true,
              status: response.status,
              data: response.data,
              pulled: {
                companies: response.data?.companies?.length ?? 0,
                relationships: response.data?.relationships?.length ?? 0,
              },
            };
          })();

      if (!result?.success || !result.status) {
        throw new Error(result?.error || "Failed to pull GWMD data from cloud");
      }

      if (syncPull) {
        await get().loadFromDb();
      } else {
        const replace = options.replace ?? true;
        const cloudData = (
          result as { data?: GwmdCloudSyncPullResponse["data"] }
        ).data;
        const normalizedSnapshot = normalizeCloudSnapshot(cloudData);
        const merged = mergeCloudSnapshotIntoState(
          get(),
          normalizedSnapshot,
          replace,
        );
        set({
          companies: merged.companies,
          graph: merged.graph,
          runStatus: "ok",
          showEmpty: false,
        });
      }

      set((current) => ({
        syncState: {
          ...current.syncState,
          busy: false,
          mode: "idle",
          status: result.status?.syncStatus ?? "ok",
          cloudVersion:
            result.status?.cloudVersion ?? current.syncState.cloudVersion,
          lastSyncAt: result.status?.lastSyncAt ?? current.syncState.lastSyncAt,
          companiesCount:
            result.status?.companiesCount ?? current.syncState.companiesCount,
          relationshipsCount:
            result.status?.relationshipsCount ??
            current.syncState.relationshipsCount,
          message: `Pulled ${result.pulled?.companies ?? 0} companies and ${result.pulled?.relationships ?? 0} relationships`,
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((state) => ({
        syncState: {
          ...state.syncState,
          busy: false,
          mode: "idle",
          status: "error",
          message,
        },
      }));
      throw err;
    }
  },

  refreshCloudSyncStatus: async () => {
    const syncStatus = window.cockpit?.gwmdMap?.syncStatus;

    try {
      const result = syncStatus
        ? await syncStatus()
        : await (async () => {
            const response = await authRequest<GwmdCloudSyncStatusResponse>(
              "/api/ai/gwmd/sync/status",
              { method: "GET" },
            );
            if (!response.ok) {
              return { success: false };
            }
            return { success: true, status: response.status };
          })();
      if (!result?.success || !result.status) {
        return;
      }

      set((state) => ({
        syncState: {
          ...state.syncState,
          status: result.status?.syncStatus ?? state.syncState.status,
          cloudVersion:
            result.status?.cloudVersion ?? state.syncState.cloudVersion,
          lastSyncAt: result.status?.lastSyncAt ?? state.syncState.lastSyncAt,
          companiesCount:
            result.status?.companiesCount ?? state.syncState.companiesCount,
          relationshipsCount:
            result.status?.relationshipsCount ??
            state.syncState.relationshipsCount,
        },
      }));
    } catch {
      // Ignore status refresh errors to avoid noisy UX.
    }
  },

  search: async (
    ticker: string,
    options: {
      model: GwmdAiModelSelection;
      hops?: number;
      sourceMode?: GwmdSourceMode;
    },
  ) => {
    const { setSearchTicker, setLoading, setError, addCompanies, addEdges } =
      get();

    try {
      const normalizedTicker = normalizeTicker(ticker);
      const requestedHops = Math.max(
        1,
        Math.min(3, Math.floor(options.hops ?? get().gwmdFilters.hops ?? 2)),
      );
      const sourceMode =
        options.sourceMode ?? get().gwmdFilters.sourceMode ?? "hybrid";
      const refresh = sourceMode === "fresh";
      setSearchTicker(normalizedTicker);
      setError(null);
      set({
        searchTrace: {
          ticker: normalizedTicker,
          phase: "hydrating",
          source: "unknown",
          message: "Preparing cached context",
          updatedAt: Date.now(),
        },
      });

      const loadScoped = window.cockpit?.gwmdMap?.loadScoped;
      let hydratedFromCache = false;
      if (loadScoped && sourceMode !== "fresh") {
        try {
          const scopedResult = (await loadScoped(
            normalizedTicker,
          )) as GwmdLoadScopedResult;
          if (
            scopedResult.success &&
            scopedResult.graph &&
            (scopedResult.graph.nodes?.length ?? 0) > 0
          ) {
            const scopedCompanies = (scopedResult.companies || [])
              .map((raw) => normalizeGwmdCompany(raw))
              .filter((company): company is GwmdCompany => company !== null);
            const scopedGraph = {
              nodes: (scopedResult.graph.nodes ?? []).map((node) => ({
                ...node,
                id: normalizeTicker(node.id),
                ...(Array.isArray(node.tickers)
                  ? {
                      tickers: node.tickers.map((ticker) =>
                        normalizeTicker(String(ticker)),
                      ),
                    }
                  : {}),
              })),
              edges: (scopedResult.graph.edges ?? [])
                .map((edge) =>
                  normalizeGwmdEdge(edge as unknown as GwmdRawEdge),
                )
                .filter(
                  (edge): edge is SupplyChainGraph["edges"][number] =>
                    edge !== null,
                ),
            };

            set({
              companies: scopedCompanies,
              graph: scopedGraph,
              runStatus: "ok",
              runMeta: {
                ...(scopedResult.meta ?? {}),
                source: "cache_local_scoped",
                degraded: false,
                refreshing: true,
                requestedHops,
                sourceMode,
              },
              showEmpty: false,
              searchTrace: {
                ticker: normalizedTicker,
                phase: "hydrating",
                source: "cache",
                message: "Loaded scoped local cache, refreshing graph",
                updatedAt: Date.now(),
              },
            });
            hydratedFromCache = true;
          }
        } catch {
          // Continue to legacy local/full flow if scoped load is unavailable or fails.
        }
      }

      // Cache-first: kick off persisted hydration in background before refresh.
      const preState = get();
      const hasAnyCachedGraph =
        (preState.graph?.nodes.length ?? 0) > 0 ||
        preState.companies.length > 0;
      if (!hasAnyCachedGraph && sourceMode !== "fresh") {
        await get().loadFromDb();
      }

      const hydratedState = get();
      const hasScopedCache =
        hydratedState.companies.some(
          (company) => normalizeTicker(company.ticker) === normalizedTicker,
        ) ||
        (hydratedState.graph?.nodes.some(
          (node) => normalizeTicker(node.id) === normalizedTicker,
        ) ??
          false);

      if (hasScopedCache && sourceMode !== "fresh") {
        set({
          runStatus: "ok",
          runMeta: {
            source: "cache_local",
            degraded: false,
            refreshing: true,
            unlocatedCount: hydratedState.companies.filter(
              (company) =>
                typeof company.hqLat !== "number" ||
                typeof company.hqLon !== "number",
            ).length,
            requestedHops,
            sourceMode,
          },
          showEmpty: false,
          searchTrace: {
            ticker: normalizedTicker,
            phase: "hydrating",
            source: "cache",
            message: "Loaded from local cache, refreshing graph",
            updatedAt: Date.now(),
          },
        });
        hydratedFromCache = true;
      }

      if (sourceMode === "cache_only") {
        const hasCache = hasScopedCache || hydratedFromCache;
        set({
          runStatus: hasCache ? "ok" : "error",
          runMeta: {
            source: hasCache ? "cache_local" : "cache_miss",
            degraded: false,
            requestedHops,
            sourceMode,
          },
          searchTrace: {
            ticker: normalizedTicker,
            phase: hasCache ? "success" : "error",
            source: "cache",
            message: hasCache
              ? "Loaded local cache only"
              : "No cached data for ticker",
            updatedAt: Date.now(),
          },
        });
        if (!hasCache) {
          setError(`No cached GWMD graph found for ${normalizedTicker}`);
        }
        return;
      }

      setLoading(true);
      set({
        searchTrace: {
          ticker: normalizedTicker,
          phase: "ipc_pending",
          source: "ipc",
          message: hydratedFromCache
            ? `Refreshing cached graph at ${requestedHops} hops...`
            : `AI is generating relationships at ${requestedHops} hops (may take 1-5 min)...`,
          updatedAt: Date.now(),
        },
      });

      gwmdDebugLog(`[gwmdMapStore] Searching for ${normalizedTicker}...`);

      // Call backend to generate relationships
      const gwmdSearch = window.cockpit?.gwmdMap?.search;
      let result: GwmdSearchResult;

      const callBackendGenerate = async (): Promise<GwmdSearchResult> => {
        try {
          const selectedModel =
            typeof options.model === "string"
              ? options.model
              : options.model?.model;
          const data = await authRequest<{
            ticker: string;
            nodes: Array<{ id: string; label: string; type: string }>;
            edges: Array<{
              source: string;
              target: string;
              type: string;
              weight: number;
            }>;
            insights: string[];
          }>("/api/ai/supplychain/generate", {
            method: "POST",
            body: JSON.stringify({
              ticker: normalizedTicker,
              model: selectedModel ?? undefined,
              hops: requestedHops,
            }),
          });

          return {
            success: true,
            status: "ok",
            companies: data.nodes.map((n) => ({
              ticker: n.id,
              name: n.label,
            })),
            edges: data.edges.map((e) => ({
              from: e.source,
              to: e.target,
              kind: e.type as
                | "supplier"
                | "customer"
                | "partner"
                | "competitor",
              weight: e.weight,
              confidence: e.weight,
              evidence: "",
            })) as any,
            meta: {
              status: "ok" as const,
              source: "fresh" as const,
              degraded: false,
              unlocatedCount: 0,
              hypothesisRatio: 0,
              primaryRelationshipCount: data.edges.length,
              hop2SeedCount: 0,
              requestedHops,
              sourceMode,
              expandedTickerCount: 0,
            },
          };
        } catch (err) {
          return {
            success: false,
            error: toErrorMessage(err),
            companies: [],
            edges: [],
          };
        }
      };

      if (gwmdSearch) {
        try {
          result = (await gwmdSearch(normalizedTicker, {
            model: options.model,
            hops: requestedHops,
            refresh,
            sourceMode,
          })) as GwmdSearchResult;

          const initialCompanyCount = result.companies?.length ?? 0;
          const initialEdgeCount = result.edges?.length ?? 0;
          const looksSuspiciouslySmall =
            result.success &&
            initialCompanyCount > 0 &&
            (initialCompanyCount <= 4 || initialEdgeCount <= 3);

          if (
            looksSuspiciouslySmall &&
            sourceMode !== "fresh" &&
            sourceMode !== "cache_only"
          ) {
            const retryHops = Math.max(3, requestedHops);
            gwmdDebugLog(
              `[gwmdMapStore] Thin GWMD graph detected (${initialCompanyCount} companies, ${initialEdgeCount} edges) for ${normalizedTicker}; retrying with fresh mode at ${retryHops} hops`,
            );

            set({
              searchTrace: {
                ticker: normalizedTicker,
                phase: "ipc_pending",
                source: "ipc",
                message: `Thin graph detected (${initialCompanyCount} nodes). Retrying fresh at ${retryHops} hops...`,
                updatedAt: Date.now(),
              },
            });

            try {
              const freshResult = (await gwmdSearch(normalizedTicker, {
                model: options.model,
                hops: retryHops,
                refresh: true,
                sourceMode: "fresh",
              })) as GwmdSearchResult;

              const freshCompanyCount = freshResult.companies?.length ?? 0;
              const freshEdgeCount = freshResult.edges?.length ?? 0;
              const improvedBreadth =
                freshResult.success &&
                (freshCompanyCount > initialCompanyCount ||
                  freshEdgeCount > initialEdgeCount);

              if (improvedBreadth) {
                result = freshResult;
                gwmdDebugLog(
                  `[gwmdMapStore] Fresh retry improved graph breadth for ${normalizedTicker}: ${initialCompanyCount}/${initialEdgeCount} -> ${freshCompanyCount}/${freshEdgeCount}`,
                );
              }
            } catch (freshErr) {
              gwmdDebugLog(
                `[gwmdMapStore] Fresh retry failed for ${normalizedTicker}:`,
                freshErr,
              );
            }
          }

          set({
            searchTrace: {
              ticker: normalizedTicker,
              phase: "success",
              source: "ipc",
              message: "IPC search completed",
              updatedAt: Date.now(),
            },
          });
        } catch (ipcErr) {
          result = {
            success: false,
            error: toErrorMessage(ipcErr),
            companies: [],
            edges: [],
          };
          set({
            searchTrace: {
              ticker: normalizedTicker,
              phase: "error",
              source: "ipc",
              message: `IPC search failed: ${result.error}`,
              updatedAt: Date.now(),
            },
          });
        }
      } else {
        const supplyChainGenerate = window.cockpit?.supplyChain?.generate;
        if (supplyChainGenerate) {
          set({
            searchTrace: {
              ticker: normalizedTicker,
              phase: "ipc_pending",
              source: "supplyChainIpc",
              message: "Using supplyChain IPC fallback",
              updatedAt: Date.now(),
            },
          });
          gwmdDebugLog(
            `[gwmdMapStore] gwmdMap IPC unavailable, using supplyChain IPC fallback`,
          );
          const localRes = await supplyChainGenerate({
            ticker: normalizedTicker,
            strictMode: true,
            includeHypothesis: false,
            hops: requestedHops,
            minEdgeWeight: 0,
            refresh,
          });

          if (localRes?.success && localRes.data) {
            const data = localRes.data as {
              nodes?: Array<{ id: string; label?: string }>;
              edges?: Array<{
                source: string;
                target: string;
                type: string;
                weight?: number;
              }>;
              graph?: {
                nodes: Array<{
                  id: string;
                  label?: string;
                  tickers?: string[];
                  metadata?: {
                    hqLat?: number;
                    hqLon?: number;
                    hqCity?: string;
                    hqCountry?: string;
                    industry?: string;
                  };
                }>;
                edges: Array<{
                  from: string;
                  to: string;
                  kind: string;
                  weight?: number;
                  confidence?: number;
                  evidence?: string;
                }>;
              };
            };

            if (data.graph?.nodes && data.graph?.edges) {
              result = {
                success: true,
                status: "ok",
                companies: data.graph.nodes
                  .map((node) => {
                    const tickerValue = (
                      node.tickers?.[0] ??
                      node.id ??
                      ""
                    ).trim();
                    if (!tickerValue) return null;
                    return {
                      ticker: tickerValue,
                      name: node.label ?? tickerValue,
                      hq_lat: node.metadata?.hqLat,
                      hq_lon: node.metadata?.hqLon,
                      hq_city: node.metadata?.hqCity,
                      hq_country: node.metadata?.hqCountry,
                      industry: node.metadata?.industry,
                    };
                  })
                  .filter((node) => node !== null) as GwmdRawCompany[],
                edges: data.graph.edges as any,
                meta: {
                  status: "ok" as const,
                  source: "local_supply_chain_ipc" as const,
                  degraded: false,
                  unlocatedCount: data.graph.nodes.filter(
                    (n) => !n.metadata?.hqLat || !n.metadata?.hqLon,
                  ).length,
                  hypothesisRatio: 0,
                  primaryRelationshipCount: data.graph.edges.length,
                  hop2SeedCount: 0,
                },
              };
              set({
                searchTrace: {
                  ticker: normalizedTicker,
                  phase: "success",
                  source: "supplyChainIpc",
                  message: "supplyChain IPC fallback completed",
                  updatedAt: Date.now(),
                },
              });
            } else if (Array.isArray(data.nodes) && Array.isArray(data.edges)) {
              result = {
                success: true,
                status: "ok",
                companies: data.nodes.map((n) => ({
                  ticker: n.id,
                  name: n.label ?? n.id,
                })),
                edges: data.edges.map((e) => ({
                  from: e.source,
                  to: e.target,
                  kind: e.type as
                    | "supplier"
                    | "customer"
                    | "partner"
                    | "competitor",
                  weight: e.weight,
                  confidence: e.weight,
                  evidence: "",
                })) as any,
                meta: {
                  status: "ok" as const,
                  source: "local_supply_chain_ipc" as const,
                  degraded: false,
                  unlocatedCount: 0,
                  hypothesisRatio: 0,
                  primaryRelationshipCount: data.edges.length,
                  hop2SeedCount: 0,
                },
              };
              set({
                searchTrace: {
                  ticker: normalizedTicker,
                  phase: "success",
                  source: "supplyChainIpc",
                  message: "supplyChain IPC fallback completed",
                  updatedAt: Date.now(),
                },
              });
            } else {
              result = {
                success: false,
                error: "Unexpected supplyChain IPC response shape",
                companies: [],
                edges: [],
              };
              set({
                searchTrace: {
                  ticker: normalizedTicker,
                  phase: "error",
                  source: "supplyChainIpc",
                  message: "Unexpected supplyChain IPC response shape",
                  updatedAt: Date.now(),
                },
              });
            }
          } else {
            result = {
              success: false,
              error: localRes?.error || "Supply chain IPC generation failed",
              companies: [],
              edges: [],
            };
            set({
              searchTrace: {
                ticker: normalizedTicker,
                phase: "error",
                source: "supplyChainIpc",
                message:
                  localRes?.error || "Supply chain IPC generation failed",
                updatedAt: Date.now(),
              },
            });
          }
        } else {
          // Web/browser mode: call backend REST API directly
          set({
            searchTrace: {
              ticker: normalizedTicker,
              phase: "http_fallback",
              source: "http",
              message: "Using backend HTTP mode",
              updatedAt: Date.now(),
            },
          });
          gwmdDebugLog(`[gwmdMapStore] IPC unavailable, using HTTP fallback`);
          result = await callBackendGenerate();
          set({
            searchTrace: {
              ticker: normalizedTicker,
              phase: result.success ? "success" : "error",
              source: "http",
              message: result.success
                ? "HTTP mode search completed"
                : result.error || "Backend supply chain generation failed",
              updatedAt: Date.now(),
            },
          });
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

      const normalizedCompanies = (result.companies || [])
        .map((company) =>
          normalizeGwmdCompany(company as unknown as Record<string, unknown>),
        )
        .filter((company): company is GwmdCompany => company !== null);

      const normalizedEdges = (result.edges || [])
        .map((edge) => normalizeGwmdEdge(edge as unknown as GwmdRawEdge))
        .filter(
          (edge): edge is SupplyChainGraph["edges"][number] => edge !== null,
        );

      gwmdDebugLog(
        `[gwmdMapStore] Found ${normalizedCompanies.length} companies, ${normalizedEdges.length} edges`,
      );

      // Extract companies from result and add to store
      if (normalizedCompanies.length > 0) {
        addCompanies(normalizedCompanies);
      }

      // Add edges if available
      if (normalizedEdges.length > 0) {
        addEdges(normalizedEdges);
      }

      // Ensure graph is initialized or merged
      const currentGraph = get().graph;
      if (!currentGraph) {
        set({
          graph: {
            nodes: buildGraphNodesFromCompanies(normalizedCompanies),
            edges: normalizedEdges,
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
                ...(Array.isArray(n.tickers)
                  ? { tickers: n.tickers.map(normalizeTicker) }
                  : {}),
              },
            ] as const;
          }),
        );
        (normalizedCompanies || []).forEach((c: GwmdCompany) => {
          const ticker = normalizeTicker(c.ticker);
          if (!nodeMap.has(ticker)) {
            nodeMap.set(ticker, {
              id: ticker,
              label: c.name,
              tickers: [ticker],
              entityType: "company" as const,
              tier: "direct" as const,
              confidence: 1.0,
              metadata: {
                hqPlaceCode:
                  c.hqPlaceCode ??
                  (Number.isFinite(c.hqLat) && Number.isFinite(c.hqLon)
                    ? encodeGeoPlaceCode(c.hqLat as number, c.hqLon as number)
                    : undefined),
                hqAddress:
                  c.hqAddress ?? buildAddressLabel(c.hqCity, c.hqCountry),
                hqCity: c.hqCity,
                hqCountry: c.hqCountry,
                industry: c.industry,
                geoSource: c.geoSource,
                geoConfidence: c.geoConfidence,
                dataStatus: c.dataStatus,
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
                hqPlaceCode:
                  (existing.metadata as { hqPlaceCode?: string } | undefined)
                    ?.hqPlaceCode ??
                  c.hqPlaceCode ??
                  (Number.isFinite(c.hqLat) && Number.isFinite(c.hqLon)
                    ? encodeGeoPlaceCode(c.hqLat as number, c.hqLon as number)
                    : undefined),
                hqAddress:
                  (existing.metadata as { hqAddress?: string } | undefined)
                    ?.hqAddress ??
                  c.hqAddress ??
                  buildAddressLabel(c.hqCity, c.hqCountry),
                hqCity:
                  (existing.metadata as { hqCity?: string } | undefined)
                    ?.hqCity ?? c.hqCity,
                hqCountry:
                  (existing.metadata as { hqCountry?: string } | undefined)
                    ?.hqCountry ?? c.hqCountry,
                industry:
                  (existing.metadata as { industry?: string } | undefined)
                    ?.industry ?? c.industry,
                geoSource:
                  (existing.metadata as { geoSource?: string } | undefined)
                    ?.geoSource ?? c.geoSource,
                geoConfidence:
                  (existing.metadata as { geoConfidence?: number } | undefined)
                    ?.geoConfidence ?? c.geoConfidence,
                dataStatus:
                  (existing.metadata as { dataStatus?: string } | undefined)
                    ?.dataStatus ?? c.dataStatus,
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
        searchTrace: {
          ticker: get().searchTicker,
          phase: "error",
          source: get().searchTrace.source,
          message,
          updatedAt: Date.now(),
        },
        runStatus:
          currentStatus === "idle" || currentStatus === "ok"
            ? "error"
            : currentStatus,
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
      searchTrace: {
        ticker: null,
        phase: "idle",
        source: "unknown",
        message: "Idle",
        updatedAt: Date.now(),
      },
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
      set({ loading: true, error: null });
      if (!window.cockpit?.gwmdMap?.loadAll) {
        gwmdDebugLog(
          "[gwmdMapStore] gwmdMap.loadAll not available, attempting cloud snapshot hydrate",
        );
        const cloud = await authRequest<GwmdCloudSyncPullResponse>(
          "/api/ai/gwmd/sync/pull",
          { method: "GET" },
        );
        if (cloud.ok) {
          const snapshot = normalizeCloudSnapshot(cloud.data);
          set({
            companies: snapshot.companies,
            graph: snapshot.graph,
            runStatus: "ok",
            runMeta: null,
          });
        }
        return;
      }

      gwmdDebugLog("[gwmdMapStore] Loading data from DB...");
      const loadAll = window.cockpit.gwmdMap
        .loadAll as () => Promise<GwmdLoadAllResult>;
      const result = await loadAll();

      if (result.success) {
        gwmdDebugLog(
          `[gwmdMapStore] Loaded ${result.companies?.length || 0} companies from DB`,
        );
        const companies = (result.companies || [])
          .map((raw) => normalizeGwmdCompany(raw))
          .filter((company): company is GwmdCompany => company !== null);

        const normalizedGraph = result.graph
          ? {
              nodes: (result.graph.nodes ?? []).map((node) => {
                const normalizedId = normalizeTicker(node.id);
                return {
                  ...node,
                  id: normalizedId,
                  ...(Array.isArray(node.tickers)
                    ? {
                        tickers: node.tickers.map((ticker) =>
                          normalizeTicker(String(ticker)),
                        ),
                      }
                    : { tickers: [normalizedId] }),
                };
              }),
              edges: (result.graph.edges ?? [])
                .map((edge) =>
                  normalizeGwmdEdge(edge as unknown as GwmdRawEdge),
                )
                .filter(
                  (edge): edge is SupplyChainGraph["edges"][number] =>
                    edge !== null,
                ),
            }
          : null;

        const fallbackGraph =
          !normalizedGraph || normalizedGraph.nodes.length === 0
            ? {
                nodes: buildGraphNodesFromCompanies(companies),
                edges: normalizedGraph?.edges ?? [],
              }
            : normalizedGraph;

        set({
          companies,
          graph: fallbackGraph,
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
    } finally {
      set({ loading: false });
    }
  },
}));
