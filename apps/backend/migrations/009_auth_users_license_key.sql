ALTER TABLE auth_users
ADD COLUMN IF NOT EXISTS license_key TEXT NOT NULL DEFAULT 'TC-DEMO-STARTER';

CREATE INDEX IF NOT EXISTS idx_auth_users_license_key ON auth_users(license_key);
