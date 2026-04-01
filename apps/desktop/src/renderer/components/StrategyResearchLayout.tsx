/**
 * Strategy Research Tab Layout Structure
 * Seven-panel workspace layout:
 * - Left rail (persistent navigation)
 * - Center workspace (primary content)
 * - Right inspector (context panel)
 * - Bottom drawer (CLI, logs, queue)
 */

import React, { ReactNode, useState } from "react";

export type RailNavItem = {
  id: string;
  icon: string;
  label: string;
  badge?: string;
};

export type StrategyResearchLayoutProps = {
  railItems: RailNavItem[];
  activeRailItem: string;
  onRailItemClick: (id: string) => void;
  centerContent: ReactNode;
  rightInspector: ReactNode;
  bottomDrawerContent?: ReactNode;
  showBottomDrawer?: boolean;
  onToggleBottomDrawer?: () => void;
};

const RAIL_WIDTH = 60;
const RIGHT_INSPECTOR_WIDTH = 320;
const BOTTOM_DRAWER_HEIGHT = 200;

export function StrategyResearchLayout({
  railItems,
  activeRailItem,
  onRailItemClick,
  centerContent,
  rightInspector,
  bottomDrawerContent,
  showBottomDrawer = false,
  onToggleBottomDrawer,
}: StrategyResearchLayoutProps) {
  const [drawerHeight, setDrawerHeight] = useState(
    showBottomDrawer ? BOTTOM_DRAWER_HEIGHT : 0,
  );
  const [isDraggingDrawer, setIsDraggingDrawer] = useState(false);

  const handleDrawerDragStart = (e: React.MouseEvent) => {
    setIsDraggingDrawer(true);
    e.preventDefault();
  };

  React.useEffect(() => {
    if (!isDraggingDrawer) return;

    const handleMouseMove = (e: MouseEvent) => {
      const viewport = document.documentElement.clientHeight;
      const newHeight = Math.max(
        50,
        Math.min(500, viewport - e.clientY),
      );
      setDrawerHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsDraggingDrawer(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDraggingDrawer]);

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        background: "#1a1a1a",
        color: "#ffffff",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Left Rail Navigation */}
      <div
        style={{
          width: RAIL_WIDTH,
          background: "#0f0f0f",
          borderRight: "1px solid rgba(255,255,255,0.1)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: "12px 0",
          overflowY: "auto",
        }}
      >
        {railItems.map((item) => (
          <button
            key={item.id}
            onClick={() => onRailItemClick(item.id)}
            title={item.label}
            style={{
              width: "100%",
              padding: "12px",
              background:
                activeRailItem === item.id
                  ? "rgba(110, 168, 254, 0.15)"
                  : "transparent",
              border:
                activeRailItem === item.id
                  ? "1px solid rgba(110, 168, 254, 0.3)"
                  : "none",
              borderRadius: 6,
              color: activeRailItem === item.id ? "#6ea8fe" : "#888",
              fontSize: 18,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              transition: "all 0.2s ease",
              margin: "0 6px",
            }}
          >
            {item.icon}
            {item.badge ? (
              <div
                style={{
                  position: "absolute",
                  top: -2,
                  right: -2,
                  background: "#ef4444",
                  color: "white",
                  borderRadius: "50%",
                  width: 18,
                  height: 18,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  fontWeight: "bold",
                }}
              >
                {item.badge}
              </div>
            ) : null}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Center Workspace + Right Inspector */}
        <div
          style={{
            flex: 1,
            display: "flex",
            gap: 0,
            overflow: "hidden",
          }}
        >
          {/* Center Workspace */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              borderRight: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {centerContent}
          </div>

          {/* Right Inspector */}
          <div
            style={{
              width: RIGHT_INSPECTOR_WIDTH,
              background: "rgba(0,0,0,0.3)",
              borderLeft: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {rightInspector}
          </div>
        </div>

        {/* Bottom Drawer Divider */}
        {showBottomDrawer ? (
          <div
            onMouseDown={handleDrawerDragStart}
            style={{
              height: 4,
              background: isDraggingDrawer
                ? "#6ea8fe"
                : "rgba(255,255,255,0.1)",
              cursor: "row-resize",
              transition: isDraggingDrawer ? "none" : "background 0.2s ease",
            }}
          />
        ) : null}

        {/* Bottom Drawer */}
        {showBottomDrawer && (
          <div
            style={{
              height: drawerHeight,
              background: "rgba(0,0,0,0.5)",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {bottomDrawerContent}
          </div>
        )}

        {/* Bottom Drawer Toggle (when hidden) */}
        {!showBottomDrawer && onToggleBottomDrawer ? (
          <button
            onClick={onToggleBottomDrawer}
            style={{
              height: 24,
              background: "rgba(255,255,255,0.05)",
              border: "none",
              borderTop: "1px solid rgba(255,255,255,0.1)",
              color: "#888",
              fontSize: 11,
              cursor: "pointer",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            ▼ Show CLI & Logs
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function CenterWorkspacePanel({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        padding: 16,
        gap: 16,
      }}
    >
      {children}
    </div>
  );
}

export function RightInspectorPanel({
  title,
  children,
}: {
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {title ? (
        <div
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid rgba(255,255,255,0.1)",
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "#aaa",
          }}
        >
          {title}
        </div>
      ) : null}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "16px",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function BottomDrawerPanel({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        height: "100%",
      }}
    >
      {children}
    </div>
  );
}
