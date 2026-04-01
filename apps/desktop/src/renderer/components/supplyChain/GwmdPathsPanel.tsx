import React, { useMemo, useState } from "react";
import type { SupplyChainGraph, SupplyChainGraphEdge, SupplyChainGraphNode } from "@tc/shared/supplyChain";
import { resolveNodeRegion } from "./gwmdUtils";
import { decodePlaceCode, isValidLatLon, parseCoordinate } from "../../lib/gwmdPlaceCode";

interface Props {
  graph: SupplyChainGraph;
  simulation: {
    failedNodeIds: string[];
    failedEdgeIds: string[];
    impactScores?: Record<string, number>;
    impactedEdgeIds?: string[];
  };
  selectedNode: SupplyChainGraphNode | undefined;
  selectedEdge: SupplyChainGraphEdge | undefined;
  filters: {
    region: string;
    relation: string;
    showFlows: boolean;
    showOnlyImpacted: boolean;
    hops?: number;
  };
  onSelectNode: (nodeId: string) => void;
  onSelectEdge: (edgeId: string) => void;
}

type TabMode = "trade" | "supply";

interface TradePath {
  fromRegion: string;
  toRegion: string;
  edges: SupplyChainGraphEdge[];
  totalVolume: number;
  avgConfidence: number;
}

interface SupplyChainPath {
  chain: Array<{ nodeId: string; label: string; region: string; role: string }>;
  edges: SupplyChainGraphEdge[];
  totalWeight: number;
}

function edgeWeight(edge: SupplyChainGraphEdge) {
  if (edge.weightRange) {
    return (edge.weightRange.min + edge.weightRange.max) / 2;
  }
  if (typeof edge.weight === "number") return edge.weight;
  return edge.criticality ?? 1;
}

function hasValidCoordinates(node: SupplyChainGraphNode) {
  const meta = node.metadata as {
    hqPlaceCode?: string;
    hqLat?: number | string;
    hqLon?: number | string;
  } | undefined;
  const fromPlaceCode = decodePlaceCode(meta?.hqPlaceCode);
  const lat = fromPlaceCode?.lat ?? parseCoordinate(meta?.hqLat);
  const lon = fromPlaceCode?.lon ?? parseCoordinate(meta?.hqLon);
  return isValidLatLon(lat, lon);
}

const sectionStyle: React.CSSProperties = {
  padding: 14,
  borderRadius: 12,
  background: "rgba(15,23,42,0.6)",
  border: "1px solid rgba(148,163,184,0.1)",
};

const subheadingStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#94a3b8",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 10,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  flex: 1,
  padding: "8px 12px",
  fontSize: 12,
  fontWeight: 600,
  border: "none",
  borderRadius: 8,
  background: active ? "rgba(59,130,246,0.2)" : "transparent",
  color: active ? "#60a5fa" : "#94a3b8",
  cursor: "pointer",
  transition: "all 0.2s",
});

