mod commands;
mod config;
mod error;
mod game;
mod health;
mod install;
mod localmod;
mod logs;
mod migrate;
mod models;
mod paths;
mod profiles;
mod resolver;
mod settings;
mod share;
mod sync;
mod thunderstore;
mod util;

use commands::AppCtx;
use std::path::PathBuf;
use std::sync::{Mutex, RwLock};
use std::time::Duration;
use tauri::Manager;

/// Portable mode: a file or folder named `portable` next to the executable moves all data to `<exe dir>/data`.
fn portable_root() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    dir.join("portable").exists().then(|| dir.join("data"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Remember window size, position and maximized state across restarts.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let portable = portable_root();
            let root = match &portable {
                Some(p) => p.clone(),
                None => app.path().app_data_dir()?,
            };
            let paths = paths::Paths::new(root);
            paths.ensure()?;
            let client = thunderstore::http_client(Duration::from_secs(15), Duration::from_secs(60))?;
            app.manage(AppCtx {
                settings: RwLock::new(settings::load(&paths)),
                detected: RwLock::new(game::detect()),
                index: thunderstore::IndexStore::new(),
                sync: sync::SyncHandle::default(),
                client,
                log_tail: Mutex::new(None),
                portable: portable.is_some(),
                paths,
            });
            tauri::async_runtime::spawn(commands::index_worker(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_index,
            commands::refresh_index,
            commands::get_package,
            commands::create_profile,
            commands::delete_profile,
            commands::activate_profile,
            commands::rename_profile,
            commands::clone_profile,
            commands::set_mods,
            commands::set_mod_enabled,
            commands::repair_profile,
            commands::add_local_mods,
            commands::import_profile_code,
            commands::import_profile_file,
            commands::list_foreign_profiles,
            commands::import_foreign_profile,
            commands::export_profile_code,
            commands::export_profile_file,
            commands::launch_game,
            commands::get_settings,
            commands::save_settings,
            commands::detect_game,
            commands::clear_download_cache,
            commands::open_folder,
            commands::list_config_files,
            commands::get_config_file,
            commands::save_config_file,
            commands::start_log_tail,
            commands::stop_log_tail,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
