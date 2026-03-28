-- Backtesting provider connector registry, governance profiles, and acceptance packs.

CREATE TABLE IF NOT EXISTS strategy_provider_connectors (
  connector_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  connector_type TEXT NOT NULL CHECK (connector_type IN ('data-provider', 'paper-broker')),
  status TEXT NOT NULL CHECK (status IN ('not_configured', 'configured', 'disabled')),
  display_name TEXT NOT NULL DEFAULT '',
  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  capabilities_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, connector_type)
);

CREATE INDEX IF NOT EXISTS idx_strategy_provider_connectors_tenant
  ON strategy_provider_connectors(tenant_id, connector_type, updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_governance_profiles (
  profile_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  profile_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  transition_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  required_report_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  benchmark_required BOOLEAN NOT NULL DEFAULT FALSE,
  oos_minimums JSONB NOT NULL DEFAULT '{}'::jsonb,
  drawdown_halt_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  replay_tolerance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_governance_profiles_default
  ON strategy_governance_profiles(tenant_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_strategy_governance_profiles_tenant
  ON strategy_governance_profiles(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS strategy_acceptance_packs (
  pack_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL DEFAULT 'default',
  pack_name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  golden_strategies JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_report_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  replay_tolerance JSONB NOT NULL DEFAULT '{}'::jsonb,
  promotion_checklist JSONB NOT NULL DEFAULT '{}'::jsonb,
  definition_of_done JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategy_acceptance_packs_default
  ON strategy_acceptance_packs(tenant_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_strategy_acceptance_packs_tenant
  ON strategy_acceptance_packs(tenant_id, updated_at DESC);