export default function GwmdPathsPanel({
  graph,
  simulation,
  selectedNode,
  selectedEdge,
  filters,
  onSelectNode,
  onSelectEdge,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabMode>("trade");
  const nodeIndex = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  // Build trade flow paths (region to region)
  const tradePaths = useMemo(() => {
    const pathMap = new Map<string, TradePath>();
    
    graph.edges.forEach((edge) => {
      if (filters.relation !== "all" && edge.kind !== filters.relation) return;
      if (filters.showOnlyImpacted && !simulation.impactedEdgeIds?.includes(edge.id)) return;
      
      const fromNode = graph.nodes.find((n) => n.id === edge.from);
      const toNode = graph.nodes.find((n) => n.id === edge.to);
      if (!fromNode || !toNode) return;
      
      const fromRegion = resolveNodeRegion(fromNode);
      const toRegion = resolveNodeRegion(toNode);
      
      if (filters.region !== "All" && fromRegion !== filters.region && toRegion !== filters.region) return;
      
      const key = `${fromRegion}→${toRegion}`;
      const existing = pathMap.get(key);
      const weight = edge.weightRange 
        ? (edge.weightRange.min + edge.weightRange.max) / 2 
        : (edge.weight ?? edge.criticality ?? 1);
      
      if (existing) {
        existing.edges.push(edge);
        existing.totalVolume += weight;
        existing.avgConfidence = (existing.avgConfidence * (existing.edges.length - 1) + (edge.confidence ?? 0.6)) / existing.edges.length;
      } else {
        pathMap.set(key, {
          fromRegion,
          toRegion,
          edges: [edge],
          totalVolume: weight,
          avgConfidence: edge.confidence ?? 0.6,
        });
      }
    });
    
    return Array.from(pathMap.values())
      .sort((a, b) => b.totalVolume - a.totalVolume)
      .slice(0, 15);
  }, [graph, filters, simulation.impactedEdgeIds]);

  // Build supply chain paths (multi-hop)
  const supplyChainPaths = useMemo(() => {
    const paths: SupplyChainPath[] = [];
    // Find chains starting with suppliers
    const supplierEdges = graph.edges.filter((e) => e.kind === "supplier");
    
    supplierEdges.forEach((supplierEdge) => {
      if (filters.showOnlyImpacted && !simulation.impactedEdgeIds?.includes(supplierEdge.id)) return;
      
      const supplier = nodeIndex.get(supplierEdge.from);
      const manufacturer = nodeIndex.get(supplierEdge.to);
      if (!supplier || !manufacturer) return;
      
      // Find downstream customers
      const customerEdges = graph.edges.filter((e) => 
        e.kind === "customer" && 
        e.from === manufacturer.id &&
        (!filters.showOnlyImpacted || simulation.impactedEdgeIds?.includes(e.id))
      );
      
      if (customerEdges.length > 0) {
        customerEdges.forEach((customerEdge) => {
          const customer = nodeIndex.get(customerEdge.to);
          if (!customer) return;
          
          const supplierRegion = resolveNodeRegion(supplier);
          const manufacturerRegion = resolveNodeRegion(manufacturer);
          const customerRegion = resolveNodeRegion(customer);
          
          if (filters.region !== "All" && 
              supplierRegion !== filters.region && 
              manufacturerRegion !== filters.region && 
              customerRegion !== filters.region) return;
          
          const weight1 = supplierEdge.weightRange 
            ? (supplierEdge.weightRange.min + supplierEdge.weightRange.max) / 2 
            : (supplierEdge.weight ?? supplierEdge.criticality ?? 1);
          const weight2 = customerEdge.weightRange 
            ? (customerEdge.weightRange.min + customerEdge.weightRange.max) / 2 
            : (customerEdge.weight ?? customerEdge.criticality ?? 1);
          
          paths.push({
            chain: [
              { nodeId: supplier.id, label: supplier.label, region: supplierRegion, role: supplier.role ?? "supplier" },
              { nodeId: manufacturer.id, label: manufacturer.label, region: manufacturerRegion, role: manufacturer.role ?? "manufacturer" },
              { nodeId: customer.id, label: customer.label, region: customerRegion, role: customer.role ?? "customer" },
            ],
            edges: [supplierEdge, customerEdge],
            totalWeight: weight1 + weight2,
          });
        });
      } else {
        // Just the supplier → manufacturer chain
        const supplierRegion = resolveNodeRegion(supplier);
        const manufacturerRegion = resolveNodeRegion(manufacturer);
        
        if (filters.region === "All" || 
            supplierRegion === filters.region || 
            manufacturerRegion === filters.region) {
          const weight = supplierEdge.weightRange 
            ? (supplierEdge.weightRange.min + supplierEdge.weightRange.max) / 2 
            : (supplierEdge.weight ?? supplierEdge.criticality ?? 1);
          
          paths.push({
            chain: [
              { nodeId: supplier.id, label: supplier.label, region: supplierRegion, role: supplier.role ?? "supplier" },
              { nodeId: manufacturer.id, label: manufacturer.label, region: manufacturerRegion, role: manufacturer.role ?? "manufacturer" },
            ],
            edges: [supplierEdge],
            totalWeight: weight,
          });
        }
      }
    });
    
    return paths
      .sort((a, b) => b.totalWeight - a.totalWeight)
      .slice(0, 10);
  }, [graph, filters, simulation.impactedEdgeIds, nodeIndex]);

  const selectedFromNode = selectedEdge ? nodeIndex.get(selectedEdge.from) : undefined;
  const selectedToNode = selectedEdge ? nodeIndex.get(selectedEdge.to) : undefined;
  const unlocatedNodes = useMemo(() => {
    return graph.nodes.filter((node) => !hasValidCoordinates(node));
  }, [graph.nodes]);
  const selectedPartners = useMemo(() => {
    if (!selectedNode) return [] as Array<{ id: string; label: string; kind: string; weight: number }>;
    return graph.edges
      .filter((edge) => edge.from === selectedNode.id || edge.to === selectedNode.id)
      .map((edge) => {
        const otherId = edge.from === selectedNode.id ? edge.to : edge.from;
        const otherNode = nodeIndex.get(otherId);
        return {
          id: otherId,
          label: otherNode?.label ?? otherId,
          kind: edge.kind,
          weight: edgeWeight(edge),
        };
      })
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  }, [graph.edges, nodeIndex, selectedNode]);
  const subsidiaryLinks = useMemo(() => {
    if (!selectedNode) return [] as Array<{ id: string; label: string; kind: string }>;
    const subsidiaryKinds = new Set(["subsidiary", "parent", "holding", "holds"]);
    return graph.edges
      .filter((edge) => (edge.from === selectedNode.id || edge.to === selectedNode.id) && subsidiaryKinds.has(edge.kind))
      .map((edge) => {
        const otherId = edge.from === selectedNode.id ? edge.to : edge.from;
        const otherNode = nodeIndex.get(otherId);
        return {
          id: otherId,
          label: otherNode?.label ?? otherId,
          kind: edge.kind,
        };
      })
      .slice(0, 6);
  }, [graph.edges, nodeIndex, selectedNode]);
  const metadataSubsidiaries = useMemo(() => {
    const meta = selectedNode?.metadata as { subsidiaries?: string[] } | undefined;
    return meta?.subsidiaries ?? [];
  }, [selectedNode]);

  return (
    <>
      <section style={sectionStyle}>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button style={tabStyle(activeTab === "trade")} onClick={() => setActiveTab("trade")}>
            Trade Flows
          </button>
          <button style={tabStyle(activeTab === "supply")} onClick={() => setActiveTab("supply")}>
            Supply Chains
          </button>
        </div>

        {activeTab === "trade" && (
          <>
            <div style={subheadingStyle}>Top Trade Flow Paths</div>
            {tradePaths.length === 0 && (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                No trade paths found. Try adjusting filters.
              </div>
            )}
            {tradePaths.map((path, idx) => (
              <div
                key={idx}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  background: "rgba(15,23,42,0.5)",
                  marginBottom: 8,
                  cursor: "pointer",
                  border: "1px solid rgba(148,163,184,0.1)",
                  transition: "all 0.2s",
                }}
                onClick={() => {
                  // Select first edge in this path
                  if (path.edges.length > 0 && path.edges[0]) {
                    onSelectEdge(path.edges[0].id);
                  }
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(59,130,246,0.1)";
                  e.currentTarget.style.borderColor = "rgba(59,130,246,0.3)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(15,23,42,0.5)";
                  e.currentTarget.style.borderColor = "rgba(148,163,184,0.1)";
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>
                    {path.fromRegion} → {path.toRegion}
                  </div>
                  <div style={{ fontSize: 11, color: "#60a5fa" }}>
                    {path.totalVolume.toFixed(1)}
                  </div>
                </div>
                <div style={{ fontSize: 10, color: "#94a3b8" }}>
                  {path.edges.length} connection{path.edges.length !== 1 ? "s" : ""} • {Math.round(path.avgConfidence * 100)}% confidence
                </div>
              </div>
            ))}
          </>
        )}

        {activeTab === "supply" && (
          <>
            <div style={subheadingStyle}>Supply Chain Paths</div>
            {supplyChainPaths.length === 0 && (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>
                No supply chain paths found. Try adjusting filters or ensure supplier/customer relationships exist.
              </div>
            )}
            {supplyChainPaths.map((path, idx) => (
              <div
                key={idx}
                style={{
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(15,23,42,0.5)",
                  marginBottom: 10,
                  border: "1px solid rgba(148,163,184,0.1)",
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 600, color: "#60a5fa", marginBottom: 6 }}>
                  Weight: {path.totalWeight.toFixed(2)}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {path.chain.map((node, nodeIdx) => (
                    <React.Fragment key={node.nodeId}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: 11,
                          color: "#e2e8f0",
                          padding: "4px 8px",
                          borderRadius: 6,
                          background: "rgba(59,130,246,0.08)",
                          cursor: "pointer",
                        }}
                        onClick={() => onSelectNode(node.nodeId)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(59,130,246,0.15)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(59,130,246,0.08)";
                        }}
                      >
                        <span style={{ fontWeight: 500 }}>{node.label}</span>
                        <span style={{ fontSize: 10, color: "#94a3b8" }}>
                          {node.region} • {node.role}
                        </span>
                      </div>
                      {nodeIdx < path.chain.length - 1 && (
                        <div style={{ fontSize: 18, color: "#64748b", textAlign: "center", margin: "-2px 0" }}>
                          ↓
                        </div>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}
      </section>

      {unlocatedNodes.length > 0 && (
        <section style={sectionStyle}>
          <div style={subheadingStyle}>Unlocated Entities</div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
            {unlocatedNodes.length} node{unlocatedNodes.length !== 1 ? "s" : ""} missing coordinates
          </div>
          <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.5 }}>
            {unlocatedNodes
              .slice(0, 18)
              .map((node) => `${node.label} (${resolveNodeRegion(node)})`)
              .join(" • ")}
            {unlocatedNodes.length > 18 && " • …"}
          </div>
        </section>
      )}

      {selectedNode && (
        <section style={sectionStyle}>
          <div style={subheadingStyle}>Selected Node</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>
            {selectedNode.label}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
            {resolveNodeRegion(selectedNode)} • {selectedNode.role ?? "entity"}
          </div>
          {selectedNode.metadata && (
            <div style={{ fontSize: 10, color: "#64748b" }}>
              {selectedNode.canonicalName && <div>Canonical: {selectedNode.canonicalName}</div>}
              {selectedNode.tickers && selectedNode.tickers.length > 0 && (
                <div>Tickers: {selectedNode.tickers.join(", ")}</div>
              )}
              {(() => {
                const meta = selectedNode.metadata as { hqCity?: string; hqState?: string; hqCountry?: string } | undefined;
                const hq = [meta?.hqCity, meta?.hqState, meta?.hqCountry].filter(Boolean).join(", ");
                return hq ? <div>HQ: {hq}</div> : null;
              })()}
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <div style={subheadingStyle}>Main trade partners</div>
            {selectedPartners.length === 0 ? (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>No partners found in current graph.</div>
            ) : (
              selectedPartners.map((partner) => (
                <div key={`${partner.id}-${partner.kind}`} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#e2e8f0", marginBottom: 6 }}>
                  <span>{partner.label}</span>
                  <span style={{ color: "#94a3b8" }}>{partner.kind}</span>
                </div>
              ))
            )}
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={subheadingStyle}>Subsidiaries</div>
            {subsidiaryLinks.length === 0 && metadataSubsidiaries.length === 0 ? (
              <div style={{ fontSize: 11, color: "#94a3b8" }}>No subsidiary data in this graph.</div>
            ) : (
              <>
                {metadataSubsidiaries.slice(0, 6).map((name) => (
                  <div key={name} style={{ fontSize: 11, color: "#e2e8f0", marginBottom: 6 }}>
                    {name}
                  </div>
                ))}
                {subsidiaryLinks.map((link) => (
                  <div key={`${link.id}-${link.kind}`} style={{ fontSize: 11, color: "#e2e8f0", marginBottom: 6 }}>
                    {link.label} • {link.kind}
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      )}

      {selectedEdge && (
        <section style={sectionStyle}>
          <div style={subheadingStyle}>Selected Edge</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>
            {selectedEdge.kind.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
            {selectedFromNode?.label ?? selectedEdge.from} → {selectedToNode?.label ?? selectedEdge.to}
          </div>
          <div style={{ fontSize: 10, color: "#94a3b8" }}>
            {selectedEdge.explanation ?? "No explanation available."}
          </div>
          {selectedEdge.evidence && selectedEdge.evidence.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: "#60a5fa" }}>
              {selectedEdge.evidence.length} piece{selectedEdge.evidence.length !== 1 ? "s" : ""} of evidence
            </div>
          )}
        </section>
      )}
    </>
  );
}
