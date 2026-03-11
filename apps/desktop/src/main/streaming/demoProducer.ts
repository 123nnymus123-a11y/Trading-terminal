export type Publish = (evt: unknown) => void;

export class DemoProducer {
  private publish: Publish;
  private timer: NodeJS.Timeout | null = null;
  private tickTimer: NodeJS.Timeout | null = null;

  private prices: Record<string, { current: number; open: number; high: number; low: number; tick: number }> = {
    AAPL: { current: 190.0, open: 190.0, high: 190.0, low: 190.0, tick: 0 },
    MSFT: { current: 371.0, open: 371.0, high: 371.0, low: 371.0, tick: 0 },
    GOOGL: { current: 155.0, open: 155.0, high: 155.0, low: 155.0, tick: 0 },
    AMZN: { current: 181.0, open: 181.0, high: 181.0, low: 181.0, tick: 0 },
    NVDA: { current: 132.0, open: 132.0, high: 132.0, low: 132.0, tick: 0 },
    TSLA: { current: 233.0, open: 233.0, high: 233.0, low: 233.0, tick: 0 },
    META: { current: 501.0, open: 501.0, high: 501.0, low: 501.0, tick: 0 },
    SPY: { current: 589.0, open: 589.0, high: 589.0, low: 589.0, tick: 0 },
    QQQ: { current: 372.0, open: 372.0, high: 372.0, low: 372.0, tick: 0 },
    DIA: { current: 384.0, open: 384.0, high: 384.0, low: 384.0, tick: 0 },
  };

  constructor(publish: Publish) {
    this.publish = publish;
  }

  start() {
    if (this.timer) return;

    // Generate ticks every 100ms (10 ticks per second)
    this.tickTimer = setInterval(() => {
      for (const [symbol, state] of Object.entries(this.prices)) {
        // Generate realistic price movement
        const volatility = state.current * 0.002; // 0.2% volatility per tick
        const drift = (Math.random() - 0.48) * volatility; // Slight upward bias
        const nextPrice = Math.max(0.01, state.current + drift);

        // Update OHLC
        state.current = nextPrice;
        state.high = Math.max(state.high, nextPrice);
        state.low = Math.min(state.low, nextPrice);
        state.tick += 1;

        // Publish tick
        this.publish({
          type: "market.print",
          ts: Date.now(),
          symbol,
          price: Number(nextPrice.toFixed(4)),
          size: Math.floor(5 + Math.random() * 95),
          source: "demo",
        });
      }
    }, 100);

    // Publish complete 1-minute bars every 60 seconds (for indicator calculation)
    this.timer = setInterval(() => {
      const now = Math.floor(Date.now() / 1000) * 1000; // Round to second
      
      for (const [symbol, state] of Object.entries(this.prices)) {
        const close = state.current;
        
        // Publish complete bar for indicator calculation
        this.publish({
          type: "market.bar",
          ts: now,
          symbol,
          timeframe: "1min",
          open: Number(state.open.toFixed(4)),
          high: Number(state.high.toFixed(4)),
          low: Number(state.low.toFixed(4)),
          close: Number(close.toFixed(4)),
          volume: state.tick * (5 + Math.random() * 95),
          source: "demo",
        });

        // Reset for next bar
        state.open = close;
        state.high = close;
        state.low = close;
        state.tick = 0;
      }
    }, 60000); // Every 60 seconds (1 minute bar)

    // Also emit a bar immediately on start for testing
    setTimeout(() => {
      for (const [symbol, state] of Object.entries(this.prices)) {
        const close = state.current;
        this.publish({
          type: "market.bar",
          ts: Date.now(),
          symbol,
          timeframe: "1min",
          open: Number(state.open.toFixed(4)),
          high: Number(state.high.toFixed(4)),
          low: Number(state.low.toFixed(4)),
          close: Number(close.toFixed(4)),
          volume: state.tick * 50,
          source: "demo",
        });
      }
    }, 2000);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    clearInterval(this.tickTimer!);
    this.timer = null;
    this.tickTimer = null;
  }
}