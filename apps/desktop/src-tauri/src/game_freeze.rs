use gameaccess_desktop::native_core::{self, SteamDownloadStatus};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const FREEZE_SCHEMA_VERSION: u32 = 1;
const ZSTD_LEVEL: i32 = 6;

#[derive(Clone, Debug, Serialize)]
pub struct GameStorageState {
    pub app_id: u32,
    pub state: String,
    pub original_size_bytes: Option<u64>,
    pub stored_size_bytes: Option<u64>,
    pub archive_path: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct FreezeManifest {
    schema_version: u32,
    app_id: u32,
    state: String,
    library_root: String,
    install_dir: String,
    original_size_bytes: u64,
    stored_size_bytes: Option<u64>,
    archive_sha256: Option<String>,
    frozen_at: Option<String>,
    error: Option<String>,
}

#[derive(Debug)]
struct InstalledSteamGame {
    library_root: PathBuf,
    manifest_path: PathBuf,
    game_dir: PathBuf,
    install_dir: String,
}

/// Owns GameAccess cold-storage behavior. Steam never sees or needs to understand Frozen state.
#[derive(Default)]
pub struct GameFreezeManager;

impl GameFreezeManager {
    pub fn freeze(&self, app_id: u32) -> Result<GameStorageState, String> {
        Self::ensure_supported()?;
        if app_id == 0 {
            return Err("Invalid Steam AppID".into());
        }
        if let Some(existing) = self.download_status(app_id)? {
            if existing.state == "frozen" {
                return self.storage_state(app_id);
            }
            if matches!(existing.state.as_str(), "freezing" | "thawing") {
                return Err(
                    "Ya hay una operación de almacenamiento activa para este juego.".into(),
                );
            }
        }
        Self::ensure_no_running_game()?;

        let installed = self.find_installed_game(app_id)?;
        let original_size = directory_size(&installed.game_dir)?;
        let freeze_root = freeze_root(&installed.library_root, app_id);
        if freeze_root.exists() {
            return Err(format!(
                "Ya existe almacenamiento GameAccess incompleto para AppID {app_id}: {}",
                freeze_root.display()
            ));
        }
        fs::create_dir_all(&freeze_root)
            .map_err(|err| format!("No pudimos crear el directorio de freeze: {err}"))?;

        let stage = freeze_root.join("payload");
        let archive = freeze_root.join("game.tar.zst");
        let manifest_backup = freeze_root.join(format!("appmanifest_{app_id}.acf"));
        let mut metadata = FreezeManifest {
            schema_version: FREEZE_SCHEMA_VERSION,
            app_id,
            state: "freezing".into(),
            library_root: installed.library_root.to_string_lossy().to_string(),
            install_dir: installed.install_dir.clone(),
            original_size_bytes: original_size,
            stored_size_bytes: None,
            archive_sha256: None,
            frozen_at: None,
            error: None,
        };
        write_freeze_manifest(&freeze_root, &metadata)?;

        let was_running = match stop_steam_if_running() {
            Ok(value) => value,
            Err(err) => {
                let _ = fs::remove_dir_all(&freeze_root);
                return Err(err);
            }
        };
        if let Err(err) = fs::rename(&installed.manifest_path, &manifest_backup) {
            let _ = restart_steam_if_needed(was_running);
            let _ = fs::remove_dir_all(&freeze_root);
            return Err(format!("No pudimos apartar el appmanifest de Steam: {err}"));
        }
        if let Err(err) = fs::rename(&installed.game_dir, &stage) {
            let _ = fs::rename(&manifest_backup, &installed.manifest_path);
            let _ = restart_steam_if_needed(was_running);
            let _ = fs::remove_dir_all(&freeze_root);
            return Err(format!(
                "No pudimos mover el juego fuera de steamapps: {err}"
            ));
        }
        // The data move is already complete and coherent from Steam's perspective.
        // A restart failure must not strand the game forever in `freezing`; finish
        // the archive and surface the restart problem as non-destructive metadata.
        let restart_error = restart_steam_if_needed(was_running).err();

        let compression_result = (|| -> Result<(u64, String), String> {
            compress_directory(&stage, &archive)?;
            let stored_size = fs::metadata(&archive)
                .map_err(|err| format!("No pudimos medir el archivo comprimido: {err}"))?
                .len();
            let checksum = sha256_file(&archive)?;
            Ok((stored_size, checksum))
        })();

        let (stored_size, checksum) = match compression_result {
            Ok(result) => result,
            Err(err) => {
                let rollback = self.rollback_freeze(
                    &installed,
                    &freeze_root,
                    &stage,
                    &manifest_backup,
                    was_running,
                );
                return match rollback {
                    Ok(()) => Err(format!("Freeze cancelado y restaurado sin cambios: {err}")),
                    Err(rollback_err) => Err(format!(
                        "Falló la compresión ({err}) y también la restauración automática ({rollback_err}). Los datos se conservaron en {}.",
                        freeze_root.display()
                    )),
                };
            }
        };

        metadata.state = "frozen".into();
        metadata.stored_size_bytes = Some(stored_size);
        metadata.archive_sha256 = Some(checksum);
        metadata.frozen_at = Some(chrono::Utc::now().to_rfc3339());
        metadata.error = restart_error;
        if let Err(err) = write_freeze_manifest(&freeze_root, &metadata) {
            let rollback = self.rollback_freeze(
                &installed,
                &freeze_root,
                &stage,
                &manifest_backup,
                was_running,
            );
            return match rollback {
                Ok(()) => Err(format!("No pudimos finalizar el metadata de freeze; restauramos el juego: {err}")),
                Err(rollback_err) => Err(format!(
                    "No pudimos finalizar el metadata ({err}) ni restaurar automáticamente ({rollback_err})."
                )),
            };
        }

        fs::remove_dir_all(&stage).map_err(|err| {
            format!("El archivo comprimido está listo, pero no pudimos liberar el staging: {err}")
        })?;
        Ok(storage_state_from_manifest(&metadata, &archive))
    }

