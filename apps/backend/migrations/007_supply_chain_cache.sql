-- Supply Chain Mind-Map Cache Tables

-- Store supply chain generation cache
CREATE TABLE IF NOT EXISTS supply_chain_cache (
  cache_key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  data JSONB NOT NULL,
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_model TEXT
);

CREATE INDEX idx_supply_chain_cache_user_id ON supply_chain_cache(user_id);
CREATE INDEX idx_supply_chain_cache_ticker ON supply_chain_cache(ticker);
CREATE INDEX idx_supply_chain_cache_created_at ON supply_chain_cache(created_at DESC);
CREATE INDEX idx_supply_chain_cache_expires_at ON supply_chain_cache(expires_at);

-- Store AI-generated supply chain insights
CREATE TABLE IF NOT EXISTS supply_chain_insights (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  insight_type TEXT NOT NULL,
  content TEXT NOT NULL,
  confidence NUMERIC(3, 2) CHECK (confidence >= 0.0 AND confidence <= 1.0),
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_model TEXT NOT NULL
);

CREATE INDEX idx_supply_chain_insights_user_id ON supply_chain_insights(user_id);
CREATE INDEX idx_supply_chain_insights_ticker ON supply_chain_insights(ticker);
CREATE INDEX idx_supply_chain_insights_created_at ON supply_chain_insights(created_at DESC);
