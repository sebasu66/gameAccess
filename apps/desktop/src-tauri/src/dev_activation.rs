//! Development-only auto-login.
//!
//! Reads the activation key from a local `.env` so the developer does not retype
//! it on every launch.
//!
//! The key is read at run time and never compiled in. Vite only exposes
//! `VITE_*`/`TAURI_*` variables and bakes them into the bundle, so going through
//! it would put a working access key inside the shipped executable. Reading the
//! file here keeps the secret on the machine that owns it: no `.env`, no
//! auto-login.
//!
//! The file is expected at the repository root and is already covered by
//! `.gitignore` (`.env`, `.env.*`).

use std::fs;
use std::path::{Path, PathBuf};

/// Name of the variable inside the `.env` file.
const KEY_NAME: &str = "devKEY";

/// Walk up from `start` looking for the repository root.
///
/// The working directory differs between a dev run and a launched executable, so
/// the file is found by its marker instead of by a fixed depth. The search is
/// bounded so a stray directory tree cannot make it run away.
fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start);
    for _ in 0..8 {
        let candidate = current?;
        if candidate.join("apps").join("desktop").is_dir() {
            return Some(candidate.to_path_buf());
        }
        current = candidate.parent();
    }
    None
}

/// Parse one assignment out of a `.env` body.
///
/// Deliberately minimal: comments and blank lines are skipped, and surrounding
/// quotes and whitespace are trimmed. A value keeps its inner spaces, which a key
/// may legitimately contain.
pub(crate) fn parse_env_value(body: &str, name: &str) -> Option<String> {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((raw_key, raw_value)) = trimmed.split_once('=') else {
            continue;
        };
        if raw_key.trim() != name {
            continue;
        }
        let value = raw_value.trim().trim_matches(|c| c == '"' || c == '\'').trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// Read the development activation key, if a `.env` provides one.
///
/// Returns `None` — not an error — when there is no file or no entry, because a
/// normal installation simply has neither and must not be disturbed by that.
#[tauri::command]
pub(crate) fn read_dev_activation_key() -> Result<Option<String>, String> {
    let cwd = std::env::current_dir().map_err(|err| format!("Cannot resolve working directory: {err}"))?;
    let Some(root) = find_repo_root(&cwd) else {
        return Ok(None);
    };
    let path = root.join(".env");
    if !path.is_file() {
        return Ok(None);
    }
    let body = fs::read_to_string(&path).map_err(|err| format!("Cannot read {}: {err}", path.display()))?;
    Ok(parse_env_value(&body, KEY_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_key_and_ignores_the_rest() {
        let body = "# comment\nother=1\ndevKEY=4780Sebasu\nlater=2\n";
        assert_eq!(parse_env_value(body, KEY_NAME).as_deref(), Some("4780Sebasu"));
    }

    #[test]
    fn tolerates_spacing_quotes_and_blank_lines() {
        assert_eq!(parse_env_value("\n  devKEY =  4780Sebasu  \n", KEY_NAME).as_deref(), Some("4780Sebasu"));
        assert_eq!(parse_env_value("devKEY=\"4780Sebasu\"\n", KEY_NAME).as_deref(), Some("4780Sebasu"));
        assert_eq!(parse_env_value("devKEY='4780Sebasu'\n", KEY_NAME).as_deref(), Some("4780Sebasu"));
    }

    #[test]
    fn a_missing_or_empty_entry_is_absence_not_an_error() {
        assert_eq!(parse_env_value("other=1\n", KEY_NAME), None);
        assert_eq!(parse_env_value("devKEY=\n", KEY_NAME), None);
        assert_eq!(parse_env_value("devKEY=   \n", KEY_NAME), None);
        assert_eq!(parse_env_value("", KEY_NAME), None);
    }

    #[test]
    fn does_not_match_a_prefix_of_the_name() {
        // `devKEY_OLD` must not answer for `devKEY`.
        assert_eq!(parse_env_value("devKEY_OLD=x\n", KEY_NAME), None);
        assert_eq!(parse_env_value("# devKEY=x\n", KEY_NAME), None);
    }

    #[test]
    fn finds_the_repository_root_by_its_marker() {
        let here = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // CARGO_MANIFEST_DIR is apps/desktop/src-tauri; the root is two levels up.
        let root = find_repo_root(&here).expect("repository root should be found from the manifest dir");
        assert!(root.join("apps").join("desktop").is_dir());
    }

    #[test]
    fn stops_instead_of_walking_forever() {
        // A path with no marker above it yields nothing rather than a panic.
        let lonely = PathBuf::from("Z:/definitely/not/a/repository");
        assert_eq!(find_repo_root(&lonely), None);
    }
}