    pub fn thaw(&self, app_id: u32) -> Result<GameStorageState, String> {
        Self::ensure_supported()?;
        if app_id == 0 {
            return Err("Invalid Steam AppID".into());
        }
        Self::ensure_no_running_game()?;
        let freeze_root = self
            .find_freeze_root(app_id)
            .ok_or_else(|| format!("AppID {app_id} no está congelado."))?;
        let mut metadata = read_freeze_manifest(&freeze_root)?;
        self.validate_library_root(&metadata)?;

        let library_root = PathBuf::from(&metadata.library_root);
        let target_dir = library_root
            .join("steamapps")
            .join("common")
            .join(&metadata.install_dir);
        let target_manifest = library_root
            .join("steamapps")
            .join(format!("appmanifest_{app_id}.acf"));
        let manifest_backup = freeze_root.join(format!("appmanifest_{app_id}.acf"));
        let stage = freeze_root.join("payload");
        let restore_tmp = freeze_root.join("restore.tmp");
        let archive_path = freeze_root.join("game.tar.zst");

        if target_dir.exists() || target_manifest.exists() {
            return Err("Steam ya tiene archivos o un appmanifest para este juego; GameAccess no va a sobrescribirlos.".into());
        }
        if !manifest_backup.is_file() {
            return Err("El freeze no contiene el appmanifest original; no es seguro restaurarlo automáticamente.".into());
        }

        metadata.state = "thawing".into();
        metadata.error = None;
        write_freeze_manifest(&freeze_root, &metadata)?;

        let restore_source = if stage.is_dir() {
            stage.clone()
        } else {
            if !archive_path.is_file() {
                return Err(
                    "El freeze no contiene ni staging ni archivo comprimido restaurable.".into(),
                );
            }
            if let Some(expected) = metadata.archive_sha256.as_deref() {
                let actual = sha256_file(&archive_path)?;
                if actual != expected {
                    return Err(
                        "El archivo comprimido del juego no supera la verificación SHA-256.".into(),
                    );
                }
            }
            if restore_tmp.exists() {
                fs::remove_dir_all(&restore_tmp).map_err(|err| {
                    format!("No pudimos limpiar una restauración anterior: {err}")
                })?;
            }
            fs::create_dir_all(&restore_tmp)
                .map_err(|err| format!("No pudimos crear el staging de restauración: {err}"))?;
            if let Err(err) = extract_archive(&archive_path, &restore_tmp) {
                let _ = fs::remove_dir_all(&restore_tmp);
                return Err(err);
            }
            restore_tmp.clone()
        };

        let was_running = stop_steam_if_running()?;
        if let Err(err) = fs::rename(&restore_source, &target_dir) {
            let _ = restart_steam_if_needed(was_running);
            return Err(format!(
                "No pudimos devolver el juego a steamapps/common: {err}"
            ));
        }
        if let Err(err) = fs::rename(&manifest_backup, &target_manifest) {
            let _ = fs::rename(&target_dir, &restore_source);
            let _ = restart_steam_if_needed(was_running);
            return Err(format!(
                "No pudimos restaurar el appmanifest; revertimos los archivos del juego: {err}"
            ));
        }
        restart_steam_if_needed(was_running)?;

        let cleanup_error = fs::remove_dir_all(&freeze_root).err().map(|err| {
            format!(
                "El juego fue restaurado, pero no pudimos limpiar todo el archivo congelado: {err}"
            )
        });
        Ok(GameStorageState {
            app_id,
            state: "installed".into(),
            original_size_bytes: Some(metadata.original_size_bytes),
            stored_size_bytes: None,
            archive_path: None,
            error: cleanup_error,
        })
    }

