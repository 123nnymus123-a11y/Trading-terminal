import React, { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { tabByHotkeyDigit, TABS } from "../tabs";
import AppHeader from "./AppHeader";
import { TabsNav } from "./TabsNav";
import { useAppState } from "../store/appState";

function isEditableTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

export function ShellLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useAppState();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      if (isEditableTarget(e.target)) return;

      if (e.key >= "1" && e.key <= "7") {
        const tab = tabByHotkeyDigit(e.key);
        if (tab) {
          e.preventDefault();
          navigate(tab.path);
        }
        return;
      }

      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        console.log("[hotkey] Ctrl+K pressed (placeholder: command palette)");
        return;
      }
      if (k === "p") {
        e.preventDefault();
        console.log("[hotkey] Ctrl+P pressed (placeholder: symbol search)");
        return;
      }
      if (k === "s") {
        e.preventDefault();
        console.log("[hotkey] Ctrl+S pressed (placeholder: snapshot)");
        return;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  useEffect(() => {
    if (location.pathname === "/" || location.pathname === "") {
      navigate(TABS[0].path, { replace: true });
    }
  }, [location.pathname, navigate]);

  return (
    <div className={state.focusMode ? "appRoot focusMode" : "appRoot"}>
      <AppHeader />
      <TabsNav />
      <main className="appMain">
        <Outlet />
      </main>
    </div>
  );
}