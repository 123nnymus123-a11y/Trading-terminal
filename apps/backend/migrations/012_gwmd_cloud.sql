-- GWMD cloud persistence and sync metadata

CREATE TABLE IF NOT EXISTS gwmd_company_cloud (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  ticker TEXT NOT NULL,
  name TEXT NOT NULL,
  hq_lat DOUBLE PRECISION,
  hq_lon DOUBLE PRECISION,
  hq_city TEXT,
  hq_country TEXT,
  industry TEXT,
  health_score INTEGER CHECK (health_score >= 0 AND health_score <= 100),
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, ticker)
);

CREATE TABLE IF NOT EXISTS gwmd_relationship_cloud (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  id TEXT NOT NULL,
  from_ticker TEXT NOT NULL,
  to_ticker TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('supplier','customer','partner','competitor','financing','license')),
  weight DOUBLE PRECISION,
  confidence DOUBLE PRECISION CHECK (confidence >= 0 AND confidence <= 1),
  evidence TEXT,
  version BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, from_ticker) REFERENCES gwmd_company_cloud(tenant_id, ticker) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, to_ticker) REFERENCES gwmd_company_cloud(tenant_id, ticker) ON DELETE CASCADE,
  UNIQUE (tenant_id, from_ticker, to_ticker, relation_type)
);

CREATE TABLE IF NOT EXISTS gwmd_sync_state (
  tenant_id TEXT PRIMARY KEY,
  cloud_version BIGINT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ,
  companies_count INTEGER NOT NULL DEFAULT 0,
  relationships_count INTEGER NOT NULL DEFAULT 0,
  sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle', 'syncing', 'ok', 'error')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gwmd_company_cloud_updated ON gwmd_company_cloud(tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gwmd_company_cloud_coords ON gwmd_company_cloud(tenant_id, hq_lat, hq_lon);
CREATE INDEX IF NOT EXISTS idx_gwmd_relationship_cloud_from ON gwmd_relationship_cloud(tenant_id, from_ticker);
CREATE INDEX IF NOT EXISTS idx_gwmd_relationship_cloud_to ON gwmd_relationship_cloud(tenant_id, to_ticker);
CREATE INDEX IF NOT EXISTS idx_gwmd_relationship_cloud_type ON gwmd_relationship_cloud(tenant_id, relation_type);
CREATE INDEX IF NOT EXISTS idx_gwmd_relationship_cloud_updated ON gwmd_relationship_cloud(tenant_id, updated_at DESC);
