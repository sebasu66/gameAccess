use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use unicode_normalization::UnicodeNormalization;

const RELEASE_PREFIXES: &[&str] = &["fitgirl", "dodi", "repack", "repacks", "onlinefix"];

// NOTE: As in ga-torrent-plugin/matcher.js, release keywords are matched with
// "starts with" (`^(?:v\d|...|all|with|win|...)`), so tokens like "allstars",
// "without", or "winter" count as release markers. Ported 1:1 per contract.
const RELEASE_MARKER_PREFIXES: &[&str] = &[
    "build",
    "version",
    "ver",
    "free",
    "download",
    "repack",
    "repacks",
    "update",
    "all",
    "dlc",
    "deluxe",
    "ultimate",
    "complete",
    "edition",
    "goty",
    "onlinefix",
    "fitgirl",
    "dodi",
    "steamrip",
    "gog",
    "incl",
    "including",
    "with",
    "win",
    "windows",
];

fn strip_parens_and_brackets(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(ch) = rest.chars().next() {
        let after = &rest[ch.len_utf8()..];
        if ch == '(' {
            if let Some(end) = after.find(')') {
                out.push(' ');
                rest = &after[end + 1..];
                continue;
            }
        } else if ch == '[' {
            if let Some(end) = after.find(']') {
                out.push(' ');
                rest = &after[end + 1..];
                continue;
            }
        }
        out.push(ch);
        rest = after;
    }
    out
}

fn is_letter_or_number(ch: char) -> bool {
    ch.is_alphabetic() || ch.is_numeric()
}

/// Exact port of `cleanTitle(title, split)` from `ga-torrent-plugin/matcher.js`.
/// `split = true` separates camelCase words (`DeadSpace` -> `dead space`);
/// `split = false` keeps them joined (`GunMan` -> `gunman`).
pub fn clean_title(title: &str, split: bool) -> String {
    if title.is_empty() {
        return String::new();
    }

    // 1. Remove ®™©℠, apply NFKD decomposition, and strip combining diacritics \u{0300}..=\u{036f}
    let decomposed: String = title
        .chars()
        .filter(|&c| !matches!(c, '®' | '™' | '©' | '℠'))
        .nfkd()
        .filter(|&c| !('\u{0300}'..='\u{036f}').contains(&c))
        .collect();

    // 2. Replace (...) and [...] with space
    let no_brackets = strip_parens_and_brackets(&decomposed);

    // 3. Optional camelCase split ([a-z][A-Z] -> "$1 $2"), strip ['’], expand & -> " and "
    let mut expanded = String::with_capacity(no_brackets.len() + 8);
    let mut prev_ascii_lower = false;
    for ch in no_brackets.chars() {
        if split && prev_ascii_lower && ch.is_ascii_uppercase() {
            expanded.push(' ');
        }
        prev_ascii_lower = ch.is_ascii_lowercase();

        match ch {
            '\'' | '’' => {}
            '&' => expanded.push_str(" and "),
            _ => expanded.push(ch),
        }
    }

    // 4. Replace runs of non-[\p{L}\p{N}] with a single space, trim, and lowercase
    let mut result = String::with_capacity(expanded.len());
    let mut in_space = true; // trims leading spaces
    for ch in expanded.chars() {
        if is_letter_or_number(ch) {
            for lc in ch.to_lowercase() {
                result.push(lc);
            }
            in_space = false;
        } else if !in_space {
            result.push(' ');
            in_space = true;
        }
    }
    if result.ends_with(' ') {
        result.pop();
    }
    result
}

fn is_release_marker(marker: &str) -> bool {
    let bytes = marker.as_bytes();
    if bytes.len() >= 2 && bytes[0] == b'v' && bytes[1].is_ascii_digit() {
        return true;
    }
    if bytes.len() >= 6 && marker.starts_with("multi") && bytes[5].is_ascii_digit() {
        return true;
    }
    RELEASE_MARKER_PREFIXES
        .iter()
        .any(|prefix| marker.starts_with(prefix))
}

