import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";
import { DEFAULT_BACKEND_URL } from "../../shared/backendConfig";

const BASELINE_SCHEMA_VERSION = 0;
const LATEST_SCHEMA_VERSION = 5;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const userData = app.getPath("userData");
  const dbDir = path.join(userData, "data");
  const dbPath = path.join(dbDir, "app.db");

  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  migrate(db);
  return db;
}

function migrate(db: Database.Database) {
  applyBaselineSchema(db);
  ensureSchemaVersionTable(db);

  if (getCurrentSchemaVersion(db) === null) {
    // Stamp baseline and then apply pending migrations in-order.
    recordSchemaVersion(db, BASELINE_SCHEMA_VERSION);
  }

  runPendingMigrations(db);
}

function applyBaselineSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS watchlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      note TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS layouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT,
      preset TEXT NOT NULL,
      data TEXT
    );

    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy','sell')),
      qty REAL NOT NULL,
      price REAL NOT NULL,
      ts INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      actor TEXT DEFAULT 'system',
      action TEXT NOT NULL,
      detail TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS paper_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id_entry TEXT NOT NULL UNIQUE,
      order_id_exit TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL CHECK (side IN ('buy','sell')),
      entry_qty REAL NOT NULL,
      entry_price REAL NOT NULL,
      entry_ts INTEGER NOT NULL,
      exit_price REAL,
      exit_ts INTEGER,
      entry_screenshot_path TEXT,
      exit_screenshot_path TEXT,
      setup TEXT,
      regime TEXT,
      catalyst TEXT,
      execution_type TEXT,
      mistakes TEXT,
      notes TEXT,
      mae REAL,
      mfe REAL,
      time_in_trade INTEGER,
      slippage REAL,
      costs REAL,
      adherence_score REAL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s000', 'now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s000', 'now'))
    );

    CREATE TABLE IF NOT EXISTS trade_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_id INTEGER NOT NULL,
      tag_type TEXT NOT NULL CHECK (tag_type IN ('setup','regime','catalyst','execution','mistake')),
      tag_value TEXT NOT NULL,
      FOREIGN KEY (trade_id) REFERENCES paper_trades(id) ON DELETE CASCADE,
      UNIQUE(trade_id, tag_type, tag_value)
    );

    CREATE INDEX IF NOT EXISTS idx_paper_trades_symbol ON paper_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_entry_ts ON paper_trades(entry_ts);
    CREATE INDEX IF NOT EXISTS idx_paper_trades_exit_ts ON paper_trades(exit_ts);
    CREATE INDEX IF NOT EXISTS idx_trade_tags_trade_id ON trade_tags(trade_id);

    -- Public Flow Intel tables
    CREATE TABLE IF NOT EXISTS disclosure_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_url TEXT,
      entity_name TEXT NOT NULL,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('institution','insider','hedge-fund','etf','other')),
      owner_type TEXT NOT NULL CHECK (owner_type IN ('institutional','insider','beneficial-owner','other')),
      ticker TEXT,
      asset_name TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('BUY','SELL')),
      tx_date TEXT NOT NULL,
      report_date TEXT NOT NULL,
      amount_min REAL,
      amount_max REAL,
      sector TEXT,
      industry TEXT,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      raw_json TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS sector_theme (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      window_days INTEGER NOT NULL CHECK (window_days IN (7, 30)),
      window_start TEXT NOT NULL,
      window_end TEXT NOT NULL,
      sector TEXT NOT NULL,
      score REAL NOT NULL CHECK (score >= 0 AND score <= 100),
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS watchlist_candidate (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      theme_id INTEGER NOT NULL,
      ticker TEXT NOT NULL,
      rationale TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('peer','supplier','customer','etf-constituent')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (theme_id) REFERENCES sector_theme(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_disclosure_event_ticker ON disclosure_event(ticker);
    CREATE INDEX IF NOT EXISTS idx_disclosure_event_sector ON disclosure_event(sector);
    CREATE INDEX IF NOT EXISTS idx_disclosure_event_report_date ON disclosure_event(report_date);
    CREATE INDEX IF NOT EXISTS idx_sector_theme_sector ON sector_theme(sector);
    CREATE INDEX IF NOT EXISTS idx_sector_theme_window ON sector_theme(window_days, window_start, window_end);
    CREATE INDEX IF NOT EXISTS idx_watchlist_candidate_theme_id ON watchlist_candidate(theme_id);
    CREATE INDEX IF NOT EXISTS idx_watchlist_candidate_ticker ON watchlist_candidate(ticker);

    -- AI Research tables
    CREATE TABLE IF NOT EXISTS ai_source_items (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      tickers TEXT NOT NULL,
      ingested_at TEXT NOT NULL,
      canonical_hash TEXT NOT NULL,
      canonical_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_clusters (
      cluster_id TEXT PRIMARY KEY,
      representative_item_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_cluster_items (
      cluster_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      PRIMARY KEY (cluster_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS ai_briefs (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      headline TEXT NOT NULL,
      summary_bullets TEXT NOT NULL,
      tickers TEXT NOT NULL,
      why_it_matters TEXT NOT NULL,
      what_to_watch TEXT NOT NULL,
      impact_score INTEGER NOT NULL,
      confidence INTEGER NOT NULL,
      sources TEXT NOT NULL,
      cluster_id TEXT,
      run_id TEXT
    );

    CREATE TABLE IF NOT EXISTS ai_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL,
      error TEXT,
      stats TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ai_source_items_published_at ON ai_source_items(published_at);
    CREATE INDEX IF NOT EXISTS idx_ai_source_items_source ON ai_source_items(source);
    CREATE INDEX IF NOT EXISTS idx_ai_clusters_updated_at ON ai_clusters(updated_at);
    CREATE INDEX IF NOT EXISTS idx_ai_briefs_created_at ON ai_briefs(created_at);

    CREATE TABLE IF NOT EXISTS supply_chain_cache (
      company_ticker TEXT PRIMARY KEY,
      mind_map_data TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_supply_chain_expires ON supply_chain_cache(expires_at);

    -- Supply Chain Official Graph Store
    CREATE TABLE IF NOT EXISTS supply_chain_company (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      tickers TEXT,
      identifiers TEXT,
      metadata TEXT,
      last_updated TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supply_chain_edge (
      id TEXT PRIMARY KEY,
      from_company_id TEXT NOT NULL,
      to_company_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      weight REAL,
      weight_min REAL,
      weight_max REAL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      explanation TEXT,
      source TEXT,
      FOREIGN KEY (from_company_id) REFERENCES supply_chain_company(id) ON DELETE CASCADE,
      FOREIGN KEY (to_company_id) REFERENCES supply_chain_company(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS supply_chain_document (
      doc_id TEXT PRIMARY KEY,
      source_kind TEXT NOT NULL,
      official_origin TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      raw_content_location TEXT NOT NULL,
      parsed_text_location TEXT NOT NULL,
      tickers TEXT
    );

    CREATE TABLE IF NOT EXISTS supply_chain_evidence (
      evidence_id TEXT PRIMARY KEY,
      edge_id TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      doc_date TEXT NOT NULL,
      location_pointer TEXT NOT NULL,
      snippet TEXT NOT NULL,
      retrieval_hash TEXT NOT NULL,
      doc_id TEXT,
      FOREIGN KEY (edge_id) REFERENCES supply_chain_edge(id) ON DELETE CASCADE,
      FOREIGN KEY (doc_id) REFERENCES supply_chain_document(doc_id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS supply_chain_ego_cache (
      cache_key TEXT PRIMARY KEY,
      company_ticker TEXT NOT NULL,
      strict_mode INTEGER NOT NULL,
      include_hypothesis INTEGER NOT NULL,
      hops INTEGER NOT NULL,
      min_edge_weight REAL NOT NULL,
      generated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      graph_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supply_chain_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      action TEXT NOT NULL,
      detail TEXT DEFAULT ''
    );

    CREATE INDEX IF NOT EXISTS idx_supply_chain_company_tickers ON supply_chain_company(tickers);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_edge_from ON supply_chain_edge(from_company_id);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_edge_to ON supply_chain_edge(to_company_id);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_edge_status ON supply_chain_edge(status);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_doc_tickers ON supply_chain_document(tickers);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_evidence_edge ON supply_chain_evidence(edge_id);
    CREATE INDEX IF NOT EXISTS idx_supply_chain_ego_expires ON supply_chain_ego_cache(expires_at);

    -- GWMD Map tables (Global World Mind-Map Data)
    CREATE TABLE IF NOT EXISTS gwmd_company (
      ticker TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hq_lat REAL,
      hq_lon REAL,
      hq_city TEXT,
      hq_country TEXT,
      industry TEXT,
      health_score INTEGER CHECK (health_score >= 0 AND health_score <= 100),
      added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS gwmd_relationship (
      id TEXT PRIMARY KEY,
      from_ticker TEXT NOT NULL,
      to_ticker TEXT NOT NULL,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('supplier','customer','partner','competitor','financing','license')),
      weight REAL CHECK (weight >= 0 AND weight <= 1),
      confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
      evidence TEXT,
      added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      FOREIGN KEY (from_ticker) REFERENCES gwmd_company(ticker) ON DELETE CASCADE,
      FOREIGN KEY (to_ticker) REFERENCES gwmd_company(ticker) ON DELETE CASCADE,
      UNIQUE(from_ticker, to_ticker, relation_type)
    );

    CREATE TABLE IF NOT EXISTS gwmd_search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticker TEXT NOT NULL,
      searched_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      companies_found INTEGER DEFAULT 0,
      relationships_found INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_gwmd_company_coords ON gwmd_company(hq_lat, hq_lon);
    CREATE INDEX IF NOT EXISTS idx_gwmd_relationship_from ON gwmd_relationship(from_ticker);
    CREATE INDEX IF NOT EXISTS idx_gwmd_relationship_to ON gwmd_relationship(to_ticker);
    CREATE INDEX IF NOT EXISTS idx_gwmd_relationship_type ON gwmd_relationship(relation_type);
    CREATE INDEX IF NOT EXISTS idx_gwmd_search_history_ticker ON gwmd_search_history(ticker);

    -- Congress Activity tables
    CREATE TABLE IF NOT EXISTS congressional_trade (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT UNIQUE,
      person_name TEXT NOT NULL,
      chamber TEXT NOT NULL CHECK (chamber IN ('House','Senate')),
      transaction_date TEXT NOT NULL,
      disclosure_date TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      asset_name_raw TEXT NOT NULL,
      ticker_normalized TEXT,
      asset_type TEXT NOT NULL CHECK (asset_type IN ('stock','option','crypto','fund','bond','other')),
      amount_range_low REAL,
      amount_range_high REAL,
      amount_currency TEXT DEFAULT 'USD',
      comments_raw TEXT,
      source_document_id TEXT,
      source_url TEXT,
      quality_flag_ticker_match TEXT NOT NULL CHECK (quality_flag_ticker_match IN ('confident','ambiguous','unmatched')),
      quality_flag_amount TEXT NOT NULL CHECK (quality_flag_amount IN ('complete','partial','missing')),
      ingestion_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_updated_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS congressional_member (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      chamber TEXT NOT NULL CHECK (chamber IN ('House','Senate')),
      party TEXT,
      state TEXT,
      district TEXT,
      committee_memberships TEXT,
      leadership_roles TEXT,
      seniority_indicator TEXT,
      office_term_start TEXT,
      office_term_end TEXT,
      bioguide_id TEXT,
      last_updated_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS lobbying_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT UNIQUE,
      reporting_entity_name TEXT NOT NULL,
      client_name TEXT NOT NULL,
      lobbying_amount REAL,
      period_start TEXT,
      period_end TEXT,
      issues_topics_raw TEXT,
      naics_code TEXT,
      ticker_normalized TEXT,
      filing_reference_id TEXT,
      filing_url TEXT,
      ingestion_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_updated_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS federal_contract (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT UNIQUE,
      recipient_name TEXT NOT NULL,
      contractor_name TEXT NOT NULL,
      award_amount REAL,
      award_currency TEXT DEFAULT 'USD',
      agency_name TEXT NOT NULL,
      award_date TEXT,
      period_start TEXT,
      period_end TEXT,
      naics_code TEXT,
      category_description TEXT,
      ticker_normalized TEXT,
      contract_reference_id TEXT,
      source_url TEXT,
      ingestion_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      last_updated_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS company_ticker_mapping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mapping_id TEXT UNIQUE,
      company_name_raw TEXT NOT NULL,
      company_name_normalized TEXT NOT NULL,
      ticker TEXT NOT NULL,
      match_confidence TEXT NOT NULL CHECK (match_confidence IN ('high','medium','low')),
      match_method TEXT NOT NULL CHECK (match_method IN ('exact','fuzzy','manual')),
      valid_from_date TEXT,
      valid_to_date TEXT,
      last_verified_timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS congress_data_ingestion_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_id TEXT UNIQUE,
      domain TEXT NOT NULL CHECK (domain IN ('congressional_trades','lobbying','contracts','member_metadata')),
      operation_type TEXT NOT NULL CHECK (operation_type IN ('initial_load','incremental_update','deduplication')),
      records_processed INTEGER NOT NULL DEFAULT 0,
      records_inserted INTEGER NOT NULL DEFAULT 0,
      records_updated INTEGER NOT NULL DEFAULT 0,
      records_skipped_duplicate INTEGER NOT NULL DEFAULT 0,
      timestamp_start TEXT NOT NULL,
      timestamp_end TEXT,
      status TEXT NOT NULL CHECK (status IN ('success','partial','failed')),
      error_messages TEXT
    );

    -- Indexes for congressional_trade
    CREATE INDEX IF NOT EXISTS idx_congressional_trade_person_name ON congressional_trade(person_name);
    CREATE INDEX IF NOT EXISTS idx_congressional_trade_chamber ON congressional_trade(chamber);
    CREATE INDEX IF NOT EXISTS idx_congressional_trade_ticker ON congressional_trade(ticker_normalized);
    CREATE INDEX IF NOT EXISTS idx_congressional_trade_transaction_date ON congressional_trade(transaction_date);
    CREATE INDEX IF NOT EXISTS idx_congressional_trade_disclosure_date ON congressional_trade(disclosure_date);
    CREATE INDEX IF NOT EXISTS idx_congressional_trade_asset_type ON congressional_trade(asset_type);
    CREATE INDEX IF NOT EXISTS idx_congressional_trade_transaction_type ON congressional_trade(transaction_type);

    -- Indexes for congressional_member
    CREATE INDEX IF NOT EXISTS idx_congressional_member_full_name ON congressional_member(full_name);
    CREATE INDEX IF NOT EXISTS idx_congressional_member_chamber ON congressional_member(chamber);
    CREATE INDEX IF NOT EXISTS idx_congressional_member_party ON congressional_member(party);
    CREATE INDEX IF NOT EXISTS idx_congressional_member_state ON congressional_member(state);

    -- Indexes for lobbying_activity
    CREATE INDEX IF NOT EXISTS idx_lobbying_activity_client_name ON lobbying_activity(client_name);
    CREATE INDEX IF NOT EXISTS idx_lobbying_activity_ticker ON lobbying_activity(ticker_normalized);
    CREATE INDEX IF NOT EXISTS idx_lobbying_activity_period_start ON lobbying_activity(period_start);

    -- Indexes for federal_contract
    CREATE INDEX IF NOT EXISTS idx_federal_contract_recipient_name ON federal_contract(recipient_name);
    CREATE INDEX IF NOT EXISTS idx_federal_contract_contractor_name ON federal_contract(contractor_name);
    CREATE INDEX IF NOT EXISTS idx_federal_contract_agency_name ON federal_contract(agency_name);
    CREATE INDEX IF NOT EXISTS idx_federal_contract_ticker ON federal_contract(ticker_normalized);
    CREATE INDEX IF NOT EXISTS idx_federal_contract_award_date ON federal_contract(award_date);

    -- Indexes for company_ticker_mapping
    CREATE INDEX IF NOT EXISTS idx_company_ticker_mapping_ticker ON company_ticker_mapping(ticker);
    CREATE INDEX IF NOT EXISTS idx_company_ticker_mapping_company_name ON company_ticker_mapping(company_name_normalized);

    -- Indexes for congress_data_ingestion_log
    CREATE INDEX IF NOT EXISTS idx_congress_data_ingestion_log_domain ON congress_data_ingestion_log(domain);
    CREATE INDEX IF NOT EXISTS idx_congress_data_ingestion_log_timestamp_start ON congress_data_ingestion_log(timestamp_start);
  `);
}

function ensureSchemaVersionTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );
  `);
}

function getCurrentSchemaVersion(db: Database.Database): number | null {
  const row = db
    .prepare("SELECT MAX(version) AS version FROM schema_version")
    .get() as { version: number | null } | undefined;
  if (!row || row.version === null) return null;
  return row.version;
}

function recordSchemaVersion(db: Database.Database, version: number): void {
  db.prepare("INSERT OR IGNORE INTO schema_version (version) VALUES (?)").run(
    version,
  );
}

function runPendingMigrations(db: Database.Database): void {
  const migrations: Array<{
    version: number;
    up: (database: Database.Database) => void;
  }> = [
    {
      version: 1,
      up: (database) => {
        ensureDisclosureEventTickerNullable(database);
        ensureAppSettingsDefaults(database);
        ensureAiConfigDefaults(database);
      },
    },
    {
      version: 2,
      up: (database) => {
        ensureGraphEnrichmentTables(database);
      },
    },
    {
      version: 3,
      up: (database) => {
        ensureStrategyResearchLocalTables(database);
      },
    },
    {
      version: 4,
      up: (database) => {
        ensureStrategyResearchComparisonTables(database);
      },
    },
    {
      version: 5,
      up: (database) => {
        ensureStrategyResearchRunLogColumn(database);
      },
    },
  ];

  let current = getCurrentSchemaVersion(db);
  if (current === null) {
    current = BASELINE_SCHEMA_VERSION;
  }

  for (const migration of migrations) {
    if (migration.version > current) {
      migration.up(db);
      recordSchemaVersion(db, migration.version);
      current = migration.version;
    }
  }

  if (current < LATEST_SCHEMA_VERSION) {
    throw new Error(
      `Failed to migrate schema to v${LATEST_SCHEMA_VERSION}. Current: v${current}`,
    );
  }
}

function ensureStrategyResearchLocalTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_local_definition (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      stage TEXT NOT NULL CHECK (stage IN ('draft','candidate','validation','production','retired')),
      tags_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS strategy_local_version (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      version TEXT NOT NULL,
      script_language TEXT NOT NULL CHECK (script_language IN ('javascript','typescript')),
      script_source TEXT NOT NULL,
      script_checksum TEXT NOT NULL,
      universe_json TEXT NOT NULL DEFAULT '[]',
      assumptions_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (strategy_id) REFERENCES strategy_local_definition(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_strategy_local_version_strategy
      ON strategy_local_version(strategy_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS strategy_local_run (
      run_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      strategy_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','cancelled')),
      execution_mode TEXT NOT NULL CHECK (execution_mode IN ('desktop-local','backend')),
      requested_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      error TEXT,
      metrics_json TEXT NOT NULL DEFAULT '{}',
      equity_curve_json TEXT,
      trades_json TEXT,
      historical_data_json TEXT,
      run_metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (strategy_id) REFERENCES strategy_local_definition(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_strategy_local_run_strategy
      ON strategy_local_run(strategy_id, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_strategy_local_run_finished
      ON strategy_local_run(finished_at DESC);
  `);
}

function ensureStrategyResearchComparisonTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_local_comparison_note (
      id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      primary_run_id TEXT NOT NULL,
      baseline_run_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(strategy_id, primary_run_id, baseline_run_id),
      FOREIGN KEY (strategy_id) REFERENCES strategy_local_definition(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_strategy_local_comparison_strategy
      ON strategy_local_comparison_note(strategy_id, updated_at DESC);
  `);
}

function ensureStrategyResearchRunLogColumn(db: Database.Database): void {
  try {
    db.exec(`ALTER TABLE strategy_local_run ADD COLUMN run_logs_json TEXT`);
  } catch {
    // Column likely already exists.
  }
}

function ensureAppSettingsDefaults(db: Database.Database): void {
  // Ensure a single app_settings row exists and includes backendUrl.
  const row = db.prepare("SELECT data FROM app_settings WHERE id = 1").get() as
    | { data: string }
    | undefined;
  if (!row) {
    db.prepare("INSERT INTO app_settings (id, data) VALUES (1, ?)").run(
      JSON.stringify({ backendUrl: DEFAULT_BACKEND_URL }),
    );
    return;
  }

  try {
    const parsed = JSON.parse(row.data ?? "{}") as Record<string, unknown>;
    if (typeof parsed.backendUrl !== "string" || !parsed.backendUrl.trim()) {
      db.prepare("UPDATE app_settings SET data = ? WHERE id = 1").run(
        JSON.stringify({ ...parsed, backendUrl: DEFAULT_BACKEND_URL }),
      );
    }
  } catch {
    db.prepare("UPDATE app_settings SET data = ? WHERE id = 1").run(
      JSON.stringify({ backendUrl: DEFAULT_BACKEND_URL }),
    );
  }
}

function ensureAiConfigDefaults(db: Database.Database): void {
  // Ensure a single ai_config row exists.
  const aiRow = db.prepare("SELECT id FROM ai_config WHERE id = 1").get();
  if (!aiRow) {
    db.prepare("INSERT INTO ai_config (id, data) VALUES (1, ?)").run(
      JSON.stringify({
        enabled: false,
        model: "deepseek-r1:14b",
        pollIntervalSec: 300,
        rssFeeds: [
          "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&CIK=&type=8-K&owner=include&count=100&output=atom",
        ],
        secForms: ["8-K", "10-Q", "10-K"],
        watchlistTickers: [],
        watchlistKeywords: [],
        useX: false,
        focusPrompt: "",
      }),
    );
  }
}

function ensureDisclosureEventTickerNullable(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('disclosure_event')").all() as {
    name: string;
    notnull: number;
  }[];
  const ticker = columns.find((c) => c.name === "ticker");

  if (ticker && ticker.notnull === 1) {
    db.transaction(() => {
      db.exec("ALTER TABLE disclosure_event RENAME TO disclosure_event_old;");

      db.exec(`
        CREATE TABLE disclosure_event (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          source_url TEXT,
          entity_name TEXT NOT NULL,
          entity_type TEXT NOT NULL CHECK (entity_type IN ('institution','insider','hedge-fund','etf','other')),
          owner_type TEXT NOT NULL CHECK (owner_type IN ('institutional','insider','beneficial-owner','other')),
          ticker TEXT,
          asset_name TEXT NOT NULL,
          action TEXT NOT NULL CHECK (action IN ('BUY','SELL')),
          tx_date TEXT NOT NULL,
          report_date TEXT NOT NULL,
          amount_min REAL,
          amount_max REAL,
          sector TEXT,
          industry TEXT,
          confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
          raw_json TEXT,
          created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
      `);

      db.exec(`
        INSERT INTO disclosure_event (
          id, source, source_url, entity_name, entity_type, owner_type, ticker, asset_name, action, tx_date, report_date, amount_min, amount_max, sector, industry, confidence, raw_json, created_at
        )
        SELECT id, source, source_url, entity_name, entity_type, owner_type, ticker, asset_name, action, tx_date, report_date, amount_min, amount_max, sector, industry, confidence, raw_json, created_at
        FROM disclosure_event_old;
      `);

      db.exec("DROP TABLE disclosure_event_old;");

      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_disclosure_event_ticker ON disclosure_event(ticker);
        CREATE INDEX IF NOT EXISTS idx_disclosure_event_sector ON disclosure_event(sector);
        CREATE INDEX IF NOT EXISTS idx_disclosure_event_report_date ON disclosure_event(report_date);
      `);
    })();
  }
}

function ensureGraphEnrichmentTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS graph_enrichment_entity (
      id TEXT PRIMARY KEY,
      canonical_name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      zone TEXT NOT NULL CHECK (zone IN ('candidate','validation','production')),
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_title TEXT,
      source_url TEXT,
      ai_inferred INTEGER NOT NULL DEFAULT 0,
      confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
      freshness_score REAL NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
      confidence_band TEXT NOT NULL CHECK (confidence_band IN ('very_low','low','medium','high','very_high')),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT,
      validation_status TEXT NOT NULL CHECK (validation_status IN ('unvalidated','pending_validation','validated','contradicted','rejected')),
      validation_method TEXT,
      validator_type TEXT CHECK (validator_type IN ('human','rule','model','hybrid')),
      contradiction_flag INTEGER NOT NULL DEFAULT 0,
      stale_flag INTEGER NOT NULL DEFAULT 0,
      promotion_eligible INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_alias (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      alias_type TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(entity_id, alias),
      FOREIGN KEY (entity_id) REFERENCES graph_enrichment_entity(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_edge (
      id TEXT PRIMARY KEY,
      from_entity_id TEXT NOT NULL,
      to_entity_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      zone TEXT NOT NULL CHECK (zone IN ('candidate','validation','production')),
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      source_title TEXT,
      source_url TEXT,
      ai_inferred INTEGER NOT NULL DEFAULT 0,
      confidence_score REAL NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 1),
      freshness_score REAL NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
      confidence_band TEXT NOT NULL CHECK (confidence_band IN ('very_low','low','medium','high','very_high')),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT,
      validation_status TEXT NOT NULL CHECK (validation_status IN ('unvalidated','pending_validation','validated','contradicted','rejected')),
      validation_method TEXT,
      validator_type TEXT CHECK (validator_type IN ('human','rule','model','hybrid')),
      contradiction_flag INTEGER NOT NULL DEFAULT 0,
      stale_flag INTEGER NOT NULL DEFAULT 0,
      promotion_eligible INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (from_entity_id) REFERENCES graph_enrichment_entity(id) ON DELETE CASCADE,
      FOREIGN KEY (to_entity_id) REFERENCES graph_enrichment_entity(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_evidence (
      evidence_id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      source_title TEXT,
      source_url TEXT,
      source_key TEXT,
      snippet TEXT,
      extracted_summary TEXT,
      extraction_method TEXT,
      extracted_at TEXT NOT NULL,
      fingerprint_hash TEXT,
      quality_score REAL NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_evidence_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('entity','edge')),
      target_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(target_type, target_id, evidence_id),
      FOREIGN KEY (evidence_id) REFERENCES graph_enrichment_evidence(evidence_id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_validation_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('entity','edge')),
      target_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      from_zone TEXT CHECK (from_zone IN ('candidate','validation','production')),
      to_zone TEXT CHECK (to_zone IN ('candidate','validation','production')),
      validator_type TEXT,
      validation_method TEXT,
      reason TEXT NOT NULL,
      contradiction_flag INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_usage_memory (
      target_type TEXT NOT NULL CHECK (target_type IN ('entity','edge')),
      target_id TEXT NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      last_requested_at TEXT NOT NULL,
      query_cluster TEXT,
      speedup_benefit_ms REAL,
      temperature TEXT NOT NULL CHECK (temperature IN ('hot','warm','cold')),
      improved_response_speed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (target_type, target_id)
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_query_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_hash TEXT NOT NULL,
      query_text TEXT NOT NULL,
      query_cluster TEXT,
      requested_at TEXT NOT NULL,
      cache_hit INTEGER NOT NULL DEFAULT 0,
      stale_items_detected INTEGER NOT NULL DEFAULT 0,
      enrichment_delta_count INTEGER NOT NULL DEFAULT 0,
      response_ms REAL
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_revalidation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('entity','edge')),
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','done','failed')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS graph_enrichment_sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending','running','retry','done','failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_graph_entity_zone ON graph_enrichment_entity(zone);
    CREATE INDEX IF NOT EXISTS idx_graph_entity_name ON graph_enrichment_entity(canonical_name);
    CREATE INDEX IF NOT EXISTS idx_graph_entity_stale ON graph_enrichment_entity(stale_flag);
    CREATE INDEX IF NOT EXISTS idx_graph_entity_validation_status ON graph_enrichment_entity(validation_status);
    CREATE INDEX IF NOT EXISTS idx_graph_entity_expiry ON graph_enrichment_entity(expires_at);
    CREATE INDEX IF NOT EXISTS idx_graph_alias_alias ON graph_enrichment_alias(alias);

    CREATE INDEX IF NOT EXISTS idx_graph_edge_zone ON graph_enrichment_edge(zone);
    CREATE INDEX IF NOT EXISTS idx_graph_edge_from ON graph_enrichment_edge(from_entity_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edge_to ON graph_enrichment_edge(to_entity_id);
    CREATE INDEX IF NOT EXISTS idx_graph_edge_stale ON graph_enrichment_edge(stale_flag);
    CREATE INDEX IF NOT EXISTS idx_graph_edge_validation_status ON graph_enrichment_edge(validation_status);
    CREATE INDEX IF NOT EXISTS idx_graph_edge_expiry ON graph_enrichment_edge(expires_at);

    CREATE INDEX IF NOT EXISTS idx_graph_evidence_source_reference ON graph_enrichment_evidence(source_reference);
    CREATE INDEX IF NOT EXISTS idx_graph_evidence_quality ON graph_enrichment_evidence(quality_score);
    CREATE INDEX IF NOT EXISTS idx_graph_evidence_link_target ON graph_enrichment_evidence_link(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_graph_validation_event_target ON graph_enrichment_validation_event(target_type, target_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_graph_usage_temperature ON graph_enrichment_usage_memory(temperature);
    CREATE INDEX IF NOT EXISTS idx_graph_query_cluster ON graph_enrichment_query_history(query_cluster, requested_at);
    CREATE INDEX IF NOT EXISTS idx_graph_revalidation_status ON graph_enrichment_revalidation_queue(status, scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_graph_sync_status ON graph_enrichment_sync_queue(status, updated_at);
  `);
}
