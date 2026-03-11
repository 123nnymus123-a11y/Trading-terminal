import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startStreamController } from "./store/streamController";
import { installCockpitBackendBridge } from "./lib/cockpitBackendBridge";

console.log("[renderer]");
console.log("[renderer] ===== RENDERER MAIN.TSX LOADING =====");
console.log("[renderer]");

// Global error handlers
window.addEventListener("error", (event) => {
  console.error("[renderer] ✗ UNHANDLED ERROR:", event.error, event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("[renderer] ✗ UNHANDLED PROMISE REJECTION:", event.reason);
});

// Ensure we subscribe to streaming before UI renders
const bootstrap = async () => {
  console.log("[renderer] [1/5] installing cockpit backend bridge...");
  try {
    await installCockpitBackendBridge();
    console.log("[renderer] [1/5] ✓ cockpit backend bridge installed");
  } catch (e) {
    console.warn("[renderer] [1/5] bridge install failed, continuing with existing bridge", e);
  }

  console.log("[renderer] [2/5] starting stream controller...");
  try {
    startStreamController();
    console.log("[renderer] [2/5] ✓ stream controller started");
  } catch (e) {
    // Non-fatal: stream will reconnect once auth is available. Never block React mount.
    console.warn("[renderer] [2/5] stream controller start failed (will retry after login):", e);
  }

  console.log("[renderer] [3/5] looking for root element...");
  const root = document.getElementById("root");
  if (!root) {
    console.error("[renderer] [3/5] ✗ FATAL: root element not found");
    console.error("[renderer] DOM body:", document.body.innerHTML);
    throw new Error("root element not found");
  }
  console.log("[renderer] [3/5] ✓ root element found");

  console.log("[renderer] [4/5] creating React root...");
  const reactRoot = ReactDOM.createRoot(root);

  console.log("[renderer] [5/5] rendering App component...");
  try {
    reactRoot.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log("[renderer] [5/5] ✓ React rendered");
    console.log("[renderer]");
    console.log("[renderer] ===== ✓ RENDERER READY =====");
    console.log("[renderer]");
  } catch (e) {
    console.error("[renderer] [5/5] ✗ FATAL: error rendering React:", e);
    throw e;
  }
};

void bootstrap();
