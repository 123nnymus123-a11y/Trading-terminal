import React from "react";
import { NavLink } from "react-router-dom";
import { TABS } from "../tabs";

export function TabsNav() {
  return (
    <nav className="tabsNav" role="tablist" aria-label="Primary Tabs">
      {TABS.map((t) => (
        <NavLink
          key={t.id}
          to={t.path}
          className={({ isActive }) => (isActive ? "tabLink active" : "tabLink")}
        >
          <span className="tabLabel">{t.label}</span>
          <span className="tabHotkey">
            <kbd>Ctrl</kbd>+<kbd>{t.hotkeyDigit}</kbd>
          </span>
        </NavLink>
      ))}
    </nav>
  );
}