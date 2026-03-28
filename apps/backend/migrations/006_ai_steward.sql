-- AI Steward (Compliance Guardian) Tables

-- Store AI Steward findings
CREATE TABLE IF NOT EXISTS ai_steward_findings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  module TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  recommendation TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  dismissed BOOLEAN NOT NULL DEFAULT false,
  dismissed_at TIMESTAMPTZ
);

CREATE INDEX idx_ai_steward_findings_user_id ON ai_steward_findings(user_id);
CREATE INDEX idx_ai_steward_findings_created_at ON ai_steward_findings(created_at DESC);
CREATE INDEX idx_ai_steward_findings_module ON ai_steward_findings(module);
CREATE INDEX idx_ai_steward_findings_severity ON ai_steward_findings(severity);

-- Store AI Steward tasks
CREATE TABLE IF NOT EXISTS ai_steward_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  finding_id TEXT REFERENCES ai_steward_findings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  task_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  action_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'rejected', 'failed')),
  applied_at TIMESTAMPTZ,
  applied_result JSONB
);

CREATE INDEX idx_ai_steward_tasks_user_id ON ai_steward_tasks(user_id);
CREATE INDEX idx_ai_steward_tasks_status ON ai_steward_tasks(status);
CREATE INDEX idx_ai_steward_tasks_created_at ON ai_steward_tasks(created_at DESC);
CREATE INDEX idx_ai_steward_tasks_finding_id ON ai_steward_tasks(finding_id);

-- Store AI Steward module health
CREATE TABLE IF NOT EXISTS ai_steward_health (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  last_run_at TIMESTAMPTZ,
  last_status TEXT,
  error_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, module)
);

-- Store AI Steward config per user
CREATE TABLE IF NOT EXISTS ai_steward_config (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  auto_apply BOOLEAN NOT NULL DEFAULT false,
  modules_enabled JSONB NOT NULL DEFAULT '{}'::jsonb,
  check_interval_sec INTEGER NOT NULL DEFAULT 3600 CHECK (check_interval_sec >= 300),
  notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
