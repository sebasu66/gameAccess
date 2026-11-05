//! The genre vocabulary at the door of the catalog: one spelling per concept, whatever the language it arrived in.
//!
//! The table is `src/genreConcepts.json`, the same one the interface and the catalog pipeline read. Every path that
//! writes a game goes through here, so `catalog_game.payload` and `game_genre` hold only canonical names. A value the
//! table does not know keeps its text; a content warning or a perspective is not a genre and is dropped.

use rusqlite::{params, Connection};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

const TABLE: &str = include_str!("../../src/genreConcepts.json");
const VERSION_KEY: &str = "genre_vocabulary";

#[derive(Deserialize)]
struct Table { version: u32, not_a_genre: Vec<String>, concepts: Vec<Concept> }
#[derive(Deserialize)]
struct Concept { id: String, canonical: String, label: String, aliases: Vec<String> }

struct Vocabulary { version: String, canonical: HashMap<String, String>, not_a_genre: HashSet<String> }

/// Same comparison as `normalizeSearchText` and the pipeline's `_key`: no accents, no case, single spaces.
fn key(value: &str) -> String {
    let plain: String = value.nfd().filter(|c| !is_combining_mark(*c)).collect();
    plain.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
}

fn vocabulary() -> &'static Vocabulary {
    static VOCABULARY: OnceLock<Vocabulary> = OnceLock::new();
    VOCABULARY.get_or_init(|| {
        let table: Table = serde_json::from_str(TABLE).expect("genreConcepts.json is compiled in and tested");
        let mut canonical = HashMap::new();
        for concept in table.concepts {
            let id = concept.id.replace('_', " ");
            for alias in [&id, &concept.canonical, &concept.label].into_iter().chain(concept.aliases.iter()) {
                canonical.insert(key(alias), concept.canonical.clone());
            }
        }
        Vocabulary { version: table.version.to_string(), canonical, not_a_genre: table.not_a_genre.iter().map(|value| key(value)).collect() }
    })
}

/// The stored name of a value, or None when it is empty or not a genre.
pub fn canonical_genre(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let normalized = key(trimmed);
    let table = vocabulary();
    if normalized.is_empty() || table.not_a_genre.contains(&normalized) { return None; }
    Some(table.canonical.get(&normalized).cloned().unwrap_or_else(|| trimmed.to_string()))
}

/// The canonical genres of a game's JSON list, without repeats, in the order they came.
pub fn canonical_genres(values: Option<&Vec<Value>>) -> Vec<String> {
    let mut seen = HashSet::new();
    values.into_iter().flatten().filter_map(Value::as_str).filter_map(canonical_genre)
        .filter(|name| seen.insert(key(name))).collect()
}

/// What a query asks for, in the spelling `game_genre` holds. An unknown value stays as it is and matches nothing.
pub fn stored_names(values: &[String]) -> Vec<String> {
    values.iter().map(|value| canonical_genre(value).unwrap_or_else(|| value.clone())).collect()
}

/// Rewrites a game's `genres` with canonical names. True when something changed.
pub fn normalize_game(game: &mut Value) -> bool {
    let Some(current) = game.get("genres").and_then(Value::as_array) else { return false };
    let clean: Vec<Value> = canonical_genres(Some(current)).into_iter().map(Value::from).collect();
    if &clean == current { return false; }
    game["genres"] = Value::Array(clean);
    true
}

