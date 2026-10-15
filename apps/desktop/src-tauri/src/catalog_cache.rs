use flate2::read::GzDecoder;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, CACHE_CONTROL, USER_AGENT};
use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, ToSql};
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
static CATALOG_SESSION_CONN: Mutex<Option<Connection>> = Mutex::new(None);

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
        if let Ok(mut guard) = CATALOG_SESSION_CONN.lock() {
            *guard = None;
        }
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

/// Refill the searchable tables from the payloads that just changed.
///
/// `game_genre`, `game_category` and `game_tag` are derived from the payload, but
/// the delta path only wrote `catalog_game`. A refresh that corrected the genre
/// vocabulary therefore reached the payload and not the tables the search and the
/// facets read, so the client kept serving the previous values. Rows are replaced
/// rather than merged, because the incoming list is the whole answer for that
/// game and a merge would keep values that were removed upstream.
fn refresh_normalized_rows(tx: &rusqlite::Transaction<'_>, touched: &[(i64, String)]) -> Result<(), String> {
    let mut del_genre = tx.prepare("DELETE FROM game_genre WHERE game_id=?1").map_err(|e|e.to_string())?;
    let mut del_category = tx.prepare("DELETE FROM game_category WHERE game_id=?1").map_err(|e|e.to_string())?;
    let mut del_tag = tx.prepare("DELETE FROM game_tag WHERE game_id=?1").map_err(|e|e.to_string())?;
    let mut ins_genre = tx.prepare("INSERT OR IGNORE INTO game_genre(game_id, name) VALUES (?1, ?2)").map_err(|e|e.to_string())?;
    let mut ins_category = tx.prepare("INSERT OR IGNORE INTO game_category(game_id, name) VALUES (?1, ?2)").map_err(|e|e.to_string())?;
    let mut ins_tag = tx.prepare("INSERT OR IGNORE INTO game_tag(game_id, name) VALUES (?1, ?2)").map_err(|e|e.to_string())?;
    for (id, payload) in touched {
        let Ok(game) = serde_json::from_str::<Value>(payload) else { continue };
        let _ = del_genre.execute(params![id]);
        let _ = del_category.execute(params![id]);
        let _ = del_tag.execute(params![id]);
        for (field, statement) in [("genres", &mut ins_genre), ("categories", &mut ins_category), ("tags", &mut ins_tag)] {
            let Some(values) = game.get(field).and_then(Value::as_array) else { continue };
            for value in values {
                if let Some(text) = value.as_str() {
                    if !text.trim().is_empty() {
                        let _ = statement.execute(params![id, text.trim()]);
                    }
                }
            }
        }
    }
    Ok(())
}

fn apply_batch(target: &Path, games: Vec<Value>, details: Vec<DetailChange>,
                manifest: &CatalogManifest) -> Result<usize, String> {
    let mut conn = Connection::open(target).map_err(|e|e.to_string())?;
    ensure_normalized_schema(&conn)?;
    let tx = conn.transaction().map_err(|e|e.to_string())?;
    let mut ids = std::collections::HashMap::new();
    // Games whose payload changed, so their normalized rows can be refilled from
    // it. Without this the payload updates and the searchable tables do not: a
    // refresh that added genres left `game_genre` holding the previous values.
    let mut touched: Vec<(i64, String)> = Vec::new();
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
        let serialized = payload.to_string();
        tx.execute("INSERT INTO catalog_game(id,app_id,payload) VALUES(?1,?2,?3)
                    ON CONFLICT(id) DO UPDATE SET app_id=excluded.app_id,payload=excluded.payload",
            params![id,app_id,serialized.clone()]).map_err(|e|e.to_string())?;
        touched.push((id, serialized));
    }
    refresh_normalized_rows(&tx, &touched)?;
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
        let steam = payload.get("steam").unwrap_or(&payload);
        let short_d = steam.get("short_description").and_then(Value::as_str);
        let detailed_d = steam.get("detailed_description").and_then(Value::as_str);
        let about_d = steam.get("about_the_game").and_then(Value::as_str);
        let _ = tx.execute(
            "INSERT INTO game_description(game_id, language, short_description, detailed_description, about_the_game)
             VALUES(?1, lower(?2), ?3, ?4, ?5)
             ON CONFLICT(game_id, language) DO UPDATE SET
             short_description=excluded.short_description, detailed_description=excluded.detailed_description, about_the_game=excluded.about_the_game",
            params![id, detail.language, short_d, detailed_d, about_d]
        );
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
    let _=crate::activity_log::append_narration_lines(vec![format!("Catalog inventory reconciled: {added} missing game(s) restored; {count} retained")],"CATALOG".into(),"INFO".into());
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
        if let Ok(mut guard) = CATALOG_SESSION_CONN.lock() {
            *guard = None;
        }
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

