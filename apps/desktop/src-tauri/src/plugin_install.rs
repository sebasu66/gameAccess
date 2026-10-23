//! Generic "install a plugin from a link" support: `gameaccess://install-plugin?url=...&sha256=...`.
//!
//! The app knows nothing about any particular plugin. Whoever publishes a plugin builds the
//! link; the user always sees a confirmation naming the download host, and the zip must match
//! the SHA-256 in the link before anything is extracted. The zip mirrors the plugins folder
//! (`%APPDATA%\GameAccess\plugins`); top-level `.json` files that already exist are kept, so a
//! reinstall never overwrites the user's own settings.
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

const LINK_PREFIX: &str = "gameaccess://install-plugin";
const MAX_DOWNLOAD_BYTES: u64 = 400 * 1024 * 1024;
static BUSY: AtomicBool = AtomicBool::new(false);
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Lets a finished install start the plugin and tell the interface, which syncs its sources right away.
pub fn attach(app: tauri::AppHandle) {
    let _ = APP.set(app);
}

#[derive(Debug, PartialEq, Clone)]
pub struct InstallRequest {
    pub url: String,
    pub sha256: String,
    pub name: String,
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = value.get(i + 1..i + 3)?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

fn clean_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '.' | '_' | '-'))
        .take(40)
        .collect();
    let cleaned = cleaned.trim().to_string();
    if cleaned.is_empty() { "plugin".to_string() } else { cleaned }
}

/// Reads an install link from the process arguments. Anything malformed is ignored.
pub fn parse(args: &[String]) -> Option<InstallRequest> {
    let raw = args.iter().find(|arg| arg.to_ascii_lowercase().starts_with(LINK_PREFIX))?;
    let query = raw.split_once('?')?.1;
    let (mut url, mut sha256, mut name) = (None, None, String::new());
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
        let value = percent_decode(value)?;
        match key {
            "url" => url = Some(value),
            "sha256" => sha256 = Some(value.to_ascii_lowercase()),
            "name" => name = clean_name(&value),
            _ => {}
        }
    }
    let url = url?;
    let sha256 = sha256?;
    if !url.starts_with("https://") || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return None;
    }
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    if name.is_empty() {
        name = "plugin".to_string();
    }
    Some(InstallRequest { url, sha256, name })
}

fn host_of(url: &str) -> String {
    url.trim_start_matches("https://").split(['/', '?', '#']).next().unwrap_or("").to_string()
}

fn plugins_root() -> Option<PathBuf> {
    env::var_os("APPDATA").map(|appdata| PathBuf::from(appdata).join("GameAccess").join("plugins"))
}

#[cfg(windows)]
fn hidden(command: &mut Command) -> &mut Command {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000)
}
#[cfg(not(windows))]
fn hidden(command: &mut Command) -> &mut Command {
    command
}

/// Native Yes/No or OK box. Text travels through the environment, never through a command line.
fn message_box(title: &str, text: &str, yes_no: bool) -> bool {
    let script = "Add-Type -AssemblyName PresentationFramework; \
        $buttons = if ($env:GA_BOX_YESNO -eq '1') { 'YesNo' } else { 'OK' }; \
        $icon = if ($env:GA_BOX_YESNO -eq '1') { 'Question' } else { 'Information' }; \
        $answer = [System.Windows.MessageBox]::Show($env:GA_BOX_TEXT, $env:GA_BOX_TITLE, $buttons, $icon, 'No'); \
        if ($answer -eq 'Yes' -or $answer -eq 'OK') { exit 0 } else { exit 1 }";
    let mut command = Command::new("powershell");
    command
        .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script])
        .env("GA_BOX_TEXT", text)
        .env("GA_BOX_TITLE", title)
        .env("GA_BOX_YESNO", if yes_no { "1" } else { "0" });
    hidden(&mut command).status().map(|status| status.success()).unwrap_or(false)
}

fn download(url: &str, destination: &Path) -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(url).send().map_err(|e| format!("No se pudo descargar: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("La descarga respondió con el código {}", response.status()));
    }
    if response.content_length().map_or(false, |length| length > MAX_DOWNLOAD_BYTES) {
        return Err("El archivo es demasiado grande.".to_string());
    }
    let mut file = fs::File::create(destination).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let read = response.read(&mut buffer).map_err(|e| format!("Se cortó la descarga: {e}"))?;
        if read == 0 {
            break;
        }
        total += read as u64;
        if total > MAX_DOWNLOAD_BYTES {
            return Err("El archivo es demasiado grande.".to_string());
        }
        hasher.update(&buffer[..read]);
        file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
    }
    Ok(hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Copies `source` into `target`; top-level `.json` files that already exist are left untouched.
fn merge_preserving_settings(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())?.flatten() {
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else if !(to.exists() && from.extension().map_or(false, |ext| ext == "json")) {
            fs::copy(&from, &to).map_err(|e| format!("No se pudo copiar {}: {e}", to.display()))?;
        }
    }
    Ok(())
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())?.flatten() {
        let from = entry.path();
        let to = target.join(entry.file_name());
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("No se pudo copiar {}: {e}", to.display()))?;
        }
    }
    Ok(())
}

fn install(request: &InstallRequest, root: &Path) -> Result<(), String> {
    let work = env::temp_dir().join(format!("gameaccess-plugin-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = (|| {
        let archive = work.join("plugin.zip");
        let digest = download(&request.url, &archive)?;
        if digest != request.sha256 {
            return Err("El archivo descargado no coincide con la firma (SHA-256) del enlace. No se instaló nada.".to_string());
        }
        let extracted = work.join("files");
        fs::create_dir_all(&extracted).map_err(|e| e.to_string())?;
        // bsdtar ships with Windows 10+ and refuses paths that escape the target folder.
        let mut tar = Command::new("tar");
        tar.arg("-xf").arg(&archive).arg("-C").arg(&extracted);
        let status = hidden(&mut tar).status().map_err(|e| format!("No se pudo abrir el zip: {e}"))?;
        if !status.success() {
            return Err("El zip no se pudo extraer.".to_string());
        }
        crate::plugin_registry::stop_all_plugins();
        merge_preserving_settings(&extracted, root)
    })();
    let _ = fs::remove_dir_all(&work);
    result
}

