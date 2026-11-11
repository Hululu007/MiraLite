mod cat;
mod stream_proxy;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(cat::CatState::default())
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      stream_proxy::spawn();
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      cat::cat_start,
      cat::cat_proxy,
      cat::cat_status,
      cat::cat_stop,
      cat::cat_open_config
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