/// Only id, app id and name of every game: enough to match titles without loading whole records.
#[tauri::command]
pub async fn catalog_cache_read_names() -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = ready_cache_db_path()?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let _ = ensure_normalized_schema(&conn);
        let mut statement = conn
            .prepare("SELECT id, app_id, name FROM game ORDER BY id")
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, String>(2)?)))
            .map_err(|err| err.to_string())?;
        let mut games = Vec::new();
        for row in rows {
            let (id, app_id, name) = row.map_err(|err| err.to_string())?;
            games.push(serde_json::json!({ "id": id, "app_id": app_id, "name": name }));
        }
        Ok(games)
    })
    .await
    .map_err(|err| format!("Catalog names task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_read(language: Option<String>) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = ready_cache_db_path()?;
        if !path.exists() {
            return Ok(Vec::new());
        }
        let conn = Connection::open(path).map_err(|err| err.to_string())?;
        let _ = ensure_normalized_schema(&conn);
        let lang = language.as_deref().unwrap_or("spanish").to_lowercase();
        let mut statement = conn
            .prepare(
                "SELECT cg.id, cg.payload, COALESCE(gd.short_description, gd_def.short_description, m.short_description)
                 FROM catalog_game cg
                 LEFT JOIN game_metadata m ON m.game_id = cg.id
                 LEFT JOIN game_description gd ON gd.game_id = cg.id AND lower(gd.language) = ?1
                 LEFT JOIN game_description gd_def ON gd_def.game_id = cg.id AND lower(gd_def.language) = 'spanish'
                 ORDER BY cg.id"
            )
            .map_err(|err| err.to_string())?;
        let rows = statement
            .query_map(params![lang], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?))
            })
            .map_err(|err| err.to_string())?;
        let mut games = Vec::new();
        for row in rows {
            let (_id, payload, localized_desc) = row.map_err(|err| err.to_string())?;
            let mut val: Value = serde_json::from_str(&payload).unwrap_or(Value::Null);
            if let Some(desc) = localized_desc {
                if !desc.trim().is_empty() {
                    if let Value::Object(ref mut map) = val {
                        map.insert("short_description".to_string(), Value::String(desc));
                    }
                }
            }
            if !val.is_null() {
                games.push(val);
            }
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
        let lang = language.trim().to_lowercase();
        let ctry = country.trim().to_lowercase();
        let mut statement = conn
            .prepare(
                "SELECT payload FROM game_detail
                 WHERE (game_id=?1 OR game_id=(SELECT id FROM catalog_game WHERE app_id=?1 LIMIT 1) OR game_id=(SELECT app_id FROM catalog_game WHERE id=?1 LIMIT 1))
                 ORDER BY
                    CASE
                        WHEN lower(language) = ?2 AND lower(country) = ?3 THEN 0
                        WHEN lower(language) = ?2 THEN 1
                        WHEN lower(language) = 'spanish' AND lower(country) = 'ar' THEN 2
                        WHEN lower(language) = 'spanish' THEN 3
                        ELSE 4
                    END
                 LIMIT 1",
            )
            .map_err(|err| err.to_string())?;
        match statement.query_row(params![game_id, lang, ctry], |row| row.get::<_, String>(0)) {
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
        let _ = ensure_normalized_schema(&conn);
        let lang = language.trim().to_lowercase();
        let ctry = country.trim().to_lowercase();
        let payload = serde_json::to_string(&detail).map_err(|err| err.to_string())?;
        conn.execute(
            "INSERT INTO game_detail(game_id, language, country, payload)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(game_id, language, country)
             DO UPDATE SET payload=excluded.payload",
            params![game_id, lang, ctry, payload],
        )
        .map_err(|err| err.to_string())?;

        let steam = detail.get("steam").unwrap_or(&detail);
        let short_d = steam.get("short_description").and_then(Value::as_str);
        let detailed_d = steam.get("detailed_description").and_then(Value::as_str);
        let about_d = steam.get("about_the_game").and_then(Value::as_str);
        let _ = conn.execute(
            "INSERT INTO game_description(game_id, language, short_description, detailed_description, about_the_game)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(game_id, language)
             DO UPDATE SET short_description=excluded.short_description, detailed_description=excluded.detailed_description, about_the_game=excluded.about_the_game",
            params![game_id, lang, short_d, detailed_d, about_d],
        );
        Ok(())
    })
    .await
    .map_err(|err| format!("Catalog detail cache write task failed: {err}"))?
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct CatalogQueryParams {
    pub query: Option<String>,
    pub genres: Option<Vec<String>>,
    pub features: Option<Vec<String>>,
    pub sources: Option<Vec<String>>,
    pub has_downloads: Option<bool>,
    pub language: Option<String>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub min_rating: Option<f32>,
    pub max_age_days: Option<i64>,
    pub include_recent_unrated: Option<bool>,
    pub app_ids: Option<Vec<i64>>,
    /// Exact genre names (as stored in game_genre) a game must not carry.
    pub exclude_genres: Option<Vec<String>>,
    /// Features a game must not have (same keys as `features`).
    pub exclude_features: Option<Vec<String>>,
    /// Download sources a game must not be offered by.
    pub exclude_sources: Option<Vec<String>>,
    /// Valve content descriptors: at least one required.
    pub content_descriptor_ids: Option<Vec<i64>>,
    /// Valve content descriptors: none allowed.
    pub exclude_content_descriptor_ids: Option<Vec<i64>>,
    /// Hide adult-only games (server verdict, descriptors 3/4, and 1 when `adult_includes_nudity`).
    pub hide_adult: Option<bool>,
    pub adult_includes_nudity: Option<bool>,
    /// Release year bounds (inclusive).
    pub release_year_from: Option<i64>,
    pub release_year_to: Option<i64>,
    /// Catalog ids (not Steam app ids): likes and recently opened games are stored this way.
    pub game_ids: Option<Vec<i64>>,
}

const MULTIPLAYER_CATEGORY_SQL: &str = "EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Multi-player','Multijugador','Co-op','Cooperativo','PvP','JcJ','Online PvP','JcJ en línea','Online Co-op','Cooperativo en línea','Shared/Split Screen','Shared/Split Screen Co-op','LAN Co-op','MMO','Multijugador masivo','Cross-Platform Multiplayer','Multijugador multiplataforma'))";

/// SQL condition for one library feature key, or None for keys the query does not know.
fn feature_clause(feat: &str) -> Option<String> {
    Some(match feat {
        "has_downloads" => "EXISTS (SELECT 1 FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id)".to_string(),
        "single_player" => "m.single_player = 1".to_string(),
        "multiplayer" => format!("(m.multiplayer = 1 OR {})", MULTIPLAYER_CATEGORY_SQL),
        "coop" => "(m.coop = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Co-op','Cooperativo','Online Co-op','Cooperativo en línea','LAN Co-op','Shared/Split Screen Co-op')))".to_string(),
        "online_coop" => "m.online_coop = 1".to_string(),
        "local_coop" => "m.local_coop = 1".to_string(),
        "shared_split_screen" => "m.shared_split_screen = 1".to_string(),
        "mmo" => "m.mmo = 1".to_string(),
        "pvp" => "(m.pvp = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('PvP','JcJ','Online PvP','JcJ en línea')))".to_string(),
        "pve" => "m.pve = 1".to_string(),
        "lan" => "m.lan = 1".to_string(),
        "cross_platform" => "m.cross_platform = 1".to_string(),
        _ => return None,
    })
}

/// Pushes `values` as numbered parameters and returns "?1,?2,…".
fn push_placeholders<T: Clone>(sql_params: &mut Vec<SqlValue>, values: &[T], to_sql: impl Fn(T) -> SqlValue) -> String {
    let mut out = Vec::new();
    for v in values {
        out.push(format!("?{}", sql_params.len() + 1));
        sql_params.push(to_sql(v.clone()));
    }
    out.join(",")
}

/// Valve content descriptors live in the game payload as `content_descriptorids`.
fn descriptor_exists_sql(list: &str) -> String {
    format!("EXISTS (SELECT 1 FROM catalog_game cdg, json_each(CASE WHEN json_valid(cdg.payload) THEN cdg.payload ELSE '{{}}' END, '$.content_descriptorids') cd WHERE cdg.id = g.id AND cd.value IN ({}))", list)
}

#[derive(Debug, Serialize)]
pub struct CatalogQueryResult {
    pub items: Vec<Value>,
    pub total: usize,
}

