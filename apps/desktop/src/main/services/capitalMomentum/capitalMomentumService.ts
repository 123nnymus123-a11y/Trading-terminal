import type { CapitalMomentumSignal, RegimeMode } from "@tc/shared";

interface FlowInputs {
  publicFlowBuy: number;
  themeAccel: number;
  congressNetBuy: number;
  secondOrderMomentum: number;
  observedAt: {
    publicFlow: number;
    theme: number;
    congress: number;
    secondOrder: number;
  };
}

export interface CapitalMomentumInput {
  symbol: string;
  ts: number;
  regimeMode: RegimeMode;
  price: number;
  atr: number | null;
  realizedVol: number | null;
  emaFast: number;
  emaSlow: number;
  close20HighDistancePct: number;
  relativeStrength: number;
  breakoutStrength: number;
  volumeRatio: number;
  priorClose: number | null;
  barIntervalMs: number;
  flow: FlowInputs;
  congressTradeTiming: {
    transactionDate: number | null;
    disclosureDate: number | null;
  };
}

interface PositionMarker {
  entryPrice: number;
  atrAtEntry: number;
  side: "long" | "flat";
}

type CorrKey = "breakout" | "theme" | "secondOrder";

interface CorrSample {
  breakout: number;
  theme: number;
  secondOrder: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class CapitalMomentumService {
  private readonly scoreThreshold = 65;
  private readonly minTrend = 0.55;
  private readonly minVol = 0.45;
  private readonly minBreakout = 0.5;
  private readonly maxNewPositionsPerDay = 2;
  private readonly crashKillAtrMultiple = 2.5;

  private readonly weights = {
    trend: 0.3,
    flow: 0.35,
    volatility: 0.15,
    breakout: 0.2,
  };

  private readonly flowWeights = {
    publicFlow: 0.35,
    theme: 0.25,
    congress: 0.25,
    secondOrder: 0.15,
  };

  private readonly featureDelays = {
    publicFlowDelayMs: 60_000,
    congressDelayMs: 2 * DAY_MS,
    themeDelayMs: DAY_MS,
    secondOrderDelayMs: DAY_MS,
  };

  private readonly correlationWindow = 60;
  private readonly correlationThreshold = 0.7;

  private currentDayKey = "";
  private dayEntries = 0;
  private positionMap = new Map<string, PositionMarker>();
  private marketVolHistory: number[] = [];
  private marketVolPercentile = 50;
  private corrHistory = new Map<string, CorrSample[]>();

  evaluate(input: CapitalMomentumInput): CapitalMomentumSignal {
    this.rollDay(input.ts);
    this.observeMarketVol(input);

    const trendScore = this.computeTrendScore(input);
    const volatilityScore = this.computeVolatilityScore(input);
    const breakoutScore = this.computeBreakoutScore(input);

    const flowPublic = this.clamp01(input.flow.publicFlowBuy);
    const flowTheme = this.clamp01(input.flow.themeAccel);
    const flowCongress = this.clamp01(input.flow.congressNetBuy);
    const flowSecond = this.clamp01(input.flow.secondOrderMomentum);

    const flowScore =
      this.flowWeights.publicFlow * flowPublic +
      this.flowWeights.theme * flowTheme +
      this.flowWeights.congress * flowCongress +
      this.flowWeights.secondOrder * flowSecond;

    this.pushCorrSample(input.symbol, {
      breakout: breakoutScore,
      theme: flowTheme,
      secondOrder: flowSecond,
    });

    const gatesFailed: string[] = [];
    const volState = this.classifyVolatilityState(
      volatilityScore,
      input.realizedVol,
    );

    const baseContrib = {
      trend: this.weights.trend * trendScore,
      flowCore:
        this.weights.flow *
        (this.flowWeights.publicFlow * flowPublic +
          this.flowWeights.congress * flowCongress),
      flowTheme: this.weights.flow * this.flowWeights.theme * flowTheme,
      flowSecond: this.weights.flow * this.flowWeights.secondOrder * flowSecond,
      volatility: this.weights.volatility * volatilityScore,
      breakout: this.weights.breakout * breakoutScore,
    };

    const adjustedContrib = this.applyCorrelationCap(input.symbol, baseContrib);

    if (this.marketVolPercentile >= 90) gatesFailed.push("vol-chaos-market");

    const atrPct = input.atr && input.price > 0 ? input.atr / input.price : 0;
    if (atrPct > 0.08) gatesFailed.push("vol-chaos-asset");

    const gapAtr =
      input.priorClose && input.atr && input.atr > 0
        ? Math.abs(input.price - input.priorClose) / input.atr
        : 0;
    if (gapAtr > 1.5) gatesFailed.push("vol-chaos-gap");

    if (trendScore < this.minTrend) gatesFailed.push("min-trend");
    if (volatilityScore < this.minVol) gatesFailed.push("min-volatility");
    if (breakoutScore < this.minBreakout) gatesFailed.push("min-breakout");

    if (this.dayEntries >= this.maxNewPositionsPerDay)
      gatesFailed.push("daily-entry-throttle");

    const crashKillTriggered = this.checkCrashKill(input);
    if (crashKillTriggered) gatesFailed.push("crash-kill");

    const compositeRaw =
      adjustedContrib.trend +
      adjustedContrib.flowCore +
      adjustedContrib.flowTheme +
      adjustedContrib.flowSecond +
      adjustedContrib.volatility +
      adjustedContrib.breakout;

    const compositeScore = this.clamp(compositeRaw * 100, 0, 100);
    const baseConfidence = this.clamp01(
      0.5 + Math.abs(compositeRaw - 0.5) * 0.6,
    );
    const passes =
      compositeScore >= this.scoreThreshold && gatesFailed.length === 0;

    if (passes) {
      this.dayEntries += 1;
      const atrForEntry = Math.max(
        input.atr ?? 0,
        Math.max(input.price * 0.01, 0.01),
      );
      this.positionMap.set(input.symbol, {
        entryPrice: input.price,
        atrAtEntry: atrForEntry,
        side: "long",
      });
    }

    const stopLoss = Math.max(
      input.price - Math.max(input.atr ?? input.price * 0.01, 0.01) * 2,
      0,
    );
    const riskSizeDollars = this.computeRiskSize(
      input.price,
      stopLoss,
      input.realizedVol,
    );

    const readyAtPublicFlow =
      input.flow.observedAt.publicFlow + this.featureDelays.publicFlowDelayMs;
    const readyAtCongress =
      input.flow.observedAt.congress + this.featureDelays.congressDelayMs;
    const readyAtTheme =
      input.flow.observedAt.theme + this.featureDelays.themeDelayMs;
    const readyAtSecondOrder =
      input.flow.observedAt.secondOrder + this.featureDelays.secondOrderDelayMs;
    const effectiveForTradingAt = Math.max(
      input.ts + input.barIntervalMs,
      readyAtPublicFlow,
      readyAtCongress,
      readyAtTheme,
      readyAtSecondOrder,
    );

    if (input.ts < effectiveForTradingAt) {
      gatesFailed.push("feature-delay-lock");
    }

    const lagAdjustedConfidence = this.buildLagAdjustedConfidence(
      baseConfidence,
      input.ts,
      input.congressTradeTiming.transactionDate,
      input.congressTradeTiming.disclosureDate,
      {
        publicFlowAgeMs: Math.max(
          0,
          input.ts - input.flow.observedAt.publicFlow,
        ),
        congressAgeMs: Math.max(0, input.ts - input.flow.observedAt.congress),
        themeAgeMs: Math.max(0, input.ts - input.flow.observedAt.theme),
        secondOrderAgeMs: Math.max(
          0,
          input.ts - input.flow.observedAt.secondOrder,
        ),
      },
    );

    const buyVsSellChannel = this.classifyBuySellChannel(flowCongress);
    const herdingState = this.classifyHerdingState(flowCongress, flowSecond);
    const uncertaintyRegimePenalty =
      this.computeUncertaintyPenalty(herdingState);
    const influenceTierBreakdown = this.buildInfluenceTierBreakdown(
      flowCongress,
      flowTheme,
      flowSecond,
      lagAdjustedConfidence.disclosureLagDays,
    );
    const eventWindowFeatures = this.buildEventWindowFeatures(
      input.ts,
      breakoutScore,
      flowTheme,
      lagAdjustedConfidence.disclosureLagDays,
      input.congressTradeTiming.disclosureDate,
    );
    const explainabilityPayload = this.buildExplainabilityPayload(
      input.symbol,
      adjustedContrib,
      {
        trendScore,
        flowScore,
        volatilityScore,
        breakoutScore,
        flowCongress,
        flowSecond,
        relativeStrength: input.relativeStrength,
        marketVolPercentile: this.marketVolPercentile,
      },
      buyVsSellChannel,
      lagAdjustedConfidence,
    );
    const politicalConnectionFlags = this.buildPoliticalConnectionFlags(
      flowPublic,
      flowTheme,
      flowCongress,
      flowSecond,
    );

    const topContributors = [
      { key: "trend", value: adjustedContrib.trend },
      { key: "flow-core", value: adjustedContrib.flowCore },
      { key: "flow-theme", value: adjustedContrib.flowTheme },
      { key: "flow-second-order", value: adjustedContrib.flowSecond },
      { key: "volatility", value: adjustedContrib.volatility },
      { key: "breakout", value: adjustedContrib.breakout },
    ]
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);

    return {
      type: "compute.cam.signal",
      ts: input.ts,
      symbol: input.symbol,
      regimeMode: input.regimeMode,
      trendScore,
      flowScore,
      volatilityScore,
      breakoutScore,
      volatilityState: volState,
      compositeScore,
      confidence: baseConfidence,
      threshold: this.scoreThreshold,
      passes,
      gatesFailed,
      topContributors,
      dataFreshness: {
        publicFlowAgeMs: Math.max(
          0,
          input.ts - input.flow.observedAt.publicFlow,
        ),
        congressAgeMs: Math.max(0, input.ts - input.flow.observedAt.congress),
        themeAgeMs: Math.max(0, input.ts - input.flow.observedAt.theme),
        secondOrderAgeMs: Math.max(
          0,
          input.ts - input.flow.observedAt.secondOrder,
        ),
      },
      featureDelays: this.featureDelays,
      transactionDate: input.congressTradeTiming.transactionDate,
      disclosureDate: input.congressTradeTiming.disclosureDate,
      effectiveForTradingAt,
      suggestedEntry: input.price,
      stopLoss,
      riskSizeDollars,
      crashKillTriggered,
      influenceTierBreakdown,
      eventWindowFeatures,
      lagAdjustedConfidence,
      explainabilityPayload,
      herdingState,
      uncertaintyRegimePenalty,
      politicalConnectionFlags,
      notes: [
        `corrWindow=${this.correlationWindow}`,
        `marketVolPct=${this.marketVolPercentile.toFixed(1)}`,
        "slippageAssumptionBps=8",
        "feesAssumptionUsd=0.50",
      ],
    };
  }

