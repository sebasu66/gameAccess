from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "apps" / "desktop" / "src-tauri" / "src" / "provider_download.rs"

old = '''fn start_provider_download_blocking(app_id: u32, requested_job_id: Option<String>) -> Result<ProviderDownloadStatus, String> {
    if app_id == 0 { return Err("Invalid Steam AppID".into()); }
    if let Some(status) = provider_download_status(app_id)? {
        if is_active_state(&status.state) { return Ok(status); }
        if status.installed || matches!(status.state.as_str(), "installed" | "prepared") { return Ok(status); }
    }

    let launcher = launcher_dir()?;
    clear_provider_download_status(&launcher, app_id)?;
'''

new = '''fn start_provider_download_blocking(app_id: u32, requested_job_id: Option<String>) -> Result<ProviderDownloadStatus, String> {
    if app_id == 0 { return Err("Invalid Steam AppID".into()); }
    let launcher = launcher_dir()?;
    if let Some(mut status) = provider_download_status(app_id)? {
        if is_active_state(&status.state) {
            #[cfg(target_os = "windows")]
            let worker_valid = match (status.worker_pid, status.job_id.as_deref()) {
                (Some(pid), Some(job_id)) => verify_worker_process(pid, app_id, job_id, &manager_script(&launcher))?,
                _ => false,
            };
            #[cfg(not(target_os = "windows"))]
            let worker_valid = status.worker_pid.is_some() && status.job_id.as_deref().is_some();

            if worker_valid { return Ok(status); }

            status.state = "unknown".into();
            status.error = Some("Previous GameAccess download worker stopped unexpectedly. Starting a new download.".into());
            status.worker_pid = None;
            write_provider_download_status(&launcher, &status)?;
        }
        if status.installed || matches!(status.state.as_str(), "installed" | "prepared") { return Ok(status); }
    }

    clear_provider_download_status(&launcher, app_id)?;
'''

text = TARGET.read_text(encoding="utf-8")
if new in text:
    print("ALREADY_FIXED")
elif old in text:
    TARGET.write_text(text.replace(old, new, 1), encoding="utf-8")
    print("PATCHED")
else:
    raise SystemExit("Expected provider download start block was not found")

subprocess.run(["git", "diff", "--check", "--", str(TARGET.relative_to(ROOT))], cwd=ROOT, check=True)
