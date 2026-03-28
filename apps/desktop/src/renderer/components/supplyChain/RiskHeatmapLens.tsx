import React, { useMemo } from 'react';
import type { RiskLensCell, SupplyChainRiskType } from '@tc/shared/supplyChain';
import {
  CriticalityLevels,
  Transitions,
} from './tokens';

interface Props {
  riskLens: RiskLensCell[];
  onSelectCell: (affectedNodes: string[]) => void;
}

const RISK_TYPES: SupplyChainRiskType[] = [
  'geopolitical',
  'regulatory',
  'capacity',
  'single-supplier',
  'logistics',
  'financial',
  'cyber',
  'other',
];

const getSeverityColor = (severity: string): string => {
  switch (severity) {
    case 'critical':
      return CriticalityLevels.critical.color;
    case 'high':
      return CriticalityLevels.high.color;
    case 'medium':
      return CriticalityLevels.medium.color;
    case 'low':
    default:
      return CriticalityLevels.low.color;
  }
};

const getSeverityGradient = (severity: string): string => {
  const color = getSeverityColor(severity);
  return `linear-gradient(135deg, ${color}22 0%, ${color}44 100%)`;
};

export default function RiskHeatmapLens({ riskLens, onSelectCell }: Props) {
  const categories = useMemo(
    () => Array.from(new Set(riskLens.map((cell) => cell.category))),
    [riskLens]
  );

  const lookup = useMemo(() => {
    const map = new Map<string, RiskLensCell>();
    for (const cell of riskLens) {
      map.set(`${cell.category}:${cell.riskType}`, cell);
    }
    return map;
  }, [riskLens]);

  if (riskLens.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: '#94a3b8',
        }}
      >
        No risk data available yet
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        padding: 24,
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Risk Heatmap Overlay</h3>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          Click a cell to highlight impacted nodes
        </span>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headerCellStyle}>Category</th>
              {RISK_TYPES.map((type) => (
                <th key={type} style={headerCellStyle}>
                  {type}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category}>
                <td style={{ ...bodyCellStyle, fontWeight: 600 }}>{category}</td>
                {RISK_TYPES.map((type) => {
                  const cell = lookup.get(`${category}:${type}`);
                  if (!cell) {
                    return <td key={type} style={bodyCellStyle}>-</td>;
                  }

                  const severityColor = getSeverityColor(cell.severity);
                  const gradient = getSeverityGradient(cell.severity);

                  return (
                    <td
                      key={type}
                      style={{
                        ...bodyCellStyle,
                        cursor: 'pointer',
                        background: gradient,
                        color: severityColor,
                        fontSize: 12,
                        fontWeight: 600,
                        borderLeft: `3px solid ${severityColor}`,
                        transition: Transitions.fast,
                        position: 'relative',
                        overflow: 'hidden',
                      }}
                      onClick={() => onSelectCell(cell.affectedNodes)}
                      onMouseEnter={(e) => {
                        (e.target as HTMLTableCellElement).style.transform = 'scale(1.05)';
                        (e.target as HTMLTableCellElement).style.boxShadow = `0 0 16px ${severityColor}66`;
                      }}
                      onMouseLeave={(e) => {
                        (e.target as HTMLTableCellElement).style.transform = 'scale(1)';
                        (e.target as HTMLTableCellElement).style.boxShadow = 'none';
                      }}
                      title={`${cell.severity.toUpperCase()} - ${cell.affectedNodes.length} nodes affected`}
                    >
                      <span style={{ position: 'relative', zIndex: 1 }}>
                        {cell.severity.toUpperCase()} ({cell.affectedNodes.length})
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          padding: 12,
          borderRadius: 8,
          background: 'rgba(15, 23, 42, 0.6)',
          borderTop: '1px solid rgba(148, 163, 184, 0.15)',
          marginTop: 'auto',
          fontSize: 12,
        }}
      >
        {Object.entries(CriticalityLevels).map(([key, { color }]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: color,
              }}
            />
            <span style={{ color: '#94a3b8', textTransform: 'capitalize' }}>{key}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const headerCellStyle: React.CSSProperties = {
  padding: '8px 12px',
  textTransform: 'uppercase',
  fontSize: 11,
  color: '#94a3b8',
  borderBottom: '1px solid rgba(148,163,184,0.2)',
  position: 'sticky',
  top: 0,
  background: 'rgba(10,14,26,0.95)',
};

const bodyCellStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid rgba(148,163,184,0.08)',
  textAlign: 'center',
};
