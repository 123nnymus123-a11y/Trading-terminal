import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchLiveTedSnapshot,
  fetchLiveTedSnapshotStrict,
  type TedLiveConfig,
} from "./tedIntelLive.js";

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

  it("uses POST and maps TED v3 search payload to live snapshot", async () => {
    let capturedMethod = "";
    let capturedBody = "";

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      capturedMethod = String(init?.method ?? "");
      capturedBody = String(init?.body ?? "");

      return new Response(
        JSON.stringify({
          results: [
            {
              "publication-number": "12345-2026",
              "BT-21-Notice": "Contract award notice for cloud services",
              "publication-date": "2026-03-30",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });

    const snapshot = await fetchLiveTedSnapshotStrict(
      {
        ...baseConfig,
        baseUrl: "https://api.ted.europa.eu/v3/notices/search",
        apiKey: "abc123",
      },
      "90d",
    );

    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toContain("publication-number");
    expect(snapshot.sourceMode).toBe("live");
    expect(snapshot.sourceLabel).toContain("TED v3 Search API");
    expect(snapshot.radar.length).toBeGreaterThan(0);
    expect(snapshot.radar[0]?.sourceId).toBe("12345-2026");
  });
});