/// Handles an install link if the arguments carry one. Never blocks the caller.
pub fn receive(args: &[String]) {
    let Some(request) = parse(args) else { return };
    if BUSY.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        run(&request);
        BUSY.store(false, Ordering::SeqCst);
    });
}

fn run(request: &InstallRequest) {
    let title = "Game Access - instalar plugin";
    let question = format!(
        "Una página pidió instalar el plugin \"{}\".\n\nSe descargará desde: {}\nFirma (SHA-256): {}…\n\nUn plugin es un programa de terceros que Game Access ejecuta en tu equipo. Instalalo solo si confiás en quien lo publica.\n\n¿Querés instalarlo?",
        request.name,
        host_of(&request.url),
        &request.sha256[..16]
    );
    if !message_box(title, &question, true) {
        return;
    }
    let Some(root) = plugins_root() else {
        message_box(title, "No se encontró la carpeta de datos de Game Access.", false);
        return;
    };
    match install(request, &root) {
        Ok(()) => {
            // No restart needed: the plugin starts now and the interface syncs its sources in its central dialog.
            crate::plugin_registry::start_registered_plugins();
            match APP.get() {
                Some(app) => {
                    use tauri::Emitter;
                    let _ = app.emit("gameaccess:plugin-installed", serde_json::json!({ "name": request.name }));
                }
                None => {
                    message_box(title, "Plugin instalado.

Volvé a abrir Game Access para que el plugin funcione.", false);
                }
            }
        }
        Err(error) => {
            message_box(title, &format!("No se pudo instalar el plugin: {error}"), false);
        }
    }
}

/// Registers the `gameaccess://` protocol for the current user (no administrator rights).
pub fn register_protocol() {
    #[cfg(windows)]
    {
        let Ok(exe) = env::current_exe() else { return };
        let command = format!("\"{}\" \"%1\"", exe.display());
        let entries: [(&str, Option<&str>, &str); 3] = [
            (r"HKCU\Software\Classes\gameaccess", None, "URL:Game Access"),
            (r"HKCU\Software\Classes\gameaccess", Some("URL Protocol"), ""),
            (r"HKCU\Software\Classes\gameaccess\shell\open\command", None, command.as_str()),
        ];
        for (key, name, value) in entries {
            let mut reg = Command::new("reg");
            reg.args(["add", key]);
            match name {
                Some(name) => reg.args(["/v", name]),
                None => reg.arg("/ve"),
            };
            reg.args(["/d", value, "/f"]);
            let _ = hidden(&mut reg).status();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(link: &str) -> Vec<String> {
        vec!["ga.exe".to_string(), link.to_string()]
    }
    const HASH: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn parses_a_valid_link() {
        let link = format!("gameaccess://install-plugin?url=https%3A%2F%2Fgithub.com%2Fa%2Fb%2Fp.zip&sha256={HASH}&name=My+Plugin");
        let request = parse(&args(&link)).expect("valid link");
        assert_eq!(request.url, "https://github.com/a/b/p.zip");
        assert_eq!(request.sha256, HASH);
        assert_eq!(request.name, "My Plugin");
        assert_eq!(host_of(&request.url), "github.com");
    }

    #[test]
    fn accepts_the_slash_some_browsers_add() {
        let link = format!("gameaccess://install-plugin/?url=https://x.test/p.zip&sha256={HASH}");
        assert_eq!(parse(&args(&link)).map(|r| r.name), Some("plugin".to_string()));
    }

    #[test]
    fn rejects_unsafe_or_incomplete_links() {
        for link in [
            format!("gameaccess://install-plugin?url=http://x.test/p.zip&sha256={HASH}"),
            format!("gameaccess://install-plugin?url=file:///c:/p.zip&sha256={HASH}"),
            "gameaccess://install-plugin?url=https://x.test/p.zip".to_string(),
            "gameaccess://install-plugin?url=https://x.test/p.zip&sha256=abc".to_string(),
            format!("gameaccess://install-plugin?url=https://x.test/a b.zip&sha256={HASH}"),
            format!("gameaccess://other?url=https://x.test/p.zip&sha256={HASH}"),
        ] {
            assert_eq!(parse(&args(&link)), None, "{link}");
        }
    }

    #[test]
    fn names_are_sanitized() {
        assert_eq!(clean_name("..\\evil/<script>"), "..evilscript");
        assert_eq!(clean_name("***"), "plugin");
    }

    #[test]
    fn reinstall_keeps_existing_json_settings() {
        let base = env::temp_dir().join(format!("ga-merge-{}", uuid::Uuid::new_v4()));
        let (source, target) = (base.join("src"), base.join("dst"));
        fs::create_dir_all(source.join("plug")).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("settings.json"), "new").unwrap();
        fs::write(source.join("plug").join("app.exe"), "v2").unwrap();
        fs::write(target.join("settings.json"), "mine").unwrap();
        merge_preserving_settings(&source, &target).unwrap();
        assert_eq!(fs::read_to_string(target.join("settings.json")).unwrap(), "mine");
        assert_eq!(fs::read_to_string(target.join("plug").join("app.exe")).unwrap(), "v2");
        let _ = fs::remove_dir_all(&base);
    }
}
