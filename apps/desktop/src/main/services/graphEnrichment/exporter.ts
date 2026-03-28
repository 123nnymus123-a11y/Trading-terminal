import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { GraphEnrichmentRepository } from "./repository";
import type { ExportResult } from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function timestampForFile(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toCsv(rows: unknown[]): string {
  if (!rows.length) return "";
  const recordRows = rows as Array<Record<string, unknown>>;
  const headers = Array.from(
    new Set(recordRows.flatMap((row) => Object.keys(row))),
  );

  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    const asText = typeof value === "string" ? value : JSON.stringify(value);
    const escaped = asText.replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const lines = [headers.join(",")];
  for (const row of recordRows) {
    lines.push(headers.map((header) => escape(row[header])).join(","));
  }
  return lines.join("\n");
}

export function exportGraphEnrichmentSnapshot(): ExportResult {
  const now = nowIso();
  const ts = timestampForFile(now);
  const userData = app.getPath("userData");

  const jsonDir = path.join(userData, "data", "exports", "json");
  const csvDir = path.join(userData, "data", "exports", "csv");
  const snapshotDir = path.join(userData, "data", "snapshots");
  ensureDir(jsonDir);
  ensureDir(csvDir);
  ensureDir(snapshotDir);

  const tables = [
    "graph_enrichment_entity",
    "graph_enrichment_edge",
    "graph_enrichment_alias",
    "graph_enrichment_evidence",
    "graph_enrichment_evidence_link",
    "graph_enrichment_validation_event",
    "graph_enrichment_usage_memory",
    "graph_enrichment_query_history",
    "graph_enrichment_revalidation_queue",
    "graph_enrichment_sync_queue",
  ];

  const payload: Record<string, unknown> = {
    exportedAt: now,
    summary: GraphEnrichmentRepository.getSummary(),
  };

  const csvPaths: string[] = [];
  for (const table of tables) {
    const rows = GraphEnrichmentRepository.getRawTableRows(table, 1000);
    payload[table] = rows;

    if (
      table === "graph_enrichment_entity" ||
      table === "graph_enrichment_edge" ||
      table === "graph_enrichment_evidence"
    ) {
      const csvContent = toCsv(rows);
      const csvPath = path.join(csvDir, `${table}-${ts}.csv`);
      fs.writeFileSync(csvPath, csvContent, "utf8");
      csvPaths.push(csvPath);
    }
  }

  const jsonPath = path.join(jsonDir, `graph-enrichment-snapshot-${ts}.json`);
  const snapshotPath = path.join(snapshotDir, `graph-enrichment-${ts}.json`);
  const jsonBody = JSON.stringify(payload, null, 2);
  fs.writeFileSync(jsonPath, jsonBody, "utf8");
  fs.writeFileSync(snapshotPath, jsonBody, "utf8");

  return {
    jsonPath,
    csvPaths,
    exportedAt: now,
  };
}
