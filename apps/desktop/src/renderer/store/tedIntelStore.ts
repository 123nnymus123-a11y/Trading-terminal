import { create } from "zustand";
import type { TedIntelSnapshot, TedIntelTimeWindow } from "@tc/shared";
import { useSettingsStore } from "./settingsStore";

type TedIntelStoreState = {
  snapshots: Partial<Record<TedIntelTimeWindow, TedIntelSnapshot>>;
  loading: Partial<Record<TedIntelTimeWindow, boolean>>;
  errors: Partial<Record<TedIntelTimeWindow, string>>;
  loadSnapshot: (
    windowDays?: TedIntelTimeWindow,
    force?: boolean,
  ) => Promise<void>;
};

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const useTedIntelStore = create<TedIntelStoreState>((set, get) => ({
  snapshots: {},
  loading: {},
  errors: {},
  async loadSnapshot(windowDays = "90d", force = false) {
    const existing = get().snapshots[windowDays];
    if (existing && !force) {
      return;
    }

    set((state) => ({
      loading: { ...state.loading, [windowDays]: true },
      errors: { ...state.errors, [windowDays]: "" },
    }));

    try {
      const api = window.cockpit?.tedIntel;
      if (!api?.getSnapshot) {
        throw new Error("TED Intel API unavailable");
      }

      const snapshot = await api.getSnapshot(windowDays);
      set((state) => ({
        snapshots: { ...state.snapshots, [windowDays]: snapshot },
        loading: { ...state.loading, [windowDays]: false },
        errors: { ...state.errors, [windowDays]: "" },
      }));
    } catch (error) {
      const message = formatError(error);
      useSettingsStore.getState().addLog({
        timestamp: Date.now(),
        level: "error",
        category: "ted-intel",
        message,
      });
      set((state) => ({
        loading: { ...state.loading, [windowDays]: false },
        errors: { ...state.errors, [windowDays]: message },
      }));
    }
  },
}));