    pub fn storage_state(&self, app_id: u32) -> Result<GameStorageState, String> {
        let steam = native_core::steam_download_status(app_id);
        if steam.installed || steam.state == "installed" {
            return Ok(GameStorageState {
                app_id,
                state: "installed".into(),
                original_size_bytes: None,
                stored_size_bytes: None,
                archive_path: None,
                error: None,
            });
        }
        if let Some(root) = self.find_freeze_root(app_id) {
            match read_freeze_manifest(&root) {
                Ok(metadata) => {
                    return Ok(storage_state_from_manifest(
                        &metadata,
                        &root.join("game.tar.zst"),
                    ));
                }
                Err(err) => {
                    return Ok(GameStorageState {
                        app_id,
                        state: "unknown".into(),
                        original_size_bytes: None,
                        stored_size_bytes: None,
                        archive_path: None,
                        error: Some(err),
                    });
                }
            }
        }
        Ok(GameStorageState {
            app_id,
            state: "not-installed".into(),
            original_size_bytes: None,
            stored_size_bytes: None,
            archive_path: None,
            error: None,
        })
    }

    pub fn download_status(&self, app_id: u32) -> Result<Option<SteamDownloadStatus>, String> {
        let steam = native_core::steam_download_status(app_id);
        if steam.installed || steam.state == "installed" {
            return Ok(None);
        }
        let Some(root) = self.find_freeze_root(app_id) else {
            return Ok(None);
        };
        let metadata = match read_freeze_manifest(&root) {
            Ok(metadata) => metadata,
            Err(_) => {
                return Ok(Some(SteamDownloadStatus {
                    app_id,
                    state: "unknown".into(),
                    progress: None,
                    bytes_downloaded: None,
                    bytes_total: None,
                    installed: false,
                }));
            }
        };
        let state = match metadata.state.as_str() {
            "frozen" | "freezing" | "thawing" => metadata.state.clone(),
            _ => "unknown".into(),
        };
        Ok(Some(SteamDownloadStatus {
            app_id,
            progress: if state == "frozen" { Some(100.0) } else { None },
            state,
            bytes_downloaded: None,
            bytes_total: None,
            installed: false,
        }))
    }

    pub fn frozen_app_ids(&self) -> Vec<u32> {
        let mut ids = Vec::new();
        for library_root in native_core::steam_library_roots() {
            let frozen_root = library_root.join(".gameaccess").join("frozen");
            let Ok(entries) = fs::read_dir(frozen_root) else {
                continue;
            };
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                if let Ok(app_id) = entry.file_name().to_string_lossy().parse::<u32>() {
                    ids.push(app_id);
                }
            }
        }
        ids.sort_unstable();
        ids.dedup();
        ids
    }

    fn find_freeze_root(&self, app_id: u32) -> Option<PathBuf> {
        native_core::steam_library_roots()
            .into_iter()
            .map(|root| freeze_root(&root, app_id))
            .find(|path| path.is_dir())
    }

