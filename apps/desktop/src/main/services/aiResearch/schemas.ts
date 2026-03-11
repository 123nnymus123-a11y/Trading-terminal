import { z } from "zod";

export const AiSourceItemSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  url: z.string().url(),
  title: z.string().min(1),
  publishedAt: z.string().min(1),
  rawText: z.string().min(1),
  tickers: z.array(z.string()).default([]),
  ingestedAt: z.string().min(1),
});

export const AiBriefSourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url(),
  source: z.string().min(1),
  publishedAt: z.string().min(1),
});

export const AiBriefSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  headline: z.string().min(1),
  summaryBullets: z.array(z.string().min(1)).min(1).max(6),
  tickers: z.array(z.string()).default([]),
  whyItMatters: z.array(z.string().min(1)).min(1).max(4),
  whatToWatch: z.array(z.string().min(1)).min(1).max(4),
  impactScore: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  sources: z.array(AiBriefSourceSchema).min(1),
});

export const AiConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    model: z.string().min(1).default("deepseek-r1:14b"), // Note: This will be overridden by global AI model setting
    pollIntervalSec: z.number().int().min(60).max(3600).default(300),
    rssFeeds: z.array(z.string().url()).default([]),
    secForms: z.array(z.string()).default(["8-K", "10-Q", "10-K"]),
    watchlistTickers: z.array(z.string()).default([]),
    watchlistKeywords: z.array(z.string()).default([]),
    useX: z.boolean().default(false),
    xApiKey: z.string().optional(),
    focusPrompt: z.string().optional(),
  })
  .default({
    enabled: false,
    model: "deepseek-r1:14b",
    pollIntervalSec: 300,
    rssFeeds: [],
    secForms: ["8-K", "10-Q", "10-K"],
    watchlistTickers: [],
    watchlistKeywords: [],
    useX: false,
    focusPrompt: "",
  });

export type AiSourceItem = z.infer<typeof AiSourceItemSchema>;
export type AiBrief = z.infer<typeof AiBriefSchema>;
export type AiConfig = z.infer<typeof AiConfigSchema>;
