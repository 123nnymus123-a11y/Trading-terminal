import { IngestAdapter, IngestResult } from "./types";
import { stripHtml, normalizeWhitespace, toIso, extractTickers, sha256, roundToDay } from "../normalize";
import type { AiSourceItem } from "../schemas";
import { XMLParser } from "fast-xml-parser";

const SEC_BASE = "https://www.sec.gov/cgi-bin/browse-edgar";

export class SecEdgarAdapter implements IngestAdapter {
  name = "sec";

  constructor(private forms: string[] = ["8-K"], private watchlistTickers: string[] = []) {}

  async fetch(): Promise<IngestResult> {
    const items: AiSourceItem[] = [];
    const errors: string[] = [];

    for (const form of this.forms) {
      const url = `${SEC_BASE}?action=getcurrent&CIK=&type=${encodeURIComponent(form)}&owner=include&count=100&output=atom`;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "TradingCockpitAIResearch/1.0 (support@tradingcockpit.dev)",
            "Accept": "application/atom+xml, application/xml",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const parsed = parseSecAtom(xml);
        for (const entry of parsed) {
          const publishedAt = toIso(entry.publishedAt);
          const title = normalizeWhitespace(stripHtml(entry.title ?? ""));
          const rawText = normalizeWhitespace(stripHtml(entry.summary ?? "")) || title;
          if (!title || !entry.url) continue;

          const tickers = extractTickers(`${title} ${rawText}`, this.watchlistTickers);
          const id = sha256(`${title}|${entry.url}|${roundToDay(publishedAt)}`);

          items.push({
            id,
            source: `sec:${form}`,
            url: entry.url,
            title,
            publishedAt,
            rawText,
            tickers,
            ingestedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        errors.push(`[sec] ${form} ${String(err)}`);
      }
    }

    return { items, errors };
  }
}

function parseSecAtom(xml: string): Array<{ title: string; url: string; publishedAt?: string; summary?: string }> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const doc = parser.parse(xml) as Record<string, unknown>;
  const feed = getRecord(doc, "feed");
  const entries = feed ? feed["entry"] : [];
  const arr = toArray(entries);
  return arr.map((entry) => {
    const entryRec = asRecord(entry);
    const linkRaw = entryRec ? entryRec["link"] : undefined;
    const linkRec = asRecord(Array.isArray(linkRaw) ? linkRaw[0] : linkRaw);
    const href = (linkRec && (getString(linkRec, "@_href") ?? getString(linkRec, "href"))) ?? "";
    return {
      title: getText(entryRec?.["title"]),
      url: href,
      publishedAt: getText(entryRec?.["updated"]) || getText(entryRec?.["published"]),
      summary: getText(entryRec?.["summary"]),
    };
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function getRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const val = obj[key];
  return asRecord(val);
}

function getString(obj: Record<string, unknown>, key: string): string | null {
  const val = obj[key];
  return typeof val === "string" ? val : null;
}

function getText(value: unknown): string {
  if (typeof value === "string") return value;
  const rec = asRecord(value);
  if (!rec) return "";
  const text = rec["#text"];
  return typeof text === "string" ? text : "";
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}