    fn find_installed_game(&self, app_id: u32) -> Result<InstalledSteamGame, String> {
        for library_root in native_core::steam_library_roots() {
            let manifest_path = library_root
                .join("steamapps")
                .join(format!("appmanifest_{app_id}.acf"));
            let Ok(body) = fs::read_to_string(&manifest_path) else {
                continue;
            };
            let flags = quoted_value(&body, "StateFlags")
                .and_then(|value| value.parse::<u32>().ok())
                .unwrap_or(0);
            if flags & 4 != 4 {
                continue;
            }
            let Some(install_dir) = quoted_value(&body, "installdir") else {
                continue;
            };
            let game_dir = library_root
                .join("steamapps")
                .join("common")
                .join(&install_dir);
            if game_dir.is_dir() {
                return Ok(InstalledSteamGame {
                    library_root,
                    manifest_path,
                    game_dir,
                    install_dir,
                });
            }
        }
        Err(format!(
            "Steam no informa una instalación completa para AppID {app_id}."
        ))
    }

    fn validate_library_root(&self, metadata: &FreezeManifest) -> Result<(), String> {
        let expected = PathBuf::from(&metadata.library_root);
        if native_core::steam_library_roots()
            .into_iter()
            .any(|root| root == expected)
        {
            return Ok(());
        }
        Err("La Steam Library original ya no está configurada; no es seguro restaurar automáticamente.".into())
    }

    fn rollback_freeze(
        &self,
        installed: &InstalledSteamGame,
        freeze_root: &Path,
        stage: &Path,
        manifest_backup: &Path,
        steam_was_running: bool,
    ) -> Result<(), String> {
        if steam_running() {
            let _ = stop_steam_if_running()?;
        }
        if stage.exists() && !installed.game_dir.exists() {
            fs::rename(stage, &installed.game_dir)
                .map_err(|err| format!("No pudimos devolver el staging del juego: {err}"))?;
        }
        if manifest_backup.exists() && !installed.manifest_path.exists() {
            fs::rename(manifest_backup, &installed.manifest_path)
                .map_err(|err| format!("No pudimos devolver el appmanifest: {err}"))?;
        }
        restart_steam_if_needed(steam_was_running)?;
        if installed.game_dir.is_dir() && installed.manifest_path.is_file() {
            fs::remove_dir_all(freeze_root)
                .map_err(|err| format!("No pudimos limpiar el staging fallido: {err}"))?;
        }
        Ok(())
    }

    fn ensure_supported() -> Result<(), String> {
        #[cfg(target_os = "windows")]
        {
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            Err("Game freeze está implementado únicamente para Windows.".into())
        }
    }

    fn ensure_no_running_game() -> Result<(), String> {
        if let Some(app_id) = running_app_id() {
            return Err(format!(
                "Cerrá el juego Steam activo (AppID {app_id}) antes de congelar o restaurar archivos."
            ));
        }
        Ok(())
    }
}

fn freeze_root(library_root: &Path, app_id: u32) -> PathBuf {
    library_root
        .join(".gameaccess")
        .join("frozen")
        .join(app_id.to_string())
}

fn storage_state_from_manifest(metadata: &FreezeManifest, archive: &Path) -> GameStorageState {
    GameStorageState {
        app_id: metadata.app_id,
        state: metadata.state.clone(),
        original_size_bytes: Some(metadata.original_size_bytes),
        stored_size_bytes: metadata.stored_size_bytes,
        archive_path: archive
            .is_file()
            .then(|| archive.to_string_lossy().to_string()),
        error: metadata.error.clone(),
    }
}

fn freeze_manifest_path(freeze_root: &Path) -> PathBuf {
    freeze_root.join("freeze.json")
}

fn write_freeze_manifest(freeze_root: &Path, metadata: &FreezeManifest) -> Result<(), String> {
    let body = serde_json::to_vec_pretty(metadata)
        .map_err(|err| format!("No pudimos serializar el metadata de freeze: {err}"))?;
    fs::write(freeze_manifest_path(freeze_root), body)
        .map_err(|err| format!("No pudimos guardar freeze.json: {err}"))
}

fn read_freeze_manifest(freeze_root: &Path) -> Result<FreezeManifest, String> {
    let body = fs::read(freeze_manifest_path(freeze_root))
        .map_err(|err| format!("No pudimos leer freeze.json: {err}"))?;
    let metadata: FreezeManifest =
        serde_json::from_slice(&body).map_err(|err| format!("freeze.json no es válido: {err}"))?;
    if metadata.schema_version != FREEZE_SCHEMA_VERSION {
        return Err(format!(
            "Versión de freeze no soportada: {}",
            metadata.schema_version
        ));
    }
    Ok(metadata)
}

