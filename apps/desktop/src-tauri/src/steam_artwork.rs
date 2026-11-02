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

/// App ids of a list of store items (`[{"id": 123, "type": 0}, ...]`); type 0 is an app, the others are bundles and packages.
fn store_item_ids(items: Option<&serde_json::Value>) -> Vec<u32> {
    items
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter(|item| item.get("type").and_then(|kind| kind.as_u64()).unwrap_or(0) == 0)
                .filter_map(|item| item.get("id")?.as_u64().and_then(|id| u32::try_from(id).ok()))
                .collect()
        })
        .unwrap_or_default()
}

/// What the Steam store puts in front, most prominent first, without repeats: its top sellers and specials
/// (`featuredcategories`), its featured games for Windows (`featured`) and the most played games of the week
/// (charts, so there are always enough well-known games). A missing answer just leaves its part out.
fn featured_ids(categories: Option<&serde_json::Value>, featured: Option<&serde_json::Value>, charts: Option<&serde_json::Value>) -> Vec<u32> {
    let section = |root: Option<&serde_json::Value>, name: &str| store_item_ids(root.and_then(|root| root.get(name)).and_then(|part| part.get("items")));
    let most_played: Vec<u32> = charts
        .and_then(|charts| charts.get("response")?.get("ranks")?.as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|rank| rank.get("appid")?.as_u64().and_then(|id| u32::try_from(id).ok()))
        .collect();
    let mut seen = std::collections::HashSet::new();
    section(categories, "top_sellers")
        .into_iter()
        .chain(section(categories, "specials"))
        .chain(store_item_ids(featured.and_then(|featured| featured.get("featured_win"))))
        .chain(most_played)
        .filter(|id| seen.insert(*id))
        .collect()
}

fn fetch_json(url: &str) -> Option<serde_json::Value> {
    let response = get_client().get(url).header(reqwest::header::USER_AGENT, "GameAccess/1.0").send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json().ok()
}

/// The games the Steam store features now (see `featured_ids`), for the catalog banner.
#[tauri::command]
pub async fn steam_featured_app_ids() -> Result<Vec<u32>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let categories = fetch_json("https://store.steampowered.com/api/featuredcategories?cc=us&l=english");
        let featured = fetch_json("https://store.steampowered.com/api/featured?cc=us&l=english");
        let charts = fetch_json("https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/");
        if categories.is_none() && featured.is_none() && charts.is_none() {
            return Err("Steam featured lookup failed".to_string());
        }
        Ok(featured_ids(categories.as_ref(), featured.as_ref(), charts.as_ref()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn featured_ids_keep_the_store_order_without_repeats_or_bundles() {
        let categories = serde_json::json!({"top_sellers":{"items":[{"id":10,"type":0},{"id":10,"type":0},{"id":99,"type":1}]},"specials":{"items":[{"id":20,"type":0},{"id":10,"type":0}]}});
        let featured = serde_json::json!({"featured_win":[{"id":30,"type":0}]});
        let charts = serde_json::json!({"response":{"ranks":[{"rank":1,"appid":40},{"rank":2,"appid":20}]}});
        assert_eq!(featured_ids(Some(&categories), Some(&featured), Some(&charts)), vec![10, 20, 30, 40]);
    }
    #[test]
    fn featured_ids_use_whatever_answered() {
        let charts = serde_json::json!({"response":{"ranks":[{"rank":1,"appid":730}]}});
        assert_eq!(featured_ids(None, None, Some(&charts)), vec![730]);
        assert!(featured_ids(None, None, None).is_empty());
    }
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
