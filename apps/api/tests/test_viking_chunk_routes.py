import asyncio

import pytest
from fastapi import HTTPException, Response
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import viking_chunk_routes as routes
from app import viking_chunk_service as svc
from app.viking_cache_service import ProviderFailure
from app.telemetry import ChunkTransfer, ClientPresence, ServerSample
from app.viking_chunk_models import VikingChunkJob, VikingChunkPiece

MAGNET = "magnet:?xt=urn:btih:" + "a" * 40 + "&dn=Portal"


@pytest.fixture()
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[VikingChunkJob.__table__, VikingChunkPiece.__table__, ChunkTransfer.__table__, ClientPresence.__table__, ServerSample.__table__])
    with Session(engine) as s:
        yield s


@pytest.fixture(autouse=True)
def empty_link_cache(monkeypatch):
    routes.link_cache.clear()

    async def alive(url):
        return True

    monkeypatch.setattr(routes, "probe_direct_link", alive)


@pytest.fixture(autouse=True)
def plus_user(monkeypatch):
    monkeypatch.setattr(routes, "_installation_for_plus", lambda request, session: "inst-1")
    started: list[str] = []
    monkeypatch.setattr(routes, "start_job", lambda engine, job_id, **kw: started.append(job_id))
    return started


def post(session, url=MAGNET):
    return asyncio.run(routes.start_chunk_download(routes.ChunkJobRequest(source_url=url, item_name="Portal 2"), None, Response(), session, session))


def test_starting_creates_a_job_that_remembers_the_original_link(session, plus_user):
    manifest = post(session)
    assert manifest["status"] == "preparing" and manifest["piece_count"] == 0
    assert len(plus_user) == 1
    job = svc.get_job(session, manifest["job_id"])
    assert job.source_url == MAGNET and job.item_name == "Portal 2"


def test_the_same_link_joins_the_running_job_instead_of_starting_another(session, plus_user, monkeypatch):
    first = post(session)
    monkeypatch.setattr(routes, "is_running", lambda job_id: True)
    second = post(session)
    assert second["job_id"] == first["job_id"] and len(plus_user) == 1


def test_a_failed_job_is_resumed_with_the_same_id(session, plus_user):
    first = post(session)
    job = svc.get_job(session, first["job_id"])
    job.status, job.error_code = "failed", "server_restarted"
    session.add(job)
    session.commit()
    again = post(session)
    assert again["job_id"] == first["job_id"] and again["status"] == "preparing" and again["error"] == ""
    assert len(plus_user) == 2


def test_a_ready_job_is_served_without_new_work(session, plus_user):
    first = post(session)
    job = svc.get_job(session, first["job_id"])
    job.status = "ready"
    session.add(job)
    session.commit()
    assert post(session)["status"] == "ready" and len(plus_user) == 1


def _add_pieces(session, job_id, ready):
    for index in range(4):
        session.add(VikingChunkPiece(job_id=job_id, piece_index=index, file_index=0, start_byte=index * 10, size_bytes=10,
                                     status="ready" if index in ready else "pending", viking_hash="h" if index in ready else None,
                                     updated_at=svc._now()))
    session.commit()


def test_a_resumed_download_tells_the_server_which_pieces_the_player_already_has(session, monkeypatch):
    skips = []
    monkeypatch.setattr(routes, "start_job", lambda engine, job_id, **kw: skips.append(set(kw["skip"])))
    request = routes.ChunkJobRequest(source_url=MAGNET, item_name="Portal 2", have_pieces=[0, 1])
    asyncio.run(routes.start_chunk_download(request, None, Response(), session, session))
    assert skips == [{0, 1}]


def test_a_partial_job_runs_again_only_for_a_player_that_lacks_a_skipped_piece(session, plus_user):
    first = post(session)
    job = svc.get_job(session, first["job_id"])
    job.status = "partial"  # an earlier player already had pieces 0 and 1, so only 2 and 3 went to ViKiNG
    session.add(job)
    session.commit()
    _add_pieces(session, job.job_id, ready={2, 3})
    has_them = routes.ChunkJobRequest(source_url=MAGNET, item_name="Portal 2", have_pieces=[0, 1])
    assert asyncio.run(routes.start_chunk_download(has_them, None, Response(), session, session))["status"] == "partial"
    assert len(plus_user) == 1
    assert post(session)["status"] == "preparing" and len(plus_user) == 2  # a new player needs 0 and 1


