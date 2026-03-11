import fs from "node:fs";
import { ProviderTestContext, ProviderTestResult } from "./types";
import { loadCftcText, parseCftcDisaggCsv } from "./adapters/cftcCotAdapter";

const SEC_TEST_8K = "https://www.sec.gov/Archives/edgar/data/320193/000114036125044561/ef20060722_8k.htm";
const SEC_TEST_FORM4 = "https://www.sec.gov/Archives/edgar/data/320193/000032019324000114/xslF345X05/wk-form4_1728426607.xml";
const CFTC_LIVE = "https://www.cftc.gov/dea/newcot/f_disagg.txt";

function userAgent(ctx: ProviderTestContext) {
  return ctx.config.sec?.userAgent || "TradingCockpitExternalFeeds/1.0 (support@localhost)";
}

export async function testBlsConnection(ctx: ProviderTestContext): Promise<ProviderTestResult> {
  const apiKey = ctx.credentials?.BLS_API_KEY || ctx.credentials?.apiKey;
  if (!apiKey) {
    return { ok: false, message: "Missing BLS API key" };
  }

  const body = {
    seriesid: ["JTS000000000000000JOL"],
    registrationkey: apiKey,
  };

  try {
    const res = await fetch("https://api.bls.gov/publicAPI/v2/timeseries/data/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { ok: false, message: `BLS HTTP ${res.status}` };
    }

    const json = (await res.json()) as any;
    const series = json?.Results?.series?.[0]?.data;
    if (json?.status === "REQUEST_SUCCEEDED" && Array.isArray(series) && series.length) {
      return { ok: true, message: "BLS connection successful" };
    }

    return { ok: false, message: "BLS response missing series data" };
  } catch (err) {
    return { ok: false, message: `BLS connection error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function testSecConnection(ctx: ProviderTestContext): Promise<ProviderTestResult> {
  try {
    const headers = {
      "User-Agent": userAgent(ctx),
      Accept: "text/html,application/xml",
    };

    const [form4Res, eightKRes] = await Promise.all([
      fetch(SEC_TEST_FORM4, { headers }),
      fetch(SEC_TEST_8K, { headers }),
    ]);

    if (!form4Res.ok) return { ok: false, message: `SEC Form 4 HTTP ${form4Res.status}` };
    if (!eightKRes.ok) return { ok: false, message: `SEC 8-K HTTP ${eightKRes.status}` };

    const form4Text = await form4Res.text();
    const eightKText = await eightKRes.text();

    const form4Ok = form4Text.includes("ownershipDocument") || form4Text.includes("<ownershipDocument>");
    const eightKOk = /FORM\s+8-K/i.test(eightKText) || /8-K/i.test(eightKText);

    if (form4Ok && eightKOk) {
      return { ok: true, message: "SEC connection successful" };
    }

    return { ok: false, message: "SEC response missing expected markers" };
  } catch (err) {
    return { ok: false, message: `SEC connection error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function testCftcConnection(ctx: ProviderTestContext): Promise<ProviderTestResult> {
  const samplePath = ctx.config.cftc?.sampleZipPath;
  try {
    if (samplePath && fs.existsSync(samplePath)) {
      const text = await loadCftcText(samplePath);
      const rows = parseCftcDisaggCsv(text);
      if (rows.length > 0) {
        return { ok: true, message: "CFTC sample file parsed successfully" };
      }
      return { ok: false, message: "CFTC sample file parsed but no rows" };
    }

    const res = await fetch(CFTC_LIVE, { method: "HEAD" });
    if (res.ok) {
      return { ok: true, message: "CFTC endpoint reachable" };
    }
    return { ok: false, message: `CFTC HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, message: `CFTC connection error: ${err instanceof Error ? err.message : String(err)}` };
  }
}
