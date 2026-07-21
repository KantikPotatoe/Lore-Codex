#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // dialog + fs back the frontend's platform seam (src/platform.ts):
    // native Save-As replaces <a download>, which wry does not handle.
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|app| {
      // Desktop-only: backs checkForUpdate/download/install in the frontend's
      // platform seam (src/platform.ts). The HTTP fetch happens here in Rust,
      // not the webview, so the app's CSP stays closed.
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
