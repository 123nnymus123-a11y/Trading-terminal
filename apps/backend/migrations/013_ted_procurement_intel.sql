-- ============================================================================
-- Migration 013 — TED Procurement Intelligence Engine
-- Implements persistent storage for the four-zone data vault lifecycle:
--   raw → candidate → validated → production
-- ============================================================================

-- ─── Entity Registry: Buyers ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_buyers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  raw_name         TEXT NOT NULL,
  normalized_name  TEXT NOT NULL,
  classification   TEXT NOT NULL CHECK (classification IN (
    'ministry', 'municipality', 'agency', 'central_purchasing_body',
    'state_owned_entity', 'eu_agency', 'military',
    'transmission_system_operator', 'distribution_system_operator',
    'rail_operator', 'other'
  )),
  country          TEXT NOT NULL,
  region           TEXT NOT NULL,
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (confidence BETWEEN 0 AND 1),
  evidence_refs    JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, normalized_name, country)
);

CREATE INDEX IF NOT EXISTS ted_buyers_tenant_country
  ON ted_buyers (tenant_id, country);

CREATE INDEX IF NOT EXISTS ted_buyers_classification
  ON ted_buyers (classification);

-- ─── Entity Registry: Suppliers ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_suppliers (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               TEXT NOT NULL,
  raw_name                TEXT NOT NULL,
  normalized_name         TEXT NOT NULL,
  parent_company          TEXT,
  parent_confidence       DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (parent_confidence BETWEEN 0 AND 1),
  country                 TEXT NOT NULL,
  is_publicly_listed      BOOLEAN NOT NULL DEFAULT FALSE,
  ticker_mappings         JSONB NOT NULL DEFAULT '[]',
  -- ticker_mappings: [{ticker, exchange, confidence, evidence}]
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, normalized_name, country)
);

CREATE INDEX IF NOT EXISTS ted_suppliers_tenant_country
  ON ted_suppliers (tenant_id, country);

CREATE INDEX IF NOT EXISTS ted_suppliers_parent
  ON ted_suppliers (parent_company)
  WHERE parent_company IS NOT NULL;

-- ─── Procurement Notices (Data Vault) ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_notices (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL,
  source_id             TEXT NOT NULL,           -- TED publication reference e.g. "2026/S-052-154230"
  title                 TEXT NOT NULL,
  buyer_id              UUID REFERENCES ted_buyers(id),
  buyer_raw_name        TEXT NOT NULL,
  buyer_country         TEXT NOT NULL,
  buyer_region          TEXT NOT NULL,
  buyer_lat             DOUBLE PRECISION,
  buyer_lon             DOUBLE PRECISION,
  buyer_type            TEXT NOT NULL,
  stage                 TEXT NOT NULL CHECK (stage IN ('planning','tendering','competition','award','execution')),
  notice_type           TEXT NOT NULL CHECK (notice_type IN ('pin','contract_notice','competition_notice','award_notice','contract_modification')),
  theme                 TEXT NOT NULL,
  secondary_themes      JSONB NOT NULL DEFAULT '[]',
  value_eur             BIGINT NOT NULL DEFAULT 0,
  currency              TEXT NOT NULL DEFAULT 'EUR',
  published_at          TIMESTAMPTZ NOT NULL,
  deadline_at           TIMESTAMPTZ,
  place_country         TEXT NOT NULL,
  place_region          TEXT NOT NULL,
  place_lat             DOUBLE PRECISION,
  place_lon             DOUBLE PRECISION,
  winner_supplier_id    UUID REFERENCES ted_suppliers(id),
  winner_raw_name       TEXT,
  winner_country        TEXT,
  winner_parent         TEXT,
  winner_tickers        JSONB NOT NULL DEFAULT '[]',
  strategic_weight      INTEGER NOT NULL DEFAULT 50 CHECK (strategic_weight BETWEEN 0 AND 100),
  confidence            DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (confidence BETWEEN 0 AND 1),
  recurrence            DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (recurrence BETWEEN 0 AND 1),
  novelty               DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (novelty BETWEEN 0 AND 1),
  urgency               DOUBLE PRECISION NOT NULL DEFAULT 0.0 CHECK (urgency BETWEEN 0 AND 1),
  source_url            TEXT,
  cpv_codes             JSONB NOT NULL DEFAULT '[]',
  evidence              JSONB NOT NULL DEFAULT '{}',
  -- Vault lifecycle
  vault_zone            TEXT NOT NULL DEFAULT 'raw' CHECK (vault_zone IN ('raw','candidate','validated','production')),
  ingested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  normalized_at         TIMESTAMPTZ,
  enriched_at           TIMESTAMPTZ,
  validated_at          TIMESTAMPTZ,
  revalidatable         BOOLEAN NOT NULL DEFAULT TRUE,
  export_eligible       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, source_id)
);

CREATE INDEX IF NOT EXISTS ted_notices_tenant_stage
  ON ted_notices (tenant_id, stage);

CREATE INDEX IF NOT EXISTS ted_notices_tenant_theme
  ON ted_notices (tenant_id, theme);

CREATE INDEX IF NOT EXISTS ted_notices_published_at
  ON ted_notices (tenant_id, published_at DESC);

CREATE INDEX IF NOT EXISTS ted_notices_vault_zone
  ON ted_notices (tenant_id, vault_zone);