#[derive(Debug, Deserialize)]
pub struct TempSourceItem {
    pub app_id: i64,
    pub source_names: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct CatalogFacetsResult {
    pub genres: Vec<String>,
}

pub fn normalize_release_date(raw: &str) -> Option<String> {
    let s = raw.trim();
    if s.is_empty() {
        return None;
    }
    if s.len() >= 10 {
        let b = s.as_bytes();
        if b[0].is_ascii_digit() && b[1].is_ascii_digit() && b[2].is_ascii_digit() && b[3].is_ascii_digit()
            && b[4] == b'-' && b[5].is_ascii_digit() && b[6].is_ascii_digit()
            && b[7] == b'-' && b[8].is_ascii_digit() && b[9].is_ascii_digit()
        {
            return Some(s[..10].to_string());
        }
    }
    let parts: Vec<&str> = s.split_whitespace().collect();
    if parts.len() == 3 {
        if let (Ok(day), Ok(year)) = (parts[0].parse::<u32>(), parts[2].parse::<i32>()) {
            let mon_str = parts[1].to_lowercase();
            let month = match mon_str.chars().take(3).collect::<String>().as_str() {
                "ene" | "jan" => Some(1),
                "feb" | "fev" => Some(2),
                "mar" => Some(3),
                "abr" | "apr" => Some(4),
                "may" | "mai" => Some(5),
                "jun" => Some(6),
                "jul" => Some(7),
                "ago" | "aug" => Some(8),
                "sep" | "set" => Some(9),
                "oct" | "out" => Some(10),
                "nov" => Some(11),
                "dic" | "dec" | "dez" => Some(12),
                _ => None,
            };
            if let Some(m) = month {
                return Some(format!("{:04}-{:02}-{:02}", year, m, day));
            }
        }
    }
    None
}

pub fn ensure_normalized_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS game (
            id INTEGER PRIMARY KEY,
            app_id INTEGER,
            slug TEXT,
            name TEXT NOT NULL,
            credit_cost_per_hour INTEGER DEFAULT 0,
            active INTEGER DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS ix_game_app_id ON game(app_id);
        CREATE INDEX IF NOT EXISTS ix_game_name ON game(name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS game_metadata (
            game_id INTEGER PRIMARY KEY REFERENCES game(id) ON DELETE CASCADE,
            release_date TEXT,
            recommendation_count INTEGER,
            steam_review_score REAL,
            steam_review_count INTEGER,
            metacritic_score INTEGER,
            single_player INTEGER DEFAULT 0,
            multiplayer INTEGER DEFAULT 0,
            coop INTEGER DEFAULT 0,
            online_coop INTEGER DEFAULT 0,
            local_coop INTEGER DEFAULT 0,
            shared_split_screen INTEGER DEFAULT 0,
            mmo INTEGER DEFAULT 0,
            pvp INTEGER DEFAULT 0,
            pve INTEGER DEFAULT 0,
            lan INTEGER DEFAULT 0,
            cross_platform INTEGER DEFAULT 0,
            header_image TEXT,
            capsule_image TEXT,
            hero_image TEXT,
            steam_url TEXT,
            short_description TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_gm_score ON game_metadata(steam_review_score);
        CREATE INDEX IF NOT EXISTS ix_gm_recommendation ON game_metadata(recommendation_count);
        CREATE INDEX IF NOT EXISTS ix_gm_review_count ON game_metadata(steam_review_count);
        CREATE INDEX IF NOT EXISTS ix_gm_release_date ON game_metadata(release_date);

        CREATE TABLE IF NOT EXISTS game_genre (
            game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            PRIMARY KEY (game_id, name)
        );
        CREATE INDEX IF NOT EXISTS ix_game_genre_name ON game_genre(name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS game_tag (
            game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            PRIMARY KEY (game_id, name)
        );
        CREATE INDEX IF NOT EXISTS ix_game_tag_name ON game_tag(name COLLATE NOCASE);

        CREATE TABLE IF NOT EXISTS game_category (
            game_id INTEGER NOT NULL REFERENCES game(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            PRIMARY KEY (game_id, name)
        );

        CREATE TABLE IF NOT EXISTS game_description (
            game_id INTEGER NOT NULL,
            language TEXT NOT NULL,
            short_description TEXT,
            detailed_description TEXT,
            about_the_game TEXT,
            PRIMARY KEY (game_id, language)
        );
        CREATE INDEX IF NOT EXISTS ix_game_desc_lang ON game_description(language);

        CREATE TEMP TABLE IF NOT EXISTS temp_plugin_availability (
            app_id INTEGER NOT NULL,
            source_name TEXT NOT NULL,
            PRIMARY KEY (app_id, source_name)
        );
        CREATE INDEX IF NOT EXISTS ix_temp_plugin_app_id ON temp_plugin_availability(app_id);
        CREATE INDEX IF NOT EXISTS ix_temp_plugin_source ON temp_plugin_availability(source_name);"
    ).map_err(|e| e.to_string())?;

    let has_catalog_game: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='catalog_game')",
        [], |r| r.get(0)
    ).unwrap_or(false);

    if has_catalog_game {
        let game_count: i64 = conn.query_row("SELECT COUNT(*) FROM game", [], |r| r.get(0)).unwrap_or(0);
        let catalog_count: i64 = conn.query_row("SELECT COUNT(*) FROM catalog_game", [], |r| r.get(0)).unwrap_or(0);
        if game_count == 0 && catalog_count > 0 {
            let mut statement = conn.prepare("SELECT id, app_id, payload FROM catalog_game").map_err(|e| e.to_string())?;
            let rows = statement.query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, String>(2)?))
            }).map_err(|e| e.to_string())?;

            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            {
                let mut ins_game = tx.prepare("INSERT OR IGNORE INTO game(id, app_id, slug, name, credit_cost_per_hour, active) VALUES (?1, ?2, ?3, ?4, ?5, 1)").map_err(|e| e.to_string())?;
                let mut ins_meta = tx.prepare("INSERT OR REPLACE INTO game_metadata(game_id, release_date, recommendation_count, steam_review_score, steam_review_count, metacritic_score, single_player, multiplayer, coop, online_coop, local_coop, shared_split_screen, mmo, pvp, pve, lan, cross_platform, header_image, capsule_image, hero_image, steam_url, short_description) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)").map_err(|e| e.to_string())?;
                let mut ins_genre = tx.prepare("INSERT OR IGNORE INTO game_genre(game_id, name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;
                let mut ins_tag = tx.prepare("INSERT OR IGNORE INTO game_tag(game_id, name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;
                let mut ins_cat = tx.prepare("INSERT OR IGNORE INTO game_category(game_id, name) VALUES (?1, ?2)").map_err(|e| e.to_string())?;
                let mut ins_desc = tx.prepare("INSERT OR REPLACE INTO game_description(game_id, language, short_description, detailed_description, about_the_game) VALUES (?1, 'spanish', ?2, NULL, NULL)").map_err(|e| e.to_string())?;

                for row in rows {
                    let (gid, app_id, payload_str) = row.map_err(|e| e.to_string())?;
                    if let Ok(g) = serde_json::from_str::<Value>(&payload_str) {
                        let name = g.get("name").and_then(Value::as_str).unwrap_or("");
                        let slug = g.get("slug").and_then(Value::as_str).unwrap_or("");
                        let cost = g.get("credit_cost_per_hour").and_then(Value::as_i64).unwrap_or(0);
                        let _ = ins_game.execute(params![gid, app_id, slug, name, cost]);

                        let rel_date = g.get("release_date").and_then(Value::as_str);
                        let rec_count = g.get("recommendation_count").and_then(Value::as_i64);
                        let rev_score = g.get("steam_review_score").and_then(Value::as_f64);
                        let rev_count = g.get("steam_review_count").and_then(Value::as_i64);
                        let meta_score = g.get("metacritic_score").and_then(Value::as_i64);

                        let sp = if g.get("single_player").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let mp = if g.get("multiplayer").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let coop = if g.get("coop").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let o_coop = if g.get("online_coop").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let l_coop = if g.get("local_coop").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let split = if g.get("shared_split_screen").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let mmo = if g.get("mmo").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let pvp = if g.get("pvp").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let pve = if g.get("pve").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let lan = if g.get("lan").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };
                        let cross = if g.get("cross_platform").and_then(Value::as_bool) == Some(true) { 1 } else { 0 };

                        let header = g.get("header_image").and_then(Value::as_str);
                        let capsule = g.get("capsule_image").and_then(Value::as_str);
                        let hero = g.get("hero_image").and_then(Value::as_str);
                        let steam_url = g.get("steam_url").and_then(Value::as_str);
                        let short_desc = g.get("short_description").and_then(Value::as_str);

                        let norm_date = rel_date.and_then(normalize_release_date);
                        let rel_date_ref = norm_date.as_deref().or(rel_date);
                        let _ = ins_meta.execute(params![
                            gid, rel_date_ref, rec_count, rev_score, rev_count, meta_score,
                            sp, mp, coop, o_coop, l_coop, split, mmo, pvp, pve, lan, cross,
                            header, capsule, hero, steam_url, short_desc
                        ]);

                        if let Some(desc) = short_desc {
                            if !desc.trim().is_empty() {
                                let _ = ins_desc.execute(params![gid, desc]);
                            }
                        }

                        if let Some(genres) = g.get("genres").and_then(Value::as_array) {
                            for item in genres {
                                if let Some(s) = item.as_str() {
                                    if !s.trim().is_empty() {
                                        let _ = ins_genre.execute(params![gid, s.trim()]);
                                    }
                                }
                            }
                        }
                        if let Some(tags) = g.get("tags").and_then(Value::as_array) {
                            for item in tags {
                                if let Some(s) = item.as_str() {
                                    if !s.trim().is_empty() {
                                        let _ = ins_tag.execute(params![gid, s.trim()]);
                                    }
                                }
                            }
                        }
                        if let Some(categories) = g.get("categories").and_then(Value::as_array) {
                            for item in categories {
                                if let Some(s) = item.as_str() {
                                    if !s.trim().is_empty() {
                                        let _ = ins_cat.execute(params![gid, s.trim()]);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
        }
    }

    let desc_count: i64 = conn.query_row("SELECT COUNT(*) FROM game_description", [], |r| r.get(0)).unwrap_or(0);
    if desc_count == 0 {
        let has_detail: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_detail')",
            [], |r| r.get(0)
        ).unwrap_or(false);
        if has_detail {
            if let Ok(mut stmt) = conn.prepare("SELECT game_id, language, payload FROM game_detail") {
                if let Ok(detail_rows) = stmt.query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
                }) {
                    if let Ok(tx) = conn.unchecked_transaction() {
                        if let Ok(mut ins) = tx.prepare("INSERT OR REPLACE INTO game_description(game_id, language, short_description, detailed_description, about_the_game) VALUES (?1, lower(?2), ?3, ?4, ?5)") {
                            for row in detail_rows.flatten() {
                                let (gid, lang, payload_str) = row;
                                if let Ok(val) = serde_json::from_str::<Value>(&payload_str) {
                                    let steam = val.get("steam").unwrap_or(&val);
                                    let short_d = steam.get("short_description").and_then(Value::as_str);
                                    let detailed_d = steam.get("detailed_description").and_then(Value::as_str);
                                    let about_d = steam.get("about_the_game").and_then(Value::as_str);
                                    let _ = ins.execute(params![gid, lang, short_d, detailed_d, about_d]);
                                }
                            }
                        }
                        let _ = tx.commit();
                    }
                }
            }
        }
        let _ = conn.execute(
            "INSERT OR IGNORE INTO game_description(game_id, language, short_description)
             SELECT game_id, 'spanish', short_description FROM game_metadata WHERE short_description IS NOT NULL AND trim(short_description) != ''",
            [],
        );
    }
    Ok(())
}

fn with_catalog_conn<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut Connection) -> Result<R, String>,
{
    let mut guard = CATALOG_SESSION_CONN
        .lock()
        .map_err(|_| "Catalog connection lock poisoned".to_string())?;
    if guard.is_none() {
        let path = ready_cache_db_path()?;
        let conn = Connection::open(&path).map_err(|err| err.to_string())?;
        let _ = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
        ensure_normalized_schema(&conn)?;
        *guard = Some(conn);
    }
    let conn = guard.as_mut().unwrap();
    f(conn)
}

#[tauri::command]
pub async fn catalog_cache_set_temp_sources(sources: Vec<TempSourceItem>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_catalog_conn(|conn| {
            let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM temp_plugin_availability", []).map_err(|e| e.to_string())?;
            {
                let mut stmt = tx.prepare_cached(
                    "INSERT OR IGNORE INTO temp_plugin_availability(app_id, source_name) VALUES (?1, ?2)"
                ).map_err(|e| e.to_string())?;
                for item in sources {
                    for name in item.source_names {
                        let trimmed = name.trim();
                        if !trimmed.is_empty() {
                            stmt.execute(params![item.app_id, trimmed]).map_err(|e| e.to_string())?;
                        }
                    }
                }
            }
            tx.commit().map_err(|e| e.to_string())?;
            Ok(())
        })
    })
    .await
    .map_err(|err| format!("Catalog temp sources task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_get_facets() -> Result<CatalogFacetsResult, String> {
    tauri::async_runtime::spawn_blocking(|| {
        with_catalog_conn(|conn| {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT name FROM game_genre ORDER BY name COLLATE NOCASE ASC"
            ).map_err(|e| e.to_string())?;
            let genres: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            Ok(CatalogFacetsResult { genres })
        })
    })
    .await
    .map_err(|err| format!("Catalog facets task failed: {err}"))?
}

pub fn query_catalog_conn(conn: &Connection, params: &CatalogQueryParams) -> Result<CatalogQueryResult, String> {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut sql_params: Vec<SqlValue> = Vec::new();

    if let Some(ref q) = params.query {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            for word in trimmed.split_whitespace() {
                let p_idx = sql_params.len() + 1;
                where_clauses.push(format!(
                    "(g.name LIKE ?{0} OR EXISTS (SELECT 1 FROM game_tag gt WHERE gt.game_id = g.id AND gt.name LIKE ?{0}))",
                    p_idx
                ));
                sql_params.push(SqlValue::Text(format!("%{}%", word)));
            }
        }
    }

