-- ============================================================================
-- Migration 015 - SEC EDGAR Intelligence Substrate
-- Durable raw -> parsed -> score -> ai layers with watcher checkpoints
-- ============================================================================

CREATE TABLE IF NOT EXISTS edgar_filing_raw (
  filing_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               TEXT NOT NULL DEFAULT 'global',
  company_name           TEXT NOT NULL,
  cik                    TEXT NOT NULL,
  ticker                 TEXT,
  accession_number       TEXT NOT NULL,
  filing_date            DATE NOT NULL,
  accepted_at            TIMESTAMPTZ,
  period_of_report       DATE,
  form_type              TEXT NOT NULL,
  primary_document_url   TEXT,
  filing_detail_url      TEXT,
  source_links           JSONB NOT NULL DEFAULT '[]',
  metadata               JSONB NOT NULL DEFAULT '{}',
  raw_content            TEXT NOT NULL,
  raw_content_sha256     TEXT NOT NULL,
  ingested_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_id, cik, accession_number, form_type)
);

CREATE INDEX IF NOT EXISTS edgar_filing_raw_scope_filing_date
  ON edgar_filing_raw (scope_id, filing_date DESC);

CREATE INDEX IF NOT EXISTS edgar_filing_raw_scope_form_date
  ON edgar_filing_raw (scope_id, form_type, filing_date DESC);

CREATE INDEX IF NOT EXISTS edgar_filing_raw_scope_cik_date
  ON edgar_filing_raw (scope_id, cik, filing_date DESC);

CREATE TABLE IF NOT EXISTS edgar_filing_parsed (
  scope_id               TEXT NOT NULL DEFAULT 'global',
  filing_id              UUID NOT NULL,
  parser_version         TEXT NOT NULL,
  parsed_payload         JSONB NOT NULL,
  derived_records        JSONB NOT NULL DEFAULT '[]',
  parse_quality          DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (parse_quality BETWEEN 0 AND 1),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, filing_id, parser_version),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_parsed_scope_updated
  ON edgar_filing_parsed (scope_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS edgar_filing_score (
  scope_id                 TEXT NOT NULL DEFAULT 'global',
  filing_id                UUID NOT NULL,
  score_version            TEXT NOT NULL,
  overall_score            DOUBLE PRECISION NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  market_impact_score      DOUBLE PRECISION NOT NULL CHECK (market_impact_score BETWEEN 0 AND 100),
  urgency_score            DOUBLE PRECISION NOT NULL CHECK (urgency_score BETWEEN 0 AND 100),
  novelty_score            DOUBLE PRECISION NOT NULL CHECK (novelty_score BETWEEN 0 AND 100),
  entity_linkage_score     DOUBLE PRECISION NOT NULL CHECK (entity_linkage_score BETWEEN 0 AND 100),
  rationale                JSONB NOT NULL DEFAULT '[]',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, filing_id, score_version),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_score_scope_overall
  ON edgar_filing_score (scope_id, overall_score DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS edgar_filing_ai (
  scope_id               TEXT NOT NULL DEFAULT 'global',
  filing_id              UUID NOT NULL,
  model                  TEXT NOT NULL,
  prompt_version         TEXT NOT NULL,
  summary                TEXT,
  importance_assessment  TEXT,
  thematic_tags          JSONB NOT NULL DEFAULT '[]',
  terminal_intelligence  JSONB NOT NULL DEFAULT '{}',
  confidence             DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  gate_status            TEXT NOT NULL DEFAULT 'pending',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, filing_id, model, prompt_version),
  FOREIGN KEY (filing_id)
    REFERENCES edgar_filing_raw (filing_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS edgar_filing_ai_scope_gate
  ON edgar_filing_ai (scope_id, gate_status, confidence DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS edgar_watcher_checkpoint (
  scope_id               TEXT NOT NULL,
  checkpoint_key         TEXT NOT NULL,
  checkpoint_value       TEXT NOT NULL,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_id, checkpoint_key)
);

CREATE TABLE IF NOT EXISTS edgar_poll_run (
  run_id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id               TEXT NOT NULL,
  status                 TEXT NOT NULL,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at            TIMESTAMPTZ,
  details                JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS edgar_poll_run_scope_started
  ON edgar_poll_run (scope_id, started_at DESC);