  private rollDay(ts: number) {
    const key = new Date(ts).toISOString().slice(0, 10);
    if (key === this.currentDayKey) return;
    this.currentDayKey = key;
    this.dayEntries = 0;
  }

  private observeMarketVol(input: CapitalMomentumInput) {
    if (input.symbol !== "SPY") return;
    if (input.realizedVol === null) return;
    this.marketVolHistory.push(input.realizedVol);
    if (this.marketVolHistory.length > 252) this.marketVolHistory.shift();
    this.marketVolPercentile = this.percentileRank(
      this.marketVolHistory,
      input.realizedVol,
    );
  }

  private computeTrendScore(input: CapitalMomentumInput): number {
    const emaStack = input.emaFast > input.emaSlow ? 1 : 0;
    const nearHigh = this.clamp01(
      1 - Math.max(0, input.close20HighDistancePct) / 0.05,
    );
    const rel = this.clamp01((input.relativeStrength + 0.05) / 0.1);
    return this.clamp01(0.45 * emaStack + 0.3 * nearHigh + 0.25 * rel);
  }

  private computeVolatilityScore(input: CapitalMomentumInput): number {
    const rv = input.realizedVol ?? 0;
    const expansion = this.clamp01((rv - 0.00035) / 0.0005);
    const chaosPenalty = this.marketVolPercentile >= 90 ? 0.4 : 0;
    return this.clamp01(expansion - chaosPenalty + 0.35);
  }

