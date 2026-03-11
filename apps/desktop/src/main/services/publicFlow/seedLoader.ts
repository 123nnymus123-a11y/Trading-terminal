import fs from "node:fs";
import path from "node:path";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import { getDb } from "../../persistence/db";
import type { InsertDisclosureEvent } from "@tc/shared";

/**
 * Seed loader for Public Flow Intel demo data.
 * Loads seed_events.json into the database if disclosure_event table is empty.
 */

let seedLoaded = false;

export function initPublicFlowSeed(): void {
  if (seedLoaded) return;

  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as count FROM disclosure_event").get() as { count: number };

  if (count.count === 0) {
    console.log("[PublicFlowSeed] Loading seed disclosure events...");
    loadSeedEvents();
    seedLoaded = true;
    console.log("[PublicFlowSeed] Seed data loaded successfully.");
  } else {
    console.log(`[PublicFlowSeed] Database already has ${count.count} disclosure events. Skipping seed.`);
    seedLoaded = true;
  }
}

function loadSeedEvents(): void {
  // Try multiple possible paths for the seed file
  // 1. Build directory: dist/main/services/publicFlow/data/
  // 2. Source directory: src/main/services/publicFlow/data/ (during dev)
  
  const buildPath = path.join(__dirname, "data", "seed_events.json");
  const sourcePath = path.join(__dirname, "..", "..", "..", "..", "src", "main", "services", "publicFlow", "data", "seed_events.json");
  
  let seedPath = buildPath;
  if (!fs.existsSync(buildPath)) {
    if (fs.existsSync(sourcePath)) {
      seedPath = sourcePath;
    } else {
      console.warn(`[PublicFlowSeed] Seed file not found at ${buildPath} or ${sourcePath}`);
      return;
    }
  }

  const rawData = fs.readFileSync(seedPath, "utf-8");
  const events = JSON.parse(rawData) as InsertDisclosureEvent[];

  if (events.length === 0) {
    console.warn("[PublicFlowSeed] No events found in seed file.");
    return;
  }

  const ids = PublicFlowRepo.insertDisclosureEvents(events);
  console.log(`[PublicFlowSeed] Inserted ${ids.length} disclosure events.`);
}
