// Strategy script execution engine with sandboxing
// Supports JavaScript/TypeScript execution with restricted access

import { createContext, runInContext } from "node:vm";
import { parse } from "acorn";
import * as walk from "acorn-walk";
import type { OHLCVBar } from "./historicalDataProvider.js";
import {
  detectTimeframe,
  getCurrentTimeframeBar,
  getTimeframeWindow,
  groupBarsBySymbol,
  type SupportedTimeframe,
} from "./timeframeUtils.js";

export type StrategyContext = {
  bars: OHLCVBar[];
  currentIndex: number;
  positions: Map<string, number>; // symbol -> quantity
  cash: number;
  value: number;
};

export type TradeSignal = {
  action: "buy" | "sell" | "hold";
  symbol: string;
  quantity?: number;
  orderType?: "market" | "limit" | "stop" | "stop_limit";
  limitPrice?: number;
  stopPrice?: number;
  reason?: string;
};

export type ExecutionResult = {
  success: boolean;
  signals: TradeSignal[];
  error?: string;
  executionTimeMs: number;
};

export interface IStrategyExecutor {
  execute(
    source: string,
    context: StrategyContext,
    entrypoint: string,
  ): Promise<ExecutionResult>;
  validate(source: string): { valid: boolean; errors: string[] };
}

export class ScriptExecutor implements IStrategyExecutor {
  private readonly MAX_EXECUTION_TIME_MS = 5000;
  private readonly MAX_MEMORY_MB = 512;
  private readonly MAX_BARS_COUNT = 2_000_000;

  private createDeterministicRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  private estimateContextBytes(context: StrategyContext): number {
    const positions = Array.from(context.positions.entries());
    const serialized = JSON.stringify({
      bars: context.bars,
      currentIndex: context.currentIndex,
      positions,
      cash: context.cash,
      value: context.value,
    });
    return Buffer.byteLength(serialized, "utf8");
  }

  private enforceMemoryQuota(context: StrategyContext): void {
    if (context.bars.length > this.MAX_BARS_COUNT) {
      throw new Error(
        `Context bars exceed maximum count (${this.MAX_BARS_COUNT})`,
      );
    }

    const estimatedBytes = this.estimateContextBytes(context);
    const maxBytes = this.MAX_MEMORY_MB * 1024 * 1024;
    if (estimatedBytes > maxBytes) {
      throw new Error(
        `Context exceeds memory quota (${this.MAX_MEMORY_MB}MB estimate)`,
      );
    }
  }

