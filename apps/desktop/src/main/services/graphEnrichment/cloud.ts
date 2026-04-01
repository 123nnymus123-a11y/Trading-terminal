import type { SyncConflictStrategy, SyncMode, SyncStatus } from "./types";

export type GraphSyncEnvelope = {
  entities: unknown[];
  edges: unknown[];
  evidence: unknown[];
  since?: string;
};

export type CloudGraphRepository = {
  readonly provider: string;
  readonly connected: boolean;
  pull: (since?: string) => Promise<GraphSyncEnvelope>;
  push: (
    payload: GraphSyncEnvelope,
  ) => Promise<{ accepted: number; rejected: number }>;
  ping: () => Promise<{ ok: boolean; message: string }>;
};

export type OfflineWriteQueue = {
  enqueue: (operation: string, payload: unknown) => Promise<void>;
  size: () => Promise<number>;
};

export type SyncPolicy = {
  mode: SyncMode;
  conflictStrategy: SyncConflictStrategy;
};

export class NotConnectedCloudGraphRepository implements CloudGraphRepository {
  readonly provider: string;
  readonly connected = false;

  constructor(provider = "placeholder") {
    this.provider = provider;
  }

  async pull(): Promise<GraphSyncEnvelope> {
    return { entities: [], edges: [], evidence: [] };
  }

  async push(): Promise<{ accepted: number; rejected: number }> {
    return { accepted: 0, rejected: 0 };
  }

  async ping(): Promise<{ ok: boolean; message: string }> {
    return {
      ok: false,
      message:
        "Cloud sync is disabled. Configure CLOUD_ENABLED=true and provider settings to connect later.",
    };
  }
}

export function buildNotConnectedStatus(params: {
  provider: string;
  mode: SyncMode;
  queueSize: number;
  lastSyncAt: string | null;
}): SyncStatus {
  return {
    cloudEnabled: false,
    connected: false,
    provider: params.provider,
    mode: params.mode,
    lastSyncAt: params.lastSyncAt,
    queueSize: params.queueSize,
    message: "Not connected yet. Local-first mode is active.",
  };
}
