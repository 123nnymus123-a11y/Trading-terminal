import type { AccountMetrics } from "../adapters/paperTradingAdapter";

export type RiskTripReason =
  | { kind: "daily-loss"; value: number; threshold: number }
  | { kind: "drawdown"; value: number; threshold: number };

export interface RiskConfig {
  maxDailyLoss: number; // negative number, e.g., -1500
  maxDrawdown: number; // negative number from peak, e.g., -2500
}

export interface RiskStatus {
  tripped: boolean;
  reason: RiskTripReason | null;
  peakEquity: number;
  lastAccount: AccountMetrics | undefined;
}

export class RiskGuardian {
  private tripped = false;
  private reason: RiskTripReason | null = null;
  private peakEquity = 0;
  private lastAccount?: AccountMetrics;

  constructor(private config: RiskConfig, private onTrip: (status: RiskStatus) => void) {}

  observeAccount(account: AccountMetrics) {
    this.lastAccount = account;
    if (account.equity > this.peakEquity) this.peakEquity = account.equity;

    if (this.tripped) return;

    const daily = account.dailyPnl;
    if (daily <= this.config.maxDailyLoss) {
      this.trip({ kind: "daily-loss", value: daily, threshold: this.config.maxDailyLoss });
      return;
    }

    const drawdown = account.equity - this.peakEquity;
    if (drawdown <= this.config.maxDrawdown) {
      this.trip({ kind: "drawdown", value: drawdown, threshold: this.config.maxDrawdown });
    }
  }

  checkCanTrade(): { allowed: boolean; reason?: string } {
    if (!this.tripped) return { allowed: true };
    const r = this.reason;
    const reasonText = r
      ? r.kind === "daily-loss"
        ? `Daily loss limit reached (${r.value.toFixed(2)} <= ${r.threshold.toFixed(2)})`
        : `Drawdown limit reached (${r.value.toFixed(2)} <= ${r.threshold.toFixed(2)})`
      : "Risk guard triggered";
    return { allowed: false, reason: reasonText };
  }

  getStatus(): RiskStatus {
    return {
      tripped: this.tripped,
      reason: this.reason,
      peakEquity: this.peakEquity,
      lastAccount: this.lastAccount,
    };
  }

  private trip(reason: RiskTripReason) {
    if (this.tripped) return;
    this.tripped = true;
    this.reason = reason;
    this.onTrip(this.getStatus());
  }
}
