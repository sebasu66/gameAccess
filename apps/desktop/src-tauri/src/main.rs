#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod automation;
mod access_activation;
mod access_policy;
mod launch_intent;
mod catalog_cache;
mod download_lifecycle;
mod game_uninstall;
mod steam_artwork;

mod activity_log;
mod visual_debug;
mod steam_commands;
mod download_events;
mod access_commands;
mod dev_activation;
mod launcher_runtime;
mod digital_commands;
mod execution_profiles;
mod plugin_registry;

use std::{env, sync::Mutex};

fn main() {
    let _plugin_guard = plugin_registry::plugin_shutdown_guard();
    let visual_debug_dir = visual_debug::visual_debug_session_dir();
    let automation_state = automation::AutomationState::from_process();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::{Emitter,Manager};
            launch_intent::receive(&args);
            if let Some(window) = app.get_webview_window("main") { let _=window.unminimize(); let _=window.show(); let _=window.set_focus(); }
            let _=app.emit("gameaccess:launch-request",());
        }))
        .setup(|app| {
            launch_intent::receive(&env::args().collect::<Vec<_>>());
            access_commands::start_access_watchdog(app.handle().clone());
            plugin_registry::start_registered_plugins();
            Ok(())
        })
        .manage(automation_state)
        .manage(visual_debug::VisualDebugState {
            session_dir: Mutex::new(visual_debug_dir),
        })
        .invoke_handler(tauri::generate_handler![
            plugin_registry::get_registered_plugins,
            access_commands::activation_installation_id,
            access_commands::activation_check_access,
            access_commands::create_game_shortcut,
            launch_intent::take_launch_request,
            access_commands::activation_read_session,
            access_commands::activation_read_key,
            dev_activation::read_dev_activation_key,
            access_commands::activation_save_session,
            access_commands::activation_clear_session,
            catalog_cache::catalog_cache_sync,
            catalog_cache::catalog_cache_read,
            catalog_cache::catalog_cache_read_names,
            catalog_cache::catalog_cache_upsert_game,
            catalog_cache::catalog_cache_read_detail,
            catalog_cache::catalog_cache_store_detail,
            catalog_cache::catalog_cache_query,
            catalog_cache::catalog_cache_set_temp_sources,
            catalog_cache::catalog_cache_get_facets,
            automation::automation_config,
            automation::capture_automation_screenshot,
            automation::finish_automation,
            activity_log::narration_log_path,
            execution_profiles::save_execution_profile,
            execution_profiles::read_execution_profile,
            activity_log::read_activity_console,
            execution_profiles::query_cooptimus,
            activity_log::append_narration_log,
            activity_log::append_narration_log_batch,
            steam_commands::steam_installed,
            steam_commands::runtime_prerequisites,
            steam_commands::open_steam_client,
            steam_commands::open_steam_install,
            steam_commands::open_steam_run,
            steam_commands::open_game_install_folder,
            game_uninstall::uninstall_game,
            // Freeze/thaw commands are intentionally not registered while the feature is disabled.
            steam_commands::steam_download_status,
            steam_commands::steam_download_metrics,
            steam_commands::installed_app_ids,
            steam_commands::steam_store_metadata,
            steam_commands::steam_metadata_worker_start,
            steam_commands::steam_metadata_worker_poll,
            steam_commands::steam_metadata_catalog_cache,
            steam_artwork::steam_library_cover,
            steam_commands::machine_profile,
            download_events::register_download_job,
            download_events::record_download_completion,
            download_events::pending_download_completions,
            download_events::acknowledge_download_completion,
            download_events::cancel_download_lifecycle,
            visual_debug::visual_debug_config,
            visual_debug::capture_visual_debug,
            visual_debug::finish_visual_debug,
            visual_debug::set_visual_debug_viewport,
            digital_commands::run_digital_process,
            digital_commands::start_digital_download,
            digital_commands::cancel_digital_download,
            digital_commands::control_digital_download,
            digital_commands::digital_download_status,
            digital_commands::query_digital_options
        ])
        .run(tauri::generate_context!())
        .expect("error while running gameAccess");
    // Workers are independent processes; explicitly pause owned transfers on app exit.
    if let Ok(pids)=digital_commands::digital_pids().lock() {
        for id in pids.keys() { let _=digital_commands::write_digital_control(*id,"pause"); }
    }
    plugin_registry::stop_all_plugins();
}
