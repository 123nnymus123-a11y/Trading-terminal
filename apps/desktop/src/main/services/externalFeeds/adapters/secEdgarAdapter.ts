import { XMLParser } from "fast-xml-parser";
import type { EventStreamItem } from "../types";
import fs from "node:fs";

const SEC_ATOM = "https://www.sec.gov/cgi-bin/browse-edgar";

export async function fetchSecEvents(params: {
  forms: Array<"4" | "8-K">;
  userAgent: string;
  cikMappingPath?: string;
  limit?: number;
  tickers?: string[];
}): Promise<EventStreamItem[]> {
  const mapping = loadCikMapping(params.cikMappingPath);
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const events: EventStreamItem[] = [];

  for (const form of params.forms) {
    const url = `${SEC_ATOM}?action=getcurrent&CIK=&type=${encodeURIComponent(form)}&owner=include&count=100&output=atom`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": params.userAgent,
        Accept: "application/atom+xml, application/xml",
      },
    });
    if (!res.ok) {
      console.warn(`[SEC] fetch failed for ${form}: status=${res.status} ua=${params.userAgent}`);
      continue;
    }
    const xml = await res.text();
    const doc = parser.parse(xml) as any;
    const feed = doc?.feed;
    const entries = toArray(feed?.entry);

    for (const entry of entries) {
      const link = toArray(entry?.link)?.[0];
      const href = link?.["@_href"] ?? link?.href ?? "";
      if (!href) continue;

      const cik = extractCik(href) ?? "";
      const ticker = cik ? mapping.get(cik) : undefined;

      if (params.tickers && params.tickers.length) {
        if (!ticker || !params.tickers.includes(ticker)) continue;
      }

      const title = textValue(entry?.title) || "SEC Filing";
      const filedAt = textValue(entry?.updated) || textValue(entry?.published) || new Date().toISOString();

      events.push({
        source: "SEC",
        type: form === "4" ? "FORM4" : "8K",
        cik,
        ticker,
        filedAt,
        title,
        url: href,
        summaryFields: {
          form,
          company: title,
        },
      });
    }
  }

  const sorted = events.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
  return typeof params.limit === "number" ? sorted.slice(0, params.limit) : sorted;
}

function loadCikMapping(mappingPath?: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!mappingPath || !fs.existsSync(mappingPath)) return map;
  const text = fs.readFileSync(mappingPath, "utf8");
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return map;
  const header = parseCsvLine(lines[0]);
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const tickerIdx = col("ticker") >= 0 ? col("ticker") : 0;
  const cikIdx = col("cik") >= 0 ? col("cik") : 1;
  lines.slice(1).forEach((line) => {
    const row = parseCsvLine(line);
    const ticker = (row[tickerIdx] ?? "").trim().toUpperCase();
    const cik = (row[cikIdx] ?? "").trim().replace(/^0+/, "");
    if (ticker && cik) map.set(cik, ticker);
  });
  return map;
}

function extractCik(url: string): string | null {
  const match = url.match(/\/data\/(\d+)/i);
  if (!match) return null;
  return match[1].replace(/^0+/, "");
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: any): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value["#text"] === "string") return value["#text"];
  return "";
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
