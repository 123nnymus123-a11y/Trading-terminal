import { create } from "zustand";

export interface RiskEventPayload {
  type: "risk.limit";
  ts: number;
  status: {
    tripped: boolean;
    reason: { kind: "daily-loss" | "drawdown"; value: number; threshold: number } | null;
    peakEquity: number;
    lastAccount?: {
      balance: number;
      equity: number;
      buyingPower: number;
      dailyPnl: number;
      dailyPnlPercent: number;
    };
  };
}

export interface RiskState {
  tripped: boolean;
  reason: RiskEventPayload["status"]["reason"];
  ts: number | null;
  lastAccount?: RiskEventPayload["status"]["lastAccount"];
  setFromEvent: (evt: RiskEventPayload) => void;
}

export const useRiskStore = create<RiskState>((set) => ({
  tripped: false,
  reason: null,
  ts: null,
  lastAccount: undefined,

  setFromEvent: (evt) =>
    set({
      tripped: evt.status.tripped,
      reason: evt.status.reason,
      ts: evt.ts,
      lastAccount: evt.status.lastAccount,
    }),
}));
