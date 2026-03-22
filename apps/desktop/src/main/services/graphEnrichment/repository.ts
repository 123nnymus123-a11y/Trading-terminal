import crypto from "node:crypto";
import { getDb } from "../../persistence/db";
import {
  computeConfidenceBand,
  computeExpiryIso,
  inferTemperature,
} from "./validator";
import type {
  EdgeRecordInput,
  EntityRecordInput,
  EvidenceRecordInput,
  GraphEnrichmentSummary,
  GraphZone,
  InspectorData,
  LinkEvidenceInput,
  QueryUsageInput,
  ValidationStatus,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export type GraphEntityRow = {
  id: string;
  canonical_name: string;
  entity_type: string;
  zone: GraphZone;
  confidence_score: number;
  freshness_score: number;
  confidence_band: string;
  validation_status: ValidationStatus;
  last_seen_at: string;
  stale_flag: number;
};

export type GraphEdgeRow = {
  id: string;
  relation_type: string;
  from_entity_id: string;
  to_entity_id: string;
  zone: GraphZone;
  confidence_score: number;
  freshness_score: number;
  validation_status: ValidationStatus;
  stale_flag: number;
};

export const GraphEnrichmentRepository = {
  upsertEntity(input: EntityRecordInput): void {
    const db = getDb();
    const createdAt = nowIso();
    const updatedAt = createdAt;
    const expiresAt = computeExpiryIso(input.lastSeenAt, input.ttlDays ?? 30);

    db.prepare(
      `INSERT INTO graph_enrichment_entity (
        id, canonical_name, entity_type, zone,
        source_type, source_ref, source_title, source_url,
        ai_inferred, confidence_score, freshness_score, confidence_band,
        first_seen_at, last_seen_at, expires_at,
        validation_status, validation_method, validator_type,
        contradiction_flag, stale_flag, promotion_eligible,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        canonical_name = excluded.canonical_name,
        entity_type = excluded.entity_type,
        zone = excluded.zone,
        source_type = excluded.source_type,
        source_ref = excluded.source_ref,
        source_title = COALESCE(excluded.source_title, graph_enrichment_entity.source_title),
        source_url = COALESCE(excluded.source_url, graph_enrichment_entity.source_url),
        ai_inferred = excluded.ai_inferred,
        confidence_score = excluded.confidence_score,
        freshness_score = excluded.freshness_score,
        confidence_band = excluded.confidence_band,
        first_seen_at = MIN(graph_enrichment_entity.first_seen_at, excluded.first_seen_at),
        last_seen_at = MAX(graph_enrichment_entity.last_seen_at, excluded.last_seen_at),
        expires_at = excluded.expires_at,
        validation_status = excluded.validation_status,
        validation_method = COALESCE(excluded.validation_method, graph_enrichment_entity.validation_method),
        validator_type = COALESCE(excluded.validator_type, graph_enrichment_entity.validator_type),
        contradiction_flag = excluded.contradiction_flag,
        stale_flag = excluded.stale_flag,
        promotion_eligible = excluded.promotion_eligible,
        metadata_json = COALESCE(excluded.metadata_json, graph_enrichment_entity.metadata_json),
        updated_at = excluded.updated_at`,
    ).run(
      input.id,
      input.canonicalName,
      input.entityType,
      input.zone,
      input.sourceType,
      input.sourceRef,
      input.sourceTitle ?? null,
      input.sourceUrl ?? null,
      input.aiInferred ? 1 : 0,
      input.confidenceScore,
      input.freshnessScore,
      computeConfidenceBand(input.confidenceScore),
      input.firstSeenAt,
      input.lastSeenAt,
      expiresAt,
      input.validationStatus,
      input.validationMethod ?? null,
      input.validatorType ?? null,
      input.contradictionFlag ? 1 : 0,
      input.staleFlag ? 1 : 0,
      input.promotionEligible ? 1 : 0,
      input.metadataJson ?? null,
      createdAt,
      updatedAt,
    );
  },

  upsertEdge(input: EdgeRecordInput): void {
    const db = getDb();
    const createdAt = nowIso();
    const updatedAt = createdAt;
    const expiresAt = computeExpiryIso(input.lastSeenAt, input.ttlDays ?? 30);

    db.prepare(
      `INSERT INTO graph_enrichment_edge (
        id, from_entity_id, to_entity_id, relation_type, zone,
        source_type, source_ref, source_title, source_url,
        ai_inferred, confidence_score, freshness_score, confidence_band,
        first_seen_at, last_seen_at, expires_at,
        validation_status, validation_method, validator_type,
        contradiction_flag, stale_flag, promotion_eligible,
        metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        from_entity_id = excluded.from_entity_id,
        to_entity_id = excluded.to_entity_id,
        relation_type = excluded.relation_type,
        zone = excluded.zone,
        source_type = excluded.source_type,
        source_ref = excluded.source_ref,
        source_title = COALESCE(excluded.source_title, graph_enrichment_edge.source_title),
        source_url = COALESCE(excluded.source_url, graph_enrichment_edge.source_url),
        ai_inferred = excluded.ai_inferred,
        confidence_score = excluded.confidence_score,
        freshness_score = excluded.freshness_score,
        confidence_band = excluded.confidence_band,
        first_seen_at = MIN(graph_enrichment_edge.first_seen_at, excluded.first_seen_at),
        last_seen_at = MAX(graph_enrichment_edge.last_seen_at, excluded.last_seen_at),
        expires_at = excluded.expires_at,
        validation_status = excluded.validation_status,
        validation_method = COALESCE(excluded.validation_method, graph_enrichment_edge.validation_method),
        validator_type = COALESCE(excluded.validator_type, graph_enrichment_edge.validator_type),
        contradiction_flag = excluded.contradiction_flag,
        stale_flag = excluded.stale_flag,
        promotion_eligible = excluded.promotion_eligible,
        metadata_json = COALESCE(excluded.metadata_json, graph_enrichment_edge.metadata_json),
        updated_at = excluded.updated_at`,
    ).run(
      input.id,
      input.fromEntityId,
      input.toEntityId,
      input.relationType,
      input.zone,
      input.sourceType,
      input.sourceRef,
      input.sourceTitle ?? null,
      input.sourceUrl ?? null,
      input.aiInferred ? 1 : 0,
      input.confidenceScore,
      input.freshnessScore,
      computeConfidenceBand(input.confidenceScore),
      input.firstSeenAt,
      input.lastSeenAt,
      expiresAt,
      input.validationStatus,
      input.validationMethod ?? null,
      input.validatorType ?? null,
      input.contradictionFlag ? 1 : 0,
      input.staleFlag ? 1 : 0,
      input.promotionEligible ? 1 : 0,
      input.metadataJson ?? null,
      createdAt,
      updatedAt,
    );
  },

  upsertAlias(
    entityId: string,
    alias: string,
    aliasType = "ticker",
    source = "graph",
  ): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO graph_enrichment_alias (entity_id, alias, alias_type, source, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(entityId, alias.trim(), aliasType, source, nowIso());
  },

  upsertEvidence(input: EvidenceRecordInput): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO graph_enrichment_evidence (
        evidence_id, source_type, source_reference, source_title, source_url, source_key,
        snippet, extracted_summary, extraction_method, extracted_at, fingerprint_hash,
        quality_score, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(evidence_id) DO UPDATE SET
        source_type = excluded.source_type,
        source_reference = excluded.source_reference,
        source_title = COALESCE(excluded.source_title, graph_enrichment_evidence.source_title),
        source_url = COALESCE(excluded.source_url, graph_enrichment_evidence.source_url),
        source_key = COALESCE(excluded.source_key, graph_enrichment_evidence.source_key),
        snippet = COALESCE(excluded.snippet, graph_enrichment_evidence.snippet),
        extracted_summary = COALESCE(excluded.extracted_summary, graph_enrichment_evidence.extracted_summary),
        extraction_method = COALESCE(excluded.extraction_method, graph_enrichment_evidence.extraction_method),
        extracted_at = excluded.extracted_at,
        fingerprint_hash = COALESCE(excluded.fingerprint_hash, graph_enrichment_evidence.fingerprint_hash),
        quality_score = excluded.quality_score`,
    ).run(
      input.evidenceId,
      input.sourceType,
      input.sourceReference,
      input.sourceTitle ?? null,
      input.sourceUrl ?? null,
      input.sourceKey ?? null,
      input.snippet ?? null,
      input.extractedSummary ?? null,
      input.extractionMethod ?? null,
      input.extractedAt,
      input.fingerprintHash ?? null,
      input.qualityScore,
      nowIso(),
    );
  },

  linkEvidence(input: LinkEvidenceInput): void {
    const db = getDb();
    db.prepare(
      `INSERT OR IGNORE INTO graph_enrichment_evidence_link (target_type, target_id, evidence_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(input.targetType, input.targetId, input.evidenceId, nowIso());
  },

  recordValidationEvent(params: {
    targetType: "entity" | "edge";
    targetId: string;
    eventType: string;
    fromZone?: GraphZone | null;
    toZone?: GraphZone | null;
    validatorType?: string;
    validationMethod?: string;
    reason: string;
    contradictionFlag?: boolean;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO graph_enrichment_validation_event (
        target_type, target_id, event_type, from_zone, to_zone,
        validator_type, validation_method, reason, contradiction_flag, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      params.targetType,
      params.targetId,
      params.eventType,
      params.fromZone ?? null,
      params.toZone ?? null,
      params.validatorType ?? null,
      params.validationMethod ?? null,
      params.reason,
      params.contradictionFlag ? 1 : 0,
      nowIso(),
    );
  },

  queueRevalidation(params: {
    targetType: "entity" | "edge";
    targetId: string;
    reason: string;
    scheduledAt?: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO graph_enrichment_revalidation_queue (
        target_type, target_id, reason, scheduled_at, status, created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(
      params.targetType,
      params.targetId,
      params.reason,
      params.scheduledAt ?? nowIso(),
      nowIso(),
    );
  },

  recordQueryUsage(input: QueryUsageInput): void {
    const db = getDb();
    const requestedAt = nowIso();
    const queryHash = hashValue(input.queryText.trim().toLowerCase());

    db.prepare(
      `INSERT INTO graph_enrichment_query_history (
        query_hash, query_text, query_cluster, requested_at,
        cache_hit, stale_items_detected, enrichment_delta_count, response_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      queryHash,
      input.queryText,
      input.queryCluster ?? "general",
      requestedAt,
      input.cacheHit ? 1 : 0,
      input.staleItemsDetected ?? 0,
      input.enrichmentDeltaCount ?? 0,
      input.responseMs ?? null,
    );
  },

  bumpUsage(
    targetType: "entity" | "edge",
    targetId: string,
    queryCluster = "general",
    speedupBenefitMs?: number,
  ): void {
    const db = getDb();
    const now = nowIso();
    const row = db
      .prepare(
        `SELECT request_count FROM graph_enrichment_usage_memory WHERE target_type = ? AND target_id = ?`,
      )
      .get(targetType, targetId) as { request_count: number } | undefined;

    const nextCount = (row?.request_count ?? 0) + 1;
    const temperature = inferTemperature(nextCount, now);

    db.prepare(
      `INSERT INTO graph_enrichment_usage_memory (
        target_type, target_id, request_count, last_requested_at, query_cluster,
        speedup_benefit_ms, temperature, improved_response_speed, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_type, target_id) DO UPDATE SET
        request_count = graph_enrichment_usage_memory.request_count + 1,
        last_requested_at = excluded.last_requested_at,
        query_cluster = excluded.query_cluster,
        speedup_benefit_ms = COALESCE(excluded.speedup_benefit_ms, graph_enrichment_usage_memory.speedup_benefit_ms),
        temperature = excluded.temperature,
        improved_response_speed = excluded.improved_response_speed,
        updated_at = excluded.updated_at`,
    ).run(
      targetType,
      targetId,
      nextCount,
      now,
      queryCluster,
      speedupBenefitMs ?? null,
      temperature,
      speedupBenefitMs && speedupBenefitMs > 0 ? 1 : 0,
      now,
    );
  },

  queueSync(operationType: string, payload: unknown): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO graph_enrichment_sync_queue (
        operation_type, payload_json, status, attempts, created_at, updated_at
      ) VALUES (?, ?, 'pending', 0, ?, ?)`,
    ).run(operationType, JSON.stringify(payload), nowIso(), nowIso());
  },

  getPendingSyncQueueSize(): number {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count FROM graph_enrichment_sync_queue WHERE status IN ('pending', 'retry')`,
      )
      .get() as { count: number };
    return row.count ?? 0;
  },

  getLastQueryAt(): string | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT requested_at FROM graph_enrichment_query_history ORDER BY requested_at DESC LIMIT 1`,
      )
      .get() as { requested_at: string } | undefined;
    return row?.requested_at ?? null;
  },

  markExpiredAsStale(): { entities: number; edges: number } {
    const db = getDb();
    const now = nowIso();
    const entityRes = db
      .prepare(
        `UPDATE graph_enrichment_entity
         SET stale_flag = 1, updated_at = ?
         WHERE expires_at <= ?`,
      )
      .run(now, now);
    const edgeRes = db
      .prepare(
        `UPDATE graph_enrichment_edge
         SET stale_flag = 1, updated_at = ?
         WHERE expires_at <= ?`,
      )
      .run(now, now);

    return { entities: entityRes.changes, edges: edgeRes.changes };
  },

  getProductionSubgraphByEntityIds(entityIds: string[]) {
    const db = getDb();
    if (!entityIds.length)
      return { entities: [] as GraphEntityRow[], edges: [] as GraphEdgeRow[] };

    const placeholders = entityIds.map(() => "?").join(",");
    const entities = db
      .prepare(
        `SELECT id, canonical_name, entity_type, zone, confidence_score, freshness_score, confidence_band, validation_status, last_seen_at, stale_flag
         FROM graph_enrichment_entity
         WHERE id IN (${placeholders}) AND zone = 'production'`,
      )
      .all(...entityIds) as GraphEntityRow[];

    const edges = db
      .prepare(
        `SELECT id, relation_type, from_entity_id, to_entity_id, zone, confidence_score, freshness_score, validation_status, stale_flag
         FROM graph_enrichment_edge
         WHERE zone = 'production'
           AND from_entity_id IN (${placeholders})
           AND to_entity_id IN (${placeholders})`,
      )
      .all(...entityIds, ...entityIds) as GraphEdgeRow[];

    return { entities, edges };
  },

  findEntityIdsByQuery(query: string, limit = 20): string[] {
    const db = getDb();
    const normalized = query.trim();
    if (!normalized) return [];
    const needle = `%${normalized.toLowerCase()}%`;
    const rows = db
      .prepare(
        `SELECT DISTINCT id FROM (
          SELECT e.id AS id
          FROM graph_enrichment_entity e
          WHERE LOWER(e.canonical_name) LIKE ?
          UNION
          SELECT a.entity_id AS id
          FROM graph_enrichment_alias a
          WHERE LOWER(a.alias) LIKE ?
        )
        LIMIT ?`,
      )
      .all(needle, needle, limit) as Array<{ id: string }>;
    return rows.map((row) => row.id);
  },

  getProductionNeighborhood(focalEntityId: string, hops = 1) {
    const db = getDb();
    const visited = new Set<string>([focalEntityId]);
    const frontier = new Set<string>([focalEntityId]);

    for (let depth = 0; depth < Math.max(1, hops); depth += 1) {
      const ids = Array.from(frontier);
      if (!ids.length) break;
      const placeholders = ids.map(() => "?").join(",");
      const rows = db
        .prepare(
          `SELECT from_entity_id, to_entity_id
           FROM graph_enrichment_edge
           WHERE zone = 'production'
             AND (from_entity_id IN (${placeholders}) OR to_entity_id IN (${placeholders}))`,
        )
        .all(...ids, ...ids) as Array<{
        from_entity_id: string;
        to_entity_id: string;
      }>;

      const nextFrontier = new Set<string>();
      rows.forEach((row) => {
        if (!visited.has(row.from_entity_id)) {
          visited.add(row.from_entity_id);
          nextFrontier.add(row.from_entity_id);
        }
        if (!visited.has(row.to_entity_id)) {
          visited.add(row.to_entity_id);
          nextFrontier.add(row.to_entity_id);
        }
      });
      frontier.clear();
      nextFrontier.forEach((id) => frontier.add(id));
    }

    return this.getProductionSubgraphByEntityIds(Array.from(visited));
  },

  getInspectorData(limit = 30): InspectorData {
    const db = getDb();
    const summary = this.getSummary();

    const staleEntities = db
      .prepare(
        `SELECT id, canonical_name, entity_type, confidence_score, freshness_score, zone, last_seen_at
         FROM graph_enrichment_entity
         WHERE stale_flag = 1
         ORDER BY last_seen_at DESC
         LIMIT ?`,
      )
      .all(limit) as InspectorData["staleEntities"];

    const lowConfidenceEdges = db
      .prepare(
        `SELECT id, relation_type, from_entity_id, to_entity_id, confidence_score, freshness_score, zone, validation_status
         FROM graph_enrichment_edge
         WHERE confidence_score < 0.5
         ORDER BY confidence_score ASC, updated_at DESC
         LIMIT ?`,
      )
      .all(limit) as InspectorData["lowConfidenceEdges"];

    const recentPromotionEvents = db
      .prepare(
        `SELECT id, target_type, target_id, from_zone, to_zone, event_type, reason, created_at
         FROM graph_enrichment_validation_event
         WHERE event_type IN ('promoted', 'rejected', 'contradicted')
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as InspectorData["recentPromotionEvents"];

    return {
      summary,
      staleEntities,
      lowConfidenceEdges,
      recentPromotionEvents,
    };
  },

  getSummary(): GraphEnrichmentSummary {
    const db = getDb();
    const totals = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM graph_enrichment_entity) AS entities,
          (SELECT COUNT(*) FROM graph_enrichment_edge) AS edges,
          (SELECT COUNT(*) FROM graph_enrichment_entity WHERE zone = 'candidate') + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE zone = 'candidate') AS candidate_items,
          (SELECT COUNT(*) FROM graph_enrichment_entity WHERE zone = 'validation') + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE zone = 'validation') AS validation_items,
          (SELECT COUNT(*) FROM graph_enrichment_entity WHERE zone = 'production') + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE zone = 'production') AS production_items,
          (SELECT COUNT(*) FROM graph_enrichment_entity WHERE stale_flag = 1) + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE stale_flag = 1) AS stale_items,
          (SELECT COUNT(*) FROM graph_enrichment_entity WHERE confidence_score < 0.5) + (SELECT COUNT(*) FROM graph_enrichment_edge WHERE confidence_score < 0.5) AS low_confidence_items,
          (SELECT COUNT(*) FROM graph_enrichment_revalidation_queue WHERE status = 'pending') AS pending_revalidation,
          (SELECT COUNT(*) FROM graph_enrichment_sync_queue WHERE status IN ('pending','retry')) AS queued_sync,
          (SELECT COUNT(*) FROM graph_enrichment_usage_memory WHERE temperature = 'hot') AS hot_targets,
          (SELECT COUNT(*) FROM graph_enrichment_usage_memory WHERE temperature = 'warm') AS warm_targets,
          (SELECT COUNT(*) FROM graph_enrichment_usage_memory WHERE temperature = 'cold') AS cold_targets`,
      )
      .get() as {
      entities: number;
      edges: number;
      candidate_items: number;
      validation_items: number;
      production_items: number;
      stale_items: number;
      low_confidence_items: number;
      pending_revalidation: number;
      queued_sync: number;
      hot_targets: number;
      warm_targets: number;
      cold_targets: number;
    };

    return {
      totalEntities: totals.entities ?? 0,
      totalEdges: totals.edges ?? 0,
      candidateItems: totals.candidate_items ?? 0,
      validationItems: totals.validation_items ?? 0,
      productionItems: totals.production_items ?? 0,
      staleItems: totals.stale_items ?? 0,
      lowConfidenceItems: totals.low_confidence_items ?? 0,
      pendingRevalidation: totals.pending_revalidation ?? 0,
      queuedSyncJobs: totals.queued_sync ?? 0,
      lastQueryAt: this.getLastQueryAt(),
      hotTargets: totals.hot_targets ?? 0,
      warmTargets: totals.warm_targets ?? 0,
      coldTargets: totals.cold_targets ?? 0,
    };
  },

  getRawTableRows(tableName: string, limit = 200): unknown[] {
    const db = getDb();
    const allowed = new Set([
      "graph_enrichment_entity",
      "graph_enrichment_edge",
      "graph_enrichment_alias",
      "graph_enrichment_evidence",
      "graph_enrichment_evidence_link",
      "graph_enrichment_validation_event",
      "graph_enrichment_usage_memory",
      "graph_enrichment_query_history",
      "graph_enrichment_revalidation_queue",
      "graph_enrichment_sync_queue",
    ]);
    if (!allowed.has(tableName)) {
      throw new Error(`table_not_allowed:${tableName}`);
    }
    return db
      .prepare(`SELECT * FROM ${tableName} ORDER BY rowid DESC LIMIT ?`)
      .all(limit);
  },
};
