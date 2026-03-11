import type { MarketDataChannel, MarketDataEvent } from "./marketData";

export interface MarketDataAdapter {
  readonly id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(symbols: string[], channels: MarketDataChannel[]): void;
  unsubscribe(symbols: string[], channels?: MarketDataChannel[]): void;
  onEvent(handler: (event: MarketDataEvent) => void): () => void;
}

export interface BrokerAdapter {
  readonly id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
