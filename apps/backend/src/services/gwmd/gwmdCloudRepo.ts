import type { Pool, PoolClient } from "pg";

export type GwmdCloudCompany = {
  ticker: string;
  name: string;
  hq_lat?: number | null | undefined;
  hq_lon?: number | null | undefined;
  hq_city?: string | null | undefined;
  hq_country?: string | null | undefined;
  industry?: string | null | undefined;
  health_score?: number | null | undefined;
};

export type GwmdCloudRelationship = {
  id: string;
  from_ticker: string;
  to_ticker: string;
  relation_type:
    | "supplier"
    | "customer"
    | "partner"
    | "competitor"
    | "financing"
    | "license";
  weight?: number | null | undefined;
  confidence?: number | null | undefined;
  evidence?: string | null | undefined;
};

export type GwmdSyncStatus = {
  cloudVersion: number;
  lastSyncAt: string | null;
  companiesCount: number;
  relationshipsCount: number;
  syncStatus: "idle" | "syncing" | "ok" | "error";
};

export class GwmdCloudRepo {
  constructor(private readonly pool: Pool) {}

  private resolveTenant(tenantId?: string): string {
    return tenantId && tenantId.trim().length > 0 ? tenantId.trim() : "default";
  }

  private normalizeTicker(value: string): string {
    return value.trim().toUpperCase();
  }

