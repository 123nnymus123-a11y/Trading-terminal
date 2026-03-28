import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiveTedSnapshot, type TedLiveConfig } from "./tedIntelLive.js";

const baseConfig: TedLiveConfig = {
  enabled: true,
  baseUrl: "https://ted.example.test/api/snapshot",
  apiKey: "",
  authHeader: "x-api-key",
  timeoutMs: 12_000,
  windowQueryParam: "window",
};

const minimalSnapshotPayload = {
  generatedAt: "2026-03-20T10:00:00.000Z",
  timeWindow: "90d",
  summaryCards: [],
  radar: [],
  sectors: [],
  regions: [],
  buyers: [],
  suppliers: [],
  watchlist: [],
  mapFlows: [],
  anomalies: [],
  dataVault: {},
  supplyChainOverlay: [],
  panorama: {},
};

describe("fetchLiveTedSnapshot auth header handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds Bearer prefix for Authorization header when api key is raw token", async () => {
    let capturedAuthorizationHeader = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      capturedAuthorizationHeader =
        headers?.Authorization ?? headers?.authorization ?? "";
      return new Response(JSON.stringify(minimalSnapshotPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const snapshot = await fetchLiveTedSnapshot(
      {
        ...baseConfig,
        authHeader: "Authorization",
        apiKey: "my-token",
      },
      "90d",
    );

    expect(snapshot).not.toBeNull();
    expect(capturedAuthorizationHeader).toBe("Bearer my-token");
  });
});
