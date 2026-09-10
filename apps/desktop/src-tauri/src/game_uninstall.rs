use gameaccess_desktop::native_core;
use std::{path::PathBuf, process::Command};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Steam-owned uninstall integration. GameAccess never deletes Steam game files itself.
#[derive(Default)]
pub struct GameUninstaller;

impl GameUninstaller {
    pub fn uninstall(&self, app_id: u32) -> Result<(), String> {
        if app_id == 0 {
            return Err("Invalid Steam AppID".into());
        }
        let status = native_core::steam_download_status(app_id);
        if !status.installed && status.state != "installed" {
            return Err(format!("Steam no considera instalado AppID {app_id}."));
        }
        self.open_uninstall_uri(app_id)
    }

    fn steam_executable() -> Result<PathBuf, String> {
        let runtime = native_core::runtime_prerequisites();
        let root = runtime
            .steam_path
            .ok_or_else(|| "Steam no está instalado o no pudo localizarse.".to_string())?;
        let candidate = PathBuf::from(root).join("steam.exe");
        if candidate.is_file() {
            Ok(candidate)
        } else {
            Err("No se encontró steam.exe en la instalación detectada.".into())
        }
    }

    fn open_uninstall_uri(&self, app_id: u32) -> Result<(), String> {
        let uri = format!("steam://uninstall/{app_id}");

        #[cfg(target_os = "windows")]
        {
            Command::new(Self::steam_executable()?)
                .arg(uri)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|err| format!("No pudimos iniciar la desinstalación de Steam: {err}"))?;
            Ok(())
        }

        #[cfg(target_os = "macos")]
        {
            Command::new("open")
                .arg(uri)
                .spawn()
                .map_err(|err| format!("No pudimos iniciar la desinstalación de Steam: {err}"))?;
            Ok(())
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        {
            Command::new("xdg-open")
                .arg(uri)
                .spawn()
                .map_err(|err| format!("No pudimos iniciar la desinstalación de Steam: {err}"))?;
            Ok(())
        }
    }
}

#[tauri::command]
pub async fn uninstall_game(app_id: u32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || GameUninstaller.uninstall(app_id))
        .await
        .map_err(|err| format!("Steam uninstall task failed: {err}"))?
}