  async pushSnapshot(
    payload: {
      companies: GwmdCloudCompany[];
      relationships: GwmdCloudRelationship[];
      replace?: boolean;
    },
    tenantId?: string,
  ): Promise<{
    applied: { companies: number; relationships: number };
    status: GwmdSyncStatus;
  }> {
    const tenant = this.resolveTenant(tenantId);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");

      await this.markSyncStatus(client, tenant, "syncing");

      if (payload.replace) {
        await client.query(
          "DELETE FROM gwmd_relationship_cloud WHERE tenant_id = $1",
          [tenant],
        );
        await client.query(
          "DELETE FROM gwmd_company_cloud WHERE tenant_id = $1",
          [tenant],
        );
      }

      for (const company of payload.companies) {
        await client.query(
          `INSERT INTO gwmd_company_cloud (
             tenant_id, ticker, name, hq_lat, hq_lon, hq_city, hq_country, industry, health_score
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (tenant_id, ticker) DO UPDATE SET
             name = EXCLUDED.name,
             hq_lat = COALESCE(EXCLUDED.hq_lat, gwmd_company_cloud.hq_lat),
             hq_lon = COALESCE(EXCLUDED.hq_lon, gwmd_company_cloud.hq_lon),
             hq_city = COALESCE(EXCLUDED.hq_city, gwmd_company_cloud.hq_city),
             hq_country = COALESCE(EXCLUDED.hq_country, gwmd_company_cloud.hq_country),
             industry = COALESCE(EXCLUDED.industry, gwmd_company_cloud.industry),
             health_score = COALESCE(EXCLUDED.health_score, gwmd_company_cloud.health_score),
             version = gwmd_company_cloud.version + 1,
             updated_at = NOW()`,
          [
            tenant,
            this.normalizeTicker(company.ticker),
            company.name,
            company.hq_lat ?? null,
            company.hq_lon ?? null,
            company.hq_city ?? null,
            company.hq_country ?? null,
            company.industry ?? null,
            company.health_score ?? null,
          ],
        );
      }

      for (const relationship of payload.relationships) {
        await client.query(
          `INSERT INTO gwmd_relationship_cloud (
             tenant_id, id, from_ticker, to_ticker, relation_type, weight, confidence, evidence
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (tenant_id, id) DO UPDATE SET
             from_ticker = EXCLUDED.from_ticker,
             to_ticker = EXCLUDED.to_ticker,
             relation_type = EXCLUDED.relation_type,
             weight = EXCLUDED.weight,
             confidence = EXCLUDED.confidence,
             evidence = EXCLUDED.evidence,
             version = gwmd_relationship_cloud.version + 1,
             updated_at = NOW()`,
          [
            tenant,
            relationship.id,
            this.normalizeTicker(relationship.from_ticker),
            this.normalizeTicker(relationship.to_ticker),
            relationship.relation_type,
            relationship.weight ?? null,
            relationship.confidence ?? null,
            relationship.evidence ?? null,
          ],
        );
      }

      const counts = await this.getCounts(client, tenant);
      const status = await this.bumpVersionAndMarkStatus(
        client,
        tenant,
        counts,
        "ok",
      );

      await client.query("COMMIT");

      return {
        applied: {
          companies: payload.companies.length,
          relationships: payload.relationships.length,
        },
        status,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      const fallbackClient = await this.pool.connect();
      try {
        await this.markSyncStatus(fallbackClient, tenant, "error");
      } finally {
        fallbackClient.release();
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async pullSnapshot(
    tenantId?: string,
    sinceIso?: string,
  ): Promise<{
    companies: GwmdCloudCompany[];
    relationships: GwmdCloudRelationship[];
    status: GwmdSyncStatus;
  }> {
    const tenant = this.resolveTenant(tenantId);
    const since = sinceIso ? new Date(sinceIso) : null;
    const hasValidSince = since && Number.isFinite(since.getTime());

    const companiesResult = await this.pool.query(
      `SELECT ticker, name, hq_lat, hq_lon, hq_city, hq_country, industry, health_score
       FROM gwmd_company_cloud
       WHERE tenant_id = $1
         AND ($2::timestamptz IS NULL OR updated_at >= $2)
       ORDER BY ticker ASC`,
      [tenant, hasValidSince ? since!.toISOString() : null],
    );

    const relationshipsResult = await this.pool.query(
      `SELECT id, from_ticker, to_ticker, relation_type, weight, confidence, evidence
       FROM gwmd_relationship_cloud
       WHERE tenant_id = $1
         AND ($2::timestamptz IS NULL OR updated_at >= $2)
       ORDER BY from_ticker ASC, to_ticker ASC`,
      [tenant, hasValidSince ? since!.toISOString() : null],
    );

    const status = await this.getStatus(tenant);

    return {
      companies: companiesResult.rows,
      relationships: relationshipsResult.rows,
      status,
    };
  }

  async getStatus(tenantId?: string): Promise<GwmdSyncStatus> {
    const tenant = this.resolveTenant(tenantId);
    const stateResult = await this.pool.query<{
      cloud_version: number;
      last_sync_at: string | null;
      companies_count: number;
      relationships_count: number;
      sync_status: "idle" | "syncing" | "ok" | "error";
    }>(
      `SELECT cloud_version, last_sync_at::text, companies_count, relationships_count, sync_status
       FROM gwmd_sync_state
       WHERE tenant_id = $1
       LIMIT 1`,
      [tenant],
    );

    if (stateResult.rows[0]) {
      const row = stateResult.rows[0];
      return {
        cloudVersion: Number(row.cloud_version ?? 0),
        lastSyncAt: row.last_sync_at,
        companiesCount: Number(row.companies_count ?? 0),
        relationshipsCount: Number(row.relationships_count ?? 0),
        syncStatus: row.sync_status,
      };
    }

    const counts = await this.getCounts(this.pool, tenant);
    return {
      cloudVersion: 0,
      lastSyncAt: null,
      companiesCount: counts.companiesCount,
      relationshipsCount: counts.relationshipsCount,
      syncStatus: "idle",
    };
  }

  private async getCounts(
    client: Pool | PoolClient,
    tenantId: string,
  ): Promise<{ companiesCount: number; relationshipsCount: number }> {
    const [companiesResult, relationshipsResult] = await Promise.all([
      client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM gwmd_company_cloud WHERE tenant_id = $1",
        [tenantId],
      ),
      client.query<{ count: string }>(
        "SELECT COUNT(*)::text AS count FROM gwmd_relationship_cloud WHERE tenant_id = $1",
        [tenantId],
      ),
    ]);

    return {
      companiesCount: Number(companiesResult.rows[0]?.count ?? 0),
      relationshipsCount: Number(relationshipsResult.rows[0]?.count ?? 0),
    };
  }

  private async markSyncStatus(
    client: Pool | PoolClient,
    tenantId: string,
    syncStatus: "idle" | "syncing" | "ok" | "error",
  ): Promise<void> {
    await client.query(
      `INSERT INTO gwmd_sync_state (tenant_id, sync_status, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         sync_status = EXCLUDED.sync_status,
         updated_at = NOW()`,
      [tenantId, syncStatus],
    );
  }

  private async bumpVersionAndMarkStatus(
    client: Pool | PoolClient,
    tenantId: string,
    counts: { companiesCount: number; relationshipsCount: number },
    syncStatus: "ok" | "error",
  ): Promise<GwmdSyncStatus> {
    const result = await client.query<{
      cloud_version: number;
      last_sync_at: string;
      companies_count: number;
      relationships_count: number;
      sync_status: "idle" | "syncing" | "ok" | "error";
    }>(
      `INSERT INTO gwmd_sync_state (
         tenant_id, cloud_version, last_sync_at, companies_count, relationships_count, sync_status, updated_at
       ) VALUES ($1, 1, NOW(), $2, $3, $4, NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         cloud_version = gwmd_sync_state.cloud_version + 1,
         last_sync_at = NOW(),
         companies_count = EXCLUDED.companies_count,
         relationships_count = EXCLUDED.relationships_count,
         sync_status = EXCLUDED.sync_status,
         updated_at = NOW()
       RETURNING cloud_version, last_sync_at::text, companies_count, relationships_count, sync_status`,
      [tenantId, counts.companiesCount, counts.relationshipsCount, syncStatus],
    );

    const row = result.rows[0];
    return {
      cloudVersion: Number(row?.cloud_version ?? 0),
      lastSyncAt: row?.last_sync_at ?? null,
      companiesCount: Number(row?.companies_count ?? counts.companiesCount),
      relationshipsCount: Number(
        row?.relationships_count ?? counts.relationshipsCount,
      ),
      syncStatus: row?.sync_status ?? syncStatus,
    };
  }
}
