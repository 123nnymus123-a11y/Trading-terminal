ALTER TABLE strategy_forward_profiles
  ADD COLUMN IF NOT EXISTS execution_mode TEXT NOT NULL DEFAULT 'paper',
  ADD COLUMN IF NOT EXISTS governance_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS acceptance_pack_id TEXT,
  ADD COLUMN IF NOT EXISTS activation_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS governance_validation JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'strategy_forward_profiles_execution_mode_check'
  ) THEN
    ALTER TABLE strategy_forward_profiles
      ADD CONSTRAINT strategy_forward_profiles_execution_mode_check
      CHECK (execution_mode IN ('paper', 'live'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_strategy_forward_profiles_execution_mode
  ON strategy_forward_profiles(tenant_id, execution_mode, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_forward_profiles_governance_profile
  ON strategy_forward_profiles(tenant_id, governance_profile_id, started_at DESC);
