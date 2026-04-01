/**
 * Verification script for valuation tags (Chunk 4)
 * 
 * This script demonstrates the valuation tagging functionality:
 * 1. Lists all supported tickers from seed data
 * 2. Computes valuation tags for sample tickers
 * 3. Displays tag results with basis explanations
 */

import { getValuationTags, getSupportedTickers } from "./getValuations";

async function main() {
  console.log("\n=== Valuation Tags Verification (Chunk 4) ===\n");

  // 1. Show all supported tickers
  const supported = getSupportedTickers();
  console.log(`Supported tickers (${supported.length} total):`);
  console.log(supported.join(", "));
  console.log();

  // 2. Test valuation tags for diverse sample
  const sampleTickers = ["AAPL", "NVDA", "TSLA", "JPM", "BA"];
  console.log(`Computing valuation tags for: ${sampleTickers.join(", ")}\n`);

  const tags = await getValuationTags(sampleTickers);

  // 3. Display results
  for (const ticker of sampleTickers) {
    const tag = tags[ticker];
    if (tag) {
      console.log(`${ticker}:`);
      console.log(`  Tag: ${tag.tag.toUpperCase()}`);
      console.log(`  Confidence: ${(tag.confidence * 100).toFixed(0)}%`);
      console.log(`  Basis:`);
      tag.basis.forEach((b) => console.log(`    - ${b}`));
      console.log(`  Updated: ${new Date(tag.updated_at).toISOString()}`);
      console.log();
    } else {
      console.log(`${ticker}: No data available\n`);
    }
  }

  // 4. Test caching (second call should be instant)
  console.log("Testing cache (second call)...");
  const start = Date.now();
  const cachedTags = await getValuationTags(sampleTickers);
  const elapsed = Date.now() - start;
  console.log(`Retrieved ${Object.keys(cachedTags).length} tags in ${elapsed}ms (cached)\n`);

  console.log("=== Verification Complete ===\n");
}

main().catch(console.error);
