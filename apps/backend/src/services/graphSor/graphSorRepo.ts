import type { Pool } from "pg";

export type GraphSorStatus = {
  tenantId: string;
  entitiesCount: number;
  relationshipsCount: number;
  evidenceCount: number;
  validationEventsCount: number;
  scenarioRunsCount: number;
  latestEntityUpdateAt: string | null;
  latestRelationshipUpdateAt: string | null;
};

export type GraphSorEntityInput = {
  entityId: string;
  entityType:
    | "company"
    | "facility"
    | "country"
    | "commodity"
    | "route"
    | "event"
    | "other";
  canonicalName: string;
  ticker?: string | null | undefined;
  isin?: string | null | undefined;
  countryCode?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
  confidence?: number | undefined;
  freshnessScore?: number | undefined;
  zone?: "candidate" | "validation" | "production" | undefined;
  seenAt?: string | undefined;
};

export type GraphSorRelationshipInput = {
  relationshipId: string;
  predicate: string;
  relationType: string;
  confidence?: number | undefined;
  freshnessScore?: number | undefined;
  evidenceQuality?:
    | "reported"
    | "verified"
    | "estimated"
    | "inferred"
    | undefined;
  zone?: "candidate" | "validation" | "production" | undefined;
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
};

export type GraphSorEvidenceInput = {
  evidenceId: string;
  sourceId: string;
  sourceType: string;
  retrievedAt: string;
  rawSnippet?: string | undefined;
  provenanceHash: string;
  confidence?: number | undefined;
  freshnessScore?: number | undefined;
  lineage?: Record<string, unknown> | undefined;
};

export type GraphSorFactUpsertInput = {
  subjectEntity: GraphSorEntityInput;
  objectEntity: GraphSorEntityInput;
  relationship: GraphSorRelationshipInput;
  evidence?: GraphSorEvidenceInput | undefined;
};

export type GraphSorFactUpsertResult = {
  tenantId: string;
  relationshipId: string;
  entityUpserts: number;
  relationshipUpserted: boolean;
  evidenceUpserted: boolean;
};

