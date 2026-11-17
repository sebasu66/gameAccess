from app.main import app
from fastapi.testclient import TestClient


def test_health_reports_running_api() -> None:
    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["ok"] is True
    assert payload["version"] == app.version
    assert payload["time"]


def test_the_bare_address_opens_the_admin_console():
    from fastapi.testclient import TestClient
    from app import main
    response = TestClient(main.app).get("/", follow_redirects=False)
    assert response.status_code == 307 and response.headers["location"] == "/admin"
