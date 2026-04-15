import { describe, expect, it } from "vitest";
import {
  getDefaultBackendUrl,
  normalizeBackendUrl,
} from "./backendConfig";

describe("backendConfig", () => {
  it("keeps localhost as the development fallback", () => {
    expect(getDefaultBackendUrl([])).toBe("http://localhost:8787");
  });

  it("prefers a secure configured backend over localhost", () => {
    expect(getDefaultBackendUrl(["https://api.example.com"])).toBe(
      "https://api.example.com",
    );
  });

  it("rejects insecure non-local http endpoints", () => {
    expect(normalizeBackendUrl("http://api.example.com")).toBeNull();
  });
});
