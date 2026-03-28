import { describe, expect, it } from "vitest";
import { ScriptExecutor, type StrategyContext } from "./scriptExecutor.js";

function makeContext(overrides?: Partial<StrategyContext>): StrategyContext {
  return {
    bars: [
      {
        timestamp: "2024-01-01T00:00:00.000Z",
        symbol: "AAPL",
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1000,
      },
    ],
    currentIndex: 0,
    positions: new Map<string, number>(),
    cash: 100000,
    value: 100000,
    ...overrides,
  };
}

describe("ScriptExecutor sandbox safety", () => {
  it("uses deterministic RNG for identical context runs", async () => {
    const executor = new ScriptExecutor();
    const source = `
      function strategyMain() {
        const r = Math.random();
        return buy("AAPL", Math.floor(r * 100) + 1, String(r));
      }
    `;

    const first = await executor.execute(source, makeContext(), "strategyMain");
    const second = await executor.execute(
      source,
      makeContext(),
      "strategyMain",
    );

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.signals[0]?.quantity).toBe(second.signals[0]?.quantity);
    expect(first.signals[0]?.reason).toBe(second.signals[0]?.reason);
  });

  it("blocks network and filesystem APIs via AST checks", () => {
    const executor = new ScriptExecutor();

    const fetchValidation = executor.validate(`
      function strategyMain() {
        return fetch("https://example.com");
      }
    `);

    const fsValidation = executor.validate(`
      function strategyMain() {
        return fs.readFileSync("secret.txt", "utf8");
      }
    `);

    expect(fetchValidation.valid).toBe(false);
    expect(fetchValidation.errors.join(" ")).toContain("fetch");

    expect(fsValidation.valid).toBe(false);
    expect(fsValidation.errors.join(" ")).toContain("fs");
  });

  it("enforces context memory quota before execution", async () => {
    const executor = new ScriptExecutor() as any;
    executor.MAX_MEMORY_MB = 1;

    const oversizedBars = Array.from({ length: 12 }, (_, index) => ({
      timestamp: `2024-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
      symbol: "A".repeat(100_000),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: 1000,
    }));

    const result = await executor.execute(
      `
        function strategyMain() {
          return hold();
        }
      `,
      makeContext({ bars: oversizedBars }),
      "strategyMain",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("memory quota");
  });
});
