-- Congress Activity AI System Tables

-- Store AI-analyzed congress trades with sentiment and categorization
CREATE TABLE IF NOT EXISTS ai_congress_analysis (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  category TEXT NOT NULL,
  sentiment TEXT NOT NULL CHECK (sentiment IN ('bullish', 'bearish', 'neutral')),
  sentiment_score NUMERIC(3, 2) CHECK (sentiment_score >= -1.0 AND sentiment_score <= 1.0),
  reasoning TEXT,
  confidence NUMERIC(3, 2) CHECK (confidence >= 0.0 AND confidence <= 1.0),
  ai_model TEXT NOT NULL,
  UNIQUE(user_id, trade_id)
);

CREATE INDEX idx_ai_congress_user_id ON ai_congress_analysis(user_id);
CREATE INDEX idx_ai_congress_created_at ON ai_congress_analysis(created_at DESC);
CREATE INDEX idx_ai_congress_sentiment ON ai_congress_analysis(sentiment);
CREATE INDEX idx_ai_congress_category ON ai_congress_analysis(category);

-- Store AI-generated watchlist candidates from congress activity
CREATE TABLE IF NOT EXISTS ai_congress_watchlist (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  reason TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0 CHECK (priority >= 0 AND priority <= 100),
  trade_count INTEGER NOT NULL DEFAULT 0,
  total_volume TEXT,
  latest_trade_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed BOOLEAN NOT NULL DEFAULT false,
  dismissed_at TIMESTAMPTZ,
  UNIQUE(user_id, ticker)
);

CREATE INDEX idx_ai_congress_watchlist_user_id ON ai_congress_watchlist(user_id);
CREATE INDEX idx_ai_congress_watchlist_priority ON ai_congress_watchlist(priority DESC);
CREATE INDEX idx_ai_congress_watchlist_created_at ON ai_congress_watchlist(created_at DESC);
