import type { WebContents } from "electron";
import { EventBus } from "./eventBus";

export function attachIpcStreaming(bus: EventBus, webContents: WebContents) {
  let buffer: unknown[] = [];
  let dropped = 0;

  const unsub = bus.subscribe((evt) => {
    // basic backpressure: cap buffer size
    if (buffer.length > 5000) {
      dropped += 1;
      // drop oldest (keeps UI responsive)
      buffer = buffer.slice(-2000);
    }
    buffer.push(evt);
  });

  const timer = setInterval(() => {
    if (webContents.isDestroyed()) return;
    if (buffer.length === 0) return;

    const batch = buffer.splice(0, buffer.length);
    webContents.send("cockpit:events", batch);

    // optional: occasionally tell renderer if drops happened
    if (dropped > 0 && dropped % 50 === 0) {
      webContents.send("cockpit:events", [{
        type: "system.warn",
        ts: Date.now(),
        message: `ipcStreaming dropped ${dropped} events (backpressure)`
      }]);
    }
  }, 100); // 10Hz batching

  return () => {
    clearInterval(timer);
    unsub();
  };
}