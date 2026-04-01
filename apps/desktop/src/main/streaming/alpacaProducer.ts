import { getSecret } from "../secrets";

type Publish = (evt: unknown) => void;

type AlpacaTrade = { t?: string; p?: number; s?: number };

type AlpacaQuote = { t?: string; ap?: number; bp?: number; as?: number; bs?: number };

type AlpacaTradesResponse = {
  trades?: Record<string, AlpacaTrade | undefined>;
};

type AlpacaQuotesResponse = {
  quotes?: Record<string, AlpacaQuote | undefined>;
};

const DEFAULT_SYMBOLS = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META"];

function parseSymbols(raw?: string): string[] {
  if (!raw) return DEFAULT_SYMBOLS;
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

function toEpochMs(value?: string): number {
  if (!value) return Date.now();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return Date.now();
  return date.getTime();
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json", ...headers },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} - ${body.slice(0, 300)}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

export class AlpacaProducer {
  private publish: Publish;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  private symbols: string[] = [];
  private pollMs: number;
  private baseUrl: string;
  private feed: string;

  constructor(publish: Publish) {
    this.publish = publish;
    this.symbols = parseSymbols(process.env.ALPACA_MARKET_DATA_SYMBOLS);
    this.pollMs = Number(process.env.ALPACA_POLL_MS ?? 1000);
    this.baseUrl = process.env.ALPACA_DATA_BASE_URL ?? "https://data.alpaca.markets";
    this.feed = process.env.ALPACA_DATA_FEED ?? "iex";
  }

  start() {
    if (this.timer) return;
    void this.startAsync();
  }

  private async startAsync() {
    const auth = await this.resolveAuth();
    if (!auth) {
      console.warn("[alpaca-live] missing APCA_API_KEY_ID or APCA_API_SECRET_KEY; live stream disabled");
      return;
    }

    this.timer = setInterval(() => {
      void this.pollOnce(auth);
    }, this.pollMs);

    void this.pollOnce(auth);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  private async resolveAuth(): Promise<{ key: string; secret: string } | null> {
    const key = process.env.APCA_API_KEY_ID;
    const secret = process.env.APCA_API_SECRET_KEY;
    if (key && secret) return { key, secret };

    try {
      const storedKey = await getSecret("APCA_API_KEY_ID");
      const storedSecret = await getSecret("APCA_API_SECRET_KEY");
      if (storedKey && storedSecret) return { key: storedKey, secret: storedSecret };
    } catch {
      // ignore and fall through to null
    }

    return null;
  }

  private async pollOnce(auth: { key: string; secret: string }) {
    if (this.busy) return;
    this.busy = true;
    try {
      const symbols = this.symbols.join(",");
      const headers = {
        "APCA-API-KEY-ID": auth.key,
        "APCA-API-SECRET-KEY": auth.secret,
      };

      const tradeUrl = `${this.baseUrl}/v2/stocks/trades/latest?symbols=${encodeURIComponent(symbols)}&feed=${encodeURIComponent(this.feed)}`;
      const tradeJson = (await fetchJson(tradeUrl, headers)) as AlpacaTradesResponse;
      const trades = tradeJson.trades ?? {};

      const missing: string[] = [];
      for (const symbol of this.symbols) {
        const trade = trades[symbol];
        if (trade?.p != null) {
          this.publish({
            type: "market.print",
            ts: toEpochMs(trade.t),
            symbol,
            price: trade.p,
            size: trade.s ?? 0,
            source: "live",
          });
        } else {
          missing.push(symbol);
        }
      }

      if (missing.length > 0) {
        const quoteUrl = `${this.baseUrl}/v2/stocks/quotes/latest?symbols=${encodeURIComponent(missing.join(","))}&feed=${encodeURIComponent(this.feed)}`;
        const quoteJson = (await fetchJson(quoteUrl, headers)) as AlpacaQuotesResponse;
        const quotes = quoteJson.quotes ?? {};

        for (const symbol of missing) {
          const quote = quotes[symbol];
          if (!quote) continue;
          const bid = quote.bp ?? undefined;
          const ask = quote.ap ?? undefined;
          const mid = bid != null && ask != null ? (bid + ask) / 2 : bid ?? ask ?? undefined;
          if (mid == null) continue;
          this.publish({
            type: "market.print",
            ts: toEpochMs(quote.t),
            symbol,
            price: mid,
            size: 0,
            source: "live",
          });
        }
      }
    } catch (err) {
      console.warn("[alpaca-live] poll failed:", err instanceof Error ? err.message : err);
    } finally {
      this.busy = false;
    }
  }
}
