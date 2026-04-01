import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type {
  GraphMemoryCloudReadiness,
  GraphMemoryDashboard,
  GraphMemoryDetail,
  GraphMemoryDetailRequest,
  GraphMemoryEntityRow,
  GraphMemoryEvidenceRow,
  GraphMemoryExportsManifest,
  GraphMemoryFilters,
  GraphMemoryOverview,
  GraphMemoryRelationshipRow,
  GraphMemoryRevalidateRequest,
  GraphMemoryRevalidateResult,
  GraphMemorySection,
  GraphMemorySectionQuery,
  GraphMemorySectionResponse,
  GraphMemorySnapshotRow,
  GraphMemorySummaryCards,
  GraphMemoryUsageRow,
  GraphMemoryValidationRow,
} from "@tc/shared/graphMemory";
import { getDb } from "../../persistence/db";
import { GraphEnrichmentRepository } from "../graphEnrichment/repository";
import { resolveGraphEnrichmentConfig } from "../graphEnrichment/config";
import { buildNotConnectedStatus } from "../graphEnrichment/cloud";
import { exportGraphEnrichmentSnapshot } from "../graphEnrichment/exporter";

const MAX_PAGE_SIZE = 100;

type QueryCtx = {
  filters: GraphMemoryFilters;
  page: number;
  pageSize: number;
  sortBy: string;
  sortDirection: "asc" | "desc";
};

function nowIso(): string {
  return new Date().toISOString();
}

function toIsoIfDate(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return "";
}

function normalizeQuery(input: GraphMemorySectionQuery): QueryCtx {
  return {
    filters: input.filters ?? {},
    page: Math.max(1, input.page ?? 1),
    pageSize: Math.max(10, Math.min(MAX_PAGE_SIZE, input.pageSize ?? 25)),
    sortBy: input.sortBy ?? "updated_at",
    sortDirection: input.sortDirection === "asc" ? "asc" : "desc",
  };
}

function freshnessBandFromScore(score: number): "fresh" | "aging" | "stale" {
  if (score >= 0.75) return "fresh";
  if (score >= 0.45) return "aging";
  return "stale";
}

function confidenceToBand(score: number): string {
  if (score >= 0.9) return "very_high";
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  if (score >= 0.25) return "low";
  return "very_low";
}

function pushIf<T>(arr: T[], value: T | null | undefined): void {
  if (value !== undefined && value !== null) {
    arr.push(value);
  }
}

function buildEntityWhere(filters: GraphMemoryFilters): {
  whereSql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.search && filters.search.trim().length > 0) {
    const needle = `%${filters.search.trim().toLowerCase()}%`;
    clauses.push(
      `(LOWER(e.canonical_name) LIKE ? OR EXISTS (
          SELECT 1 FROM graph_enrichment_alias a
          WHERE a.entity_id = e.id AND LOWER(a.alias) LIKE ?
        ))`,
    );
    params.push(needle, needle);
  }
  if (filters.zone && filters.zone !== "all") {
    clauses.push("e.zone = ?");
    params.push(filters.zone);
  }
  if (filters.status && filters.status !== "all") {
    clauses.push("e.validation_status = ?");
    params.push(filters.status);
  }
  if (filters.type && filters.type !== "all") {
    clauses.push("e.entity_type = ?");
    params.push(filters.type);
  }
  if (filters.sourceType && filters.sourceType !== "all") {
    clauses.push("e.source_type = ?");
    params.push(filters.sourceType);
  }
  if (filters.confidenceBand && filters.confidenceBand !== "all") {
    clauses.push("e.confidence_band = ?");
    params.push(filters.confidenceBand);
  }
  if (filters.freshnessBand && filters.freshnessBand !== "all") {
    if (filters.freshnessBand === "fresh") {
      clauses.push("e.freshness_score >= 0.75");
    } else if (filters.freshnessBand === "aging") {
      clauses.push("e.freshness_score >= 0.45 AND e.freshness_score < 0.75");
    } else {
      clauses.push("e.freshness_score < 0.45");
    }
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function buildEdgeWhere(filters: GraphMemoryFilters): {
  whereSql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.search && filters.search.trim().length > 0) {
    const needle = `%${filters.search.trim().toLowerCase()}%`;
    clauses.push(
      `(LOWER(src.canonical_name) LIKE ? OR LOWER(dst.canonical_name) LIKE ? OR LOWER(ed.relation_type) LIKE ?)`,
    );
    params.push(needle, needle, needle);
  }
  if (filters.zone && filters.zone !== "all") {
    clauses.push("ed.zone = ?");
    params.push(filters.zone);
  }
  if (filters.status && filters.status !== "all") {
    clauses.push("ed.validation_status = ?");
    params.push(filters.status);
  }
  if (filters.type && filters.type !== "all") {
    clauses.push("ed.relation_type = ?");
    params.push(filters.type);
  }
  if (filters.sourceType && filters.sourceType !== "all") {
    clauses.push("ed.source_type = ?");
    params.push(filters.sourceType);
  }
  if (filters.confidenceBand && filters.confidenceBand !== "all") {
    clauses.push("ed.confidence_band = ?");
    params.push(filters.confidenceBand);
  }
  if (filters.freshnessBand && filters.freshnessBand !== "all") {
    if (filters.freshnessBand === "fresh") {
      clauses.push("ed.freshness_score >= 0.75");
    } else if (filters.freshnessBand === "aging") {
      clauses.push("ed.freshness_score >= 0.45 AND ed.freshness_score < 0.75");
    } else {
      clauses.push("ed.freshness_score < 0.45");
    }
  }

  return {
    whereSql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params,
  };
}

