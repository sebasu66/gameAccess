use flate2::read::GzDecoder;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, CACHE_CONTROL, USER_AGENT};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};

const CACHE_SCHEMA_VERSION: u32 = 1;
const MAX_COMPRESSED_BYTES: usize = 100 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct CatalogManifest {
    schema_version: u32,
    revision: String,
    artifact_url: String,
    sha256: String,
    catalog_count: usize,
}

#[derive(Debug, Serialize)]
pub struct CatalogCacheSyncResult {
    pub updated: bool,
    pub revision: String,
    pub catalog_count: usize,
}

fn cache_dir() -> Result<PathBuf, String> {
    let base = env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(env::temp_dir);
    let directory = base.join("GameAccess").join("cache");
    fs::create_dir_all(&directory)
        .map_err(|err| format!("Could not create catalog cache directory: {err}"))?;
    Ok(directory)
}

fn cache_db_path() -> Result<PathBuf, String> {
    Ok(cache_dir()?.join("catalog.sqlite"))
}

fn validate_github_https_url(raw: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(raw).map_err(|err| format!("Invalid catalog cache URL: {err}"))?;
    if parsed.scheme() != "https" {
        return Err("Catalog cache URL must use HTTPS".into());
    }
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let allowed = host == "raw.githubusercontent.com"
        || host == "api.github.com"
        || host == "github.com"
        || host.ends_with(".githubusercontent.com");
    if !allowed {
        return Err(format!("Catalog cache URL host is not allowed: {host}"));
    }
    Ok(())
}

fn read_meta(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut statement = conn
        .prepare("SELECT value FROM metadata WHERE key=?1")
        .map_err(|err| err.to_string())?;
    match statement.query_row([key], |row| row.get::<_, String>(0)) {
        Ok(value) => Ok(Some(value)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(err.to_string()),
    }
}

fn validate_database(path: &Path, manifest: &CatalogManifest) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|err| format!("Could not open downloaded catalog cache: {err}"))?;
    let schema = read_meta(&conn, "schema_version")?
        .ok_or_else(|| "Catalog cache has no schema_version".to_string())?
        .parse::<u32>()
        .map_err(|_| "Catalog cache schema_version is invalid".to_string())?;
    if schema != CACHE_SCHEMA_VERSION || schema != manifest.schema_version {
        return Err(format!(
            "Unsupported catalog cache schema {schema}; expected {CACHE_SCHEMA_VERSION}"
        ));
    }
    let revision = read_meta(&conn, "revision")?
        .ok_or_else(|| "Catalog cache has no revision".to_string())?;
    if revision != manifest.revision {
        return Err("Catalog cache revision does not match manifest".into());
    }
    let count: usize = conn
        .query_row("SELECT COUNT(*) FROM catalog_game", [], |row| row.get::<_, i64>(0))
        .map_err(|err| err.to_string())?
        .try_into()
        .map_err(|_| "Catalog cache row count is invalid".to_string())?;
    if count != manifest.catalog_count {
        return Err(format!(
            "Catalog cache row count {count} does not match manifest {}",
            manifest.catalog_count
        ));
    }
    Ok(())
}

fn current_cache_info(path: &Path) -> Result<Option<(String, usize)>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let conn = Connection::open(path).map_err(|err| err.to_string())?;
    let revision = match read_meta(&conn, "revision")? {
        Some(value) => value,
        None => return Ok(None),
    };
    let count: usize = conn
        .query_row("SELECT COUNT(*) FROM catalog_game", [], |row| row.get::<_, i64>(0))
        .map_err(|err| err.to_string())?
        .try_into()
        .map_err(|_| "Catalog cache row count is invalid".to_string())?;
    Ok(Some((revision, count)))
}