  validate(source: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic validation: check for obviously dangerous patterns
    const dangerousPatterns = [
      /require\s*\(/gi,
      /import\s+/gi,
      /eval\s*\(/gi,
      /Function\s*\(/gi,
      /process\./gi,
      /child_process/gi,
      /fs\./gi,
      /\.\.\/\.\.\//g,
      /\/etc\//g,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(source)) {
        errors.push(
          `Dangerous pattern detected: ${pattern.source.slice(0, 30)}...`,
        );
      }
    }

    // Check source length (prevent DoS)
    if (source.length > 100000) {
      errors.push("Script exceeds maximum length (100KB)");
    }

    try {
      const ast = parse(source, {
        ecmaVersion: "latest",
        sourceType: "script",
      });

      const blockedCallees = new Set([
        "fetch",
        "setTimeout",
        "setInterval",
        "XMLHttpRequest",
        "WebSocket",
        "require",
        "eval",
        "Function",
      ]);

      const blockedRoots = new Set([
        "process",
        "global",
        "globalThis",
        "window",
        "document",
      ]);

      walk.simple(ast, {
        CallExpression: (node) => {
          const callNode = node as {
            callee?: { type?: string; name?: string; object?: unknown };
          };

          if (
            callNode.callee?.type === "Identifier" &&
            callNode.callee.name &&
            blockedCallees.has(callNode.callee.name)
          ) {
            errors.push(
              `Blocked API usage detected: ${callNode.callee.name}()`,
            );
          }

          if (callNode.callee?.type === "MemberExpression") {
            const member = callNode.callee as {
              object?: { type?: string; name?: string };
              property?: { type?: string; name?: string };
            };
            if (
              member.object?.type === "Identifier" &&
              member.object.name === "fs"
            ) {
              errors.push("Blocked API usage detected: fs.*");
            }
            if (
              member.object?.type === "Identifier" &&
              member.object.name === "child_process"
            ) {
              errors.push("Blocked API usage detected: child_process.*");
            }
            if (
              member.object?.type === "Identifier" &&
              member.property?.type === "Identifier" &&
              member.object.name === "globalThis" &&
              member.property.name === "fetch"
            ) {
              errors.push("Blocked API usage detected: globalThis.fetch()");
            }
          }
        },
        MemberExpression: (node) => {
          const member = node as {
            object?: { type?: string; name?: string };
            property?: { type?: string; name?: string };
          };
          const rootName =
            member.object?.type === "Identifier" ? member.object.name : null;
          if (typeof rootName === "string" && blockedRoots.has(rootName)) {
            const prop =
              member.property?.type === "Identifier"
                ? member.property.name
                : "<computed>";
            errors.push(`Blocked global access detected: ${rootName}.${prop}`);
          }
        },
      });
    } catch {
      errors.push("Script parse failed for AST safety checks");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async execute(
    source: string,
    context: StrategyContext,
    entrypoint: string,
  ): Promise<ExecutionResult> {
    const startTime = process.hrtime.bigint();

    try {
      // Validate before execution
      const validation = this.validate(source);
      if (!validation.valid) {
        return {
          success: false,
          signals: [],
          error: `Validation failed: ${validation.errors.join("; ")}`,
          executionTimeMs: 0,
        };
      }

      this.enforceMemoryQuota(context);

      const seededRandom = this.createDeterministicRandom(
        ((context.currentIndex + 1) * 2654435761 + context.bars.length) >>> 0,
      );
      const deterministicMath = Object.freeze(
        Object.assign(Object.create(Math), {
          random: () => seededRandom(),
        }),
      );

      const barsBySymbol = groupBarsBySymbol(context.bars);
      const currentBarValue = context.bars[context.currentIndex] ?? null;
      const currentSymbol = currentBarValue?.symbol ?? "";
      const currentSymbolBars = currentSymbol
        ? (barsBySymbol.get(currentSymbol) ?? [])
        : [];
      const timeframeSummary = detectTimeframe(currentSymbolBars);

      const symbolBars = (symbol?: string) => {
        const resolved = (symbol ?? currentSymbol).trim().toUpperCase();
        return barsBySymbol.get(resolved) ?? [];
      };

      const currentPriceForSymbol = (symbol: string) => {
        const bars = symbolBars(symbol);
        for (let index = bars.length - 1; index >= 0; index--) {
          const bar = bars[index];
          if (!bar) continue;
          if (
            new Date(bar.timestamp).getTime() <=
            new Date(currentBarValue?.timestamp ?? 0).getTime()
          ) {
            return bar.close;
          }
        }
        return null;
      };

      const buildSignal = (
        action: "buy" | "sell",
        symbol: string,
        quantity?: number,
        reason = "",
        extra?: Partial<TradeSignal>,
      ): TradeSignal => {
        const signal: TradeSignal = {
          action,
          symbol,
          ...(quantity !== undefined ? { quantity } : {}),
          ...(reason ? { reason } : {}),
          ...(extra ?? {}),
        };
        return signal;
      };

      // Create a restricted context with allowed APIs
      const sandbox = {
        // Current bar data and context
        ctx: {
          bars: context.bars,
          currentIndex: context.currentIndex,
          positions: new Map(context.positions),
          cash: context.cash,
          value: context.value,
          meta: {
            currentSymbol,
            datasetFrequency: timeframeSummary.baseFrequency,
            supportedTimeframes: timeframeSummary.supportedViews,
          },
        },

        // Utility functions
        log: (msg: unknown) => console.log("[Strategy]", msg),
        currentBar: () => currentBarValue,
        currentPrice: (symbol: string) => currentPriceForSymbol(symbol),
        previousBar: (offset = 1) => {
          const idx = context.currentIndex - offset;
          return idx >= 0 ? context.bars[idx] : null;
        },
        barRange: (startOffset: number, endOffset: number) => {
          const start = Math.max(0, context.currentIndex - startOffset);
          const end = Math.min(
            context.bars.length,
            context.currentIndex - endOffset + 1,
          );
          return context.bars.slice(start, end);
        },
        symbolBars: (symbol?: string) => symbolBars(symbol),
        timeframeBar: (
          timeframe: SupportedTimeframe,
          offset = 0,
          symbol?: string,
        ) => {
          const bars = symbolBars(symbol);
          const timestamp = currentBarValue?.timestamp;
          if (!timestamp) {
            return null;
          }
          return getCurrentTimeframeBar(bars, timestamp, timeframe, offset);
        },
        timeframeRange: (
          timeframe: SupportedTimeframe,
          lookback: number,
          symbol?: string,
        ) => {
          const bars = symbolBars(symbol);
          const timestamp = currentBarValue?.timestamp;
          if (!timestamp) {
            return [];
          }
          return getTimeframeWindow(bars, timestamp, timeframe, lookback);
        },
        datasetFrequency: () => timeframeSummary.baseFrequency,
        supportedTimeframes: () => timeframeSummary.supportedViews,

        // Math utilities
        Math: deterministicMath,

        // Simple signal builder
        buy: (symbol: string, quantity?: number, reason = "") =>
          buildSignal("buy", symbol, quantity, reason, { orderType: "market" }),
        sell: (symbol: string, quantity?: number, reason = "") =>
          buildSignal("sell", symbol, quantity, reason, {
            orderType: "market",
          }),
        buyLimit: (
          symbol: string,
          limitPrice: number,
          quantity?: number,
          reason = "",
        ) =>
          buildSignal("buy", symbol, quantity, reason, {
            orderType: "limit",
            limitPrice,
          }),
        sellLimit: (
          symbol: string,
          limitPrice: number,
          quantity?: number,
          reason = "",
        ) =>
          buildSignal("sell", symbol, quantity, reason, {
            orderType: "limit",
            limitPrice,
          }),
        buyStop: (
          symbol: string,
          stopPrice: number,
          quantity?: number,
          reason = "",
        ) =>
          buildSignal("buy", symbol, quantity, reason, {
            orderType: "stop",
            stopPrice,
          }),
        sellStop: (
          symbol: string,
          stopPrice: number,
          quantity?: number,
          reason = "",
        ) =>
          buildSignal("sell", symbol, quantity, reason, {
            orderType: "stop",
            stopPrice,
          }),
        buyStopLimit: (
          symbol: string,
          stopPrice: number,
          limitPrice: number,
          quantity?: number,
          reason = "",
        ) =>
          buildSignal("buy", symbol, quantity, reason, {
            orderType: "stop_limit",
            stopPrice,
            limitPrice,
          }),
        sellStopLimit: (
          symbol: string,
          stopPrice: number,
          limitPrice: number,
          quantity?: number,
          reason = "",
        ) =>
          buildSignal("sell", symbol, quantity, reason, {
            orderType: "stop_limit",
            stopPrice,
            limitPrice,
          }),
        hold: () => ({ action: "hold", symbol: "", reason: "hold" }),

        // Validation
        signals: [] as TradeSignal[],
      };

      // Create VM context
      const vmContext = createContext(sandbox, {
        codeGeneration: { strings: false, wasm: false },
      });

      // Wrap user code to capture return value
      const wrappedCode = `
        (function() {
          ${source}
          if (typeof ${entrypoint} === 'function') {
            return ${entrypoint}(ctx);
          }
          throw new Error('Entrypoint ${entrypoint} not found');
        })()
      `;

      // Execute with timeout
      const timeout = setTimeout(() => {
        throw new Error(`Execution timeout (${this.MAX_EXECUTION_TIME_MS}ms)`);
      }, this.MAX_EXECUTION_TIME_MS);

      const result = runInContext(wrappedCode, vmContext, {
        timeout: this.MAX_EXECUTION_TIME_MS,
        displayErrors: true,
      });

      clearTimeout(timeout);

      // Parse result
      const signals: TradeSignal[] = [];
      if (Array.isArray(result)) {
        signals.push(
          ...result.filter(
            (s): s is TradeSignal =>
              s &&
              typeof s === "object" &&
              "action" in s &&
              (s.action === "buy" ||
                s.action === "sell" ||
                s.action === "hold"),
          ),
        );
      } else if (
        result &&
        typeof result === "object" &&
        "action" in result &&
        (result.action === "buy" ||
          result.action === "sell" ||
          result.action === "hold")
      ) {
        signals.push(result as TradeSignal);
      }

      const endTime = process.hrtime.bigint();
      const executionTimeMs = Number((endTime - startTime) / 1000000n);

      return {
        success: true,
        signals,
        executionTimeMs,
      };
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const executionTimeMs = Number((endTime - startTime) / 1000000n);

      return {
        success: false,
        signals: [],
        error:
          error instanceof Error ? error.message : "Unknown execution error",
        executionTimeMs,
      };
    }
  }
}

export function createScriptExecutor(): IStrategyExecutor {
  return new ScriptExecutor();
}
