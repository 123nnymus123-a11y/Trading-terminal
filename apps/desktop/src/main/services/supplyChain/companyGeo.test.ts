import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveCompanyGeo } from "./companyGeo";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveCompanyGeo", () => {
  it("returns curated coordinates for known company alias", async () => {
    const result = await resolveCompanyGeo("Apple, Inc.");

    expect(result).toBeTruthy();
    expect(result?.source).toBe("curated");
    expect(result?.city).toBe("Cupertino");
  });

  it("uses normalized country hints when scoring candidates", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            lat: "52.5200",
            lon: "13.4050",
            importance: 0.9,
            display_name: "Acme Holdings HQ, Berlin, Germany",
            address: { city: "Berlin", country: "Germany" },
            class: "office",
            type: "office",
          },
          {
            lat: "37.7749",
            lon: "-122.4194",
            importance: 0.6,
            display_name: "Acme Inc Headquarters, San Francisco, United States",
            address: { city: "San Francisco", country: "United States" },
            class: "office",
            type: "office",
          },
        ],
      });

    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveCompanyGeo("Acme Inc", {
      city: "San Francisco",
      country: "USA",
    });

    expect(result).toBeTruthy();
    expect(result?.country).toBe("United States");
    expect(result?.lat).toBeCloseTo(37.7749, 4);
  });

  it("returns null for invalid coordinate payloads", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            lat: "not-a-number",
            lon: "180",
            importance: 0.8,
            display_name: "Broken HQ",
            address: { city: "Nowhere", country: "United States" },
          },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveCompanyGeo("Unknown Corp", {
      country: "United States",
    });

    expect(result).toBeNull();
  });
});
