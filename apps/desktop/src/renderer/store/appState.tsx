import React, { createContext, useContext, useMemo, useState } from "react";
import type { LayoutPreset, MarketStatus } from "../tabs";

export type HeaderStats = {
  symbol: string;
  positionQty: number;
  unrealizedPnl: number;
  realizedPnl: number;
  riskUsedTodayPct: number; // 0..100
  marketStatus: MarketStatus;
};

export type AppState = {
  focusMode: boolean;
  layoutPreset: LayoutPreset;
  header: HeaderStats;
};

type AppActions = {
  toggleFocusMode: () => void;
  setLayoutPreset: (p: LayoutPreset) => void;
  setSymbol: (s: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setHeaderPartial: (patch: Partial<HeaderStats>) => void;
};

const Ctx = createContext<{ state: AppState; actions: AppActions } | null>(null);

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const initialState: AppState = {
  focusMode: false,
  layoutPreset: "Morning Open",
  header: {
    symbol: "AAPL",
    positionQty: 0,
    unrealizedPnl: 125.5,
    realizedPnl: -32.25,
    riskUsedTodayPct: 18.2,
    marketStatus: "UNKNOWN"
  }
};

export function AppStateProvider(props: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initialState);

  const actions: AppActions = useMemo(() => {
    return {
      toggleFocusMode() {
        setState((s) => ({ ...s, focusMode: !s.focusMode }));
      },
      setLayoutPreset(p) {
        setState((s) => ({ ...s, layoutPreset: p }));
      },
      setSymbol(sym) {
        const cleaned = sym.trim().toUpperCase().slice(0, 12);
        setState((s) => ({ ...s, header: { ...s.header, symbol: cleaned || s.header.symbol } }));
      },
      setHeaderPartial(patch) {
        setState((s) => {
          const next: HeaderStats = { ...s.header, ...patch };
          next.riskUsedTodayPct = clamp(next.riskUsedTodayPct, 0, 100);
          return { ...s, header: next };
        });
      }
    };
  }, []);

  return <Ctx.Provider value={{ state, actions }}>{props.children}</Ctx.Provider>;
}

export function useAppState() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppState must be used within AppStateProvider");
  return v;
}