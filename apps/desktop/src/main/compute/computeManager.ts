import type { AlphaSignal, Bar, IndicatorUpdate, RegimeUpdate } from "@tc/shared";
import path from "node:path";
import { Worker } from "node:worker_threads";

interface Logger {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

type ComputeEvent = IndicatorUpdate | RegimeUpdate | AlphaSignal;
type ComputeListener = (updates: ComputeEvent[]) => void;

export class ComputeManager {
  private listeners = new Set<ComputeListener>();
  private worker: Worker | null = null;
  private workerReady = false;
  private queuedBars: Bar[] = [];

  constructor(private logger?: Logger) {
    const workerPath = path.join(__dirname, "compute", "worker.cjs");
    this.worker = new Worker(workerPath);

    type WorkerMsg = { type: "ready" } | { type: "batch"; events: ComputeEvent[] };
    this.worker.on("message", (msg: WorkerMsg) => {
      if (!msg) return;
      if (msg.type === "ready") {
        this.workerReady = true;
        this.flushQueuedBars();
        this.logger?.log?.("[compute] worker ready");
        return;
      }
      if (msg.type === "batch") {
        const events = msg.events;
        if (Array.isArray(events)) {
          this.emit(events);
        }
      }
    });

    this.worker.on("error", (err) => {
      this.logger?.error?.("[compute] worker error", err);
    });

    this.worker.on("exit", (code) => {
      if (code !== 0) {
        this.logger?.error?.(`[compute] worker exited with code ${code}`);
      }
    });
  }

  private flushQueuedBars() {
    if (!this.worker || !this.workerReady || this.queuedBars.length === 0) return;
    for (const bar of this.queuedBars.splice(0)) {
      this.worker.postMessage({ type: "bar", data: bar });
    }
  }

  ingestBar(bar: Bar) {
    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: "bar", data: bar });
      return;
    }

    this.queuedBars.push(bar);
  }

  subscribe(listener: ComputeListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(events: ComputeEvent[]) {
    for (const listener of this.listeners) {
      try {
        listener(events);
      } catch (err) {
        this.logger?.error?.("[compute] listener error", err);
      }
    }
  }

  shutdown() {
    if (this.worker) {
      try {
        this.worker.postMessage({ type: "shutdown" });
      } catch (err) {
        this.logger?.error?.("[compute] worker shutdown error", err);
      }
      this.worker.terminate();
      this.worker = null;
    }
  }
}
