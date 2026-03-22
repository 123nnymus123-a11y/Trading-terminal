import type { Pool } from "pg";
import {
  GwmdCloudRepo,
  type GwmdCloudCompany,
  type GwmdCloudRelationship,
} from "./gwmdCloudRepo.js";

export type GwmdCloudService = {
  pushSnapshot: (
    payload: {
      companies: GwmdCloudCompany[];
      relationships: GwmdCloudRelationship[];
      replace?: boolean;
    },
    tenantId?: string,
  ) => Promise<{
    applied: { companies: number; relationships: number };
    status: {
      cloudVersion: number;
      lastSyncAt: string | null;
      companiesCount: number;
      relationshipsCount: number;
      syncStatus: "idle" | "syncing" | "ok" | "error";
    };
  }>;
  pullSnapshot: (
    tenantId?: string,
    sinceIso?: string,
  ) => Promise<{
    companies: GwmdCloudCompany[];
    relationships: GwmdCloudRelationship[];
    status: {
      cloudVersion: number;
      lastSyncAt: string | null;
      companiesCount: number;
      relationshipsCount: number;
      syncStatus: "idle" | "syncing" | "ok" | "error";
    };
  }>;
  getStatus: (tenantId?: string) => Promise<{
    cloudVersion: number;
    lastSyncAt: string | null;
    companiesCount: number;
    relationshipsCount: number;
    syncStatus: "idle" | "syncing" | "ok" | "error";
  }>;
};

export function createGwmdCloudService(pool: Pool): GwmdCloudService {
  const repo = new GwmdCloudRepo(pool);

  return {
    async pushSnapshot(payload, tenantId) {
      return repo.pushSnapshot(payload, tenantId);
    },
    async pullSnapshot(tenantId, sinceIso) {
      return repo.pullSnapshot(tenantId, sinceIso);
    },
    async getStatus(tenantId) {
      return repo.getStatus(tenantId);
    },
  };
}
