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
pub(crate) static CATALOG_SESSION_CONN: Mutex<Option<Connection>> = Mutex::new(None);

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
    /// Patches to the current revision, keyed by the revision they start from (deploy/catalog-cache, daily job).
    #[serde(default)]
    updates: std::collections::HashMap<String, CatalogUpdateArtifact>,
}

#[derive(Debug, Deserialize)]
struct CatalogUpdateArtifact {
    artifact_url: String,
    sha256: String,
}

#[derive(Debug, Serialize)]
pub struct CatalogCacheSyncResult {
    pub updated: bool,
    pub revision: String,
    pub catalog_count: usize,
    /// What the check downloaded besides the manifest: "nothing", "patch" or "package" (for the log).
    pub downloaded: &'static str,
    /// Compressed bytes of that download, the time the manifest took and the time of the whole check.
    pub downloaded_bytes: u64,
    pub manifest_ms: u64,
    pub total_ms: u64,
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

pub(crate) fn cache_db_path() -> Result<PathBuf, String> {
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

/// Reports long catalog work to the interface: (stage, done, total). Stages: "seed" (installing the database that
/// ships with the app), "download" (bytes), "apply" (games written). A total of 0 means unknown.
pub(crate) type Progress<'a> = &'a dyn Fn(&str, u64, u64);
fn no_progress(_: &str, _: u64, _: u64) {}

fn install_bundled_seed(target: &Path, progress: Progress) -> Result<bool, String> {
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

    progress("seed", 0, 0);
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
        merge_baseline(target,&next,&manifest,progress)?;
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

/// The installed catalog, installing the bundled seed if needed (used by the release self-test).
pub(crate) fn self_test_catalog() -> Result<PathBuf, String> {
    let path = ready_cache_db_path()?;
    let size = fs::metadata(&path).map_err(|err| format!("Catalog missing after install: {err}"))?.len();
    if size == 0 { return Err("Catalog database is empty".to_string()); }
    Ok(path)
}

fn ready_cache_db_path_unlocked() -> Result<PathBuf, String> {
    let target = cache_db_path()?;
    reconcile_cache_sidecars(&target)?;
    let _ = install_bundled_seed(&target, &no_progress)?;
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
    let mut upsert_game = tx.prepare(
        "INSERT INTO game(id, app_id, slug, name, credit_cost_per_hour, active) VALUES (?1, ?2, ?3, ?4, ?5, 1)
         ON CONFLICT(id) DO UPDATE SET app_id=excluded.app_id, slug=excluded.slug, name=excluded.name, credit_cost_per_hour=excluded.credit_cost_per_hour"
    ).map_err(|e|e.to_string())?;
    let mut ins_meta = tx.prepare(
        "INSERT OR REPLACE INTO game_metadata(game_id, release_date, recommendation_count, steam_review_score, steam_review_count, metacritic_score, single_player, multiplayer, coop, online_coop, local_coop, shared_split_screen, mmo, pvp, pve, lan, cross_platform, header_image, capsule_image, hero_image, steam_url, short_description)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)"
    ).map_err(|e|e.to_string())?;
    let mut del_genre = tx.prepare("DELETE FROM game_genre WHERE game_id=?1").map_err(|e|e.to_string())?;
    let mut del_category = tx.prepare("DELETE FROM game_category WHERE game_id=?1").map_err(|e|e.to_string())?;
    let mut del_tag = tx.prepare("DELETE FROM game_tag WHERE game_id=?1").map_err(|e|e.to_string())?;
    let mut ins_genre = tx.prepare("INSERT OR IGNORE INTO game_genre(game_id, name) VALUES (?1, ?2)").map_err(|e|e.to_string())?;
    let mut ins_category = tx.prepare("INSERT OR IGNORE INTO game_category(game_id, name) VALUES (?1, ?2)").map_err(|e|e.to_string())?;
    let mut ins_tag = tx.prepare("INSERT OR IGNORE INTO game_tag(game_id, name) VALUES (?1, ?2)").map_err(|e|e.to_string())?;
    let mut touched_for_sources: Vec<(i64, String)> = Vec::new();
    for (id, payload) in touched {
        let Ok(game) = serde_json::from_str::<Value>(payload) else { continue };
        let app_id = game.get("app_id").and_then(Value::as_i64);
        let name = game.get("name").and_then(Value::as_str).unwrap_or("");
        let slug = game.get("slug").and_then(Value::as_str).unwrap_or("");
        let cost = game.get("credit_cost_per_hour").and_then(Value::as_i64).unwrap_or(0);
        if !name.trim().is_empty() {
            let _ = upsert_game.execute(params![id, app_id, slug, name, cost]);
            touched_for_sources.push((app_id.unwrap_or(*id), name.to_string()));
        }
        let rel_date = game.get("release_date").and_then(Value::as_str);
        let norm_date = rel_date.and_then(normalize_release_date);
        let rel_date_ref = norm_date.as_deref().or(rel_date);
        let rec_count = game.get("recommendation_count").and_then(Value::as_i64);
        let rev_score = game.get("steam_review_score").and_then(Value::as_f64);
        let rev_count = game.get("steam_review_count").and_then(Value::as_i64);
        let meta_score = game.get("metacritic_score").and_then(Value::as_i64);
        let sp = i32::from(game.get("single_player").and_then(Value::as_bool) == Some(true));
        let mp = i32::from(game.get("multiplayer").and_then(Value::as_bool) == Some(true));
        let coop = i32::from(game.get("coop").and_then(Value::as_bool) == Some(true));
        let o_coop = i32::from(game.get("online_coop").and_then(Value::as_bool) == Some(true));
        let l_coop = i32::from(game.get("local_coop").and_then(Value::as_bool) == Some(true));
        let split = i32::from(game.get("shared_split_screen").and_then(Value::as_bool) == Some(true));
        let mmo = i32::from(game.get("mmo").and_then(Value::as_bool) == Some(true));
        let pvp = i32::from(game.get("pvp").and_then(Value::as_bool) == Some(true));
        let pve = i32::from(game.get("pve").and_then(Value::as_bool) == Some(true));
        let lan = i32::from(game.get("lan").and_then(Value::as_bool) == Some(true));
        let cross = i32::from(game.get("cross_platform").and_then(Value::as_bool) == Some(true));
        let header = game.get("header_image").and_then(Value::as_str);
        let capsule = game.get("capsule_image").and_then(Value::as_str);
        let hero = game.get("hero_image").and_then(Value::as_str);
        let steam_url = game.get("steam_url").and_then(Value::as_str);
        let short_desc = game.get("short_description").and_then(Value::as_str);
        let _ = ins_meta.execute(params![
            id, rel_date_ref, rec_count, rev_score, rev_count, meta_score,
            sp, mp, coop, o_coop, l_coop, split, mmo, pvp, pve, lan, cross,
            header, capsule, hero, steam_url, short_desc
        ]);
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
    crate::source_index::match_games_against_sources(tx, &touched_for_sources)?;
    Ok(())
}

fn apply_batch(target: &Path, games: Vec<Value>, details: Vec<DetailChange>,
                manifest: &CatalogManifest, progress: Progress) -> Result<usize, String> {
    let mut conn = Connection::open(target).map_err(|e|e.to_string())?;
    ensure_normalized_schema(&conn)?;
    let tx = conn.transaction().map_err(|e|e.to_string())?;
    let mut ids = std::collections::HashMap::new();
    // Games whose payload changed, so their normalized rows can be refilled from
    // it. Without this the payload updates and the searchable tables do not: a
    // refresh that added genres left `game_genre` holding the previous values.
    let mut touched: Vec<(i64, String)> = Vec::new();
    let total = games.len() as u64;
    progress("apply", 0, total);
    for (position, mut game) in games.into_iter().enumerate() {
        if position % 250 == 0 { progress("apply", position as u64, total); }
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
    progress("apply", total, total);
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

fn merge_baseline(target: &Path, incoming: &Path, manifest: &CatalogManifest, progress: Progress) -> Result<usize,String> {
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
    apply_batch(target,games,details,manifest,progress)
}


fn sync_blocking(manifest_url: String, progress: Progress) -> Result<CatalogCacheSyncResult, String> {
    let _sync_guard = CATALOG_CACHE_SYNC_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Catalog cache synchronization lock was poisoned".to_string())?;
    let target = ready_cache_db_path_unlocked()?;
    sync_into(&target, &manifest_url, progress)
}

/// One check of the catalog at `target` against the published manifest. Up to date: the manifest is the only request.
/// Behind: one more request, the patch from the installed revision, or the whole package when the manifest has none.
fn sync_into(target: &Path, manifest_url: &str, progress: Progress) -> Result<CatalogCacheSyncResult, String> {
    let target = target.to_path_buf();
    let started = std::time::Instant::now();
    let elapsed = || started.elapsed().as_millis() as u64;
    validate_github_https_url(manifest_url)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|err| format!("Could not create catalog cache client: {err}"))?;
    let manifest_request = reqwest::Url::parse(manifest_url).map_err(|e|e.to_string())?;
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
    let manifest_ms = elapsed();

    if manifest.schema_version != CACHE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported catalog manifest schema {}; expected {}",
            manifest.schema_version, CACHE_SCHEMA_VERSION
        ));
    }
    validate_github_https_url(&manifest.artifact_url)?;

    let current = current_cache_info(&target)?;
    if let Some((revision, count)) = &current {
        let conn = Connection::open(&target).map_err(|err| err.to_string())?;
        let generated_at = read_meta(&conn, "generated_at")?.unwrap_or_default();
        // Same revision (or an older snapshot): the database is in sync; nothing is sent and nothing is downloaded.
        if *revision == manifest.revision || incoming_snapshot_older(&generated_at, &manifest.generated_at)
            || (manifest.generated_at.is_empty() && manifest.catalog_count < *count) {
            return Ok(CatalogCacheSyncResult { updated: false, revision: revision.clone(), catalog_count: *count,
                downloaded: "nothing", downloaded_bytes: 0, manifest_ms, total_ms: elapsed() });
        }
    }
    // Behind: the patch from the installed revision when the manifest lists one (about 1 MB), else the whole package.
    let patch = current.as_ref().and_then(|(revision, _)| manifest.updates.get(revision).map(|update| (revision.clone(), update)));
    let (artifact_url, artifact_sha256, patch_base) = match &patch {
        Some((base, update)) => (update.artifact_url.as_str(), update.sha256.as_str(), Some(base.clone())),
        None if manifest.kind == "delta" => (manifest.artifact_url.as_str(), manifest.sha256.as_str(), Some(manifest.base_revision.clone())),
        None => (manifest.artifact_url.as_str(), manifest.sha256.as_str(), None),
    };
    validate_github_https_url(artifact_url)?;

    let mut response = client
        .get(artifact_url)
        .header(CACHE_CONTROL, "public, max-age=31536000, immutable")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|err| format!("Could not download catalog cache: {err}"))?;
    // Read in blocks so the interface can show the bytes as they arrive.
    let total = response.content_length().unwrap_or(0);
    let mut compressed = Vec::with_capacity(total.min(MAX_COMPRESSED_BYTES as u64) as usize);
    let mut block = vec![0u8; 64 * 1024];
    let mut reported = std::time::Instant::now();
    progress("download", 0, total);
    loop {
        let read = response.read(&mut block).map_err(|err| format!("Could not read catalog cache download: {err}"))?;
        if read == 0 { break; }
        compressed.extend_from_slice(&block[..read]);
        if compressed.len() > MAX_COMPRESSED_BYTES {
            return Err("Catalog cache download is unexpectedly large".into());
        }
        if reported.elapsed() >= Duration::from_millis(200) {
            progress("download", compressed.len() as u64, total);
            reported = std::time::Instant::now();
        }
    }
    progress("download", compressed.len() as u64, total.max(compressed.len() as u64));

    let downloaded_bytes = compressed.len() as u64;
    let actual_sha = format!("{:x}", Sha256::digest(&compressed));
    if !actual_sha.eq_ignore_ascii_case(artifact_sha256.trim()) {
        return Err("Catalog cache SHA-256 verification failed".into());
    }

    let mut decoder = GzDecoder::new(compressed.as_slice());
    let mut sqlite_bytes = Vec::new();
    decoder
        .read_to_end(&mut sqlite_bytes)
        .map_err(|err| format!("Could not decompress catalog cache: {err}"))?;

    if let Some(base) = patch_base {
        let batch: CatalogBatch=serde_json::from_slice(&sqlite_bytes).map_err(|e|e.to_string())?;
        let current = current.ok_or("A baseline is required before applying catalog updates")?;
        if batch.schema_version != CACHE_SCHEMA_VERSION || batch.revision != manifest.revision
            || batch.base_revision != base || batch.base_revision != current.0 {
            return Err("Catalog update does not match the installed revision".into());
        }
        let count=apply_batch(&target,batch.games,batch.details,&manifest,progress)?;
        return Ok(CatalogCacheSyncResult{updated:true,revision:manifest.revision,catalog_count:count,
            downloaded:"patch",downloaded_bytes,manifest_ms,total_ms:elapsed()});
    }
    let next = target.with_extension("sqlite.next");
    let backup = target.with_extension("sqlite.bak");
    fs::write(&next, sqlite_bytes).map_err(|err| format!("Could not write catalog cache: {err}"))?;
    validate_database(&next, &manifest)?;
    if target.exists() {
        let count = merge_baseline(&target,&next,&manifest,progress)?;
        let _=fs::remove_file(&next);
        return Ok(CatalogCacheSyncResult{updated:true,revision:manifest.revision,catalog_count:count,
            downloaded:"package",downloaded_bytes,manifest_ms,total_ms:elapsed()});
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
        downloaded: "package",
        downloaded_bytes,
        manifest_ms,
        total_ms: elapsed(),
    })
}

