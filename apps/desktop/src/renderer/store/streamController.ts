import { validateAppEventBatch } from "@tc/shared";
import { useStreamStore } from "./streamStore";
import { startBackendStream } from "../lib/backendStream";

let started = false;
let stopBackendStream: (() => void) | null = null;

export function startStreamController() {
  console.log("[streamController] startStreamController called");
  if (started) {
    console.log("[streamController] already started, returning");
    return;
  }
  started = true;

  const api = window.streaming;

  if (!api) {
    console.warn("[streamController] window.streaming missing, switching to backend websocket stream");
    useStreamStore.getState().setPreloadOk(true);

    void startBackendStream((batch) => {
      const safe = validateAppEventBatch(batch);
      if (safe.length) {
        useStreamStore.getState().ingest(safe);
      }
    })
      .then((control) => {
        stopBackendStream = control.stop;
        console.log("[streamController] backend websocket stream connected ✅");
      })
      .catch((error) => {
        useStreamStore.getState().setPreloadOk(false);
        console.error("[streamController] backend websocket stream failed", error);
      });

    return;
  }

  console.log("[streamController] window.streaming found, setting preloadOk=true");
  useStreamStore.getState().setPreloadOk(true);

  // Best-effort initial status
  if (typeof api.getStatus === "function") {
    Promise.resolve(api.getStatus())
      .then((s) => {
        if (s?.source === "demo" || s?.source === "replay" || s?.source === "live") {
          useStreamStore.getState().setSource(s.source);
        }
        if (s?.replay) useStreamStore.getState().setReplay(s.replay);
      })
      .catch(() => void 0);
  }

  const subscribeBatch =
    (typeof api.onEvents === "function" && api.onEvents) ||
    (typeof api.onEventBatch === "function" && api.onEventBatch) ||
    (typeof api.onEventsBatch === "function" && api.onEventsBatch) ||
    (typeof api.subscribeBatch === "function" && api.subscribeBatch);

  if (!subscribeBatch) {
    console.warn("[streamController] no batch subscription function found on window.streaming");
    return;
  }

  const off = subscribeBatch((batch: unknown) => {
    const safe = validateAppEventBatch(batch);
    if (safe.length) useStreamStore.getState().ingest(safe);
  });

  console.log("[streamController] subscribed ✅");

  // Some preload implementations return void (not an off function) — that’s ok.
  if (typeof off === "function") {
    // optional cleanup hook point (not used yet)
  }
}

export function stopStreamController() {
  if (typeof stopBackendStream === "function") {
    stopBackendStream();
  }
  stopBackendStream = null;
  started = false;
}
