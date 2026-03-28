import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppEnv } from "../../config.js";
import { createLogger } from "../../logger.js";
import type {
  ProcurementAggregations,
  ProcurementDiagnostics,
  ProcurementGraphRelation,
  ProcurementIntegrationFeeds,
  ProcurementNoticeEnriched,
  ProcurementNoticeFilters,
  ProcurementTags,
} from "@tc/shared";
import { type TedIntelNotice } from "../tedIntel/tedIntel.js";
import {
  fetchLiveTedSnapshotStrict,
  type TedLiveConfig,
} from "../tedIntel/tedIntelLive.js";

const logger = createLogger("procurementIntel");

const CLASSIFICATION_VERSION = "cpv-v1";
const ENRICHMENT_VERSION = "enrichment-v1";

type RawNotice = {
  raw_id: string;
  tenant_id: string;
  provider: "ted" | "other";
  provider_notice_id: string;
  source_url: string | null;
  language: string | null;
  payload: Record<string, unknown>;
  source_hash: string;
  ingested_at: string;
};

type NoticeRow = {
  notice_id: string;
  provider_notice_id: string;
  provider: "ted" | "other";
  title: string;
  description: string;
  buyer: string;
  supplier: string | null;
  country: string;
  region: string;
  city: string | null;
  publication_date: string;
  deadline: string | null;
  contract_value: number | null;
  currency: string | null;
  procedure_type: string | null;
  contract_type: string | null;
  cpv_codes: string[];
  source_url: string | null;
  raw_source_ref: string;
  language: string | null;
  completeness: number;
  tags: ProcurementTags;
  interpreted_categories: string[];
  unmapped_cpv_codes: string[];
  inferred: Record<string, unknown>;
  entity_refs: Array<Record<string, unknown>>;
  scores: Record<string, unknown>;
  enrichment_version: string;
  classification_version: string;
  reprocessed_at: string | null;
  updated_at: string;
};

type PipelineEventType =
  | "ingestion_success"
  | "ingestion_failure"
  | "normalization_error"
  | "enrichment_failure"
  | "unmapped_cpv"
  | "entity_match_uncertain"
  | "graph_generation_issue";

type PipelineEvent = {
  event_type: PipelineEventType;
  severity: "info" | "warn" | "error";
  notice_id?: string;
  details: Record<string, unknown>;
};

type CpvMapEntry = {
  interpreted_categories: string[];
  sector_tags: string[];
  theme_tags: string[];
  commodity_tags: string[];
  risk_tags?: string[];
};

const CPV_PREFIX_MAP: Record<string, CpvMapEntry> = {
  "09": {
    interpreted_categories: ["energy-materials"],
    sector_tags: ["energy"],
    theme_tags: ["public-spending"],
    commodity_tags: ["fuel", "energy-feedstock"],
  },
  "30": {
    interpreted_categories: ["office-it-equipment"],
    sector_tags: ["technology", "public-infrastructure"],
    theme_tags: ["digital-transformation"],
    commodity_tags: ["hardware", "it-equipment"],
  },
  "31": {
    interpreted_categories: ["electrical-machinery"],
    sector_tags: ["industrial", "infrastructure"],
    theme_tags: ["grid-modernization"],
    commodity_tags: ["electrical-equipment"],
  },
  "32": {
    interpreted_categories: ["communications"],
    sector_tags: ["technology", "telecom"],
    theme_tags: ["connectivity"],
    commodity_tags: ["communications-equipment"],
  },
  "33": {
    interpreted_categories: ["medical-equipment"],
    sector_tags: ["healthcare"],
    theme_tags: ["public-health"],
    commodity_tags: ["medical-devices"],
  },
  "34": {
    interpreted_categories: ["transport-equipment"],
    sector_tags: ["transport", "industrial"],
    theme_tags: ["mobility"],
    commodity_tags: ["vehicles", "transport-equipment"],
  },
  "35": {
    interpreted_categories: ["security-defense"],
    sector_tags: ["security", "defense"],
    theme_tags: ["national-security"],
    commodity_tags: ["security-systems"],
    risk_tags: ["geopolitical-sensitive"],
  },
  "48": {
    interpreted_categories: ["software-systems"],
    sector_tags: ["technology"],
    theme_tags: ["digital-transformation", "automation"],
    commodity_tags: ["software", "data-platform"],
  },
  "50": {
    interpreted_categories: ["repair-maintenance"],
    sector_tags: ["industrial", "infrastructure"],
    theme_tags: ["asset-maintenance"],
    commodity_tags: ["maintenance-services"],
  },
  "71": {
    interpreted_categories: ["engineering-services"],
    sector_tags: ["engineering"],
    theme_tags: ["infrastructure-buildout"],
    commodity_tags: ["engineering-services"],
  },
  "72": {
    interpreted_categories: ["it-services"],
    sector_tags: ["technology"],
    theme_tags: ["public-digitalization"],
    commodity_tags: ["software-services"],
  },
  "73": {
    interpreted_categories: ["r-and-d"],
    sector_tags: ["research", "innovation"],
    theme_tags: ["innovation"],
    commodity_tags: ["research-services"],
  },
  "79": {
    interpreted_categories: ["business-services"],
    sector_tags: ["services"],
    theme_tags: ["administrative-modernization"],
    commodity_tags: ["business-services"],
  },
};

const EU_HIGH_ATTENTION_COUNTRIES = new Set([
  "Poland",
  "Lithuania",
  "Latvia",
  "Estonia",
  "Romania",
  "Finland",
  "Sweden",
]);

function scoreClamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.map((v) => (v ?? "").trim()).filter(Boolean))];
}

function toIso(value: unknown): string | undefined {
  if (!value || typeof value !== "string") {
    return undefined;
  }
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : undefined;
}

function toNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.replace(/[_,\s]/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function parseNoticeFromTedRaw(payload: Record<string, unknown>) {
  const providerNoticeId =
    normalizeText(payload.sourceId) ||
    normalizeText(payload.id) ||
    randomUUID();
  const title = normalizeText(payload.title) || "Untitled procurement notice";
  const description = normalizeText(payload.description);
  const buyer = normalizeText(payload.buyerName) || "Unknown buyer";
  const supplier =
    payload.winner && typeof payload.winner === "object"
      ? normalizeText((payload.winner as Record<string, unknown>).name)
      : "";

  const publicationDate =
    toIso(payload.publishedAt) ?? new Date().toISOString();
  const deadline = toIso(payload.deadlineAt);
  const cpvCodes = parseArray(payload.cpvCodes);

  const place = payload.placeOfPerformance as
    | Record<string, unknown>
    | undefined;

  return {
    provider_notice_id: providerNoticeId,
    title,
    description,
    buyer,
    supplier: supplier || undefined,
    country: normalizeText(payload.buyerCountry || place?.country) || "Unknown",
    region: normalizeText(payload.buyerRegion || place?.region) || "Unknown",
    city:
      normalizeText((payload as Record<string, unknown>).buyerCity) ||
      undefined,
    publication_date: publicationDate,
    deadline,
    contract_value: toNum(payload.valueEur),
    currency: normalizeText(payload.currency) || "EUR",
    procedure_type: normalizeText(payload.noticeType) || undefined,
    contract_type: normalizeText(payload.stage) || undefined,
    cpv_codes: cpvCodes,
    source_url: normalizeText(payload.sourceUrl) || undefined,
    language: normalizeText(payload.language) || "en",
  };
}

function computeCompleteness(normalized: {
  title: string;
  description: string;
  buyer: string;
  country: string;
  region: string;
  publication_date: string;
  cpv_codes: string[];
  contract_value?: number;
  deadline?: string;
  source_url?: string;
}): number {
  const checks = [
    normalized.title.length > 0,
    normalized.description.length > 0,
    normalized.buyer.length > 0,
    normalized.country.length > 0,
    normalized.region.length > 0,
    normalized.publication_date.length > 0,
    normalized.cpv_codes.length > 0,
    typeof normalized.contract_value === "number",
    Boolean(normalized.deadline),
    Boolean(normalized.source_url),
  ];
  const ok = checks.filter(Boolean).length;
  return Math.max(0, Math.min(1, ok / checks.length));
}

function classifyTags(input: {
  cpv_codes: string[];
  title: string;
  description: string;
  buyer: string;
  supplier?: string;
  country: string;
  region: string;
}) {
  const interpretedCategories = new Set<string>();
  const tags: ProcurementTags = {
    sector_tags: [],
    theme_tags: [],
    commodity_tags: [],
    risk_tags: [],
    geography_tags: unique([input.country, input.region]).map((v) =>
      v.toLowerCase(),
    ),
    entity_tags: unique([input.buyer, input.supplier]).map((v) =>
      v.toLowerCase(),
    ),
  };
  const unmapped: string[] = [];

  for (const cpv of input.cpv_codes) {
    const prefix = cpv.trim().slice(0, 2);
    const mapping = CPV_PREFIX_MAP[prefix];
    if (!mapping) {
      unmapped.push(cpv);
      continue;
    }
    for (const v of mapping.interpreted_categories)
      interpretedCategories.add(v);
    tags.sector_tags.push(...mapping.sector_tags);
    tags.theme_tags.push(...mapping.theme_tags);
    tags.commodity_tags.push(...mapping.commodity_tags);
    if (mapping.risk_tags) {
      tags.risk_tags.push(...mapping.risk_tags);
    }
  }

  const body = `${input.title} ${input.description}`.toLowerCase();
  if (body.includes("cyber")) {
    tags.theme_tags.push("cybersecurity");
  }
  if (body.includes("cloud")) {
    tags.theme_tags.push("cloud-adoption");
  }
  if (body.includes("grid") || body.includes("substation")) {
    tags.theme_tags.push("grid-modernization");
    tags.sector_tags.push("energy");
  }
  if (body.includes("rail") || body.includes("mobility")) {
    tags.sector_tags.push("transport");
  }
  if (
    body.includes("defence") ||
    body.includes("defense") ||
    body.includes("surveillance")
  ) {
    tags.risk_tags.push("security-sensitive");
  }

  tags.sector_tags = unique(tags.sector_tags);
  tags.theme_tags = unique(tags.theme_tags);
  tags.commodity_tags = unique(tags.commodity_tags);
  tags.risk_tags = unique(tags.risk_tags);
  tags.geography_tags = unique(tags.geography_tags);
  tags.entity_tags = unique(tags.entity_tags);

  return {
    tags,
    interpreted_categories: [...interpretedCategories],
    unmapped_cpv_codes: unique(unmapped),
  };
}

function determineScale(
  contractValue?: number,
): "micro" | "small" | "medium" | "large" | "mega" {
  if (!contractValue || contractValue <= 0) return "micro";
  if (contractValue < 1_000_000) return "small";
  if (contractValue < 25_000_000) return "medium";
  if (contractValue < 250_000_000) return "large";
  return "mega";
}

function buildScores(input: {
  contract_value: number | undefined;
  completeness: number;
  cpv_count: number;
  has_supplier: boolean;
  risk_count: number;
  strategic_scale: "micro" | "small" | "medium" | "large" | "mega";
  country: string;
  theme_count: number;
}) {
  const valueScore = Math.min(
    100,
    Math.round(Math.log10((input.contract_value ?? 1000) + 1) * 18),
  );
  const completenessScore = scoreClamp(input.completeness * 100);
  const cpvDepthScore = scoreClamp(input.cpv_count * 15);
  const supplierSignal = input.has_supplier ? 75 : 40;
  const scaleBoost =
    input.strategic_scale === "mega"
      ? 95
      : input.strategic_scale === "large"
        ? 78
        : input.strategic_scale === "medium"
          ? 62
          : input.strategic_scale === "small"
            ? 45
            : 30;
  const geoBoost = EU_HIGH_ATTENTION_COUNTRIES.has(input.country) ? 72 : 50;
  const riskBoost = scoreClamp(input.risk_count * 25 + 30);
  const themeDiversity = scoreClamp(input.theme_count * 20);

  const macro = scoreClamp(
    valueScore * 0.45 + completenessScore * 0.25 + cpvDepthScore * 0.3,
  );
  const supply = scoreClamp(
    supplierSignal * 0.3 + cpvDepthScore * 0.35 + themeDiversity * 0.35,
  );
  const marketMove = scoreClamp(
    valueScore * 0.5 + scaleBoost * 0.3 + riskBoost * 0.2,
  );
  const infra = scoreClamp(
    scaleBoost * 0.45 + cpvDepthScore * 0.35 + completenessScore * 0.2,
  );
  const geo = scoreClamp(
    geoBoost * 0.45 + riskBoost * 0.4 + themeDiversity * 0.15,
  );

  return {
    macro_significance: {
      score: macro,
      factors: [
        {
          factor: "contract_value",
          weight: 0.45,
          value: valueScore,
          contribution: scoreClamp(valueScore * 0.45),
        },
        {
          factor: "completeness",
          weight: 0.25,
          value: completenessScore,
          contribution: scoreClamp(completenessScore * 0.25),
        },
        {
          factor: "cpv_depth",
          weight: 0.3,
          value: cpvDepthScore,
          contribution: scoreClamp(cpvDepthScore * 0.3),
        },
      ],
    },
    supply_chain_relevance: {
      score: supply,
      factors: [
        {
          factor: "supplier_disclosed",
          weight: 0.3,
          value: supplierSignal,
          contribution: scoreClamp(supplierSignal * 0.3),
        },
        {
          factor: "cpv_depth",
          weight: 0.35,
          value: cpvDepthScore,
          contribution: scoreClamp(cpvDepthScore * 0.35),
        },
        {
          factor: "theme_diversity",
          weight: 0.35,
          value: themeDiversity,
          contribution: scoreClamp(themeDiversity * 0.35),
        },
      ],
    },
    market_moving_potential: {
      score: marketMove,
      factors: [
        {
          factor: "value",
          weight: 0.5,
          value: valueScore,
          contribution: scoreClamp(valueScore * 0.5),
        },
        {
          factor: "scale",
          weight: 0.3,
          value: scaleBoost,
          contribution: scoreClamp(scaleBoost * 0.3),
        },
        {
          factor: "risk",
          weight: 0.2,
          value: riskBoost,
          contribution: scoreClamp(riskBoost * 0.2),
        },
      ],
    },
    strategic_infrastructure_relevance: {
      score: infra,
      factors: [
        {
          factor: "scale",
          weight: 0.45,
          value: scaleBoost,
          contribution: scoreClamp(scaleBoost * 0.45),
        },
        {
          factor: "cpv_depth",
          weight: 0.35,
          value: cpvDepthScore,
          contribution: scoreClamp(cpvDepthScore * 0.35),
        },
        {
          factor: "completeness",
          weight: 0.2,
          value: completenessScore,
          contribution: scoreClamp(completenessScore * 0.2),
        },
      ],
    },
    geopolitical_sensitivity: {
      score: geo,
      factors: [
        {
          factor: "geography",
          weight: 0.45,
          value: geoBoost,
          contribution: scoreClamp(geoBoost * 0.45),
        },
        {
          factor: "risk_tags",
          weight: 0.4,
          value: riskBoost,
          contribution: scoreClamp(riskBoost * 0.4),
        },
        {
          factor: "theme_diversity",
          weight: 0.15,
          value: themeDiversity,
          contribution: scoreClamp(themeDiversity * 0.15),
        },
      ],
    },
  };
}

function createGraphRelations(input: {
  notice_id: string;
  buyer: string;
  supplier?: string;
  commodity_tags: string[];
  sector_tags: string[];
  theme_tags: string[];
  country: string;
  region: string;
}): ProcurementGraphRelation[] {
  const relations: ProcurementGraphRelation[] = [];
  for (const commodity of input.commodity_tags) {
    relations.push({
      relation_id: randomUUID(),
      subject_type: "buyer",
      subject_key: input.buyer,
      predicate: "procures",
      object_type: "commodity",
      object_key: commodity,
      confidence: 0.82,
      evidence: ["commodity_tag"],
    });
    relations.push({
      relation_id: randomUUID(),
      subject_type: "contract",
      subject_key: input.notice_id,
      predicate: "implies_demand_for",
      object_type: "product_category",
      object_key: commodity,
      confidence: 0.78,
      evidence: ["commodity_tag", "cpv_mapping"],
    });
  }

  if (input.supplier) {
    relations.push({
      relation_id: randomUUID(),
      subject_type: "buyer",
      subject_key: input.buyer,
      predicate: "awards",
      object_type: "supplier",
      object_key: input.supplier,
      confidence: 0.9,
      evidence: ["supplier_disclosed"],
    });
    relations.push({
      relation_id: randomUUID(),
      subject_type: "supplier",
      subject_key: input.supplier,
      predicate: "operates_in",
      object_type: "geography",
      object_key: `${input.country}:${input.region}`,
      confidence: 0.71,
      evidence: ["buyer_location_proxy"],
    });
  }

  for (const tag of unique([
    ...input.sector_tags,
    ...input.theme_tags,
    ...input.commodity_tags,
  ])) {
    relations.push({
      relation_id: randomUUID(),
      subject_type: "notice",
      subject_key: input.notice_id,
      predicate: "relates_to",
      object_type: "tag",
      object_key: tag,
      confidence: 0.74,
      evidence: ["taxonomy", "classification"],
    });
  }

  return relations;
}

function parseTedPayloadToRawInput(notice: TedIntelNotice): {
  provider: "ted";
  provider_notice_id: string;
  source_url?: string;
  language?: string;
  payload: Record<string, unknown>;
} {
  return {
    provider: "ted",
    provider_notice_id: notice.sourceId || notice.id,
    source_url: notice.sourceUrl,
    language: "en",
    payload: {
      id: notice.id,
      sourceId: notice.sourceId,
      title: notice.title,
      description: notice.evidence?.directlyStatedFacts?.join(" ") ?? "",
      buyerName: notice.buyerName,
      buyerCountry: notice.buyerCountry,
      buyerRegion: notice.buyerRegion,
      stage: notice.stage,
      noticeType: notice.noticeType,
      valueEur: notice.valueEur,
      currency: notice.currency,
      publishedAt: notice.publishedAt,
      deadlineAt: notice.deadlineAt,
      placeOfPerformance: notice.placeOfPerformance,
      winner: notice.winner,
      sourceUrl: notice.sourceUrl,
      cpvCodes: notice.cpvCodes,
      language: "en",
    },
  };
}

class InMemoryProcurementStore {
  rawByTenant = new Map<string, RawNotice[]>();
  noticesByTenant = new Map<string, NoticeRow[]>();
  relationsByTenant = new Map<string, ProcurementGraphRelation[]>();
  eventsByTenant = new Map<
    string,
    Array<PipelineEvent & { created_at: string }>
  >();

  appendRaw(tenant: string, raw: RawNotice) {
    const list = this.rawByTenant.get(tenant) ?? [];
    list.push(raw);
    this.rawByTenant.set(tenant, list);
  }

  upsertNotice(tenant: string, row: NoticeRow) {
    const list = this.noticesByTenant.get(tenant) ?? [];
    const idx = list.findIndex((item) => item.notice_id === row.notice_id);
    if (idx >= 0) list[idx] = row;
    else list.push(row);
    this.noticesByTenant.set(tenant, list);
  }

  setRelations(
    tenant: string,
    noticeId: string,
    relations: ProcurementGraphRelation[],
  ) {
    const list = this.relationsByTenant.get(tenant) ?? [];
    const filtered = list.filter((rel) => rel.subject_key !== noticeId);
    filtered.push(...relations);
    this.relationsByTenant.set(tenant, filtered);
  }

  addEvent(tenant: string, event: PipelineEvent) {
    const list = this.eventsByTenant.get(tenant) ?? [];
    list.push({ ...event, created_at: new Date().toISOString() });
    this.eventsByTenant.set(tenant, list.slice(-5000));
  }
}

export type ProcurementIngestResult = {
  ingested: number;
  normalized: number;
  enriched: number;
  failures: number;
  runAt: string;
};

export type ProcurementIntelService = {
  ingest: (
    tenantId: string,
    window: "7d" | "30d" | "90d" | "1y",
  ) => Promise<ProcurementIngestResult>;
  reprocess: (
    tenantId: string,
    noticeIds?: string[],
  ) => Promise<ProcurementIngestResult>;
  listNotices: (
    tenantId: string,
    filters: ProcurementNoticeFilters,
  ) => Promise<ProcurementNoticeEnriched[]>;
  getRawNotice: (tenantId: string, rawId: string) => Promise<RawNotice | null>;
  getDiagnostics: (tenantId: string) => Promise<ProcurementDiagnostics>;
  getAggregations: (
    tenantId: string,
    filters: ProcurementNoticeFilters,
  ) => Promise<ProcurementAggregations>;
  getGraphRelations: (
    tenantId: string,
    filters: ProcurementNoticeFilters,
  ) => Promise<ProcurementGraphRelation[]>;
  getIntegrationFeeds: (
    tenantId: string,
    filters: ProcurementNoticeFilters,
  ) => Promise<ProcurementIntegrationFeeds>;
};

async function fetchTedRawLayer(
  env: AppEnv,
  tedLiveConfig: TedLiveConfig,
  window: "7d" | "30d" | "90d" | "1y",
): Promise<
  Array<{
    provider: "ted";
    provider_notice_id: string;
    source_url?: string;
    language?: string;
    payload: Record<string, unknown>;
  }>
> {
  const liveSnapshot = await fetchLiveTedSnapshotStrict(tedLiveConfig, window);
  const notices = liveSnapshot.radar;

  if (!Array.isArray(notices)) {
    logger.warn("procurement_ted_source_no_notices", {
      mode: "live",
      tedLiveEnabled: env.TED_LIVE_ENABLED,
    });
    return [];
  }

  return notices.map((notice) => parseTedPayloadToRawInput(notice));
}

function applyFilters(
  rows: NoticeRow[],
  filters: ProcurementNoticeFilters,
): NoticeRow[] {
  return rows.filter((row) => {
    if (filters.country?.length && !filters.country.includes(row.country))
      return false;
    if (filters.region?.length && !filters.region.includes(row.region))
      return false;
    if (
      filters.cpv?.length &&
      !row.cpv_codes.some((cpv) => filters.cpv?.includes(cpv))
    )
      return false;
    if (
      filters.sector_tag?.length &&
      !row.tags.sector_tags.some((tag) => filters.sector_tag?.includes(tag))
    )
      return false;
    if (
      filters.theme_tag?.length &&
      !row.tags.theme_tags.some((tag) => filters.theme_tag?.includes(tag))
    )
      return false;
    if (
      filters.commodity_tag?.length &&
      !row.tags.commodity_tags.some((tag) =>
        filters.commodity_tag?.includes(tag),
      )
    )
      return false;
    if (filters.buyer?.length && !filters.buyer.includes(row.buyer))
      return false;
    if (
      filters.supplier?.length &&
      !filters.supplier.includes(row.supplier ?? "")
    )
      return false;
    if (
      typeof filters.min_value === "number" &&
      (row.contract_value ?? 0) < filters.min_value
    )
      return false;
    if (
      typeof filters.max_value === "number" &&
      (row.contract_value ?? 0) > filters.max_value
    )
      return false;
    if (typeof filters.min_confidence === "number") {
      const score = Number(
        (row.inferred.event_significance_score as number | undefined) ?? 0,
      );
      if (score < filters.min_confidence) return false;
    }
    if (filters.strategic_importance?.length) {
      const value = String(row.inferred.strategic_importance ?? "");
      if (!filters.strategic_importance.includes(value)) return false;
    }
    if (filters.from_date && row.publication_date < filters.from_date)
      return false;
    if (filters.to_date && row.publication_date > filters.to_date) return false;
    return true;
  });
}

function toEnriched(
  row: NoticeRow,
  graph: ProcurementGraphRelation[],
): ProcurementNoticeEnriched {
  return {
    notice_id: row.notice_id,
    provider_notice_id: row.provider_notice_id,
    provider: row.provider,
    title: row.title,
    description: row.description,
    buyer: row.buyer,
    ...(row.supplier ? { supplier: row.supplier } : {}),
    country: row.country,
    region: row.region,
    ...(row.city ? { city: row.city } : {}),
    publication_date: row.publication_date,
    ...(row.deadline ? { deadline: row.deadline } : {}),
    ...(typeof row.contract_value === "number"
      ? { contract_value: row.contract_value }
      : {}),
    ...(row.currency ? { currency: row.currency } : {}),
    ...(row.procedure_type ? { procedure_type: row.procedure_type } : {}),
    ...(row.contract_type ? { contract_type: row.contract_type } : {}),
    cpv_codes: row.cpv_codes,
    ...(row.source_url ? { source_url: row.source_url } : {}),
    raw_source_ref: row.raw_source_ref,
    ...(row.language ? { language: row.language } : {}),
    completeness: row.completeness,
    tags: row.tags,
    classification: {
      cpv_codes: row.cpv_codes,
      interpreted_categories: row.interpreted_categories,
      unmapped_cpv_codes: row.unmapped_cpv_codes,
    },
    inferred: row.inferred as ProcurementNoticeEnriched["inferred"],
    entity_refs: row.entity_refs as ProcurementNoticeEnriched["entity_refs"],
    scores: row.scores as ProcurementNoticeEnriched["scores"],
    graph_relations: graph,
    enrichment_version: row.enrichment_version,
    classification_version: row.classification_version,
    ...(row.reprocessed_at ? { reprocessed_at: row.reprocessed_at } : {}),
  };
}

export function createProcurementIntelService(
  pool: Pool | null,
  env: AppEnv,
  getTedLiveConfig: () => TedLiveConfig,
): ProcurementIntelService {
  const memoryStore = new InMemoryProcurementStore();

  const resolveTenant = (tenantId?: string) =>
    tenantId && tenantId.trim().length > 0
      ? tenantId.trim()
      : env.DEFAULT_TENANT_ID;

  const withPg = async <T>(
    fn: () => Promise<T>,
    fallback: () => Promise<T>,
  ): Promise<T> => {
    if (!pool) {
      return fallback();
    }
    try {
      return await fn();
    } catch (error) {
      logger.warn("procurement_intel_pg_fallback_to_memory", {
        error: error instanceof Error ? error.message : "unknown_error",
      });
      return fallback();
    }
  };

  const pushEvent = async (tenantId: string, event: PipelineEvent) => {
    const tenant = resolveTenant(tenantId);
    await withPg(
      async () => {
        if (!pool) return;
        await pool.query(
          `INSERT INTO procurement_pipeline_events (
             tenant_id, event_type, severity, notice_id, details
           ) VALUES ($1, $2, $3, $4, $5::jsonb)`,
          [
            tenant,
            event.event_type,
            event.severity,
            event.notice_id ?? null,
            JSON.stringify(event.details),
          ],
        );
      },
      async () => {
        memoryStore.addEvent(tenant, event);
      },
    );
  };

  const listRows = async (tenantId: string): Promise<NoticeRow[]> => {
    const tenant = resolveTenant(tenantId);
    return withPg(
      async () => {
        if (!pool) return [];
        const result = await pool.query<NoticeRow>(
          `SELECT
             n.notice_id,
             n.provider_notice_id,
             n.provider,
             n.title,
             n.description,
             n.buyer,
             n.supplier,
             n.country,
             n.region,
             n.city,
             n.publication_date::text,
             n.deadline::text,
             n.contract_value,
             n.currency,
             n.procedure_type,
             n.contract_type,
             n.cpv_codes,
             n.source_url,
             n.raw_source_ref,
             n.language,
             n.completeness,
             e.tags,
             e.interpreted_categories,
             e.unmapped_cpv_codes,
             e.inferred,
             e.entity_refs,
             e.scores,
             e.enrichment_version,
             e.classification_version,
             e.reprocessed_at::text,
             e.updated_at::text
           FROM procurement_notice_normalized n
           JOIN procurement_notice_enriched e
             ON e.tenant_id = n.tenant_id AND e.notice_id = n.notice_id
           WHERE n.tenant_id = $1
           ORDER BY n.publication_date DESC, n.notice_id ASC
           LIMIT 5000`,
          [tenant],
        );
        return result.rows.map((row) => ({
          ...row,
          cpv_codes: row.cpv_codes ?? [],
        }));
      },
      async () => memoryStore.noticesByTenant.get(tenant) ?? [],
    );
  };

  const listRelations = async (
    tenantId: string,
  ): Promise<ProcurementGraphRelation[]> => {
    const tenant = resolveTenant(tenantId);
    return withPg(
      async () => {
        if (!pool) return [];
        const result = await pool.query<{
          relation_id: string;
          subject_type: string;
          subject_key: string;
          predicate: string;
          object_type: string;
          object_key: string;
          confidence: number;
          evidence: string[];
        }>(
          `SELECT
             relation_id,
             subject_type,
             subject_key,
             predicate,
             object_type,
             object_key,
             confidence,
             evidence
           FROM procurement_notice_graph_rel
           WHERE tenant_id = $1`,
          [tenant],
        );
        return result.rows;
      },
      async () => memoryStore.relationsByTenant.get(tenant) ?? [],
    );
  };

  const saveProcessed = async (
    tenantId: string,
    processed: {
      raw: RawNotice;
      row: NoticeRow;
      relations: ProcurementGraphRelation[];
    },
  ) => {
    const tenant = resolveTenant(tenantId);
    await withPg(
      async () => {
        if (!pool) return;
        await pool.query(
          `INSERT INTO procurement_notice_raw (
             raw_id, tenant_id, provider, provider_notice_id, source_url, language, payload, source_hash, ingested_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::timestamptz)
           ON CONFLICT (tenant_id, provider, provider_notice_id, source_hash) DO NOTHING`,
          [
            processed.raw.raw_id,
            tenant,
            processed.raw.provider,
            processed.raw.provider_notice_id,
            processed.raw.source_url,
            processed.raw.language,
            JSON.stringify(processed.raw.payload),
            processed.raw.source_hash,
            processed.raw.ingested_at,
          ],
        );

        await pool.query(
          `INSERT INTO procurement_notice_normalized (
             notice_id, tenant_id, provider_notice_id, provider, title, description, buyer, supplier, country, region, city,
             publication_date, deadline, contract_value, currency, procedure_type, contract_type, cpv_codes,
             source_url, raw_source_ref, language, completeness
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             $12::timestamptz,$13::timestamptz,$14,$15,$16,$17,$18::jsonb,
             $19,$20,$21,$22
           )
           ON CONFLICT (tenant_id, notice_id) DO UPDATE SET
             provider_notice_id = EXCLUDED.provider_notice_id,
             title = EXCLUDED.title,
             description = EXCLUDED.description,
             buyer = EXCLUDED.buyer,
             supplier = EXCLUDED.supplier,
             country = EXCLUDED.country,
             region = EXCLUDED.region,
             city = EXCLUDED.city,
             publication_date = EXCLUDED.publication_date,
             deadline = EXCLUDED.deadline,
             contract_value = EXCLUDED.contract_value,
             currency = EXCLUDED.currency,
             procedure_type = EXCLUDED.procedure_type,
             contract_type = EXCLUDED.contract_type,
             cpv_codes = EXCLUDED.cpv_codes,
             source_url = EXCLUDED.source_url,
             raw_source_ref = EXCLUDED.raw_source_ref,
             language = EXCLUDED.language,
             completeness = EXCLUDED.completeness,
             updated_at = NOW()`,
          [
            processed.row.notice_id,
            tenant,
            processed.row.provider_notice_id,
            processed.row.provider,
            processed.row.title,
            processed.row.description,
            processed.row.buyer,
            processed.row.supplier,
            processed.row.country,
            processed.row.region,
            processed.row.city,
            processed.row.publication_date,
            processed.row.deadline,
            processed.row.contract_value,
            processed.row.currency,
            processed.row.procedure_type,
            processed.row.contract_type,
            JSON.stringify(processed.row.cpv_codes),
            processed.row.source_url,
            processed.row.raw_source_ref,
            processed.row.language,
            processed.row.completeness,
          ],
        );

        await pool.query(
          `INSERT INTO procurement_notice_enriched (
             tenant_id, notice_id, tags, interpreted_categories, unmapped_cpv_codes, inferred, entity_refs, scores,
             enrichment_version, classification_version, reprocessed_at
           ) VALUES (
             $1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11::timestamptz
           )
           ON CONFLICT (tenant_id, notice_id) DO UPDATE SET
             tags = EXCLUDED.tags,
             interpreted_categories = EXCLUDED.interpreted_categories,
             unmapped_cpv_codes = EXCLUDED.unmapped_cpv_codes,
             inferred = EXCLUDED.inferred,
             entity_refs = EXCLUDED.entity_refs,
             scores = EXCLUDED.scores,
             enrichment_version = EXCLUDED.enrichment_version,
             classification_version = EXCLUDED.classification_version,
             reprocessed_at = EXCLUDED.reprocessed_at,
             updated_at = NOW()`,
          [
            tenant,
            processed.row.notice_id,
            JSON.stringify(processed.row.tags),
            JSON.stringify(processed.row.interpreted_categories),
            JSON.stringify(processed.row.unmapped_cpv_codes),
            JSON.stringify(processed.row.inferred),
            JSON.stringify(processed.row.entity_refs),
            JSON.stringify(processed.row.scores),
            processed.row.enrichment_version,
            processed.row.classification_version,
            processed.row.reprocessed_at,
          ],
        );

        await pool.query(
          "DELETE FROM procurement_notice_graph_rel WHERE tenant_id = $1 AND notice_id = $2",
          [tenant, processed.row.notice_id],
        );

        for (const relation of processed.relations) {
          await pool.query(
            `INSERT INTO procurement_notice_graph_rel (
               relation_id, tenant_id, notice_id, subject_type, subject_key, predicate,
               object_type, object_key, confidence, evidence
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
            [
              relation.relation_id,
              tenant,
              processed.row.notice_id,
              relation.subject_type,
              relation.subject_key,
              relation.predicate,
              relation.object_type,
              relation.object_key,
              relation.confidence,
              JSON.stringify(relation.evidence),
            ],
          );
        }
      },
      async () => {
        memoryStore.appendRaw(tenant, processed.raw);
        memoryStore.upsertNotice(tenant, processed.row);
        memoryStore.setRelations(
          tenant,
          processed.row.notice_id,
          processed.relations,
        );
      },
    );
  };

  return {
    async ingest(tenantId: string, window: "7d" | "30d" | "90d" | "1y") {
      const tenant = resolveTenant(tenantId);
      const rawItems = await fetchTedRawLayer(env, getTedLiveConfig(), window);
      let ingested = 0;
      let normalized = 0;
      let enriched = 0;
      let failures = 0;

      for (const item of rawItems) {
        const nowIso = new Date().toISOString();
        try {
          const sourceHash = createHash("sha256")
            .update(JSON.stringify(item.payload))
            .digest("hex");

          const raw: RawNotice = {
            raw_id: randomUUID(),
            tenant_id: tenant,
            provider: item.provider,
            provider_notice_id: item.provider_notice_id,
            source_url: item.source_url ?? null,
            language: item.language ?? null,
            payload: item.payload,
            source_hash: sourceHash,
            ingested_at: nowIso,
          };

          ingested += 1;

          const normalizedData = parseNoticeFromTedRaw(item.payload);
          const completeness = computeCompleteness({
            title: normalizedData.title,
            description: normalizedData.description,
            buyer: normalizedData.buyer,
            country: normalizedData.country,
            region: normalizedData.region,
            publication_date: normalizedData.publication_date,
            cpv_codes: normalizedData.cpv_codes,
            ...(typeof normalizedData.contract_value === "number"
              ? { contract_value: normalizedData.contract_value }
              : {}),
            ...(normalizedData.deadline
              ? { deadline: normalizedData.deadline }
              : {}),
            ...(normalizedData.source_url
              ? { source_url: normalizedData.source_url }
              : {}),
          });

          normalized += 1;

          const classified = classifyTags({
            cpv_codes: normalizedData.cpv_codes,
            title: normalizedData.title,
            description: normalizedData.description,
            buyer: normalizedData.buyer,
            ...(normalizedData.supplier
              ? { supplier: normalizedData.supplier }
              : {}),
            country: normalizedData.country,
            region: normalizedData.region,
          });

          if (classified.unmapped_cpv_codes.length) {
            await pushEvent(tenant, {
              event_type: "unmapped_cpv",
              severity: "warn",
              details: {
                cpv_codes: classified.unmapped_cpv_codes,
                provider_notice_id: normalizedData.provider_notice_id,
              },
            });
          }

          const scale = determineScale(normalizedData.contract_value);
          const scores = buildScores({
            contract_value: normalizedData.contract_value ?? undefined,
            completeness,
            cpv_count: normalizedData.cpv_codes.length,
            has_supplier: Boolean(normalizedData.supplier),
            risk_count: classified.tags.risk_tags.length,
            strategic_scale: scale,
            country: normalizedData.country,
            theme_count: classified.tags.theme_tags.length,
          });

          const eventScore = scoreClamp(
            scores.macro_significance.score * 0.25 +
              scores.supply_chain_relevance.score * 0.25 +
              scores.market_moving_potential.score * 0.2 +
              scores.strategic_infrastructure_relevance.score * 0.15 +
              scores.geopolitical_sensitivity.score * 0.15,
          );

          const inferred = {
            likely_sector_exposure: classified.tags.sector_tags,
            supply_chain_relevance:
              scores.supply_chain_relevance.score >= 70
                ? "high"
                : scores.supply_chain_relevance.score >= 45
                  ? "medium"
                  : "low",
            strategic_importance:
              scores.strategic_infrastructure_relevance.score >= 75
                ? "high"
                : scores.strategic_infrastructure_relevance.score >= 50
                  ? "medium"
                  : "low",
            buyer_type: normalizedData.procedure_type?.includes("award")
              ? "awarding-authority"
              : "contracting-authority",
            public_spending_theme: classified.tags.theme_tags,
            geopolitical_relevance:
              scores.geopolitical_sensitivity.score >= 70
                ? "high"
                : scores.geopolitical_sensitivity.score >= 45
                  ? "medium"
                  : "low",
            procurement_scale_category: scale,
            event_significance_score: eventScore,
          };

          const entityRefs = [
            {
              entity_type: "buyer",
              name: normalizedData.buyer,
              confidence: 0.92,
              source: "raw",
            },
            ...(normalizedData.supplier
              ? [
                  {
                    entity_type: "supplier",
                    name: normalizedData.supplier,
                    confidence: 0.9,
                    source: "raw" as const,
                  },
                ]
              : []),
            ...classified.tags.commodity_tags.map((tag) => ({
              entity_type: "commodity" as const,
              name: tag,
              confidence: 0.76,
              source: "inferred" as const,
            })),
            {
              entity_type: "geography",
              name: `${normalizedData.country}:${normalizedData.region}`,
              confidence: 0.84,
              source: "raw",
            },
          ];

          const noticeId = `ted:${normalizedData.provider_notice_id}`;

          const relations = createGraphRelations({
            notice_id: noticeId,
            buyer: normalizedData.buyer,
            ...(normalizedData.supplier
              ? { supplier: normalizedData.supplier }
              : {}),
            commodity_tags: classified.tags.commodity_tags,
            sector_tags: classified.tags.sector_tags,
            theme_tags: classified.tags.theme_tags,
            country: normalizedData.country,
            region: normalizedData.region,
          });

          const row: NoticeRow = {
            notice_id: noticeId,
            provider_notice_id: normalizedData.provider_notice_id,
            provider: "ted",
            title: normalizedData.title,
            description: normalizedData.description,
            buyer: normalizedData.buyer,
            supplier: normalizedData.supplier ?? null,
            country: normalizedData.country,
            region: normalizedData.region,
            city: normalizedData.city ?? null,
            publication_date: normalizedData.publication_date,
            deadline: normalizedData.deadline ?? null,
            contract_value: normalizedData.contract_value ?? null,
            currency: normalizedData.currency ?? null,
            procedure_type: normalizedData.procedure_type ?? null,
            contract_type: normalizedData.contract_type ?? null,
            cpv_codes: normalizedData.cpv_codes,
            source_url: normalizedData.source_url ?? null,
            raw_source_ref: raw.raw_id,
            language: normalizedData.language ?? null,
            completeness,
            tags: classified.tags,
            interpreted_categories: classified.interpreted_categories,
            unmapped_cpv_codes: classified.unmapped_cpv_codes,
            inferred,
            entity_refs: entityRefs,
            scores,
            enrichment_version: ENRICHMENT_VERSION,
            classification_version: CLASSIFICATION_VERSION,
            reprocessed_at: null,
            updated_at: nowIso,
          };

          await saveProcessed(tenant, { raw, row, relations });
          enriched += 1;

          await pushEvent(tenant, {
            event_type: "ingestion_success",
            severity: "info",
            notice_id: noticeId,
            details: {
              provider: "ted",
              provider_notice_id: normalizedData.provider_notice_id,
            },
          });

          if (!normalizedData.supplier) {
            await pushEvent(tenant, {
              event_type: "entity_match_uncertain",
              severity: "warn",
              notice_id: noticeId,
              details: {
                reason: "supplier_missing",
                buyer: normalizedData.buyer,
              },
            });
          }
        } catch (error) {
          failures += 1;
          await pushEvent(tenant, {
            event_type: "ingestion_failure",
            severity: "error",
            details: {
              provider_notice_id: item.provider_notice_id,
              error: error instanceof Error ? error.message : "unknown_error",
            },
          });
        }
      }

      return {
        ingested,
        normalized,
        enriched,
        failures,
        runAt: new Date().toISOString(),
      };
    },

    async reprocess(tenantId: string, noticeIds?: string[]) {
      const tenant = resolveTenant(tenantId);
      const rows = await listRows(tenant);
      const target = noticeIds?.length
        ? rows.filter((row) => noticeIds.includes(row.notice_id))
        : rows;

      let ingested = 0;
      let normalized = 0;
      let enriched = 0;
      let failures = 0;

      for (const row of target) {
        try {
          ingested += 1;
          normalized += 1;

          const classified = classifyTags({
            cpv_codes: row.cpv_codes,
            title: row.title,
            description: row.description,
            buyer: row.buyer,
            ...(row.supplier ? { supplier: row.supplier } : {}),
            country: row.country,
            region: row.region,
          });

          const scale = determineScale(row.contract_value ?? undefined);
          const scores = buildScores({
            contract_value: row.contract_value ?? undefined,
            completeness: row.completeness,
            cpv_count: row.cpv_codes.length,
            has_supplier: Boolean(row.supplier),
            risk_count: classified.tags.risk_tags.length,
            strategic_scale: scale,
            country: row.country,
            theme_count: classified.tags.theme_tags.length,
          });

          const eventScore = scoreClamp(
            scores.macro_significance.score * 0.25 +
              scores.supply_chain_relevance.score * 0.25 +
              scores.market_moving_potential.score * 0.2 +
              scores.strategic_infrastructure_relevance.score * 0.15 +
              scores.geopolitical_sensitivity.score * 0.15,
          );

          const inferred = {
            likely_sector_exposure: classified.tags.sector_tags,
            supply_chain_relevance:
              scores.supply_chain_relevance.score >= 70
                ? "high"
                : scores.supply_chain_relevance.score >= 45
                  ? "medium"
                  : "low",
            strategic_importance:
              scores.strategic_infrastructure_relevance.score >= 75
                ? "high"
                : scores.strategic_infrastructure_relevance.score >= 50
                  ? "medium"
                  : "low",
            buyer_type: row.procedure_type?.includes("award")
              ? "awarding-authority"
              : "contracting-authority",
            public_spending_theme: classified.tags.theme_tags,
            geopolitical_relevance:
              scores.geopolitical_sensitivity.score >= 70
                ? "high"
                : scores.geopolitical_sensitivity.score >= 45
                  ? "medium"
                  : "low",
            procurement_scale_category: scale,
            event_significance_score: eventScore,
          };

          const relations = createGraphRelations({
            notice_id: row.notice_id,
            buyer: row.buyer,
            ...(row.supplier ? { supplier: row.supplier } : {}),
            commodity_tags: classified.tags.commodity_tags,
            sector_tags: classified.tags.sector_tags,
            theme_tags: classified.tags.theme_tags,
            country: row.country,
            region: row.region,
          });

          const nextRow: NoticeRow = {
            ...row,
            tags: classified.tags,
            interpreted_categories: classified.interpreted_categories,
            unmapped_cpv_codes: classified.unmapped_cpv_codes,
            inferred,
            scores,
            reprocessed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          const raw: RawNotice = {
            raw_id: row.raw_source_ref,
            tenant_id: tenant,
            provider: row.provider,
            provider_notice_id: row.provider_notice_id,
            source_url: row.source_url,
            language: row.language,
            payload: {
              note: "reprocess_existing_notice",
            },
            source_hash: createHash("sha256")
              .update(`${row.notice_id}:${nextRow.reprocessed_at}`)
              .digest("hex"),
            ingested_at: row.updated_at,
          };

          await saveProcessed(tenant, { raw, row: nextRow, relations });
          enriched += 1;
        } catch (error) {
          failures += 1;
          await pushEvent(tenant, {
            event_type: "enrichment_failure",
            severity: "error",
            notice_id: row.notice_id,
            details: {
              error: error instanceof Error ? error.message : "unknown_error",
            },
          });
        }
      }

      return {
        ingested,
        normalized,
        enriched,
        failures,
        runAt: new Date().toISOString(),
      };
    },

    async listNotices(tenantId: string, filters: ProcurementNoticeFilters) {
      const rows = applyFilters(await listRows(tenantId), filters);
      const limit =
        typeof filters.limit === "number"
          ? Math.max(1, Math.min(500, filters.limit))
          : 200;
      const relations = await listRelations(tenantId);
      return rows.slice(0, limit).map((row) =>
        toEnriched(
          row,
          relations.filter(
            (relation) => relation.subject_key === row.notice_id,
          ),
        ),
      );
    },

    async getRawNotice(tenantId: string, rawId: string) {
      const tenant = resolveTenant(tenantId);
      return withPg(
        async () => {
          if (!pool) return null;
          const result = await pool.query<RawNotice>(
            `SELECT
               raw_id,
               tenant_id,
               provider,
               provider_notice_id,
               source_url,
               language,
               payload,
               source_hash,
               ingested_at::text
             FROM procurement_notice_raw
             WHERE tenant_id = $1 AND raw_id = $2
             LIMIT 1`,
            [tenant, rawId],
          );
          return result.rows[0] ?? null;
        },
        async () =>
          (memoryStore.rawByTenant.get(tenant) ?? []).find(
            (item) => item.raw_id === rawId,
          ) ?? null,
      );
    },

    async getDiagnostics(tenantId: string) {
      const tenant = resolveTenant(tenantId);
      return withPg(
        async () => {
          if (!pool) {
            return {
              ingestion_success: 0,
              ingestion_failure: 0,
              normalization_errors: 0,
              enrichment_failures: 0,
              unmapped_cpv_codes: [],
              entity_matching_uncertainty: 0,
              graph_generation_issues: 0,
            } satisfies ProcurementDiagnostics;
          }

          const countsResult = await pool.query<{
            event_type: PipelineEventType;
            count: string;
          }>(
            `SELECT event_type, COUNT(*)::text AS count
             FROM procurement_pipeline_events
             WHERE tenant_id = $1
             GROUP BY event_type`,
            [tenant],
          );

          const cpvResult = await pool.query<{ cpv: string; count: string }>(
            `SELECT value AS cpv, COUNT(*)::text AS count
             FROM procurement_pipeline_events,
                  LATERAL jsonb_array_elements_text(details->'cpv_codes') AS value
             WHERE tenant_id = $1 AND event_type = 'unmapped_cpv'
             GROUP BY value
             ORDER BY COUNT(*) DESC
             LIMIT 50`,
            [tenant],
          );

          const latest = await pool.query<{ created_at: string }>(
            `SELECT created_at::text
             FROM procurement_pipeline_events
             WHERE tenant_id = $1
             ORDER BY created_at DESC
             LIMIT 1`,
            [tenant],
          );

          const countMap = new Map<string, number>();
          for (const row of countsResult.rows) {
            countMap.set(row.event_type, Number(row.count));
          }

          const diagnostics: ProcurementDiagnostics = {
            ingestion_success: countMap.get("ingestion_success") ?? 0,
            ingestion_failure: countMap.get("ingestion_failure") ?? 0,
            normalization_errors: countMap.get("normalization_error") ?? 0,
            enrichment_failures: countMap.get("enrichment_failure") ?? 0,
            unmapped_cpv_codes: cpvResult.rows.map((row) => ({
              cpv: row.cpv,
              count: Number(row.count),
            })),
            entity_matching_uncertainty:
              countMap.get("entity_match_uncertain") ?? 0,
            graph_generation_issues:
              countMap.get("graph_generation_issue") ?? 0,
          };

          if (latest.rows[0]?.created_at) {
            diagnostics.last_run_at = latest.rows[0].created_at;
          }

          return diagnostics;
        },
        async () => {
          const events = memoryStore.eventsByTenant.get(tenant) ?? [];
          const count = (type: PipelineEventType) =>
            events.filter((e) => e.event_type === type).length;
          const cpvCount = new Map<string, number>();
          for (const event of events.filter(
            (e) => e.event_type === "unmapped_cpv",
          )) {
            const values = Array.isArray(event.details.cpv_codes)
              ? event.details.cpv_codes
              : [];
            for (const value of values) {
              if (typeof value !== "string") continue;
              cpvCount.set(value, (cpvCount.get(value) ?? 0) + 1);
            }
          }
          const sorted = [...cpvCount.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([cpv, count]) => ({ cpv, count }));
          const diagnostics: ProcurementDiagnostics = {
            ingestion_success: count("ingestion_success"),
            ingestion_failure: count("ingestion_failure"),
            normalization_errors: count("normalization_error"),
            enrichment_failures: count("enrichment_failure"),
            unmapped_cpv_codes: sorted,
            entity_matching_uncertainty: count("entity_match_uncertain"),
            graph_generation_issues: count("graph_generation_issue"),
          };

          const lastEvent = events.at(-1);
          if (lastEvent?.created_at) {
            diagnostics.last_run_at = lastEvent.created_at;
          }

          return diagnostics;
        },
      );
    },

    async getAggregations(tenantId: string, filters: ProcurementNoticeFilters) {
      const rows = applyFilters(await listRows(tenantId), filters);

      const byRegion = new Map<
        string,
        {
          region: string;
          country: string;
          notice_count: number;
          total_value: number;
        }
      >();
      const demandClusters = new Map<
        string,
        { key: string; notice_count: number; total_value: number }
      >();
      const byBuyer = new Map<
        string,
        { buyer: string; notice_count: number; total_value: number }
      >();
      const bySupplier = new Map<
        string,
        { supplier: string; wins: number; total_value: number }
      >();
      const byTheme = new Map<
        string,
        { theme: string; notice_count: number; total_value: number }
      >();

      for (const row of rows) {
        const regionKey = `${row.country}:${row.region}`;
        const region = byRegion.get(regionKey) ?? {
          region: row.region,
          country: row.country,
          notice_count: 0,
          total_value: 0,
        };
        region.notice_count += 1;
        region.total_value += row.contract_value ?? 0;
        byRegion.set(regionKey, region);

        for (const key of unique([
          ...row.tags.commodity_tags,
          ...row.tags.theme_tags,
        ])) {
          const cluster = demandClusters.get(key) ?? {
            key,
            notice_count: 0,
            total_value: 0,
          };
          cluster.notice_count += 1;
          cluster.total_value += row.contract_value ?? 0;
          demandClusters.set(key, cluster);
        }

        const buyer = byBuyer.get(row.buyer) ?? {
          buyer: row.buyer,
          notice_count: 0,
          total_value: 0,
        };
        buyer.notice_count += 1;
        buyer.total_value += row.contract_value ?? 0;
        byBuyer.set(row.buyer, buyer);

        if (row.supplier) {
          const supplier = bySupplier.get(row.supplier) ?? {
            supplier: row.supplier,
            wins: 0,
            total_value: 0,
          };
          supplier.wins += 1;
          supplier.total_value += row.contract_value ?? 0;
          bySupplier.set(row.supplier, supplier);
        }

        for (const theme of row.tags.theme_tags) {
          const current = byTheme.get(theme) ?? {
            theme,
            notice_count: 0,
            total_value: 0,
          };
          current.notice_count += 1;
          current.total_value += row.contract_value ?? 0;
          byTheme.set(theme, current);
        }
      }

      const top = <
        T extends { notice_count?: number; wins?: number; total_value: number },
      >(
        arr: T[],
      ) =>
        arr
          .sort(
            (a, b) =>
              b.total_value - a.total_value ||
              (b.notice_count ?? b.wins ?? 0) - (a.notice_count ?? a.wins ?? 0),
          )
          .slice(0, 20);

      return {
        rising_activity_by_region: top([...byRegion.values()]),
        unusual_demand_clusters: top([...demandClusters.values()]),
        contract_concentration_by_buyer: top([...byBuyer.values()]),
        supplier_win_momentum: top([...bySupplier.values()]),
        public_spending_surges: top([...byTheme.values()]),
      } satisfies ProcurementAggregations;
    },

    async getGraphRelations(
      tenantId: string,
      filters: ProcurementNoticeFilters,
    ) {
      const rows = applyFilters(await listRows(tenantId), filters);
      const ids = new Set(rows.map((row) => row.notice_id));
      const relations = await listRelations(tenantId);
      return relations.filter((relation) => ids.has(relation.subject_key));
    },

    async getIntegrationFeeds(
      tenantId: string,
      filters: ProcurementNoticeFilters,
    ) {
      const notices = await this.listNotices(tenantId, {
        ...filters,
        limit: Math.min(filters.limit ?? 200, 200),
      });

      const dataVaultEvidence = notices.map((n) => ({
        notice_id: n.notice_id,
        title: n.title,
        raw_source_ref: n.raw_source_ref,
        ...(n.source_url ? { source_url: n.source_url } : {}),
      }));

      const gwmdSignals = notices
        .map((notice) => ({
          entity: notice.buyer,
          signal: "public_procurement_signal",
          score: notice.scores.market_moving_potential.score,
          notice_ids: [notice.notice_id],
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 100);

      const supplyChainOverlays = notices
        .flatMap((notice) =>
          [notice.buyer, notice.supplier].filter(Boolean).map((entity) => ({
            entity: String(entity),
            demand_signal:
              notice.tags.commodity_tags.join(", ") || "multi-commodity",
            confidence: notice.scores.supply_chain_relevance.score / 100,
            notice_ids: [notice.notice_id],
          })),
        )
        .slice(0, 200);

      const intelligencePanorama = await this.getAggregations(
        tenantId,
        filters,
      );

      return {
        data_vault_evidence: dataVaultEvidence,
        gwmd_signals: gwmdSignals,
        supply_chain_overlays: supplyChainOverlays,
        intelligence_panorama: intelligencePanorama,
      } satisfies ProcurementIntegrationFeeds;
    },
  };
}
