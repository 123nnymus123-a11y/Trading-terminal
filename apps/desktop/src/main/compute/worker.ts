/**
 * Worker thread for indicator computation
 * Runs independently from main thread and communicates via message passing
 */
import { parentPort } from "node:worker_threads";
import type { Bar } from "@tc/shared";
import { IndicatorEngine } from "./indicatorEngine";

interface WorkerMessage {
  type: "bar" | "quote" | "shutdown";
  data: unknown;
}

let engine: IndicatorEngine | null = null;
const messageQueue: unknown[] = [];
let isProcessing = false;
const BATCH_WINDOW_MS = 50; // Batch messages over 50ms for efficiency
let batchTimer: NodeJS.Timeout | null = null;

function publishEvent(evt: unknown): void {
  messageQueue.push(evt);
  scheduleFlush();
}

function scheduleFlush() {
  if (isProcessing || batchTimer) return;

  batchTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
}

function flushBatch() {
  batchTimer = null;
  if (messageQueue.length === 0) return;

  isProcessing = true;
  const batch = messageQueue.splice(0);

  parentPort?.postMessage({
    type: "batch",
    events: batch,
  });

  isProcessing = false;
  if (messageQueue.length > 0) scheduleFlush();
}

if (parentPort) {
  // Initialize engine on first message
  engine = new IndicatorEngine(publishEvent);

  parentPort.on("message", (msg: WorkerMessage) => {
    if (!engine) return;

    switch (msg.type) {
      case "bar": {
        const update = engine.ingestBar(msg.data as Bar);
        if (update) publishEvent(update);
        break;
      }

      case "shutdown": {
        flushBatch();
        process.exit(0);
        break;
      }
    }
  });

  parentPort.postMessage({ type: "ready" });
}
