-- ============================================================================
-- Migration 014 — Generic Procurement Intelligence Substrate
-- Raw -> Normalized -> Enriched layers with graph-ready outputs and diagnostics
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurement_notice_raw (
  raw_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT NOT NULL,
  provider            TEXT NOT NULL,
  provider_notice_id  TEXT NOT NULL,
  source_url          TEXT,
  language            TEXT,
  payload             JSONB NOT NULL,
  source_hash         TEXT NOT NULL,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, provider, provider_notice_id, source_hash)
);

CREATE INDEX IF NOT EXISTS procurement_notice_raw_tenant_ingested
  ON procurement_notice_raw (tenant_id, ingested_at DESC);

CREATE TABLE IF NOT EXISTS procurement_notice_normalized (
  notice_id           TEXT NOT NULL,
  tenant_id           TEXT NOT NULL,
  provider_notice_id  TEXT NOT NULL,
  provider            TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  buyer               TEXT NOT NULL,
  supplier            TEXT,
  country             TEXT NOT NULL,
  region              TEXT NOT NULL,
  city                TEXT,
  publication_date    TIMESTAMPTZ NOT NULL,
  deadline            TIMESTAMPTZ,
  contract_value      DOUBLE PRECISION,
  currency            TEXT,
  procedure_type      TEXT,
  contract_type       TEXT,
  cpv_codes           JSONB NOT NULL DEFAULT '[]',
  source_url          TEXT,
  raw_source_ref      TEXT NOT NULL,
  language            TEXT,
  completeness        DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 1),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, notice_id)
);

CREATE INDEX IF NOT EXISTS procurement_notice_normalized_pubdate
  ON procurement_notice_normalized (tenant_id, publication_date DESC);

CREATE INDEX IF NOT EXISTS procurement_notice_normalized_country_region
  ON procurement_notice_normalized (tenant_id, country, region);

CREATE INDEX IF NOT EXISTS procurement_notice_normalized_buyer
  ON procurement_notice_normalized (tenant_id, buyer);

CREATE TABLE IF NOT EXISTS procurement_notice_enriched (
  tenant_id               TEXT NOT NULL,
  notice_id               TEXT NOT NULL,
  tags                    JSONB NOT NULL DEFAULT '{"sector_tags":[],"theme_tags":[],"commodity_tags":[],"risk_tags":[],"geography_tags":[],"entity_tags":[]}',
  interpreted_categories  JSONB NOT NULL DEFAULT '[]',
  unmapped_cpv_codes      JSONB NOT NULL DEFAULT '[]',
  inferred                JSONB NOT NULL DEFAULT '{}',
  entity_refs             JSONB NOT NULL DEFAULT '[]',
  scores                  JSONB NOT NULL DEFAULT '{}',
  enrichment_version      TEXT NOT NULL,
  classification_version  TEXT NOT NULL,
  reprocessed_at          TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, notice_id),
  FOREIGN KEY (tenant_id, notice_id)
    REFERENCES procurement_notice_normalized (tenant_id, notice_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS procurement_notice_enriched_reprocessed
  ON procurement_notice_enriched (tenant_id, reprocessed_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS procurement_notice_graph_rel (
  relation_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT NOT NULL,
  notice_id           TEXT NOT NULL,
  subject_type        TEXT NOT NULL,
  subject_key         TEXT NOT NULL,
  predicate           TEXT NOT NULL,
  object_type         TEXT NOT NULL,
  object_key          TEXT NOT NULL,
  confidence          DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  evidence            JSONB NOT NULL DEFAULT '[]',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, notice_id)
    REFERENCES procurement_notice_normalized (tenant_id, notice_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS procurement_notice_graph_rel_notice
  ON procurement_notice_graph_rel (tenant_id, notice_id);

CREATE INDEX IF NOT EXISTS procurement_notice_graph_rel_subject
  ON procurement_notice_graph_rel (tenant_id, subject_type, subject_key);

CREATE TABLE IF NOT EXISTS procurement_pipeline_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT NOT NULL,
  event_type          TEXT NOT NULL,
  severity            TEXT NOT NULL,
  notice_id           TEXT,
  details             JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS procurement_pipeline_events_tenant_event
  ON procurement_pipeline_events (tenant_id, event_type, created_at DESC);
