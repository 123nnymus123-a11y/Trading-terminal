import { create } from "zustand";

export type WatchlistItem = { id: number; symbol: string; note: string };

type ConfigState = {
  watchlists: WatchlistItem[];
  layoutSelection: { [symbol: string]: string };
  loadInitial: () => Promise<void>;
  addWatchlist: (symbol: string, note?: string) => Promise<void>;
  updateWatchlist: (id: number, fields: { symbol?: string; note?: string }) => Promise<void>;
  removeWatchlist: (id: number) => Promise<void>;
  setLayoutPreset: (symbol: string, preset: string, data?: unknown) => Promise<void>;
};

export const useConfigStore = create<ConfigState>((set, get) => ({
  watchlists: [],
  layoutSelection: {},

  async loadInitial() {
    const wl = (await window.cockpit?.config?.watchlistsList?.()) ?? [];
    const settings = (await window.cockpit?.config?.settingsGet?.()) ?? {};
    const layoutSel =
      settings && typeof settings.layoutSelection === "object" && settings.layoutSelection
        ? (settings.layoutSelection as { [symbol: string]: string })
        : {};
    set({ watchlists: wl, layoutSelection: layoutSel });
  },

  async addWatchlist(symbol, note) {
    const w = await window.cockpit?.config?.watchlistsAdd?.(symbol, note);
    if (!w) return;
    set({ watchlists: [...get().watchlists, w] });
  },

  async updateWatchlist(id, fields) {
    const w = await window.cockpit?.config?.watchlistsUpdate?.(id, fields);
    if (!w) return;
    set({
      watchlists: get().watchlists.map((x) => (x.id === id ? w : x)),
    });
  },

  async removeWatchlist(id) {
    const ok = await window.cockpit?.config?.watchlistsRemove?.(id);
    if (!ok) return;
    set({ watchlists: get().watchlists.filter((x) => x.id !== id) });
  },

  async setLayoutPreset(symbol, preset, data) {
    await window.cockpit?.config?.setLayoutPreset?.(symbol, preset, data);
    set({ layoutSelection: { ...get().layoutSelection, [symbol]: preset } });
  },
}));
