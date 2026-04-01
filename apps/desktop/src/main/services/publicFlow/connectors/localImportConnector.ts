import fs from "node:fs";
import path from "node:path";
import type { InsertDisclosureEvent } from "@tc/shared";
import { normalizeEvent, parseAmountRange, normalizeAction } from "../normalization";
import type { ConnectorFetchResult, ConnectorSummary, DisclosureConnector } from "./types";

const IMPORT_RELATIVE = ["data", "import"];
const PROCESSED = "processed";
const FAILED = "failed";

function resolveImportDir(): string {
  const buildPath = path.join(__dirname, "..", ...IMPORT_RELATIVE);
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
    ...IMPORT_RELATIVE
  );
  return fs.existsSync(buildPath) ? buildPath : sourcePath;
}

function ensureFolders(base: string): void {
  const processedDir = path.join(base, PROCESSED);
  const failedDir = path.join(base, FAILED);
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  if (!fs.existsSync(processedDir)) fs.mkdirSync(processedDir, { recursive: true });
  if (!fs.existsSync(failedDir)) fs.mkdirSync(failedDir, { recursive: true });
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result.map((v) => v.trim());
}

function parseCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headerLine = lines[0]!;
  const headers = splitCsvLine(headerLine).map((h) => h.toLowerCase());
  const records: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const values = splitCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      record[h] = values[idx] ?? "";
    });
    records.push(record);
  }
  return records;
}

function isCongressStyle(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase());
  return lower.includes("member") && lower.some((h) => h.includes("transaction_date")) && lower.some((h) => h.includes("disclosure_date"));
}

function processGenericRecord(record: Record<string, string>): InsertDisclosureEvent {
  const amountMin = record["amount_min"] ?? record["amount"] ?? undefined;
  const amountMax = record["amount_max"] ?? record["amount"] ?? undefined;
  const normalized = normalizeEvent({
    source: record["source"] ?? "LocalImport",
    source_url: record["source_url"] ?? null,
    entity_name: record["entity_name"] ?? record["entity"] ?? "Unknown Entity",
    entity_type: (record["entity_type"] as InsertDisclosureEvent["entity_type"]) ?? "institution",
    owner_type: (record["owner_type"] as InsertDisclosureEvent["owner_type"]) ?? "institutional",
    ticker: record["ticker"] ?? null,
    asset_name: record["asset_name"] ?? record["entity_name"] ?? "Unknown Asset",
    action: record["action"] ?? "BUY",
    tx_date: record["tx_date"] ?? record["transaction_date"] ?? new Date().toISOString(),
    report_date: record["report_date"] ?? record["disclosure_date"] ?? new Date().toISOString(),
    amount_min: amountMin ? parseAmountRange(amountMin).min : null,
    amount_max: amountMax ? parseAmountRange(amountMax).max : null,
    sector: record["sector"] ?? null,
    industry: record["industry"] ?? null,
    confidence: record["confidence"] ? Number(record["confidence"]) : 0.65,
  } as any);

  return normalized;
}

function processCongressRecord(record: Record<string, string>): InsertDisclosureEvent {
  const amount = record["amount"] ?? record["amounts"] ?? record["range"] ?? "";
  const parsedAmount = parseAmountRange(amount);
  const action = normalizeAction(record["type"] ?? record["action"] ?? "BUY");

  return normalizeEvent({
    source: "Congress",
    source_url: record["source_url"] ?? null,
    entity_name: record["member"] ?? "Unknown Member",
    entity_type: "insider",
    owner_type: "insider",
    ticker: record["ticker"] ?? record["asset"] ?? null,
    asset_name: record["asset"] ?? record["ticker"] ?? record["member"] ?? "Unknown Asset",
    action,
    tx_date: record["transaction_date"] ?? record["tx_date"] ?? new Date().toISOString(),
    report_date: record["disclosure_date"] ?? record["report_date"] ?? new Date().toISOString(),
    amount_min: parsedAmount.min,
    amount_max: parsedAmount.max,
    sector: record["sector"] ?? null,
    industry: record["industry"] ?? null,
    confidence: 0.55,
  } as any);
}

export class LocalImportConnector implements DisclosureConnector {
  id = "local-import";
  kind = "local" as const;

  async fetchNew(_sinceISO: string): Promise<ConnectorFetchResult> {
    const baseDir = resolveImportDir();
    ensureFolders(baseDir);

    const entries = fs
      .readdirSync(baseDir)
      .filter((f) => ![PROCESSED, FAILED].includes(f))
      .filter((f) => f.toLowerCase().endsWith(".json") || f.toLowerCase().endsWith(".csv"));

    const allEvents: InsertDisclosureEvent[] = [];
    const errors: string[] = [];
    let fetchedCount = 0;

    for (const file of entries) {
      const fullPath = path.join(baseDir, file);
      const ext = path.extname(file).toLowerCase();
      const fileErrors: string[] = [];
      let events: InsertDisclosureEvent[] = [];

      try {
        if (ext === ".json") {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const parsed = JSON.parse(raw) as unknown[];
          fetchedCount += parsed.length;
          events = parsed.map((p) => normalizeEvent(p as any));
        } else if (ext === ".csv") {
          const raw = fs.readFileSync(fullPath, "utf-8");
          const records = parseCsv(raw);
          fetchedCount += records.length;
          if (records.length > 0) {
            const headers = Object.keys(records[0]!);
            const congress = isCongressStyle(headers);
            events = records.map((r) => (congress ? processCongressRecord(r) : processGenericRecord(r)));
          }
        }
      } catch (err) {
        fileErrors.push(`Failed to process ${file}: ${(err as Error).message}`);
      }

      if (fileErrors.length === 0) {
        allEvents.push(...events);
        this.moveFile(fullPath, path.join(baseDir, PROCESSED, file));
      } else {
        errors.push(...fileErrors);
        this.moveFile(fullPath, path.join(baseDir, FAILED, file));
        const logPath = path.join(baseDir, FAILED, `${file}.log`);
        fs.writeFileSync(logPath, fileErrors.join("\n"));
      }
    }

    const summary: ConnectorSummary = {
      id: this.id,
      kind: this.kind,
      fetchedCount,
      parsedCount: allEvents.length,
      insertedCount: 0,
      skippedCount: 0,
      errors,
    };

    return { events: allEvents, summary };
  }

  private moveFile(from: string, to: string): void {
    try {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
    } catch (err) {
      // fallback copy + unlink if rename fails across devices
      fs.copyFileSync(from, to);
      fs.unlinkSync(from);
    }
  }
}