function listDirectoryFiles(
  dirPath: string,
  kind: GraphMemorySnapshotRow["kind"],
): GraphMemorySnapshotRow[] {
  if (!fs.existsSync(dirPath)) return [];
  return fs
    .readdirSync(dirPath)
    .map((name) => {
      const fullPath = path.join(dirPath, name);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) return null;
      return {
        kind,
        fileName: name,
        fullPath,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      } as GraphMemorySnapshotRow;
    })
    .filter((row): row is GraphMemorySnapshotRow => !!row)
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function getUserDataPath(...parts: string[]): string {
  return path.join(app.getPath("userData"), ...parts);
}

function summarizeCards(): GraphMemorySummaryCards {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM graph_enrichment_entity) AS total_entities,
         (SELECT COUNT(*) FROM graph_enrichment_edge) AS total_edges,
         (SELECT COUNT(*) FROM graph_enrichment_evidence) AS total_evidence,
         (SELECT COUNT(*) FROM graph_enrichment_revalidation_queue WHERE status = 'pending') AS queue_pending,
         ((SELECT COUNT(*) FROM graph_enrichment_entity WHERE confidence_score < 0.5)
           + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE confidence_score < 0.5)) AS low_confidence,
         ((SELECT COUNT(*) FROM graph_enrichment_entity WHERE stale_flag = 1)
           + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE stale_flag = 1)) AS stale_items,
         ((SELECT COUNT(*) FROM graph_enrichment_entity WHERE created_at >= datetime('now', '-24 hours'))
           + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE created_at >= datetime('now', '-24 hours'))) AS recently_added,
         ((SELECT COUNT(*) FROM graph_enrichment_entity WHERE zone = 'production')
           + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE zone = 'production')) AS production_count,
         ((SELECT COUNT(*) FROM graph_enrichment_entity WHERE zone = 'candidate')
           + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE zone = 'candidate')) AS candidate_count`,
    )
    .get() as {
    total_entities: number;
    total_edges: number;
    total_evidence: number;
    queue_pending: number;
    low_confidence: number;
    stale_items: number;
    recently_added: number;
    production_count: number;
    candidate_count: number;
  };

  return {
    totalEntities: row.total_entities ?? 0,
    totalRelationships: row.total_edges ?? 0,
    totalEvidenceRecords: row.total_evidence ?? 0,
    validationQueuePending: row.queue_pending ?? 0,
    lowConfidenceItems: row.low_confidence ?? 0,
    staleItems: row.stale_items ?? 0,
    recentlyAdded: row.recently_added ?? 0,
    productionCount: row.production_count ?? 0,
    candidateCount: row.candidate_count ?? 0,
  };
}

function summarizeOverview(): GraphMemoryOverview {
  const db = getDb();

  const entityTypes = db
    .prepare(
      `SELECT entity_type AS label, COUNT(*) AS count
       FROM graph_enrichment_entity
       GROUP BY entity_type
       ORDER BY count DESC
       LIMIT 12`,
    )
    .all() as Array<{ label: string; count: number }>;

  const relationshipTypes = db
    .prepare(
      `SELECT relation_type AS label, COUNT(*) AS count
       FROM graph_enrichment_edge
       GROUP BY relation_type
       ORDER BY count DESC
       LIMIT 12`,
    )
    .all() as Array<{ label: string; count: number }>;

  const confidenceBands = db
    .prepare(
      `SELECT confidence_band AS label, COUNT(*) AS count
       FROM (
         SELECT confidence_band FROM graph_enrichment_entity
         UNION ALL
         SELECT confidence_band FROM graph_enrichment_edge
       )
       GROUP BY confidence_band
       ORDER BY count DESC`,
    )
    .all() as Array<{ label: string; count: number }>;

  const freshnessRaw = db
    .prepare(
      `SELECT freshness_score AS score FROM graph_enrichment_entity
       UNION ALL
       SELECT freshness_score AS score FROM graph_enrichment_edge`,
    )
    .all() as Array<{ score: number }>;

  const freshnessMap = new Map<string, number>([
    ["fresh", 0],
    ["aging", 0],
    ["stale", 0],
  ]);
  freshnessRaw.forEach((row) => {
    const band = freshnessBandFromScore(row.score ?? 0);
    freshnessMap.set(band, (freshnessMap.get(band) ?? 0) + 1);
  });
  const freshnessBands = Array.from(freshnessMap.entries()).map(
    ([label, count]) => ({ label, count }),
  );

  const zoneSplit = db
    .prepare(
      `SELECT zone AS label, COUNT(*) AS count
       FROM (
         SELECT zone FROM graph_enrichment_entity
         UNION ALL
         SELECT zone FROM graph_enrichment_edge
       )
       GROUP BY zone
       ORDER BY count DESC`,
    )
    .all() as Array<{
    label: "candidate" | "validation" | "production";
    count: number;
  }>;

  const latestIngested = db
    .prepare(
      `SELECT id, kind, label, at FROM (
         SELECT id, 'entity' AS kind, canonical_name AS label, created_at AS at
         FROM graph_enrichment_entity
         UNION ALL
         SELECT id, 'edge' AS kind, relation_type AS label, created_at AS at
         FROM graph_enrichment_edge
       )
       ORDER BY at DESC
       LIMIT 12`,
    )
    .all() as Array<{
    id: string;
    kind: "entity" | "edge";
    label: string;
    at: string;
  }>;

  const latestValidated = db
    .prepare(
      `SELECT target_id AS id, target_type AS kind, event_type AS label, created_at AS at
       FROM graph_enrichment_validation_event
       WHERE event_type IN ('promoted', 'validated')
       ORDER BY created_at DESC
       LIMIT 12`,
    )
    .all() as Array<{
    id: string;
    kind: "entity" | "edge";
    label: string;
    at: string;
  }>;

  const latestRejected = db
    .prepare(
      `SELECT target_id AS id, target_type AS kind, event_type AS label, created_at AS at
       FROM graph_enrichment_validation_event
       WHERE event_type IN ('rejected', 'contradicted')
       ORDER BY created_at DESC
       LIMIT 12`,
    )
    .all() as Array<{
    id: string;
    kind: "entity" | "edge";
    label: string;
    at: string;
  }>;

  const mostRequested = db
    .prepare(
      `SELECT target_id AS id, target_type AS kind, request_count, temperature
       FROM graph_enrichment_usage_memory
       ORDER BY request_count DESC
       LIMIT 12`,
    )
    .all() as Array<{
    id: string;
    kind: "entity" | "edge";
    request_count: number;
    temperature: string;
  }>;

  const hottestSubgraphs = db
    .prepare(
      `SELECT COALESCE(query_cluster, 'general') AS query_cluster, COUNT(*) AS requests
       FROM graph_enrichment_query_history
       GROUP BY query_cluster
       ORDER BY requests DESC
       LIMIT 8`,
    )
    .all() as Array<{ query_cluster: string; requests: number }>;

  const staleWatchlist = db
    .prepare(
      `SELECT id, kind, score, zone FROM (
         SELECT id, 'entity' AS kind, confidence_score AS score, zone
         FROM graph_enrichment_entity
         WHERE stale_flag = 1 OR confidence_score < 0.5
         UNION ALL
         SELECT id, 'edge' AS kind, confidence_score AS score, zone
         FROM graph_enrichment_edge
         WHERE stale_flag = 1 OR confidence_score < 0.5
       )
       ORDER BY score ASC
       LIMIT 20`,
    )
    .all() as Array<{
    id: string;
    kind: "entity" | "edge";
    score: number;
    zone: string;
  }>;

  return {
    entityTypes,
    relationshipTypes,
    confidenceBands,
    freshnessBands,
    zoneSplit,
    latestIngested,
    latestValidated,
    latestRejected,
    mostRequested: mostRequested.map((row) => ({
      id: row.id,
      kind: row.kind,
      requestCount: row.request_count,
      temperature: row.temperature,
    })),
    hottestSubgraphs: hottestSubgraphs.map((row) => ({
      queryCluster: row.query_cluster,
      requests: row.requests,
    })),
    staleWatchlist,
  };
}

function sectionColumns(section: GraphMemorySection): string[] {
  if (section === "entities") {
    return [
      "canonical_name",
      "entity_type",
      "confidence_score",
      "freshness_score",
      "validation_status",
      "zone",
      "last_seen_at",
      "updated_at",
    ];
  }
  if (section === "relationships") {
    return [
      "relation_type",
      "confidence_score",
      "freshness_score",
      "validation_status",
      "zone",
      "last_seen_at",
      "updated_at",
      "contradiction_flag",
    ];
  }
  if (section === "evidence") {
    return [
      "source_type",
      "source_title",
      "quality_score",
      "extracted_at",
      "source_reference",
    ];
  }
  if (section === "validation") {
    return [
      "validation_status",
      "validator_type",
      "stale_flag",
      "contradiction_flag",
      "zone",
      "expires_at",
      "updated_at",
    ];
  }
  if (section === "usage") {
    return [
      "request_count",
      "last_requested_at",
      "query_cluster",
      "temperature",
      "speedup_benefit_ms",
    ];
  }
  return ["updated_at"];
}

function asOrderBy(
  section: GraphMemorySection,
  sortBy: string,
  sortDirection: "asc" | "desc",
): string {
  const allowed = sectionColumns(section);
  const safeColumn = allowed.includes(sortBy)
    ? sortBy
    : allowed[allowed.length - 1];
  return `${safeColumn} ${sortDirection.toUpperCase()}`;
}

function queryEntities(
  input: GraphMemorySectionQuery,
): GraphMemorySectionResponse<GraphMemoryEntityRow> {
  const db = getDb();
  const query = normalizeQuery(input);
  const where = buildEntityWhere(query.filters);
  const offset = (query.page - 1) * query.pageSize;
  const orderBy = asOrderBy("entities", query.sortBy, query.sortDirection);

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM graph_enrichment_entity e
       ${where.whereSql}`,
    )
    .get(...where.params) as { count: number };

  const rows = db
    .prepare(
      `SELECT
         e.id,
         e.canonical_name,
         e.entity_type,
         e.confidence_score,
         e.confidence_band,
         e.freshness_score,
         e.validation_status,
         e.zone,
         e.last_seen_at,
         e.updated_at,
         COALESCE(alias_counts.aliases_count, 0) AS aliases_count,
         COALESCE(edge_counts.related_edges_count, 0) AS related_edges_count,
         COALESCE(evidence_counts.evidence_count, 0) AS evidence_count,
         json_extract(e.metadata_json, '$.country') AS country,
         json_extract(e.metadata_json, '$.region') AS region
       FROM graph_enrichment_entity e
       LEFT JOIN (
         SELECT entity_id, COUNT(*) AS aliases_count
         FROM graph_enrichment_alias
         GROUP BY entity_id
       ) alias_counts ON alias_counts.entity_id = e.id
       LEFT JOIN (
         SELECT from_entity_id AS entity_id, COUNT(*) AS edge_count
         FROM graph_enrichment_edge
         GROUP BY from_entity_id
         UNION ALL
         SELECT to_entity_id AS entity_id, COUNT(*) AS edge_count
         FROM graph_enrichment_edge
         GROUP BY to_entity_id
       ) edge_all ON edge_all.entity_id = e.id
       LEFT JOIN (
         SELECT entity_id, SUM(edge_count) AS related_edges_count
         FROM (
           SELECT from_entity_id AS entity_id, COUNT(*) AS edge_count
           FROM graph_enrichment_edge
           GROUP BY from_entity_id
           UNION ALL
           SELECT to_entity_id AS entity_id, COUNT(*) AS edge_count
           FROM graph_enrichment_edge
           GROUP BY to_entity_id
         )
         GROUP BY entity_id
       ) edge_counts ON edge_counts.entity_id = e.id
       LEFT JOIN (
         SELECT target_id, COUNT(*) AS evidence_count
         FROM graph_enrichment_evidence_link
         WHERE target_type = 'entity'
         GROUP BY target_id
       ) evidence_counts ON evidence_counts.target_id = e.id
       ${where.whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, query.pageSize, offset) as Array<{
    id: string;
    canonical_name: string;
    entity_type: string;
    aliases_count: number;
    country: string | null;
    region: string | null;
    confidence_score: number;
    confidence_band: string;
    freshness_score: number;
    validation_status: string;
    zone: "candidate" | "validation" | "production";
    evidence_count: number;
    related_edges_count: number;
    last_seen_at: string;
    updated_at: string;
  }>;

  return {
    section: "entities",
    items: rows.map((row) => ({
      id: row.id,
      canonicalName: row.canonical_name,
      entityType: row.entity_type,
      aliasesCount: row.aliases_count,
      region: row.region ?? row.country ?? null,
      confidence: row.confidence_score,
      confidenceBand: row.confidence_band,
      freshness: row.freshness_score,
      validationStatus: row.validation_status,
      zone: row.zone,
      evidenceCount: row.evidence_count,
      relatedEdgesCount: row.related_edges_count,
      lastSeenAt: row.last_seen_at,
      updatedAt: row.updated_at,
    })),
    total: countRow.count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function queryRelationships(
  input: GraphMemorySectionQuery,
): GraphMemorySectionResponse<GraphMemoryRelationshipRow> {
  const db = getDb();
  const query = normalizeQuery(input);
  const where = buildEdgeWhere(query.filters);
  const offset = (query.page - 1) * query.pageSize;
  const orderBy = asOrderBy("relationships", query.sortBy, query.sortDirection);

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM graph_enrichment_edge ed
       LEFT JOIN graph_enrichment_entity src ON src.id = ed.from_entity_id
       LEFT JOIN graph_enrichment_entity dst ON dst.id = ed.to_entity_id
       ${where.whereSql}`,
    )
    .get(...where.params) as { count: number };

  const rows = db
    .prepare(
      `SELECT
         ed.id,
         ed.from_entity_id,
         src.canonical_name AS from_name,
         ed.relation_type,
         ed.to_entity_id,
         dst.canonical_name AS to_name,
         ed.confidence_score,
         ed.confidence_band,
         ed.freshness_score,
         ed.validation_status,
         ed.zone,
         ed.contradiction_flag,
         ed.first_seen_at,
         ed.last_seen_at,
         ed.updated_at,
         COALESCE(ev.evidence_count, 0) AS evidence_count
       FROM graph_enrichment_edge ed
       LEFT JOIN graph_enrichment_entity src ON src.id = ed.from_entity_id
       LEFT JOIN graph_enrichment_entity dst ON dst.id = ed.to_entity_id
       LEFT JOIN (
         SELECT target_id, COUNT(*) AS evidence_count
         FROM graph_enrichment_evidence_link
         WHERE target_type = 'edge'
         GROUP BY target_id
       ) ev ON ev.target_id = ed.id
       ${where.whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...where.params, query.pageSize, offset) as Array<{
    id: string;
    from_entity_id: string;
    from_name: string;
    relation_type: string;
    to_entity_id: string;
    to_name: string;
    confidence_score: number;
    confidence_band: string;
    freshness_score: number;
    validation_status: string;
    zone: "candidate" | "validation" | "production";
    evidence_count: number;
    contradiction_flag: number;
    first_seen_at: string;
    last_seen_at: string;
    updated_at: string;
  }>;

  return {
    section: "relationships",
    items: rows.map((row) => ({
      id: row.id,
      fromEntityId: row.from_entity_id,
      fromEntityName: row.from_name || row.from_entity_id,
      relationType: row.relation_type,
      toEntityId: row.to_entity_id,
      toEntityName: row.to_name || row.to_entity_id,
      confidence: row.confidence_score,
      confidenceBand: row.confidence_band,
      freshness: row.freshness_score,
      validationStatus: row.validation_status,
      zone: row.zone,
      evidenceCount: row.evidence_count,
      contradictionFlag: row.contradiction_flag === 1,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      updatedAt: row.updated_at,
    })),
    total: countRow.count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function queryEvidence(
  input: GraphMemorySectionQuery,
): GraphMemorySectionResponse<GraphMemoryEvidenceRow> {
  const db = getDb();
  const query = normalizeQuery(input);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.filters.search && query.filters.search.trim()) {
    const needle = `%${query.filters.search.trim().toLowerCase()}%`;
    clauses.push(
      `(LOWER(ev.source_title) LIKE ? OR LOWER(ev.source_reference) LIKE ? OR LOWER(COALESCE(ev.snippet, '')) LIKE ?)`,
    );
    params.push(needle, needle, needle);
  }
  if (query.filters.sourceType && query.filters.sourceType !== "all") {
    clauses.push("ev.source_type = ?");
    params.push(query.filters.sourceType);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const orderBy = asOrderBy("evidence", query.sortBy, query.sortDirection);
  const offset = (query.page - 1) * query.pageSize;

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM graph_enrichment_evidence ev ${whereSql}`,
    )
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `SELECT
         ev.evidence_id,
         ev.source_type,
         ev.source_title,
         ev.extraction_method,
         ev.quality_score,
         ev.extracted_at,
         ev.source_reference,
         ev.snippet,
         COALESCE(linked.linked_count, 0) AS linked_count
       FROM graph_enrichment_evidence ev
       LEFT JOIN (
         SELECT evidence_id, COUNT(*) AS linked_count
         FROM graph_enrichment_evidence_link
         GROUP BY evidence_id
       ) linked ON linked.evidence_id = ev.evidence_id
       ${whereSql}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, offset) as Array<{
    evidence_id: string;
    source_type: string;
    source_title: string | null;
    extraction_method: string | null;
    linked_count: number;
    quality_score: number;
    extracted_at: string;
    snippet: string | null;
    source_reference: string;
  }>;

  return {
    section: "evidence",
    items: rows.map((row) => ({
      evidenceId: row.evidence_id,
      sourceType: row.source_type,
      sourceTitle: row.source_title,
      extractionMethod: row.extraction_method,
      linkedCount: row.linked_count,
      qualityScore: row.quality_score,
      extractedAt: row.extracted_at,
      snippetPreview: (row.snippet ?? "").slice(0, 180),
      sourceReference: row.source_reference,
    })),
    total: countRow.count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function queryValidation(
  input: GraphMemorySectionQuery,
): GraphMemorySectionResponse<GraphMemoryValidationRow> {
  const db = getDb();
  const query = normalizeQuery(input);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.filters.search && query.filters.search.trim()) {
    const needle = `%${query.filters.search.trim().toLowerCase()}%`;
    clauses.push(
      `(LOWER(base.record_id) LIKE ? OR LOWER(base.validation_status) LIKE ? OR LOWER(COALESCE(base.validation_method, '')) LIKE ?)`,
    );
    params.push(needle, needle, needle);
  }
  if (query.filters.status && query.filters.status !== "all") {
    clauses.push("base.validation_status = ?");
    params.push(query.filters.status);
  }
  if (query.filters.zone && query.filters.zone !== "all") {
    clauses.push("base.zone = ?");
    params.push(query.filters.zone);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const offset = (query.page - 1) * query.pageSize;

  const baseSql = `
    SELECT
      e.id AS record_id,
      'entity' AS record_type,
      e.validation_status,
      e.validator_type,
      e.stale_flag,
      e.contradiction_flag,
      e.promotion_eligible,
      e.validation_method,
      e.expires_at,
      e.zone,
      e.updated_at
    FROM graph_enrichment_entity e
    UNION ALL
    SELECT
      ed.id AS record_id,
      'edge' AS record_type,
      ed.validation_status,
      ed.validator_type,
      ed.stale_flag,
      ed.contradiction_flag,
      ed.promotion_eligible,
      ed.validation_method,
      ed.expires_at,
      ed.zone,
      ed.updated_at
    FROM graph_enrichment_edge ed`;

  const countRow = db
    .prepare(`SELECT COUNT(*) AS count FROM (${baseSql}) base ${whereSql}`)
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `SELECT
         base.record_id,
         base.record_type,
         base.validation_status,
         base.validator_type,
         base.stale_flag,
         base.contradiction_flag,
         base.promotion_eligible,
         base.validation_method,
         base.expires_at,
         base.zone,
         base.updated_at,
         ve.last_validated_at
       FROM (${baseSql}) base
       LEFT JOIN (
         SELECT target_id, target_type, MAX(created_at) AS last_validated_at
         FROM graph_enrichment_validation_event
         GROUP BY target_id, target_type
       ) ve ON ve.target_id = base.record_id AND ve.target_type = base.record_type
       ${whereSql}
       ORDER BY base.updated_at ${query.sortDirection.toUpperCase()}
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, offset) as Array<{
    record_id: string;
    record_type: "entity" | "edge";
    validation_status: string;
    validator_type: string | null;
    stale_flag: number;
    contradiction_flag: number;
    promotion_eligible: number;
    validation_method: string | null;
    expires_at: string | null;
    zone: "candidate" | "validation" | "production";
    updated_at: string;
    last_validated_at: string | null;
  }>;

  return {
    section: "validation",
    items: rows.map((row) => ({
      recordId: row.record_id,
      recordType: row.record_type,
      validationStatus: row.validation_status,
      validatorType: row.validator_type,
      staleFlag: row.stale_flag === 1,
      contradictionFlag: row.contradiction_flag === 1,
      promotionEligible: row.promotion_eligible === 1,
      lastValidatedAt: row.last_validated_at,
      validationMethod: row.validation_method,
      expiresAt: row.expires_at,
      zone: row.zone,
    })),
    total: countRow.count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function queryUsage(
  input: GraphMemorySectionQuery,
): GraphMemorySectionResponse<GraphMemoryUsageRow> {
  const db = getDb();
  const query = normalizeQuery(input);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (query.filters.search && query.filters.search.trim()) {
    const needle = `%${query.filters.search.trim().toLowerCase()}%`;
    clauses.push(
      `(LOWER(u.target_id) LIKE ? OR LOWER(COALESCE(u.query_cluster, '')) LIKE ? OR LOWER(u.temperature) LIKE ?)`,
    );
    params.push(needle, needle, needle);
  }
  if (query.filters.type && query.filters.type !== "all") {
    clauses.push("u.target_type = ?");
    params.push(query.filters.type);
  }
  if (query.filters.status && query.filters.status !== "all") {
    clauses.push("u.temperature = ?");
    params.push(query.filters.status);
  }

  const whereSql = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const offset = (query.page - 1) * query.pageSize;

  const countRow = db
    .prepare(
      `SELECT COUNT(*) AS count FROM graph_enrichment_usage_memory u ${whereSql}`,
    )
    .get(...params) as { count: number };

  const rows = db
    .prepare(
      `SELECT
         u.target_id,
         u.target_type,
         u.request_count,
         u.last_requested_at,
         u.query_cluster,
         u.temperature,
         u.speedup_benefit_ms,
         u.improved_response_speed
       FROM graph_enrichment_usage_memory u
       ${whereSql}
       ORDER BY u.request_count DESC, u.last_requested_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, query.pageSize, offset) as Array<{
    target_id: string;
    target_type: "entity" | "edge";
    request_count: number;
    last_requested_at: string;
    query_cluster: string | null;
    temperature: "hot" | "warm" | "cold";
    speedup_benefit_ms: number | null;
    improved_response_speed: number;
  }>;

  return {
    section: "usage",
    items: rows.map((row, index) => ({
      recordId: row.target_id,
      recordType: row.target_type,
      requestCount: row.request_count,
      lastRequestedAt: row.last_requested_at,
      queryCluster: row.query_cluster,
      temperature: row.temperature,
      speedupBenefitMs: row.speedup_benefit_ms,
      improvedResponseSpeed: row.improved_response_speed === 1,
      popularityRank: (query.page - 1) * query.pageSize + index + 1,
    })),
    total: countRow.count ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function querySnapshots(
  input: GraphMemorySectionQuery,
): GraphMemorySectionResponse<GraphMemorySnapshotRow> {
  const manifest = listExports();
  const query = normalizeQuery(input);
  const searchNeedle = query.filters.search?.trim().toLowerCase() ?? "";

  let items = manifest.files;
  if (searchNeedle) {
    items = items.filter((item) =>
      item.fileName.toLowerCase().includes(searchNeedle),
    );
  }

  const start = (query.page - 1) * query.pageSize;
  const paged = items.slice(start, start + query.pageSize);

  return {
    section: "snapshots",
    items: paged,
    total: items.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function queryCloud(
  input: GraphMemorySectionQuery,
): GraphMemorySectionResponse<GraphMemoryCloudReadiness> {
  const query = normalizeQuery(input);
  const readiness = resolveCloudReadiness();
  return {
    section: "cloud",
    items: [readiness],
    total: 1,
    page: query.page,
    pageSize: query.pageSize,
  };
}

function resolveCloudReadiness(): GraphMemoryCloudReadiness {
  const config = resolveGraphEnrichmentConfig();
  const sync = buildNotConnectedStatus({
    provider: config.cloudProvider,
    mode: config.cloudSyncMode,
    queueSize: GraphEnrichmentRepository.getPendingSyncQueueSize(),
    lastSyncAt: null,
  });

  return {
    cloudEnabled: sync.cloudEnabled,
    connected: sync.connected,
    provider: config.cloudProvider,
    projectId: config.cloudProjectId || "<placeholder>",
    dbUrl: config.cloudDbUrl || "<placeholder>",
    bucket: config.cloudBucket || "<placeholder>",
    syncMode: config.cloudSyncMode,
    queuedRecords: sync.queueSize,
    unsyncedChanges: sync.queueSize,
    adapterStatus: sync.connected ? "Connected" : "Not Connected",
    conflictStrategy: "latest_timestamp",
    message:
      "Cloud structure is prepared, but no live server is connected yet. Local-first mode remains active.",
    lastSyncAt: sync.lastSyncAt,
  };
}

function listExports(): GraphMemoryExportsManifest {
  const jsonDir = getUserDataPath("data", "exports", "json");
  const csvDir = getUserDataPath("data", "exports", "csv");
  const snapshotDir = getUserDataPath("data", "snapshots");

  const files = [
    ...listDirectoryFiles(jsonDir, "json"),
    ...listDirectoryFiles(csvDir, "csv"),
    ...listDirectoryFiles(snapshotDir, "snapshot"),
  ].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  const latestSnapshotPath =
    files.find((item) => item.kind === "snapshot")?.fullPath ??
    files.find((item) => item.kind === "json")?.fullPath ??
    null;

  return {
    latestSnapshotPath,
    files,
  };
}

function resolveDetail(input: GraphMemoryDetailRequest): GraphMemoryDetail {
  const db = getDb();

  if (input.section === "entities") {
    const entity = db
      .prepare(`SELECT * FROM graph_enrichment_entity WHERE id = ? LIMIT 1`)
      .get(input.id) as Record<string, unknown> | undefined;
    const aliases = db
      .prepare(
        `SELECT alias, alias_type, source, created_at FROM graph_enrichment_alias WHERE entity_id = ? ORDER BY alias ASC`,
      )
      .all(input.id) as Array<Record<string, unknown>>;
    const relatedEdges = db
      .prepare(
        `SELECT id, from_entity_id, to_entity_id, relation_type, confidence_score, validation_status, zone
         FROM graph_enrichment_edge
         WHERE from_entity_id = ? OR to_entity_id = ?
         ORDER BY updated_at DESC
         LIMIT 50`,
      )
      .all(input.id, input.id) as Array<Record<string, unknown>>;
    const evidence = db
      .prepare(
        `SELECT ev.*
         FROM graph_enrichment_evidence_link l
         JOIN graph_enrichment_evidence ev ON ev.evidence_id = l.evidence_id
         WHERE l.target_type = 'entity' AND l.target_id = ?
         ORDER BY ev.extracted_at DESC`,
      )
      .all(input.id) as Array<Record<string, unknown>>;
    const timeline = db
      .prepare(
        `SELECT event_type, from_zone, to_zone, validator_type, validation_method, reason, created_at
         FROM graph_enrichment_validation_event
         WHERE target_type = 'entity' AND target_id = ?
         ORDER BY created_at DESC`,
      )
      .all(input.id) as Array<Record<string, unknown>>;

    return {
      summary: entity ?? {},
      provenance: {
        sourceType: entity?.source_type,
        sourceRef: entity?.source_ref,
        sourceTitle: entity?.source_title,
        sourceUrl: entity?.source_url,
      },
      related: {
        aliases,
        relatedEdges,
        evidence,
      },
      raw: {
        entity,
        aliases,
        relatedEdges,
        evidence,
      },
      timeline,
    };
  }

  if (input.section === "relationships") {
    const edge = db
      .prepare(`SELECT * FROM graph_enrichment_edge WHERE id = ? LIMIT 1`)
      .get(input.id) as Record<string, unknown> | undefined;
    const sourceEntity = edge
      ? (db
          .prepare(`SELECT * FROM graph_enrichment_entity WHERE id = ? LIMIT 1`)
          .get(edge.from_entity_id) as Record<string, unknown> | undefined)
      : undefined;
    const targetEntity = edge
      ? (db
          .prepare(`SELECT * FROM graph_enrichment_entity WHERE id = ? LIMIT 1`)
          .get(edge.to_entity_id) as Record<string, unknown> | undefined)
      : undefined;
    const evidence = db
      .prepare(
        `SELECT ev.*
         FROM graph_enrichment_evidence_link l
         JOIN graph_enrichment_evidence ev ON ev.evidence_id = l.evidence_id
         WHERE l.target_type = 'edge' AND l.target_id = ?
         ORDER BY ev.extracted_at DESC`,
      )
      .all(input.id) as Array<Record<string, unknown>>;
    const timeline = db
      .prepare(
        `SELECT event_type, from_zone, to_zone, validator_type, validation_method, reason, contradiction_flag, created_at
         FROM graph_enrichment_validation_event
         WHERE target_type = 'edge' AND target_id = ?
         ORDER BY created_at DESC`,
      )
      .all(input.id) as Array<Record<string, unknown>>;

    return {
      summary: edge ?? {},
      provenance: {
        sourceType: edge?.source_type,
        sourceRef: edge?.source_ref,
        sourceTitle: edge?.source_title,
        sourceUrl: edge?.source_url,
      },
      related: {
        sourceEntity: sourceEntity ?? null,
        targetEntity: targetEntity ?? null,
        evidence,
      },
      raw: {
        edge,
        sourceEntity,
        targetEntity,
        evidence,
      },
      timeline,
    };
  }

  if (input.section === "evidence") {
    const evidence = db
      .prepare(
        `SELECT * FROM graph_enrichment_evidence WHERE evidence_id = ? LIMIT 1`,
      )
      .get(input.id) as Record<string, unknown> | undefined;
    const links = db
      .prepare(
        `SELECT target_type, target_id, created_at
         FROM graph_enrichment_evidence_link
         WHERE evidence_id = ?
         ORDER BY created_at DESC`,
      )
      .all(input.id) as Array<Record<string, unknown>>;

    return {
      summary: evidence ?? {},
      provenance: {
        sourceType: evidence?.source_type,
        sourceReference: evidence?.source_reference,
        sourceTitle: evidence?.source_title,
        sourceUrl: evidence?.source_url,
      },
      related: { links },
      raw: { evidence, links },
      timeline: links,
    };
  }

  if (input.section === "validation") {
    const recordType = input.recordType ?? "entity";
    const table =
      recordType === "edge"
        ? "graph_enrichment_edge"
        : "graph_enrichment_entity";
    const record = db
      .prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`)
      .get(input.id) as Record<string, unknown> | undefined;
    const events = db
      .prepare(
        `SELECT * FROM graph_enrichment_validation_event
         WHERE target_type = ? AND target_id = ?
         ORDER BY created_at DESC`,
      )
      .all(recordType, input.id) as Array<Record<string, unknown>>;

    return {
      summary: record ?? {},
      provenance: {
        validationStatus: record?.validation_status,
        validationMethod: record?.validation_method,
        validatorType: record?.validator_type,
      },
      related: { events },
      raw: { record, events },
      timeline: events,
    };
  }

  if (input.section === "usage") {
    const [recordType, recordId] = input.id.includes(":")
      ? (input.id.split(":", 2) as ["entity" | "edge", string])
      : (["entity", input.id] as ["entity" | "edge", string]);

    const usage = db
      .prepare(
        `SELECT * FROM graph_enrichment_usage_memory WHERE target_type = ? AND target_id = ? LIMIT 1`,
      )
      .get(recordType, recordId) as Record<string, unknown> | undefined;

    const recentQueries = db
      .prepare(
        `SELECT * FROM graph_enrichment_query_history
         WHERE query_cluster = ?
         ORDER BY requested_at DESC
         LIMIT 40`,
      )
      .all(usage?.query_cluster ?? "general") as Array<Record<string, unknown>>;

    return {
      summary: usage ?? {},
      provenance: {
        temperature: usage?.temperature,
        queryCluster: usage?.query_cluster,
      },
      related: {
        recentQueries,
      },
      raw: {
        usage,
        recentQueries,
      },
      timeline: recentQueries,
    };
  }

  if (input.section === "snapshots") {
    const files = listExports().files;
    const file = files.find(
      (row) => row.fullPath === input.id || row.fileName === input.id,
    );
    return {
      summary: file ?? {},
      provenance: {},
      related: {},
      raw: { file },
      timeline: [],
    };
  }

  if (
    input.section === "cloud" ||
    input.section === "settings" ||
    input.section === "overview"
  ) {
    const cloud = resolveCloudReadiness();
    return {
      summary: cloud,
      provenance: {
        mode: cloud.syncMode,
      },
      related: {
        queuedRecords: cloud.queuedRecords,
      },
      raw: cloud as Record<string, unknown>,
      timeline: [],
    };
  }

  return {
    summary: {},
    provenance: {},
    related: {},
    raw: {},
    timeline: [],
  };
}

