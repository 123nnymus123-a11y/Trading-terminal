import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { SyncMode } from "./types";

export type GraphEnrichmentConfig = {
  localDbPath: string;
  exportPath: string;
  cloudEnabled: boolean;
  cloudProvider: string;
  cloudDbUrl: string;
  cloudBucket: string;
  cloudSyncMode: SyncMode;
  cloudProjectId: string;
};

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes")
    return true;
  if (normalized === "0" || normalized === "false" || normalized === "no")
    return false;
  return fallback;
}

function resolveSyncMode(value: string | undefined): SyncMode {
  if (!value) return "manual";
  const normalized = value.trim().toLowerCase();
  if (normalized === "pull") return "pull";
  if (normalized === "push") return "push";
  if (normalized === "bidirectional") return "bidirectional";
  return "manual";
}

export function resolveGraphEnrichmentConfig(): GraphEnrichmentConfig {
  const userData = app.getPath("userData");
  const defaultDataRoot = path.join(userData, "data");
  const defaultExportRoot = path.join(defaultDataRoot, "exports");
  const localDbPath =
    process.env.LOCAL_DB_PATH && process.env.LOCAL_DB_PATH.trim().length > 0
      ? process.env.LOCAL_DB_PATH
      : path.join(defaultDataRoot, "app.db");
  const exportPath =
    process.env.EXPORT_PATH && process.env.EXPORT_PATH.trim().length > 0
      ? process.env.EXPORT_PATH
      : defaultExportRoot;

  const config: GraphEnrichmentConfig = {
    localDbPath,
    exportPath,
    cloudEnabled: parseBoolean(process.env.CLOUD_ENABLED, false),
    cloudProvider: process.env.CLOUD_PROVIDER?.trim() || "placeholder",
    cloudDbUrl: process.env.CLOUD_DB_URL?.trim() || "",
    cloudBucket: process.env.CLOUD_BUCKET?.trim() || "",
    cloudSyncMode: resolveSyncMode(process.env.CLOUD_SYNC_MODE),
    cloudProjectId: process.env.CLOUD_PROJECT_ID?.trim() || "",
  };

  const directories = [
    path.join(userData, "data", "local"),
    path.join(userData, "data", "exports", "json"),
    path.join(userData, "data", "exports", "csv"),
    path.join(userData, "data", "snapshots"),
    path.join(userData, "data", "schema"),
    path.join(userData, "data", "migrations"),
    path.join(userData, "data", "cloud"),
    path.join(userData, "logs", "enrichment"),
    path.join(userData, "logs", "validation"),
  ];

  directories.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  return config;
}