def test_bad_links_are_rejected(session):
    with pytest.raises(HTTPException) as err:
        post(session, "magnet:?dn=sin-hash")
    assert err.value.status_code == 422


def test_manifest_404_for_unknown_job(session):
    with pytest.raises(HTTPException) as err:
        asyncio.run(routes.chunk_manifest("nope", None, Response(), session, session))
    assert err.value.status_code == 404


def test_piece_link_only_for_ready_pieces(session, monkeypatch):
    job_id = post(session)["job_id"]
    session.add_all([
        VikingChunkPiece(job_id=job_id, piece_index=0, file_index=0, start_byte=0, size_bytes=10, sha256="s0", viking_hash="H0", status="ready", updated_at=svc._now()),
        VikingChunkPiece(job_id=job_id, piece_index=1, file_index=0, start_byte=10, size_bytes=10, status="pending", updated_at=svc._now()),
    ])
    session.commit()

    class FakeProvider:
        async def resolve_viking_direct_link(self, value):
            assert value == "H0"
            return "https://dr.vikingfile.com/signed"

    monkeypatch.setattr(routes, "create_provider", lambda: FakeProvider())
    got = asyncio.run(routes.chunk_piece_link(job_id, 0, None, Response(), session, session))
    assert got == {"index": 0, "size": 10, "sha256": "s0", "url": "https://dr.vikingfile.com/signed"}
    with pytest.raises(HTTPException) as err:
        asyncio.run(routes.chunk_piece_link(job_id, 1, None, Response(), session, session))
    assert err.value.status_code == 404


def test_piece_link_passes_viking_errors_on(session, monkeypatch):
    job_id = post(session)["job_id"]
    session.add(VikingChunkPiece(job_id=job_id, piece_index=0, file_index=0, start_byte=0, size_bytes=10, sha256="s", viking_hash="H", status="ready", updated_at=svc._now()))
    session.commit()

    class Broken:
        async def resolve_viking_direct_link(self, value):
            raise ProviderFailure("viking_auth_required", 503, "Sesión de ViKiNG vencida.")

    monkeypatch.setattr(routes, "create_provider", lambda: Broken())
    with pytest.raises(HTTPException) as err:
        asyncio.run(routes.chunk_piece_link(job_id, 0, None, Response(), session, session))
    assert err.value.status_code == 503


def test_start_and_piece_requests_are_recorded_per_client(session, monkeypatch):
    from sqlmodel import select

    job_id = post(session)["job_id"]
    session.add(VikingChunkPiece(job_id=job_id, piece_index=0, file_index=0, start_byte=0, size_bytes=4096, sha256="s", viking_hash="H", status="ready", updated_at=svc._now()))
    session.commit()

    class Fake:
        async def resolve_viking_direct_link(self, value):
            return "https://dr.vikingfile.com/x"

    monkeypatch.setattr(routes, "create_provider", lambda: Fake())
    asyncio.run(routes.chunk_piece_link(job_id, 0, None, Response(), session, session))
    rows = session.exec(select(ChunkTransfer).order_by(ChunkTransfer.id)).all()
    assert [(r.installation_id, r.kind, r.size_bytes) for r in rows] == [("inst-1", "start", 0), ("inst-1", "piece", 4096)]
    assert rows[1].item_name == "Portal 2"


def peek(session, url=MAGNET):
    return asyncio.run(routes.peek_chunk_source(routes.ChunkPeekRequest(source_url=url), None, Response(), session, session))


def test_peek_says_whether_the_server_can_serve_the_source_at_once(session, plus_user, monkeypatch):
    cached: list[str] = []

    class Provider:
        async def torbox_has_cached(self, info_hash):
            cached.append(info_hash)
            return info_hash == "a" * 40

    monkeypatch.setattr(routes, "create_provider", lambda: Provider())
    assert peek(session) == {"ready": True, "where": "torbox"}
    other = "magnet:?xt=urn:btih:" + "b" * 40
    assert peek(session, other) == {"ready": False, "where": ""}
    job = svc.get_job(session, post(session, other)["job_id"])
    job.status = "ready"
    session.add(job)
    session.commit()
    assert peek(session, other) == {"ready": True, "where": "viking"}
    assert len(plus_user) == 1  # peeking never starts work
