CREATE INDEX IF NOT EXISTS idx_strategy_backtest_runs_strategy_completed
  ON strategy_backtest_runs(tenant_id, strategy_id, status, finished_at DESC);
