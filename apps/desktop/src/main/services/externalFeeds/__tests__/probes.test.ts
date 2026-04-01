import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { testBlsConnection, testCftcConnection, testSecConnection } from "../probes";
import type { ProviderTestContext } from "../types";

const baseConfig = {
  enabled: { cftc: true, bls: true, sec: true },
  bls: {},
  cftc: {},
  sec: {},
};

const sampleCftc = `Market_and_Exchange_Names,As_of_Date_In_Form_YYMMDD,CFTC_Contract_Market_Code,Prod_Merc_Positions_Long_All,Prod_Merc_Positions_Short_All,Swap_Positions_Long_All,Swap_Positions_Short_All,M_Money_Positions_Long_All,M_Money_Positions_Short_All,Other_Rept_Positions_Long_All,Other_Rept_Positions_Short_All,NonRept_Positions_Long_All,NonRept_Positions_Short_All
SP500 - CME,20260128,13874,10,20,30,40,50,60,70,80,90,100
`;

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("external feed probes", () => {
  it("validates BLS probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "REQUEST_SUCCEEDED",
        Results: { series: [{ data: [{ year: "2026", period: "M01", value: "123" }] }] },
      }),
    });
    // @ts-ignore
    global.fetch = fetchMock;

    const ctx: ProviderTestContext = { config: baseConfig, credentials: { BLS_API_KEY: "test" } };
    const result = await testBlsConnection(ctx);
    expect(result.ok).toBe(true);
  });

  it("validates SEC probe", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<ownershipDocument>FORM 8-K</ownershipDocument>",
    });
    // @ts-ignore
    global.fetch = fetchMock;

    const ctx: ProviderTestContext = { config: baseConfig };
    const result = await testSecConnection(ctx);
    expect(result.ok).toBe(true);
  });

  it("validates CFTC probe with sample file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cftc-"));
    const file = path.join(dir, "sample.txt");
    fs.writeFileSync(file, sampleCftc, "utf8");

    const ctx: ProviderTestContext = {
      config: {
        ...baseConfig,
        cftc: { sampleZipPath: file },
      },
    };
    const result = await testCftcConnection(ctx);
    expect(result.ok).toBe(true);
  });
});
