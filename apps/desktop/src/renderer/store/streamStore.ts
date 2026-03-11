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

    const nextPrices = { ...get().lastPrices };
    let nextHb = get().lastHeartbeat;
    let nextSource = get().source;
    let nextReplay = get().replay;

    for (const e of events) {
      if (e.type === "system.heartbeat") {
        nextHb = { seq: e.seq, ts: e.ts };
        nextSource = (e.source as any) ?? nextSource;
      }

      if (e.type === "market.print") {
        nextPrices[e.symbol] = {
          price: e.price,
          ts: e.ts,
          source: (e.source as any) ?? "demo",
        };
        nextSource = (e.source as any) ?? nextSource;
      }

      if (e.type === "system.replay.state") {
        nextReplay = e.state;
        nextSource = "replay";
      }
    }

    set({
      lastHeartbeat: nextHb,
      lastPrices: nextPrices,
      source: nextSource,
      replay: nextReplay,
    });
  },
}));
