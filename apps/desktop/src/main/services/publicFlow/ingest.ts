import type { InsertDisclosureEvent } from "@tc/shared";
import { PublicFlowRepo } from "../../persistence/publicFlowRepo";
import { SeedConnector } from "./connectors/seedConnector";
import { LocalImportConnector } from "./connectors/localImportConnector";
import { LiveDisclosureConnector } from "./connectors/liveDisclosureConnector";
import type { ConnectorSummary, DisclosureConnector } from "./connectors/types";
import { enrichEvents } from "./enrichment";

interface IngestResult {
  summaries: ConnectorSummary[];
  totals: {
    fetched: number;
    parsed: number;
    inserted: number;
    skipped: number;
  };
  errors: string[];
}

function buildKey(e: Pick<InsertDisclosureEvent, "source" | "entity_name" | "ticker" | "action" | "tx_date" | "report_date">): string {
  return [e.source, e.entity_name, e.ticker ?? "NULL", e.action, e.tx_date, e.report_date].join("|");
}

export async function ingestAll(sinceISO: string): Promise<IngestResult> {
  const enableLive = (process.env.PUBLIC_FLOW_DISCLOSURE_MODE ?? "").toLowerCase() === "live" || !!process.env.PUBLIC_FLOW_DISCLOSURE_ENDPOINT;
  const connectors: DisclosureConnector[] = [new SeedConnector(), new LocalImportConnector()];
  if (enableLive) connectors.unshift(new LiveDisclosureConnector());
  const summaries: ConnectorSummary[] = [];
  const errors: string[] = [];

  const existingKeys = new Set(
    PublicFlowRepo.getDisclosureEventKeys(sinceISO).map((k) => buildKey(k))
  );

  const pendingInsert: InsertDisclosureEvent[] = [];
  const perConnectorInsert: InsertDisclosureEvent[][] = [];

  for (const connector of connectors) {
    const result = await connector.fetchNew(sinceISO);
    const enrichedFromConnector = enrichEvents(result.events as any) as InsertDisclosureEvent[];
    const connectorEvents: InsertDisclosureEvent[] = [];
    let skipped = 0;

    for (const evt of enrichedFromConnector) {
      const key = buildKey(evt);
      if (existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      connectorEvents.push(evt);
    }

    pendingInsert.push(...connectorEvents);
    perConnectorInsert.push(connectorEvents);

    const summary: ConnectorSummary = {
      ...result.summary,
      skippedCount: skipped,
      insertedCount: 0, // fill after DB insert
    };

    summaries.push(summary);
    if (result.summary.errors.length) errors.push(...result.summary.errors);
  }

  let insertedIds: number[] = [];
  if (pendingInsert.length > 0) {
    insertedIds = PublicFlowRepo.insertDisclosureEvents(pendingInsert);
  }

  // attribute inserted counts back to connector summaries
  summaries.forEach((summary, idx) => {
    const count = perConnectorInsert[idx]?.length ?? 0;
    summary.insertedCount = count;
  });

  const totals = {
    fetched: summaries.reduce((acc, s) => acc + s.fetchedCount, 0),
    parsed: summaries.reduce((acc, s) => acc + s.parsedCount, 0),
    inserted: insertedIds.length,
    skipped: summaries.reduce((acc, s) => acc + s.skippedCount, 0),
  };

  return { summaries, totals, errors };
}
