import {
  MarketDataEventSchema,
  type MarketDataEvent,
  type MarketDataChannel,
} from "@tc/shared";

/**
 * DemoMarketDataAdapter
 * - Emits md.quote + md.print at ~1s cadence
 * - Emits md.bar (1m) derived from prints
 * - Session gating + volatility config
 */
export class DemoMarketDataAdapter {
  readonly id = "demo-market-data";

  private handlers = new Set<(e: MarketDataEvent) => void>();
  private timer: NodeJS.Timeout | undefined = undefined;

  private subscribedSymbols = new Set<string>();
  private subscribedChannels = new Set<MarketDataChannel>();

  private lastPrice: Record<string, number> = {};
  private lastTradeId: Record<string, number> = {};

  // 1m bar aggregation state per symbol
  private barState: Record<
    string,
    | {
        minuteStartTs: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      }
    | undefined
  > = {};

  // Config
  private cfg: {
    watchlistDefault: string[];
    cadenceMs: number;

    // “sigma” of per-second move in dollars (simple model)
    volatility: number;

    // Session time in LOCAL time (HH:mm). Outside session -> no ticks.
    sessionStart: string; // "09:30"
    sessionEnd: string; // "16:00"

    // Optional: if true, still runs outside session (but slower)
    runOutsideSession: boolean;
    outsideSessionCadenceMs: number;
  };

  constructor(opts?: Partial<DemoMarketDataAdapter["cfg"]>) {
    this.cfg = {
      watchlistDefault: ["AAPL", "MSFT", "NVDA", "TSLA"],
      cadenceMs: 1000,
      volatility: 0.35, // ~35 cents per second typical-ish for demo
      sessionStart: "09:30",
      sessionEnd: "16:00",
      runOutsideSession: true,
      outsideSessionCadenceMs: 2500,
      ...opts,
    };

    // seed prices for defaults (and any later symbols when subscribed)
    for (const s of this.cfg.watchlistDefault) {
      this.seedSymbol(s);
    }
  }

  // ------------------------------------------------------------
  // Interface-ish surface
  // ------------------------------------------------------------

