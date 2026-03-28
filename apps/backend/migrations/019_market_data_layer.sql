-- Canonical Market Data Layer.
-- Implements versioned datasets with immutable IDs, symbol mapping with
-- historical aliases, corporate actions (splits/dividends), delistings
-- for survivorship-bias controls, exchange calendars per venue, and
-- snapshot manifests with checksum lineage.

-- 1) Versioned datasets with immutable IDs
CREATE TABLE IF NOT EXISTS market_dataset_versions (
  dataset_version_id  TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL DEFAULT 'default',
  dataset_name        TEXT NOT NULL,
  version_tag         TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  source_uri          TEXT NOT NULL DEFAULT '',
  row_count           BIGINT,
  date_range_start    DATE,
  date_range_end      DATE,
  symbols             JSONB NOT NULL DEFAULT '[]'::jsonb,
  checksums           JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_immutable        BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, dataset_name, version_tag)
);

CREATE INDEX IF NOT EXISTS idx_market_dataset_versions_lookup
  ON market_dataset_versions(tenant_id, dataset_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_dataset_versions_date_range
  ON market_dataset_versions(tenant_id, date_range_start, date_range_end);

-- 2) Symbol mapping with historical alias changes
CREATE TABLE IF NOT EXISTS market_symbol_mappings (
  mapping_id          TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL DEFAULT 'default',
  canonical_symbol    TEXT NOT NULL,
  alias               TEXT NOT NULL,
  effective_from      DATE NOT NULL,
  effective_to        DATE,
  exchange            TEXT,
  change_reason       TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_symbol_mappings_canonical
  ON market_symbol_mappings(tenant_id, canonical_symbol, effective_from DESC);
CREATE INDEX IF NOT EXISTS idx_market_symbol_mappings_alias
  ON market_symbol_mappings(tenant_id, alias, effective_from DESC);

-- 3) Corporate actions pipeline (splits/dividends/spinoffs)
CREATE TABLE IF NOT EXISTS market_corporate_actions (
  action_id           TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL DEFAULT 'default',
  dataset_version_id  TEXT,
  symbol              TEXT NOT NULL,
  action_type         TEXT NOT NULL CHECK (action_type IN (
                        'split', 'reverse_split', 'dividend',
                        'special_dividend', 'spinoff', 'merger', 'rights_issue'
                      )),
  effective_date      DATE NOT NULL,
  ex_date             DATE,
  ratio               NUMERIC(18, 10),
  amount              NUMERIC(18, 8),
  currency            TEXT NOT NULL DEFAULT 'USD',
  adjusted_flag       BOOLEAN NOT NULL DEFAULT false,
  notes               TEXT NOT NULL DEFAULT '',
  source              TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (dataset_version_id)
    REFERENCES market_dataset_versions(dataset_version_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_market_corporate_actions_symbol_date
  ON market_corporate_actions(tenant_id, symbol, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_market_corporate_actions_dataset
  ON market_corporate_actions(tenant_id, dataset_version_id, effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_market_corporate_actions_ex_date
  ON market_corporate_actions(tenant_id, symbol, ex_date DESC);

-- 4) Delistings and survivorship-bias controls
CREATE TABLE IF NOT EXISTS market_delistings (
  delisting_id        TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL DEFAULT 'default',
  dataset_version_id  TEXT,
  symbol              TEXT NOT NULL,
  exchange            TEXT,
  delisted_on         DATE NOT NULL,
  reason              TEXT NOT NULL CHECK (reason IN (
                        'bankruptcy', 'acquisition', 'merger',
                        'voluntary', 'regulatory', 'other'
                      )),
  successor_symbol    TEXT,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (dataset_version_id)
    REFERENCES market_dataset_versions(dataset_version_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_market_delistings_symbol
  ON market_delistings(tenant_id, symbol, delisted_on DESC);
CREATE INDEX IF NOT EXISTS idx_market_delistings_date
  ON market_delistings(tenant_id, delisted_on DESC);

-- 5) Exchange calendars and holidays per venue
CREATE TABLE IF NOT EXISTS market_exchange_calendars (
  calendar_id         TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL DEFAULT 'default',
  exchange_code       TEXT NOT NULL,
  calendar_year       INTEGER NOT NULL,
  timezone            TEXT NOT NULL DEFAULT 'America/New_York',
  session_open        TIME NOT NULL DEFAULT '09:30:00',
  session_close       TIME NOT NULL DEFAULT '16:00:00',
  holidays            JSONB NOT NULL DEFAULT '[]'::jsonb,
  early_closes        JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes               TEXT NOT NULL DEFAULT '',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, exchange_code, calendar_year)
);

CREATE INDEX IF NOT EXISTS idx_market_exchange_calendars_lookup
  ON market_exchange_calendars(tenant_id, exchange_code, calendar_year DESC);

-- Pre-seed US equity exchange calendar for NYSE/NASDAQ (year 2023-2026 range).
-- Holidays are ISO date strings; early_closes are {date, close_time} pairs.
INSERT INTO market_exchange_calendars
  (calendar_id, tenant_id, exchange_code, calendar_year, timezone,
   session_open, session_close, holidays, early_closes)
VALUES
  ('cal-nyse-2023', 'default', 'NYSE', 2023, 'America/New_York',
   '09:30:00', '16:00:00',
   '["2023-01-02","2023-01-16","2023-02-20","2023-04-07","2023-05-29","2023-06-19","2023-07-04","2023-09-04","2023-11-23","2023-12-25"]'::jsonb,
   '[{"date":"2023-11-24","close_time":"13:00:00"},{"date":"2023-07-03","close_time":"13:00:00"}]'::jsonb),
  ('cal-nyse-2024', 'default', 'NYSE', 2024, 'America/New_York',
   '09:30:00', '16:00:00',
   '["2024-01-01","2024-01-15","2024-02-19","2024-03-29","2024-05-27","2024-06-19","2024-07-04","2024-09-02","2024-11-28","2024-12-25"]'::jsonb,
   '[{"date":"2024-11-29","close_time":"13:00:00"},{"date":"2024-07-03","close_time":"13:00:00"}]'::jsonb),
  ('cal-nyse-2025', 'default', 'NYSE', 2025, 'America/New_York',
   '09:30:00', '16:00:00',
   '["2025-01-01","2025-01-09","2025-01-20","2025-02-17","2025-04-18","2025-05-26","2025-06-19","2025-07-04","2025-09-01","2025-11-27","2025-12-25"]'::jsonb,
   '[{"date":"2025-11-28","close_time":"13:00:00"},{"date":"2025-07-03","close_time":"13:00:00"}]'::jsonb),
  ('cal-nyse-2026', 'default', 'NYSE', 2026, 'America/New_York',
   '09:30:00', '16:00:00',
   '["2026-01-01","2026-01-19","2026-02-16","2026-04-03","2026-05-25","2026-06-19","2026-07-03","2026-09-07","2026-11-26","2026-12-25"]'::jsonb,
   '[{"date":"2026-11-27","close_time":"13:00:00"}]'::jsonb)
ON CONFLICT (tenant_id, exchange_code, calendar_year) DO NOTHING;

-- 6+7+8) Snapshot manifests with checksum lineage and point-in-time metadata
CREATE TABLE IF NOT EXISTS market_snapshot_manifests (
  manifest_id         TEXT PRIMARY KEY,
  tenant_id           TEXT NOT NULL DEFAULT 'default',
  snapshot_id         TEXT NOT NULL,
  dataset_version_id  TEXT,
  manifest_version    INTEGER NOT NULL DEFAULT 1,
  symbols             JSONB NOT NULL DEFAULT '[]'::jsonb,
  bar_count           BIGINT,
  date_range_start    DATE,
  date_range_end      DATE,
  timezone            TEXT NOT NULL DEFAULT 'UTC',
  checksum_sha256     TEXT NOT NULL,
  checksum_algorithm  TEXT NOT NULL DEFAULT 'sha256',
  pit_cutoff_ts       TIMESTAMPTZ,
  lineage             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (snapshot_id)
    REFERENCES strategy_dataset_snapshots(snapshot_id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_version_id)
    REFERENCES market_dataset_versions(dataset_version_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_market_snapshot_manifests_snapshot
  ON market_snapshot_manifests(tenant_id, snapshot_id);
CREATE INDEX IF NOT EXISTS idx_market_snapshot_manifests_dataset
  ON market_snapshot_manifests(tenant_id, dataset_version_id);
CREATE INDEX IF NOT EXISTS idx_market_snapshot_manifests_pit
  ON market_snapshot_manifests(tenant_id, pit_cutoff_ts DESC);
