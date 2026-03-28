CREATE TABLE IF NOT EXISTS edgar_flow_anomaly_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_id TEXT NOT NULL,
  filing_id TEXT NOT NULL,
  ticker TEXT,
  company_name TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  anomaly_score NUMERIC(6, 2) NOT NULL,
  triggers JSONB NOT NULL,
  rationale TEXT NOT NULL,
  filed_at TIMESTAMPTZ NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fingerprint TEXT NOT NULL,
  window_days INTEGER NOT NULL,
  source_payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edgar_flow_anomaly_report_scope_reported
  ON edgar_flow_anomaly_report(scope_id, reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_edgar_flow_anomaly_report_scope_fingerprint_reported
  ON edgar_flow_anomaly_report(scope_id, fingerprint, reported_at DESC);
