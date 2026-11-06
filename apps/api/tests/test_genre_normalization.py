import json

from app.genre_normalization import canonical_genres, normalize_catalog_rows, normalize_payload_genres


def test_duplicate_spellings_collapse_to_one_genre() -> None:
    assert canonical_genres(["Free To Play", "Free to Play", "Sport", "Sports", "Deportes"]) == ["Free to Play", "Sports"]
    assert canonical_genres(["RPG", "Role-playing (RPG)", "Role-playing", "Rol"]) == ["RPG"]
    assert canonical_genres(["Simulation", "Simulator", "Simuladores"]) == ["Simulation"]


def test_spanish_values_map_to_steam_english_names() -> None:
    assert canonical_genres(["Acción", "Aventura", "Estrategia", "Carreras", "Acceso anticipado", "Multijugador masivo"]) == [
        "Action", "Adventure", "Strategy", "Racing", "Early Access", "Massively Multiplayer"]
    assert canonical_genres(["Producción de vídeo", "Utilidades"]) == ["Video Production", "Utilities"]


def test_maturity_labels_are_not_genres_and_unknowns_are_kept() -> None:
    assert canonical_genres(["Violent", "Gore", "Sexual Content", "Nudity", "Metroidvania", " Fantasy "]) == ["Metroidvania", "Fantasy"]
    assert canonical_genres(None) == []
    assert canonical_genres([None, 3, ""]) == []


def test_clean_payload_is_returned_byte_for_byte() -> None:
    payload = json.dumps({"id": 1, "genres": ["Action", "Indie"], "name": "A"}, separators=(",", ":"))
    assert normalize_payload_genres(payload) == payload
    assert normalize_payload_genres("not json") == "not json"
    assert normalize_payload_genres('{"id":1}') == '{"id":1}'


def test_catalog_rows_are_rewritten_only_when_needed() -> None:
    rows = [(1, 10, json.dumps({"id": 1, "genres": ["Free To Play", "Free to Play"]})), (2, 20, '{"id":2,"genres":["Action"]}')]
    out = normalize_catalog_rows(rows)
    assert json.loads(out[0][2])["genres"] == ["Free to Play"]
    assert out[1] == rows[1]
