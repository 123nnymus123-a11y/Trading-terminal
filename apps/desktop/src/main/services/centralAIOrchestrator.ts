/**
 * Central AI Orchestrator
 * 
 * A learning AI system that:
 * - Tracks user behavior (searches, portfolio, interactions)
 * - Predicts next stock lookups
 * - Preloads Intelligence and Supply Chain data
 * - Validates Local AI responses
 * - Adapts based on portfolio and trading patterns
 */

import { EventEmitter } from "events";
import type { WebContents } from "electron";
import { getDb } from "../persistence/db";

export interface UserInteraction {
  type: "symbol_search" | "supply_chain_view" | "intelligence_read" | "portfolio_add" | "portfolio_remove" | "trade_executed";
  symbol?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface PredictionResult {
  symbol: string;
  confidence: number;
  reason: string;
  relatedSymbols: string[];
}

export interface LearningData {
  searchHistory: Array<{ symbol: string; timestamp: number; count: number }>;
  portfolioHoldings: string[];
  recentTrades: Array<{ symbol: string; side: "buy" | "sell"; timestamp: number }>;
  sectorPreferences: Record<string, number>;
  timePatterns: Record<string, number>; // hour of day -> interaction count
}

export interface AIValidationResult {
  valid: boolean;
  confidence: number;
  issues?: string[];
  corrections?: Record<string, any>;
}

export class CentralAIOrchestrator extends EventEmitter {
  private webContents: WebContents | null = null;
  private learningData: LearningData = {
    searchHistory: [],
    portfolioHoldings: [],
    recentTrades: [],
    sectorPreferences: {},
    timePatterns: {},
  };
  private preloadQueue: Set<string> = new Set();
  private processingPreload: boolean = false;
  
  constructor() {
    super();
    this.loadLearningData();
  }

  setWebContents(webContents: WebContents) {
    this.webContents = webContents;
  }

  /**
   * Track user interaction to build behavioral model
   */
  trackInteraction(interaction: UserInteraction): void {
    const db = getDb();
    
    // Store interaction in database
    db.prepare(`
      INSERT INTO ai_interactions (type, symbol, timestamp, metadata)
      VALUES (?, ?, ?, ?)
    `).run(
      interaction.type,
      interaction.symbol || null,
      interaction.timestamp,
      interaction.metadata ? JSON.stringify(interaction.metadata) : null
    );

    // Update in-memory learning data
    if (interaction.symbol) {
      // Update search history
      const existing = this.learningData.searchHistory.find(h => h.symbol === interaction.symbol);
      if (existing) {
        existing.count += 1;
        existing.timestamp = interaction.timestamp;
      } else {
        this.learningData.searchHistory.push({
          symbol: interaction.symbol,
          timestamp: interaction.timestamp,
          count: 1,
        });
      }

      // Keep only last 100 searches
      this.learningData.searchHistory.sort((a, b) => b.timestamp - a.timestamp);
      this.learningData.searchHistory = this.learningData.searchHistory.slice(0, 100);

      // Update time patterns
      const hour = new Date(interaction.timestamp).getHours();
      this.learningData.timePatterns[hour] = (this.learningData.timePatterns[hour] || 0) + 1;
    }

    // Handle portfolio changes
    if (interaction.type === "portfolio_add" && interaction.symbol) {
      if (!this.learningData.portfolioHoldings.includes(interaction.symbol)) {
        this.learningData.portfolioHoldings.push(interaction.symbol);
      }
    } else if (interaction.type === "portfolio_remove" && interaction.symbol) {
      this.learningData.portfolioHoldings = this.learningData.portfolioHoldings.filter(
        s => s !== interaction.symbol
      );
    }

    // Track trades
    if (interaction.type === "trade_executed" && interaction.symbol && interaction.metadata?.side) {
      this.learningData.recentTrades.push({
        symbol: interaction.symbol,
        side: interaction.metadata.side,
        timestamp: interaction.timestamp,
      });
      // Keep only last 50 trades
      this.learningData.recentTrades = this.learningData.recentTrades.slice(-50);
    }

    // Persist learning data
    this.saveLearningData();

    // Trigger prediction update
    this.emit("interaction", interaction);
    
    // Consider preloading related data
    if (interaction.symbol) {
      this.considerPreload(interaction.symbol);
    }
  }

