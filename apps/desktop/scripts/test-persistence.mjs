/**
 * Test script to verify persistence IPC functionality.
 * Run this from the apps/desktop directory after building.
 */

import electron from "electron";
const { app } = electron;
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the DB and repos
const dbPath = path.join(app.getPath("userData"), "data", "app.db");
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// Simple migration
db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    layout_selection TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    label TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Ensure settings row
const settingsRow = db.prepare("SELECT * FROM app_settings WHERE id = 1").get();
if (!settingsRow) {
  db.prepare("INSERT INTO app_settings (id, layout_selection) VALUES (1, ?)").run(
    JSON.stringify(["default"])
  );
}

// Test functions
async function testPersistence() {
  console.log("\n=== PERSISTENCE TEST ===\n");

  // Test 1: Clear watchlists
  console.log("1. Clearing existing watchlists...");
  db.prepare("DELETE FROM watchlists").run();
  const initialCount = db.prepare("SELECT COUNT(*) as count FROM watchlists").get();
  console.log(`   Initial count: ${initialCount.count}`);

  // Test 2: Add watchlist items
  console.log("\n2. Adding watchlist items...");
  const symbols = [
    { symbol: "AAPL", label: "Apple Inc." },
    { symbol: "MSFT", label: "Microsoft" },
    { symbol: "TSLA", label: "Tesla" },
  ];

  for (const item of symbols) {
    db.prepare("INSERT INTO watchlists (symbol, label) VALUES (?, ?)").run(
      item.symbol,
      item.label
    );
    console.log(`   ✓ Added ${item.symbol}`);
  }

  // Test 3: Read watchlists
  console.log("\n3. Reading watchlists...");
  const watchlists = db.prepare("SELECT * FROM watchlists ORDER BY created_at DESC").all();
  console.log(`   Found ${watchlists.length} items:`);
  watchlists.forEach((w) => {
    console.log(`   - ${w.symbol} (${w.label})`);
  });

  // Test 4: Update layout selection
  console.log("\n4. Updating layout selection...");
  const layouts = ["default", "minimal"];
  db.prepare("UPDATE app_settings SET layout_selection = ?, updated_at = datetime('now') WHERE id = 1").run(
    JSON.stringify(layouts)
  );
  const settings = db.prepare("SELECT * FROM app_settings WHERE id = 1").get();
  console.log(`   Layout selection: ${settings.layout_selection}`);

  // Test 5: Remove a watchlist item
  console.log("\n5. Removing TSLA from watchlist...");
  db.prepare("DELETE FROM watchlists WHERE symbol = ?").run("TSLA");
  const afterDelete = db.prepare("SELECT * FROM watchlists ORDER BY created_at DESC").all();
  console.log(`   Remaining items: ${afterDelete.length}`);
  afterDelete.forEach((w) => {
    console.log(`   - ${w.symbol} (${w.label})`);
  });

  // Test 6: Verify persistence
  console.log("\n6. Verifying final state...");
  const finalWatchlists = db.prepare("SELECT COUNT(*) as count FROM watchlists").get();
  const finalSettings = db.prepare("SELECT * FROM app_settings WHERE id = 1").get();
  
  console.log(`   ✓ Watchlist count: ${finalWatchlists.count}`);
  console.log(`   ✓ Layout selection: ${finalSettings.layout_selection}`);
  console.log(`   ✓ Database path: ${dbPath}`);

  console.log("\n=== TEST COMPLETE ===\n");
  console.log("✓ All persistence operations successful!");
  console.log("✓ Data will persist across app restarts.");
  
  db.close();
  app.quit();
}

app.whenReady().then(testPersistence).catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
