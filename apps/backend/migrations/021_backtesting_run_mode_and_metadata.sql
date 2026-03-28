-- Extend backtesting run execution modes and persist run-level reproducibility metadata.

ALTER TABLE strategy_backtest_runs
  ADD COLUMN IF NOT EXISTS run_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
DECLARE
  existing_constraint RECORD;
BEGIN
  FOR existing_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'strategy_backtest_runs'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%execution_mode%'
  LOOP
    EXECUTE format(
      'ALTER TABLE strategy_backtest_runs DROP CONSTRAINT %I',
      existing_constraint.conname
    );
  END LOOP;

  ALTER TABLE strategy_backtest_runs
    ADD CONSTRAINT strategy_backtest_runs_execution_mode_check
    CHECK (execution_mode IN ('desktop-local', 'backend', 'paper', 'live'));
END $$;