fn is_ascii_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Equivalent to `/\b\d+\.\d+/.test(raw_title)` in JavaScript.
fn has_word_bounded_dotted_digits(raw_title: &str) -> bool {
    let bytes = raw_title.as_bytes();
    let len = bytes.len();
    let mut i = 0;
    while i < len {
        if bytes[i].is_ascii_digit() {
            let word_boundary =
                i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_');
            let mut j = i + 1;
            while j < len && bytes[j].is_ascii_digit() {
                j += 1;
            }
            if word_boundary && j + 1 < len && bytes[j] == b'.' && bytes[j + 1].is_ascii_digit() {
                return true;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    false
}

fn score_with_cleaned(name: &str, title: &str, has_dotted_digits: bool) -> f64 {
    if name.is_empty() || title.is_empty() {
        return 0.0;
    }
    if name == title {
        return 1.0;
    }
    let title_tokens_vec: Vec<&str> = title.split(' ').collect();
    let game_tokens: Vec<&str> = name.split(' ').collect();

    let mut tokens = title_tokens_vec.as_slice();
    while let Some(&first) = tokens.first() {
        if RELEASE_PREFIXES.contains(&first) {
            tokens = &tokens[1..];
        } else {
            break;
        }
    }

    if tokens.len() < game_tokens.len() || &tokens[..game_tokens.len()] != game_tokens.as_slice() {
        return 0.0;
    }

    let rest = &tokens[game_tokens.len()..];
    if rest.is_empty() {
        return 0.95;
    }

    let marker = rest[0];
    let dotted_version = is_ascii_digits(marker)
        && rest.get(1).map_or(false, |next| is_ascii_digits(next))
        && has_dotted_digits;

    if is_release_marker(marker) || dotted_version {
        0.9
    } else {
        0.0
    }
}

pub fn score_with(game_name: &str, raw_title: &str, split: bool) -> f64 {
    let name = clean_title(game_name, split);
    let title = clean_title(raw_title, split);
    score_with_cleaned(&name, &title, has_word_bounded_dotted_digits(raw_title))
}

/// Exact port of `calculateScore(gameName, rawTitle)` from `ga-torrent-plugin/matcher.js`.
pub fn calculate_score(game_name: &str, raw_title: &str) -> f64 {
    score_with(game_name, raw_title, true).max(score_with(game_name, raw_title, false))
}

/// Computes `sha256(source_name + "\0" + raw_title)` as lowercase hex.
pub fn compute_source_key(source_name: &str, title_raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_name.as_bytes());
    hasher.update([0u8]);
    hasher.update(title_raw.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn deserialize_multiplayer<'de, D>(deserializer: D) -> Result<bool, D::Error>
where
    D: Deserializer<'de>,
{
    let val = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(match val {
        Some(serde_json::Value::Bool(b)) => b,
        Some(serde_json::Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(serde_json::Value::String(s)) => matches!(s.trim().to_ascii_lowercase().as_str(), "1" | "true"),
        _ => false,
    })
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SourceIndexEntry {
    #[serde(default, alias = "source_key")]
    pub key: String,
    #[serde(alias = "title_raw", alias = "raw_title")]
    pub title: String,
    #[serde(alias = "source_name")]
    pub source: String,
    #[serde(default, deserialize_with = "deserialize_multiplayer")]
    pub multiplayer: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogSourcesApplyResult {
    pub plugin_id: String,
    pub revision: String,
    pub sources_total: usize,
    pub matched_links: usize,
}

pub fn ensure_source_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS download_sources (
            source_key TEXT PRIMARY KEY,
            plugin_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            title_raw TEXT NOT NULL,
            multiplayer INTEGER DEFAULT 0,
            revision TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_download_sources_plugin ON download_sources(plugin_id);
        CREATE INDEX IF NOT EXISTS ix_download_sources_name ON download_sources(source_name);
        CREATE INDEX IF NOT EXISTS ix_download_sources_key_name ON download_sources(source_key, source_name);

        CREATE TABLE IF NOT EXISTS game_sources (
            app_id INTEGER NOT NULL,
            source_key TEXT NOT NULL REFERENCES download_sources(source_key) ON DELETE CASCADE,
            score REAL NOT NULL,
            PRIMARY KEY (app_id, source_key)
        );
        CREATE INDEX IF NOT EXISTS ix_game_sources_app_id ON game_sources(app_id);
        CREATE INDEX IF NOT EXISTS ix_game_sources_source_key ON game_sources(source_key);",
    )
    .map_err(|e| e.to_string())
}

struct IndexedGame {
    app_id: i64,
    clean_split: String,
    clean_nosplit: String,
}

struct GameTitleIndex {
    games: Vec<IndexedGame>,
    by_clean: HashMap<String, Vec<usize>>,
}

impl GameTitleIndex {
    fn from_pairs(pairs: impl IntoIterator<Item = (i64, String)>) -> Self {
        let mut games = Vec::new();
        let mut by_clean: HashMap<String, Vec<usize>> = HashMap::new();
        for (app_id, name) in pairs {
            let clean_split = clean_title(&name, true);
            let clean_nosplit = clean_title(&name, false);
            if clean_split.is_empty() && clean_nosplit.is_empty() {
                continue;
            }
            let idx = games.len();
            if !clean_split.is_empty() {
                by_clean.entry(clean_split.clone()).or_default().push(idx);
            }
            if !clean_nosplit.is_empty() && clean_nosplit != clean_split {
                by_clean.entry(clean_nosplit.clone()).or_default().push(idx);
            }
            games.push(IndexedGame {
                app_id,
                clean_split,
                clean_nosplit,
            });
        }
        Self { games, by_clean }
    }

    fn from_db(tx: &Transaction<'_>) -> Result<Self, String> {
        let mut stmt = tx
            .prepare("SELECT COALESCE(app_id, id), name FROM game WHERE COALESCE(app_id, id) IS NOT NULL AND trim(name) != ''")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?;
        let mut pairs = Vec::new();
        for row in rows {
            pairs.push(row.map_err(|e| e.to_string())?);
        }
        Ok(Self::from_pairs(pairs))
    }

    fn collect_candidates_for_clean(&self, clean: &str, out: &mut Vec<usize>) {
        if clean.is_empty() {
            return;
        }
        if let Some(indices) = self.by_clean.get(clean) {
            out.extend_from_slice(indices);
        }
        let mut stripped = clean;
        loop {
            let (first, rest) = match stripped.split_once(' ') {
                Some((f, r)) => (f, r),
                None => (stripped, ""),
            };
            if RELEASE_PREFIXES.contains(&first) {
                stripped = rest;
                if stripped.is_empty() {
                    return;
                }
            } else {
                break;
            }
        }
        let bytes = stripped.as_bytes();
        for (i, &b) in bytes.iter().enumerate() {
            if b == b' ' {
                if let Some(indices) = self.by_clean.get(&stripped[..i]) {
                    out.extend_from_slice(indices);
                }
            }
        }
        if let Some(indices) = self.by_clean.get(stripped) {
            out.extend_from_slice(indices);
        }
    }

    fn match_source(&self, title_raw: &str, candidates_buf: &mut Vec<usize>) -> Vec<(i64, f64)> {
        let title_split = clean_title(title_raw, true);
        let title_nosplit = clean_title(title_raw, false);
        if title_split.is_empty() && title_nosplit.is_empty() {
            return Vec::new();
        }
        candidates_buf.clear();
        self.collect_candidates_for_clean(&title_split, candidates_buf);
        if title_nosplit != title_split {
            self.collect_candidates_for_clean(&title_nosplit, candidates_buf);
        }
        if candidates_buf.is_empty() {
            return Vec::new();
        }
        candidates_buf.sort_unstable();
        candidates_buf.dedup();

        let has_dotted = has_word_bounded_dotted_digits(title_raw);
        let mut matches = Vec::new();
        for &idx in candidates_buf.iter() {
            let game = &self.games[idx];
            let s1 = score_with_cleaned(&game.clean_split, &title_split, has_dotted);
            let s2 = score_with_cleaned(&game.clean_nosplit, &title_nosplit, has_dotted);
            let score = s1.max(s2);
            if score >= 0.55 {
                matches.push((game.app_id, score));
            }
        }
        matches
    }
}

pub fn apply_sources_conn(
    conn: &mut Connection,
    plugin_id: &str,
    revision: &str,
    full: bool,
    added: Vec<SourceIndexEntry>,
    removed: Vec<String>,
) -> Result<CatalogSourcesApplyResult, String> {
    ensure_source_tables(conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if full {
        tx.execute(
            "DELETE FROM game_sources WHERE source_key IN (SELECT source_key FROM download_sources WHERE plugin_id = ?1)",
            params![plugin_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM download_sources WHERE plugin_id = ?1",
            params![plugin_id],
        )
        .map_err(|e| e.to_string())?;
    } else if !removed.is_empty() {
        let mut del_gs = tx
            .prepare("DELETE FROM game_sources WHERE source_key = ?1")
            .map_err(|e| e.to_string())?;
        let mut del_ds = tx
            .prepare("DELETE FROM download_sources WHERE source_key = ?1 AND plugin_id = ?2")
            .map_err(|e| e.to_string())?;
        for key in &removed {
            let trimmed = key.trim();
            if !trimmed.is_empty() {
                del_gs.execute(params![trimmed]).map_err(|e| e.to_string())?;
                del_ds
                    .execute(params![trimmed, plugin_id])
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    if !added.is_empty() {
        let game_index = GameTitleIndex::from_db(&tx)?;
        let mut ins_ds = tx
            .prepare(
                "INSERT INTO download_sources(source_key, plugin_id, source_name, title_raw, multiplayer, revision)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(source_key) DO UPDATE SET
                    plugin_id = excluded.plugin_id,
                    source_name = excluded.source_name,
                    title_raw = excluded.title_raw,
                    multiplayer = excluded.multiplayer,
                    revision = excluded.revision",
            )
            .map_err(|e| e.to_string())?;
        let mut del_gs_key = tx
            .prepare("DELETE FROM game_sources WHERE source_key = ?1")
            .map_err(|e| e.to_string())?;
        let mut ins_gs = tx
            .prepare(
                "INSERT INTO game_sources(app_id, source_key, score)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(app_id, source_key) DO UPDATE SET score = MAX(game_sources.score, excluded.score)",
            )
            .map_err(|e| e.to_string())?;

        let mut candidates_buf = Vec::with_capacity(16);
        for entry in added {
            let title_raw = entry.title.trim();
            if title_raw.is_empty() {
                continue;
            }
            let source_name = entry.source.trim();
            let key = if entry.key.trim().is_empty() {
                compute_source_key(source_name, title_raw)
            } else {
                entry.key.trim().to_string()
            };
            let mp = if entry.multiplayer { 1 } else { 0 };

            if !full {
                del_gs_key.execute(params![&key]).map_err(|e| e.to_string())?;
            }
            ins_ds
                .execute(params![&key, plugin_id, source_name, title_raw, mp, revision])
                .map_err(|e| e.to_string())?;

            for (app_id, score) in game_index.match_source(title_raw, &mut candidates_buf) {
                ins_gs
                    .execute(params![app_id, &key, score])
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    let sources_total: usize = tx
        .query_row("SELECT COUNT(*) FROM download_sources", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let matched_links: usize = tx
        .query_row("SELECT COUNT(*) FROM game_sources", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(CatalogSourcesApplyResult {
        plugin_id: plugin_id.to_string(),
        revision: revision.to_string(),
        sources_total,
        matched_links,
    })
}

/// Incremental matching in the reverse direction: when `catalog_cache_sync` adds or updates
/// games, match only those touched games against the existing `download_sources`.
pub fn match_games_against_sources(
    tx: &Transaction<'_>,
    touched_games: &[(i64, String)],
) -> Result<(), String> {
    if touched_games.is_empty() {
        return Ok(());
    }
    let has_table: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='download_sources')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(false);
    if !has_table {
        return Ok(());
    }
    let source_count: i64 = tx
        .query_row("SELECT COUNT(*) FROM download_sources", [], |r| r.get(0))
        .unwrap_or(0);
    if source_count == 0 {
        return Ok(());
    }

    {
        let mut del_gs = tx
            .prepare("DELETE FROM game_sources WHERE app_id = ?1")
            .map_err(|e| e.to_string())?;
        for (app_id, _) in touched_games {
            del_gs.execute(params![app_id]).map_err(|e| e.to_string())?;
        }
    }

    let game_index = GameTitleIndex::from_pairs(touched_games.iter().cloned());
    if game_index.games.is_empty() {
        return Ok(());
    }

    let mut stmt = tx
        .prepare("SELECT source_key, title_raw FROM download_sources")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    let mut ins_gs = tx
        .prepare(
            "INSERT INTO game_sources(app_id, source_key, score)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(app_id, source_key) DO UPDATE SET score = MAX(game_sources.score, excluded.score)",
        )
        .map_err(|e| e.to_string())?;

    let mut candidates_buf = Vec::with_capacity(8);
    for row in rows {
        let (key, title_raw) = row.map_err(|e| e.to_string())?;
        for (app_id, score) in game_index.match_source(&title_raw, &mut candidates_buf) {
            ins_gs
                .execute(params![app_id, &key, score])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn remove_plugin_sources_conn(conn: &mut Connection, plugin_id: &str) -> Result<(), String> {
    ensure_source_tables(conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM game_sources WHERE source_key IN (SELECT source_key FROM download_sources WHERE plugin_id = ?1)",
        params![plugin_id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM download_sources WHERE plugin_id = ?1",
        params![plugin_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn catalog_sources_apply(
    plugin_id: String,
    revision: serde_json::Value,
    full: Option<bool>,
    added: Option<Vec<SourceIndexEntry>>,
    removed: Option<Vec<String>>,
) -> Result<CatalogSourcesApplyResult, String> {
    let rev_str = match revision {
        serde_json::Value::String(s) => s,
        serde_json::Value::Number(n) => n.to_string(),
        _ => String::new(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        crate::catalog_cache::with_catalog_conn(|conn| {
            apply_sources_conn(
                conn,
                &plugin_id,
                &rev_str,
                full.unwrap_or(false),
                added.unwrap_or_default(),
                removed.unwrap_or_default(),
            )
        })
    })
    .await
    .map_err(|err| format!("Catalog sources apply task failed: {err}"))?
}

#[tauri::command]
pub async fn catalog_sources_remove_plugin(plugin_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::catalog_cache::with_catalog_conn(|conn| remove_plugin_sources_conn(conn, &plugin_id))
    })
    .await
    .map_err(|err| format!("Catalog sources remove plugin task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct GoldenPair {
        game_name: String,
        raw_title: String,
        clean_game_split: String,
        clean_game_nosplit: String,
        clean_title_split: String,
        clean_title_nosplit: String,
        score: f64,
    }

    #[test]
    fn test_matcher_golden_contract() {
        let raw_json = include_str!("matcher_golden.json");
        let pairs: Vec<GoldenPair> =
            serde_json::from_str(raw_json).expect("valid matcher_golden.json");
        assert!(
            pairs.len() >= 500,
            "expected at least 500 golden pairs, got {}",
            pairs.len()
        );

        for (idx, pair) in pairs.iter().enumerate() {
            assert_eq!(
                clean_title(&pair.game_name, true),
                pair.clean_game_split,
                "pair #{idx}: clean_title(game_name={:?}, split=true) mismatch",
                pair.game_name
            );
            assert_eq!(
                clean_title(&pair.game_name, false),
                pair.clean_game_nosplit,
                "pair #{idx}: clean_title(game_name={:?}, split=false) mismatch",
                pair.game_name
            );
            assert_eq!(
                clean_title(&pair.raw_title, true),
                pair.clean_title_split,
                "pair #{idx}: clean_title(raw_title={:?}, split=true) mismatch",
                pair.raw_title
            );
            assert_eq!(
                clean_title(&pair.raw_title, false),
                pair.clean_title_nosplit,
                "pair #{idx}: clean_title(raw_title={:?}, split=false) mismatch",
                pair.raw_title
            );
            let actual_score = calculate_score(&pair.game_name, &pair.raw_title);
            assert!(
                (actual_score - pair.score).abs() < 1e-12,
                "pair #{idx}: calculate_score({:?}, {:?}) => got {}, expected {}",
                pair.game_name,
                pair.raw_title,
                actual_score,
                pair.score
            );
        }
    }

    #[test]
    fn test_catalog_sources_apply_full_delta_and_remove_plugin() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::catalog_cache::ensure_normalized_schema(&conn).unwrap();

        conn.execute(
            "INSERT INTO game(id, app_id, slug, name) VALUES
             (1, 1245620, 'elden-ring', 'Elden Ring'),
             (2, 1091500, 'cyberpunk-2077', 'Cyberpunk 2077'),
             (3, 1693980, 'dead-space', 'Dead Space')",
            [],
        )
        .unwrap();

        let k1 = compute_source_key("FitGirl", "Elden Ring Deluxe Edition [FitGirl Repack]");
        let k2 = compute_source_key("DODI", "DeadSpace Remake v1.0");
        let k3 = compute_source_key("SteamRIP", "Unrelated Game v1.0");

        let res = apply_sources_conn(
            &mut conn,
            "ga-torrent-provider",
            "1",
            true,
            vec![
                SourceIndexEntry {
                    key: k1.clone(),
                    title: "Elden Ring Deluxe Edition [FitGirl Repack]".into(),
                    source: "FitGirl".into(),
                    multiplayer: false,
                },
                SourceIndexEntry {
                    key: k2.clone(),
                    title: "DeadSpace Remake v1.0".into(),
                    source: "DODI".into(),
                    multiplayer: false,
                },
                SourceIndexEntry {
                    key: k3.clone(),
                    title: "Unrelated Game v1.0".into(),
                    source: "SteamRIP".into(),
                    multiplayer: false,
                },
            ],
            vec![],
        )
        .unwrap();

        assert_eq!(res.sources_total, 3);
        // Elden Ring matches k1 (0.9); Dead Space does NOT match "DeadSpace Remake" (Remake is not a release marker)
        assert_eq!(res.matched_links, 1);

        // Incremental delta: remove k1, add DeadSpace v1.0 and Cyberpunk 2077 2.12
        let k4 = compute_source_key("DODI", "DeadSpace v1.0");
        let k5 = compute_source_key("OnlineFix", "OnlineFix Cyberpunk 2077 v2.12");
        let res2 = apply_sources_conn(
            &mut conn,
            "ga-torrent-provider",
            "2",
            false,
            vec![
                SourceIndexEntry {
                    key: k4.clone(),
                    title: "DeadSpace v1.0".into(),
                    source: "DODI".into(),
                    multiplayer: false,
                },
                SourceIndexEntry {
                    key: k5.clone(),
                    title: "OnlineFix Cyberpunk 2077 v2.12".into(),
                    source: "OnlineFix".into(),
                    multiplayer: true,
                },
            ],
            vec![k1.clone()],
        )
        .unwrap();

        assert_eq!(res2.sources_total, 4); // k2, k3, k4, k5
        assert_eq!(res2.matched_links, 2); // Dead Space (k4) + Cyberpunk (k5)

        // Reverse incremental: adding a new game matches against existing download_sources
        {
            let tx = conn.transaction().unwrap();
            tx.execute(
                "INSERT INTO game(id, app_id, slug, name) VALUES (4, 999999, 'unrelated-game', 'Unrelated Game')",
                [],
            )
            .unwrap();
            match_games_against_sources(&tx, &[(999999, "Unrelated Game".to_string())]).unwrap();
            tx.commit().unwrap();
        }
        let matched_after_game_sync: i64 = conn
            .query_row("SELECT COUNT(*) FROM game_sources WHERE app_id = 999999", [], |r| r.get(0))
            .unwrap();
        assert_eq!(matched_after_game_sync, 1);

        // Removing plugin deletes all its sources and game_sources
        remove_plugin_sources_conn(&mut conn, "ga-torrent-provider").unwrap();
        let remaining_ds: i64 = conn
            .query_row("SELECT COUNT(*) FROM download_sources", [], |r| r.get(0))
            .unwrap();
        let remaining_gs: i64 = conn
            .query_row("SELECT COUNT(*) FROM game_sources", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining_ds, 0);
        assert_eq!(remaining_gs, 0);
    }
}