fn sync_blocking(manifest_url: String) -> Result<CatalogCacheSyncResult, String> {
    validate_github_https_url(&manifest_url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|err| format!("Could not create catalog cache client: {err}"))?;
    let manifest = client
        .get(&manifest_url)
        .header(USER_AGENT, "GameAccess/0.1")
        .header(ACCEPT, "application/vnd.github.raw+json")
        .header(CACHE_CONTROL, "no-cache")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|err| format!("Could not download catalog manifest: {err}"))?
        .json::<CatalogManifest>()
        .map_err(|err| format!("Invalid catalog manifest: {err}"))?;

    if manifest.schema_version != CACHE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported catalog manifest schema {}; expected {}",
            manifest.schema_version, CACHE_SCHEMA_VERSION
        ));
    }
    validate_github_https_url(&manifest.artifact_url)?;

    let target = cache_db_path()?;
    if let Some((revision, count)) = current_cache_info(&target)? {
        if revision == manifest.revision {
            return Ok(CatalogCacheSyncResult {
                updated: false,
                revision,
                catalog_count: count,
            });
        }
    }

    let compressed = client
        .get(&manifest.artifact_url)
        .header(CACHE_CONTROL, "public, max-age=31536000, immutable")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|err| format!("Could not download catalog cache: {err}"))?
        .bytes()
        .map_err(|err| format!("Could not read catalog cache download: {err}"))?;
    if compressed.len() > MAX_COMPRESSED_BYTES {
        return Err("Catalog cache download is unexpectedly large".into());
    }

    let actual_sha = format!("{:x}", Sha256::digest(&compressed));
    if !actual_sha.eq_ignore_ascii_case(manifest.sha256.trim()) {
        return Err("Catalog cache SHA-256 verification failed".into());
    }

    let mut decoder = GzDecoder::new(compressed.as_ref());
    let mut sqlite_bytes = Vec::new();
    decoder
        .read_to_end(&mut sqlite_bytes)
        .map_err(|err| format!("Could not decompress catalog cache: {err}"))?;

    let next = target.with_extension("sqlite.next");
    let backup = target.with_extension("sqlite.bak");
    fs::write(&next, sqlite_bytes).map_err(|err| format!("Could not write catalog cache: {err}"))?;
    validate_database(&next, &manifest)?;

    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }
    if target.exists() {
        fs::rename(&target, &backup)
            .map_err(|err| format!("Could not rotate old catalog cache: {err}"))?;
    }
    if let Err(err) = fs::rename(&next, &target) {
        if backup.exists() {
            let _ = fs::rename(&backup, &target);
        }
        return Err(format!("Could not activate new catalog cache: {err}"));
    }
    if backup.exists() {
        let _ = fs::remove_file(&backup);
    }

    Ok(CatalogCacheSyncResult {
        updated: true,
        revision: manifest.revision,
        catalog_count: manifest.catalog_count,
    })
}

#[tauri::command]
pub async fn catalog_cache_sync(manifest_url: String) -> Result<CatalogCacheSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || sync_blocking(manifest_url))
        .await
        .map_err(|err| format!("Catalog cache sync task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_read() -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = cache_db_path()?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let mut statement = conn
            .prepare("SELECT payload FROM catalog_game ORDER BY id")
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|err| err.to_string())?;
        let mut games = Vec::new();
        for row in rows {
            let payload = row.map_err(|err| err.to_string())?;
            games.push(serde_json::from_str(&payload).map_err(|err| err.to_string())?);
        }
        Ok(games)
    })
    .await
    .map_err(|err| format!("Catalog cache read task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_upsert_game(game: Value) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let id = game
            .get("id")
            .and_then(Value::as_i64)
            .ok_or_else(|| "Cached catalog game is missing id".to_string())?;
        let app_id = game.get("app_id").and_then(Value::as_i64);
        let payload = serde_json::to_string(&game).map_err(|err| err.to_string())?;
        let path = cache_db_path()?;
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        conn.execute(
            "INSERT INTO catalog_game(id, app_id, payload) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET app_id=excluded.app_id, payload=excluded.payload",
            params![id, app_id, payload],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Catalog cache update task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_read_detail(
    game_id: i64,
    language: String,
    country: String,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = cache_db_path()?;
        if !path.exists() {
            return Ok(None);
        }
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let mut statement = conn
            .prepare(
                "SELECT payload FROM game_detail
                 WHERE game_id=?1 AND language=?2 AND country=?3",
            )
            .map_err(|err| err.to_string())?;
        match statement.query_row(params![game_id, language, country], |row| row.get::<_, String>(0)) {
            Ok(payload) => Ok(Some(
                serde_json::from_str(&payload).map_err(|err| err.to_string())?,
            )),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(err) => Err(err.to_string()),
        }
    })
    .await
    .map_err(|err| format!("Catalog detail cache read task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_store_detail(
    game_id: i64,
    language: String,
    country: String,
    detail: Value,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = cache_db_path()?;
        if !path.exists() {
            return Ok(());
        }
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let payload = serde_json::to_string(&detail).map_err(|err| err.to_string())?;
        conn.execute(
            "INSERT INTO game_detail(game_id, language, country, payload)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(game_id, language, country)
             DO UPDATE SET payload=excluded.payload",
            params![game_id, language, country, payload],
        )
        .map_err(|err| err.to_string())?;
        Ok(())
    })
    .await
    .map_err(|err| format!("Catalog detail cache write task failed: {err}"))?
}
