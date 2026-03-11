import { BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";

export async function captureScreenshot(window: BrowserWindow, screenshotDir: string): Promise<string> {
  // Ensure screenshot directory exists
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const timestamp = Date.now();
  const filename = `screenshot_${timestamp}.png`;
  const filePath = path.join(screenshotDir, filename);

  try {
    // Capture the window
    const image = await window.webContents.capturePage();
    fs.writeFileSync(filePath, image.toPNG());
    console.log(`[Screenshot] Captured: ${filePath}`);
    return filePath;
  } catch (err) {
    console.error(`[Screenshot] Failed to capture: ${err}`);
    throw err;
  }
}

export function getScreenshotDir(): string {
  const userData = app.getPath("userData");
  const screenshotDir = path.join(userData, "screenshots");
  return screenshotDir;
}
