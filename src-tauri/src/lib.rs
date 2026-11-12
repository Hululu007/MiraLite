mod cat;
mod embed;
mod stream_proxy;
mod sys;
mod tmdb;

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
      // 先收掉上一次退出/崩溃遗留的 CAT node 孤儿进程，再绑定流代理，
      // 否则孤儿若误占 9989 会和本地流代理抢端口。
      cat::kill_stale_engine(app.handle());
      stream_proxy::spawn();
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      cat::cat_start,
      cat::cat_proxy,
      cat::cat_status,
      cat::cat_stop,
      cat::cat_open_config,
      cat::cat_active_url,
      cat::cat_probe,
      tmdb::tmdb_get_config,
      tmdb::tmdb_set_config,
      tmdb::tmdb_test,
      tmdb::tmdb_rankings,
      sys::open_url,
      sys::has_app,
      embed::embed_open,
      embed::embed_set_bounds,
      embed::embed_close,
      embed::embed_eval,
      embed::embed_exists
    ])
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
