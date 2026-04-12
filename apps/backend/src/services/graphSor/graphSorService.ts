import type { Pool } from "pg";
import {
  GraphSorRepo,
  type GraphSorFactUpsertInput,
  type GraphSorFactUpsertResult,
  type GraphSorStatus,
} from "./graphSorRepo.js";

export type GraphSorService = {
  getStatus: (tenantId?: string) => Promise<GraphSorStatus>;
  upsertFact: (
    input: GraphSorFactUpsertInput,
    tenantId?: string,
  ) => Promise<GraphSorFactUpsertResult>;
};

export function createGraphSorService(pool: Pool): GraphSorService {
  const repo = new GraphSorRepo(pool);

  return {
    async getStatus(tenantId) {
      return repo.getStatus(tenantId);
    },
    async upsertFact(input, tenantId) {
      return repo.upsertFact(input, tenantId);
    },
  };
}
