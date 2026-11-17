"""Batch links + shared memory cache, including the 100-players load test."""
import asyncio
import time

import pytest
from fastapi import HTTPException, Response
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import viking_chunk_routes as routes
from app import viking_chunk_service as svc
from app.telemetry import ChunkTransfer, ClientPresence, ServerSample
from app.viking_cache_service import ProviderFailure
from app.viking_chunk_models import VikingChunkJob, VikingChunkPiece
from app.viking_link_cache import LinkCache

PIECES = 12


@pytest.fixture()
def session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(engine, tables=[VikingChunkJob.__table__, VikingChunkPiece.__table__, ChunkTransfer.__table__, ClientPresence.__table__, ServerSample.__table__])
    with Session(engine) as s:
        yield s


@pytest.fixture(autouse=True)
def setup(monkeypatch):
    routes.link_cache.clear()
    monkeypatch.setattr(routes, "_installation_for_plus", lambda request, session: "inst-1")

    async def alive(url):
        return True

    monkeypatch.setattr(routes, "probe_direct_link", alive)


def seed(session, ready=PIECES, total=PIECES):
    job = svc.create_job(session, fingerprint="f" * 40, kind="magnet", item_name="Elden Ring")
    for i in range(total):
        session.add(VikingChunkPiece(
            job_id=job.job_id, piece_index=i, file_index=0, start_byte=i * 10, size_bytes=10, sha256=f"s{i}",
            viking_hash=f"H{i}" if i < ready else None, status="ready" if i < ready else "pending", updated_at=svc._now(),
        ))
    session.commit()
    return job.job_id


class SlowProvider:
    """ViKiNG answering in 50 ms; counts how many things it was asked at once."""

    def __init__(self):
        self.calls = 0
        self.now = 0
        self.peak = 0

    async def resolve_viking_direct_link(self, value):
        self.calls += 1
        self.now += 1
        self.peak = max(self.peak, self.now)
        await asyncio.sleep(0.05)
        self.now -= 1
        return f"https://dr.vikingfile.com/{value}"


def links(session, job_id, start=0, count=PIECES):
    return asyncio.run(routes.chunk_piece_links(job_id, None, Response(), start, count, session, session))


def test_batch_returns_only_ready_pieces_in_order(session, monkeypatch):
    job_id = seed(session, ready=5, total=8)
    monkeypatch.setattr(routes, "create_provider", lambda: SlowProvider())
    got = links(session, job_id, start=1, count=10)["links"]
    assert [l["index"] for l in got] == [1, 2, 3, 4]
    assert got[0] == {"index": 1, "size": 10, "sha256": "s1", "url": "https://dr.vikingfile.com/H1"}


def test_batch_is_recorded_in_one_write(session, monkeypatch):
    from sqlmodel import select

    job_id = seed(session)
    monkeypatch.setattr(routes, "create_provider", lambda: SlowProvider())
    links(session, job_id)
    rows = session.exec(select(ChunkTransfer)).all()
    assert len(rows) == PIECES and {r.kind for r in rows} == {"piece"}


def test_batch_fails_only_when_nothing_could_be_resolved(session, monkeypatch):
    job_id = seed(session, ready=2, total=2)

    class Half:
        async def resolve_viking_direct_link(self, value):
            if value == "H1":
                raise ProviderFailure("viking_resolve_failed", 502, "no")
            return "https://dr/" + value

    monkeypatch.setattr(routes, "create_provider", lambda: Half())
    assert [l["index"] for l in links(session, job_id)["links"]] == [0]

    class Broken:
        async def resolve_viking_direct_link(self, value):
            raise ProviderFailure("viking_auth_required", 503, "Sesión vencida.")

    routes.link_cache.clear()
    monkeypatch.setattr(routes, "create_provider", lambda: Broken())
    with pytest.raises(HTTPException) as err:
        links(session, job_id)
    assert err.value.status_code == 503


def test_cache_does_not_keep_failures_and_never_expires_by_age():
    cache = LinkCache(verify_every=0.0)  # always try the link before handing it out
    calls = []

    async def resolver(key):
        calls.append(key)
        if len(calls) == 1:
            raise ProviderFailure("x", 502, "x")
        return "u" + str(len(calls))

    async def alive(url):
        return True

    async def run():
        with pytest.raises(ProviderFailure):
            await cache.get("a", resolver, alive)
        assert await cache.get("a", resolver, alive) == "u2"  # failure was not cached
        await asyncio.sleep(0.05)
        assert await cache.get("a", resolver, alive) == "u2"  # old, but it still works: kept
        assert len(calls) == 2 and cache.probes == 1

    asyncio.run(run())


def test_a_link_that_stopped_working_is_replaced_by_a_new_one():
    cache = LinkCache(verify_every=0.0)
    served = iter(["old", "new"])
    tried = []

    async def resolver(key):
        return next(served)

    async def verifier(url):
        tried.append(url)
        return url != "old"  # ViKiNG refuses the old one

    async def run():
        assert await cache.get("a", resolver, verifier) == "old"
        assert await cache.get("a", resolver, verifier) == "new"  # tried "old" first, it failed, asked again
        assert tried == ["old"]
        assert cache.resolutions == 2

    asyncio.run(run())


def test_a_link_is_not_tried_again_for_every_player_and_refresh_forces_a_new_one():
    cache = LinkCache(verify_every=300)
    served = iter(["a1", "a2"])

    async def resolver(key):
        return next(served)

    async def alive(url):
        return True

    async def run():
        assert await cache.get("a", resolver, alive) == "a1"
        for _ in range(20):
            assert await cache.get("a", resolver, alive) == "a1"
        assert cache.probes == 0  # verified a moment ago, so nobody pays for another try
        assert await cache.get("a", resolver, alive, refresh=True) == "a2"  # the player said it did not work

    asyncio.run(run())


def test_a_link_close_to_its_signed_expiry_is_replaced():
    cache = LinkCache()
    soon = f"https://dr/x?md5=m&expires={int(time.time()) + 30}"
    later = f"https://dr/x?md5=m&expires={int(time.time()) + 3600}"
    served = iter([soon, later])

    async def resolver(key):
        return next(served)

    async def run():
        assert await cache.get("a", resolver) == soon
        assert await cache.get("a", resolver) == later  # the one in memory was about to expire

    asyncio.run(run())


def test_100_players_ask_for_the_same_cached_job(session, monkeypatch):
    """Success criterion: 100 simultaneous players cost ViKiNG one resolution per piece, and everybody gets all links fast."""
    job_id = seed(session)
    provider = SlowProvider()
    monkeypatch.setattr(routes, "create_provider", lambda: provider)

    async def player():
        got = await routes.chunk_piece_links(job_id, None, Response(), 0, PIECES, session, session)
        return len(got["links"])

    async def crowd():
        return await asyncio.gather(*(player() for _ in range(100)))

    started = time.perf_counter()
    counts = asyncio.run(crowd())
    elapsed = time.perf_counter() - started
    assert counts == [PIECES] * 100
    assert provider.calls == PIECES  # 100 players, 12 real questions to ViKiNG
    assert provider.peak <= 8  # never more than a few at once
    assert elapsed < 5

    # Second wave, links already cached: ViKiNG is not asked again
    asyncio.run(crowd())
    assert provider.calls == PIECES
