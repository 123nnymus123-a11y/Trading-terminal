import { parentPort } from "node:worker_threads";
import { z } from "zod";
import { AiBriefSchema, AiConfigSchema } from "../services/aiResearch/schemas";
import { RssIngestAdapter } from "../services/aiResearch/adapters/rssAdapter";
import { SecEdgarAdapter } from "../services/aiResearch/adapters/secEdgarAdapter";
import { ManualPasteAdapter } from "../services/aiResearch/adapters/manualPasteAdapter";
import type { IngestAdapter } from "../services/aiResearch/adapters/types";
import { canonicalizeText, sha256, roundToDay } from "../services/aiResearch/normalize";
import { tokenize, jaccardSimilarity } from "../services/aiResearch/dedupe";
import { generateBriefsWithOllama } from "../services/aiResearch/llm/ollama";

const WorkerRequestSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  payload: z.unknown().optional(),
});

const RunPayloadSchema = z.object({
  runId: z.string().min(1),
  config: AiConfigSchema,
  existingItems: z.array(
    z.object({
      id: z.string().min(1),
      canonicalHash: z.string().min(1),
      canonicalText: z.string().min(1),
      publishedAt: z.string().min(1),
    })
  ),
  existingClusters: z.array(
    z.object({
      clusterId: z.string().min(1),
      representativeItemId: z.string().min(1),
      canonicalText: z.string().min(1),
      updatedAt: z.string().min(1),
      publishedAt: z.string().min(1),
      rawLength: z.number().int().nonnegative(),
    })
  ),
  manualItems: z.array(z.object({ title: z.string().min(1), text: z.string().min(1) })).default([]),
});

type RunPayload = z.infer<typeof RunPayloadSchema>;

type WorkerResponse = {
  id: string;
  type: string;
  ok: boolean;
  payload?: unknown;
  error?: string;
};

const SIM_THRESHOLD = 0.85;

function respond(res: WorkerResponse) {
  parentPort?.postMessage(res);
}

function buildSystemPrompt(): string {
  return [
    "You are a local research assistant for trading.",
    "Use ONLY provided items, do not hallucinate.",
    "Return ONLY valid JSON array. No markdown, no prose.",
    "All fields must match schema exactly.",
    "If uncertain, lower confidence.",
  ].join(" ");
}

function buildUserPrompt(
  items: Array<{ title: string; url: string; publishedAt: string; source: string; rawText: string; tickers: string[] }>,
  focusPrompt?: string
): string {
  return JSON.stringify({
    instruction: "Generate up to 5 briefs sorted by trading usefulness. Output JSON array only.",
    focusPrompt: focusPrompt?.trim() ? focusPrompt.trim() : undefined,
    items,
    schema: {
      id: "string",
      createdAt: "ISO string",
      headline: "string",
      summaryBullets: "string[] (3-6)",
      tickers: "string[]",
      whyItMatters: "string[] (2-4)",
      whatToWatch: "string[] (2-4)",
      impactScore: "0-100",
      confidence: "0-100",
      sources: "[{title,url,source,publishedAt}]",
    },
  });
}

function filterItemsByFocus(
  items: Array<{ title: string; url: string; publishedAt: string; source: string; rawText: string; tickers: string[] }>,
  focusPrompt?: string
): Array<{ title: string; url: string; publishedAt: string; source: string; rawText: string; tickers: string[] }> {
  if (!focusPrompt?.trim()) return items;
  const keywords = focusPrompt
    .toLowerCase()
    .split(/[^a-z0-9$]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 || w.startsWith("$"));
  if (keywords.length === 0) return items;

  const filtered = items.filter((item) => {
    const hay = `${item.title} ${item.rawText}`.toLowerCase();
    return keywords.some((kw) => hay.includes(kw.replace(/^\$/, "")));
  });

  return filtered.length ? filtered : items;
}

