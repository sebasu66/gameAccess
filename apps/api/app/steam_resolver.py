from __future__ import annotations

import json
import logging
import re
import ssl
import sys
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from typing import Any, Callable, Optional, Tuple

logger = logging.getLogger("gameaccess.steam_resolver")

_RESOLVER_CACHE: dict[str, Optional[Tuple[int, str]]] = {}

ROMAN_NUMERALS = {
    r"\bi\b": "1",
    r"\bii\b": "2",
    r"\biii\b": "3",
    r"\biv\b": "4",
    r"\bv\b": "5",
    r"\bvi\b": "6",
    r"\bvii\b": "7",
    r"\bviii\b": "8",
    r"\bix\b": "9",
    r"\bx\b": "10",
}


def clean_for_steam_lookup(title: str) -> str:
    """Cleans a raw release title to its base game identity for Steam lookup.

    Rules applied in sequence:
    1. Removes anything inside brackets [...] and parentheses (...)
    2. Removes anything after '+' sign (e.g. '+ All DLCs', '+ Update 2')
    3. Removes version formats: with or without 'v' (e.g. 1.0.0.13772, v2.13.1, Build 12345)
    4. Removes DLC, Expansion, Repack, Soundtrack, Crack, Portable tags
    5. Cleans trailing/leading punctuation (- : _ . ,) and collapses whitespace
    """
    if not title:
        return ""

    # 1. Remove anything in brackets [...] and parentheses (...)
    s = re.sub(r"\[.*?\]", " ", title)
    s = re.sub(r"\(.*?\)", " ", s)

    # 2. Remove anything after '+' sign
    s = re.split(r"\s*\+\s*", s)[0]

    # 3. Remove version patterns: with or without 'v'
    s = re.sub(r"\bv\.?[\d._]+\b", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"\b\d+(?:\.\d+)+[\w._-]*\b", " ", s)
    s = re.sub(
        r"\b(?:build|update|patch|release|rev|ver|version|hotfix)[\s._\-]*[\d._]+\b",
        " ",
        s,
        flags=re.IGNORECASE,
    )

    # 4. Remove standalone noise words & repack mentions
    s = re.sub(
        r"\b(?:dlcs?|expansions?|season\s*pass|soundtrack|bonus|pre-order|pre\s*order|"
        r"repack|portable|p2p|crack|goldberg|multi\d+|x64|x86|torrent|magnet|"
        r"fitgirl|dodi|elamigos|tenoke|rune|empress|codex|skidrow|flt|kaos|razor1911)\b.*",
        " ",
        s,
        flags=re.IGNORECASE,
    )

    # 5. Clean trailing/leading non-alphanumeric punctuation
    s = re.sub(r"[-–—:_\.,/\\|]+$", "", s).strip()
    s = re.sub(r"^[-–—:_\.,/\\|]+", "", s).strip()
    s = re.sub(r"\s+", " ", s).strip()

    return s or title.strip()


