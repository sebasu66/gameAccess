use std::process::Command;

fn portrait_url(response: &serde_json::Value, app_id: u32) -> Option<String> {
    let item = response
        .get("response")?
        .get("store_items")?
        .as_array()?
        .first()?;
    if item.get("appid")?.as_u64()? != u64::from(app_id) {
        return None;
    }
    let assets = item.get("assets")?;
    let filename = assets
        .get("library_capsule_2x")
        .or_else(|| assets.get("library_capsule"))?
        .as_str()?;
    let template = assets.get("asset_url_format")?.as_str()?;
    if !template.starts_with(&format!("steam/apps/{app_id}/")) || filename.contains("..") {
        return None;
    }
    Some(format!(
        "https://shared.akamai.steamstatic.com/store_item_assets/{}",
        template.replace("${FILENAME}", filename)
    ))
}

fn fetch_portrait(app_id: u32) -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let input = serde_json::json!({"ids":[{"appid":app_id}],"context":{"language":"english","country_code":"US"},"data_request":{"include_assets":true}}).to_string();
        let script = format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; $query=[uri]::EscapeDataString('{input}'); Invoke-RestMethod -Uri ('https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json='+$query) -TimeoutSec 15 | ConvertTo-Json -Depth 20 -Compress");
        let output = Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .creation_flags(0x08000000)
            .output()
            .map_err(|error| error.to_string())?;
        if !output.status.success() {
            return Err("Steam portrait lookup failed".into());
        }
        let response: serde_json::Value =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        Ok(portrait_url(&response, app_id))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app_id;
        Ok(None)
    }
}

#[tauri::command]
pub async fn steam_library_cover(app_id: u32) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || fetch_portrait(app_id))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_hashed_library_asset_only() {
        let response = serde_json::json!({"response":{"store_items":[{"appid":42,"assets":{"asset_url_format":"steam/apps/42/${FILENAME}?t=1","library_capsule_2x":"abc/library_capsule_2x.jpg","header":"wide.jpg"}}]}});
        assert_eq!(portrait_url(&response,42).unwrap(),"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/abc/library_capsule_2x.jpg?t=1");
        assert!(portrait_url(&response, 43).is_none());
    }
    #[test]
    fn does_not_substitute_landscape_assets() {
        let response = serde_json::json!({"response":{"store_items":[{"appid":42,"assets":{"asset_url_format":"steam/apps/42/${FILENAME}","header":"wide.jpg"}}]}});
        assert!(portrait_url(&response, 42).is_none());
    }
}
