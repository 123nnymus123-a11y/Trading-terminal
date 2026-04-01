export type TabId =
  | "panorama"
  | "microscape"
  | "structure"
  | "flow"
  | "execute"
  | "journal"
  | "settingsLogs";

export type LayoutPreset = "Morning Open" | "Midday Scan" | "Closing Focus";

export type MarketStatus = "OPEN" | "CLOSED" | "PRE" | "POST" | "UNKNOWN";

export const TABS: Array<{
  id: TabId;
  label: string;
  path: string;
  hotkeyDigit: "1" | "2" | "3" | "4" | "5" | "6" | "7";
}> = [
  { id: "panorama", label: "PANORAMA", path: "/panorama", hotkeyDigit: "1" },
  { id: "microscape", label: "MICROSCAPE", path: "/microscape", hotkeyDigit: "2" },
  { id: "structure", label: "STRUCTURE", path: "/structure", hotkeyDigit: "3" },
  { id: "flow", label: "FLOW", path: "/flow", hotkeyDigit: "4" },
  { id: "execute", label: "EXECUTE", path: "/execute", hotkeyDigit: "5" },
  { id: "journal", label: "JOURNAL", path: "/journal", hotkeyDigit: "6" },
  { id: "settingsLogs", label: "SETTINGS & LOGS", path: "/settings-logs", hotkeyDigit: "7" }
];

export function tabByHotkeyDigit(d: string) {
  return TABS.find((t) => t.hotkeyDigit === d);
}