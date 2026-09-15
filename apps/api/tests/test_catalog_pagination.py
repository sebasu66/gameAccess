from app.main import app, engine
from fastapi.testclient import TestClient


def test_catalog_is_paginated_by_default_and_reports_page_metadata() -> None:
    with TestClient(app) as client:
        default_page = client.get("/catalog")
        first_page = client.get("/catalog?page=1&page_size=2")

    assert default_page.status_code == 200
    assert first_page.status_code == 200
    assert isinstance(default_page.json(), list)
    assert len(default_page.json()) <= 50
    assert len(first_page.json()) <= 2
    assert default_page.headers["x-page"] == "1"
    assert default_page.headers["x-page-size"] == "50"
    assert first_page.headers["x-page"] == "1"
    assert first_page.headers["x-page-size"] == "2"

    total = int(first_page.headers["x-total-count"])
    expected_pages = (total + 1) // 2 if total else 0
    assert int(first_page.headers["x-total-pages"]) == expected_pages


def test_catalog_rejects_invalid_pagination_values() -> None:
    with TestClient(app) as client:
        bad_page = client.get("/catalog?page=0")
        bad_size = client.get("/catalog?page=1&page_size=201")

    assert bad_page.status_code == 422
    assert bad_size.status_code == 422


def test_catalog_excludes_dlc_and_tools_from_results_and_totals() -> None:
    with engine.begin() as conn:
        expected_total = int(
            conn.exec_driver_sql(
                """
                SELECT COUNT(*)
                FROM game g
                WHERE g.id IN (SELECT DISTINCT game_id FROM accountgame)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM game_metadata m
                    WHERE m.game_id = g.id
                      AND lower(coalesce(m.product_type, '')) IN ('dlc', 'tool')
                  )
                """
            ).scalar_one()
        )

    with TestClient(app) as client:
        response = client.get("/catalog?page=1&page_size=200")

    assert response.status_code == 200
    assert int(response.headers["x-total-count"]) == expected_total
    game_ids = [int(game["id"]) for game in response.json()]
    if game_ids:
        placeholders = ",".join("?" for _ in game_ids)
        with engine.begin() as conn:
            excluded = conn.exec_driver_sql(
                f"SELECT game_id, product_type FROM game_metadata WHERE game_id IN ({placeholders}) AND lower(coalesce(product_type, '')) IN ('dlc', 'tool')",
                tuple(game_ids),
            ).all()
        assert excluded == []
