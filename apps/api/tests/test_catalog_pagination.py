from app.main import app
from fastapi.testclient import TestClient


def test_catalog_pagination_is_opt_in_and_reports_page_metadata() -> None:
    with TestClient(app) as client:
        legacy = client.get("/catalog")
        first_page = client.get("/catalog?page=1&page_size=2")

    assert legacy.status_code == 200
    assert first_page.status_code == 200

    all_games = legacy.json()
    page_games = first_page.json()
    assert isinstance(all_games, list)
    assert page_games == all_games[:2]
    assert int(first_page.headers["x-total-count"]) == len(all_games)
    assert first_page.headers["x-page"] == "1"
    assert first_page.headers["x-page-size"] == "2"

    expected_pages = (len(all_games) + 1) // 2 if all_games else 0
    assert int(first_page.headers["x-total-pages"]) == expected_pages


def test_catalog_rejects_invalid_pagination_values() -> None:
    with TestClient(app) as client:
        bad_page = client.get("/catalog?page=0")
        bad_size = client.get("/catalog?page=1&page_size=201")

    assert bad_page.status_code == 422
    assert bad_size.status_code == 422