  /**
   * Predict next symbols user might search
   */
  predictNextSymbols(limit: number = 5): PredictionResult[] {
    const predictions: PredictionResult[] = [];
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;

    // Algorithm 1: Recent search patterns
    const recentSearches = this.learningData.searchHistory
      .filter(h => h.timestamp > oneDayAgo)
      .sort((a, b) => b.count * (b.timestamp / oneDayAgo) - a.count * (a.timestamp / oneDayAgo));

    // Algorithm 2: Portfolio-based predictions (related stocks in same sector)
    const portfolioSymbols = this.learningData.portfolioHoldings;

    // Algorithm 3: Trade follow-up (user might research stocks they just traded)
    const recentTradeSymbols = this.learningData.recentTrades
      .filter(t => t.timestamp > oneHourAgo)
      .map(t => t.symbol);

    // Combine predictions
    const symbolScores = new Map<string, { score: number; reasons: string[] }>();

    // Score recent searches (high weight)
    recentSearches.forEach((search, index) => {
      const recency = (now - search.timestamp) / 3600000; // hours ago
      const frequency = search.count;
      const score = (frequency * 2) / (1 + recency * 0.5);
      
      symbolScores.set(search.symbol, {
        score,
        reasons: [`Searched ${frequency}x recently`],
      });
    });

    // Score portfolio holdings (medium weight)
    portfolioSymbols.forEach(symbol => {
      const existing = symbolScores.get(symbol);
      if (existing) {
        existing.score += 3;
        existing.reasons.push("In portfolio");
      } else {
        symbolScores.set(symbol, {
          score: 3,
          reasons: ["In portfolio"],
        });
      }
    });

    // Score recent trades (high weight)
    recentTradeSymbols.forEach(symbol => {
      const existing = symbolScores.get(symbol);
      if (existing) {
        existing.score += 4;
        existing.reasons.push("Recently traded");
      } else {
        symbolScores.set(symbol, {
          score: 4,
          reasons: ["Recently traded"],
        });
      }
    });

    // Convert to prediction results
    const sortedSymbols = Array.from(symbolScores.entries())
      .sort((a, b) => b[1].score - a[1].score)
      .slice(0, limit);

    for (const [symbol, { score, reasons }] of sortedSymbols) {
      predictions.push({
        symbol,
        confidence: Math.min(score / 10, 1), // normalize to 0-1
        reason: reasons.join(", "),
        relatedSymbols: this.findRelatedSymbols(symbol),
      });
    }

    return predictions;
  }

  /**
   * Find related symbols based on sector/industry/search patterns
   */
  private findRelatedSymbols(symbol: string): string[] {
    // Look for symbols frequently searched together
    const db = getDb();
    const recentWindow = Date.now() - 86400000; // 24 hours

    const related = db.prepare(`
      SELECT symbol, COUNT(*) as co_occurrence
      FROM ai_interactions
      WHERE type = 'symbol_search'
        AND timestamp > ?
        AND symbol != ?
        AND timestamp IN (
          SELECT timestamp FROM ai_interactions
          WHERE symbol = ?
          AND type = 'symbol_search'
          AND timestamp > ?
        )
      GROUP BY symbol
      ORDER BY co_occurrence DESC
      LIMIT 5
    `).all(recentWindow, symbol, symbol, recentWindow) as Array<{ symbol: string }>;

    return related.map(r => r.symbol);
  }

  /**
   * Consider preloading data for a symbol
   */
  private async considerPreload(symbol: string): Promise<void> {
    // Don't preload if already in queue or recently loaded
    if (this.preloadQueue.has(symbol)) {
      return;
    }

    // Add to queue
    this.preloadQueue.add(symbol);

    // Trigger preload processing
    if (!this.processingPreload) {
      void this.processPreloadQueue();
    }
  }

