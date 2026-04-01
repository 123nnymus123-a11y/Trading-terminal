import type { InsertDisclosureEvent } from "@tc/shared";

export type ConnectorKind = "seed" | "local" | "congress" | "institution" | "insider" | "live";

export interface ConnectorSummary {
  id: string;
  kind: ConnectorKind;
  fetchedCount: number;
  parsedCount: number;
  insertedCount: number;
  skippedCount: number;
  errors: string[];
}

export interface ConnectorFetchResult {
  events: InsertDisclosureEvent[];
  summary: ConnectorSummary;
}

export interface DisclosureConnector {
  id: string;
  kind: ConnectorKind;
  fetchNew(sinceISO: string): Promise<ConnectorFetchResult>;
}
