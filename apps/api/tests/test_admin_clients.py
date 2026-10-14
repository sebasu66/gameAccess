from datetime import datetime, timedelta, timezone

from sqlmodel import Session, SQLModel, create_engine

from app.access_keys import AccessKey
from app.admin_clients import activity_summary, integrated_clients
from app.download_events import DownloadEvent, log_event
from app.models import AccessEvent
from app.telemetry import ChunkTransfer, ClientPresence, ServerSample
from app.viking_chunk_models import VikingChunkJob, VikingChunkPiece


def _engine():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine, tables=[
        AccessKey.__table__, AccessEvent.__table__, ClientPresence.__table__, ChunkTransfer.__table__, ServerSample.__table__,
        DownloadEvent.__table__, VikingChunkJob.__table__, VikingChunkPiece.__table__,
    ])
    return engine


def test_a_client_comes_with_key_activation_events_and_its_downloads():
    engine = _engine()
    now = datetime.now(timezone.utc)
    with Session(engine) as s:
        s.add(ClientPresence(installation_id="cli-1", access_tier="plus", first_seen_at=now - timedelta(days=3), last_seen_at=now))
        s.add(AccessKey(key_hash="h", access_tier="plus", created_at=now - timedelta(days=5), key_expires_at=now + timedelta(days=30),
                        activated_at=now - timedelta(days=3), expires_at=now + timedelta(days=27), installation_id="cli-1"))
        s.add(AccessEvent(created_at=now - timedelta(days=3), installation_id="cli-1", action="activation-redeem", outcome="allowed", reason="ok"))
        s.add(ChunkTransfer(installation_id="cli-1", job_id="job1", kind="start", item_name="Portal 2", served_at=now - timedelta(minutes=5)))
        s.add(ChunkTransfer(installation_id="cli-1", job_id="job1", kind="piece", size_bytes=1000, item_name="Portal 2", served_at=now))
        s.commit()
    log_event(engine, "job1", "ready", "listo", status="ok", installation_id="cli-1", item_name="Portal 2")
    with Session(engine) as s:
        (client,) = integrated_clients(s, hours=24)
        assert client["online"] and client["downloading"]
        assert client["key"]["state"] == "activa" and client["key"]["tier"] == "plus"
        assert 26 * 86400 < client["key"]["remaining_seconds"] <= 27 * 86400 and len(client["keys"]) == 1
        assert client["activation_events"][0]["action"] == "activation-redeem"
        assert client["tasks"][0]["item_name"] == "Portal 2" and client["tasks"][0]["bytes"] == 1000
        assert client["tasks"][0]["message"] == "listo"
        assert integrated_clients(s, hours=1)[0]["tasks_count"] == 1
        summary = activity_summary(s, 24)
        assert summary["downloads_7d"] == 1 and summary["clients_online"] == 1


def test_table_pages_embed_their_config_and_unknown_ones_are_404(monkeypatch):
    import pytest
    from fastapi import HTTPException

    from app import admin_dashboard_routes as routes

    monkeypatch.setattr(routes, "_admin_browser_access", lambda request: None)
    page = routes.table_page("access-events", None)
    body = page.body.decode()
    assert 'window.__TABLE__={"title": "Eventos de acceso"' in body and "</script>" in body
    assert "/admin/access-events" in body
    with pytest.raises(HTTPException) as err:
        routes.table_page("../secrets", None)
    assert err.value.status_code == 404