    if let Some(ref genres) = params.genres {
        if !genres.is_empty() {
            let mut genre_placeholders = Vec::new();
            for g in genres {
                let p_idx = sql_params.len() + 1;
                genre_placeholders.push(format!("?{}", p_idx));
                sql_params.push(SqlValue::Text(g.clone()));
            }
            where_clauses.push(format!(
                "EXISTS (SELECT 1 FROM game_genre gg WHERE gg.game_id = g.id AND gg.name IN ({}))",
                genre_placeholders.join(",")
            ));
        }
    }

    if let Some(ref features) = params.features {
        for feat in features {
            if let Some(clause) = feature_clause(feat) {
                where_clauses.push(clause);
            }
        }
        // "Solo un jugador" is restrictive: a game that also offers multiplayer is not single-player only.
        if features.iter().any(|f| f == "single_player") {
            where_clauses.push(format!("NOT (m.multiplayer = 1 OR {})", MULTIPLAYER_CATEGORY_SQL));
        }
    }

    if let Some(ref features) = params.exclude_features {
        for feat in features {
            if let Some(clause) = feature_clause(feat) {
                where_clauses.push(format!("NOT ({})", clause));
            }
        }
    }

    if let Some(ref genres) = params.exclude_genres {
        if !genres.is_empty() {
            let list = push_placeholders(&mut sql_params, genres, SqlValue::Text);
            where_clauses.push(format!("NOT EXISTS (SELECT 1 FROM game_genre gg WHERE gg.game_id = g.id AND gg.name IN ({}))", list));
        }
    }

