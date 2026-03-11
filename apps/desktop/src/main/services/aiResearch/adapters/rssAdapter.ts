import { XMLParser } from "fast-xml-parser";
import { IngestAdapter, IngestResult } from "./types";
import { stripHtml, normalizeWhitespace, toIso, extractTickers, sha256, roundToDay } from "../normalize";
import type { AiSourceItem } from "../schemas";

export class RssIngestAdapter implements IngestAdapter {
  name = "rss";

  constructor(private feeds: string[], private watchlistTickers: string[] = []) {}

  async fetch(): Promise<IngestResult> {
    const items: AiSourceItem[] = [];
    const errors: string[] = [];

    for (const feedUrl of this.feeds) {
      try {
        const res = await fetch(feedUrl, {
          headers: {
            "User-Agent": "TradingCockpitAIResearch/1.0 (support@tradingcockpit.dev)",
            "Accept": "application/rss+xml, application/atom+xml, application/xml",
          },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const xml = await res.text();
        const parsed = parseFeed(xml);
        for (const entry of parsed) {
          const publishedAt = toIso(entry.publishedAt);
          const rawText = normalizeWhitespace(stripHtml(entry.content ?? ""));
          const title = normalizeWhitespace(stripHtml(entry.title ?? ""));
          if (!title || !entry.url) continue;

          const tickers = extractTickers(`${title} ${rawText}`, this.watchlistTickers);
          const id = sha256(`${title}|${entry.url}|${roundToDay(publishedAt)}`);

          items.push({
            id,
            source: `rss:${feedUrl}`,
            url: entry.url,
            title,
            publishedAt,
            rawText: rawText || title,
            tickers,
            ingestedAt: new Date().toISOString(),
          });
        }
      } catch (err) {
        errors.push(`[rss] ${feedUrl} ${String(err)}`);
      }
    }

    return { items, errors };
  }
}

function parseFeed(xml: string): Array<{ title: string; url: string; publishedAt?: string; content?: string }> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const doc = parser.parse(xml) as Record<string, unknown>;

  const feed = getRecord(doc, "feed");
  const feedEntry = feed ? feed["entry"] : undefined;
  if (feedEntry) {
    const entries = toArray(feedEntry);
    return entries.map((entry) => {
      const entryRec = asRecord(entry);
      const linkRaw = entryRec ? entryRec["link"] : undefined;
      const linkRec = asRecord(Array.isArray(linkRaw) ? linkRaw[0] : linkRaw);
      const href = (linkRec && (getString(linkRec, "@_href") ?? getString(linkRec, "href"))) ?? "";
      return {
        title: getText(entryRec?.["title"]),
        url: href,
        publishedAt: getText(entryRec?.["updated"]) || getText(entryRec?.["published"]) || getText(entryRec?.["created"]),
        content: getText(entryRec?.["summary"]) || getText(entryRec?.["content"]),
      };
    });
  }

  const rss = getRecord(doc, "rss");
  const channel = rss ? getRecord(rss, "channel") : getRecord(doc, "channel");
  const items = channel ? channel["item"] : [];
  const arr = toArray(items);
  return arr.map((item) => {
    const itemRec = asRecord(item);
    return {
      title: getText(itemRec?.["title"]),
      url: getText(itemRec?.["link"]),
      publishedAt: getText(itemRec?.["pubDate"]) || getText(itemRec?.["updated"]) || getText(itemRec?.["published"]),
      content: getText(itemRec?.["description"]) || getText(itemRec?.["content:encoded"]),
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
