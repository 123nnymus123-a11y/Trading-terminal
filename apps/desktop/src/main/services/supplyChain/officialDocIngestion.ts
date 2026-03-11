import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SupplyChainDocument } from "@tc/shared/supplyChain";
import { SupplyChainGraphRepo } from "../../persistence/supplyChainGraphRepo";

export interface IngestedDoc {
  doc: SupplyChainDocument;
  text: string;
}

function hashText(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseDocDateFromName(name: string): string {
  const match = name.match(/(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  return new Date().toISOString().slice(0, 10);
}

export async function ingestOfficialDocuments(ticker: string): Promise<IngestedDoc[]> {
  const normalized = ticker.trim().toUpperCase();
  const dir = path.join(__dirname, "data", "officialDocs", normalized);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".txt") || name.endsWith(".md"));
  const docs: IngestedDoc[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    const text = fs.readFileSync(filePath, "utf-8");
    const contentHash = hashText(text);
    const docDate = parseDocDateFromName(file);
    const docId = `doc_${hashText(`${normalized}|${file}|${contentHash}`).slice(0, 16)}`;

    const doc: SupplyChainDocument = {
      docId,
      sourceKind: "other_official",
      officialOrigin: "local",
      fetchedAt: new Date().toISOString(),
      docDate,
      contentHash,
      rawContentLocation: filePath,
      parsedTextLocation: filePath,
      tickers: [normalized],
    };

    SupplyChainGraphRepo.insertDocument(doc);
    docs.push({ doc, text });
  }

  return docs;
}
