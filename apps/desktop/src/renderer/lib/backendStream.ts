import type { AppEvent } from '@tc/shared';
import { ensureSession, getBackendBaseWsUrl } from './apiClient';

type BatchHandler = (batch: AppEvent[]) => void;

type BackendStreamControl = {
  stop: () => void;
};

type CockpitBackendWsApi = {
  connect?: () => Promise<boolean>;
  disconnect?: () => void;
  subscribe?: (symbols: string[]) => string[];
  unsubscribe?: (symbols: string[]) => string[];
  onMessage?: (handler: (message: unknown) => void) => () => void;
};

const DEFAULT_SYMBOLS = ['AAPL', 'TSLA', 'MSFT', 'NVDA', 'SPY'];

type MarketBatchPayload = {
  type: 'market.batch';
  quotes?: Array<{ symbol: string; price: number; ts: number }>;
};

function isMarketBatchPayload(payload: unknown): payload is MarketBatchPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const candidate = payload as { type?: unknown; quotes?: unknown };
  return candidate.type === 'market.batch' && Array.isArray(candidate.quotes);
}

export async function startBackendStream(handler: BatchHandler): Promise<BackendStreamControl> {
  const cockpitWs = window.cockpit?.backendWs as CockpitBackendWsApi | undefined;
  if (cockpitWs?.connect && cockpitWs?.subscribe && cockpitWs?.onMessage) {
    const connected = await cockpitWs.connect();
    if (!connected) {
      throw new Error('backend_ws_connect_failed');
    }

    cockpitWs.subscribe(DEFAULT_SYMBOLS);

    let heartbeatSeq = 0;
    let heartbeatTimer: number | null = null;
    const startHeartbeat = () => {
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
      }
      heartbeatTimer = window.setInterval(() => {
        heartbeatSeq += 1;
        handler([
          {
            type: 'system.heartbeat',
            ts: Date.now(),
            seq: heartbeatSeq,
            source: 'live',
          },
        ]);
      }, 1000);
    };

    startHeartbeat();

    const offMessage = cockpitWs.onMessage((payload) => {
      if (!isMarketBatchPayload(payload) || !payload.quotes) {
        return;
      }

      const events: AppEvent[] = payload.quotes.map(
        (quote: { symbol: string; price: number; ts: number }) => ({
          type: 'market.print',
          ts: quote.ts,
          symbol: quote.symbol,
          price: quote.price,
          size: 0,
          source: 'live',
        }),
      );

      if (events.length > 0) {
        handler(events);
      }
    });

    return {
      stop: () => {
        if (heartbeatTimer !== null) {
          window.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        offMessage();
        cockpitWs.unsubscribe?.(DEFAULT_SYMBOLS);
      },
    };
  }

  const session = await ensureSession();
  const wsUrl = `${getBackendBaseWsUrl()}/ws`;
  const ws = new WebSocket(wsUrl, ['Bearer', session.token]);
  let heartbeatSeq = 0;
  let heartbeatTimer: number | null = null;
  let closed = false;

  const startHeartbeat = () => {
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
    }
    heartbeatTimer = window.setInterval(() => {
      if (closed) {
        return;
      }
      heartbeatSeq += 1;
      handler([
        {
          type: 'system.heartbeat',
          ts: Date.now(),
          seq: heartbeatSeq,
          source: 'live',
        },
      ]);
    }, 1000);
  };

  ws.addEventListener('open', () => {
    ws.send(JSON.stringify({ type: 'subscribe', symbols: DEFAULT_SYMBOLS }));
    startHeartbeat();
  });

  ws.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(String(event.data)) as unknown;

      if (!isMarketBatchPayload(payload) || !payload.quotes) {
        return;
      }

      const events: AppEvent[] = payload.quotes.map(
        (quote: { symbol: string; price: number; ts: number }) => ({
          type: 'market.print',
          ts: quote.ts,
          symbol: quote.symbol,
          price: quote.price,
          size: 0,
          source: 'live',
        }),
      );

      if (events.length > 0) {
        handler(events);
      }
    } catch {
      // ignore malformed payloads
    }
  });

  ws.addEventListener('close', () => {
    closed = true;
    if (heartbeatTimer !== null) {
      window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  ws.addEventListener('error', () => {
    // close on error so caller can restart if needed
    try {
      ws.close();
    } catch {
      // ignore
    }
  });

  return {
    stop: () => {
      closed = true;
      if (heartbeatTimer !== null) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
  };
}
