import { useEffect } from "react";
import { useStreamStore } from "../store/streamStore";
import { useIndicatorStore } from "../store/indicatorStore";
import type { AppEvent } from "@tc/shared";

/**
 * Hook that subscribes to indicator update events from the stream
 */
export function useIndicatorUpdates() {
  const setIndicator = useIndicatorStore((s) => s.setIndicator);

  useEffect(() => {
    const unsub = useStreamStore.subscribe(() => {
      // Keep hook reactive to stream store updates.
    });

    // Subscribe to raw events and filter for indicator updates
    const unsubEvents = window.cockpit?.events?.subscribe?.((batch: AppEvent[]) => {
      for (const evt of batch) {
        if ((evt as any).type === "compute.indicator.update") {
          const update = evt as any;
          setIndicator(update.symbol, update);
        }
      }
    });

    return () => {
      if (typeof unsub === "function") {
        unsub();
      }
      if (typeof unsubEvents === "function") {
        unsubEvents();
      }
    };
  }, [setIndicator]);
}