    if let Some(ref sources) = params.exclude_sources {
        if !sources.is_empty() {
            let list = push_placeholders(&mut sql_params, sources, SqlValue::Text);
            where_clauses.push(format!("NOT EXISTS (SELECT 1 FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id AND tpa.source_name IN ({}))", list));
        }
    }

    if let Some(ref ids) = params.content_descriptor_ids {
        if !ids.is_empty() {
            let list = push_placeholders(&mut sql_params, ids, SqlValue::Integer);
            where_clauses.push(descriptor_exists_sql(&list));
        }
    }

    if let Some(ref ids) = params.exclude_content_descriptor_ids {
        if !ids.is_empty() {
            let list = push_placeholders(&mut sql_params, ids, SqlValue::Integer);
            where_clauses.push(format!("NOT {}", descriptor_exists_sql(&list)));
        }
    }

    if params.hide_adult == Some(true) {
        let ids: Vec<i64> = if params.adult_includes_nudity == Some(true) { vec![1, 3, 4] } else { vec![3, 4] };
        let list = push_placeholders(&mut sql_params, &ids, SqlValue::Integer);
        where_clauses.push(format!(
            "NOT {} AND NOT EXISTS (SELECT 1 FROM catalog_game ag WHERE ag.id = g.id AND json_valid(ag.payload) AND (json_extract(ag.payload, '$.adult_only') = 1 OR CAST(COALESCE(json_extract(ag.payload, '$.required_age'), 0) AS INTEGER) >= 18))",
            descriptor_exists_sql(&list)
        ));
    }

    if let Some(ref ids) = params.game_ids {
        if ids.is_empty() {
            where_clauses.push("1 = 0".to_string());
        } else {
            let list = push_placeholders(&mut sql_params, ids, SqlValue::Integer);
            where_clauses.push(format!("g.id IN ({})", list));
        }
    }

    if let Some(from) = params.release_year_from {
        let p_idx = sql_params.len() + 1;
        where_clauses.push(format!("CAST(strftime('%Y', m.release_date) AS INTEGER) >= ?{}", p_idx));
        sql_params.push(SqlValue::Integer(from));
    }
    if let Some(to) = params.release_year_to {
        let p_idx = sql_params.len() + 1;
        where_clauses.push(format!("CAST(strftime('%Y', m.release_date) AS INTEGER) <= ?{}", p_idx));
        sql_params.push(SqlValue::Integer(to));
    }

    if params.has_downloads == Some(true) {
        where_clauses.push("EXISTS (SELECT 1 FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id)".to_string());
    }

    if let Some(ref sources) = params.sources {
        if !sources.is_empty() {
            let mut source_placeholders = Vec::new();
            for s in sources {
                let p_idx = sql_params.len() + 1;
                source_placeholders.push(format!("?{}", p_idx));
                sql_params.push(SqlValue::Text(s.clone()));
            }
            where_clauses.push(format!(
                "EXISTS (SELECT 1 FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id AND tpa.source_name IN ({}))",
                source_placeholders.join(",")
            ));
        }
    }

    if let Some(min_rating) = params.min_rating {
        if min_rating > 0.0 {
            let effective_min_score = if min_rating <= 10.0 {
                (min_rating * 10.0) as f64
            } else {
                min_rating as f64
            };
            let include_unrated = params.include_recent_unrated.unwrap_or(true);
            let p_idx = sql_params.len() + 1;
            if include_unrated {
                where_clauses.push(format!(
                    "(m.steam_review_score >= ?{0} OR m.steam_review_score IS NULL OR COALESCE(m.steam_review_count, 0) < 10 OR (m.release_date IS NOT NULL AND (julianday('now') - julianday(m.release_date)) <= 30.0))",
                    p_idx
                ));
            } else {
                where_clauses.push(format!(
                    "(m.steam_review_score IS NOT NULL AND m.steam_review_score >= ?{0})",
                    p_idx
                ));
            }
            sql_params.push(SqlValue::Real(effective_min_score));
        }
    }

    if let Some(max_days) = params.max_age_days {
        if max_days > 0 {
            let p_idx = sql_params.len() + 1;
            where_clauses.push(format!(
                "(m.release_date IS NOT NULL AND (julianday('now') - julianday(m.release_date)) <= ?{0})",
                p_idx
            ));
            sql_params.push(SqlValue::Real(max_days as f64));
        }
    }

