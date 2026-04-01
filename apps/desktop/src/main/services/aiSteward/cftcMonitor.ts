import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { parseCftcDisaggCsv, type CftcRow } from "../externalFeeds/adapters/cftcCotAdapter";

const CFTC_LIVE_URL = "https://www.cftc.gov/dea/newcot/f_disagg.txt";

export interface CftcDatasetStats {
  lastDate?: string;
  rowCount: number;
  marketCount: number;
}

export interface LocalCftcSnapshot extends CftcDatasetStats {
  sourcePath: string;
  lastModified?: number;
}

export interface RemoteCftcSnapshot extends CftcDatasetStats {
  fetchedAt: number;
  rawText: string;
}

export async function getLocalCftcSnapshot(samplePath?: string): Promise<LocalCftcSnapshot | null> {
  if (!samplePath) return null;
  if (!fs.existsSync(samplePath)) return null;

  const text = await readSample(samplePath);
  const stats = deriveStats(text);
  if (!stats) return null;

  const info = fs.statSync(samplePath);
  return {
    ...stats,
    sourcePath: samplePath,
    lastModified: info.mtimeMs,
  };
}

export async function getRemoteCftcSnapshot(): Promise<RemoteCftcSnapshot> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(CFTC_LIVE_URL, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "TradingCockpit/AI-Steward (+https://github.com)"
      }
    });
    if (!res.ok) {
      throw new Error(`CFTC HTTP ${res.status}`);
    }
    const rawText = await res.text();
    const stats = deriveStats(rawText);
    if (!stats) {
      throw new Error("CFTC payload parsed with zero rows");
    }
    return {
      ...stats,
      rawText,
      fetchedAt: Date.now(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function describeDelta(local?: CftcDatasetStats | null, remote?: CftcDatasetStats | null): string {
  if (!remote && !local) return "No CFTC data available";
  if (!local && remote) {
    return `Remote dataset is ${remote.rowCount} rows across ${remote.marketCount} markets (as of ${remote.lastDate ?? "unknown"}).`;
  }
    if (!remote && local) return `Local dataset ends on ${local.lastDate ?? "unknown"} with ${local.marketCount} markets.`;
    if (!local || !remote) return "Insufficient data";
  if (!local.lastDate || !remote.lastDate) {
    return `Local rows=${local.rowCount}, Remote rows=${remote.rowCount}.`;
  }
  const diff = daysBetween(local.lastDate, remote.lastDate);
  if (diff === 0) {
    return `Local dataset is current (${local.lastDate}).`;
  }
  const aheadText = diff > 0 ? `${diff} days behind` : `${Math.abs(diff)} days ahead`;
  return `Local dataset (${local.lastDate}) is ${aheadText} remote (${remote.lastDate}).`;
}

function deriveStats(text: string): CftcDatasetStats | null {
  const rows = parseCftcDisaggCsv(text);
  if (!rows.length) return null;
  let lastDate = "";
  const markets = new Set<string>();
  for (const row of rows) {
    if (row.asOf && row.asOf > lastDate) {
      lastDate = row.asOf;
    }
    if (row.marketCode) {
      markets.add(row.marketCode);
    }
  }
  return {
    lastDate: lastDate || undefined,
    rowCount: rows.length,
    marketCount: markets.size,
  };
}

async function readSample(samplePath: string): Promise<string> {
  const ext = path.extname(samplePath).toLowerCase();
  if (ext === ".zip") {
    const zip = new AdmZip(samplePath);
    const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".txt")) ?? zip.getEntries()[0];
    if (!entry) {
      throw new Error("CFTC sample zip does not contain any txt entries");
    }
    return entry.getData().toString("utf8");
  }
  return fs.readFileSync(samplePath, "utf8");
}

function daysBetween(local: string, remote: string): number {
  const a = Date.parse(local);
  const b = Date.parse(remote);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  const diff = Math.floor((b - a) / (24 * 60 * 60 * 1000));
  return diff;
}
