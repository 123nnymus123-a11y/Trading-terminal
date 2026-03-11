import { useEffect } from "react";
import { useRiskStore } from "../store/riskStore";

export function useRiskEvents() {
  const setFromEvent = useRiskStore((s) => s.setFromEvent);

  useEffect(() => {
    const unsub = window.cockpit?.risk?.onEvent?.((evt: any) => {
      if (evt?.type === "risk.limit") setFromEvent(evt);
    });

    return () => {
      unsub?.();
    };
  }, [setFromEvent]);
}
