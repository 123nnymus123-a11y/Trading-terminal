/**
 * Supply Chain Mind-Map Enricher
 * Enhances the mind-map with real-time supply chain data, risks, and validations
 * Focuses on supply chain specific insights, not financial metrics
 */

import type { MindMapData, CompanyNode } from "@tc/shared/supplyChain";
import { fetchSupplyChainNews, detectSupplyChainRisks, findAlternativeSuppliers } from "./dataValidator";
import { resolveCompanyGeo } from "./companyGeo";

export interface EnrichedCompanyNode extends CompanyNode {
  /** Real-time supply chain risks affecting this supplier */
  supplyChainRisks?: Array<{
    risk: string;
    severity: "low" | "medium" | "high" | "critical";
    source: string;
  }>;
  /** Real news about this supplier's supply chain */
  recentSupplyChainNews?: Array<{
    title: string;
    url: string;
    date?: string;
  }>;
  /** Health score based on risk assessment (0-100) */
  healthScore?: number;
  /** Whether supplier has geopolitical risk exposure */
  geopoliticalRisk?: string;
  /** Backup/alternative suppliers if this one fails */
  backupSuppliers?: string[];
}

/**
 * Enrich a single company node with live supply chain data
 */
export async function enrichCompanyNode(
  node: CompanyNode,
  companyRole: string
): Promise<EnrichedCompanyNode> {
  const enriched: EnrichedCompanyNode = { ...node };

  try {
    // Fetch supply chain specific risks
    const risks = await detectSupplyChainRisks(node.id);
    if (risks.length > 0) {
      enriched.supplyChainRisks = risks.map((r) => ({
        risk: r.risk,
        severity: r.severity,
        source: r.source,
      }));
    }

    // Fetch supply chain news about this supplier
    const news = await fetchSupplyChainNews(node.id);
    if (news.length > 0) {
      enriched.recentSupplyChainNews = news.slice(0, 3).map((n) => ({
        title: n.title,
        sentiment: n.sentiment,
        url: n.url,
      }));
    }

    // Calculate health score based on risks
    let healthScore = 100;
    if (enriched.supplyChainRisks) {
      for (const risk of enriched.supplyChainRisks) {
        const penalty = risk.severity === "critical" ? 30 : risk.severity === "high" ? 20 : risk.severity === "medium" ? 10 : 5;
        healthScore -= penalty;
      }
    }
    enriched.healthScore = Math.max(0, healthScore);

    // Detect geopolitical risks
    if (node.id.toUpperCase() === "TSMC" || node.id.toUpperCase().includes("TAIWAN")) {
      enriched.geopoliticalRisk = "Taiwan strait tensions - monitor closely";
    } else if (node.id.toUpperCase().includes("CHINA") || node.id.toUpperCase() === "SMIC") {
      enriched.geopoliticalRisk = "US export control restrictions apply";
    } else if (node.id.toUpperCase().includes("RUSSIA")) {
      enriched.geopoliticalRisk = "EU/US sanctions active";
    }

    // Find alternative suppliers for this category
    if (companyRole) {
      const alternatives = await findAlternativeSuppliers(node.id, companyRole);
      if (alternatives.length > 0) {
        enriched.backupSuppliers = alternatives;
      }
    }

    // Add geographical coordinates for world map visualization
    if (!enriched.metadata) {
      enriched.metadata = {};
    }
    if (!enriched.metadata.hqLat || !enriched.metadata.hqLon) {
      const geo = await resolveCompanyGeo(enriched.name || enriched.id, {
        city: enriched.metadata.hqCity as string | undefined,
        state: enriched.metadata.hqState as string | undefined,
        country: enriched.metadata.hqCountry as string | undefined,
      });
      if (geo) {
        enriched.metadata.hqLat = geo.lat;
        enriched.metadata.hqLon = geo.lon;
        if (geo.city) enriched.metadata.hqCity = geo.city;
        if (geo.state) enriched.metadata.hqState = geo.state;
        if (geo.country) enriched.metadata.hqCountry = geo.country;
        enriched.metadata.hqSource = geo.source;
      }
    }
  } catch (err) {
    console.warn(`[mindMapEnricher] Failed to enrich ${node.id}:`, err);
  }

  return enriched;
}