fn emitter(app: tauri::AppHandle) -> impl Fn(&str, u64, u64) {
    use tauri::Emitter;
    move |stage: &str, done: u64, total: u64| {
        let _ = app.emit("gameaccess:catalog-progress", serde_json::json!({ "stage": stage, "done": done, "total": total }));
    }
}

/// Installs (or updates from) the catalog database that ships with the app, reporting progress. The first step of
/// the startup preparation: afterwards every catalog command finds the database ready.
#[tauri::command]
pub async fn catalog_prepare(app: tauri::AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = emitter(app);
        let _guard = CATALOG_CACHE_SYNC_LOCK.get_or_init(|| Mutex::new(())).lock()
            .map_err(|_| "Catalog cache lock was poisoned".to_string())?;
        let target = cache_db_path()?;
        reconcile_cache_sidecars(&target)?;
        let installed = install_bundled_seed(&target, &progress)?;
        let (revision, count) = current_cache_info(&target)?.unwrap_or_default();
        Ok(serde_json::json!({ "installed": installed, "revision": revision, "catalog_count": count }))
    })
    .await
    .map_err(|err| format!("Catalog preparation task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_cache_sync(app: tauri::AppHandle, manifest_url: String) -> Result<CatalogCacheSyncResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let progress = emitter(app);
        sync_blocking(manifest_url, &progress)
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

#[derive(Debug, Deserialize, Serialize, Default, Clone)]
pub struct CatalogQueryParams {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub genres: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub features: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_downloads: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_rating: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_age_days: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_recent_unrated: Option<bool>,
    /// Strict floor on the number of reviews. Unlike `min_rating` it never spares new or unrated games.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_review_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub app_ids: Option<Vec<i64>>,
    /// Exact genre names (as stored in game_genre) a game must not carry.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_genres: Option<Vec<String>>,
    /// Features a game must not have (same keys as `features`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_features: Option<Vec<String>>,
    /// Download sources a game must not be offered by.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_sources: Option<Vec<String>>,
    /// Valve content descriptors: at least one required.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_descriptor_ids: Option<Vec<i64>>,
    /// Valve content descriptors: none allowed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exclude_content_descriptor_ids: Option<Vec<i64>>,
    /// Hide adult-only games (server verdict, descriptors 3/4, and 1 when `adult_includes_nudity`).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hide_adult: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adult_includes_nudity: Option<bool>,
    /// Release year bounds (inclusive).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_year_from: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_year_to: Option<i64>,
    /// Catalog ids (not Steam app ids): likes and recently opened games are stored this way.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_ids: Option<Vec<i64>>,
}

const MULTIPLAYER_CATEGORY_SQL: &str = "EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Multi-player','Multijugador','Multijoueur','Multigiocatore','Mehrspieler','Wieloosobowa','Multijogador','多人','Багатокористувацька гра','Co-op','Cooperativo','Кооперативна гра','PvP','JcJ','JxJ','Гравець проти гравця','Online PvP','JcJ en línea','Online-PvP','Гравець проти гравця в мережі','Online Co-op','Cooperativo en línea','Cooperativo online','Мережева кооперативна гра','Shared/Split Screen','Pantalla partida/compartida','Tela compartilhada/dividida','Geteilter Bildschirm','Shared/Split Screen Co-op','Coop. a pantalla (com)partida','Cooperativo em tela dividida/compartilhada','Shared/Split Screen PvP','LAN Co-op','Cooperativo em rede local (LAN)','Cooperativo en LAN','LAN PvP','JcJ en rede local (LAN)','JxJ em rede local (LAN)','MMO','Multijugador masivo','Massively Multiplayer','Cross-Platform Multiplayer','Multijugador multiplataforma','Multijogador entre plataformas','Кросплатформова гра'))";

/// SQL condition for one library feature key, or None for keys the query does not know.
fn feature_clause(feat: &str) -> Option<String> {
    Some(match feat {
        "has_downloads" => "EXISTS (SELECT 1 FROM game_sources gs WHERE gs.app_id = g.app_id)".to_string(),
        "single_player" => "(m.single_player = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Single-player','Un jugador','Solo','Einzelspieler','Um jogador','单人')))".to_string(),
        "multiplayer" => format!("(m.multiplayer = 1 OR m.coop = 1 OR m.online_coop = 1 OR m.local_coop = 1 OR m.shared_split_screen = 1 OR m.mmo = 1 OR m.pvp = 1 OR m.lan = 1 OR {})", MULTIPLAYER_CATEGORY_SQL),
        "coop" | "pve" => "(m.coop = 1 OR m.online_coop = 1 OR m.local_coop = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Co-op','Cooperativo','Кооперативна гра','Online Co-op','Cooperativo en línea','Cooperativo online','Мережева кооперативна гра','LAN Co-op','Cooperativo em rede local (LAN)','Cooperativo en LAN','Shared/Split Screen Co-op','Coop. a pantalla (com)partida','Cooperativo em tela dividida/compartilhada')))".to_string(),
        "coop_generic" => "(m.coop = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Co-op','Cooperativo','Кооперативна гра')))".to_string(),
        "online_coop" => "(m.online_coop = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Online Co-op','Cooperativo en línea','Cooperativo online','Мережева кооперативна гра')))".to_string(),
        "local_coop" => "(m.local_coop = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Shared/Split Screen Co-op','Coop. a pantalla (com)partida','Cooperativo em tela dividida/compartilhada')))".to_string(),
        "shared_split_screen" | "local_multiplayer" => "(m.shared_split_screen = 1 OR m.local_coop = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Shared/Split Screen','Pantalla partida/compartida','Tela compartilhada/dividida','Geteilter Bildschirm','Shared/Split Screen Co-op','Coop. a pantalla (com)partida','Cooperativo em tela dividida/compartilhada','Shared/Split Screen PvP')))".to_string(),
        "online_multiplayer" => "(m.online_coop = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Online Co-op','Cooperativo en línea','Cooperativo online','Мережева кооперативна гра','Online PvP','JcJ en línea','Online-PvP','Гравець проти гравця в мережі')))".to_string(),
        "mmo" => "(m.mmo = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('MMO','Multijugador masivo','Massively Multiplayer')))".to_string(),
        "pvp" => "(m.pvp = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('PvP','JcJ','JxJ','Гравець проти гравця','Online PvP','JcJ en línea','Online-PvP','Гравець проти гравця в мережі','LAN PvP','JcJ en rede local (LAN)','JxJ em rede local (LAN)','Shared/Split Screen PvP')))".to_string(),
        "lan" | "multiplayer_lan" => "(m.lan = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('LAN Co-op','Cooperativo em rede local (LAN)','Cooperativo en LAN','LAN PvP','JcJ en rede local (LAN)','JxJ em rede local (LAN)')))".to_string(),
        "coop_lan" => "EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('LAN Co-op','Cooperativo em rede local (LAN)','Cooperativo en LAN'))".to_string(),
        "cross_platform" => "(m.cross_platform = 1 OR EXISTS (SELECT 1 FROM game_category gc WHERE gc.game_id = g.id AND gc.name IN ('Cross-Platform Multiplayer','Multijugador multiplataforma','Multijogador entre plataformas','Кросплатформова гра')))".to_string(),
        _ => return None,
    })
}

fn format_sql_value(val: &SqlValue) -> String {
    match val {
        SqlValue::Null => "NULL".to_string(),
        SqlValue::Integer(i) => i.to_string(),
        SqlValue::Real(f) => format!("{f}"),
        SqlValue::Text(s) => format!("'{}'", s.replace('\'', "''")),
        SqlValue::Blob(b) => format!("X'{}'", b.iter().map(|byte| format!("{byte:02x}")).collect::<String>()),
    }
}

fn render_sql_with_params(sql: &str, params: &[SqlValue]) -> String {
    let mut rendered = sql
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    for idx in (1..=params.len()).rev() {
        let placeholder = format!("?{idx}");
        let replacement = format_sql_value(&params[idx - 1]);
        rendered = rendered.replace(&placeholder, &replacement);
    }
    rendered
}

fn log_catalog_query(
    params: &CatalogQueryParams,
    count_sql: &str,
    count_params: &[SqlValue],
    select_sql: &str,
    select_params: &[SqlValue],
    total: usize,
    items: &[Value],
    elapsed: Duration,
) {
    let criteria_json = serde_json::to_string(params).unwrap_or_else(|_| format!("{params:?}"));
    let rendered_count_sql = render_sql_with_params(count_sql, count_params);
    let rendered_select_sql = render_sql_with_params(select_sql, select_params);
    let sample_records: Vec<String> = items
        .iter()
        .take(25)
        .map(|item| {
            let id = item.get("id").and_then(Value::as_i64).unwrap_or(0);
            let app_id = item.get("app_id").and_then(Value::as_i64).unwrap_or(0);
            let name = item.get("name").and_then(Value::as_str).unwrap_or("?");
            let rel = item.get("release_date").and_then(Value::as_str).unwrap_or("-");
            let score = item
                .get("steam_review_score")
                .and_then(Value::as_f64)
                .map(|s| format!("{s:.0}%"))
                .unwrap_or_else(|| "-".to_string());
            let dl = item.get("source_count").and_then(Value::as_i64).unwrap_or(0);
            format!("{id}(app={app_id},\"{name}\",date={rel},score={score},sources={dl})")
        })
        .collect();
    let more_suffix = if items.len() > 25 {
        format!(" ... (+{} more in page)", items.len() - 25)
    } else {
        String::new()
    };
    let lines = vec![
        format!("CRITERIA: {criteria_json}"),
        format!("SQL_COUNT: {rendered_count_sql}"),
        format!("SQL_SELECT: {rendered_select_sql}"),
        format!(
            "RESULT: total_matching={total} page_returned={} elapsed_ms={:.2} records=[{}{}]",
            items.len(),
            elapsed.as_secs_f64() * 1000.0,
            sample_records.join(", "),
            more_suffix
        ),
    ];
    let _ = crate::activity_log::append_narration_lines(lines, "CATALOG_QUERY".into(), "INFO".into());
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

#[derive(Debug, Serialize)]
pub struct CatalogFacetsResult {
    pub genres: Vec<String>,
    pub sources: Vec<String>,
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
        CREATE INDEX IF NOT EXISTS ix_game_desc_lang ON game_description(language);"
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
    // Dates stored unnormalized ("1 ABR 2008") make julianday() NULL and the game fails every
    // date filter. Repair them from the payload; only rows that are still unreadable are touched.
    if let Ok(mut stmt) = conn.prepare(
        "SELECT m.game_id, COALESCE(json_extract(cg.payload, '$.release_date'), m.release_date)
         FROM game_metadata m LEFT JOIN catalog_game cg ON cg.id = m.game_id
         WHERE (m.release_date IS NULL OR julianday(m.release_date) IS NULL)
           AND COALESCE(json_extract(cg.payload, '$.release_date'), m.release_date) IS NOT NULL"
    ) {
        let fixes: Vec<(i64, String)> = stmt
            .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?)))
            .map(|rows| rows.flatten().filter_map(|(id, raw)| raw.as_deref().and_then(normalize_release_date).map(|d| (id, d))).collect())
            .unwrap_or_default();
        drop(stmt);
        if !fixes.is_empty() {
            if let Ok(tx) = conn.unchecked_transaction() {
                for (id, date) in &fixes {
                    let _ = tx.execute("UPDATE game_metadata SET release_date=?2 WHERE game_id=?1", params![id, date]);
                }
                let _ = tx.commit();
            }
        }
    }
    crate::source_index::ensure_source_tables(conn)?;
    Ok(())
}