function applyDeterministicScoring(
  brief: z.infer<typeof AiBriefSchema>,
  sources: Array<{ title: string; source: string; publishedAt: string; url: string }>,
  watchlistTickers: string[]
): z.infer<typeof AiBriefSchema> {
  const text = [brief.headline, ...brief.summaryBullets, ...brief.whyItMatters, ...brief.whatToWatch]
    .join(" ")
    .toLowerCase();

  let base = 5;
  if (/(earnings|guidance|merger|acquisition|m&a|fda|doj|sec action|trading halt)/i.test(text)) base = Math.max(base, 30);
  if (/(cpi|fomc|nfp|payroll|inflation)/i.test(text)) base = Math.max(base, 25);
  if (/(meme|social spike|viral|reddit)/i.test(text)) base = Math.max(base, 15);

  if (sources.length > 1) base += 10;

  const watch = new Set(watchlistTickers.map((t) => t.toUpperCase()));
  if (brief.tickers.some((t: string) => watch.has(t.toUpperCase()))) base += 10;

  const impactScore = Math.max(0, Math.min(100, base));

  let confidence = Number.isFinite(brief.confidence) ? brief.confidence : 50;
  if (sources.some((s) => s.source.startsWith("sec:"))) confidence = Math.max(confidence, 70);
  if (sources.length === 1 && brief.summaryBullets.join(" ").length < 200) confidence = Math.min(confidence, 55);
  if (sources.every((s) => s.source.startsWith("x:"))) confidence = Math.min(confidence, 50);

  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  return { ...brief, impactScore, confidence };
}

function buildFallbackBriefs(
  items: Array<{ title: string; url: string; publishedAt: string; source: string; rawText: string; tickers: string[] }>
): z.infer<typeof AiBriefSchema>[] {
  const nowIso = new Date().toISOString();
  return items.slice(0, 3).map((item) => {
    const sentences = item.rawText
      .split(/\n|\.|\r/)
      .map((s) => s.trim())
      .filter(Boolean);

    const summaryBullets = sentences.slice(0, 3);
    const whyItMatters = ["Relevance not fully known; monitor market reaction.", "Source indicates a potentially actionable update."];
    const whatToWatch = ["Follow-up filings or official statements.", "Price action and volume response."];

    return {
      id: sha256(`${item.title}|${item.url}|${item.publishedAt}`),
      createdAt: nowIso,
      headline: item.title,
      summaryBullets: summaryBullets.length ? summaryBullets : [item.title],
      tickers: item.tickers ?? [],
      whyItMatters,
      whatToWatch,
      impactScore: 10,
      confidence: 40,
      sources: [
        {
          title: item.title,
          url: item.url,
          source: item.source,
          publishedAt: item.publishedAt,
        },
      ],
    };
  });
}

