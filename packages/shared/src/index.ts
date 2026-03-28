export * from "./env.js";
export * from "./logger.js";
export * from "./adapters.js";
export * from "./replay.js";
export * from "./publicFlow/index.js";
export * from "./congress/index.js";
export * from "./supplyChain.js";
export * from "./supplyChainGraph.js";
export * from "./supplyChainSimulation.js";
export * from "./maritime.js";
export * from "./aviation.js";
export * from "./economicCalendar.js";
export * from "./economicCalendarAdapters.js";
export * from "./economicCalendarService.js";
export * from "./strategy.js";
export * from "./strategyResearch.js";
export * from "./auth.js";
export * from "./graphMemory.js";
export * from "./tedIntel.js";
export * from "./procurementIntel.js";
export * from "./edgarIntel.js";
export * from "./exposureBrief.js";

// Import both and export with clear names to avoid collisions
import {
  BarSchema as MarketBarSchema,
  QuoteSchema as MarketQuoteSchema,
  type MarketDataChannel,
  TradePrintSchema,
  type MarketDataEvent,
  MarketDataEventSchema,
} from "./marketData.js";
import {
  BarSchema as SimpleBarSchema,
  QuoteSchema as IndicatorQuoteSchema,
  type Bar,
  type Quote,
  type IndicatorUpdate,
  IndicatorUpdateSchema,
} from "./indicators.js";

// Re-export with distinct names
export {
  MarketBarSchema,
  MarketQuoteSchema,
  type MarketDataChannel,
  TradePrintSchema,
  type MarketDataEvent,
  MarketDataEventSchema,
};
export {
  SimpleBarSchema as BarSchema,
  IndicatorQuoteSchema as QuoteSchema,
  type Bar,
  type Quote,
  type IndicatorUpdate,
  IndicatorUpdateSchema,
};

// IMPORTANT: avoid star-export collisions by exporting events explicitly (no duplicate validateAppEventBatch elsewhere)
export type {
  EventSource,
  HeartbeatEvent,
  MarketPrintEvent,
  ReplayStatus,
  ReplayStateEvent,
  AppEvent,
  AppEventBatch,
} from "./events.js";

export {
  eventSourceSchema,
  heartbeatEventSchema,
  marketPrintEventSchema,
  replayStatusSchema,
  replayStateEventSchema,
  appEventSchema,
  appEventBatchSchema,
  validateAppEventBatch,
} from "./events.js";

export type { StreamSource, StreamStatus } from "./streaming.js";
export { IPC, LEGACY_IPC_ALIASES } from "./streaming.js";
