import { create } from "zustand";
import type { IndicatorUpdate } from "@tc/shared";

type IndicatorState = {
  indicators: Record<string, IndicatorUpdate | null>;
  setIndicator: (symbol: string, update: IndicatorUpdate) => void;
  getIndicator: (symbol: string) => IndicatorUpdate | null;
};

export const useIndicatorStore = create<IndicatorState>((set, get) => ({
  indicators: {},

  setIndicator: (symbol: string, update: IndicatorUpdate) => {
    set((state) => ({
      indicators: {
        ...state.indicators,
        [symbol]: update,
      },
    }));
  },

  getIndicator: (symbol: string) => {
    return get().indicators[symbol] || null;
  },
}));