pub(crate) fn with_catalog_conn<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut Connection) -> Result<R, String>,
{
    let mut guard = CATALOG_SESSION_CONN
        .lock()
        .map_err(|_| "Catalog connection lock poisoned".to_string())?;
    if guard.is_none() {
        let path = ready_cache_db_path()?;
        let conn = Connection::open(&path).map_err(|err| err.to_string())?;
        let _ = conn.execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;");
        ensure_normalized_schema(&conn)?;
        *guard = Some(conn);
    }
    let conn = guard.as_mut().unwrap();
    f(conn)
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
            let mut src_stmt = conn.prepare(
                "SELECT DISTINCT source_name FROM download_sources WHERE trim(source_name) != '' ORDER BY source_name COLLATE NOCASE ASC"
            ).map_err(|e| e.to_string())?;
            let sources: Vec<String> = src_stmt.query_map([], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            Ok(CatalogFacetsResult { genres, sources })
        })
    })
    .await
    .map_err(|err| format!("Catalog facets task failed: {err}"))?
}

pub fn query_catalog_conn(conn: &Connection, params: &CatalogQueryParams) -> Result<CatalogQueryResult, String> {
    let started = std::time::Instant::now();
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
            where_clauses.push(format!(
                "NOT EXISTS (SELECT 1 FROM game_sources gs JOIN download_sources ds INDEXED BY ix_download_sources_key_name ON ds.source_key = gs.source_key WHERE gs.app_id = g.app_id AND ds.source_name IN ({}))",
                list
            ));
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
        where_clauses.push("g.app_id IN (SELECT gs.app_id FROM game_sources gs)".to_string());
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
                "g.app_id IN (SELECT gs.app_id FROM download_sources ds INDEXED BY ix_download_sources_name_key JOIN game_sources gs INDEXED BY ix_game_sources_source_key ON gs.source_key = ds.source_key WHERE ds.source_name IN ({}))",
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

    if let Some(min_reviews) = params.min_review_count {
        if min_reviews > 0 {
            let p_idx = sql_params.len() + 1;
            where_clauses.push(format!("COALESCE(m.steam_review_count, 0) >= ?{0}", p_idx));
            sql_params.push(SqlValue::Integer(min_reviews));
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

    let count_join_meta = if where_sql.contains("m.") {
        "LEFT JOIN game_metadata m ON m.game_id = g.id"
    } else {
        ""
    };
    let count_sql = format!(
        "SELECT COUNT(*) FROM game g {} {}",
        count_join_meta, where_sql
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
                COALESCE((SELECT COUNT(*) FROM game_sources gs WHERE gs.app_id = g.app_id), 0) AS src_count,
                COALESCE((SELECT json_group_array(DISTINCT ds.source_name) FROM game_sources gs JOIN download_sources ds INDEXED BY ix_download_sources_key_name ON ds.source_key = gs.source_key WHERE gs.app_id = g.app_id), '[]') AS src_names,
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
            map.insert("source_count".to_string(), Value::from(src_count));
            let src_names: Value = serde_json::from_str(&src_names_json).unwrap_or(Value::Array(vec![]));
            map.insert("download_source_names".to_string(), src_names.clone());
            map.insert("source_names".to_string(), src_names);
            if let Some(desc) = localized_desc {
                if !desc.trim().is_empty() {
                    map.insert("short_description".to_string(), Value::String(desc));
                }
            }
        }
        items.push(val);
    }

    log_catalog_query(
        params,
        &count_sql,
        &sql_params,
        &select_sql,
        &select_params,
        total,
        &items,
        started.elapsed(),
    );

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
    use std::io::Write;
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

    // ---- Catalog sync against a fake GitHub ----
    // These run the real sync (HTTP, sha check, gunzip, apply) against a local server that records every request, so
    // they fail if the app asks for anything it does not need: a second download, the whole package when a patch
    // exists, or any request to our server (the old reconciliation POSTed every AppID on each startup).

    struct FakeGithub { base: String, files: std::sync::Arc<Mutex<std::collections::HashMap<String, Vec<u8>>>>,
        log: std::sync::Arc<Mutex<Vec<String>>> }

    impl FakeGithub {
        fn start() -> Self {
            use std::io::{BufRead, BufReader};
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
            let files = std::sync::Arc::new(Mutex::new(std::collections::HashMap::<String, Vec<u8>>::new()));
            let log = std::sync::Arc::new(Mutex::new(Vec::new()));
            let (served, logged) = (files.clone(), log.clone());
            std::thread::spawn(move || for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                if reader.read_line(&mut request).is_err() { continue }
                let mut length = 0usize;
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap_or(0) == 0 || header == "\r\n" { break }
                    if let Some(value) = header.to_ascii_lowercase().strip_prefix("content-length:") { length = value.trim().parse().unwrap_or(0) }
                }
                let mut body = vec![0; length];
                let _ = reader.read_exact(&mut body);
                let mut parts = request.split_whitespace();
                let (method, path) = (parts.next().unwrap_or("").to_string(), parts.next().unwrap_or("").to_string());
                logged.lock().unwrap().push(format!("{method} {path}"));
                let file = if method == "GET" { served.lock().unwrap().get(&path).cloned() } else { None };
                let head = match &file { Some(bytes) => format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", bytes.len()),
                    None => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string() };
                let _ = stream.write_all(head.as_bytes());
                if let Some(bytes) = file { let _ = stream.write_all(&bytes); }
            });
            Self { base, files, log }
        }
        fn put(&self, path: &str, bytes: Vec<u8>) { self.files.lock().unwrap().insert(path.into(), bytes); }
        fn url(&self, path: &str) -> String { format!("{}{path}", self.base) }
        /// The requests made since the last call.
        fn take(&self) -> Vec<String> { std::mem::take(&mut *self.log.lock().unwrap()) }
    }

    fn gzip(bytes: &[u8]) -> Vec<u8> {
        let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        encoder.write_all(bytes).unwrap();
        encoder.finish().unwrap()
    }
    fn sha(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

    /// A catalog database at `revision` with these (id, app_id, name) games, as installed or as a published package.
    fn catalog_db(path: &Path, revision: &str, generated_at: &str, games: &[(i64, i64, &str)]) {
        let db = Connection::open(path).unwrap();
        db.execute_batch("CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY,app_id INTEGER,payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER,language TEXT,country TEXT,payload TEXT,PRIMARY KEY(game_id,language,country));").unwrap();
        for (key, value) in [("schema_version", CACHE_SCHEMA_VERSION.to_string()), ("revision", revision.into()), ("generated_at", generated_at.into())] {
            db.execute("INSERT INTO metadata VALUES(?1,?2)", params![key, value]).unwrap();
        }
        for (id, app_id, name) in games {
            db.execute("INSERT INTO catalog_game VALUES(?1,?2,?3)", params![id, app_id, serde_json::json!({"id":id,"app_id":app_id,"name":name}).to_string()]).unwrap();
        }
    }
    fn names(path: &Path) -> Vec<String> {
        let db = Connection::open(path).unwrap();
        let mut statement = db.prepare("SELECT payload FROM catalog_game ORDER BY id").unwrap();
        let rows = statement.query_map([], |r| r.get::<_, String>(0)).unwrap()
            .map(|p| serde_json::from_str::<Value>(&p.unwrap()).unwrap()["name"].as_str().unwrap().to_string()).collect();
        rows
    }

    /// GitHub as the daily job leaves it: revision r2 (3 games), the whole package, and the patch from r1.
    fn publish_r2(github: &FakeGithub, patch_sha: Option<&str>, patch_base: &str) {
        let package = temp_target();
        catalog_db(&package, "r2", "2026-10-24T04:20:00Z", &[(1, 10, "Alpha renamed"), (2, 20, "Beta"), (3, 30, "Gamma")]);
        let package_gz = gzip(&fs::read(&package).unwrap());
        let patch_gz = gzip(serde_json::json!({"schema_version": CACHE_SCHEMA_VERSION, "base_revision": patch_base, "revision": "r2",
            "games": [{"id":1,"app_id":10,"name":"Alpha renamed"}, {"id":3,"app_id":30,"name":"Gamma"}], "details": []}).to_string().as_bytes());
        let manifest = serde_json::json!({"schema_version": CACHE_SCHEMA_VERSION, "revision": "r2", "generated_at": "2026-10-24T04:20:00Z",
            "artifact_url": github.url("/catalog-cache-r2.sqlite.gz"), "sha256": sha(&package_gz), "catalog_count": 3,
            "updates": {"r1": {"artifact_url": github.url("/catalog-update-r1-r2.json.gz"),
                "sha256": patch_sha.map(String::from).unwrap_or_else(|| sha(&patch_gz)), "compressed_bytes": patch_gz.len()}}});
        github.put("/catalog-manifest.json", manifest.to_string().into_bytes());
        github.put("/catalog-cache-r2.sqlite.gz", package_gz);
        github.put("/catalog-update-r1-r2.json.gz", patch_gz);
        let _ = fs::remove_dir_all(package.parent().unwrap());
    }
    const MANIFEST: &str = "GET /catalog-manifest.json";

    #[test]
    fn startups_with_an_up_to_date_catalog_only_read_the_manifest() {
        let github = FakeGithub::start();
        publish_r2(&github, None, "r1");
        let target = temp_target();
        catalog_db(&target, "r2", "2026-10-24T04:20:00Z", &[(1, 10, "Alpha renamed"), (2, 20, "Beta"), (3, 30, "Gamma")]);
        for _ in 0..3 {
            let result = sync_into(&target, &github.url("/catalog-manifest.json"), &no_progress).unwrap();
            assert!(!result.updated);
            assert_eq!(result.catalog_count, 3);
            assert_eq!((result.downloaded, result.downloaded_bytes), ("nothing", 0));
            assert!(result.manifest_ms <= result.total_ms);
            assert_eq!(github.take(), vec![MANIFEST], "an up-to-date startup must make exactly one small request");
        }
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn one_revision_behind_downloads_only_its_patch_and_then_stays_quiet() {
        let github = FakeGithub::start();
        publish_r2(&github, None, "r1");
        let target = temp_target();
        catalog_db(&target, "r1", "2026-10-23T04:20:00Z", &[(1, 10, "Alpha"), (2, 20, "Beta")]);
        let result = sync_into(&target, &github.url("/catalog-manifest.json"), &no_progress).unwrap();
        assert!(result.updated);
        assert_eq!((result.revision.as_str(), result.catalog_count), ("r2", 3));
        assert_eq!(github.take(), vec![MANIFEST, "GET /catalog-update-r1-r2.json.gz"], "the patch, never the whole package");
        assert_eq!(result.downloaded, "patch");
        assert_eq!(result.downloaded_bytes, github.files.lock().unwrap()["/catalog-update-r1-r2.json.gz"].len() as u64);
        assert_eq!(names(&target), ["Alpha renamed", "Beta", "Gamma"]);
        assert_eq!(current_cache_info(&target).unwrap().unwrap().0, "r2");
        // The next startup finds the catalog current: the manifest again and nothing else.
        assert!(!sync_into(&target, &github.url("/catalog-manifest.json"), &no_progress).unwrap().updated);
        assert_eq!(github.take(), vec![MANIFEST]);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn too_far_behind_downloads_the_whole_package_once() {
        let github = FakeGithub::start();
        publish_r2(&github, None, "r1");
        let target = temp_target();
        catalog_db(&target, "r0", "2026-10-01T04:20:00Z", &[(1, 10, "Alpha")]);
        let result = sync_into(&target, &github.url("/catalog-manifest.json"), &no_progress).unwrap();
        assert_eq!((result.updated, result.revision.as_str(), result.catalog_count), (true, "r2", 3));
        assert_eq!(github.take(), vec![MANIFEST, "GET /catalog-cache-r2.sqlite.gz"]);
        assert_eq!(result.downloaded, "package");
        assert_eq!(names(&target), ["Alpha renamed", "Beta", "Gamma"]);
        assert!(!sync_into(&target, &github.url("/catalog-manifest.json"), &no_progress).unwrap().updated);
        assert_eq!(github.take(), vec![MANIFEST]);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn a_corrupted_patch_leaves_the_installed_catalog_untouched() {
        let github = FakeGithub::start();
        publish_r2(&github, Some("0000"), "r1");
        let target = temp_target();
        catalog_db(&target, "r1", "2026-10-23T04:20:00Z", &[(1, 10, "Alpha"), (2, 20, "Beta")]);
        assert!(sync_into(&target, &github.url("/catalog-manifest.json"), &no_progress).unwrap_err().contains("SHA-256"));
        assert_eq!(current_cache_info(&target).unwrap().unwrap(), ("r1".to_string(), 2));
        assert_eq!(names(&target), ["Alpha", "Beta"]);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn a_patch_built_from_another_revision_is_refused() {
        let github = FakeGithub::start();
        publish_r2(&github, None, "r9");
        let target = temp_target();
        catalog_db(&target, "r1", "2026-10-23T04:20:00Z", &[(1, 10, "Alpha"), (2, 20, "Beta")]);
        assert!(sync_into(&target, &github.url("/catalog-manifest.json"), &no_progress).is_err());
        assert_eq!(names(&target), ["Alpha", "Beta"]);
        let _ = fs::remove_dir_all(target.parent().unwrap());
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
        let manifest=CatalogManifest{schema_version:1,revision:"new".into(),artifact_url:String::new(),sha256:String::new(),catalog_count:1,generated_at:String::new(),kind:"delta".into(),base_revision:"old".into(),updates:Default::default()};
        let count=apply_batch(&target,vec![serde_json::json!({"id":99,"app_id":233980,"short_description":"","tags":[],"steam_review_score":95})],
            vec![DetailChange{game_id:99,app_id:Some(233980),language:"spanish".into(),country:"ar".into(),payload:serde_json::json!({"steam":{"screenshots":[],"short_description":null}})}],&manifest,&no_progress).unwrap();
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
    fn manifest_lists_the_patch_from_each_recent_revision() {
        let manifest:CatalogManifest=serde_json::from_str(r#"{"schema_version":1,"revision":"new","artifact_url":"https://raw.githubusercontent.com/a/b/c.sqlite.gz",
            "sha256":"x","catalog_count":3,"updates":{"old":{"artifact_url":"https://raw.githubusercontent.com/a/b/old-new.json.gz","sha256":"y","compressed_bytes":10}}}"#).unwrap();
        assert_eq!(manifest.updates["old"].artifact_url,"https://raw.githubusercontent.com/a/b/old-new.json.gz");
        assert!(manifest.updates.get("older").is_none());
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
        let mut conn = Connection::open(&target).unwrap();
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

        // Apply download sources for Alpha Game (app_id 100)
        crate::source_index::apply_sources_conn(
            &mut conn,
            "ga-torrent-provider",
            "1",
            true,
            vec![
                crate::source_index::SourceIndexEntry {
                    key: String::new(),
                    title: "Alpha Game v1.0 [FitGirl Repack]".into(),
                    source: "FitGirl".into(),
                    multiplayer: false,
                },
                crate::source_index::SourceIndexEntry {
                    key: String::new(),
                    title: "Alpha Game Deluxe Edition".into(),
                    source: "DODI".into(),
                    multiplayer: false,
                },
            ],
            vec![],
        )
        .unwrap();

        // Query filtering by has_downloads and source_name
        let with_downloads = query_catalog_conn(
            &conn,
            &CatalogQueryParams {
                has_downloads: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(with_downloads.total, 1);
        assert_eq!(with_downloads.items[0]["app_id"], 100);
        assert_eq!(with_downloads.items[0]["source_count"], 2);
        assert_eq!(with_downloads.items[0]["availableSourceCount"], 2);
        let mut names: Vec<String> = serde_json::from_value(with_downloads.items[0]["source_names"].clone()).unwrap();
        names.sort();
        assert_eq!(names, vec!["DODI".to_string(), "FitGirl".to_string()]);

        let by_source = query_catalog_conn(
            &conn,
            &CatalogQueryParams {
                sources: Some(vec!["FitGirl".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(by_source.total, 1);

        let excluded_source = query_catalog_conn(
            &conn,
            &CatalogQueryParams {
                exclude_sources: Some(vec!["FitGirl".into()]),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(excluded_source.total, 1);
        assert_eq!(excluded_source.items[0]["app_id"], 200);

        drop(conn);
        let _ = fs::remove_dir_all(target.parent().unwrap());
    }

    #[test]
    fn test_catalog_query_84k_sources_40k_games_performance() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE IF NOT EXISTS catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);").unwrap();
        ensure_normalized_schema(&conn).unwrap();

        let tx = conn.unchecked_transaction().unwrap();
        {
            let mut ins_game = tx
                .prepare("INSERT INTO game(id, app_id, slug, name, active) VALUES (?1, ?2, ?3, ?4, 1)")
                .unwrap();
            let mut ins_meta = tx
                .prepare("INSERT INTO game_metadata(game_id, release_date, recommendation_count, steam_review_score, steam_review_count) VALUES (?1, '2026-01-15', ?2, 85.0, 500)")
                .unwrap();
            for i in 1..=40_000i64 {
                let app_id = i * 10;
                ins_game
                    .execute(params![i, app_id, format!("game-{i}"), format!("Game Title {i}")])
                    .unwrap();
                ins_meta.execute(params![i, 40_000 - i]).unwrap();
            }

            let mut ins_ds = tx
                .prepare("INSERT INTO download_sources(source_key, plugin_id, source_name, title_raw, multiplayer, revision) VALUES (?1, 'p1', ?2, ?3, 0, '1')")
                .unwrap();
            let mut ins_gs = tx
                .prepare("INSERT INTO game_sources(app_id, source_key, score) VALUES (?1, ?2, 0.95)")
                .unwrap();
            let providers = ["FitGirl", "DODI", "SteamRIP", "OnlineFix", "GOG", "ElAmigos"];
            for s in 1..=84_000i64 {
                let key = format!("k{s}");
                let prov = providers[(s as usize) % providers.len()];
                ins_ds
                    .execute(params![&key, prov, format!("Release {s}")])
                    .unwrap();
                // Link ~28,000 sources across ~14,000 games
                if s <= 28_000 {
                    let game_idx = ((s - 1) % 14_000) + 1;
                    let app_id = game_idx * 10;
                    let _ = ins_gs.execute(params![app_id, &key]);
                }
            }
        }
        tx.commit().unwrap();

        // Warm-up / analyze
        let _ = conn.execute_batch("ANALYZE;");

        let start_has_dl = std::time::Instant::now();
        let res_has_dl = query_catalog_conn(
            &conn,
            &CatalogQueryParams {
                has_downloads: Some(true),
                limit: Some(70),
                ..Default::default()
            },
        )
        .unwrap();
        let elapsed_has_dl = start_has_dl.elapsed();
        assert_eq!(res_has_dl.total, 14_000);
        assert_eq!(res_has_dl.items.len(), 70);
        assert!(
            elapsed_has_dl.as_millis() < 50,
            "has_downloads query on 40k games / 84k sources took {} ms (expected < 50 ms)",
            elapsed_has_dl.as_millis()
        );

        let start_src = std::time::Instant::now();
        let res_src = query_catalog_conn(
            &conn,
            &CatalogQueryParams {
                sources: Some(vec!["FitGirl".into()]),
                limit: Some(70),
                ..Default::default()
            },
        )
        .unwrap();
        let elapsed_src = start_src.elapsed();
        assert!(res_src.total > 0);
        assert_eq!(res_src.items.len(), 70);
        assert!(
            elapsed_src.as_millis() < 50,
            "sources filter query on 40k games / 84k sources took {} ms (expected < 50 ms)",
            elapsed_src.as_millis()
        );
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
    fn test_catalog_query_min_review_count_is_strict() {
        let target = temp_target();
        let conn = Connection::open(&target).unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game_detail(game_id INTEGER, language TEXT, country TEXT, payload TEXT, PRIMARY KEY(game_id, language, country));
            INSERT INTO catalog_game VALUES(1, 10, '{\"id\":1,\"app_id\":10,\"name\":\"G1\",\"steam_review_score\":90,\"steam_review_count\":100}');
            INSERT INTO catalog_game VALUES(2, 20, '{\"id\":2,\"app_id\":20,\"name\":\"G2\",\"steam_review_score\":90,\"steam_review_count\":99}');
            INSERT INTO catalog_game VALUES(3, 30, '{\"id\":3,\"app_id\":30,\"name\":\"G3\"}');
            INSERT INTO catalog_game VALUES(4, 40, '{\"id\":4,\"app_id\":40,\"name\":\"G4\",\"steam_review_score\":40,\"steam_review_count\":2}');
            INSERT INTO catalog_game VALUES(5, 50, '{\"id\":5,\"app_id\":50,\"name\":\"G5\",\"steam_review_score\":30,\"steam_review_count\":5000}');
        ").unwrap();
        ensure_normalized_schema(&conn).unwrap();

        let ids = |params: &CatalogQueryParams| -> Vec<i64> {
            let mut ids: Vec<i64> = query_catalog_conn(&conn, params).unwrap().items.iter().map(|item| item["id"].as_i64().unwrap()).collect();
            ids.sort();
            ids
        };

        // Alone: only games with at least 100 reviews. No count on record does not pass.
        let floor = CatalogQueryParams { min_review_count: Some(100), ..Default::default() };
        assert_eq!(ids(&floor), vec![1, 5]);

        // With a score bar that spares unproven games, the floor still wins: game 4 (2 reviews) and
        // game 3 (none) stay hidden, and game 5 falls to the score bar.
        let both = CatalogQueryParams {
            min_rating: Some(6.0),
            include_recent_unrated: Some(true),
            min_review_count: Some(100),
            ..Default::default()
        };
        assert_eq!(ids(&both), vec![1]);

        // Zero means no floor.
        let none = CatalogQueryParams { min_review_count: Some(0), ..Default::default() };
        assert_eq!(ids(&none), vec![1, 2, 3, 4, 5]);

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
