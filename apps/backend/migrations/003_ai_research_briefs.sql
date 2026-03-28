-- AI Research Intelligence System Tables

-- Store AI-generated briefs
CREATE TABLE IF NOT EXISTS ai_briefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  run_id TEXT NOT NULL,
  headline TEXT NOT NULL,
  summary_bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
  tickers JSONB NOT NULL DEFAULT '[]'::jsonb,
  why_it_matters JSONB NOT NULL DEFAULT '[]'::jsonb,
  what_to_watch JSONB NOT NULL DEFAULT '[]'::jsonb,
  impact_score INTEGER NOT NULL DEFAULT 0 CHECK (impact_score >= 0 AND impact_score <= 100),
  confidence INTEGER NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  dismissed_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_briefs_user_id ON ai_briefs(user_id);
CREATE INDEX idx_ai_briefs_created_at ON ai_briefs(created_at DESC);
CREATE INDEX idx_ai_briefs_run_id ON ai_briefs(run_id);
CREATE INDEX idx_ai_briefs_tickers ON ai_briefs USING gin(tickers);

-- Store AI research runs
CREATE TABLE IF NOT EXISTS ai_research_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  error TEXT,
  stats JSONB,
  trigger_reason TEXT DEFAULT 'manual'
);

CREATE INDEX idx_ai_research_runs_user_id ON ai_research_runs(user_id);
CREATE INDEX idx_ai_research_runs_started_at ON ai_research_runs(started_at DESC);
CREATE INDEX idx_ai_research_runs_status ON ai_research_runs(status);

-- Store AI research config per user
CREATE TABLE IF NOT EXISTS ai_research_config (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  model TEXT NOT NULL DEFAULT 'llama3.1:70b',
  poll_interval_sec INTEGER NOT NULL DEFAULT 300 CHECK (poll_interval_sec >= 60 AND poll_interval_sec <= 3600),
  rss_feeds JSONB NOT NULL DEFAULT '[]'::jsonb,
  sec_forms JSONB NOT NULL DEFAULT '["8-K", "10-Q", "10-K"]'::jsonb,
  watchlist_tickers JSONB NOT NULL DEFAULT '[]'::jsonb,
  watchlist_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  use_x BOOLEAN NOT NULL DEFAULT false,
  x_api_key TEXT,
  focus_prompt TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Store source items for deduplication
CREATE TABLE IF NOT EXISTS ai_source_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  raw_text TEXT NOT NULL,
  tickers JSONB NOT NULL DEFAULT '[]'::jsonb,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  canonical_text TEXT NOT NULL,
  canonical_hash TEXT NOT NULL,
  cluster_id TEXT
);

CREATE INDEX idx_ai_source_items_user_id ON ai_source_items(user_id);
CREATE INDEX idx_ai_source_items_canonical_hash ON ai_source_items(canonical_hash);
CREATE INDEX idx_ai_source_items_ingested_at ON ai_source_items(ingested_at DESC);
CREATE INDEX idx_ai_source_items_cluster_id ON ai_source_items(cluster_id);

-- Store content clusters
CREATE TABLE IF NOT EXISTS ai_clusters (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  representative_item_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_clusters_user_id ON ai_clusters(user_id);
CREATE INDEX idx_ai_clusters_updated_at ON ai_clusters(updated_at DESC);