  private computeBreakoutScore(input: CapitalMomentumInput): number {
    const volBoost = this.clamp01((input.volumeRatio - 1) / 1.2);
    return this.clamp01(
      0.65 * this.clamp01(input.breakoutStrength) + 0.35 * volBoost,
    );
  }

  private classifyVolatilityState(
    volatilityScore: number,
    rv: number | null,
  ): CapitalMomentumSignal["volatilityState"] {
    if (this.marketVolPercentile >= 90) return "chaotic";
    if (volatilityScore >= 0.65 && (rv ?? 0) > 0.0004) return "expanding";
    if (volatilityScore < 0.4) return "compressed";
    return "neutral";
  }

  private checkCrashKill(input: CapitalMomentumInput): boolean {
    const marker = this.positionMap.get(input.symbol);
    if (!marker || marker.side !== "long") return false;
    const adverseMove = marker.entryPrice - input.price;
    const trigger = adverseMove > marker.atrAtEntry * this.crashKillAtrMultiple;
    if (trigger) {
      this.positionMap.delete(input.symbol);
    }
    return trigger;
  }

  private applyCorrelationCap(
    symbol: string,
    base: {
      trend: number;
      flowCore: number;
      flowTheme: number;
      flowSecond: number;
      volatility: number;
      breakout: number;
    },
  ) {
    const pairs = this.computeHighCorrPairs(symbol);
    if (pairs.length === 0) return base;

    const mapped = {
      breakout: base.breakout,
      theme: base.flowTheme,
      secondOrder: base.flowSecond,
    };

    const cappedKeys = new Set<CorrKey>();
    for (const [left, right] of pairs) {
      const loser: CorrKey = mapped[left] <= mapped[right] ? left : right;
      cappedKeys.add(loser);
    }

    const capped = {
      ...base,
      breakout: cappedKeys.has("breakout")
        ? Math.min(base.breakout, 0.1)
        : base.breakout,
      flowTheme: cappedKeys.has("theme")
        ? Math.min(base.flowTheme, 0.1)
        : base.flowTheme,
      flowSecond: cappedKeys.has("secondOrder")
        ? Math.min(base.flowSecond, 0.1)
        : base.flowSecond,
    };

    const baseTotal = Object.values(base).reduce((a, b) => a + b, 0);
    const cappedTotal = Object.values(capped).reduce((a, b) => a + b, 0);
    if (cappedTotal <= 0 || baseTotal <= cappedTotal) return capped;

    const scale = baseTotal / cappedTotal;
    return {
      trend: this.clamp(capped.trend * scale, 0, 1),
      flowCore: this.clamp(capped.flowCore * scale, 0, 1),
      flowTheme: this.clamp(capped.flowTheme * scale, 0, 1),
      flowSecond: this.clamp(capped.flowSecond * scale, 0, 1),
      volatility: this.clamp(capped.volatility * scale, 0, 1),
      breakout: this.clamp(capped.breakout * scale, 0, 1),
    };
  }

