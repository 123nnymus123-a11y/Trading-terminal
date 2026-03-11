#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

#[tauri::command]
fn show_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
  let window = app
    .get_window(&label)
    .ok_or_else(|| format!("window_not_found: {}", label))?;
  window.show().map_err(|e| e.to_string())?;
  window.set_focus().map_err(|e| e.to_string())?;
  Ok(())
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
  let window = app
    .get_window(&label)
    .ok_or_else(|| format!("window_not_found: {}", label))?;
  window.hide().map_err(|e| e.to_string())?;
  Ok(())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![show_window, hide_window])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
