type ViewParams = Record<string, string | number | boolean | undefined>;

function hasTauri() {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

export function buildViewUrl(view: string, params?: ViewParams) {
  const query = new URLSearchParams();
  query.set("view", view);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      query.set(key, String(value));
    });
  }
  return `index.html?${query.toString()}`;
}

export async function showWindow(label: string, url?: string) {
  if (!hasTauri()) return false;

  const { WebviewWindow } = await import("@tauri-apps/api/window");
  const win = WebviewWindow.getByLabel(label);
  if (!win) return false;

  void url;

  await win.show();
  await win.setFocus();
  return true;
}