  private computeHighCorrPairs(symbol: string): Array<[CorrKey, CorrKey]> {
    const samples = this.corrHistory.get(symbol) ?? [];
    if (samples.length < 20) return [];

    const breakout = samples.map((s) => s.breakout);
    const theme = samples.map((s) => s.theme);
    const second = samples.map((s) => s.secondOrder);

    const result: Array<[CorrKey, CorrKey]> = [];
    const bt = Math.abs(this.pearson(breakout, theme));
    const bs = Math.abs(this.pearson(breakout, second));
    const ts = Math.abs(this.pearson(theme, second));

    if (bt > this.correlationThreshold) result.push(["breakout", "theme"]);
    if (bs > this.correlationThreshold)
      result.push(["breakout", "secondOrder"]);
    if (ts > this.correlationThreshold) result.push(["theme", "secondOrder"]);

    return result;
  }

  private pushCorrSample(symbol: string, sample: CorrSample) {
    const current = this.corrHistory.get(symbol) ?? [];
    current.push(sample);
    if (current.length > this.correlationWindow) current.shift();
    this.corrHistory.set(symbol, current);
  }

  private computeRiskSize(
    price: number,
    stopLoss: number,
    realizedVol: number | null,
  ): number {
    const stopDistance = Math.max(price - stopLoss, price * 0.005);
    const baseRisk = 1_000;
    const volScale = realizedVol
      ? this.clamp(0.0005 / Math.max(realizedVol, 0.0001), 0.5, 2)
      : 1;
    return Math.max(0, (baseRisk * volScale * price) / stopDistance);
  }

