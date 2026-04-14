import { create } from "zustand";
import type { AppEvent, ReplayStatus } from "@tc/shared";

type LastPrice = { price: number; ts: number; source: "demo" | "replay" | "live" };

type StreamState = {
  preloadOk: boolean;
  source: "demo" | "replay" | "live" | "unknown";
  lastHeartbeat: { seq: number; ts: number } | null;
  lastPrices: Record<string, LastPrice>;
  replay: ReplayStatus | null;

  setPreloadOk: (ok: boolean) => void;
  setSource: (src: StreamState["source"]) => void;
  setReplay: (r: ReplayStatus | null) => void;

  ingest: (events: AppEvent[]) => void;
};

export const useStreamStore = create<StreamState>((set, get) => ({
  preloadOk: false,
  source: "unknown",
  lastHeartbeat: null,
  lastPrices: {},
  replay: null,

  setPreloadOk: (ok) => set({ preloadOk: ok }),
  setSource: (src) => set({ source: src }),
  setReplay: (r) => set({ replay: r }),

  ingest: (events) => {
    if (!events.length) return;

    const state = get();
    let nextPrices = state.lastPrices;
    let nextHb = state.lastHeartbeat;
    let nextSource = state.source;
    let nextReplay = state.replay;
    let pricesChanged = false;
    let heartbeatChanged = false;
    let sourceChanged = false;
    let replayChanged = false;

    for (const e of events) {
      if (e.type === "system.heartbeat") {
        if (!nextHb || nextHb.seq !== e.seq || nextHb.ts !== e.ts) {
          nextHb = { seq: e.seq, ts: e.ts };
          heartbeatChanged = true;
        }
        const hbSource = (e.source as any) ?? nextSource;
        if (hbSource !== nextSource) {
          nextSource = hbSource;
          sourceChanged = true;
        }
      }

      if (e.type === "market.print") {
        const current = nextPrices[e.symbol];
        const next = {
          price: e.price,
          ts: e.ts,
          source: (e.source as any) ?? "demo",
        };
        if (
          !current ||
          current.price !== next.price ||
          current.ts !== next.ts ||
          current.source !== next.source
        ) {
          if (!pricesChanged) {
            nextPrices = { ...nextPrices };
            pricesChanged = true;
          }
          nextPrices[e.symbol] = next;
        }
        const printSource = (e.source as any) ?? nextSource;
        if (printSource !== nextSource) {
          nextSource = printSource;
          sourceChanged = true;
        }
      }

      if (e.type === "system.replay.state") {
        if (nextReplay !== e.state) {
          nextReplay = e.state;
          replayChanged = true;
        }
        if (nextSource !== "replay") {
          nextSource = "replay";
          sourceChanged = true;
        }
      }
    }

    if (!pricesChanged && !heartbeatChanged && !sourceChanged && !replayChanged) {
      return;
    }

    set({
      ...(heartbeatChanged ? { lastHeartbeat: nextHb } : {}),
      ...(pricesChanged ? { lastPrices: nextPrices } : {}),
      ...(sourceChanged ? { source: nextSource } : {}),
      ...(replayChanged ? { replay: nextReplay } : {}),
    });
  },
}));
