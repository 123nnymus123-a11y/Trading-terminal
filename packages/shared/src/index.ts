export * from './env';
export * from './logger';
export * from './adapters';
export * from './replay';
export * from './publicFlow';
export * from './congress';
export * from './supplyChain';
export * from './supplyChainGraph';
export * from './supplyChainSimulation';
export * from './maritime';
export * from './aviation';
export * from './economicCalendar.ts';
export * from './economicCalendarAdapters';
export * from './economicCalendarService';
export * from './strategy';
export * from './auth';

// Import both and export with clear names to avoid collisions
import {
  BarSchema as MarketBarSchema,
  QuoteSchema as MarketQuoteSchema,
  type MarketDataChannel,
  TradePrintSchema,
  type MarketDataEvent,
  MarketDataEventSchema,
} from './marketData';
import {
  BarSchema as SimpleBarSchema,
  QuoteSchema as IndicatorQuoteSchema,
  type Bar,
  type Quote,
  type IndicatorUpdate,
  IndicatorUpdateSchema,
} from './indicators';

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
} from './events';

export {
  eventSourceSchema,
  heartbeatEventSchema,
  marketPrintEventSchema,
  replayStatusSchema,
  replayStateEventSchema,
  appEventSchema,
  appEventBatchSchema,
  validateAppEventBatch,
} from './events';

export type { StreamSource, StreamStatus } from './streaming';
export { IPC, LEGACY_IPC_ALIASES } from './streaming';
