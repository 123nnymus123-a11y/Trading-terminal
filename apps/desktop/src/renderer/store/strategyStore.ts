import { create } from "zustand";
import type {
  AlphaSignal,
  CapitalMomentumSignal,
  RegimeUpdate,
} from "@tc/shared";

export type CamStateTransition = "pass-to-blocked" | "blocked-to-pass" | null;

interface StrategyState {
  regime: RegimeUpdate | null;
  lastRegimeTs: number | null;
  signals: Record<string, AlphaSignal>;
  camSignals: Record<string, CapitalMomentumSignal>;
  camStateTransitions: Record<string, CamStateTransition>;
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
  camStateTransitions: {},

  setRegime: (regime) => set({ regime, lastRegimeTs: regime.ts }),

  upsertSignal: (signal) =>
    set((state) => ({
      signals: {
        ...state.signals,
        [signal.symbol]: signal,
      },
    })),

  upsertCamSignal: (signal) =>
    set((state) => {
      const prev = state.camSignals[signal.symbol];
      let transition: CamStateTransition =
        state.camStateTransitions[signal.symbol] ?? null;
      if (prev !== undefined) {
        if (prev.passes && !signal.passes) transition = "pass-to-blocked";
        else if (!prev.passes && signal.passes) transition = "blocked-to-pass";
        else transition = null;
      }
      return {
        camSignals: { ...state.camSignals, [signal.symbol]: signal },
        camStateTransitions: {
          ...state.camStateTransitions,
          [signal.symbol]: transition,
        },
      };
    }),

  getSignal: (symbol) => get().signals[symbol] ?? null,
  getCamSignal: (symbol) => get().camSignals[symbol] ?? null,
}));
