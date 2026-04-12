import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  wsClientSubscribeSchema,
  wsClientUnsubscribeSchema,
  wsServerAckSchema,
  wsServerErrorSchema,
  wsServerMarketBatchSchema,
} from './contracts.js';
import { createLogger } from './logger.js';
import { extractBearerToken } from './authMiddleware.js';
import type { AppEnv } from './config.js';
import type { AuthUser } from './auth.js';

const logger = createLogger('ws');

type SubscriptionState = {
  user: AuthUser;
  symbols: Set<string>;
  queue: Array<{ symbol: string; price: number; ts: number }>;
  dropped: number;
};

type WsMetrics = {
  connectedClients: number;
  totalMessagesSent: number;
  totalMessagesDropped: number;
};

export type WebSocketMetricsReader = () => WsMetrics;

function parseTokenFromProtocols(rawProtocol?: string): string | null {
  if (!rawProtocol) {
    return null;
  }
  const parts = rawProtocol.split(',').map((part) => part.trim());
  if (parts.length < 2) {
    return null;
  }
  if (parts[0] !== 'Bearer') {
    return null;
  }
  return parts[1] ?? null;
}

function normalizeSymbols(symbols: string[]): string[] {
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
}

export function attachWebSocket(
  server: import('node:http').Server,
  verifyAccessToken: (token: string) => AuthUser | null,
  env: AppEnv,
): { readMetrics: WebSocketMetricsReader } {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clientState = new Map<WebSocket, SubscriptionState>();
  const metrics: WsMetrics = {
    connectedClients: 0,
    totalMessagesSent: 0,
    totalMessagesDropped: 0,
  };

  wss.on('connection', (socket: WebSocket, req) => {
    const tokenFromHeader = extractBearerToken(req.headers.authorization);
    const tokenFromProtocol = parseTokenFromProtocols(req.headers['sec-websocket-protocol']);
    const token = tokenFromHeader ?? tokenFromProtocol;

    if (!token) {
      const payload = wsServerErrorSchema.parse({ type: 'error', reason: 'missing_token' });
      socket.send(JSON.stringify(payload));
      socket.close(1008, 'Missing auth token');
      return;
    }

    const user = verifyAccessToken(token);
    if (!user) {
      const payload = wsServerErrorSchema.parse({ type: 'error', reason: 'invalid_token' });
      socket.send(JSON.stringify(payload));
      socket.close(1008, 'Invalid auth token');
      return;
    }

    clientState.set(socket, { user, symbols: new Set(), queue: [], dropped: 0 });
    metrics.connectedClients += 1;
    logger.info('client_connected');

    socket.on('message', (raw: RawData) => {
      try {
        const data = JSON.parse(raw.toString()) as unknown;
        const subscribeParsed = wsClientSubscribeSchema.safeParse(data);
        if (subscribeParsed.success) {
          const state = clientState.get(socket);
          if (!state) {
            return;
          }
          for (const symbol of normalizeSymbols(subscribeParsed.data.symbols)) {
            state.symbols.add(symbol);
          }
          const payload = wsServerAckSchema.parse({
            type: 'subscribed',
            symbols: [...state.symbols],
          });
          socket.send(JSON.stringify(payload));
          return;
        }

        const unsubscribeParsed = wsClientUnsubscribeSchema.safeParse(data);
        if (unsubscribeParsed.success) {
          const state = clientState.get(socket);
          if (!state) {
            return;
          }
          for (const symbol of normalizeSymbols(unsubscribeParsed.data.symbols)) {
            state.symbols.delete(symbol);
          }
          const payload = wsServerAckSchema.parse({
            type: 'unsubscribed',
            symbols: [...state.symbols],
          });
          socket.send(JSON.stringify(payload));
          return;
        }

        const payload = wsServerErrorSchema.parse({
          type: 'error',
          reason: 'invalid_message_payload',
        });
        socket.send(JSON.stringify(payload));
      } catch {
        const payload = wsServerErrorSchema.parse({ type: 'error', reason: 'invalid_json' });
        socket.send(JSON.stringify(payload));
      }
    });

    socket.on('close', () => {
      clientState.delete(socket);
      metrics.connectedClients = Math.max(0, metrics.connectedClients - 1);
      logger.info('client_disconnected');
    });
  });

  const quoteGenerationInterval = setInterval(() => {
    const now = Date.now();
    for (const [socket, state] of clientState.entries()) {
      if (socket.readyState !== socket.OPEN) {
        continue;
      }

      for (const symbol of state.symbols.values()) {
        const price = Number((100 + Math.random() * 100).toFixed(2));
        state.queue.push({ symbol, price, ts: now });
        if (state.queue.length > env.WS_QUEUE_LIMIT) {
          const overflow = state.queue.length - env.WS_QUEUE_LIMIT;
          state.queue.splice(0, overflow);
          state.dropped += overflow;
          metrics.totalMessagesDropped += overflow;
        }
      }
    }
  }, 1000);

  const batchPublishInterval = setInterval(() => {
    for (const [socket, state] of clientState.entries()) {
      if (socket.readyState !== socket.OPEN || state.queue.length === 0) {
        continue;
      }
      if (socket.bufferedAmount > 1_000_000) {
        const toDrop = state.queue.length;
        state.queue = [];
        state.dropped += toDrop;
        metrics.totalMessagesDropped += toDrop;
        continue;
      }

      const quotes = state.queue.splice(0, state.queue.length);
      const payload = wsServerMarketBatchSchema.parse({
        type: 'market.batch',
        quotes,
        dropped: state.dropped,
      });
      state.dropped = 0;
      socket.send(JSON.stringify(payload));
      metrics.totalMessagesSent += quotes.length;
    }
  }, env.WS_BATCH_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(quoteGenerationInterval);
    clearInterval(batchPublishInterval);
  });

  return {
    readMetrics: () => ({ ...metrics }),
  };
}
