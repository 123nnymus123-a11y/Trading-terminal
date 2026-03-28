-- Promotion governance auditability extensions.

ALTER TABLE strategy_promotion_events
  ADD COLUMN IF NOT EXISTS governance_profile_id TEXT,
  ADD COLUMN IF NOT EXISTS acceptance_pack_id TEXT,
  ADD COLUMN IF NOT EXISTS governance_validation JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_strategy_promotion_events_governance_profile
  ON strategy_promotion_events(tenant_id, governance_profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_strategy_promotion_events_acceptance_pack
  ON strategy_promotion_events(tenant_id, acceptance_pack_id, created_at DESC);
