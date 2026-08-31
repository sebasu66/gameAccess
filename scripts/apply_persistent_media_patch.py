from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected snippet not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


# Native persistent media cache module.
steam_media = r'''use std::{fs, path::PathBuf, process::Command};

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
'''
(ROOT / "apps/desktop/src-tauri/src/steam_media.rs").write_text(steam_media, encoding="utf-8")

replace_once(
    ROOT / "apps/desktop/src-tauri/Cargo.toml",
    'chrono = "0.4"\n',
    'chrono = "0.4"\nurl = "2"\n',
)

replace_once(
    ROOT / "apps/desktop/src-tauri/src/main.rs",
    '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nuse serde::Serialize;',
    '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nmod steam_media;\n\nuse steam_media::cache_steam_video;\nuse serde::Serialize;',
)
replace_once(
    ROOT / "apps/desktop/src-tauri/src/main.rs",
    '            steam_download_status,\n            steam_store_metadata,',
    '            steam_download_status,\n            steam_store_metadata,\n            cache_steam_video,',
)

# Asset protocol is scoped only to this app's local-data tree.
conf = ROOT / "apps/desktop/src-tauri/tauri.conf.json"
replace_once(
    conf,
    '    "security": {\n      "csp": "default-src \'self\' ipc: http://ipc.localhost; img-src \'self\' asset: https://*.steamstatic.com https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://store.akamai.steamstatic.com data: blob:; media-src \'self\' https://*.steamstatic.com https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://store.akamai.steamstatic.com blob:; connect-src \'self\' ipc: http://ipc.localhost http://127.0.0.1:8000 http://localhost:8000; style-src \'self\' \'unsafe-inline\'; script-src \'self\'"\n    }',
    '    "security": {\n      "assetProtocol": {\n        "enable": true,\n        "scope": ["$APPLOCALDATA/**"]\n      },\n      "csp": "default-src \'self\' ipc: http://ipc.localhost; img-src \'self\' asset: http://asset.localhost https://*.steamstatic.com https://cdn.akamai.steamstatic.com https://shared.akamai.steamstatic.com https://store.akamai.steamstatic.com data: blob:; media-src \'self\' asset: http://asset.localhost blob:; connect-src \'self\' ipc: http://ipc.localhost http://127.0.0.1:8000 http://localhost:8000; style-src \'self\' \'unsafe-inline\'; script-src \'self\'"\n    }',
)

native = ROOT / "apps/desktop/src/native.ts"
replace_once(native, 'import { invoke } from "@tauri-apps/api/core";', 'import { convertFileSrc, invoke } from "@tauri-apps/api/core";')
replace_once(
    native,
    'export async function getSteamStoreMetadata(appId: number): Promise<Record<string, unknown> | null> {\n  if (!appId || !hasTauriRuntime()) return null;\n  return invoke<Record<string, unknown>>("steam_store_metadata", { appId });\n}',
    'export async function getSteamStoreMetadata(appId: number): Promise<Record<string, unknown> | null> {\n  if (!appId || !hasTauriRuntime()) return null;\n  return invoke<Record<string, unknown>>("steam_store_metadata", { appId });\n}\n\nexport async function cacheSteamVideo(appId: number, url: string): Promise<string | null> {\n  if (!appId || !url || !hasTauriRuntime()) return null;\n  const filePath = await invoke<string>("cache_steam_video", { appId, url });\n  return convertFileSrc(filePath);\n}',
)

