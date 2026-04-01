import crypto from "node:crypto";
import type { ApiCredentialRecord, ApiHubSnapshot } from "../../shared/apiHub";
import { AppSettingsRepo } from "../persistence/repos";
import { deleteSecret } from "../secrets";

function normalizeRecord(record: ApiCredentialRecord | any, fallbackCreatedAt?: number): ApiCredentialRecord {
  const normalizedFields = Array.isArray(record?.fields)
    ? record.fields.map((field: any) => ({
        key: String(field.key),
        label: field.label ?? String(field.key ?? "Secret"),
        account: String(field.account ?? ""),
      }))
    : [];

  const config = record?.config && typeof record.config === "object"
    ? Object.fromEntries(
        Object.entries(record.config).map(([key, value]) => [String(key), typeof value === "string" ? value : String(value ?? "")])
      )
    : undefined;

  return {
    id: String(record?.id ?? crypto.randomUUID()),
    name: record?.name ?? "Untitled Credential",
    provider: record?.provider ?? "other",
    createdAt: typeof record?.createdAt === "number" ? record.createdAt : fallbackCreatedAt ?? Date.now(),
    fields: normalizedFields,
    config,
  };
}

export class ApiHubService {
  private readState(): ApiHubSnapshot {
    const settings = AppSettingsRepo.get() ?? {};
    const hub = (settings.apiHub ?? {}) as Partial<ApiHubSnapshot>;
    const records = Array.isArray(hub.records) ? hub.records.map((record) => normalizeRecord(record)) : [];
    return {
      records,
      updatedAt: typeof hub.updatedAt === "number" ? hub.updatedAt : 0,
    };
  }

  private persist(records: ApiCredentialRecord[]): ApiHubSnapshot {
    const snapshot: ApiHubSnapshot = {
      records,
      updatedAt: Date.now(),
    };
    const settings = AppSettingsRepo.get() ?? {};
    AppSettingsRepo.set({ ...settings, apiHub: snapshot });
    return snapshot;
  }

  list(): ApiHubSnapshot {
    return this.readState();
  }

  upsert(record: ApiCredentialRecord): ApiHubSnapshot {
    const snapshot = this.readState();
    const records = [...snapshot.records];
    const idx = records.findIndex((entry) => entry.id === record.id);
    const normalized = normalizeRecord(record, idx >= 0 ? records[idx].createdAt : undefined);
    if (idx >= 0) {
      records[idx] = { ...records[idx], ...normalized };
    } else {
      records.push(normalized);
    }
    return this.persist(records);
  }

  async remove(id: string): Promise<ApiHubSnapshot> {
    const snapshot = this.readState();
    const target = snapshot.records.find((entry) => entry.id === id);
    const remaining = snapshot.records.filter((entry) => entry.id !== id);
    if (target) {
      await Promise.all(target.fields.map((field) => deleteSecret(field.account).catch(() => undefined)));
    }
    return this.persist(remaining);
  }
}
