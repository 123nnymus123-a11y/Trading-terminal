-- Backtesting queue controls and retry observability metadata.

ALTER TABLE strategy_backtest_runs
  ADD COLUMN IF NOT EXISTS queue_job_id TEXT,
  ADD COLUMN IF NOT EXISTS queue_priority TEXT NOT NULL DEFAULT 'normal' CHECK (queue_priority IN ('low', 'normal', 'high')),
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS queue_resource_class TEXT NOT NULL DEFAULT 'standard' CHECK (queue_resource_class IN ('standard', 'heavy'));

CREATE INDEX IF NOT EXISTS idx_strategy_backtest_runs_queue_priority
  ON strategy_backtest_runs(tenant_id, queue_priority, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_backtest_runs_queue_resource
  ON strategy_backtest_runs(tenant_id, queue_resource_class, status, requested_at DESC);
