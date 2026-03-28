-- Backtesting Automation Engine foundation tables.
-- Adds strategy identity/versioning, dataset snapshots, run lifecycle,
-- assumptions, lineage, artifacts, and promotion audit records.

CREATE TABLE IF NOT EXISTS strategy_definitions (
  strategy_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  current_version TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'candidate' CHECK (stage IN ('candidate', 'validation', 'production', 'retired')),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_definitions_tenant_user
  ON strategy_definitions(tenant_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_definitions_stage
  ON strategy_definitions(tenant_id, stage, updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_versions (
  strategy_id TEXT NOT NULL,
  version TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  script_language TEXT NOT NULL CHECK (script_language IN ('javascript', 'typescript')),
  script_entrypoint TEXT NOT NULL,
  script_source TEXT NOT NULL,
  script_checksum_sha256 TEXT NOT NULL,
  universe JSONB NOT NULL DEFAULT '[]'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (strategy_id, version),
  FOREIGN KEY (strategy_id) REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_versions_tenant_user
  ON strategy_versions(tenant_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_dataset_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  dataset_name TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL,
  row_count BIGINT,
  source_manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
  checksum_sha256 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, user_id, dataset_name, dataset_version),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_dataset_snapshots_lookup
  ON strategy_dataset_snapshots(tenant_id, user_id, snapshot_at DESC);

CREATE TABLE IF NOT EXISTS strategy_backtest_runs (
  run_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  strategy_version TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('desktop-local', 'backend')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  idempotency_key TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (strategy_id, strategy_version) REFERENCES strategy_versions(strategy_id, version) ON DELETE CASCADE,
  FOREIGN KEY (snapshot_id) REFERENCES strategy_dataset_snapshots(snapshot_id) ON DELETE RESTRICT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_backtest_runs_tenant_user
  ON strategy_backtest_runs(tenant_id, user_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_backtest_runs_strategy
  ON strategy_backtest_runs(tenant_id, strategy_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_backtest_runs_status
  ON strategy_backtest_runs(tenant_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_run_assumptions (
  run_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (run_id) REFERENCES strategy_backtest_runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS strategy_run_artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  artifact_kind TEXT NOT NULL,
  artifact_uri TEXT NOT NULL,
  checksum_sha256 TEXT,
  size_bytes BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (run_id) REFERENCES strategy_backtest_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_run_artifacts_run
  ON strategy_run_artifacts(tenant_id, run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_run_lineage (
  linkage_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  input_kind TEXT NOT NULL CHECK (input_kind IN ('strategy', 'dataset', 'assumptions', 'signal', 'brief', 'other')),
  input_ref TEXT NOT NULL,
  input_version TEXT,
  produced_by TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (run_id) REFERENCES strategy_backtest_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_run_lineage_run
  ON strategy_run_lineage(tenant_id, run_id, linked_at DESC);

CREATE TABLE IF NOT EXISTS strategy_run_trades (
  trade_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell', 'short', 'cover')),
  quantity NUMERIC(18, 6) NOT NULL,
  fill_price NUMERIC(18, 8) NOT NULL,
  trade_ts TIMESTAMPTZ NOT NULL,
  fees NUMERIC(18, 8),
  slippage_bps NUMERIC(10, 4),
  pnl NUMERIC(18, 8),
  entry_signal JSONB NOT NULL DEFAULT '{}'::jsonb,
  exit_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (run_id) REFERENCES strategy_backtest_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_run_trades_run
  ON strategy_run_trades(tenant_id, run_id, trade_ts DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_run_trades_symbol
  ON strategy_run_trades(tenant_id, symbol, trade_ts DESC);

CREATE TABLE IF NOT EXISTS strategy_promotion_events (
  event_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  strategy_id TEXT NOT NULL,
  from_stage TEXT NOT NULL CHECK (from_stage IN ('candidate', 'validation', 'production', 'retired')),
  to_stage TEXT NOT NULL CHECK (to_stage IN ('candidate', 'validation', 'production', 'retired')),
  auto_gate_passed BOOLEAN NOT NULL DEFAULT FALSE,
  manual_approved_by TEXT,
  checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  rationale TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (strategy_id) REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_promotion_events_strategy
  ON strategy_promotion_events(tenant_id, strategy_id, created_at DESC);

CREATE TABLE IF NOT EXISTS strategy_forward_profiles (
  profile_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  source_run_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'stopped')),
  benchmark TEXT NOT NULL DEFAULT 'SPY',
  rebalance_frozen_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stopped_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (strategy_id) REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  FOREIGN KEY (source_run_id) REFERENCES strategy_backtest_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_strategy_forward_profiles_tenant_user
  ON strategy_forward_profiles(tenant_id, user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_strategy_forward_profiles_strategy
  ON strategy_forward_profiles(tenant_id, strategy_id, started_at DESC);
