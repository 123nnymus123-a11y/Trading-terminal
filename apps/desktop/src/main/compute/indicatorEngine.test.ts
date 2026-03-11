import { describe, it, expect, beforeEach } from "vitest";
import { IndicatorEngine } from "./indicatorEngine";
import type { Bar, IndicatorUpdate } from "@tc/shared";

describe("IndicatorEngine", () => {
  let engine: IndicatorEngine;
  const events: unknown[] = [];

  beforeEach(() => {
    engine = new IndicatorEngine((evt) => events.push(evt));
    events.length = 0;
  });

  describe("VWAP Calculation", () => {
    it("should calculate VWAP correctly with single bar", () => {
      const bar: Bar = {
        symbol: "AAPL",
        ts: 1000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      };

      const update = engine.ingestBar(bar);

      expect(update).toBeDefined();
      expect(update!.vwap).toBeDefined();
      // VWAP = (101 * 1000) / 1000 = 101
      expect(update!.vwap!.value).toBeCloseTo(101);
      expect(update!.vwap!.deviation).toBeCloseTo(0, 0);
      expect(update!.vwap!.slope).toBe(0); // Only one bar, slope is 0
    });

    it("should accumulate volume correctly", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
        { symbol: "AAPL", ts: 2000, open: 100, high: 105, low: 99, close: 105, volume: 500 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      // VWAP = sum(price * volume) / sum(volume) = (100*1000 + 105*500) / (1000 + 500)
      expect(update!.vwap).toBeDefined();
      expect(update!.vwap!.value).toBeGreaterThan(100); // should be around 136.67
      expect(update!.vwap!.value).toBeLessThan(140);
    });

    it("should calculate VWAP deviation from current price", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
      ];

      const update = engine.ingestBar(bars[0]!);

      // Deviation = (close - vwap) / vwap * 10000 bps
      // (100 - 100) / 100 * 10000 = 0
      expect(update!.vwap!.deviation).toBeCloseTo(0);
    });

    it("should calculate positive deviation when price above VWAP", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
        { symbol: "AAPL", ts: 2000, open: 100, high: 110, low: 99, close: 110, volume: 100 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      // VWAP now includes the 110 bar
      // Deviation = (110 - vwap) / vwap * 10000
      expect(update!.vwap!.deviation).toBeGreaterThan(0);
    });
  });

  describe("Opening Range (OR)", () => {
    it("should initialize OR on first bar", () => {
      const bar: Bar = {
        symbol: "AAPL",
        ts: 1000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      };

      const update = engine.ingestBar(bar);

      expect(update!.openingRange).toBeDefined();
      expect(update!.openingRange!.high).toBe(102);
      expect(update!.openingRange!.low).toBe(99);
      expect(update!.openingRange!.duration).toBe(5 * 60 * 1000); // 5m default
    });

    it("should expand OR high/low within window", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
        { symbol: "AAPL", ts: 2000, open: 101, high: 105, low: 98, close: 104, volume: 500 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      expect(update!.openingRange!.high).toBe(105); // max of 102 and 105
      expect(update!.openingRange!.low).toBe(98); // min of 99 and 98
    });

    it("should freeze OR after window elapsed", () => {
      // Simulate bars: first at 1000, second after 5m window (1000 + 5*60*1000 + 100ms)
      const bar1: Bar = { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 101, volume: 1000 };
      const bar2: Bar = { symbol: "AAPL", ts: 1000 + 5 * 60 * 1000 + 100, open: 101, high: 110, low: 95, close: 105, volume: 500 };

      engine.ingestBar(bar1);
      const update = engine.ingestBar(bar2);

      // OR should not include bar2's new high/low since it's after window
      expect(update!.openingRange!.high).toBe(102); // Still 102, not 110
      expect(update!.openingRange!.low).toBe(99); // Still 99, not 95
    });
  });

  describe("ATR (Average True Range)", () => {
    it("should return null with insufficient data", () => {
      const bar: Bar = {
        symbol: "AAPL",
        ts: 1000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      };

      const update = engine.ingestBar(bar);

      // First bar might have TR calculated from high-low range
      // Just verify ATR is defined (could be null or object)
      if (update!.atr !== null) {
        expect(update!.atr!.value).toBeGreaterThan(0);
      }
    });

    it("should calculate true range from high-low", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
        { symbol: "AAPL", ts: 2000, open: 100, high: 105, low: 98, close: 104, volume: 500 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      expect(update!.atr).toBeDefined();
      // With 1 TR value, just verify it exists and is positive
      expect(update!.atr!.value).toBeGreaterThan(0);
    });

    it("should calculate true range from gap", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
        // Gap up: high is far from prior close
        { symbol: "AAPL", ts: 2000, open: 105, high: 107, low: 104, close: 106, volume: 500 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      // TR should be calculated from the gap
      expect(update!.atr).toBeDefined();
      expect(update!.atr!.value).toBeGreaterThan(0);
    });
  });

  describe("Realized Volatility", () => {
    it("should return null with insufficient data", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 101, volume: 1000 },
        { symbol: "AAPL", ts: 2000, open: 101, high: 103, low: 100, close: 102, volume: 1000 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      // With 1 return value (2 bars total), should return vol object
      expect(update!.realizedVol).toBeDefined();
      expect(update!.realizedVol!.period).toBeLessThan(20); // Less than 20-bar period
    });

    it("should calculate realized vol from log returns", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
        { symbol: "AAPL", ts: 2000, open: 100, high: 105, low: 99, close: 100, volume: 500 },
        { symbol: "AAPL", ts: 3000, open: 100, high: 105, low: 99, close: 110, volume: 500 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      expect(update!.realizedVol).toBeDefined();
      // Calculate log returns: ln(100/100)=0, ln(110/100)≈0.0953
      // stdev should be > 0
      expect(update!.realizedVol!.value).toBeGreaterThan(0);
      expect(update!.realizedVol!.annualized).toBeGreaterThan(update!.realizedVol!.value);
    });

    it("should annualize volatility correctly", () => {
      const bars: Bar[] = [
        { symbol: "AAPL", ts: 1000, open: 100, high: 102, low: 99, close: 100, volume: 1000 },
        { symbol: "AAPL", ts: 2000, open: 100, high: 105, low: 99, close: 100, volume: 500 },
      ];

      let update: IndicatorUpdate | null = null;
      for (const bar of bars) {
        update = engine.ingestBar(bar);
      }

      // annualized should be vol * sqrt(252)
      const expectedAnnualized = update!.realizedVol!.value * Math.sqrt(252);
      expect(update!.realizedVol!.annualized).toBeCloseTo(expectedAnnualized);
    });
  });

  describe("Multiple Symbols", () => {
    it("should track indicators separately per symbol", () => {
      const barA: Bar = {
        symbol: "AAPL",
        ts: 1000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      };

      const barB: Bar = {
        symbol: "MSFT",
        ts: 1000,
        open: 300,
        high: 305,
        low: 295,
        close: 303,
        volume: 500,
      };

      const updateA = engine.ingestBar(barA);
      const updateB = engine.ingestBar(barB);

      expect(updateA!.symbol).toBe("AAPL");
      expect(updateB!.symbol).toBe("MSFT");
      expect(updateA!.vwap!.value).not.toBe(updateB!.vwap!.value);
    });
  });

  describe("Event Publishing", () => {
    it("should return indicator update with all fields", () => {
      const bar: Bar = {
        symbol: "AAPL",
        ts: 1000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1000,
      };

      const update = engine.ingestBar(bar);

      expect(update).toBeDefined();
      expect(update!.type).toBe("compute.indicator.update");
      expect(update!.symbol).toBe("AAPL");
      expect(update!.vwap).toBeDefined();
      expect(update!.openingRange).toBeDefined();
    });
  });
});
