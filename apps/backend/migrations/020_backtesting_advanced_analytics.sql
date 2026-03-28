-- Advanced backtesting analytics, robustness artifacts, and experiment metadata.

ALTER TABLE strategy_run_artifacts
  ADD COLUMN IF NOT EXISTS payload_json JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS strategy_run_experiments (
  experiment_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  user_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  experiment_name TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT NOT NULL DEFAULT '',
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (run_id) REFERENCES strategy_backtest_runs(run_id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES strategy_definitions(strategy_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (tenant_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_strategy_run_experiments_strategy
  ON strategy_run_experiments(tenant_id, strategy_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_run_experiments_tags
  ON strategy_run_experiments USING GIN(tags);
