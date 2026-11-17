//! Download events. Extracted without changing IPC contracts.
use gameaccess_desktop::native_core;
use crate::download_lifecycle;

#[tauri::command]
pub(crate) async fn register_download_job(
    app_id: u32,
    job_id: String,
) -> Result<download_lifecycle::DownloadJobRecord, String> {
    tauri::async_runtime::spawn_blocking(move || {
        download_lifecycle::register_download_job(app_id, job_id)
    })
    .await
    .map_err(|err| format!("Download lifecycle registration failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn record_download_completion(
    app_id: u32,
) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        download_lifecycle::complete_latest_for_app(app_id)
    })
    .await
    .map_err(|err| format!("Download completion persistence failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn acknowledge_download_completion(
    job_id: String,
) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::acknowledge(&job_id))
        .await
        .map_err(|err| format!("Download completion acknowledgement failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn cancel_download_lifecycle(
    app_id: u32,
) -> Result<Option<download_lifecycle::DownloadJobRecord>, String> {
    tauri::async_runtime::spawn_blocking(move || download_lifecycle::cancel_latest_for_app(app_id))
        .await
        .map_err(|err| format!("Download lifecycle cancellation failed: {err}"))?
}

#[tauri::command]
pub(crate) async fn pending_download_completions() -> Result<Vec<download_lifecycle::DownloadJobRecord>, String>
{
    tauri::async_runtime::spawn_blocking(|| {
        download_lifecycle::pending_with(|app_id| {
            let steam = native_core::steam_download_status(app_id);
            if steam.installed || steam.state == "installed" {
                return true;
            }
            false
        })
    })
    .await
    .map_err(|err| format!("Pending download completion scan failed: {err}"))?
}