export type GraphMemoryService = {
  getDashboard: () => Promise<GraphMemoryDashboard>;
  getSection: (
    input: GraphMemorySectionQuery,
  ) => Promise<
    | GraphMemorySectionResponse<GraphMemoryEntityRow>
    | GraphMemorySectionResponse<GraphMemoryRelationshipRow>
    | GraphMemorySectionResponse<GraphMemoryEvidenceRow>
    | GraphMemorySectionResponse<GraphMemoryValidationRow>
    | GraphMemorySectionResponse<GraphMemoryUsageRow>
    | GraphMemorySectionResponse<GraphMemorySnapshotRow>
    | GraphMemorySectionResponse<GraphMemoryCloudReadiness>
  >;
  getDetail: (input: GraphMemoryDetailRequest) => Promise<GraphMemoryDetail>;
  refresh: () => Promise<{ at: string; summaryCards: GraphMemorySummaryCards }>;
  revalidateSelected: (
    payload: GraphMemoryRevalidateRequest,
  ) => Promise<GraphMemoryRevalidateResult>;
  exportNow: () => Promise<{
    jsonPath: string;
    csvPaths: string[];
    exportedAt: string;
  }>;
  getExportsManifest: () => Promise<GraphMemoryExportsManifest>;
  getLatestSnapshotPath: () => Promise<string | null>;
};

