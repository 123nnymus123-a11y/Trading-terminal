import { describe, it, expect } from "vitest";
import { MarketDataEventSchema, type MarketDataEvent } from "@tc/shared";
import { z } from "zod";

describe("Adapter Event Shapes", () => {
  describe("Quote Event Validation", () => {
    it("should validate quote event", () => {
      const event: MarketDataEvent = {
        type: "md.quote",
        quote: {
          symbol: "AAPL",
          bid: 150.5,
          ask: 150.6,
          last: 150.55,
          ts: 1000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("should reject quote without required fields", () => {
      const event = {
        type: "md.quote",
        quote: {
          symbol: "AAPL",
          bid: 150.5,
          // missing ask, last, ts
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("should reject quote with extra fields", () => {
      const event = {
        type: "md.quote",
        quote: {
          symbol: "AAPL",
          bid: 150.5,
          ask: 150.6,
          last: 150.55,
          ts: 1000,
          extra: "field", // strict mode rejects this
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("should validate ask > bid in quote", () => {
      const event: MarketDataEvent = {
        type: "md.quote",
        quote: {
          symbol: "AAPL",
          bid: 150.5,
          ask: 150.6,
          last: 150.55,
          ts: 1000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "md.quote") {
        expect(result.data.quote.ask).toBeGreaterThan(result.data.quote.bid);
      }
    });
  });

  describe("TradePrint Event Validation", () => {
    it("should validate trade print event", () => {
      const event: MarketDataEvent = {
        type: "md.print",
        print: {
          symbol: "AAPL",
          price: 150.55,
          size: 500,
          ts: 1000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("should reject print without required fields", () => {
      const event = {
        type: "md.print",
        print: {
          symbol: "AAPL",
          price: 150.55,
          // missing size, ts
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("should validate large volume numbers", () => {
      const event: MarketDataEvent = {
        type: "md.print",
        print: {
          symbol: "AAPL",
          price: 150.55,
          size: 1000000000,
          ts: 1000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("should validate zero volume", () => {
      const event: MarketDataEvent = {
        type: "md.print",
        print: {
          symbol: "AAPL",
          price: 150.55,
          size: 0,
          ts: 1000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("should validate negative prices", () => {
      const event: MarketDataEvent = {
        type: "md.print",
        print: {
          symbol: "AAPL",
          price: -0.5,
          size: 100,
          ts: 1000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });
  });

  describe("Bar Event Validation", () => {
    it("should validate bar event", () => {
      const event: MarketDataEvent = {
        type: "md.bar",
        bar: {
          symbol: "AAPL",
          timeframe: "1m",
          tsStart: 1000,
          tsEnd: 2000,
          open: 150.0,
          high: 151.0,
          low: 149.5,
          close: 150.8,
          volume: 1000000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
    });

    it("should reject bar with invalid timeframe", () => {
      const event = {
        type: "md.bar",
        bar: {
          symbol: "AAPL",
          timeframe: "5m", // not "1m"
          tsStart: 1000,
          tsEnd: 2000,
          open: 150.0,
          high: 151.0,
          low: 149.5,
          close: 150.8,
          volume: 1000000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("should validate OHLC ordering", () => {
      const event: MarketDataEvent = {
        type: "md.bar",
        bar: {
          symbol: "AAPL",
          timeframe: "1m",
          tsStart: 1000,
          tsEnd: 2000,
          open: 150.0,
          high: 151.0,
          low: 149.5,
          close: 150.8,
          volume: 1000000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "md.bar") {
        const bar = result.data.bar;
        expect(bar.high).toBeGreaterThanOrEqual(Math.max(bar.open, bar.close));
        expect(bar.low).toBeLessThanOrEqual(Math.min(bar.open, bar.close));
      }
    });
  });

  describe("Event Type Validation", () => {
    it("should reject invalid event type", () => {
      const event = {
        type: "invalid.event",
        data: {},
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });

    it("should require type field", () => {
      const event = {
        quote: {
          symbol: "AAPL",
          bid: 150.5,
          ask: 150.6,
          last: 150.55,
          ts: 1000,
        },
      };

      const result = MarketDataEventSchema.safeParse(event);
      expect(result.success).toBe(false);
    });
  });

  describe("Event Batch Processing", () => {
    it("should validate array of events", () => {
      const events: MarketDataEvent[] = [
        {
          type: "md.quote",
          quote: {
            symbol: "AAPL",
            bid: 150.5,
            ask: 150.6,
            last: 150.55,
            ts: 1000,
          },
        },
        {
          type: "md.print",
          print: {
            symbol: "AAPL",
            price: 150.55,
            size: 500,
            ts: 1001,
          },
        },
      ];

      const result = z.array(MarketDataEventSchema).safeParse(events);
      expect(result.success).toBe(true);
      expect(result.data?.length).toBe(2);
    });

    it("should reject batch with invalid event", () => {
      const events = [
        {
          type: "md.quote",
          quote: {
            symbol: "AAPL",
            bid: 150.5,
            ask: 150.6,
            last: 150.55,
            ts: 1000,
          },
        },
        {
          type: "invalid",
          data: {},
        },
      ];

      const result = z.array(MarketDataEventSchema).safeParse(events);
      expect(result.success).toBe(false);
    });
  });

  describe("Event Type Discriminator", () => {
    it("should distinguish different event types", () => {
      const quoteEvent: MarketDataEvent = {
        type: "md.quote",
        quote: {
          symbol: "AAPL",
          bid: 150.5,
          ask: 150.6,
          last: 150.55,
          ts: 1000,
        },
      };

      const printEvent: MarketDataEvent = {
        type: "md.print",
        print: {
          symbol: "AAPL",
          price: 150.55,
          size: 500,
          ts: 1000,
        },
      };

      const barEvent: MarketDataEvent = {
        type: "md.bar",
        bar: {
          symbol: "AAPL",
          timeframe: "1m",
          tsStart: 1000,
          tsEnd: 2000,
          open: 150.0,
          high: 151.0,
          low: 149.5,
          close: 150.8,
          volume: 1000000,
        },
      };

      expect(quoteEvent.type).toBe("md.quote");
      expect(printEvent.type).toBe("md.print");
      expect(barEvent.type).toBe("md.bar");

      // Type narrowing with discriminator
      if (quoteEvent.type === "md.quote") {
        expect("quote" in quoteEvent).toBe(true);
      }
      if (printEvent.type === "md.print") {
        expect("print" in printEvent).toBe(true);
      }
      if (barEvent.type === "md.bar") {
        expect("bar" in barEvent).toBe(true);
      }
    });
  });
});
