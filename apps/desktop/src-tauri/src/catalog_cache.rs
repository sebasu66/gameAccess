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
    sync::{Mutex, OnceLock},
    time::Duration,
};

const CACHE_SCHEMA_VERSION: u32 = 1;
const MAX_COMPRESSED_BYTES: usize = 100 * 1024 * 1024;
static CATALOG_CACHE_SYNC_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Deserialize)]
struct CatalogManifest {
    schema_version: u32,
    revision: String,
    artifact_url: String,
    sha256: String,
    catalog_count: usize,
    #[serde(default)]
    generated_at: String,
    #[serde(default)]
    kind: String,
    #[serde(default)]
    base_revision: String,
    #[serde(default)]
    inventory_sha256: String,
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

fn bundled_catalog_dir() -> Option<PathBuf> {
    if let Some(value) = env::var_os("GAMEACCESS_CATALOG_SEED_DIR") {
        let path = PathBuf::from(value);
        if path.is_dir() {
            return Some(path);
        }
    }
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join("runtime").join("catalog");
            if candidate.is_dir() {
                return Some(candidate);
            }
        }
    }
    let project_seed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../deploy/catalog-cache");
    if project_seed.join("catalog-manifest.json").is_file() { return Some(project_seed); }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime/catalog");
    dev.is_dir().then_some(dev)
}

fn install_bundled_seed(target: &Path) -> Result<bool, String> {
    let Some(seed_dir) = bundled_catalog_dir() else {
        return Ok(false);
    };
    let manifest_path = seed_dir.join("catalog-manifest.json");
    if !manifest_path.is_file() {
        return Ok(false);
    }

    let manifest: CatalogManifest = serde_json::from_str(
        &fs::read_to_string(&manifest_path)
            .map_err(|err| format!("Could not read bundled catalog manifest: {err}"))?,
    )
    .map_err(|err| format!("Bundled catalog manifest is invalid: {err}"))?;
    if target.exists() {
        let conn = Connection::open(target).map_err(|err| err.to_string())?;
        let revision = read_meta(&conn, "revision")?.unwrap_or_default();
        let generated_at = read_meta(&conn, "generated_at")?.unwrap_or_default();
        if revision == manifest.revision || manifest.generated_at.is_empty() || generated_at >= manifest.generated_at {
            return Ok(false);
        }
    }
    if manifest.schema_version != CACHE_SCHEMA_VERSION {
        return Err(format!(
            "Bundled catalog schema {} is unsupported; expected {}",
            manifest.schema_version, CACHE_SCHEMA_VERSION
        ));
    }
    let artifact_path = seed_dir.join(format!("catalog-cache-{}.sqlite.gz", manifest.revision));
    if !artifact_path.is_file() {
        return Ok(false);
    }

    let compressed = fs::read(&artifact_path)
        .map_err(|err| format!("Could not read bundled catalog seed: {err}"))?;
    let actual_sha = format!("{:x}", Sha256::digest(&compressed));
    if !actual_sha.eq_ignore_ascii_case(manifest.sha256.trim()) {
        return Err("Bundled catalog seed SHA-256 verification failed".into());
    }

    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut sqlite_bytes = Vec::new();
    decoder
        .read_to_end(&mut sqlite_bytes)
        .map_err(|err| format!("Could not decompress bundled catalog seed: {err}"))?;

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Could not create catalog cache directory: {err}"))?;
    }
    let next = target.with_extension("sqlite.next");
    fs::write(&next, sqlite_bytes)
        .map_err(|err| format!("Could not stage bundled catalog cache: {err}"))?;
    validate_database(&next, &manifest)?;
    if target.exists() {
        merge_baseline(target,&next,&manifest)?;
        let _=fs::remove_file(&next);
        return Ok(true);
    }
    let backup = target.with_extension("sqlite.bak");
    if target.exists() {
        fs::rename(target, &backup).map_err(|err| err.to_string())?;
    }
    if let Err(err) = fs::rename(&next, target) {
        if backup.exists() { let _ = fs::rename(&backup, target); }
        return Err(format!("Could not activate bundled catalog cache: {err}"));
    }
    if backup.exists() { let _ = fs::remove_file(&backup); }
    Ok(true)
}