    if let Some(ref app_ids) = params.app_ids {
        if app_ids.is_empty() {
            where_clauses.push("1 = 0".to_string());
        } else {
            let mut unique_ids: Vec<i64> = app_ids.clone();
            unique_ids.sort_unstable();
            unique_ids.dedup();
            let mut id_placeholders = Vec::new();
            for id in unique_ids {
                let p_idx = sql_params.len() + 1;
                id_placeholders.push(format!("?{}", p_idx));
                sql_params.push(SqlValue::Integer(id));
            }
            let list = id_placeholders.join(",");
            where_clauses.push(format!("(g.app_id IN ({0}) OR (g.app_id IS NULL AND g.id IN ({0})))", list));
        }
    }

    let where_sql = if where_clauses.is_empty() {
        "".to_string()
    } else {
        format!("WHERE {}", where_clauses.join(" AND "))
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM game g LEFT JOIN game_metadata m ON m.game_id = g.id {}",
        where_sql
    );

    let param_refs: Vec<&dyn ToSql> = sql_params.iter().map(|s| s as &dyn ToSql).collect();
    let total: usize = conn.query_row(
        &count_sql,
        params_from_iter(param_refs.iter().copied()),
        |r| r.get(0)
    ).map_err(|e| format!("Count query failed: {e}; SQL: {count_sql}"))?;

    let is_asc = params.sort_direction.as_deref().map(|d| d.eq_ignore_ascii_case("asc")).unwrap_or(false);
    let dir = if is_asc { "ASC" } else { "DESC" };
    let has_query = params.query.as_ref().map(|q| !q.trim().is_empty()).unwrap_or(false);
    let order_by = match params.sort_by.as_deref() {
        Some("popularity") | Some("steam-popularity") => {
            format!("MAX(COALESCE(m.recommendation_count, 0), COALESCE(m.steam_review_count, 0)) {}, g.id ASC", dir)
        }
        Some("score") | Some("steam-review-score") => {
            format!("COALESCE(m.steam_review_score, 0) {}, MAX(COALESCE(m.recommendation_count, 0), COALESCE(m.steam_review_count, 0)) DESC, g.id ASC", dir)
        }
        Some("release_date") | Some("release-date") => {
            format!("COALESCE(m.release_date, '') {}, g.id ASC", dir)
        }
        Some("name") => {
            format!("g.name COLLATE NOCASE {}, g.id ASC", if is_asc { "ASC" } else { "DESC" })
        }
        _ => {
            if has_query {
                format!("COALESCE(m.recommendation_count, 0) {}, g.id ASC", dir)
            } else {
                format!("MAX(COALESCE(m.recommendation_count, 0), COALESCE(m.steam_review_count, 0)) DESC, g.id ASC")
            }
        }
    };

    let raw_limit = params.limit.unwrap_or(60);
    let limit = if raw_limit == 0 { 60 } else { raw_limit.min(1000) };
    let offset = params.offset.unwrap_or(0);

    let lang = params.language.as_deref().unwrap_or("spanish").to_lowercase();
    let mut select_params = sql_params.clone();
    let lang_idx = select_params.len() + 1;
    select_params.push(SqlValue::Text(lang));

    let select_sql = format!(
        "SELECT g.id, g.app_id, cg.payload,
                COALESCE((SELECT COUNT(DISTINCT tpa.source_name) FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id), 0) AS src_count,
                COALESCE((SELECT json_group_array(DISTINCT tpa.source_name) FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id), '[]') AS src_names,
                COALESCE(gd.short_description, gd_def.short_description, m.short_description) AS localized_short_desc
         FROM game g
         LEFT JOIN catalog_game cg ON cg.id = g.id
         LEFT JOIN game_metadata m ON m.game_id = g.id
         LEFT JOIN game_description gd ON gd.game_id = g.id AND lower(gd.language) = ?{lang_idx}
         LEFT JOIN game_description gd_def ON gd_def.game_id = g.id AND lower(gd_def.language) = 'spanish'
         {}
         ORDER BY {}
         LIMIT {} OFFSET {}",
        where_sql, order_by, limit, offset
    );

    let select_param_refs: Vec<&dyn ToSql> = select_params.iter().map(|s| s as &dyn ToSql).collect();
    let mut stmt = conn.prepare(&select_sql).map_err(|e| format!("Select prepare failed: {e}; SQL: {select_sql}"))?;
    let rows = stmt.query_map(
        params_from_iter(select_param_refs.iter().copied()),
        |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, Option<i64>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        }
    ).map_err(|e| format!("Select query failed: {e}"))?;

    let mut items = Vec::new();
    for row in rows {
        let (gid, app_id, payload_opt, src_count, src_names_json, localized_desc) = row.map_err(|e| e.to_string())?;
        let mut val = if let Some(payload_str) = payload_opt {
            serde_json::from_str::<Value>(&payload_str).unwrap_or_else(|_| serde_json::json!({ "id": gid, "app_id": app_id }))
        } else {
            serde_json::json!({ "id": gid, "app_id": app_id })
        };
        if let Value::Object(ref mut map) = val {
            map.insert("has_downloads".to_string(), Value::Bool(src_count > 0));
            map.insert("availableSourceCount".to_string(), Value::from(src_count));
            let src_names: Value = serde_json::from_str(&src_names_json).unwrap_or(Value::Array(vec![]));
            map.insert("download_source_names".to_string(), src_names);
            if let Some(desc) = localized_desc {
                if !desc.trim().is_empty() {
                    map.insert("short_description".to_string(), Value::String(desc));
                }
            }
        }
        items.push(val);
    }

    Ok(CatalogQueryResult { items, total })
}

