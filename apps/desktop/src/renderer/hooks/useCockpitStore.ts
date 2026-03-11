import { useEffect, useMemo, useState } from "react";
import {
  ReplayStateSchema,
  type ReplayState,
  StreamSourceSchema,
  type StreamSource,
} from "../../../../../packages/shared/src/replay";

type Store = {
  streamSource: StreamSource;
  replay: ReplayState;
};

const defaultReplay: ReplayState = ReplayStateSchema.parse({
  isLoaded: false,
  isPlaying: false,
  speed: 1,
  startTs: null,
  endTs: null,
  cursorTs: null,
  cursorIndex: 0,
  rowCount: 0,
  datasetName: "sample-prints.json",
});

export function useCockpitStore(): Store {
  const [streamSource, setStreamSource] = useState<StreamSource>("demo");
  const [replay, setReplay] = useState<ReplayState>(defaultReplay);

  useEffect(() => {
    let mounted = true;

    const streaming = window.streaming;

    Promise.resolve(streaming?.getStatus?.())
      .then((s) => {
        if (!mounted) return;
        if (!s) return;
        setStreamSource(StreamSourceSchema.parse(s.source));
      })
      .catch(() => {});

    const unsub = streaming?.onEvents?.((batch: any[]) => {
      for (const evt of batch ?? []) {
        if (evt?.type === "system.stream.source") {
          setStreamSource(evt.source);
        } else if (evt?.type === "system.replay.state") {
          setReplay(ReplayStateSchema.parse(evt.state));
        }
      }
    });

    return () => {
      mounted = false;
      if (typeof unsub === "function") {
        unsub();
      }
    };
  }, []);

  return useMemo(() => ({ streamSource, replay }), [streamSource, replay]);
}