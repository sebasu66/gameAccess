import asyncio
from datetime import timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app.download_events import DownloadEvent
from app import admin_dashboard_routes as routes
from app import telemetry as t
from app.viking_chunk_models import VikingChunkJob, VikingChunkPiece


@pytest.fixture()
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[
        t.ClientPresence.__table__, t.ChunkTransfer.__table__, t.ServerSample.__table__,
        VikingChunkJob.__table__, VikingChunkPiece.__table__, DownloadEvent.__table__,
    ])
    return eng


def test_heartbeat_creates_then_throttles_writes(engine):
    with Session(engine) as s:
        t.record_heartbeat(s, "aaaa", "plus")
        t.record_heartbeat(s, "aaaa", "plus")  # inside the throttle window: no second write
        row = s.exec(select(t.ClientPresence)).one()
        assert row.heartbeats == 1 and row.access_tier == "plus"
        row.last_seen_at = t._now() - timedelta(minutes=1)
        s.add(row)
        s.commit()
        t.record_heartbeat(s, "aaaa", "plus")
        assert s.exec(select(t.ClientPresence)).one().heartbeats == 2


def test_clients_show_online_and_downloading_state_and_totals(engine):
    with Session(engine) as s:
        t.record_heartbeat(s, "online-1", "plus")
        t.record_heartbeat(s, "old-1", "base")
        old = s.exec(select(t.ClientPresence).where(t.ClientPresence.installation_id == "old-1")).one()
        old.last_seen_at = t._now() - timedelta(hours=2)
        s.add(old)
        s.commit()
        t.record_transfer(s, installation_id="online-1", job_id="j1", kind="start", item_name="Portal 2")
        t.record_transfer(s, installation_id="online-1", job_id="j1", kind="piece", piece_index=0, size_bytes=100, item_name="Portal 2")
        t.record_transfer(s, installation_id="online-1", job_id="j1", kind="piece", piece_index=1, size_bytes=250, item_name="Portal 2")
        listing = {c["installation_id"]: c for c in t.clients(s)}
        assert listing["online-1"]["online"] and listing["online-1"]["downloading"]
        assert (listing["online-1"]["pieces_served"], listing["online-1"]["bytes_served"]) == (2, 350)
        assert not listing["old-1"]["online"] and listing["old-1"]["pieces_served"] == 0


def test_client_history_groups_by_game_and_day(engine):
    with Session(engine) as s:
        t.record_heartbeat(s, "c1", "plus")
        t.record_transfer(s, installation_id="c1", job_id="j1", kind="start", item_name="Portal 2")
        t.record_transfer(s, installation_id="c1", job_id="j1", kind="piece", piece_index=0, size_bytes=500, item_name="Portal 2")
        t.record_transfer(s, installation_id="c1", job_id="j2", kind="piece", piece_index=0, size_bytes=70, item_name="Magicka")
        history = t.client_history(s, "c1")
        games = {g["item_name"]: g for g in history["games"]}
        assert games["Portal 2"]["bytes"] == 500 and games["Portal 2"]["requested"] == 1
        assert sum(d["bytes"] for d in history["per_day"]) == 570
        assert history["known"] and t.client_history(s, "nobody")["known"] is False


def test_sample_is_stored_once_per_minute_and_overview_reports_peaks(engine):
    with Session(engine) as s:
        t.record_heartbeat(s, "c1", "plus")
        t.record_transfer(s, installation_id="c1", job_id="j1", kind="piece", piece_index=0, size_bytes=1000, item_name="x")
    assert t.take_sample(engine) is True
    assert t.take_sample(engine) is False  # another instance already stored this minute
    with Session(engine) as s:
        data = t.overview(s)
        assert data["clients_online"] == 1 and data["clients_downloading"] == 1
        assert data["peaks_7d"]["online"] == 1 and data["bytes_served_24h"] == 1000
        assert data["daily"] and data["limits"]["max_jobs"] >= 1


def test_prune_removes_old_rows_only(engine):
    with Session(engine) as s:
        s.add(t.ServerSample(sampled_at=t._now() - timedelta(days=t.SAMPLE_KEEP_DAYS + 1)))
        s.add(t.ServerSample(sampled_at=t._now()))
        s.commit()
    t.prune(engine)
    with Session(engine) as s:
        assert len(s.exec(select(t.ServerSample)).all()) == 1


def test_dashboard_endpoints_require_admin(engine, monkeypatch):
    def deny(request):
        raise HTTPException(403, "Administrator access required")

    monkeypatch.setattr(routes, "_admin_activation_access", deny)
    with Session(engine) as s:
        with pytest.raises(HTTPException) as err:
            routes.api_overview(None, __import__("fastapi").Response(), s)
        assert err.value.status_code == 403
        with pytest.raises(HTTPException):
            routes.api_clients(None, __import__("fastapi").Response(), 10, s)


def test_dashboard_endpoints_return_data_for_admin(engine, monkeypatch, tmp_path):
    monkeypatch.setattr(routes, "_admin_activation_access", lambda request: None)
    monkeypatch.setattr(routes, "default_work_dir", lambda: tmp_path)
    (tmp_path / "a.part").write_bytes(b"x" * 10)
    from fastapi import Response

    with Session(engine) as s:
        t.record_heartbeat(s, "c1", "plus")
        assert routes.api_overview(None, Response(), s)["work_dir_bytes"] == 10
        assert routes.api_clients(None, Response(), 10, s)["clients"][0]["installation_id"] == "c1"
        assert routes.api_client_history("c1", None, Response(), s)["known"] is True
