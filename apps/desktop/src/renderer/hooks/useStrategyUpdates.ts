import { useEffect } from "react";
import type { AlphaSignal, AppEvent, CapitalMomentumSignal, RegimeUpdate } from "@tc/shared";
import { useStrategyStore } from "../store/strategyStore";

function isRegime(evt: AppEvent | unknown): evt is RegimeUpdate {
  return typeof evt === "object" && evt !== null && (evt as any).type === "compute.regime.update";
}

function isAlpha(evt: AppEvent | unknown): evt is AlphaSignal {
  return typeof evt === "object" && evt !== null && (evt as any).type === "compute.alpha.signal";
}

function isCam(evt: AppEvent | unknown): evt is CapitalMomentumSignal {
  return typeof evt === "object" && evt !== null && (evt as any).type === "compute.cam.signal";
}

export function useStrategyUpdates() {
  const setRegime = useStrategyStore((s) => s.setRegime);
  const upsertSignal = useStrategyStore((s) => s.upsertSignal);
  const upsertCamSignal = useStrategyStore((s) => s.upsertCamSignal);

  useEffect(() => {
    const unsubEvents = window.cockpit?.events?.subscribe?.((batch: AppEvent[]) => {
      for (const evt of batch) {
        if (isRegime(evt)) setRegime(evt);
        if (isAlpha(evt)) upsertSignal(evt);
        if (isCam(evt)) upsertCamSignal(evt);
      }
    });

    return () => {
      if (typeof unsubEvents === "function") {
        unsubEvents();
      }
    };
  }, [setRegime, upsertSignal, upsertCamSignal]);
}
