import { getDb } from "./db";
import { z } from "zod";
import { AiBriefSchema, AiConfigSchema, AiSourceItemSchema } from "../services/aiResearch/schemas";

export type AiSourceItem = z.infer<typeof AiSourceItemSchema> & {
  canonicalHash: string;
  canonicalText: string;
};
export type AiBrief = z.infer<typeof AiBriefSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;

export const AiResearchRepo = {
  getConfig(): AiConfig {
    const db = getDb();
    const row = db.prepare("SELECT data FROM ai_config WHERE id = 1").get() as { data: string } | undefined;
    const raw = row?.data ?? "{}";
    const parsed = AiConfigSchema.safeParse(JSON.parse(raw));
    
    // Get global AI model from app settings
    const settingsRow = db.prepare("SELECT data FROM app_settings WHERE id = 1").get() as { data: string } | undefined;
    const settings = settingsRow ? JSON.parse(settingsRow.data) : {};
    const globalAiModel = settings.globalAiModel;
    
    const baseConfig = parsed.success ? parsed.data : AiConfigSchema.parse({});
    
    // Override model with global AI model if it exists
    if (globalAiModel && typeof globalAiModel === 'string') {
      return { ...baseConfig, model: globalAiModel };
    }
    
    return baseConfig;
  },

  setConfig(next: AiConfig): void {
    const db = getDb();
    db.prepare("UPDATE ai_config SET data = ? WHERE id = 1").run(JSON.stringify(next));
    
    // Also update global AI model in app settings
    if (next.model) {
      const settingsRow = db.prepare("SELECT data FROM app_settings WHERE id = 1").get() as { data: string } | undefined;
      const settings = settingsRow ? JSON.parse(settingsRow.data) : {};
      settings.globalAiModel = next.model;
      db.prepare("INSERT OR REPLACE INTO app_settings (id, data) VALUES (1, ?)").run(JSON.stringify(settings));
    }
  },

  insertSourceItems(items: AiSourceItem[]): number {
    if (items.length === 0) return 0;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO ai_source_items (
        id, source, url, title, published_at, raw_text, tickers, ingested_at, canonical_hash, canonical_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = db.transaction((items: AiSourceItem[]) => {
      let inserted = 0;
      for (const item of items) {
        const info = stmt.run(
          item.id,
          item.source,
          item.url,
          item.title,
          item.publishedAt,
          item.rawText,
          JSON.stringify(item.tickers ?? []),
          item.ingestedAt,
          item.canonicalHash,
          item.canonicalText
        );
        if (info.changes > 0) inserted += 1;
      }
      return inserted;
    });

    return insertMany(items);
  },

  getRecentItems(sinceISO: string, limit = 500): Array<{
    id: string;
    canonicalHash: string;
    canonicalText: string;
    publishedAt: string;
  }> {
    const db = getDb();
    return db
      .prepare(
        `SELECT id, canonical_hash as canonicalHash, canonical_text as canonicalText, published_at as publishedAt
         FROM ai_source_items
         WHERE published_at >= ?
         ORDER BY published_at DESC
         LIMIT ?`
      )
      .all(sinceISO, limit) as Array<{ id: string; canonicalHash: string; canonicalText: string; publishedAt: string }>;
  },

  getRecentClusterRepresentatives(sinceISO: string, limit = 200): Array<{
    clusterId: string;
    representativeItemId: string;
    canonicalText: string;
    updatedAt: string;
    publishedAt: string;
    rawLength: number;
  }> {
    const db = getDb();
    return db
      .prepare(
        `SELECT c.cluster_id as clusterId, c.representative_item_id as representativeItemId,
                s.canonical_text as canonicalText, c.updated_at as updatedAt,
                s.published_at as publishedAt, LENGTH(s.raw_text) as rawLength
         FROM ai_clusters c
         JOIN ai_source_items s ON s.id = c.representative_item_id
         WHERE c.updated_at >= ?
         ORDER BY c.updated_at DESC
         LIMIT ?`
      )
      .all(sinceISO, limit) as Array<{
      clusterId: string;
      representativeItemId: string;
      canonicalText: string;
      updatedAt: string;
      publishedAt: string;
      rawLength: number;
    }>;
  },

  upsertClusters(clusters: Array<{ clusterId: string; representativeItemId: string; createdAt: string; updatedAt: string }>): number {
    if (clusters.length === 0) return 0;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO ai_clusters (cluster_id, representative_item_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cluster_id) DO UPDATE SET
        representative_item_id = excluded.representative_item_id,
        updated_at = excluded.updated_at
    `);

    const runMany = db.transaction((rows: typeof clusters) => {
      let count = 0;
      for (const row of rows) {
        const info = stmt.run(row.clusterId, row.representativeItemId, row.createdAt, row.updatedAt);
        count += info.changes;
      }
      return count;
    });

    return runMany(clusters);
  },

  linkClusterItems(rows: Array<{ clusterId: string; itemId: string }>): number {
    if (rows.length === 0) return 0;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO ai_cluster_items (cluster_id, item_id)
      VALUES (?, ?)
    `);

    const runMany = db.transaction((rows: Array<{ clusterId: string; itemId: string }>) => {
      let count = 0;
      for (const row of rows) {
        const info = stmt.run(row.clusterId, row.itemId);
        count += info.changes;
      }
      return count;
    });

    return runMany(rows);
  },

  insertBriefs(briefs: AiBrief[], runId: string, clusterId?: string): number {
    if (briefs.length === 0) return 0;
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO ai_briefs (
        id, created_at, headline, summary_bullets, tickers,
        why_it_matters, what_to_watch, impact_score, confidence,
        sources, cluster_id, run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const runMany = db.transaction((rows: AiBrief[]) => {
      let count = 0;
      for (const b of rows) {
        const info = stmt.run(
          b.id,
          b.createdAt,
          b.headline,
          JSON.stringify(b.summaryBullets ?? []),
          JSON.stringify(b.tickers ?? []),
          JSON.stringify(b.whyItMatters ?? []),
          JSON.stringify(b.whatToWatch ?? []),
          b.impactScore,
          b.confidence,
          JSON.stringify(b.sources ?? []),
          clusterId ?? null,
          runId
        );
        count += info.changes;
      }
      return count;
    });

    return runMany(briefs);
  },

  listBriefs(limit = 5): AiBrief[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, created_at as createdAt, headline,
                summary_bullets as summaryBullets,
                tickers, why_it_matters as whyItMatters,
                what_to_watch as whatToWatch,
                impact_score as impactScore,
                confidence,
                sources
         FROM ai_briefs
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: string;
      createdAt: string;
      headline: string;
      summaryBullets: string;
      tickers: string;
      whyItMatters: string;
      whatToWatch: string;
      impactScore: number;
      confidence: number;
      sources: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      headline: row.headline,
      summaryBullets: JSON.parse(row.summaryBullets ?? "[]"),
      tickers: JSON.parse(row.tickers ?? "[]"),
      whyItMatters: JSON.parse(row.whyItMatters ?? "[]"),
      whatToWatch: JSON.parse(row.whatToWatch ?? "[]"),
      impactScore: row.impactScore,
      confidence: row.confidence,
      sources: JSON.parse(row.sources ?? "[]"),
    }));
  },

  createRun(runId: string, startedAt: string): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO ai_runs (id, started_at, status)
      VALUES (?, ?, 'running')
    `).run(runId, startedAt);
  },

  finishRun(runId: string, status: "completed" | "failed", finishedAt: string, error?: string, stats?: Record<string, unknown>): void {
    const db = getDb();
    db.prepare(
      `UPDATE ai_runs SET finished_at = ?, status = ?, error = ?, stats = ? WHERE id = ?`
    ).run(finishedAt, status, error ?? null, stats ? JSON.stringify(stats) : null, runId);
  },

  getLastRun(): { id: string; startedAt: string; finishedAt?: string; status: string; error?: string } | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, started_at as startedAt, finished_at as finishedAt, status, error
         FROM ai_runs
         ORDER BY started_at DESC
         LIMIT 1`
      )
      .get() as { id: string; startedAt: string; finishedAt?: string; status: string; error?: string } | undefined;
    return row ?? null;
  },
};