/// Brings a stored catalog up to the table's version: a database installed, downloaded or saved under an older
/// vocabulary gets its payloads and `game_genre` rewritten once. Its revision does not change: updates keep applying.
pub fn apply_vocabulary(conn: &Connection) -> Result<(), String> {
    let table = vocabulary();
    let stored = conn.query_row("SELECT value FROM metadata WHERE key=?1", [VERSION_KEY], |row| row.get::<_, String>(0));
    match stored {
        Ok(version) if version == table.version => return Ok(()),
        Ok(_) | Err(rusqlite::Error::QueryReturnedNoRows) => {}
        Err(_) => return Ok(()), // a database without a metadata table is not an installed catalog
    }
    let rows: Vec<(i64, String)> = {
        let mut statement = conn.prepare("SELECT id, payload FROM catalog_game").map_err(|e| e.to_string())?;
        let found = statement.query_map([], |row| Ok((row.get(0)?, row.get(1)?))).map_err(|e| e.to_string())?;
        found.flatten().collect()
    };
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM game_genre", []).map_err(|e| e.to_string())?;
    {
        let mut update = tx.prepare("UPDATE catalog_game SET payload=?2 WHERE id=?1").map_err(|e| e.to_string())?;
        let mut insert = tx.prepare("INSERT OR IGNORE INTO game_genre(game_id, name) SELECT id, ?2 FROM game WHERE id=?1").map_err(|e| e.to_string())?;
        for (id, payload) in rows {
            let Ok(mut game) = serde_json::from_str::<Value>(&payload) else { continue };
            if normalize_game(&mut game) {
                update.execute(params![id, game.to_string()]).map_err(|e| e.to_string())?;
            }
            for name in canonical_genres(game.get("genres").and_then(Value::as_array)) {
                insert.execute(params![id, name]).map_err(|e| e.to_string())?;
            }
        }
    }
    tx.execute("INSERT INTO metadata(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![VERSION_KEY, table.version])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn every_language_and_spelling_ends_in_one_name() {
        for raw in ["Racing", "carreras", "  CARRERAS ", "Off-road", "racing"] {
            assert_eq!(canonical_genre(raw).as_deref(), Some("Racing"));
        }
        assert_eq!(canonical_genre("Acción").as_deref(), Some("Action"));
        assert_eq!(canonical_genre("JRPG").as_deref(), Some("RPG"));
        assert_eq!(canonical_genre("Ciencia ficción").as_deref(), Some("Sci-fi"));
    }

    #[test]
    fn content_warnings_and_perspectives_are_not_genres() {
        for raw in ["Violencia", "Sangrientos", "Contenido sexual", "Gore", "FPP", "  "] {
            assert_eq!(canonical_genre(raw), None);
        }
    }

    #[test]
    fn a_game_keeps_one_of_each_and_an_unknown_value_keeps_its_text() {
        let mut game = json!({"genres": ["Carreras", "Racing", "Violencia", "Algo nuevo"]});
        assert!(normalize_game(&mut game));
        assert_eq!(game["genres"], json!(["Racing", "Algo nuevo"]));
        assert!(!normalize_game(&mut game));
    }

    #[test]
    fn a_stored_catalog_is_rewritten_once_and_keeps_its_revision() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch("
            CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT);
            INSERT INTO metadata VALUES('revision', 'r1');
            CREATE TABLE catalog_game(id INTEGER PRIMARY KEY, app_id INTEGER, payload TEXT);
            CREATE TABLE game(id INTEGER PRIMARY KEY);
            CREATE TABLE game_genre(game_id INTEGER, name TEXT, PRIMARY KEY(game_id, name));
            INSERT INTO game VALUES(1);
            INSERT INTO catalog_game VALUES(1, 10, '{\"genres\":[\"Carreras\",\"Violencia\"]}');
            INSERT INTO game_genre VALUES(1, 'Carreras'), (1, 'Violencia');").unwrap();
        apply_vocabulary(&conn).unwrap();
        let names: Vec<String> = conn.prepare("SELECT name FROM game_genre").unwrap()
            .query_map([], |row| row.get(0)).unwrap().flatten().collect();
        assert_eq!(names, ["Racing"]);
        let payload: String = conn.query_row("SELECT payload FROM catalog_game", [], |row| row.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Value>(&payload).unwrap()["genres"], json!(["Racing"]));
        let revision: String = conn.query_row("SELECT value FROM metadata WHERE key='revision'", [], |row| row.get(0)).unwrap();
        assert_eq!(revision, "r1");
        conn.execute("INSERT INTO game_genre VALUES(1, 'Marca')", []).unwrap();
        apply_vocabulary(&conn).unwrap();
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM game_genre", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 2, "the same version does not rewrite again");
    }
}
