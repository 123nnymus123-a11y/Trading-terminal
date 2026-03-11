import { create } from "zustand";
import type { AlphaSignal, CapitalMomentumSignal, RegimeUpdate } from "@tc/shared";

interface StrategyState {
  regime: RegimeUpdate | null;
  lastRegimeTs: number | null;
  signals: Record<string, AlphaSignal>;
  camSignals: Record<string, CapitalMomentumSignal>;
  setRegime: (regime: RegimeUpdate) => void;
  upsertSignal: (signal: AlphaSignal) => void;
  upsertCamSignal: (signal: CapitalMomentumSignal) => void;
  getSignal: (symbol: string) => AlphaSignal | null;
  getCamSignal: (symbol: string) => CapitalMomentumSignal | null;
}

export const useStrategyStore = create<StrategyState>((set, get) => ({
  regime: null,
  lastRegimeTs: null,
  signals: {},
  camSignals: {},

  setRegime: (regime) => set({ regime, lastRegimeTs: regime.ts }),

  upsertSignal: (signal) =>
    set((state) => ({
      signals: {
        ...state.signals,
        [signal.symbol]: signal,
      },
    })),

  upsertCamSignal: (signal) =>
    set((state) => ({
      camSignals: {
        ...state.camSignals,
        [signal.symbol]: signal,
      },
    })),

  getSignal: (symbol) => get().signals[symbol] ?? null,
  getCamSignal: (symbol) => get().camSignals[symbol] ?? null,
}));