room = ROOT / "apps/desktop/src/LibraryRoom.tsx"
replace_once(room, 'import { loadDetails } from "./api";\n', 'import { loadDetails } from "./api";\nimport { cacheSteamVideo } from "./native";\n')
replace_once(
    room,
    '  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);\n  const [videoMuted, setVideoMuted] = useState(true);',
    '  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);\n  const [cachedVideo, setCachedVideo] = useState<{ appId: number; remote: string; local: string } | null>(null);\n  const [videoCaching, setVideoCaching] = useState(false);\n  const [videoMuted, setVideoMuted] = useState(true);',
)
replace_once(
    room,
    '  const videoSrc = selectedVideo(movie);\n  const artwork = useCrossfadeArtwork(hero);',
    '  const remoteVideoSrc = selectedVideo(movie);\n  const videoSrc = cachedVideo?.appId === selectedAppId && cachedVideo.remote === remoteVideoSrc ? cachedVideo.local : undefined;\n  const artwork = useCrossfadeArtwork(hero);',
)
replace_once(
    room,
    '  useEffect(() => {\n    if (selectedGameId == null) return;\n    let cancelled = false;\n    setDetails(null);\n    setLoadingDetails(true);\n    loadDetails(selectedGameId)\n      .then((value) => { if (!cancelled) setDetails(value); })\n      .catch(() => { if (!cancelled) setDetails(null); })\n      .finally(() => { if (!cancelled) setLoadingDetails(false); });\n    return () => { cancelled = true; };\n  }, [selectedGameId]);',
    '  useEffect(() => {\n    if (selectedGameId == null) return;\n    let cancelled = false;\n    setDetails(null);\n    setLoadingDetails(true);\n    loadDetails(selectedGameId)\n      .then((value) => { if (!cancelled) setDetails(value); })\n      .catch(() => { if (!cancelled) setDetails(null); })\n      .finally(() => { if (!cancelled) setLoadingDetails(false); });\n    return () => { cancelled = true; };\n  }, [selectedGameId]);\n\n  useEffect(() => {\n    setReadyVideoSrc(null);\n    if (!selectedAppId || !remoteVideoSrc) {\n      setVideoCaching(false);\n      return;\n    }\n    let cancelled = false;\n    setVideoCaching(true);\n    cacheSteamVideo(selectedAppId, remoteVideoSrc)\n      .then((local) => {\n        if (!cancelled && local) setCachedVideo({ appId: selectedAppId, remote: remoteVideoSrc, local });\n      })\n      .catch(() => undefined)\n      .finally(() => { if (!cancelled) setVideoCaching(false); });\n    return () => { cancelled = true; };\n  }, [selectedAppId, remoteVideoSrc]);',
)
replace_once(
    room,
    '            loadingDetails={loadingDetails}\n',
    '            loadingDetails={loadingDetails || videoCaching}\n',
)

css = ROOT / "apps/desktop/src/library-room.css"
replace_once(
    css,
    '  min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(auto-fill, minmax(132px,1fr));\n',
    '  min-height: 0; overflow-y: auto; overflow-x: hidden; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));\n',
)
replace_once(
    css,
    '@media (max-width: 1050px) { .library-room { grid-template-columns: minmax(330px,38vw) minmax(0,1fr); gap: 16px; padding-inline: 16px; } .library-room-feature-copy { inset-inline: 24px; } .library-room-grid { grid-template-columns: repeat(auto-fill,minmax(118px,1fr)); } }',
    '@media (max-width: 1050px) { .library-room { grid-template-columns: minmax(330px,38vw) minmax(0,1fr); gap: 16px; padding-inline: 16px; } .library-room-feature-copy { inset-inline: 24px; } .library-room-grid { grid-template-columns: repeat(3,minmax(0,1fr)); } }',
)
replace_once(
    css,
    '@media (max-width: 760px) { .library-room { height: auto; min-height: 100svh; grid-template-columns: 1fr; overflow-y: auto; } .library-room-feature { min-height: 52vh; } .library-room-catalog { min-height: 58vh; } .library-room-grid { overflow: visible; } .library-room-hint { position: fixed; left: 12px; right: 12px; justify-content: center; padding: 8px; background: rgba(3,5,8,.78); backdrop-filter: blur(10px); } }',
    '@media (max-width: 760px) { .library-room { height: auto; min-height: 100svh; grid-template-columns: 1fr; overflow-y: auto; } .library-room-feature { min-height: 52vh; } .library-room-catalog { min-height: 58vh; } .library-room-grid { grid-template-columns: repeat(2,minmax(0,1fr)); overflow: visible; } .library-room-hint { position: fixed; left: 12px; right: 12px; justify-content: center; padding: 8px; background: rgba(3,5,8,.78); backdrop-filter: blur(10px); } }',
)

print("persistent media cache and grid scaling patch applied")
