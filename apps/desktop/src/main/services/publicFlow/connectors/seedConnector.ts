import fs from "node:fs";
import path from "node:path";
import type { InsertDisclosureEvent } from "@tc/shared";
import { normalizeEvent } from "../normalization";
import type { ConnectorFetchResult, DisclosureConnector } from "./types";

function resolveSeedPath(): string | null {
  const buildPath = path.join(__dirname, "..", "data", "seed_events.json");
  const sourcePath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "src",
    "main",
    "services",
    "publicFlow",
    "data",
    "seed_events.json"
  );

  if (fs.existsSync(buildPath)) return buildPath;
  if (fs.existsSync(sourcePath)) return sourcePath;
  return null;
}

export class SeedConnector implements DisclosureConnector {
  id = "seed";
  kind = "seed" as const;

  async fetchNew(sinceISO: string): Promise<ConnectorFetchResult> {
    const errors: string[] = [];
    const seedPath = resolveSeedPath();
    if (!seedPath) {
      errors.push("seed_events.json not found");
      return {
        events: [],
        summary: {
          id: this.id,
          kind: this.kind,
          fetchedCount: 0,
          parsedCount: 0,
          insertedCount: 0,
          skippedCount: 0,
          errors,
        },
      };
    }

    const raw = fs.readFileSync(seedPath, "utf-8");
    let parsed: unknown[] = [];
    try {
      parsed = JSON.parse(raw) as unknown[];
    } catch (err) {
      errors.push(`Failed to parse seed file: ${(err as Error).message}`);
    }

    const events: InsertDisclosureEvent[] = [];
    for (const item of parsed) {
      try {
        const normalized = normalizeEvent(item as any);
        if (!sinceISO || normalized.report_date >= sinceISO) {
          events.push(normalized);
        }
      } catch (err) {
        errors.push(`Normalization error: ${(err as Error).message}`);
      }
    }

    return {
      events,
      summary: {
        id: this.id,
        kind: this.kind,
        fetchedCount: parsed.length,
        parsedCount: events.length,
        insertedCount: 0,
        skippedCount: 0,
        errors,
      },
    };
  }
}