  /**
   * Process preload queue
   */
  private async processPreloadQueue(): Promise<void> {
    if (this.processingPreload || this.preloadQueue.size === 0) {
      return;
    }

    this.processingPreload = true;

    try {
      for (const symbol of Array.from(this.preloadQueue).slice(0, 3)) {
        this.preloadQueue.delete(symbol);

        // Preload supply chain data
        await this.preloadSupplyChain(symbol);

        // Preload related intelligence
        await this.preloadIntelligence(symbol);

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } finally {
      this.processingPreload = false;

      // Continue processing if queue not empty
      if (this.preloadQueue.size > 0) {
        setTimeout(() => void this.processPreloadQueue(), 1000);
      }
    }
  }

  /**
   * Preload supply chain data
   */
  private async preloadSupplyChain(symbol: string): Promise<void> {
    try {
      const { SupplyChainRepo } = await import("../persistence/supplyChainRepo");
      const { generateSupplyChainWithOllama } = await import("../services/supplyChain/ollamaSupplyChain");
      const { AiResearchRepo } = await import("../persistence/aiResearchRepo");

      // Check if already cached
      const cached = SupplyChainRepo.getCached(symbol);
      if (cached) {
        return;
      }

      // Generate in background
      const config = AiResearchRepo.getConfig();
      const model = config?.model || "deepseek-r1:14b";
      const mindMapData = await generateSupplyChainWithOllama(model, symbol);

      // Cache the result
      SupplyChainRepo.setCached(symbol, mindMapData, 30);

      console.log(`[CentralAI] Preloaded supply chain for ${symbol}`);
    } catch (err) {
      console.error(`[CentralAI] Failed to preload supply chain for ${symbol}:`, err);
    }
  }

  /**
   * Preload intelligence data
   */
  private async preloadIntelligence(symbol: string): Promise<void> {
    try {
      // Notify renderer to refresh intelligence for this symbol
      if (this.webContents && !this.webContents.isDestroyed()) {
        this.webContents.send("centralAI:preload:intelligence", { symbol });
      }

      console.log(`[CentralAI] Preloading intelligence for ${symbol}`);
    } catch (err) {
      console.error(`[CentralAI] Failed to preload intelligence for ${symbol}:`, err);
    }
  }

  /**
   * Validate AI response against context data
   */
  async validateAIResponse(
    response: string,
    context: {
      symbol?: string;
      portfolio?: Array<{ symbol: string; quantity: number; avgPrice: number }>;
      recentPrices?: Record<string, number>;
    }
  ): Promise<AIValidationResult> {
    const issues: string[] = [];
    const corrections: Record<string, any> = {};

    // Validate price mentions
    if (context.recentPrices && context.symbol) {
      const actualPrice = context.recentPrices[context.symbol];
      if (actualPrice) {
        // Look for price mentions in response
        const pricePattern = /\$?(\d+(?:\.\d{2})?)/g;
        const matches = response.match(pricePattern);
        if (matches) {
          matches.forEach(match => {
            const mentioned = parseFloat(match.replace("$", ""));
            const diff = Math.abs(mentioned - actualPrice) / actualPrice;
            if (diff > 0.1) { // More than 10% difference
              issues.push(`Price mentioned ($${mentioned}) differs significantly from current price ($${actualPrice.toFixed(2)})`);
              corrections[`price_${context.symbol}`] = actualPrice;
            }
          });
        }
      }
    }

    // Validate portfolio mentions
    if (context.portfolio && context.symbol) {
      const holding = context.portfolio.find(p => p.symbol === context.symbol);
      const mentionsHolding = response.toLowerCase().includes("you own") || 
                            response.toLowerCase().includes("your position") ||
                            response.toLowerCase().includes("in your portfolio");
      
      if (mentionsHolding && !holding) {
        issues.push(`Response mentions ownership of ${context.symbol} but it's not in your portfolio`);
        corrections[`portfolio_${context.symbol}`] = false;
      } else if (!mentionsHolding && holding) {
        issues.push(`Response doesn't mention you own ${context.symbol}, which is in your portfolio`);
        corrections[`portfolio_${context.symbol}`] = true;
      }
    }

    // Calculate confidence based on issues found
    const confidence = issues.length === 0 ? 1.0 : Math.max(0, 1.0 - (issues.length * 0.2));

    return {
      valid: issues.length === 0,
      confidence,
      issues: issues.length > 0 ? issues : undefined,
      corrections: Object.keys(corrections).length > 0 ? corrections : undefined,
    };
  }

  /**
   * Get personalized intelligence based on user patterns
   */
  getPersonalizedIntelligence(): {
    focusSymbols: string[];
    sectorAlerts: string[];
    tradingReminders: string[];
  } {
    const predictions = this.predictNextSymbols(10);
    const focusSymbols = predictions.slice(0, 5).map(p => p.symbol);

    // Generate sector alerts based on portfolio
    const sectorAlerts: string[] = [];
    if (this.learningData.portfolioHoldings.length > 0) {
      sectorAlerts.push(`Monitoring ${this.learningData.portfolioHoldings.length} portfolio positions`);
    }

    // Trading reminders based on patterns
    const tradingReminders: string[] = [];
    const now = new Date();
    const currentHour = now.getHours();
    
    // Check if user typically trades at this hour
    const avgActivityThisHour = this.learningData.timePatterns[currentHour] || 0;
    const totalActivity = Object.values(this.learningData.timePatterns).reduce((a, b) => a + b, 0);
    
    if (avgActivityThisHour > totalActivity / 24 * 1.5) {
      tradingReminders.push("Peak activity hour - good time to review positions");
    }

    return {
      focusSymbols,
      sectorAlerts,
      tradingReminders,
    };
  }

  /**
   * Load learning data from database
   */
  private loadLearningData(): void {
    const db = getDb();

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_interactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        symbol TEXT,
        timestamp INTEGER NOT NULL,
        metadata TEXT
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_interactions_symbol ON ai_interactions(symbol)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_ai_interactions_timestamp ON ai_interactions(timestamp)
    `);

    // Load recent interactions
    const recentWindow = Date.now() - 7 * 86400000; // 7 days
    const interactions = db.prepare(`
      SELECT type, symbol, timestamp, metadata
      FROM ai_interactions
      WHERE timestamp > ?
      ORDER BY timestamp DESC
      LIMIT 500
    `).all(recentWindow) as Array<{
      type: string;
      symbol: string | null;
      timestamp: number;
      metadata: string | null;
    }>;

    // Rebuild learning data
    interactions.forEach(row => {
      if (row.symbol) {
        const existing = this.learningData.searchHistory.find(h => h.symbol === row.symbol);
        if (existing) {
          existing.count += 1;
        } else {
          this.learningData.searchHistory.push({
            symbol: row.symbol,
            timestamp: row.timestamp,
            count: 1,
          });
        }

        const hour = new Date(row.timestamp).getHours();
        this.learningData.timePatterns[hour] = (this.learningData.timePatterns[hour] || 0) + 1;
      }
    });

    // Load portfolio holdings from app settings
    try {
      const { AppSettingsRepo } = require("../persistence/repos");
      const settings = AppSettingsRepo.get();
      this.learningData.portfolioHoldings = settings.portfolio_symbols || [];
    } catch (err) {
      console.warn("[CentralAI] Could not load portfolio holdings:", err);
    }

    console.log(`[CentralAI] Loaded ${interactions.length} historical interactions`);
  }

  /**
   * Save learning data to database
   */
  private saveLearningData(): void {
    try {
      const { AppSettingsRepo } = require("../persistence/repos");
      AppSettingsRepo.set({
        "ai.learning.portfolio": this.learningData.portfolioHoldings,
        "ai.learning.last_updated": Date.now(),
      });
    } catch (err) {
      console.error("[CentralAI] Failed to save learning data:", err);
    }
  }

  /**
   * Get orchestrator statistics
   */
  getStats(): {
    totalInteractions: number;
    uniqueSymbols: number;
    portfolioSize: number;
    topSymbols: Array<{ symbol: string; score: number }>;
    predictions: PredictionResult[];
  } {
    const db = getDb();
    const recentWindow = Date.now() - 7 * 86400000;
    
    const stats = db.prepare(`
      SELECT COUNT(*) as total FROM ai_interactions WHERE timestamp > ?
    `).get(recentWindow) as { total: number };

    const uniqueSymbols = db.prepare(`
      SELECT COUNT(DISTINCT symbol) as count FROM ai_interactions WHERE timestamp > ? AND symbol IS NOT NULL
    `).get(recentWindow) as { count: number };

    const topSymbols = this.learningData.searchHistory
      .slice(0, 10)
      .map(h => ({ symbol: h.symbol, score: h.count }));

    return {
      totalInteractions: stats.total,
      uniqueSymbols: uniqueSymbols.count,
      portfolioSize: this.learningData.portfolioHoldings.length,
      topSymbols,
      predictions: this.predictNextSymbols(5),
    };
  }
}

// Singleton instance
let orchestratorInstance: CentralAIOrchestrator | null = null;

export function getCentralAIOrchestrator(): CentralAIOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new CentralAIOrchestrator();
  }
  return orchestratorInstance;
}
