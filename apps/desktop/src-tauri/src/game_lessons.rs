//! What players learned about each game (server: apps/api/app/game_lessons.py), kept in the local catalog database
//! so the app asks it without waiting for the network: before offering or choosing a source, when a game opens and
//! when it runs. The server sends a snapshot and then only what changed since the revision stored here, in the same
//! step as the catalog updates. The player's own reports are kept apart (`mine = 1`) and survive a snapshot.
use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct GameLesson {
    pub kind: String,
    pub scope: String,
    pub subject: String,
    pub reason: String,
    pub app_id: Option<i64>,
    pub action: String,
    pub text: String,
    pub detail: Vec<String>,
    pub reports: i64,
    pub confidence: String,
    pub first_seen: String,
    pub last_seen: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(default)]
pub struct LessonKey {
    pub kind: String,
    pub scope: String,
    pub subject: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct LessonsApplied {
    pub revision: i64,
    pub total: i64,
    pub work_ms: u64,
}

pub fn ensure_lesson_tables(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS game_lessons (
            kind TEXT NOT NULL,
            scope TEXT NOT NULL,
            subject TEXT NOT NULL,
            reason TEXT NOT NULL,
            mine INTEGER NOT NULL DEFAULT 0,
            app_id INTEGER,
            action TEXT NOT NULL,
            text TEXT NOT NULL DEFAULT '',
            detail TEXT NOT NULL DEFAULT '[]',
            reports INTEGER NOT NULL DEFAULT 0,
            confidence TEXT NOT NULL DEFAULT '',
            first_seen TEXT NOT NULL DEFAULT '',
            last_seen TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (kind, scope, subject, reason, mine)
        );
        CREATE INDEX IF NOT EXISTS ix_game_lessons_app ON game_lessons(app_id);
        CREATE INDEX IF NOT EXISTS ix_game_lessons_subject ON game_lessons(scope, subject);
        CREATE TABLE IF NOT EXISTS game_lessons_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())
}

