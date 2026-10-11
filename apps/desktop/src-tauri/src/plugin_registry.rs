//! Plugin registry. Extracted without changing IPC contracts.


#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    #[serde(rename = "type")]
    pub plugin_type: String,
}

#[tauri::command]
pub(crate) fn get_registered_plugins() -> Vec<PluginManifest> {
    let mut plugins = Vec::new();
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            format!("{}/Library/Application Support", std::env::var("HOME").unwrap_or_default())
        } else {
            format!("{}/.local/share", std::env::var("HOME").unwrap_or_default())
        }
    });
    let plugins_dir = std::path::PathBuf::from(app_data).join("GameAccess").join("plugins");

    if plugins_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(plugins_dir) {
            for entry in entries.flatten() {
                if let Ok(file_type) = entry.file_type() {
                    if file_type.is_file() && entry.path().extension().map_or(false, |ext| ext == "json") {
                        if let Ok(content) = std::fs::read_to_string(entry.path()) {
                            if let Ok(manifest) = serde_json::from_str::<PluginManifest>(&content) {
                                plugins.push(manifest);
                            }
                        }
                    }
                }
            }
        }
    }
    plugins
}
