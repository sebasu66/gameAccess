use std::{fs, path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use tauri::Manager;
use url::Url;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const MIN_VALID_VIDEO_BYTES: u64 = 16 * 1024;

fn is_allowed_video_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    host == "steamstatic.com"
        || host.ends_with(".steamstatic.com")
        || host == "akamaihd.net"
        || host.ends_with(".akamaihd.net")
}

fn video_extension(value: &str) -> &'static str {
    Url::parse(value)
        .ok()
        .map(|url| url.path().to_ascii_lowercase())
        .filter(|path| path.ends_with(".webm"))
        .map(|_| "webm")
        .unwrap_or("mp4")
}

fn cached_video_path(app: &tauri::AppHandle, app_id: u32, url: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|err| format!("Could not locate GameAccess local data: {err}"))?
        .join("media")
        .join("steam");
    fs::create_dir_all(&root)
        .map_err(|err| format!("Could not create the Steam media cache: {err}"))?;
    Ok(root.join(format!("{app_id}.{}", video_extension(url))))
}

fn cache_video_blocking(app: &tauri::AppHandle, app_id: u32, url: &str) -> Result<String, String> {
    if app_id == 0 {
        return Err("Steam AppID is required for media caching".into());
    }
    if !is_allowed_video_url(url) {
        return Err("Steam trailer URL is not from an allowed Steam CDN".into());
    }

    let target = cached_video_path(app, app_id, url)?;
    if target.metadata().map(|meta| meta.len() >= MIN_VALID_VIDEO_BYTES).unwrap_or(false) {
        return Ok(target.to_string_lossy().to_string());
    }

    let temporary = target.with_extension(format!("{}.download", video_extension(url)));
    let _ = fs::remove_file(&temporary);

    #[cfg(target_os = "windows")]
    {
        let script = r#"$ProgressPreference='SilentlyContinue'; $u=$args[0]; $o=$args[1]; Invoke-WebRequest -Uri $u -OutFile $o -UseBasicParsing -TimeoutSec 180; if((Get-Item -LiteralPath $o).Length -lt 16384){ throw 'Downloaded Steam trailer is unexpectedly small' }"#;
        let output = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
                url,
                temporary.to_string_lossy().as_ref(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|err| format!("Could not download Steam trailer: {err}"))?;
        if !output.status.success() {
            let _ = fs::remove_file(&temporary);
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Steam trailer download failed".into()
            } else {
                stderr
            });
        }
    }

    #[cfg(not(target_os = "windows"))]
    return Err("Persistent Steam trailer caching is currently implemented for Windows".into());

    let size = temporary
        .metadata()
        .map_err(|err| format!("Could not verify cached Steam trailer: {err}"))?
        .len();
    if size < MIN_VALID_VIDEO_BYTES {
        let _ = fs::remove_file(&temporary);
        return Err("Cached Steam trailer failed validation".into());
    }

    let _ = fs::remove_file(&target);
    fs::rename(&temporary, &target)
        .map_err(|err| format!("Could not finalize cached Steam trailer: {err}"))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cache_steam_video(
    app: tauri::AppHandle,
    app_id: u32,
    url: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || cache_video_blocking(&app, app_id, &url))
        .await
        .map_err(|err| format!("Steam trailer cache task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::{is_allowed_video_url, video_extension};

    #[test]
    fn accepts_https_steam_video_cdns_only() {
        assert!(is_allowed_video_url("https://video.akamai.steamstatic.com/store_trailers/1/movie_max.mp4"));
        assert!(is_allowed_video_url("https://cdn.cloudflare.steamstatic.com/store_trailers/1/movie_max.webm"));
        assert!(!is_allowed_video_url("http://video.akamai.steamstatic.com/store_trailers/1/movie.mp4"));
        assert!(!is_allowed_video_url("https://example.com/movie.mp4"));
    }

    #[test]
    fn keeps_the_cached_container_extension_predictable() {
        assert_eq!(video_extension("https://video.akamai.steamstatic.com/a/movie.webm?x=1"), "webm");
        assert_eq!(video_extension("https://video.akamai.steamstatic.com/a/movie_max.mp4?t=2"), "mp4");
    }
}