export class GraphSorRepo {
  constructor(private readonly pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  async getStatus(tenantId?: string): Promise<GraphSorStatus> {
    const tenant = this.resolveTenant(tenantId);

    const [entityCount, relationshipCount, evidenceCount, validationCount, scenarioCount, latestEntity, latestRelationship] =
      await Promise.all([
        this.pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM graph_entity_sor WHERE tenant_id = $1",
          [tenant],
        ),
        this.pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM graph_relationship_sor WHERE tenant_id = $1",
          [tenant],
        ),
        this.pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM graph_evidence_sor WHERE tenant_id = $1",
          [tenant],
        ),
        this.pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM graph_validation_event_sor WHERE tenant_id = $1",
          [tenant],
        ),
        this.pool.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM graph_scenario_run_sor WHERE tenant_id = $1",
          [tenant],
        ),
        this.pool.query<{ updated_at: string | null }>(
          "SELECT MAX(updated_at)::text AS updated_at FROM graph_entity_sor WHERE tenant_id = $1",
          [tenant],
        ),
        this.pool.query<{ updated_at: string | null }>(
          "SELECT MAX(updated_at)::text AS updated_at FROM graph_relationship_sor WHERE tenant_id = $1",
          [tenant],
        ),
      ]);

    return {
      tenantId: tenant,
      entitiesCount: Number(entityCount.rows[0]?.count ?? 0),
      relationshipsCount: Number(relationshipCount.rows[0]?.count ?? 0),
      evidenceCount: Number(evidenceCount.rows[0]?.count ?? 0),
      validationEventsCount: Number(validationCount.rows[0]?.count ?? 0),
      scenarioRunsCount: Number(scenarioCount.rows[0]?.count ?? 0),
      latestEntityUpdateAt: latestEntity.rows[0]?.updated_at ?? null,
      latestRelationshipUpdateAt: latestRelationship.rows[0]?.updated_at ?? null,
    };
  }

  async upsertFact(
    input: GraphSorFactUpsertInput,
    tenantId?: string,
  ): Promise<GraphSorFactUpsertResult> {
    const tenant = this.resolveTenant(tenantId);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      await this.upsertEntity(client, tenant, input.subjectEntity);
      await this.upsertEntity(client, tenant, input.objectEntity);

      await client.query(
        `INSERT INTO graph_relationship_sor (
           tenant_id,
           relationship_id,
           subject_entity_id,
           predicate,
           object_entity_id,
           relation_type,
           confidence,
           freshness_score,
           evidence_quality,
           zone,
           first_seen_at,
           last_seen_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11::timestamptz,
           $12::timestamptz
         )
         ON CONFLICT (tenant_id, relationship_id) DO UPDATE SET
           predicate = EXCLUDED.predicate,
           relation_type = EXCLUDED.relation_type,
           confidence = EXCLUDED.confidence,
           freshness_score = EXCLUDED.freshness_score,
           evidence_quality = EXCLUDED.evidence_quality,
           zone = EXCLUDED.zone,
           last_seen_at = COALESCE(EXCLUDED.last_seen_at, graph_relationship_sor.last_seen_at),
           updated_at = NOW()`,
        [
          tenant,
          input.relationship.relationshipId,
          input.subjectEntity.entityId,
          input.relationship.predicate,
          input.objectEntity.entityId,
          input.relationship.relationType,
          input.relationship.confidence ?? 0.5,
          input.relationship.freshnessScore ?? 0.5,
          input.relationship.evidenceQuality ?? "reported",
          input.relationship.zone ?? "candidate",
          input.relationship.firstSeenAt ?? null,
          input.relationship.lastSeenAt ?? null,
        ],
      );

      let evidenceUpserted = false;
      if (input.evidence) {
        await client.query(
          `INSERT INTO graph_evidence_sor (
             tenant_id,
             evidence_id,
             relationship_id,
             source_id,
             source_type,
             retrieved_at,
             raw_snippet,
             provenance_hash,
             confidence,
             freshness_score,
             lineage
           ) VALUES (
             $1, $2, $3, $4, $5,
             $6::timestamptz,
             $7, $8, $9, $10, $11::jsonb
           )
           ON CONFLICT (tenant_id, evidence_id) DO UPDATE SET
             source_id = EXCLUDED.source_id,
             source_type = EXCLUDED.source_type,
             retrieved_at = EXCLUDED.retrieved_at,
             raw_snippet = EXCLUDED.raw_snippet,
             confidence = EXCLUDED.confidence,
             freshness_score = EXCLUDED.freshness_score,
             lineage = EXCLUDED.lineage`,
          [
            tenant,
            input.evidence.evidenceId,
            input.relationship.relationshipId,
            input.evidence.sourceId,
            input.evidence.sourceType,
            input.evidence.retrievedAt,
            input.evidence.rawSnippet ?? null,
            input.evidence.provenanceHash,
            input.evidence.confidence ?? 0.5,
            input.evidence.freshnessScore ?? 0.5,
            JSON.stringify(input.evidence.lineage ?? {}),
          ],
        );
        evidenceUpserted = true;
      }

      await client.query("COMMIT");

      return {
        tenantId: tenant,
        relationshipId: input.relationship.relationshipId,
        entityUpserts: 2,
        relationshipUpserted: true,
        evidenceUpserted,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertEntity(
    client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
    tenant: string,
    entity: GraphSorEntityInput,
  ): Promise<void> {
    await client.query(
      `INSERT INTO graph_entity_sor (
         tenant_id,
         entity_id,
         entity_type,
         canonical_name,
         ticker,
         isin,
         country_code,
         metadata,
         confidence,
         freshness_score,
         zone,
         last_seen_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11,
         $12::timestamptz
       )
       ON CONFLICT (tenant_id, entity_id) DO UPDATE SET
         canonical_name = EXCLUDED.canonical_name,
         ticker = COALESCE(EXCLUDED.ticker, graph_entity_sor.ticker),
         isin = COALESCE(EXCLUDED.isin, graph_entity_sor.isin),
         country_code = COALESCE(EXCLUDED.country_code, graph_entity_sor.country_code),
         metadata = graph_entity_sor.metadata || EXCLUDED.metadata,
         confidence = EXCLUDED.confidence,
         freshness_score = EXCLUDED.freshness_score,
         zone = EXCLUDED.zone,
         last_seen_at = COALESCE(EXCLUDED.last_seen_at, graph_entity_sor.last_seen_at),
         updated_at = NOW()`,
      [
        tenant,
        entity.entityId,
        entity.entityType,
        entity.canonicalName,
        entity.ticker ?? null,
        entity.isin ?? null,
        entity.countryCode ?? null,
        JSON.stringify(entity.metadata ?? {}),
        entity.confidence ?? 0.5,
        entity.freshnessScore ?? 0.5,
        entity.zone ?? "candidate",
        entity.seenAt ?? null,
      ],
    );
  }
}
