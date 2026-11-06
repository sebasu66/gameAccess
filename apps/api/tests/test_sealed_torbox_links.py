import asyncio
import json

import pytest
from fastapi import Response
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import viking_chunk_routes as routes
from app import viking_chunk_service as svc
from app.link_sealing import SealError, seal, unseal
from app.viking_chunk_models import VikingChunkJob, VikingChunkPiece

TORBOX_URL = "https://nexus-1.latm.tb-cdn.cx/dld/abc?token=the-account-api-key"


def test_a_sealed_link_opens_only_for_its_session():
    sealed = seal(TORBOX_URL, "session-token", "inst-1")
    assert "the-account-api-key" not in sealed and "tb-cdn" not in sealed
    assert unseal(sealed, "session-token", "inst-1") == TORBOX_URL
    assert seal(TORBOX_URL, "session-token", "inst-1") != sealed  # a fresh nonce every time
    for token, installation in (("other-token", "inst-1"), ("session-token", "inst-2")):
        with pytest.raises(SealError):
            unseal(sealed, token, installation)
    tampered = sealed[:-6] + ("AAAAAA" if not sealed.endswith("AAAAAA") else "BBBBBB")
    with pytest.raises(SealError):
        unseal(tampered, "session-token", "inst-1")


def test_the_launcher_copy_is_identical():
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    assert (root / "api/app/link_sealing.py").read_bytes() == (root / "launcher/game_download_manager/link_sealing.py").read_bytes()


@pytest.fixture()
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        yield s


class FakeRequest:
    headers = {"Authorization": "Bearer session-token", "X-GameAccess-Installation": "inst-1"}


class FakeTorboxSource:
    def __init__(self):
        self.asked = []

    async def _link(self, file_index, *, refresh):
        self.asked.append((file_index, refresh))
        return f"{TORBOX_URL}&file={file_index}"


def make_job(session):
    job = VikingChunkJob(job_id="job12345abcdef", source_fingerprint="fp", source_url="magnet:x", source_kind="torrent",
                         item_name="Game", status="running", files_json=json.dumps([{"index": 0, "name": "a.rar", "size": 10},
                                                                                    {"index": 1, "name": "b.rar", "size": 20}]),
                         total_bytes=30, owner="test", created_at=svc._now(), updated_at=svc._now())
    session.add(job)
    for index, size in ((0, 10), (1, 20)):
        session.add(VikingChunkPiece(job_id=job.job_id, piece_index=index, file_index=index, start_byte=0, size_bytes=size,
                                     status="pending", updated_at=svc._now()))
    session.commit()
    return job


def test_while_viking_imports_players_get_sealed_torbox_links(session, monkeypatch):
    monkeypatch.setattr(routes, "_installation_for_plus", lambda request, session: "inst-1")
    job = make_job(session)
    source = FakeTorboxSource()
    svc._torbox_sources[job.job_id] = source
    try:
        manifest = svc.build_manifest(session, job)
        assert [p["ready"] for p in manifest["pieces"]] == [True, True]
        got = asyncio.run(routes.chunk_piece_links(job.job_id, FakeRequest(), Response(), 0, 12, session, session))["links"]
        assert [l["index"] for l in got] == [0, 1] and all("url" not in l for l in got)
        assert unseal(got[1]["sealed"], "session-token", "inst-1") == f"{TORBOX_URL}&file=1"
        one = asyncio.run(routes.chunk_piece_link(job.job_id, 0, FakeRequest(), Response(), session, session, refresh=True))
        assert unseal(one["sealed"], "session-token", "inst-1").endswith("file=0") and source.asked[-1] == (0, True)
    finally:
        svc._torbox_sources.pop(job.job_id, None)


def test_without_a_running_import_pending_pieces_are_not_offered(session):
    job = make_job(session)
    assert [p["ready"] for p in svc.build_manifest(session, job)["pieces"]] == [False, False]
    assert svc.get_torbox_pieces(session, job.job_id, 0, 10) == []