fn ready_cache_db_path() -> Result<PathBuf, String> {
    let _guard = CATALOG_CACHE_SYNC_LOCK.get_or_init(|| Mutex::new(())).lock()
        .map_err(|_| "Catalog cache lock was poisoned".to_string())?;
    ready_cache_db_path_unlocked()
}

fn ready_cache_db_path_unlocked() -> Result<PathBuf, String> {
    let target = cache_db_path()?;
    reconcile_cache_sidecars(&target)?;
    let _ = install_bundled_seed(&target)?;
    Ok(target)
}

fn reconcile_cache_sidecars(target: &Path) -> Result<(), String> {
    let next = target.with_extension("sqlite.next");
    let backup = target.with_extension("sqlite.bak");

    if next.exists() {
        fs::remove_file(&next)
            .map_err(|err| format!("Could not remove stale catalog cache staging file: {err}"))?;
    }
    if target.exists() {
        if backup.exists() {
            fs::remove_file(&backup)
                .map_err(|err| format!("Could not remove stale catalog cache backup: {err}"))?;
        }
    } else if backup.exists() {
        fs::rename(&backup, target)
            .map_err(|err| format!("Could not restore catalog cache backup: {err}"))?;
    }
    Ok(())
}

fn validate_github_https_url(raw: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(raw).map_err(|err| format!("Invalid catalog URL: {err}"))?;
    let loopback = matches!(parsed.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
    if parsed.scheme() != "https" && !(parsed.scheme() == "http" && loopback) {
        return Err("Catalog update URLs must use HTTPS (or local development HTTP)".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Catalog URLs cannot contain credentials".into());
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

fn incoming_snapshot_older(current: &str, incoming: &str) -> bool {
    match (chrono::DateTime::parse_from_rfc3339(current), chrono::DateTime::parse_from_rfc3339(incoming)) {
        (Ok(current), Ok(incoming)) => incoming < current,
        _ => false,
    }
}


#[derive(Deserialize)]
struct DetailChange { game_id: i64, #[serde(default)] app_id: Option<i64>, language: String, country: String, payload: Value }
#[derive(Deserialize)]
struct CatalogBatch {
    schema_version: u32, base_revision: String, revision: String,
    games: Vec<Value>, details: Vec<DetailChange>,
}

// Unknown/empty fields from a partial feed must never erase known metadata.
fn merge_metadata(previous: &mut Value, incoming: Value) {
    match (previous, incoming) {
        (Value::Object(previous), Value::Object(incoming)) => {
            for (key, value) in incoming {
                merge_metadata(previous.entry(key).or_insert(Value::Null), value);
            }
        }
        (_, Value::Null) => {}
        (_, Value::String(value)) if value.trim().is_empty() => {}
        (_, Value::Array(value)) if value.is_empty() => {}
        (previous, incoming) => *previous = incoming,
    }
}

fn apply_batch(target: &Path, games: Vec<Value>, details: Vec<DetailChange>,
               manifest: &CatalogManifest) -> Result<usize, String> {
    let mut conn = Connection::open(target).map_err(|e|e.to_string())?;
    let tx = conn.transaction().map_err(|e|e.to_string())?;
    let mut ids = std::collections::HashMap::new();
    for mut game in games {
        let incoming_id = game["id"].as_i64().ok_or("Catalog game has no id")?;
        let app_id = game["app_id"].as_i64();
        let existing = tx.query_row(
            "SELECT id,payload FROM catalog_game WHERE (?1 IS NOT NULL AND app_id=?1) OR (?1 IS NULL AND id=?2) LIMIT 1",
            params![app_id,incoming_id], |row|Ok((row.get::<_,i64>(0)?,row.get::<_,String>(1)?)));
        let (id, payload) = match existing {
            Ok((id, payload)) => {
                let mut previous: Value = serde_json::from_str(&payload).map_err(|e|e.to_string())?;
                merge_metadata(&mut previous,game);
                (id,previous)
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {
                let occupied: bool = tx.query_row("SELECT EXISTS(SELECT 1 FROM catalog_game WHERE id=?1)",
                    [incoming_id], |r|r.get(0)).map_err(|e|e.to_string())?;
                let id = if occupied {tx.query_row("SELECT COALESCE(MAX(id),0)+1 FROM catalog_game",[],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())?} else {incoming_id};
                (id,game.take())
            }
            Err(e) => return Err(e.to_string()),
        };
        ids.insert(incoming_id,id);
        let mut payload = payload;
        payload["id"] = Value::from(id);
        tx.execute("INSERT INTO catalog_game(id,app_id,payload) VALUES(?1,?2,?3)
                    ON CONFLICT(id) DO UPDATE SET app_id=excluded.app_id,payload=excluded.payload",
            params![id,app_id,payload.to_string()]).map_err(|e|e.to_string())?;
    }
    for detail in details {
        let id = match detail.app_id {
            Some(app_id) => tx.query_row("SELECT id FROM catalog_game WHERE app_id=?1 LIMIT 1",[app_id],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())?,
            None => ids.get(&detail.game_id).copied().unwrap_or(detail.game_id),
        };
        let mut payload = detail.payload;
        match tx.query_row("SELECT payload FROM game_detail WHERE game_id=?1 AND language=?2 AND country=?3",
            params![id,detail.language,detail.country], |r|r.get::<_,String>(0)) {
            Ok(previous) => {
                let mut previous: Value = serde_json::from_str(&previous).map_err(|e|e.to_string())?;
                merge_metadata(&mut previous,payload); payload=previous;
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => {}
            Err(e) => return Err(e.to_string()),
        }
        tx.execute("INSERT INTO game_detail(game_id,language,country,payload) VALUES(?1,?2,?3,?4)
                    ON CONFLICT(game_id,language,country) DO UPDATE SET payload=excluded.payload",
            params![id,detail.language,detail.country,payload.to_string()]).map_err(|e|e.to_string())?;
    }
    let count: usize = tx.query_row("SELECT COUNT(*) FROM catalog_game",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    for (key,value) in [("revision",manifest.revision.clone()),("generated_at",manifest.generated_at.clone()),("catalog_count",count.to_string())] {
        tx.execute("INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value]).map_err(|e|e.to_string())?;
    }
    tx.commit().map_err(|e|e.to_string())?;
    Ok(count)
}

fn merge_baseline(target: &Path, incoming: &Path, manifest: &CatalogManifest) -> Result<usize,String> {
    let conn=Connection::open(incoming).map_err(|e|e.to_string())?;
    let games = conn.prepare("SELECT payload FROM catalog_game").map_err(|e|e.to_string())?
        .query_map([],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?
        .map(|row| serde_json::from_str(&row.map_err(|e|e.to_string())?).map_err(|e|e.to_string()))
        .collect::<Result<Vec<Value>,String>>()?;
    let details = conn.prepare("SELECT game_id,language,country,payload FROM game_detail").map_err(|e|e.to_string())?
        .query_map([],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(|e|e.to_string())?
        .map(|row| {let (game_id,language,country,payload)=row.map_err(|e|e.to_string())?;
            Ok(DetailChange{game_id,app_id:None,language,country,payload:serde_json::from_str(&payload).map_err(|e|e.to_string())?})})
        .collect::<Result<Vec<_>,String>>()?;
    apply_batch(target,games,details,manifest)
}


fn catalog_identities(path: &Path) -> Result<Vec<i64>,String> {
    let db=Connection::open(path).map_err(|e|e.to_string())?;
    let mut query=db.prepare("SELECT COALESCE(app_id,id) FROM catalog_game ORDER BY COALESCE(app_id,id)").map_err(|e|e.to_string())?;
    let rows=query.query_map([],|r|r.get::<_,i64>(0)).map_err(|e|e.to_string())?;
    rows.map(|r|r.map_err(|e|e.to_string())).collect()
}
fn reconcile_missing(client: &Client, manifest_url: &str, target: &Path, manifest: &CatalogManifest) -> Result<usize,String> {
    let present=catalog_identities(target)?;
    let hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&present).map_err(|e|e.to_string())?));
    if manifest.inventory_sha256.is_empty() || hash == manifest.inventory_sha256 {
        return Ok(present.len());
    }
    let mut url=reqwest::Url::parse(manifest_url).map_err(|e|e.to_string())?;
    if url.path() != "/library/catalog/manifest" { return Ok(present.len()); }
    url.set_path("/library/catalog/reconcile"); url.set_query(None);
    let base=current_cache_info(target)?.ok_or("Missing catalog baseline")?.0;
    let response=client.post(url).json(&serde_json::json!({"present":present,"base_revision":base}))
        .send().and_then(|r|r.error_for_status()).map_err(|e|e.to_string())?;
    let expected=response.headers().get("X-Catalog-SHA256").and_then(|v|v.to_str().ok()).ok_or("Catalog repair has no checksum")?.to_string();
    let compressed=response.bytes().map_err(|e|e.to_string())?;
    if compressed.len()>MAX_COMPRESSED_BYTES || format!("{:x}",Sha256::digest(&compressed)) != expected {
        return Err("Catalog repair checksum failed".into());
    }
    let batch:CatalogBatch=serde_json::from_reader(GzDecoder::new(compressed.as_ref())).map_err(|e|e.to_string())?;
    if batch.schema_version!=CACHE_SCHEMA_VERSION || batch.base_revision!=base || batch.revision!=manifest.revision {
        return Err("Catalog repair revision mismatch".into());
    }
    let added=batch.games.len();
    let count=apply_batch(target,batch.games,batch.details,manifest)?;
    let _=crate::append_narration_lines(vec![format!("Catalog inventory reconciled: {added} missing game(s) restored; {count} retained")],"CATALOG".into(),"INFO".into());
    Ok(count)
}

fn sync_blocking(manifest_url: String) -> Result<CatalogCacheSyncResult, String> {
    let _sync_guard = CATALOG_CACHE_SYNC_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Catalog cache synchronization lock was poisoned".to_string())?;
    validate_github_https_url(&manifest_url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|err| format!("Could not create catalog cache client: {err}"))?;
    let target = ready_cache_db_path_unlocked()?;
    let mut manifest_request = reqwest::Url::parse(&manifest_url).map_err(|e|e.to_string())?;
    if manifest_request.path() == "/library/catalog/manifest" {
        if let Some((revision,_)) = current_cache_info(&target)? {
            manifest_request.query_pairs_mut().append_pair("since",&revision);
        }
    }
    let manifest = client
        .get(manifest_request)
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

    if let Some((revision, count)) = current_cache_info(&target)? {
        let conn = Connection::open(&target).map_err(|err| err.to_string())?;
        let generated_at = read_meta(&conn, "generated_at")?.unwrap_or_default();
        if revision == manifest.revision || incoming_snapshot_older(&generated_at, &manifest.generated_at)
            || (manifest.generated_at.is_empty() && manifest.catalog_count < count) {
            return Ok(CatalogCacheSyncResult {
                updated: false,
                revision: revision.clone(),
                catalog_count: if revision == manifest.revision { reconcile_missing(&client,&manifest_url,&target,&manifest)? } else {count},
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

    if manifest.kind == "delta" {
        let batch: CatalogBatch=serde_json::from_slice(&sqlite_bytes).map_err(|e|e.to_string())?;
        let current = current_cache_info(&target)?.ok_or("A baseline is required before applying catalog updates")?;
        if batch.schema_version != CACHE_SCHEMA_VERSION || batch.revision != manifest.revision
            || batch.base_revision != manifest.base_revision || batch.base_revision != current.0 {
            return Err("Catalog update does not match the installed revision".into());
        }
        let _=apply_batch(&target,batch.games,batch.details,&manifest)?;
        let count=reconcile_missing(&client,&manifest_url,&target,&manifest)?;
        return Ok(CatalogCacheSyncResult{updated:true,revision:manifest.revision,catalog_count:count});
    }
    let next = target.with_extension("sqlite.next");
    let backup = target.with_extension("sqlite.bak");
    fs::write(&next, sqlite_bytes).map_err(|err| format!("Could not write catalog cache: {err}"))?;
    validate_database(&next, &manifest)?;
    if target.exists() {
        let _ = merge_baseline(&target,&next,&manifest)?;
        let _=fs::remove_file(&next);
        let count=reconcile_missing(&client,&manifest_url,&target,&manifest)?;
        return Ok(CatalogCacheSyncResult{updated:true,revision:manifest.revision,catalog_count:count});
    }

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
    tauri::async_runtime::spawn_blocking(move || {
        sync_blocking(manifest_url)
    })
        .await
        .map_err(|err| format!("Catalog cache sync task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_read() -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = ready_cache_db_path()?;
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
        let path = ready_cache_db_path()?;
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
        let path = ready_cache_db_path()?;
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
        let path = ready_cache_db_path()?;
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


#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_target() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = env::temp_dir().join(format!(
            "gameaccess-catalog-cache-test-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&root).unwrap();
        root.join("catalog.sqlite")
    }


    #[test]
    fn catalog_batch_preserves_missing_games_and_rich_local_details() {
        let target=temp_target();
        let db=Connection::open(&target).unwrap();
        db.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY,app_id INTEGER,payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER,language TEXT,country TEXT,payload TEXT,PRIMARY KEY(game_id,language,country));").unwrap();
        db.execute("INSERT INTO catalog_game VALUES(7,233980,?1)",[r#"{"id":7,"app_id":233980,"name":"Unepic","short_description":"Known description","tags":["RPG"]}"#]).unwrap();
        db.execute("INSERT INTO catalog_game VALUES(8,10,?1)",[r#"{"id":8,"app_id":10,"name":"Retained"}"#]).unwrap();
        db.execute("INSERT INTO game_detail VALUES(7,'spanish','ar',?1)",[r#"{"steam":{"screenshots":[{"id":1}],"short_description":"Known description"}}"#]).unwrap();
        drop(db);
        let manifest=CatalogManifest{schema_version:1,revision:"new".into(),artifact_url:String::new(),sha256:String::new(),catalog_count:1,generated_at:String::new(),kind:"delta".into(),base_revision:"old".into(),inventory_sha256:String::new()};
        let count=apply_batch(&target,vec![serde_json::json!({"id":99,"app_id":233980,"short_description":"","tags":[],"steam_review_score":95})],
            vec![DetailChange{game_id:99,app_id:Some(233980),language:"spanish".into(),country:"ar".into(),payload:serde_json::json!({"steam":{"screenshots":[],"short_description":null}})}],&manifest).unwrap();
        assert_eq!(count,2);
        let db=Connection::open(&target).unwrap();
        let payload:String=db.query_row("SELECT payload FROM catalog_game WHERE id=7",[],|r|r.get(0)).unwrap();
        let game:Value=serde_json::from_str(&payload).unwrap();
        assert_eq!(game["short_description"],"Known description");
        assert_eq!(game["steam_review_score"],95);
        assert_eq!(game["tags"],serde_json::json!(["RPG"]));
        let detail:String=db.query_row("SELECT payload FROM game_detail WHERE game_id=7",[],|r|r.get(0)).unwrap();
        assert!(detail.contains("Known description"));
        assert!(detail.contains("screenshots"));
        drop(db);
        let _=fs::remove_dir_all(target.parent().unwrap());
    }
    #[test]
    fn older_remote_snapshot_cannot_replace_the_installer_catalog() {
        assert!(incoming_snapshot_older("2026-10-10T14:07:48+00:00", "2026-10-09T18:00:00Z"));
        assert!(!incoming_snapshot_older("2026-10-10T14:07:48+00:00", "2026-10-11T00:00:00Z"));
        assert!(!incoming_snapshot_older("2026-10-10T14:07:48+00:00", ""));
    }
    #[test]
    fn stale_next_and_backup_are_removed_when_target_exists() {
        let target = temp_target();
        let next = target.with_extension("sqlite.next");
        let backup = target.with_extension("sqlite.bak");
        fs::write(&target, b"current").unwrap();
        fs::write(&next, b"partial").unwrap();
        fs::write(&backup, b"old").unwrap();

        reconcile_cache_sidecars(&target).unwrap();

        assert!(target.is_file());
        assert!(!next.exists());
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn backup_is_restored_when_target_is_missing() {
        let target = temp_target();
        let backup = target.with_extension("sqlite.bak");
        fs::write(&backup, b"recoverable").unwrap();

        reconcile_cache_sidecars(&target).unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"recoverable");
        assert!(!backup.exists());
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }
}