  onEvent(handler: (e: MarketDataEvent) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  subscribe(symbols: string[], channels: MarketDataChannel[]) {
    for (const s of symbols) {
      const sym = s.trim().toUpperCase();
      if (!sym) continue;
      this.subscribedSymbols.add(sym);
      this.seedSymbol(sym);
    }
    for (const c of channels) this.subscribedChannels.add(c);

    // if nothing passed, subscribe to defaults
    if (this.subscribedSymbols.size === 0) {
      for (const s of this.cfg.watchlistDefault) this.subscribedSymbols.add(s);
    }

    // start if needed
    void this.connect();
  }

  unsubscribe(symbols?: string[], channels?: MarketDataChannel[]) {
    if (symbols && symbols.length) {
      for (const s of symbols) this.subscribedSymbols.delete(s.trim().toUpperCase());
    }
    if (channels && channels.length) {
      for (const c of channels) this.subscribedChannels.delete(c);
    }

    // if fully empty, stop
    if (this.subscribedSymbols.size === 0 || this.subscribedChannels.size === 0) {
      void this.disconnect();
    }
  }

  async connect() {
    if (this.timer) return;

    // If no channels specified, assume quotes+bards for demo
    if (this.subscribedChannels.size === 0) {
      this.subscribedChannels.add("quotes");
      this.subscribedChannels.add("bars");
    }
    if (this.subscribedSymbols.size === 0) {
      for (const s of this.cfg.watchlistDefault) this.subscribedSymbols.add(s);
    }

    this.timer = setInterval(() => this.tick(), this.cfg.cadenceMs);
  }

  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  // ------------------------------------------------------------
  // internals
  // ------------------------------------------------------------

  private emit(e: MarketDataEvent) {
    const parsed = MarketDataEventSchema.parse(e);
    for (const h of this.handlers) h(parsed);
  }

  private seedSymbol(sym: string) {
    if (typeof this.lastPrice[sym] === "number") return;
    this.lastPrice[sym] = 100 + Math.random() * 60; // 100..160
    this.lastTradeId[sym] = 0;
  }

  private nowMinuteStart(ts: number) {
    return Math.floor(ts / 60000) * 60000;
  }

  private isInSessionNow() {
    const now = new Date();
    const [sh = 9, sm = 30] = this.cfg.sessionStart.split(":").map((x) => parseInt(x, 10));
    const [eh = 16, em = 0] = this.cfg.sessionEnd.split(":").map((x) => parseInt(x, 10));

    const start = new Date(now);
    start.setHours(sh, sm, 0, 0);

    const end = new Date(now);
    end.setHours(eh, em, 0, 0);

    return now >= start && now <= end;
  }

  private normal01() {
    // Box–Muller
    let u = 0,
      v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  private tick() {
    const inSession = this.isInSessionNow();

    // optional: slow down outside session instead of fully stopping
    if (!inSession && this.cfg.runOutsideSession && this.timer) {
      // if cadence differs, swap interval
      if (this.cfg.outsideSessionCadenceMs !== this.cfg.cadenceMs) {
        clearInterval(this.timer);
        this.timer = setInterval(() => this.tick(), this.cfg.outsideSessionCadenceMs);
      }
    } else if (inSession && this.timer) {
      // restore normal cadence
      if (this.cfg.runOutsideSession && this.cfg.outsideSessionCadenceMs !== this.cfg.cadenceMs) {
        // only restore if currently on outside cadence
        // (cheap way: always reset once we re-enter session)
        clearInterval(this.timer);
        this.timer = setInterval(() => this.tick(), this.cfg.cadenceMs);
      }
    }

    // if you want “no ticks outside session”, flip runOutsideSession=false in cfg
    if (!inSession && !this.cfg.runOutsideSession) return;

    const ts = Date.now();

    const wantQuotes = this.subscribedChannels.has("quotes");
    const wantBars = this.subscribedChannels.has("bars");

    // requirement: Quote + TradePrint at ~1s cadence for watchlist
    // We will always emit prints when quotes are requested (typical feed behavior).
    for (const sym of this.subscribedSymbols) {
      const prev = this.lastPrice[sym] ?? 100;
      const move = this.normal01() * this.cfg.volatility;

      // tiny mean reversion to keep it bounded in demo
      const anchor = 120;
      const reversion = (anchor - prev) * 0.002;

      let next = prev + move + reversion;

      // prevent negative
      next = Math.max(1, next);

      // mild spread model
      const spread = Math.max(0.01, Math.min(0.08, 0.01 + Math.abs(this.normal01()) * 0.01));
      const bid = next - spread / 2;
      const ask = next + spread / 2;

      this.lastPrice[sym] = next;

      // md.quote
      if (wantQuotes) {
        this.emit({
          type: "md.quote",
          quote: {
            symbol: sym,
            bid,
            ask,
            last: next,
            ts,
          },
        });
      }

      // md.print (TradePrint)
      // Use “last” as trade price; add small random size
      // Only emit prints if quotes channel is active OR if someone explicitly wants ticks (not in shared list).
      // Your shared channels only list quotes/bars/... so we tie prints to quotes.
      if (wantQuotes) {
        const id = (this.lastTradeId[sym] ?? 0) + 1;
        this.lastTradeId[sym] = id;

        const size = Math.max(1, Math.floor(10 + Math.random() * 400)); // 10..410 shares
        this.emit({
          type: "md.print",
          print: {
            symbol: sym,
            price: next,
            size,
            ts,
          },
        });

        // bar aggregation derived from prints
        if (wantBars) {
          this.ingestPrintIntoBar(sym, next, size, ts);
        }
      } else {
        // If no quotes are subscribed but bars are, still build bars from synthetic prints
        if (wantBars) {
          const size = Math.max(1, Math.floor(10 + Math.random() * 400));
          this.ingestPrintIntoBar(sym, next, size, ts);
        }
      }
    }

    // finalize bars for symbols that rolled over minute boundary
    if (wantBars) {
      this.flushRolledBars(ts);
    }
  }

  private ingestPrintIntoBar(sym: string, price: number, size: number, ts: number) {
    const minuteStartTs = this.nowMinuteStart(ts);
    const st = this.barState[sym];

    if (!st || st.minuteStartTs !== minuteStartTs) {
      // if there is an existing bar, emit it before starting new one
      if (st) {
        this.emit({
          type: "md.bar",
          bar: {
            symbol: sym,
            timeframe: "1m" as const,
            tsStart: st.minuteStartTs,
            tsEnd: st.minuteStartTs + 60000,
            open: st.open,
            high: st.high,
            low: st.low,
            close: st.close,
            volume: st.volume,
          },
        });
      }

      this.barState[sym] = {
        minuteStartTs,
        open: price,
        high: price,
        low: price,
        close: price,
        volume: size,
      };
      return;
    }

    // update current minute bar
    st.high = Math.max(st.high, price);
    st.low = Math.min(st.low, price);
    st.close = price;
    st.volume += size;
  }

  private flushRolledBars(nowTs: number) {
    const curMin = this.nowMinuteStart(nowTs);
    for (const sym of Object.keys(this.barState)) {
      const st = this.barState[sym];
      if (!st) continue;

      // if bar is older than current minute, emit and keep state for next prints
      if (st.minuteStartTs < curMin) {
        this.emit({
          type: "md.bar",
          bar: {
            symbol: sym,
            timeframe: "1m" as const,
            tsStart: st.minuteStartTs,
            tsEnd: st.minuteStartTs + 60000,
            open: st.open,
            high: st.high,
            low: st.low,
            close: st.close,
            volume: st.volume,
          },
        });

        // keep state undefined until next print arrives (so open is correct)
        this.barState[sym] = undefined;
      }
    }
  }
}


