"""Genre concepts for the catalog pipeline, applied before a package is hashed.

The catalog mixes Steam's English genre list, translated legacy values and
community labels: 100 distinct values for roughly 45 concepts (``Free To Play`` /
``Free to Play``, ``Sport`` / ``Sports`` / ``Deportes``, ``Racing`` / ``Carreras``).
Every known value is rewritten to the concept's canonical English name, so the
published seed is already clean. The client resolves the same table to stable
concept ids (``racing``) and never compares against Steam's text.

The table is ``genre_concepts.json`` and must stay identical to
``apps/desktop/src/genreConcepts.json``; a test enforces it. A value that matches
no alias is kept as written, never guessed.
"""
from __future__ import annotations

import json
import unicodedata
from pathlib import Path
from typing import Iterable

_TABLE = json.loads((Path(__file__).with_name("genre_concepts.json")).read_text(encoding="utf-8"))


def _key(value: str) -> str:
    decomposed = unicodedata.normalize("NFD", value)
    return " ".join("".join(c for c in decomposed if not unicodedata.combining(c)).lower().split())


NOT_A_GENRE = frozenset(_key(value) for value in _TABLE["not_a_genre"])
CONCEPTS: list[dict] = _TABLE["concepts"]
# Normalized alias, label or id -> concept.
_BY_KEY: dict[str, dict] = {}
for _concept in CONCEPTS:
    for _alias in (_concept["id"].replace("_", " "), _concept["canonical"], _concept["label"], *_concept["aliases"]):
        _BY_KEY[_key(_alias)] = _concept


def concept_for(raw: object) -> dict | None:
    if not isinstance(raw, str):
        return None
    return _BY_KEY.get(_key(raw.strip())) if raw.strip() else None


def canonical_genre(raw: object) -> str | None:
    """Canonical English name, or None when the value is not a genre at all."""
    if not isinstance(raw, str):
        return None
    trimmed = raw.strip()
    if not trimmed:
        return None
    key = _key(trimmed)
    if key in NOT_A_GENRE:
        return None
    concept = _BY_KEY.get(key)
    return concept["canonical"] if concept else trimmed


def canonical_genres(values: Iterable[object] | None) -> list[str]:
    """Canonical, de-duplicated genres in first-seen order."""
    seen: set[str] = set()
    result: list[str] = []
    for value in values or []:
        genre = canonical_genre(value)
        if genre is None:
            continue
        key = _key(genre)
        if key in seen:
            continue
        seen.add(key)
        result.append(genre)
    return result


def normalize_payload_genres(payload: str) -> str:
    """Rewrite one catalog_game payload with canonical genres.

    Returns the payload unchanged when it is not a JSON object or its genres
    already are canonical, so a clean package keeps its byte-for-byte revision.
    """
    try:
        game = json.loads(payload)
    except (TypeError, ValueError):
        return payload
    if not isinstance(game, dict) or not isinstance(game.get("genres"), list):
        return payload
    cleaned = canonical_genres(game["genres"])
    if cleaned == game["genres"]:
        return payload
    game["genres"] = cleaned
    return json.dumps(game, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def normalize_catalog_rows(rows: list[tuple[int, int | None, str]]) -> list[tuple[int, int | None, str]]:
    return [(game_id, app_id, normalize_payload_genres(payload)) for game_id, app_id, payload in rows]