CREATE INDEX IF NOT EXISTS ted_notices_value
  ON ted_notices (tenant_id, value_eur DESC);

CREATE INDEX IF NOT EXISTS ted_notices_buyer_country
  ON ted_notices (tenant_id, buyer_country);

-- ─── Procurement Signals ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_signals (
  id                TEXT NOT NULL,              -- deterministic slug id
  tenant_id         TEXT NOT NULL,
  snapshot_window   TEXT NOT NULL CHECK (snapshot_window IN ('7d','30d','90d','1y')),
  signal_type       TEXT NOT NULL,
  title             TEXT NOT NULL,
  summary           TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 100),
  dimensions        JSONB NOT NULL DEFAULT '{}',
  linked_notice_ids JSONB NOT NULL DEFAULT '[]',
  affected_entities JSONB NOT NULL DEFAULT '[]',
  evidence          JSONB NOT NULL DEFAULT '[]',
  ai_explanation    TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, snapshot_window, id)
);

CREATE INDEX IF NOT EXISTS ted_signals_priority
  ON ted_signals (tenant_id, snapshot_window, priority DESC);

-- ─── Anomalies ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_anomalies (
  id                TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  snapshot_window   TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('medium','high')),
  title             TEXT NOT NULL,
  detail            TEXT NOT NULL,
  why_it_matters    TEXT NOT NULL,
  linked_notice_ids JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, snapshot_window, id)
);

-- ─── Concentration Risks ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_concentration_risks (
  id                TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  snapshot_window   TEXT NOT NULL,
  risk_type         TEXT NOT NULL CHECK (risk_type IN ('supplier','buyer','sector','geography')),
  subject           TEXT NOT NULL,
  herfindahl_index  DOUBLE PRECISION NOT NULL,
  top_share         DOUBLE PRECISION NOT NULL,
  description       TEXT NOT NULL,
  risk_level        TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  linked_notice_ids JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, snapshot_window, id)
);

-- ─── Second-Order Intelligence ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_second_order (
  id                    TEXT NOT NULL,
  tenant_id             TEXT NOT NULL,
  snapshot_window       TEXT NOT NULL,
  thesis_type           TEXT NOT NULL,
  headline              TEXT NOT NULL,
  explanation           TEXT NOT NULL,
  affected_tickers      JSONB NOT NULL DEFAULT '[]',
  affected_sectors      JSONB NOT NULL DEFAULT '[]',
  confidence            DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  supporting_notice_ids JSONB NOT NULL DEFAULT '[]',
  linked_systems        JSONB NOT NULL DEFAULT '[]',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, snapshot_window, id)
);

-- ─── AI Insights ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_ai_insights (
  id                TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  snapshot_window   TEXT NOT NULL,
  topic             TEXT NOT NULL,
  fact_basis        JSONB NOT NULL DEFAULT '[]',
  inference         TEXT NOT NULL,
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  anomaly_flag      BOOLEAN NOT NULL DEFAULT FALSE,
  linked_notice_ids JSONB NOT NULL DEFAULT '[]',
  linked_systems    JSONB NOT NULL DEFAULT '[]',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, snapshot_window, id)
);

-- ─── Sector Momentum Snapshots ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_sector_momentum (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  snapshot_window  TEXT NOT NULL,
  theme            TEXT NOT NULL,
  notice_count     INTEGER NOT NULL DEFAULT 0,
  awarded_count    INTEGER NOT NULL DEFAULT 0,
  total_value_eur  BIGINT NOT NULL DEFAULT 0,
  momentum_score   DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  stage_mix        JSONB NOT NULL DEFAULT '{}',
  snapshot_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, snapshot_window, theme, snapshot_at)
);

CREATE INDEX IF NOT EXISTS ted_sector_momentum_theme
  ON ted_sector_momentum (tenant_id, theme, snapshot_at DESC);

-- ─── Supplier-Buyer Relationship Graph ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_relationships (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  buyer_id         UUID REFERENCES ted_buyers(id),
  supplier_id      UUID REFERENCES ted_suppliers(id),
  notice_id        UUID REFERENCES ted_notices(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('award','framework','repeat_award')),
  value_eur        BIGINT NOT NULL DEFAULT 0,
  theme            TEXT NOT NULL,
  stage            TEXT NOT NULL,
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  evidence_refs    JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, buyer_id, supplier_id, notice_id)
);

CREATE INDEX IF NOT EXISTS ted_relationships_supplier
  ON ted_relationships (tenant_id, supplier_id);

CREATE INDEX IF NOT EXISTS ted_relationships_buyer
  ON ted_relationships (tenant_id, buyer_id);

-- ─── Watchlist Linkages ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ted_watchlist_linkages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        TEXT NOT NULL,
  ticker           TEXT NOT NULL,
  company          TEXT NOT NULL,
  relevance_score  DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  confidence       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  linked_notice_ids JSONB NOT NULL DEFAULT '[]',
  buyer_count      INTEGER NOT NULL DEFAULT 0,
  themes           JSONB NOT NULL DEFAULT '[]',
  rationale        TEXT NOT NULL DEFAULT '',
  snapshot_window  TEXT NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, ticker, snapshot_window)
);

CREATE INDEX IF NOT EXISTS ted_watchlist_ticker
  ON ted_watchlist_linkages (tenant_id, ticker);