  private percentileRank(series: number[], value: number): number {
    if (series.length === 0) return 50;
    const less = series.filter((v) => v <= value).length;
    return (less / series.length) * 100;
  }

  private pearson(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n < 2) return 0;

    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < n; i++) {
      sumA += a[i] ?? 0;
      sumB += b[i] ?? 0;
    }

    const meanA = sumA / n;
    const meanB = sumB / n;

    let cov = 0;
    let varA = 0;
    let varB = 0;
    for (let i = 0; i < n; i++) {
      const da = (a[i] ?? 0) - meanA;
      const db = (b[i] ?? 0) - meanB;
      cov += da * db;
      varA += da * da;
      varB += db * db;
    }

    if (varA <= 0 || varB <= 0) return 0;
    return cov / Math.sqrt(varA * varB);
  }

  private clamp(x: number, min: number, max: number): number {
    if (x < min) return min;
    if (x > max) return max;
    return x;
  }

  private clamp01(x: number): number {
    return this.clamp(x, 0, 1);
  }

  private buildLagAdjustedConfidence(
    modelConfidence: number,
    nowTs: number,
    transactionDate: number | null,
    disclosureDate: number | null,
    freshness: {
      publicFlowAgeMs: number;
      congressAgeMs: number;
      themeAgeMs: number;
      secondOrderAgeMs: number;
    },
  ): NonNullable<CapitalMomentumSignal["lagAdjustedConfidence"]> {
    const maxAge = Math.max(
      freshness.publicFlowAgeMs,
      freshness.congressAgeMs,
      freshness.themeAgeMs,
      freshness.secondOrderAgeMs,
    );
    const stalenessPenalty = this.clamp01(maxAge / (10 * DAY_MS));

    const lagDays =
      transactionDate !== null && disclosureDate !== null
        ? Math.max(0, Math.floor((disclosureDate - transactionDate) / DAY_MS))
        : null;
    const disclosureLagAdjustment =
      lagDays === null ? -0.1 : -this.clamp(lagDays / 90, 0, 0.5);

    const timeSinceDisclosureDays =
      disclosureDate !== null
        ? Math.max(0, (nowTs - disclosureDate) / DAY_MS)
        : 999;
    const immediateDisclosureBoost = timeSinceDisclosureDays <= 3 ? 0.05 : 0;

    const effectiveConfidence = this.clamp01(
      modelConfidence -
        stalenessPenalty +
        disclosureLagAdjustment +
        immediateDisclosureBoost,
    );

    return {
      modelConfidence: this.clamp01(modelConfidence),
      stalenessPenalty,
      disclosureLagAdjustment,
      effectiveConfidence,
      disclosureLagDays: lagDays,
    };
  }

  private classifyBuySellChannel(
    flowCongress: number,
  ): NonNullable<
    CapitalMomentumSignal["explainabilityPayload"]
  >["buyVsSellChannel"] {
    if (flowCongress > 0.56) return "buy";
    if (flowCongress < 0.44) return "sell";
    return "unknown";
  }

  private classifyHerdingState(
    flowCongress: number,
    flowSecond: number,
  ): NonNullable<CapitalMomentumSignal["herdingState"]> {
    const signal = 0.6 * flowCongress + 0.4 * flowSecond;
    if (signal >= 0.8) return "extreme";
    if (signal >= 0.65) return "high";
    if (signal >= 0.5) return "moderate";
    return "low";
  }

  private computeUncertaintyPenalty(
    herding: NonNullable<CapitalMomentumSignal["herdingState"]>,
  ): number {
    const marketPenalty = this.clamp01((this.marketVolPercentile - 60) / 40);
    const herdingPenalty =
      herding === "extreme"
        ? 0.4
        : herding === "high"
          ? 0.25
          : herding === "moderate"
            ? 0.12
            : 0.04;
    return this.clamp01(0.6 * marketPenalty + herdingPenalty);
  }

  private buildInfluenceTierBreakdown(
    flowCongress: number,
    flowTheme: number,
    flowSecond: number,
    disclosureLagDays: number | null,
  ): NonNullable<CapitalMomentumSignal["influenceTierBreakdown"]> {
    const committeePowerScore = this.clamp01(
      0.55 * flowCongress + 0.45 * flowTheme,
    );
    const seniorityScore = this.clamp01(
      0.5 * flowCongress +
        0.2 * flowSecond +
        (disclosureLagDays !== null && disclosureLagDays <= 30 ? 0.15 : 0),
    );
    const networkProximityScore = this.clamp01(
      0.5 * flowSecond + 0.3 * flowTheme + 0.2 * flowCongress,
    );

    const influenceTier =
      committeePowerScore >= 0.8
        ? "leadership"
        : committeePowerScore >= 0.67
          ? "committee-key"
          : committeePowerScore >= 0.5
            ? "committee-standard"
            : "rank-and-file";

    const leadershipRole =
      influenceTier === "leadership"
        ? "leadership-inferred"
        : influenceTier === "committee-key"
          ? "committee-key-inferred"
          : null;

    const committeeJurisdictions: string[] = [];
    if (flowTheme > 0.6) committeeJurisdictions.push("sector-theme-linked");
    if (flowCongress > 0.62)
      committeeJurisdictions.push("ticker-direct-trade-flow");
    if (committeeJurisdictions.length === 0) {
      committeeJurisdictions.push("general-market");
    }

    return {
      influenceTier,
      committeePowerScore,
      seniorityScore,
      leadershipRole,
      committeeJurisdictions,
      networkProximityScore,
    };
  }

  private buildEventWindowFeatures(
    ts: number,
    breakoutScore: number,
    flowTheme: number,
    disclosureLagDays: number | null,
    disclosureDate: number | null,
  ): NonNullable<CapitalMomentumSignal["eventWindowFeatures"]> {
    let phase: "pre-event" | "event" | "post-event" | "none" = "none";
    let eventType: string | null = null;
    let daysToEvent: number | null = null;

    if (disclosureDate !== null) {
      daysToEvent = Math.floor((disclosureDate - ts) / DAY_MS);
      phase =
        daysToEvent > 1
          ? "pre-event"
          : daysToEvent >= -2
            ? "event"
            : "post-event";
      eventType = "congressional-disclosure";
    } else if (breakoutScore > 0.7) {
      phase = "event";
      eventType = "technical-breakout";
      daysToEvent = 0;
    }

    if (phase === "none" && flowTheme > 0.65) {
      phase = "pre-event";
      eventType = "policy-theme-build";
      daysToEvent = disclosureLagDays;
    }

    return {
      phase,
      eventType,
      daysToEvent,
      eventDescription:
        eventType === null
          ? null
          : `Phase=${phase}; inferred from disclosure timing and flow/technical conditions.`,
      procurementEventLinked: flowTheme >= 0.7,
      regulatoryEventLinked: flowTheme >= 0.6 && breakoutScore >= 0.55,
    };
  }

  private buildExplainabilityPayload(
    symbol: string,
    contrib: {
      trend: number;
      flowCore: number;
      flowTheme: number;
      flowSecond: number;
      volatility: number;
      breakout: number;
    },
    metrics: {
      trendScore: number;
      flowScore: number;
      volatilityScore: number;
      breakoutScore: number;
      flowCongress: number;
      flowSecond: number;
      relativeStrength: number;
      marketVolPercentile: number;
    },
    buyVsSellChannel: NonNullable<
      CapitalMomentumSignal["explainabilityPayload"]
    >["buyVsSellChannel"],
    lag: NonNullable<CapitalMomentumSignal["lagAdjustedConfidence"]>,
  ): NonNullable<CapitalMomentumSignal["explainabilityPayload"]> {
    const signed = [
      { key: "trend", label: "Trend", value: contrib.trend },
      { key: "flow-core", label: "Flow Core", value: contrib.flowCore },
      { key: "flow-theme", label: "Theme Flow", value: contrib.flowTheme },
      {
        key: "flow-second",
        label: "Second-order Flow",
        value: contrib.flowSecond,
      },
      { key: "volatility", label: "Volatility", value: contrib.volatility },
      { key: "breakout", label: "Breakout", value: contrib.breakout },
    ];

    const total = Math.max(
      signed.reduce((sum, s) => sum + Math.abs(s.value), 0),
      1e-6,
    );
    const topSignedContributors = signed
      .map((s) => ({
        key: s.key,
        label: s.label,
        value: s.value,
        direction: (s.value > 0
          ? "positive"
          : s.value < 0
            ? "negative"
            : "neutral") as "positive" | "negative" | "neutral",
        weight: this.clamp01(Math.abs(s.value) / total),
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 8);

    const repeatedTradePattern =
      metrics.flowCongress > 0.64 &&
      lag.disclosureLagDays !== null &&
      lag.disclosureLagDays <= 45;

    const copycatRiskScore = this.clamp01(
      0.45 * metrics.flowSecond +
        0.3 * metrics.flowCongress +
        0.25 *
          (lag.disclosureLagDays !== null && lag.disclosureLagDays <= 14
            ? 1
            : 0),
    );

    const episodicInformedTradeProbability = this.clamp01(
      0.4 * metrics.breakoutScore +
        0.3 * metrics.flowCongress +
        0.2 * metrics.trendScore +
        0.1 *
          (lag.disclosureLagDays !== null && lag.disclosureLagDays <= 21
            ? 1
            : 0),
    );

    const informationAsymmetryProxy = this.clamp01(
      0.5 * metrics.volatilityScore +
        0.3 * metrics.breakoutScore +
        0.2 * Math.abs(metrics.relativeStrength),
    );

    const tradeArchetype:
      | "repeated-same-stock"
      | "speculative"
      | "conflicted"
      | "standard" = repeatedTradePattern
      ? "repeated-same-stock"
      : metrics.breakoutScore > 0.8 && metrics.flowSecond > 0.7
        ? "speculative"
        : metrics.marketVolPercentile > 90 && metrics.flowCongress < 0.45
          ? "conflicted"
          : "standard";

    return {
      whyNow: `${symbol}: trend=${metrics.trendScore.toFixed(2)}, flow=${metrics.flowScore.toFixed(2)}, breakout=${metrics.breakoutScore.toFixed(2)}, effectiveConf=${lag.effectiveConfidence.toFixed(2)}.`,
      topSignedContributors,
      scoreVersion: "cam-v2-heuristic-2026-03-31",
      tradeArchetype,
      buyVsSellChannel,
      copycatRiskScore,
      repeatedTradePattern,
      episodicInformedTradeProbability,
      informationAsymmetryProxy,
    };
  }

  private buildPoliticalConnectionFlags(
    flowPublic: number,
    flowTheme: number,
    flowCongress: number,
    flowSecond: number,
  ): NonNullable<CapitalMomentumSignal["politicalConnectionFlags"]> {
    const localityLink = flowPublic > 0.65 && flowCongress > 0.55;
    const contributorLink = flowTheme > 0.6 && flowCongress > 0.58;
    const contractChannelIndicator = flowTheme > 0.7;
    const divestmentShockFlag = flowCongress < 0.35 && flowSecond > 0.6;

    const connectionTypes: Array<
      "home-state" | "contributor-linked" | "procurement-linked" | "none"
    > = [];
    if (localityLink) connectionTypes.push("home-state");
    if (contributorLink) connectionTypes.push("contributor-linked");
    if (contractChannelIndicator) connectionTypes.push("procurement-linked");
    if (connectionTypes.length === 0) connectionTypes.push("none");

    return {
      connectionTypes,
      localityLink,
      contributorLink,
      contractChannelIndicator,
      divestmentShockFlag,
    };
  }
}

export const capitalMomentumService = new CapitalMomentumService();
