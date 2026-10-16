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

pub fn score_with(game_name: &str, raw_title: &str, split: bool) -> f64 {
    let name = clean_title(game_name, split);
    let title = clean_title(raw_title, split);
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
        && has_word_bounded_dotted_digits(raw_title);

    if is_release_marker(marker) || dotted_version {
        0.9
    } else {
        0.0
    }
}

/// Exact port of `calculateScore(gameName, rawTitle)` from `ga-torrent-plugin/matcher.js`.
pub fn calculate_score(game_name: &str, raw_title: &str) -> f64 {
    score_with(game_name, raw_title, true).max(score_with(game_name, raw_title, false))
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
}
