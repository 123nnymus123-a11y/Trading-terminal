import { IngestAdapter, IngestResult } from "./types";
import { normalizeWhitespace, stripHtml, extractTickers, sha256, roundToDay, toIso } from "../normalize";
import type { AiSourceItem } from "../schemas";

export class ManualPasteAdapter implements IngestAdapter {
  name = "manual";

  constructor(private payloads: Array<{ title: string; text: string }>, private watchlistTickers: string[] = []) {}

  async fetch(): Promise<IngestResult> {
    const items: AiSourceItem[] = [];
    const errors: string[] = [];

    for (const payload of this.payloads) {
      try {
        const title = normalizeWhitespace(stripHtml(payload.title ?? ""));
        const rawText = normalizeWhitespace(stripHtml(payload.text ?? ""));
        if (!title && !rawText) continue;
        const publishedAt = toIso(new Date());
        const tickers = extractTickers(`${title} ${rawText}`, this.watchlistTickers);
        const id = sha256(`${title}|manual|${roundToDay(publishedAt)}`);

        items.push({
          id,
          source: "manual",
          url: "manual://paste",
          title: title || "Manual input",
          publishedAt,
          rawText: rawText || title,
          tickers,
          ingestedAt: new Date().toISOString(),
        });
      } catch (err) {
        errors.push(`[manual] ${String(err)}`);
      }
    }

    return { items, errors };
  }
}