fn quoted_value(text: &str, wanted: &str) -> Option<String> {
    for line in text.lines() {
        let parts: Vec<&str> = line.split('"').collect();
        if parts.len() >= 4 && parts[1].eq_ignore_ascii_case(wanted) {
            return Some(parts[3].replace("\\\\", "\\"));
        }
    }
    None
}

fn directory_size(path: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|err| format!("No pudimos inspeccionar {}: {err}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!(
            "La instalación contiene un enlace simbólico/junction no compatible con freeze seguro: {}",
            path.display()
        ));
    }
    if metadata.is_file() {
        return Ok(metadata.len());
    }
    let mut total = 0_u64;
    for entry in fs::read_dir(path)
        .map_err(|err| format!("No pudimos recorrer {}: {err}", path.display()))?
    {
        let entry = entry.map_err(|err| format!("No pudimos leer una entrada del juego: {err}"))?;
        total = total
            .checked_add(directory_size(&entry.path())?)
            .ok_or_else(|| "El tamaño del juego excede el rango soportado.".to_string())?;
    }
    Ok(total)
}

fn compress_directory(source: &Path, archive_path: &Path) -> Result<(), String> {
    let file = File::create(archive_path)
        .map_err(|err| format!("No pudimos crear {}: {err}", archive_path.display()))?;
    let writer = BufWriter::new(file);
    let encoder = zstd::stream::write::Encoder::new(writer, ZSTD_LEVEL)
        .map_err(|err| format!("No pudimos iniciar Zstandard: {err}"))?;
    let mut tar = tar::Builder::new(encoder);
    tar.follow_symlinks(false);
    tar.append_dir_all(".", source)
        .map_err(|err| format!("No pudimos archivar los archivos del juego: {err}"))?;
    let encoder = tar
        .into_inner()
        .map_err(|err| format!("No pudimos finalizar TAR: {err}"))?;
    let mut writer = encoder
        .finish()
        .map_err(|err| format!("No pudimos finalizar Zstandard: {err}"))?;
    writer
        .flush()
        .map_err(|err| format!("No pudimos escribir el archivo comprimido: {err}"))
}

