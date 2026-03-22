-- Central AI Orchestrator Tables

-- Track user interactions for predictive learning
CREATE TABLE IF NOT EXISTS ai_interactions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type TEXT NOT NULL,
  symbol TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  session_id TEXT,
  source TEXT
);

CREATE INDEX idx_ai_interactions_user_id ON ai_interactions(user_id);
CREATE INDEX idx_ai_interactions_timestamp ON ai_interactions(timestamp DESC);
CREATE INDEX idx_ai_interactions_event_type ON ai_interactions(event_type);
CREATE INDEX idx_ai_interactions_symbol ON ai_interactions(symbol);
CREATE INDEX idx_ai_interactions_session_id ON ai_interactions(session_id);

-- Store AI orchestrator predictions
CREATE TABLE IF NOT EXISTS ai_predictions (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  prediction_type TEXT NOT NULL,
  symbol TEXT,
  confidence NUMERIC(3, 2) CHECK (confidence >= 0.0 AND confidence <= 1.0),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ,
  validated BOOLEAN,
  validated_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_predictions_user_id ON ai_predictions(user_id);
CREATE INDEX idx_ai_predictions_created_at ON ai_predictions(created_at DESC);
CREATE INDEX idx_ai_predictions_prediction_type ON ai_predictions(prediction_type);
CREATE INDEX idx_ai_predictions_symbol ON ai_predictions(symbol);

-- Store learning model stats
CREATE TABLE IF NOT EXISTS ai_learning_stats (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  interactions_count INTEGER NOT NULL DEFAULT 0,
  predictions_count INTEGER NOT NULL DEFAULT 0,
  accuracy_score NUMERIC(3, 2) DEFAULT 0.0,
  last_trained_at TIMESTAMPTZ,
  model_version TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
