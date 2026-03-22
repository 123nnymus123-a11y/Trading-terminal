-- Tenant scoping foundation for backend-first multi-tenant processing.

ALTER TABLE IF EXISTS user_profiles ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS user_settings ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS watchlists ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS positions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS accounts ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- AI / analytics tables
ALTER TABLE IF EXISTS ai_briefs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_research_runs ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_research_config ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_source_items ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_clusters ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_congress_analysis ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_congress_watchlist ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_interactions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_predictions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS ai_learning_stats ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS supply_chain_cache ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS supply_chain_insights ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- Auth identity tables
ALTER TABLE IF EXISTS auth_users ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_credentials ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_user_roles ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_sessions ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_refresh_tokens ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_totp_factors ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_recovery_codes ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_audit_events ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE IF EXISTS auth_external_identities ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant_user ON user_profiles(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_settings_tenant_user ON user_settings(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_tenant_user ON watchlists(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_orders_tenant_user_created ON orders(tenant_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_tenant_user_symbol ON positions(tenant_id, user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_accounts_tenant_user ON accounts(tenant_id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_tenant_user_symbol_unique ON positions(tenant_id, user_id, symbol);