fn extract_archive(archive_path: &Path, target: &Path) -> Result<(), String> {
    let file = File::open(archive_path)
        .map_err(|err| format!("No pudimos abrir {}: {err}", archive_path.display()))?;
    let decoder = zstd::stream::read::Decoder::new(BufReader::new(file))
        .map_err(|err| format!("No pudimos abrir el stream Zstandard: {err}"))?;
    let mut archive = tar::Archive::new(decoder);
    archive
        .unpack(target)
        .map_err(|err| format!("No pudimos descomprimir el juego: {err}"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|err| {
        format!(
            "No pudimos abrir {} para verificarlo: {err}",
            path.display()
        )
    })?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|err| format!("No pudimos verificar {}: {err}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(target_os = "windows")]
fn steam_executable() -> Result<PathBuf, String> {
    let runtime = native_core::runtime_prerequisites();
    let root = runtime
        .steam_path
        .ok_or_else(|| "Steam no está instalado o no pudo localizarse.".to_string())?;
    let candidate = PathBuf::from(root).join("steam.exe");
    candidate
        .is_file()
        .then_some(candidate)
        .ok_or_else(|| "No se encontró steam.exe en la instalación detectada.".into())
}

#[cfg(target_os = "windows")]
fn steam_running() -> bool {
    let Ok(output) = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq steam.exe", "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
    else {
        return false;
    };
    String::from_utf8_lossy(&output.stdout)
        .to_ascii_lowercase()
        .contains("steam.exe")
}

#[cfg(not(target_os = "windows"))]
fn steam_running() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn stop_steam_if_running() -> Result<bool, String> {
    if !steam_running() {
        return Ok(false);
    }
    let steam = steam_executable()?;
    let _ = Command::new(&steam)
        .arg("steam://exit")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    let deadline = Instant::now() + Duration::from_secs(12);
    while Instant::now() < deadline {
        if !steam_running() {
            return Ok(true);
        }
        thread::sleep(Duration::from_millis(350));
    }
    let _ = Command::new("taskkill")
        .args(["/F", "/IM", "steam.exe", "/T"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    thread::sleep(Duration::from_millis(800));
    if steam_running() {
        return Err("Steam no se cerró; GameAccess no tocará los archivos del juego.".into());
    }
    Ok(true)
}

#[cfg(not(target_os = "windows"))]
fn stop_steam_if_running() -> Result<bool, String> {
    Err("Game freeze está implementado únicamente para Windows.".into())
}

#[cfg(target_os = "windows")]
fn restart_steam_if_needed(was_running: bool) -> Result<(), String> {
    if !was_running {
        return Ok(());
    }
    Command::new(steam_executable()?)
        .arg("-silent")
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|err| {
            format!("Los archivos están seguros, pero no pudimos reiniciar Steam: {err}")
        })?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn restart_steam_if_needed(_was_running: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn registry_dword(key: &str, value_name: &str) -> Option<u32> {
    let output = Command::new("reg.exe")
        .args(["query", key, "/v", value_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let needle = value_name.to_ascii_lowercase();
    let line = stdout
        .lines()
        .find(|line| line.to_ascii_lowercase().contains(&needle))?;
    let raw = line.split_whitespace().last()?;
    raw.strip_prefix("0x")
        .and_then(|hex| u32::from_str_radix(hex, 16).ok())
        .or_else(|| raw.parse().ok())
}

#[cfg(target_os = "windows")]
fn running_app_id() -> Option<u32> {
    registry_dword(r"HKCU\Software\Valve\Steam\ActiveProcess", "RunningAppID")
        .filter(|value| *value > 0)
}

#[cfg(not(target_os = "windows"))]
fn running_app_id() -> Option<u32> {
    None
}

#[tauri::command]
pub async fn freeze_game(app_id: u32) -> Result<GameStorageState, String> {
    tauri::async_runtime::spawn_blocking(move || GameFreezeManager.freeze(app_id))
        .await
        .map_err(|err| format!("Game freeze task failed: {err}"))?
}

#[tauri::command]
pub async fn thaw_game(app_id: u32) -> Result<GameStorageState, String> {
    tauri::async_runtime::spawn_blocking(move || GameFreezeManager.thaw(app_id))
        .await
        .map_err(|err| format!("Game thaw task failed: {err}"))?
}

#[tauri::command]
pub async fn game_storage_state(app_id: u32) -> Result<GameStorageState, String> {
    tauri::async_runtime::spawn_blocking(move || GameFreezeManager.storage_state(app_id))
        .await
        .map_err(|err| format!("Game storage-state task failed: {err}"))?
}

#[tauri::command]
pub async fn frozen_game_statuses() -> Result<Vec<SteamDownloadStatus>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GameFreezeManager;
        manager
            .frozen_app_ids()
            .into_iter()
            .filter_map(|app_id| manager.download_status(app_id).ok().flatten())
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|err| format!("Frozen-game scan failed: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_root() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        std::env::temp_dir().join(format!("gameaccess-freeze-test-{nonce}"))
    }

    #[test]
    fn reads_vdf_values() {
        let body = "\"AppState\"\n{\n  \"StateFlags\" \"4\"\n  \"installdir\" \"Example Game\"\n}";
        assert_eq!(quoted_value(body, "StateFlags").as_deref(), Some("4"));
        assert_eq!(
            quoted_value(body, "installdir").as_deref(),
            Some("Example Game")
        );
    }

    #[test]
    fn zstd_tar_round_trip_preserves_game_payload() {
        let root = test_root();
        let source = root.join("source");
        let restored = root.join("restored");
        let archive = root.join("game.tar.zst");
        fs::create_dir_all(source.join("data")).expect("source dirs");
        fs::write(source.join("game.exe"), b"game-binary").expect("game file");
        fs::write(
            source.join("data").join("asset.bin"),
            vec![7_u8; 128 * 1024],
        )
        .expect("asset");

        compress_directory(&source, &archive).expect("compress");
        fs::create_dir_all(&restored).expect("restore dir");
        extract_archive(&archive, &restored).expect("extract");

        assert_eq!(
            fs::read(restored.join("game.exe")).expect("restored game"),
            b"game-binary"
        );
        assert_eq!(
            fs::read(restored.join("data").join("asset.bin")).expect("restored asset"),
            vec![7_u8; 128 * 1024]
        );
        fs::remove_dir_all(root).expect("cleanup");
    }
}
