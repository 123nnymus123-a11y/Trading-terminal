-- Ensure tenant-aware uniqueness for AI per-user config and watchlist tables.

-- ai_research_config originally used user_id as a single-column primary key.
ALTER TABLE IF EXISTS ai_research_config
  DROP CONSTRAINT IF EXISTS ai_research_config_pkey;

ALTER TABLE IF EXISTS ai_research_config
  ADD CONSTRAINT ai_research_config_pkey PRIMARY KEY (tenant_id, user_id);

-- ai_steward_config originally used user_id as a single-column primary key.
ALTER TABLE IF EXISTS ai_steward_config
  DROP CONSTRAINT IF EXISTS ai_steward_config_pkey;

ALTER TABLE IF EXISTS ai_steward_config
  ADD CONSTRAINT ai_steward_config_pkey PRIMARY KEY (tenant_id, user_id);

-- ai_congress_watchlist originally used UNIQUE(user_id, ticker).
ALTER TABLE IF EXISTS ai_congress_watchlist
  DROP CONSTRAINT IF EXISTS ai_congress_watchlist_user_id_ticker_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_congress_watchlist_tenant_user_ticker_unique
  ON ai_congress_watchlist (tenant_id, user_id, ticker);