#[tauri::command]
pub async fn catalog_cache_query(params: CatalogQueryParams) -> Result<CatalogQueryResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_catalog_conn(|conn| query_catalog_conn(conn, &params))
    })
    .await
    .map_err(|err| format!("Catalog query task failed: {err}"))?
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

    #[test]
    fn test_normalized_schema_and_temp_plugin_join() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 100, '{\"id\":1,\"app_id\":100,\"name\":\"Alpha Game\",\"genres\":[\"Action\"]}');
            INSERT INTO catalog_game VALUES(2, 200, '{\"id\":2,\"app_id\":200,\"name\":\"Beta Puzzle\",\"genres\":[\"Puzzle\"]}');
        ").unwrap();

        ensure_normalized_schema(&conn).unwrap();

        // Verify normalized tables exist and were backfilled
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM game", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 2);

        // Add a temp source for app_id 100
        conn.execute("INSERT INTO temp_plugin_availability VALUES(100, 'FitGirl')", []).unwrap();

        // Query filtering by temp plugin source availability
        let with_downloads: i64 = conn.query_row(
            "SELECT COUNT(*) FROM game g WHERE EXISTS (SELECT 1 FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id)",
            [], |r| r.get(0)
        ).unwrap();
        assert_eq!(with_downloads, 1);

        let without_downloads: i64 = conn.query_row(
            "SELECT COUNT(*) FROM game g WHERE NOT EXISTS (SELECT 1 FROM temp_plugin_availability tpa WHERE tpa.app_id = g.app_id)",
            [], |r| r.get(0)
        ).unwrap();
        assert_eq!(without_downloads, 1);

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_multilanguage_catalog_descriptions_and_fallback() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 100, '{\"id\":1,\"app_id\":100,\"name\":\"Aventura\",\"short_description\":\"Descripción en español\"}');
            INSERT INTO catalog_game VALUES(2, 200, '{\"id\":2,\"app_id\":200,\"name\":\"Puzzle\",\"short_description\":\"Solo español\"}');
        ").unwrap();

        ensure_normalized_schema(&conn).unwrap();

        // Add English description for game 1
        conn.execute(
            "INSERT INTO game_description(game_id, language, short_description) VALUES(1, 'english', 'English adventure description')",
            [],
        ).unwrap();

        // 1. Query with 'english': game 1 has English, game 2 falls back to Spanish
        let mut stmt = conn.prepare("
            SELECT g.id, COALESCE(gd.short_description, gd_def.short_description, m.short_description)
            FROM game g
            LEFT JOIN game_metadata m ON m.game_id = g.id
            LEFT JOIN game_description gd ON gd.game_id = g.id AND lower(gd.language) = ?1
            LEFT JOIN game_description gd_def ON gd_def.game_id = g.id AND lower(gd_def.language) = 'spanish'
            ORDER BY g.id
        ").unwrap();

        let english_rows: Vec<(i64, Option<String>)> = stmt.query_map(["english"], |r| {
            Ok((r.get(0)?, r.get(1)?))
        }).unwrap().filter_map(Result::ok).collect();

        assert_eq!(english_rows.len(), 2);
        assert_eq!(english_rows[0].1.as_deref(), Some("English adventure description"));
        assert_eq!(english_rows[1].1.as_deref(), Some("Solo español")); // fallback to Spanish

        // 2. Query with 'spanish': both return Spanish
        let spanish_rows: Vec<(i64, Option<String>)> = stmt.query_map(["spanish"], |r| {
            Ok((r.get(0)?, r.get(1)?))
        }).unwrap().filter_map(Result::ok).collect();

        assert_eq!(spanish_rows.len(), 2);
        assert_eq!(spanish_rows[0].1.as_deref(), Some("Descripción en español"));
        assert_eq!(spanish_rows[1].1.as_deref(), Some("Solo español"));

        drop(stmt);
        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_limit_hard_cap() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
        ").unwrap();

        let tx = conn.unchecked_transaction().unwrap();
        {
            let mut ins = tx.prepare("INSERT INTO catalog_game(id, app_id, payload) VALUES (?1, ?2, ?3)").unwrap();
            for i in 1..=1050 {
                let payload = format!(r#"{{"id":{i},"app_id":{i},"name":"Game {i}"}}"#);
                ins.execute(params![i, i, payload]).unwrap();
            }
        }
        tx.commit().unwrap();

        ensure_normalized_schema(&conn).unwrap();

        let params = CatalogQueryParams {
            limit: Some(1500),
            ..Default::default()
        };
        let result = query_catalog_conn(&conn, &params).unwrap();
        assert_eq!(result.total, 1050, "Total should report the actual total count before limit");
        assert_eq!(result.items.len(), 1000, "Items returned must be clamped to hard cap of 1000");

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_min_rating_strict() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 10, '{\"id\":1,\"app_id\":10,\"name\":\"G1\",\"steam_review_score\":90,\"steam_review_count\":100}');
            INSERT INTO catalog_game VALUES(2, 20, '{\"id\":2,\"app_id\":20,\"name\":\"G2\",\"steam_review_score\":50,\"steam_review_count\":100}');
            INSERT INTO catalog_game VALUES(3, 30, '{\"id\":3,\"app_id\":30,\"name\":\"G3\"}');
            INSERT INTO catalog_game VALUES(4, 40, '{\"id\":4,\"app_id\":40,\"name\":\"G4\",\"steam_review_score\":40,\"steam_review_count\":2}');
        ").unwrap();

        ensure_normalized_schema(&conn).unwrap();

        let params = CatalogQueryParams {
            min_rating: Some(6.0),
            include_recent_unrated: Some(false),
            ..Default::default()
        };
        let result = query_catalog_conn(&conn, &params).unwrap();
        assert_eq!(result.total, 1, "Only game 1 should match strict min_rating >= 6.0 (score >= 60)");
        assert_eq!(result.items[0]["id"], 1);

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_exclusions_and_adult() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 10, '{\"id\":1,\"app_id\":10,\"name\":\"Race\",\"genres\":[\"Racing\"],\"single_player\":true}');
            INSERT INTO catalog_game VALUES(2, 20, '{\"id\":2,\"app_id\":20,\"name\":\"Shoot\",\"genres\":[\"Action\"],\"single_player\":true,\"multiplayer\":true}');
            INSERT INTO catalog_game VALUES(3, 30, '{\"id\":3,\"app_id\":30,\"name\":\"Adult\",\"genres\":[\"Racing\"],\"content_descriptorids\":[3]}');
        ").unwrap();
        ensure_normalized_schema(&conn).unwrap();

        let excluded = query_catalog_conn(&conn, &CatalogQueryParams { exclude_genres: Some(vec!["Racing".into()]), ..Default::default() }).unwrap();
        assert_eq!(excluded.total, 1);
        assert_eq!(excluded.items[0]["id"], 2);

        let no_adult = query_catalog_conn(&conn, &CatalogQueryParams { hide_adult: Some(true), ..Default::default() }).unwrap();
        assert_eq!(no_adult.total, 2);

        let only_adult = query_catalog_conn(&conn, &CatalogQueryParams { content_descriptor_ids: Some(vec![1, 3, 4]), ..Default::default() }).unwrap();
        assert_eq!(only_adult.total, 1);
        assert_eq!(only_adult.items[0]["id"], 3);

        let solo = query_catalog_conn(&conn, &CatalogQueryParams { features: Some(vec!["single_player".into()]), ..Default::default() }).unwrap();
        assert_eq!(solo.total, 1);
        assert_eq!(solo.items[0]["id"], 1);

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_include_recent_unrated() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
        ").unwrap();

        // Game 1: high rating (80), old release (100 days ago) -> keep
        // Game 2: low rating (40), 50 reviews, old release (100 days ago) -> exclude
        // Game 3: unrated -> keep
        // Game 4: low rating (30), few reviews (5), old release (100 days ago) -> keep
        // Game 5: low rating (40), 50 reviews, recent release (5 days ago) -> keep
        let old_date: String = conn.query_row("SELECT date('now', '-100 days')", [], |r| r.get(0)).unwrap();
        let recent_date: String = conn.query_row("SELECT date('now', '-5 days')", [], |r| r.get(0)).unwrap();

        conn.execute("INSERT INTO catalog_game VALUES(1, 10, ?1)", [format!(r#"{{"id":1,"app_id":10,"name":"G1","steam_review_score":80,"steam_review_count":50,"release_date":"{old_date}"}}"#)]).unwrap();
        conn.execute("INSERT INTO catalog_game VALUES(2, 20, ?1)", [format!(r#"{{"id":2,"app_id":20,"name":"G2","steam_review_score":40,"steam_review_count":50,"release_date":"{old_date}"}}"#)]).unwrap();
        conn.execute("INSERT INTO catalog_game VALUES(3, 30, ?1)", [format!(r#"{{"id":3,"app_id":30,"name":"G3","release_date":"{old_date}"}}"#)]).unwrap();
        conn.execute("INSERT INTO catalog_game VALUES(4, 40, ?1)", [format!(r#"{{"id":4,"app_id":40,"name":"G4","steam_review_score":30,"steam_review_count":5,"release_date":"{old_date}"}}"#)]).unwrap();
        conn.execute("INSERT INTO catalog_game VALUES(5, 50, ?1)", [format!(r#"{{"id":5,"app_id":50,"name":"G5","steam_review_score":40,"steam_review_count":50,"release_date":"{recent_date}"}}"#)]).unwrap();

        ensure_normalized_schema(&conn).unwrap();

        let params = CatalogQueryParams {
            min_rating: Some(6.0),
            include_recent_unrated: Some(true),
            ..Default::default()
        };
        let result = query_catalog_conn(&conn, &params).unwrap();
        assert_eq!(result.total, 4, "Games 1, 3, 4, 5 should match. Game 2 (established low score) excluded");
        let matched_ids: Vec<i64> = result.items.iter().map(|item| item["id"].as_i64().unwrap()).collect();
        assert!(matched_ids.contains(&1));
        assert!(!matched_ids.contains(&2));
        assert!(matched_ids.contains(&3));
        assert!(matched_ids.contains(&4));
        assert!(matched_ids.contains(&5));

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_max_age_days() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
        ").unwrap();

        let date_10d: String = conn.query_row("SELECT date('now', '-10 days')", [], |r| r.get(0)).unwrap();
        let date_200d: String = conn.query_row("SELECT date('now', '-200 days')", [], |r| r.get(0)).unwrap();
        let date_400d: String = conn.query_row("SELECT date('now', '-400 days')", [], |r| r.get(0)).unwrap();

        conn.execute("INSERT INTO catalog_game VALUES(1, 10, ?1)", [format!(r#"{{"id":1,"app_id":10,"name":"G1","release_date":"{date_10d}"}}"#)]).unwrap();
        conn.execute("INSERT INTO catalog_game VALUES(2, 20, ?1)", [format!(r#"{{"id":2,"app_id":20,"name":"G2","release_date":"{date_200d}"}}"#)]).unwrap();
        conn.execute("INSERT INTO catalog_game VALUES(3, 30, ?1)", [format!(r#"{{"id":3,"app_id":30,"name":"G3","release_date":"{date_400d}"}}"#)]).unwrap();

        ensure_normalized_schema(&conn).unwrap();

        let params = CatalogQueryParams {
            max_age_days: Some(365),
            ..Default::default()
        };
        let result = query_catalog_conn(&conn, &params).unwrap();
        assert_eq!(result.total, 2, "Games released within 365 days should match");
        let matched_ids: Vec<i64> = result.items.iter().map(|item| item["id"].as_i64().unwrap()).collect();
        assert!(matched_ids.contains(&1));
        assert!(matched_ids.contains(&2));
        assert!(!matched_ids.contains(&3));

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_app_ids_filter() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 100, '{\"id\":1,\"app_id\":100,\"name\":\"G100\"}');
            INSERT INTO catalog_game VALUES(2, 200, '{\"id\":2,\"app_id\":200,\"name\":\"G200\"}');
            INSERT INTO catalog_game VALUES(3, 300, '{\"id\":3,\"app_id\":300,\"name\":\"G300\"}');
            INSERT INTO catalog_game VALUES(4, 400, '{\"id\":4,\"app_id\":400,\"name\":\"G400\"}');
        ").unwrap();

        ensure_normalized_schema(&conn).unwrap();

        let params = CatalogQueryParams {
            app_ids: Some(vec![100, 300]),
            ..Default::default()
        };
        let result = query_catalog_conn(&conn, &params).unwrap();
        assert_eq!(result.total, 2);
        let ids: Vec<i64> = result.items.iter().map(|item| item["app_id"].as_i64().unwrap()).collect();
        assert_eq!(ids, vec![100, 300]);

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_app_ids_empty() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 100, '{\"id\":1,\"app_id\":100,\"name\":\"G100\"}');
        ").unwrap();

        ensure_normalized_schema(&conn).unwrap();

        let params = CatalogQueryParams {
            app_ids: Some(vec![]),
            ..Default::default()
        };
        let result = query_catalog_conn(&conn, &params).unwrap();
        assert_eq!(result.total, 0);
        assert!(result.items.is_empty());

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_default_popularity_order_without_search() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 100, '{\"id\":1,\"app_id\":100,\"name\":\"Alpha\",\"steam_review_count\":10,\"recommendation_count\":0}');
            INSERT INTO catalog_game VALUES(2, 200, '{\"id\":2,\"app_id\":200,\"name\":\"Beta\",\"steam_review_count\":5000,\"recommendation_count\":0}');
            INSERT INTO catalog_game VALUES(3, 300, '{\"id\":3,\"app_id\":300,\"name\":\"Gamma\",\"steam_review_count\":100,\"recommendation_count\":20000}');
        ").unwrap();

        ensure_normalized_schema(&conn).unwrap();

        let params = CatalogQueryParams::default();
        let result = query_catalog_conn(&conn, &params).unwrap();
        assert_eq!(result.total, 3);
        let ids: Vec<i64> = result.items.iter().map(|item| item["id"].as_i64().unwrap()).collect();
        assert_eq!(ids, vec![3, 2, 1]);

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }
}
