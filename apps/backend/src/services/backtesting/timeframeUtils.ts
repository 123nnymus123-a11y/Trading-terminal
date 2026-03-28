import type { OHLCVBar } from "./historicalDataProvider.js";

export type SupportedTimeframe =
  | "event"
  | "minute"
  | "5minute"
  | "15minute"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly";

export type TimeframeSummary = {
  baseFrequency: SupportedTimeframe;
  inferredMs: number | null;
  supportedViews: SupportedTimeframe[];
};

export function groupBarsBySymbol(bars: OHLCVBar[]): Map<string, OHLCVBar[]> {
  const grouped = new Map<string, OHLCVBar[]>();
  for (const bar of bars) {
    const existing = grouped.get(bar.symbol) ?? [];
    existing.push(bar);
    grouped.set(bar.symbol, existing);
  }
  for (const list of grouped.values()) {
    list.sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    );
  }
  return grouped;
}

export function detectTimeframe(bars: OHLCVBar[]): TimeframeSummary {
  if (bars.length < 2) {
    return {
      baseFrequency: "event",
      inferredMs: null,
      supportedViews: [
        "event",
        "minute",
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ],
    };
  }

  const deltas: number[] = [];
  for (let index = 1; index < bars.length; index++) {
    const previous = new Date(bars[index - 1]!.timestamp).getTime();
    const current = new Date(bars[index]!.timestamp).getTime();
    if (current > previous) {
      deltas.push(current - previous);
    }
  }

  if (deltas.length === 0) {
    return {
      baseFrequency: "event",
      inferredMs: null,
      supportedViews: [
        "event",
        "minute",
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ],
    };
  }

  deltas.sort((a, b) => a - b);
  const median = deltas[Math.floor(deltas.length / 2)] ?? null;
  if (median === null) {
    return {
      baseFrequency: "event",
      inferredMs: null,
      supportedViews: [
        "event",
        "minute",
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ],
    };
  }

  if (median <= 60_000) {
    return {
      baseFrequency: "minute",
      inferredMs: median,
      supportedViews: [
        "event",
        "minute",
        "5minute",
        "15minute",
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ],
    };
  }
  if (median <= 5 * 60_000) {
    return {
      baseFrequency: "5minute",
      inferredMs: median,
      supportedViews: [
        "event",
        "5minute",
        "15minute",
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ],
    };
  }
  if (median <= 15 * 60_000) {
    return {
      baseFrequency: "15minute",
      inferredMs: median,
      supportedViews: [
        "event",
        "15minute",
        "hourly",
        "daily",
        "weekly",
        "monthly",
      ],
    };
  }
  if (median <= 60 * 60_000) {
    return {
      baseFrequency: "hourly",
      inferredMs: median,
      supportedViews: ["event", "hourly", "daily", "weekly", "monthly"],
    };
  }
  if (median <= 36 * 60 * 60_000) {
    return {
      baseFrequency: "daily",
      inferredMs: median,
      supportedViews: ["event", "daily", "weekly", "monthly"],
    };
  }
  if (median <= 10 * 24 * 60 * 60_000) {
    return {
      baseFrequency: "weekly",
      inferredMs: median,
      supportedViews: ["event", "weekly", "monthly"],
    };
  }
  return {
    baseFrequency: "monthly",
    inferredMs: median,
    supportedViews: ["event", "monthly"],
  };
}

function timeframeBucket(date: Date, timeframe: SupportedTimeframe): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = date.getUTCMinutes();

  if (timeframe === "event") {
    return date.toISOString();
  }
  if (timeframe === "minute") {
    return `${year}-${month}-${day}T${hour}:${String(minute).padStart(2, "0")}:00.000Z`;
  }
  if (timeframe === "5minute") {
    const bucket = Math.floor(minute / 5) * 5;
    return `${year}-${month}-${day}T${hour}:${String(bucket).padStart(2, "0")}:00.000Z`;
  }
  if (timeframe === "15minute") {
    const bucket = Math.floor(minute / 15) * 15;
    return `${year}-${month}-${day}T${hour}:${String(bucket).padStart(2, "0")}:00.000Z`;
  }
  if (timeframe === "hourly") {
    return `${year}-${month}-${day}T${hour}:00:00.000Z`;
  }
  if (timeframe === "daily") {
    return `${year}-${month}-${day}T00:00:00.000Z`;
  }
  if (timeframe === "weekly") {
    const copy = new Date(
      Date.UTC(year, date.getUTCMonth(), date.getUTCDate()),
    );
    const weekday = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() - (weekday - 1));
    return copy.toISOString();
  }
  return `${year}-${month}-01T00:00:00.000Z`;
}

export function resampleBars(
  bars: OHLCVBar[],
  timeframe: SupportedTimeframe,
): OHLCVBar[] {
  if (timeframe === "event") {
    return bars.slice();
  }

  const buckets = new Map<string, OHLCVBar[]>();
  for (const bar of bars) {
    const bucket = timeframeBucket(new Date(bar.timestamp), timeframe);
    const existing = buckets.get(bucket) ?? [];
    existing.push(bar);
    buckets.set(bucket, existing);
  }

  return Array.from(buckets.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([bucket, bucketBars]) => {
      const first = bucketBars[0]!;
      const last = bucketBars[bucketBars.length - 1]!;
      const high = Math.max(...bucketBars.map((item) => item.high));
      const low = Math.min(...bucketBars.map((item) => item.low));
      const volume = bucketBars.reduce((sum, item) => sum + item.volume, 0);
      return {
        timestamp: bucket,
        symbol: first.symbol,
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
      } satisfies OHLCVBar;
    });
}

export function getCurrentTimeframeBar(
  bars: OHLCVBar[],
  currentTimestamp: string,
  timeframe: SupportedTimeframe,
  offset = 0,
): OHLCVBar | null {
  const resampled = resampleBars(bars, timeframe);
  const currentBucket = timeframeBucket(new Date(currentTimestamp), timeframe);
  const currentIndex = resampled.findIndex(
    (bar) => bar.timestamp === currentBucket,
  );
  if (currentIndex < 0) {
    return null;
  }
  return resampled[currentIndex - offset] ?? null;
}

export function getTimeframeWindow(
  bars: OHLCVBar[],
  currentTimestamp: string,
  timeframe: SupportedTimeframe,
  lookback: number,
): OHLCVBar[] {
  const resampled = resampleBars(bars, timeframe);
  const currentBucket = timeframeBucket(new Date(currentTimestamp), timeframe);
  const currentIndex = resampled.findIndex(
    (bar) => bar.timestamp === currentBucket,
  );
  if (currentIndex < 0) {
    return [];
  }
  return resampled.slice(
    Math.max(0, currentIndex - lookback + 1),
    currentIndex + 1,
  );
}