export function createGraphMemoryService(): GraphMemoryService {
  return {
    async getDashboard() {
      const cloud = resolveCloudReadiness();
      return {
        title: "DATA VAULT",
        subtitle: "Structured graph memory and evidence registry",
        localDbStatus: "ready",
        lastLocalRefreshAt: nowIso(),
        cloud,
        summaryCards: summarizeCards(),
        overview: summarizeOverview(),
      };
    },

    async getSection(input) {
      const section = input.section;
      if (section === "entities") return queryEntities(input);
      if (section === "relationships") return queryRelationships(input);
      if (section === "evidence") return queryEvidence(input);
      if (section === "validation") return queryValidation(input);
      if (section === "usage") return queryUsage(input);
      if (section === "snapshots") return querySnapshots(input);
      if (section === "cloud" || section === "settings")
        return queryCloud(input);

      return {
        section,
        items: [],
        total: 0,
        page: Math.max(1, input.page ?? 1),
        pageSize: Math.max(10, Math.min(MAX_PAGE_SIZE, input.pageSize ?? 25)),
      };
    },

    async getDetail(input) {
      return resolveDetail(input);
    },

    async refresh() {
      return {
        at: nowIso(),
        summaryCards: summarizeCards(),
      };
    },

    async revalidateSelected(payload) {
      let queued = 0;
      let skipped = 0;
      const seen = new Set<string>();

      for (const record of payload.records ?? []) {
        const key = `${record.recordType}:${record.id}`;
        if (!record.id || seen.has(key)) {
          skipped += 1;
          continue;
        }
        seen.add(key);
        GraphEnrichmentRepository.queueRevalidation({
          targetType: record.recordType,
          targetId: record.id,
          reason: "Requested from DATA VAULT",
        });
        queued += 1;
      }

      return { queued, skipped };
    },

    async exportNow() {
      return exportGraphEnrichmentSnapshot();
    },

    async getExportsManifest() {
      return listExports();
    },

    async getLatestSnapshotPath() {
      return listExports().latestSnapshotPath;
    },
  };
}
