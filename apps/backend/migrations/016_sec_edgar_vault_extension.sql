-- ============================================================================
-- Migration 016 - SEC EDGAR Data Vault Intelligence Extension
-- Extends filing intelligence with layered vault storage, deltas, materiality,
-- parser-versioned signals, and explainable routing decisions.
-- ============================================================================

-- Add source typing to the raw table so filings become a first-class source kind
-- in vault-centric query paths.
ALTER TABLE edgar_filing_raw
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'sec_filing';

ALTER TABLE edgar_filing_raw
  ADD COLUMN IF NOT EXISTS vault_record_version TEXT NOT NULL DEFAULT 'v1';

ALTER TABLE edgar_filing_raw
  ADD COLUMN IF NOT EXISTS source_tracking JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS edgar_filing_raw_source_type
  ON edgar_filing_raw (scope_id, source_type, filing_date DESC);

-- Canonical layer table for the 3-layer model:
-- raw_source -> structured_intelligence -> interpretation
CREATE TABLE IF NOT EXISTS edgar_filing_layer (
  scope_id               TEXT NOT NULL DEFAULT 'global',
  filing_id              UUID NOT NULL,
  layer_type             TEXT NOT NULL CHECK (layer_type IN (
    'raw_source',
    'structured_intelligence',
    'interpretation'
  )),
  layer_version          TEXT NOT NULL,
  produced_by            TEXT NOT NULL,
  payload                JSONB NOT NULL,
  payload_sha256         TEXT NOT NULL,
  confidence             DOUBLE PRECISION CHECK (confidence IS NULL OR (confidence BETWEEN 0 AND 1)),
  lineage                JSONB NOT NULL DEFAULT '{}',
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, filing_id, layer_type, layer_version),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_layer_scope_filing
  ON edgar_filing_layer (scope_id, filing_id, layer_type, created_at DESC);

CREATE INDEX IF NOT EXISTS edgar_filing_layer_active
  ON edgar_filing_layer (scope_id, layer_type, is_active, created_at DESC);

-- Structured explicit + implicit parser outputs, versioned for reprocessing.
CREATE TABLE IF NOT EXISTS edgar_filing_signal (
  signal_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               TEXT NOT NULL DEFAULT 'global',
  filing_id              UUID NOT NULL,
  parser_version         TEXT NOT NULL,
  signal_type            TEXT NOT NULL,
  signal_category        TEXT NOT NULL CHECK (signal_category IN ('explicit', 'implicit')),
  title                  TEXT NOT NULL,
  confidence             DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  signal_payload         JSONB NOT NULL DEFAULT '{}',
  provenance             JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_id, filing_id, parser_version, signal_type, title),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_signal_lookup
  ON edgar_filing_signal (scope_id, filing_id, parser_version, signal_category, confidence DESC);

-- Delta records between filing revisions of the same form + entity.
CREATE TABLE IF NOT EXISTS edgar_filing_delta (
  delta_id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               TEXT NOT NULL DEFAULT 'global',
  filing_id              UUID NOT NULL,
  previous_filing_id     UUID,
  delta_version          TEXT NOT NULL,
  language_diff          JSONB NOT NULL DEFAULT '{}',
  risk_factor_diff       JSONB NOT NULL DEFAULT '{}',
  tone_diff              JSONB NOT NULL DEFAULT '{}',
  financial_direction_diff JSONB NOT NULL DEFAULT '{}',
  entity_relationship_diff JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_id, filing_id, delta_version),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE,
  FOREIGN KEY (previous_filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS edgar_filing_delta_prev
  ON edgar_filing_delta (scope_id, previous_filing_id, created_at DESC);

-- Materiality scoring with horizon for prioritization and downstream routing.
CREATE TABLE IF NOT EXISTS edgar_filing_materiality (
  scope_id                 TEXT NOT NULL DEFAULT 'global',
  filing_id                UUID NOT NULL,
  scoring_version          TEXT NOT NULL,
  overall_score            DOUBLE PRECISION NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  form_weight_score        DOUBLE PRECISION NOT NULL CHECK (form_weight_score BETWEEN 0 AND 100),
  company_importance_score DOUBLE PRECISION NOT NULL CHECK (company_importance_score BETWEEN 0 AND 100),
  detected_event_score     DOUBLE PRECISION NOT NULL CHECK (detected_event_score BETWEEN 0 AND 100),
  unusual_language_score   DOUBLE PRECISION NOT NULL CHECK (unusual_language_score BETWEEN 0 AND 100),
  historical_deviation_score DOUBLE PRECISION NOT NULL CHECK (historical_deviation_score BETWEEN 0 AND 100),
  time_horizon             TEXT NOT NULL CHECK (time_horizon IN ('immediate', 'medium_term', 'long_term')),
  score_breakdown          JSONB NOT NULL DEFAULT '{}',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, filing_id, scoring_version),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_materiality_priority
  ON edgar_filing_materiality (scope_id, overall_score DESC, time_horizon, updated_at DESC);

-- Explainable route decisions that must reference vault layer versions.
CREATE TABLE IF NOT EXISTS edgar_filing_routing (
  scope_id               TEXT NOT NULL DEFAULT 'global',
  filing_id              UUID NOT NULL,
  routing_version        TEXT NOT NULL,
  route_flow             BOOLEAN NOT NULL DEFAULT FALSE,
  route_intelligence     BOOLEAN NOT NULL DEFAULT FALSE,
  route_gwmd             BOOLEAN NOT NULL DEFAULT FALSE,
  route_reasoning        JSONB NOT NULL DEFAULT '[]',
  source_layers          JSONB NOT NULL DEFAULT '{}',
  route_priority         INTEGER NOT NULL DEFAULT 0 CHECK (route_priority BETWEEN 0 AND 100),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, filing_id, routing_version),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_routing_priority
  ON edgar_filing_routing (scope_id, route_priority DESC, updated_at DESC);

-- Entity/relationship mentions for GWMD bridge and vault inspection.
CREATE TABLE IF NOT EXISTS edgar_filing_entity_mentions (
  mention_id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               TEXT NOT NULL DEFAULT 'global',
  filing_id              UUID NOT NULL,
  parser_version         TEXT NOT NULL,
  entity_name            TEXT NOT NULL,
  entity_type            TEXT NOT NULL,
  relationship_type      TEXT,
  mention_context        TEXT,
  confidence             DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  provenance             JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_id, filing_id, parser_version, entity_name, entity_type, relationship_type),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_entity_mentions_lookup
  ON edgar_filing_entity_mentions (scope_id, filing_id, entity_type, confidence DESC);