def normalize_title(title: str) -> str:
    """Normalizes a game title for token and numeral comparisons."""
    if not title:
        return ""
    text = title.lower()
    text = re.sub(r"\[.*?\]", " ", text)
    text = re.sub(r"\(.*?\)", " ", text)
    text = re.sub(r"\bv\.?[\d._]+\b", " ", text)
    text = re.sub(r"\b\d+(?:\.\d+)+[\w._-]*\b", " ", text)
    text = re.sub(
        r"\b(?:build|update|patch|release|rev|ver|version|hotfix)[\s._\-]*[\d._]+\b",
        " ",
        text,
    )
    text = text.replace("&", " and ").replace("+", " and ")
    for roman, arabic in ROMAN_NUMERALS.items():
        text = re.sub(roman, arabic, text)
    text = re.sub(r"[:\-_,.\'\"!/?(){}\u2122\u00ae\u00a9]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def generate_fallback_queries(clean_title: str) -> list[str]:
    """Generates a prioritized list of search queries with progressive trimming.

    If the full clean title does not find a match on Steam, attempts subtitle cuts
    and right-to-left word trimming until a match is found.
    """
    queries: list[str] = []
    seen: set[str] = set()

    def add(q: str) -> None:
        q = re.sub(r"[-–—:_\.,/\\|]+$", "", q).strip()
        q = re.sub(r"^[-–—:_\.,/\\|]+", "", q).strip()
        q = re.sub(r"\s+", " ", q).strip()
        if q and len(q) >= 2 and q.lower() not in seen:
            seen.add(q.lower())
            queries.append(q)

    # 1. Full clean title
    add(clean_title)

    # 2. Delimiter cuts (e.g. 'Game Title: Subtitle' -> 'Game Title', 'Game - Edition' -> 'Game')
    for delim in [":", " - ", " – ", " — ", " / "]:
        if delim in clean_title:
            add(clean_title.split(delim)[0])

    # 3. Progressive word removal from the end (right to left)
    words = clean_title.split()
    min_words = 2 if len(words) >= 3 else 1
    for i in range(len(words) - 1, min_words - 1, -1):
        add(" ".join(words[:i]))

    # 4. If delimiters exist in the shortened forms, cut them too
    for delim in [":", " - "]:
        if delim in clean_title:
            left = clean_title.split(delim)[0]
            l_words = left.split()
            l_min = 2 if len(l_words) >= 3 else 1
            for i in range(len(l_words) - 1, l_min - 1, -1):
                add(" ".join(l_words[:i]))

    return queries


def calculate_match_score(query: str, candidate_name: str) -> float:
    """Calculates a similarity score between query and candidate Steam title.

    Enforces strict edition & numeral matching so numbered franchises
    (e.g. Mortal Kombat vs Mortal Kombat 11) never cross-match.
    """
    norm_target = normalize_title(query)
    norm_candidate = normalize_title(candidate_name)

    target_tokens = [
        t for t in norm_target.split() if t not in ("the", "of", "and", "a", "an", "for")
    ]
    candidate_tokens = [
        t for t in norm_candidate.split() if t not in ("the", "of", "and", "a", "an", "for")
    ]

    if not target_tokens:
        return 0.0

    target_set = set(target_tokens)
    candidate_set = set(candidate_tokens)
    matching = target_set.intersection(candidate_set)

    ratio = len(matching) / len(target_set)
    if ratio < 0.60:
        return 0.0

    # Ensure small numbers match strictly (prevent Mortal Kombat matching Mortal Kombat 11)
    target_numbers = {t for t in target_tokens if t.isdigit() and len(t) <= 2}
    candidate_numbers = {t for t in candidate_tokens if t.isdigit() and len(t) <= 2}
    if target_numbers and not target_numbers.issubset(candidate_numbers):
        return 0.0
    if not target_numbers and candidate_numbers:
        return 0.0

    seq_ratio = SequenceMatcher(None, norm_target, norm_candidate).ratio()
    return (ratio * 0.6) + (seq_ratio * 0.4)


def resolve_steam_app_id(
    game_name: str,
    timeout: float = 4.0,
    log_callback: Optional[Callable[[str], None]] = None,
) -> Optional[Tuple[int, str]]:
    """Resolves the official Steam AppID for a game title using Steam Store Search API.

    Applies progressive query trimming: if the full title doesn't match, progressively
    strips delimiters and trailing words until a match is found.
    NEVER generates a synthetic/fake ID. Returns (app_id, official_name) or None.
    """
    raw = (game_name or "").strip()
    if not raw:
        return None

    clean = clean_for_steam_lookup(raw)
    if not clean:
        return None

    def _emit(text: str) -> None:
        # Sanitize for Windows console logging (both logger and print)
        try:
            safe_text = text.encode(sys.stdout.encoding or "utf-8").decode(sys.stdout.encoding or "utf-8")
        except UnicodeEncodeError:
            safe_text = text.encode("ascii", "replace").decode("ascii")
            
        logger.info(safe_text)
        print(f"[SteamResolver] {safe_text}", flush=True)
        
        if log_callback:
            try:
                log_callback(text)
            except Exception:
                pass

    cache_key = clean.lower()
    if cache_key in _RESOLVER_CACHE:
        cached_val = _RESOLVER_CACHE[cache_key]
        _emit(f"[CacheHit] '{clean}' -> {cached_val}")
        return cached_val

    queries = generate_fallback_queries(clean)
    _emit(f"Resolving '{raw}' -> Cleaned: '{clean}' | Fallback chain: {queries}")

    for idx, q in enumerate(queries):
        msg = f"  [Intento {idx + 1}/{len(queries)}] Consultando Steam con: '{q}'..."
        _emit(msg)

        try:
            params = urllib.parse.urlencode({"term": q, "l": "spanish", "cc": "ar"})
            req_url = f"https://store.steampowered.com/api/storesearch/?{params}"
            req = urllib.request.Request(
                req_url,
                headers={"User-Agent": "gameAccess/0.2 Steam App Resolver"},
            )
            ssl_ctx = getattr(ssl, "_create_unverified_context", None)
            ctx = ssl_ctx() if ssl_ctx else None
            with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                if resp.status != 200:
                    logger.warning("Steam returned status %s for term='%s'", resp.status, q)
                    continue
                raw_data = resp.read().decode("utf-8", errors="replace")
                data = json.loads(raw_data)
                items = data.get("items", [])
        except Exception as exc:
            logger.warning("Steam search exception for '%s': %s", q, exc)
            continue

        candidates: list[Tuple[float, int, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type not in ("app", None):
                continue
            cand_id = item.get("id")
            cand_name = item.get("name")
            if not cand_id or not cand_name:
                continue

            lower_name = str(cand_name).lower()
            is_dlc = any(
                kw in lower_name
                for kw in [
                    " - season pass",
                    "season pass",
                    " - pack",
                    " pack",
                    " dlc",
                    "expansion pack",
                    "bonus",
                    "soundtrack",
                    "pre-order",
                    "pre order",
                    "upgrade",
                    "deluxe edition upgrade",
                    "demo",
                ]
            )

            score = calculate_match_score(q, cand_name)
            clean_norm = normalize_title(clean)
            cand_norm = normalize_title(cand_name)
            
            if score > 0.0:
                if cand_norm == clean_norm:
                    score = max(score, 1.0)
                elif cand_norm.startswith(clean_norm) or clean_norm.startswith(cand_norm):
                    score = max(score, 0.85)

            if score >= 0.65:
                if is_dlc:
                    score -= 0.35
                candidates.append((score, int(cand_id), str(cand_name)))

        if candidates:
            candidates.sort(key=lambda x: x[0], reverse=True)
            best_score, best_id, best_name = candidates[0]
            if best_score >= 0.50:
                success_msg = f"  -> [MATCH] AppID {best_id} ('{best_name}') [score: {best_score:.2f}] con término '{q}'"
                _emit(success_msg)
                res = (best_id, best_name)
                _RESOLVER_CACHE[cache_key] = res
                return res

    fail_msg = f"  -> [NO MATCH] No se encontró AppID oficial en Steam para '{clean}' tras {len(queries)} intentos."
    _emit(fail_msg)

    _RESOLVER_CACHE[cache_key] = None
    return None
