"""The player's reports and the server's own steps make one readable story per download in the admin dashboard."""
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import viking_chunk_routes as routes
from app.access_keys import issue_keys, redeem_key
from app.admin_clients import _download_tasks
from app.api_dependencies import get_session
from app.download_events import log_event


def _engine():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    return engine


def test_client_reports_join_the_story_and_set_the_status(monkeypatch):
    shared, local = _engine(), _engine()
    monkeypatch.setattr(routes, "local_engine", local)
    installation = str(uuid4())
    with Session(shared) as session:
        _, key = issue_keys(session, hours=None, months=1, count=1)[0]
        token, _ = redeem_key(session, key, installation)
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[get_session] = lambda: Session(shared)
    client = TestClient(app)
    headers = {"Authorization": f"Bearer {token}", "X-GameAccess-Installation": installation}

    # Torrent direct: the whole story comes from the player.
    for body in ({"event": "measuring", "app_id": 10, "item_name": "Noita"},
                 {"event": "torrent", "app_id": 10, "item_name": "Noita", "detail": "35 fuentes compartiendo"},
                 {"event": "finished", "app_id": 10, "item_name": "Noita", "bytes": 1_600_000_000, "seconds": 240}):
        assert client.post("/downloads/client-events", json=body, headers=headers).status_code == 200
    # Through the server: its own steps and the player's reports share the job id.
    log_event(local, "job-1", "request", "El cliente pidió «Elden Ring»: no estaba en el caché.", installation_id=installation, item_name="Elden Ring")
    log_event(local, "job-1", "torbox", "Paso 1 · Torbox ya tiene el juego (6 archivos).", status="ok")
    routes._note_served("job-1", installation, "torbox", [0])
    client.post("/downloads/client-events", json={"event": "started", "job_id": "job-1", "item_name": "Elden Ring"}, headers=headers)
    client.post("/downloads/client-events", json={"event": "failed", "job_id": "job-1", "item_name": "Elden Ring",
                                                   "detail": "sin espacio en disco"}, headers=headers)
    assert client.post("/downloads/client-events", json={"event": "finished"}, headers={}).status_code == 401

    with Session(local) as session:
        tasks = {t["job_id"]: t for t in _download_tasks(session, [installation], datetime.now(timezone.utc) - timedelta(hours=1))[installation]}
    noita = tasks["app-10"]
    assert noita["status"] == "completo" and noita["item_name"] == "Noita"
    assert [e["message"] for e in noita["events"]] == [
        "El cliente está midiendo el torrent para elegir por dónde bajarlo.",
        "El cliente baja el torrent directo, sin pasar por el servidor (35 fuentes compartiendo).",
        "La descarga terminó en el cliente: 1.6 GB en 4 min (6.7 MB/s).",
    ]
    elden = tasks["job-1"]
    assert elden["status"] == "failed"
    steps = [e["message"] for e in elden["events"]]
    assert steps[1] == "Paso 1 · Torbox ya tiene el juego (6 archivos)."   # the server's own step, without installation
    assert "Se le envió al cliente el archivo 1 desde Torbox (Viking todavía lo está copiando)." in steps
    assert steps[-1] == "La descarga falló en el cliente (sin espacio en disco)."