fn upsert(conn: &Connection, lesson: &GameLesson, mine: bool) -> Result<(), String> {
    conn.execute(
        "INSERT INTO game_lessons(kind, scope, subject, reason, mine, app_id, action, text, detail, reports, confidence, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(kind, scope, subject, reason, mine) DO UPDATE SET app_id = excluded.app_id, action = excluded.action,
           text = excluded.text, detail = excluded.detail, reports = excluded.reports, confidence = excluded.confidence,
           first_seen = excluded.first_seen, last_seen = excluded.last_seen",
        params![lesson.kind, lesson.scope, lesson.subject, lesson.reason, mine as i64, lesson.app_id, lesson.action,
                lesson.text, serde_json::to_string(&lesson.detail).unwrap_or_else(|_| "[]".into()), lesson.reports,
                lesson.confidence, lesson.first_seen, lesson.last_seen],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

pub fn lessons_revision_conn(conn: &Connection) -> Result<i64, String> {
    ensure_lesson_tables(conn)?;
    Ok(conn
        .query_row("SELECT value FROM game_lessons_meta WHERE key = 'revision'", [], |r| r.get::<_, String>(0))
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(0))
}

/// A snapshot (`full`) replaces what the server sent before; a delta adds/updates `lessons` and drops `removed`.
pub fn apply_lessons_conn(conn: &mut Connection, revision: i64, full: bool, lessons: &[GameLesson], removed: &[LessonKey]) -> Result<LessonsApplied, String> {
    let started = std::time::Instant::now();
    ensure_lesson_tables(conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    if full {
        tx.execute("DELETE FROM game_lessons WHERE mine = 0", []).map_err(|e| e.to_string())?;
    }
    for key in removed {
        tx.execute("DELETE FROM game_lessons WHERE kind = ?1 AND scope = ?2 AND subject = ?3 AND reason = ?4 AND mine = 0",
                   params![key.kind, key.scope, key.subject, key.reason]).map_err(|e| e.to_string())?;
    }
    for lesson in lessons {
        upsert(&tx, lesson, false)?;
    }
    tx.execute("INSERT INTO game_lessons_meta(key, value) VALUES ('revision', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
               params![revision.to_string()]).map_err(|e| e.to_string())?;
    let total: i64 = tx.query_row("SELECT COUNT(*) FROM game_lessons", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(LessonsApplied { revision, total, work_ms: started.elapsed().as_millis() as u64 })
}

pub fn add_mine_conn(conn: &Connection, lesson: &GameLesson) -> Result<(), String> {
    ensure_lesson_tables(conn)?;
    upsert(conn, lesson, true)
}

/// Every lesson about this game, plus the bad-source lessons for these source fingerprints and providers (a
/// provider's name is compared without case). Own reports say so in `confidence = "mine"`.
pub fn query_lessons_conn(conn: &Connection, app_id: Option<i64>, fingerprints: &[String], providers: &[String]) -> Result<Vec<GameLesson>, String> {
    let mut clauses = Vec::new();
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(app_id) = app_id {
        clauses.push("app_id = ?".to_string());
        values.push(app_id.into());
    }
    for (scope, list) in [("source", fingerprints), ("provider", providers)] {
        if list.is_empty() {
            continue;
        }
        clauses.push(format!("(scope = '{scope}' AND subject IN ({}))", vec!["?"; list.len()].join(",")));
        for item in list {
            values.push(if scope == "provider" { item.trim().to_lowercase() } else { item.clone() }.into());
        }
    }
    if clauses.is_empty() {
        return Ok(Vec::new());
    }
    let sql = format!(
        "SELECT kind, scope, subject, reason, mine, app_id, action, text, detail, reports, confidence, first_seen, last_seen
         FROM game_lessons WHERE {} ORDER BY mine DESC, last_seen DESC",
        clauses.join(" OR ")
    );
    let mut stmt = conn.prepare_cached(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(values), |row| {
            let mine: i64 = row.get(4)?;
            let detail: String = row.get(8)?;
            Ok(GameLesson {
                kind: row.get(0)?, scope: row.get(1)?, subject: row.get(2)?, reason: row.get(3)?, app_id: row.get(5)?,
                action: row.get(6)?, text: row.get(7)?, detail: serde_json::from_str(&detail).unwrap_or_default(),
                reports: row.get(9)?, confidence: if mine == 1 { "mine".into() } else { row.get(10)? },
                first_seen: row.get(11)?, last_seen: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn game_lessons_revision() -> Result<i64, String> {
    tauri::async_runtime::spawn_blocking(|| crate::catalog_cache::with_catalog_conn(|conn| lessons_revision_conn(conn)))
        .await
        .map_err(|err| format!("Game lessons task failed: {err}"))?
}

#[tauri::command]
pub async fn game_lessons_apply(revision: i64, full: bool, lessons: Vec<GameLesson>, removed: Option<Vec<LessonKey>>) -> Result<LessonsApplied, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::catalog_cache::with_catalog_conn(|conn| apply_lessons_conn(conn, revision, full, &lessons, &removed.unwrap_or_default()))
    })
    .await
    .map_err(|err| format!("Game lessons task failed: {err}"))?
}

#[tauri::command]
pub async fn game_lessons_add_mine(lesson: GameLesson) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || crate::catalog_cache::with_catalog_conn(|conn| add_mine_conn(conn, &lesson)))
        .await
        .map_err(|err| format!("Game lessons task failed: {err}"))?
}

#[tauri::command]
pub async fn game_lessons_query(app_id: Option<i64>, fingerprints: Option<Vec<String>>, providers: Option<Vec<String>>) -> Result<Vec<GameLesson>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::catalog_cache::with_catalog_conn(|conn| {
            query_lessons_conn(conn, app_id, &fingerprints.unwrap_or_default(), &providers.unwrap_or_default())
        })
    })
    .await
    .map_err(|err| format!("Game lessons task failed: {err}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lesson(kind: &str, scope: &str, subject: &str, app_id: i64) -> GameLesson {
        GameLesson { kind: kind.into(), scope: scope.into(), subject: subject.into(), reason: "not_a_game".into(),
                     app_id: Some(app_id), action: "avoid".into(), reports: 2, confidence: "flagged".into(), ..Default::default() }
    }

    #[test]
    fn snapshot_then_delta_keeps_own_reports() {
        let mut conn = Connection::open_in_memory().unwrap();
        let fp = "a".repeat(64);
        add_mine_conn(&conn, &lesson("bad_source", "source", &"b".repeat(64), 10)).unwrap();
        apply_lessons_conn(&mut conn, 5, true, &[lesson("bad_source", "source", &fp, 10), lesson("abandoned", "game", "20", 20)], &[]).unwrap();
        assert_eq!(lessons_revision_conn(&conn).unwrap(), 5);
        let got = query_lessons_conn(&conn, Some(10), &[fp.clone()], &[]).unwrap();
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].confidence, "mine");

        let removed = [LessonKey { kind: "bad_source".into(), scope: "source".into(), subject: fp.clone(), reason: "not_a_game".into() }];
        apply_lessons_conn(&mut conn, 6, false, &[], &removed).unwrap();
        assert_eq!(query_lessons_conn(&conn, Some(10), &[fp], &[]).unwrap().len(), 1);
        // A new snapshot replaces the server's lessons, never the player's own.
        apply_lessons_conn(&mut conn, 7, true, &[], &[]).unwrap();
        assert!(query_lessons_conn(&conn, Some(20), &[], &[]).unwrap().is_empty());
        assert_eq!(query_lessons_conn(&conn, Some(10), &[], &[]).unwrap().len(), 1);
    }

    #[test]
    fn provider_lessons_ignore_case() {
        let mut conn = Connection::open_in_memory().unwrap();
        let mut provider = lesson("bad_source", "provider", "some provider", 0);
        provider.app_id = None;
        apply_lessons_conn(&mut conn, 1, true, &[provider], &[]).unwrap();
        assert_eq!(query_lessons_conn(&conn, Some(99), &[], &[" Some Provider ".into()]).unwrap().len(), 1);
    }

    /// The query the app runs before offering a game's sources: 50,000 lessons, one game, 12 sources, 4 providers.
    #[test]
    fn query_with_50k_lessons_is_instant() {
        let mut conn = Connection::open_in_memory().unwrap();
        let mut lessons = Vec::with_capacity(50_000);
        for i in 0..50_000i64 {
            lessons.push(lesson(if i % 10 == 0 { "how_to_run" } else { "bad_source" }, if i % 10 == 0 { "game" } else { "source" },
                                &format!("{:064x}", i), (i % 20_000) * 10));
        }
        let applied = apply_lessons_conn(&mut conn, 1, true, &lessons, &[]).unwrap();
        let fingerprints: Vec<String> = (0..12i64).map(|i| format!("{:064x}", i * 997)).collect();
        let providers = vec!["fitgirl".to_string(), "dodi".into(), "elamigos".into(), "gog".into()];
        let started = std::time::Instant::now();
        let runs = 200;
        for i in 0..runs {
            let got = query_lessons_conn(&conn, Some((i % 20_000) * 10), &fingerprints, &providers).unwrap();
            assert!(!got.is_empty());
        }
        let per_query_us = started.elapsed().as_micros() as f64 / runs as f64;
        println!("game_lessons: snapshot of 50000 applied in {} ms; query {:.0} us", applied.work_ms, per_query_us);
        assert!(per_query_us < 5_000.0, "query took {per_query_us} us");
    }
}
