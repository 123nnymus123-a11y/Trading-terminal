import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import type { PositioningSeries } from "../types";

const CFTC_LIVE = "https://www.cftc.gov/dea/newcot/f_disagg.txt";

export type CftcRow = {
  marketCode: string;
  marketName: string;
  asOf: string;
  producerLong: number;
  producerShort: number;
  swapLong: number;
  swapShort: number;
  managedLong: number;
  managedShort: number;
  otherLong: number;
  otherShort: number;
  nonReportableLong: number;
  nonReportableShort: number;
};

export type CftcMapping = Map<string, string>; // symbol -> marketCode

export async function loadCftcText(samplePath?: string): Promise<string> {
  if (samplePath && fs.existsSync(samplePath)) {
    const ext = path.extname(samplePath).toLowerCase();
    if (ext === ".zip") {
      const zip = new AdmZip(samplePath);
      const entry = zip.getEntries().find((e) => e.entryName.toLowerCase().endsWith(".txt")) ?? zip.getEntries()[0];
      if (!entry) throw new Error("CFTC zip has no entries");
      return entry.getData().toString("utf8");
    }
    return fs.readFileSync(samplePath, "utf8");
  }

  const res = await fetch(CFTC_LIVE);
  if (!res.ok) throw new Error(`CFTC HTTP ${res.status}`);
  return await res.text();
}

export function parseCftcDisaggCsv(text: string): CftcRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const rows = lines.map(parseCsvLine);
  const header = rows[0];
  if (!header || header.length < 5) return [];

  const idx = (name: string) => header.findIndex((h) => h === name);
  const required = [
    "Market_and_Exchange_Names",
    "As_of_Date_In_Form_YYMMDD",
    "CFTC_Contract_Market_Code",
    "Prod_Merc_Positions_Long_All",
    "Prod_Merc_Positions_Short_All",
    "Swap_Positions_Long_All",
    "Swap_Positions_Short_All",
    "M_Money_Positions_Long_All",
    "M_Money_Positions_Short_All",
    "Other_Rept_Positions_Long_All",
    "Other_Rept_Positions_Short_All",
    "NonRept_Positions_Long_All",
    "NonRept_Positions_Short_All",
  ];

  const missing = required.filter((r) => idx(r) === -1);
  if (missing.length) {
    throw new Error(`CFTC header missing fields: ${missing.join(", ")}`);
  }

  return rows.slice(1).map((row) => {
    const marketName = row[idx("Market_and_Exchange_Names")] ?? "";
    const marketCode = row[idx("CFTC_Contract_Market_Code")] ?? "";
    const asOf = row[idx("As_of_Date_In_Form_YYMMDD")] ?? "";
    const n = (value: string) => Number(value || 0);

    return {
      marketCode,
      marketName,
      asOf: normalizeCftcDate(asOf),
      producerLong: n(row[idx("Prod_Merc_Positions_Long_All")]),
      producerShort: n(row[idx("Prod_Merc_Positions_Short_All")]),
      swapLong: n(row[idx("Swap_Positions_Long_All")]),
      swapShort: n(row[idx("Swap_Positions_Short_All")]),
      managedLong: n(row[idx("M_Money_Positions_Long_All")]),
      managedShort: n(row[idx("M_Money_Positions_Short_All")]),
      otherLong: n(row[idx("Other_Rept_Positions_Long_All")]),
      otherShort: n(row[idx("Other_Rept_Positions_Short_All")]),
      nonReportableLong: n(row[idx("NonRept_Positions_Long_All")]),
      nonReportableShort: n(row[idx("NonRept_Positions_Short_All")]),
    } satisfies CftcRow;
  });
}

export async function loadCotMapping(mappingPath?: string): Promise<CftcMapping> {
  const mapping: CftcMapping = new Map();
  if (!mappingPath || !fs.existsSync(mappingPath)) return mapping;
  const text = fs.readFileSync(mappingPath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return mapping;
  const rows = lines.map(parseCsvLine);
  const header = rows[0];
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const symIdx = col("symbol") >= 0 ? col("symbol") : 0;
  const codeIdx = col("marketCode") >= 0 ? col("marketCode") : 1;

  rows.slice(1).forEach((row) => {
    const symbol = (row[symIdx] ?? "").trim().toUpperCase();
    const code = (row[codeIdx] ?? "").trim();
    if (symbol && code) mapping.set(symbol, code);
  });
  return mapping;
}

export async function buildPositioningSeries(params: {
  mapping: CftcMapping;
  samplePath?: string;
}): Promise<PositioningSeries[]> {
  const text = await loadCftcText(params.samplePath);
  const rows = parseCftcDisaggCsv(text);
  if (rows.length === 0) return [];

  const byMarket = new Map<string, CftcRow[]>();
  rows.forEach((row) => {
    if (!row.marketCode) return;
    const list = byMarket.get(row.marketCode) ?? [];
    list.push(row);
    byMarket.set(row.marketCode, list);
  });

  const series: PositioningSeries[] = [];
  for (const [symbol, marketCode] of params.mapping.entries()) {
    const list = (byMarket.get(marketCode) ?? []).sort((a, b) => a.asOf.localeCompare(b.asOf));
    if (list.length === 0) continue;

    const last = list[list.length - 1];
    const lastNet = last.managedLong - last.managedShort;
    const delta4w = list.length >= 5 ? lastNet - (list[list.length - 5].managedLong - list[list.length - 5].managedShort) : 0;
    const historyNet = list.map((r) => r.managedLong - r.managedShort);
    const percentile = historyNet.length ? percentileRank(historyNet, lastNet) : undefined;

    series.push({
      symbol,
      marketCode,
      asOfDate: last.asOf,
      net: lastNet,
      delta4w,
      percentile,
      categories: {
        producer: { long: last.producerLong, short: last.producerShort, net: last.producerLong - last.producerShort },
        swap: { long: last.swapLong, short: last.swapShort, net: last.swapLong - last.swapShort },
        managedMoney: { long: last.managedLong, short: last.managedShort, net: lastNet },
        other: { long: last.otherLong, short: last.otherShort, net: last.otherLong - last.otherShort },
        nonReportable: {
          long: last.nonReportableLong,
          short: last.nonReportableShort,
          net: last.nonReportableLong - last.nonReportableShort,
        },
      },
    });
  }

  return series;
}

function normalizeCftcDate(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 8) {
    const year = trimmed.slice(0, 4);
    const month = trimmed.slice(4, 6);
    const day = trimmed.slice(6, 8);
    return `${year}-${month}-${day}`;
  }
  return trimmed;
}

function percentileRank(values: number[], value: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return 100;
  const idx = sorted.findIndex((v) => v >= value);
  const rank = idx === -1 ? sorted.length - 1 : idx;
  return Math.round((rank / (sorted.length - 1)) * 100);
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
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
  return result;
}