/**
 * Enrich entire mind-map with supply chain data
 */
export async function enrichMindMap(mindMapData: MindMapData): Promise<MindMapData> {
  const enriched: MindMapData = {
    ...mindMapData,
    categories: [],
  };

  // Process each category and its companies
  for (const category of mindMapData.categories) {
    const enrichedCompanies: EnrichedCompanyNode[] = [];

    // Enrich companies in parallel (batch of 3 to avoid rate limiting)
    const companies = category.companies;
    for (let i = 0; i < companies.length; i += 3) {
      const batch = companies.slice(i, i + 3);
      const enrichedBatch = await Promise.all(
        batch.map((company) => enrichCompanyNode(company, category.name))
      );
      enrichedCompanies.push(...enrichedBatch);
    }

    // Calculate category health
    const avgHealth =
      enrichedCompanies.reduce((sum, c) => sum + (c.healthScore || 100), 0) /
      enrichedCompanies.length;

    // Build category insights
    const categoryInsights: string[] = [];
    
    if (avgHealth < 60) {
      categoryInsights.push(
        `Elevated supply chain risks in this sector - monitor closely for disruptions`
      );
    } else if (avgHealth < 80) {
      categoryInsights.push(
        `Some supply chain concerns detected - review backup suppliers`
      );
    } else {
      categoryInsights.push(
        `Supply chain appears stable - low immediate risk`
      );
    }

    // Check for geopolitical risks in category
    const geoRisks = enrichedCompanies.filter((c) => c.geopoliticalRisk).map((c) => c.geopoliticalRisk);
    if (geoRisks.length > 0) {
      categoryInsights.push(`⚠️ Geopolitical exposure: ${geoRisks.slice(0, 2).join(", ")}`);
    }

    // Check for critical risks in category
    const criticalInCategory = enrichedCompanies.filter(
      (c) =>
        c.supplyChainRisks &&
        c.supplyChainRisks.some((r) => r.severity === "critical")
    );
    if (criticalInCategory.length > 0) {
      categoryInsights.push(
        `🔴 ${criticalInCategory.length} supplier(s) with critical risks`
      );
    }

    enriched.categories.push({
      ...category,
      companies: enrichedCompanies,
      categoryHealthScore: avgHealth,
      categoryInsights,
    });

    // Add insights about supply chain health
    if (!enriched.insights) {
      enriched.insights = [];
    }

    enriched.insights.push(
      `📊 ${category.name}: ${avgHealth >= 80 ? "✅ Healthy" : avgHealth >= 60 ? "🟡 Caution" : "🔴 At Risk"} (${avgHealth.toFixed(0)}%)`
    );
  }

  // Add critical risk warnings at top level
  const criticalRisks = enriched.categories.flatMap((cat) =>
    cat.companies
      .filter((c): c is EnrichedCompanyNode => "supplyChainRisks" in c && !!c.supplyChainRisks)
      .flatMap((c) =>
        (c.supplyChainRisks || [])
          .filter((r) => r.severity === "critical")
          .map((r) => `${c.name}: ${r.risk}`)
      )
  );

  if (criticalRisks.length > 0) {
    enriched.insights?.unshift(
      `🚨 CRITICAL RISKS DETECTED: ${criticalRisks.slice(0, 2).join(" | ")}`
    );
  }

  return enriched;
}

/**
 * Format enriched mind-map for display (highlight risks and opportunities)
 */
export function formatEnrichedNodeForDisplay(node: EnrichedCompanyNode): {
  healthBadge: string;
  riskSummary: string;
  backupInfo: string;
} {
  const healthBadge =
    node.healthScore !== undefined
      ? node.healthScore >= 80
        ? "🟢"
        : node.healthScore >= 60
        ? "🟡"
        : node.healthScore >= 40
        ? "🟠"
        : "🔴"
      : "";

  const riskSummary = node.supplyChainRisks
    ? node.supplyChainRisks.length > 0
      ? `${node.supplyChainRisks.length} risk(s)`
      : "No known risks"
    : "";

  const backupInfo = node.backupSuppliers
    ? node.backupSuppliers.length > 0
      ? `Backups: ${node.backupSuppliers.slice(0, 2).join(", ")}`
      : ""
    : "";

  return { healthBadge, riskSummary, backupInfo };
}
