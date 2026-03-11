import fs from "node:fs";
import path from "node:path";

export type Publish = (evt: unknown) => void;
type PrintRow = { ts: number; symbol: string; price: number; size: number };
type ReplayState = "stopped" | "paused" | "playing";

function resolveDatasetPath(relFromRepoRoot: string) {
  const candidates = [
    path.resolve(process.cwd(), relFromRepoRoot),
    path.resolve(process.cwd(), "apps/desktop", relFromRepoRoot),
    path.resolve(__dirname, "..", "..", relFromRepoRoot), // dist-ish fallback
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

export class ReplayEngine {
  private publish: Publish;

  private data: PrintRow[] = [];
  private idx = 0;

  private state: ReplayState = "stopped";
  private speed = 1; // 0.5x/1x/2x/5x
  private timer: NodeJS.Timeout | null = null;

  private startTs = 0;
  private endTs = 0;

  constructor(publish: Publish) {
    this.publish = publish;
  }

  loadSampleDataset() {
    const p = resolveDatasetPath("src/main/replay/datasets/sample-prints.json");
    if (!p) {
      console.warn("[ReplayEngine] Unable to resolve dataset path");
      return;
    }
    const raw = fs.readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as PrintRow[];

    this.data = parsed.slice().sort((a, b) => a.ts - b.ts);
    this.idx = 0;

    this.startTs = this.data[0]?.ts ?? 0;
    this.endTs = this.data[this.data.length - 1]?.ts ?? 0;

    this.state = "paused";
    this.emitState();
  }

  getStatus() {
    const cursorTs = this.data[this.idx]?.ts ?? this.endTs ?? 0;
    return {
      state: this.state,
      speed: this.speed,
      startTs: this.startTs,
      endTs: this.endTs,
      cursorTs,
      count: this.data.length,
    };
  }

  setSpeed(speed: number) {
    const s = Number(speed);
    if (![0.5, 1, 2, 5].includes(s)) return;
    this.speed = s;
    this.emitState();
  }

  play() {
    if (this.data.length === 0) this.loadSampleDataset();
    if (this.data.length === 0) return;

    this.state = "playing";
    this.emitState();
    this.scheduleNext(0);
  }

  pause() {
    if (this.state !== "playing") {
      this.state = "paused";
      this.emitState();
      return;
    }
    this.state = "paused";
    this.clearTimer();
    this.emitState();
  }

  stop(resetToStart = true) {
    this.clearTimer();
    this.state = "stopped";
    if (resetToStart) this.idx = 0;
    this.emitState();
  }

  scrubTo(ts: number) {
    if (this.data.length === 0) this.loadSampleDataset();
    const target = Number(ts);
    let lo = 0, hi = this.data.length - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.data[mid]?.ts! >= target) { ans = mid; hi = mid - 1; }
      else lo = mid + 1;
    }
    this.idx = ans;
    this.emitState();

    // If playing, immediately continue from the new point
    if (this.state === "playing") {
      this.clearTimer();
      this.scheduleNext(0);
    }
  }

  shutdown() {
    this.clearTimer();
  }

  private emitState() {
    this.publish({
      type: "system.replay.state",
      ts: Date.now(),
      state: this.getStatus(),
      source: "replay",
    });
  }

  private scheduleNext(delayMs: number) {
    if (this.timer) clearTimeout(this.timer);

    this.timer = setTimeout(() => {
      if (this.state !== "playing") return;

      const row = this.data[this.idx];
      if (!row) {
        this.stop(false);
        return;
      }

      this.publish({
        type: "market.print",
        ts: row.ts,
        symbol: row.symbol,
        price: row.price,
        size: row.size,
        source: "replay",
      });

      const cur = this.data[this.idx];
      const next = this.data[this.idx + 1];
      this.idx += 1;

      if (!next) {
        this.stop(false);
        return;
      }

      const dt = Math.max(0, cur && cur.ts > 0 ? next.ts - cur.ts : 0);
      const scaled = Math.max(0, Math.floor(dt / this.speed));
      this.scheduleNext(scaled);
    }, Math.max(0, delayMs));
  }

  private clearTimer() {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}