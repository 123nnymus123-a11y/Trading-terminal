-- Canonical supply-chain graph system-of-record tables

CREATE TABLE IF NOT EXISTS graph_entity_sor (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('company', 'facility', 'country', 'commodity', 'route', 'event', 'other')),
  canonical_name TEXT NOT NULL,
  ticker TEXT,
  isin TEXT,
  country_code TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  freshness_score DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (freshness_score >= 0 AND freshness_score <= 1),
  zone TEXT NOT NULL DEFAULT 'candidate' CHECK (zone IN ('candidate', 'validation', 'production')),
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, entity_id)
);

CREATE TABLE IF NOT EXISTS graph_relationship_sor (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  relationship_id TEXT NOT NULL,
  subject_entity_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_entity_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  freshness_score DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (freshness_score >= 0 AND freshness_score <= 1),
  evidence_quality TEXT NOT NULL DEFAULT 'reported' CHECK (evidence_quality IN ('reported', 'verified', 'estimated', 'inferred')),
  zone TEXT NOT NULL DEFAULT 'candidate' CHECK (zone IN ('candidate', 'validation', 'production')),
  usage_counter INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, relationship_id),
  FOREIGN KEY (tenant_id, subject_entity_id)
    REFERENCES graph_entity_sor (tenant_id, entity_id)
    ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, object_entity_id)
    REFERENCES graph_entity_sor (tenant_id, entity_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, subject_entity_id, predicate, object_entity_id)
);

CREATE TABLE IF NOT EXISTS graph_evidence_sor (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  evidence_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  raw_snippet TEXT,
  provenance_hash TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  freshness_score DOUBLE PRECISION NOT NULL DEFAULT 0.5 CHECK (freshness_score >= 0 AND freshness_score <= 1),
  lineage JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, evidence_id),
  FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES graph_relationship_sor (tenant_id, relationship_id)
    ON DELETE CASCADE,
  UNIQUE (tenant_id, provenance_hash)
);

CREATE TABLE IF NOT EXISTS graph_validation_event_sor (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  event_id TEXT NOT NULL,
  relationship_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('accept', 'reject', 'escalate')),
  reviewer_type TEXT NOT NULL CHECK (reviewer_type IN ('ai', 'human', 'rule')),
  reviewer_id TEXT,
  reason TEXT,
  confidence DOUBLE PRECISION CHECK (confidence >= 0 AND confidence <= 1),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES graph_relationship_sor (tenant_id, relationship_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS graph_scenario_run_sor (
  tenant_id TEXT NOT NULL DEFAULT 'default',
  run_id TEXT NOT NULL,
  seed_entity_id TEXT NOT NULL,
  disruption_type TEXT NOT NULL,
  shock_factor DOUBLE PRECISION NOT NULL CHECK (shock_factor >= 0 AND shock_factor <= 1),
  depth INTEGER NOT NULL DEFAULT 3 CHECK (depth >= 1 AND depth <= 6),
  graph_version_hint TEXT,
  result_payload JSONB NOT NULL,
  executed_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, run_id),
  FOREIGN KEY (tenant_id, seed_entity_id)
    REFERENCES graph_entity_sor (tenant_id, entity_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_graph_entity_sor_ticker
  ON graph_entity_sor (tenant_id, ticker);

CREATE INDEX IF NOT EXISTS idx_graph_entity_sor_zone
  ON graph_entity_sor (tenant_id, zone, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_graph_relationship_sor_subject
  ON graph_relationship_sor (tenant_id, subject_entity_id);

CREATE INDEX IF NOT EXISTS idx_graph_relationship_sor_object
  ON graph_relationship_sor (tenant_id, object_entity_id);

CREATE INDEX IF NOT EXISTS idx_graph_relationship_sor_zone
  ON graph_relationship_sor (tenant_id, zone, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_graph_relationship_sor_type
  ON graph_relationship_sor (tenant_id, relation_type);

CREATE INDEX IF NOT EXISTS idx_graph_evidence_sor_relationship
  ON graph_evidence_sor (tenant_id, relationship_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_graph_validation_event_sor_relationship
  ON graph_validation_event_sor (tenant_id, relationship_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_graph_scenario_run_sor_seed_created
  ON graph_scenario_run_sor (tenant_id, seed_entity_id, created_at DESC);
