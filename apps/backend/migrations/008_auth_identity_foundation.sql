CREATE TABLE IF NOT EXISTS auth_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'starter' CHECK (tier IN ('starter', 'pro', 'enterprise')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL DEFAULT 'argon2id',
  password_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_roles (
  role TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO auth_roles (role)
VALUES ('admin'), ('operator'), ('analyst'), ('viewer'), ('service')
ON CONFLICT (role) DO NOTHING;

CREATE TABLE IF NOT EXISTS auth_user_roles (
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL REFERENCES auth_roles(role) ON DELETE RESTRICT,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  granted_by TEXT,
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired', 'pending_2fa')),
  client_type TEXT NOT NULL DEFAULT 'desktop',
  device_label TEXT,
  user_agent TEXT,
  ip_address TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_status ON auth_sessions(status);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  jti TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  rotated_from_jti TEXT,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT,
  UNIQUE (session_id, jti)
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_session_id ON auth_refresh_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_user_id ON auth_refresh_tokens(user_id);

CREATE TABLE IF NOT EXISTS auth_totp_factors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  encrypted_secret TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  secret_kid TEXT,
  algorithm TEXT NOT NULL DEFAULT 'SHA1',
  digits INTEGER NOT NULL DEFAULT 6,
  period_seconds INTEGER NOT NULL DEFAULT 30,
  confirmed_at TIMESTAMPTZ,
  disabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth_audit_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_events_user_id ON auth_audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_audit_events_event_type ON auth_audit_events(event_type);

CREATE TABLE IF NOT EXISTS auth_external_identities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  issuer TEXT,
  subject TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, subject)
);
