use std::sync::OnceLock;

static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();

fn get_client() -> &'static reqwest::blocking::Client {
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(6))
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new())
    })
}

/// `small` asks for the 300x450 capsule (cards at or below 300 device pixels); otherwise the 600x900 one.
/// Each size falls back to the other, because some titles only publish one of them.
fn portrait_url(response: &serde_json::Value, app_id: u32, small: bool) -> Option<String> {
    let item = response
        .get("response")?
        .get("store_items")?
        .as_array()?
        .first()?;
    if item.get("appid")?.as_u64()? != u64::from(app_id) {
        return None;
    }
    let assets = item.get("assets")?;
    let (first, second) = if small { ("library_capsule", "library_capsule_2x") } else { ("library_capsule_2x", "library_capsule") };
    let filename = assets
        .get(first)
        .or_else(|| assets.get(second))?
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

fn fetch_portrait(app_id: u32, small: bool) -> Result<Option<String>, String> {
    let input = serde_json::json!({
        "ids": [{"appid": app_id}],
        "context": {"language": "english", "country_code": "US"},
        "data_request": {"include_assets": true}
    }).to_string();

    let client = get_client();
    let response = client
        .get("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/")
        .query(&[("input_json", &input)])
        .header(reqwest::header::USER_AGENT, "GameAccess/1.0")
        .send()
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err("Steam portrait lookup failed".into());
    }

    let payload: serde_json::Value = response.json().map_err(|error| error.to_string())?;
    Ok(portrait_url(&payload, app_id, small))
}

#[tauri::command]
pub async fn steam_library_cover(app_id: u32, size: Option<String>) -> Result<Option<String>, String> {
    let small = size.as_deref() == Some("1x");
    tauri::async_runtime::spawn_blocking(move || fetch_portrait(app_id, small))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uses_hashed_library_asset_only() {
        let response = serde_json::json!({"response":{"store_items":[{"appid":42,"assets":{"asset_url_format":"steam/apps/42/${FILENAME}?t=1","library_capsule_2x":"abc/library_capsule_2x.jpg","header":"wide.jpg"}}]}});
        assert_eq!(portrait_url(&response,42,false).unwrap(),"https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/42/abc/library_capsule_2x.jpg?t=1");
        assert!(portrait_url(&response, 43, false).is_none());
    }
    #[test]
    fn does_not_substitute_landscape_assets() {
        let response = serde_json::json!({"response":{"store_items":[{"appid":42,"assets":{"asset_url_format":"steam/apps/42/${FILENAME}","header":"wide.jpg"}}]}});
        assert!(portrait_url(&response, 42, false).is_none());
    }
    #[test]
    fn picks_the_requested_portrait_size_with_fallback() {
        let both = serde_json::json!({"response":{"store_items":[{"appid":42,"assets":{"asset_url_format":"steam/apps/42/${FILENAME}","library_capsule":"abc/library_capsule.jpg","library_capsule_2x":"abc/library_capsule_2x.jpg"}}]}});
        assert!(portrait_url(&both, 42, true).unwrap().ends_with("abc/library_capsule.jpg"));
        assert!(portrait_url(&both, 42, false).unwrap().ends_with("abc/library_capsule_2x.jpg"));
        let only_large = serde_json::json!({"response":{"store_items":[{"appid":42,"assets":{"asset_url_format":"steam/apps/42/${FILENAME}","library_capsule_2x":"abc/library_capsule_2x.jpg"}}]}});
        assert!(portrait_url(&only_large, 42, true).unwrap().ends_with("abc/library_capsule_2x.jpg"));
    }
}
