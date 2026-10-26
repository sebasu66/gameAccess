#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod automation;
mod access_activation;
mod parental_lock;
mod access_policy;
mod launch_intent;
mod catalog_cache;
mod source_index;
mod game_lessons;
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
mod plugin_install;
mod app_update;
mod download_queue;
mod game_controllers;
mod game_focus;
mod webview_rest;

use std::{env, sync::Mutex};

fn main() {
    launcher_runtime::configure_launcher_data();
    app_update::run_self_test_if_requested();
    let _plugin_guard = plugin_registry::plugin_shutdown_guard();
    let visual_debug_dir = visual_debug::visual_debug_session_dir();
    let automation_state = automation::AutomationState::from_process();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            use tauri::{Emitter,Manager};
            launch_intent::receive(&args);
            plugin_install::receive(&args);
            if let Some(window) = app.get_webview_window("main") { let _=window.unminimize(); let _=window.show(); let _=window.set_focus(); }
            // The page may be suspended while a game runs: wake it before asking it to launch.
            webview_rest::wake(app);
            let _=app.emit("gameaccess:launch-request",());
        }))
        // Releases from main update themselves: the app checks GitHub's latest.json and installs signed builds only.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        // Rests while minimized, or while a game runs and Game Access does not have the focus (webview_rest.rs).
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::Focused(focused) => webview_rest::reconcile(window, Some(*focused)),
            tauri::WindowEvent::Resized(_) => webview_rest::reconcile(window, None),
            _ => {}
        })
        .setup(|app| {
            let launch_args = env::args().collect::<Vec<_>>();
            launch_intent::receive(&launch_args);
            plugin_install::attach(app.handle().clone());
            plugin_install::register_protocol();
            plugin_install::receive(&launch_args);
            access_commands::start_access_watchdog(app.handle().clone());
            plugin_registry::start_registered_plugins();
            app_update::start_watchdog(app.handle().clone());
            Ok(())
        })
        .manage(automation_state)
        .manage(visual_debug::VisualDebugState {
            session_dir: Mutex::new(visual_debug_dir),
        })
        .invoke_handler(tauri::generate_handler![
            plugin_registry::get_registered_plugins,
            app_update::app_frontend_alive,
            game_controllers::game_controllers_connected,
            game_focus::game_focus_watch,
            download_queue::download_queue_request,
            access_commands::activation_installation_id,
            parental_lock::parental_state,
            parental_lock::parental_save,
            parental_lock::parental_check,
            access_commands::activation_check_access,
            access_commands::create_game_shortcut,
            launch_intent::take_launch_request,
            access_commands::activation_read_session,
            access_commands::activation_read_key,
            dev_activation::read_dev_activation_key,
            access_commands::activation_save_session,
            access_commands::activation_clear_session,
            catalog_cache::catalog_cache_sync,
            catalog_cache::catalog_prepare,
            catalog_cache::catalog_cache_read,
            catalog_cache::catalog_cache_read_names,
            catalog_cache::catalog_cache_upsert_game,
            catalog_cache::catalog_cache_read_detail,
            catalog_cache::catalog_cache_store_detail,
            catalog_cache::catalog_cache_query,
            catalog_cache::catalog_cache_get_facets,
            source_index::catalog_sources_apply,
            source_index::catalog_sources_remove_plugin,
            game_lessons::game_lessons_revision,
            game_lessons::game_lessons_apply,
            game_lessons::game_lessons_add_mine,
            game_lessons::game_lessons_query,
            automation::automation_config,
            automation::capture_automation_screenshot,
            automation::finish_automation,
            activity_log::narration_log_path,
            execution_profiles::save_execution_profile,
            execution_profiles::read_execution_profile,
            activity_log::read_activity_console,
            execution_profiles::query_cooptimus,
            execution_profiles::open_cooptimus_page,
            activity_log::append_narration_log,
            activity_log::append_narration_log_batch,
            steam_commands::steam_installed,
            steam_commands::runtime_prerequisites,
            steam_commands::open_steam_client,
            steam_commands::open_steam_install,
            steam_commands::open_steam_run,
            steam_commands::open_steam_store,
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
            digital_commands::freeze_progress,
            digital_commands::freeze_signal,
            digital_commands::query_digital_options
        ])
        .run(tauri::generate_context!())
        .expect("error while running gameAccess");
    // The Download Manager stops its workers without deleting anything; they resume when the app opens again.
    download_queue::shutdown();
    plugin_registry::stop_all_plugins();
}
