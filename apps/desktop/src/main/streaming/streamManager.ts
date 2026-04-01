import { DemoProducer } from "./demoProducer";
import { AlpacaProducer } from "./alpacaProducer";
import { ReplayEngine } from "../replay/replayEngine";
import { ComputeManager } from "../compute/computeManager";
import type { AlphaSignal, IndicatorUpdate, RegimeUpdate } from "@tc/shared";

type StreamSource = "demo" | "replay" | "live";
type Publish = (evt: unknown) => void;

interface Logger {
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export class StreamManager {
  private publish: Publish;
  private demo: DemoProducer;
  private live: AlpacaProducer;
  private replay: ReplayEngine;
  private compute: ComputeManager;

  // IMPORTANT: start as null so init() can actually transition and start producers
  private source: StreamSource | null = null;

  private hbTimer: NodeJS.Timeout | null = null;
  private hbSeq = 0;

  constructor(publish: Publish, logger?: Logger) {
    this.publish = publish;
    this.demo = new DemoProducer((evt) => this.publishEvent(evt));
    this.live = new AlpacaProducer((evt) => this.publishEvent(evt));
    this.replay = new ReplayEngine((evt) => this.publishEvent(evt));
    this.compute = new ComputeManager(logger);

    // Subscribe to indicator updates from compute manager
    this.compute.subscribe((updates: Array<IndicatorUpdate | RegimeUpdate | AlphaSignal>) => {
      for (const update of updates) {
        this.publishEvent(update);
      }
    });
  }

  private publishEvent(evt: unknown) {
    // Ingest bars into compute engine
    if ((evt as any).type === "market.print") {
      const marketEvent = evt as any;
      // Convert market.print to Bar for indicator computation
      this.compute.ingestBar({
        symbol: marketEvent.symbol,
        ts: marketEvent.ts,
        open: marketEvent.price,
        high: marketEvent.price,
        low: marketEvent.price,
        close: marketEvent.price,
        volume: marketEvent.size || 0,
      });
    }

    this.publish(evt);
  }

  async init() {
    this.startHeartbeat();
    const preferred = (process.env.STREAM_SOURCE ?? "live").toLowerCase();
    const initial = preferred === "live" || preferred === "replay" ? (preferred as StreamSource) : "live";
    
    // Try to start live data first
    if (initial === "live") {
      const canStartLive = await this.canStartLive();
      if (canStartLive) {
        this.setSource("live");
        this.publish({
          type: "system.data.status",
          ts: Date.now(),
          status: "live",
          message: "Connected to live market data",
        });
      } else {
        // No live data available - don't start any source, just send warning
        this.source = null;
        this.publish({
          type: "system.data.status",
          ts: Date.now(),
          status: "unavailable",
          message: "Live data unavailable. Configure API keys in Settings.",
        });
      }
    } else {
      this.setSource(initial);
    }
  }

  shutdown() {
    this.demo.stop();
    this.live.stop();
    this.replay.shutdown();
    this.compute.shutdown();
    if (this.hbTimer) clearInterval(this.hbTimer);
    this.hbTimer = null;
  }

  getSource() {
    return this.source ?? "demo";
  }

  getReplay() {
    return this.replay;
  }

  getStatus() {
    return {
      source: this.getSource(),
      replay: this.replay.getStatus(),
    };
  }

  setSource(next: StreamSource) {
    // Stop current (if any)
    if (this.source === "demo") this.demo.stop();
    if (this.source === "live") this.live.stop();
    if (this.source === "replay") this.replay.pause();

    // Start next - but never start demo automatically
    if (next === "demo") {
      // User manually requested demo mode - allow it
      this.demo.start();
    } else if (next === "live") {
      this.live.start();
    } else {
      this.replay.loadSampleDataset();
      // Keep paused until user hits play
    }

    this.source = next;

    this.publish({
      type: "system.stream.source",
      ts: Date.now(),
      source: next,
    });
  }

  private startHeartbeat() {
    if (this.hbTimer) return;

    this.hbTimer = setInterval(() => {
      this.hbSeq += 1;
      const base = { ts: Date.now(), seq: this.hbSeq, source: this.getSource() };

      // emit both for compatibility
      this.publish({ type: "system.heartbeat", ...base });
      this.publish({ type: "heartbeat", ...base });
    }, 1000);
  }

  private async canStartLive(): Promise<boolean> {
    // Check if Alpaca credentials are available
    try {
      const key = process.env.APCA_API_KEY_ID;
      const secret = process.env.APCA_API_SECRET_KEY;
      
      if (key && secret) {
        return true;
      }

      // Try to get from secrets manager
      const { getSecret } = await import("../secrets");
      const storedKey = await getSecret("APCA_API_KEY_ID");
      const storedSecret = await getSecret("APCA_API_SECRET_KEY");
      
      return !!(storedKey && storedSecret);
    } catch (error) {
      console.warn("[streamManager] Failed to check live data credentials:", error);
      return false;
    }
  }
}