async function runPipeline(payload: RunPayload) {
  const config = payload.config;
  const adapters: IngestAdapter[] = [
    new RssIngestAdapter(config.rssFeeds, config.watchlistTickers),
    new SecEdgarAdapter(config.secForms, config.watchlistTickers),
  ];
  if (payload.manualItems.length) {
    adapters.push(new ManualPasteAdapter(payload.manualItems, config.watchlistTickers));
  }

  const results = await Promise.all(adapters.map((a) => a.fetch()));
  const errors = results.flatMap((r) => r.errors);
  const rawItems = results.flatMap((r) => r.items);

  const existingIds = new Set(payload.existingItems.map((i: { id: string }) => i.id));
  const newItems = rawItems.filter((i) => !existingIds.has(i.id));

  const normalized = newItems.map((item) => {
    const canonicalText = canonicalizeText(`${item.title} ${item.rawText}`);
    const canonicalHash = sha256(canonicalText);
    return { ...item, canonicalText, canonicalHash };
  });

  const clusterMap = new Map<string, {
    clusterId: string;
    representativeItemId: string;
    representativePublishedAt: string;
    representativeLength: number;
    tokens: Set<string>;
  }>();

  for (const cluster of payload.existingClusters) {
    clusterMap.set(cluster.clusterId, {
      clusterId: cluster.clusterId,
      representativeItemId: cluster.representativeItemId,
      representativePublishedAt: cluster.publishedAt,
      representativeLength: cluster.rawLength,
      tokens: tokenize(cluster.canonicalText),
    });
  }

  const clusterItems: Array<{ clusterId: string; itemId: string }> = [];
  const clusterUpdateMap = new Map<string, { clusterId: string; representativeItemId: string; createdAt: string; updatedAt: string }>();

  const nowIso = new Date().toISOString();

  const itemsById = new Map(normalized.map((item) => [item.id, item]));

  for (const item of normalized) {
    const itemTokens = tokenize(item.canonicalText);
    let bestCluster: { id: string; score: number } | null = null;

    for (const cluster of clusterMap.values()) {
      const score = jaccardSimilarity(itemTokens, cluster.tokens);
      if (score > SIM_THRESHOLD && (!bestCluster || score > bestCluster.score)) {
        bestCluster = { id: cluster.clusterId, score };
      }
    }

    let clusterId: string;
    if (bestCluster) {
      clusterId = bestCluster.id;
    } else {
      clusterId = sha256(`${item.canonicalHash}|${roundToDay(item.publishedAt)}`);
      clusterMap.set(clusterId, {
        clusterId,
        representativeItemId: item.id,
        representativePublishedAt: item.publishedAt,
        representativeLength: item.rawText.length,
        tokens: itemTokens,
      });
      clusterUpdateMap.set(clusterId, {
        clusterId,
        representativeItemId: item.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    const cluster = clusterMap.get(clusterId)!;
    const newer = new Date(item.publishedAt).getTime() > new Date(cluster.representativePublishedAt).getTime();
    const longer = item.rawText.length > cluster.representativeLength;

    if (newer || longer) {
      cluster.representativeItemId = item.id;
      cluster.representativePublishedAt = item.publishedAt;
      cluster.representativeLength = item.rawText.length;
      cluster.tokens = itemTokens;
      clusterUpdateMap.set(clusterId, {
        clusterId,
        representativeItemId: item.id,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    } else if (!clusterUpdateMap.has(clusterId)) {
      clusterUpdateMap.set(clusterId, {
        clusterId,
        representativeItemId: cluster.representativeItemId,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    clusterItems.push({ clusterId, itemId: item.id });
  }

  const clusterUpdates = Array.from(clusterUpdateMap.values());

  const repItems = clusterUpdates
    .map((c) => itemsById.get(c.representativeItemId))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 15)
    .map((item) => ({
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      source: item.source,
      rawText: item.rawText,
      tickers: item.tickers,
    }));

  const focusedItems = filterItemsByFocus(repItems, config.focusPrompt);

  let briefs: z.infer<typeof AiBriefSchema>[] = [];
  if (focusedItems.length > 0 && config.enabled) {
    const system = buildSystemPrompt();
    const prompt = buildUserPrompt(focusedItems, config.focusPrompt);

    try {
      briefs = await generateBriefsWithOllama(config.model, system, prompt);
    } catch {
      try {
        const retryPrompt = `${prompt}\n\nYour previous output was invalid JSON; output valid JSON array only.`;
        briefs = await generateBriefsWithOllama(config.model, system, retryPrompt);
      } catch (retryErr) {
        errors.push(`[llm] ${String(retryErr)}`);
      }
    }
  }

  if (briefs.length === 0 && focusedItems.length > 0) {
    errors.push("[llm] Invalid brief schema; using fallback briefs.");
    briefs = buildFallbackBriefs(focusedItems);
  }

  const adjustedBriefs = briefs.map((brief) => {
    const sources = brief.sources ?? [];
    return applyDeterministicScoring(brief, sources, config.watchlistTickers);
  });

  return {
    items: normalized,
    clusterUpdates,
    clusterItems,
    briefs: adjustedBriefs,
    errors,
  };
}

if (parentPort) {
  parentPort.on("message", async (msg: unknown) => {
    const parsed = WorkerRequestSchema.safeParse(msg);
    if (!parsed.success) return;

    const { id, type, payload } = parsed.data;

    if (type === "ai:run") {
      const runParsed = RunPayloadSchema.safeParse(payload);
      if (!runParsed.success) {
        respond({ id, type, ok: false, error: "Invalid run payload" });
        return;
      }

      try {
        const result = await runPipeline(runParsed.data);
        respond({ id, type, ok: true, payload: result });
      } catch (err) {
        respond({ id, type, ok: false, error: String(err) });
      }
      return;
    }

    respond({ id, type, ok: false, error: `Unknown worker request: ${type}` });
  });
}
