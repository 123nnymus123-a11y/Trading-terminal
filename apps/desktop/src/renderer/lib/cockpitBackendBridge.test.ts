import { beforeEach, describe, expect, it, vi } from "vitest";

const authGet = vi.fn(async (path: string) => {
  if (path === "/api/ai/models") {
    return { models: ["gpt-4o-mini"] };
  }
  if (path === "/api/ai/research/status") {
    return { running: false, queueDepth: 0 };
  }
  if (path === "/api/ai/research/config") {
    return { enabled: true, model: "gpt-4o-mini" };
  }
  if (path === "/api/ai/research/briefs?limit=5") {
    return { briefs: [] };
  }
  if (path === "/api/ai/steward/overview") {
    return { summary: "ok" };
  }
  if (path === "/api/ai/steward/health") {
    return { healthy: true };
  }
  if (path === "/api/ai/steward/incident-digest") {
    return { incidents: [] };
  }
  if (path === "/api/ai/steward/findings") {
    return [];
  }
  if (path === "/api/ai/steward/tasks") {
    return [];
  }
  if (path === "/api/ai/gwmd/sync/pull") {
    return { ok: true, data: { companies: [], relationships: [] } };
  }
  if (path === "/api/ai/gwmd/sync/status") {
    return { ok: true, status: { syncStatus: "idle", cloudVersion: 0, companiesCount: 0, relationshipsCount: 0, lastSyncAt: null } };
  }
  return { items: [], keys: [], settings: {} };
});

const authRequest = vi.fn(async (path: string) => {
  if (path === "/api/ai/supplychain/generate") {
    return {
      ticker: "NVDA",
      nodes: [{ id: "NVDA", label: "NVIDIA", type: "company" }],
      edges: [],
      insights: [],
    };
  }
  if (path === "/api/ai/gwmd/sync/push") {
    return { ok: true, status: { syncStatus: "ok" } };
  }
  return { ok: true, items: [], keys: [], settings: {} };
});

vi.mock("./apiClient", () => ({
  authGet,
  authRequest,
}));

describe("installCockpitBackendBridge", () => {
  beforeEach(() => {
    vi.resetModules();
    authGet.mockClear();
    authRequest.mockClear();
    (globalThis as typeof globalThis & { window: any }).window = {
      cockpit: {},
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    };
  });

  it("adds browser-safe AI and GWMD bridge APIs", async () => {
    const { installCockpitBackendBridge } = await import("./cockpitBackendBridge");

    await installCockpitBackendBridge();

    expect(typeof window.cockpit.aiResearch?.listModels).toBe("function");
    expect(typeof window.cockpit.aiResearch?.checkRuntime).toBe("function");
    expect(typeof window.cockpit.aiSteward?.getOverview).toBe("function");
    expect(typeof window.cockpit.gwmdMap?.search).toBe("function");
    expect(typeof window.cockpit.gwmdMap?.syncStatus).toBe("function");
  });
});
