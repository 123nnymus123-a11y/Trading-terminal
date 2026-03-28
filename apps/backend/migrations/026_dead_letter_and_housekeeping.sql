-- Migration 026: Dead-letter index and housekeeping indexes
-- Supports recovery of backend runs stuck in 'running' state after a crash,
-- and improves artifact lookup performance.

-- Partial index for locating runs stuck in running state (dead-letter recovery)
CREATE INDEX IF NOT EXISTS idx_strategy_backtest_runs_running
  ON strategy_backtest_runs (status, started_at)
  WHERE status = 'running';

-- Compound index for efficient artifact lookup by run + kind
CREATE INDEX IF NOT EXISTS idx_strategy_run_artifacts_run_kind
  ON strategy_run_artifacts (run_id, artifact_kind);
