import asyncio
import json

import httpx
import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine, select

from app import viking_chunk_service as svc
from app import viking_map
from app.download_events import DownloadEvent
from app.viking_cache_service import ProviderFailure, TorBoxVikingProvider
from app.viking_chunk_models import VikingChunkJob, VikingChunkPiece
from app.viking_chunk_plan import MB

from test_viking_chunk_service import FakeImporter, FakeSink, FakeSource, files_for

FP = "f" * 64


@pytest.fixture()
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[VikingChunkJob.__table__, VikingChunkPiece.__table__, DownloadEvent.__table__])
    return eng


@pytest.fixture(autouse=True)
def fresh_memory(monkeypatch):
    monkeypatch.setattr(viking_map, "_absent", {})
    monkeypatch.setattr(viking_map, "_locks", {})

    async def fast(_seconds):
        return None

    monkeypatch.setattr(svc, "_sleep", fast)


class FakeStore:
    """A ViKiNG folder in memory: the maps saved and the files listed."""

    def __init__(self, document=None, listing=None, fail=False):
        self.saved: list[tuple[str, dict]] = []
        self.document, self.listing, self.fail = document, list(listing or []), fail
        self.loads = 0

    async def save(self, folder, document):
        self.saved.append((folder, json.loads(json.dumps(document))))

    async def load(self, folder):
        self.loads += 1
        await asyncio.sleep(0.01)
        if self.fail:
            raise ProviderFailure("viking_list_failed", 502, "x")
        return self.document, self.listing


def new_job(engine, fingerprint=FP):
    with Session(engine) as session:
        return svc.create_job(session, fingerprint=fingerprint, kind="torrent", item_name="Game", source_url="magnet:x").job_id


def run(engine, job_id, files, store, work_dir, importer=None):
    source = FakeSource()

    async def prepare():
        return source, files

    asyncio.run(svc.run_chunk_job(engine, job_id, prepare=prepare, sink=FakeSink(), work_dir=work_dir,
                                  importer=(lambda _s: importer) if importer else None, maps=store))


def remote_map(*sizes):
    files = files_for(*sizes)
    return {
        "v": 1, "kind": "torrent", "item_name": "Game",
        "files": [{"index": i, "name": f["name"], "size": f["size"]} for i, f in enumerate(files)],
        "pieces": [{"index": i, "file_index": i, "start": 0, "size": s, "sha256": ""} for i, s in enumerate(sizes)],
    }


def entry(index, size, file_hash=None, created="2026-10-21 10:00"):
    return {"hash": file_hash or f"h{index}", "name": viking_map.piece_name(FP, index), "size": size, "created": created}


def test_a_remote_job_saves_its_map_in_the_source_folder_before_importing(engine, tmp_path):
    store, importer = FakeStore(), FakeImporter()
    job_id = new_job(engine)
    run(engine, job_id, files_for(500 * MB, 200 * MB), store, tmp_path, importer)
    assert [folder for folder, _ in store.saved] == [f"GameAccess/{FP[:16]}"]  # one save: remote pieces have no hash
    document = store.saved[0][1]
    assert document["item_name"] == "Game" and "magnet" not in json.dumps(document)  # the original link stays here
    assert [(p["file_index"], p["size"]) for p in document["pieces"]] == [(0, 500 * MB), (1, 200 * MB)]
    assert {c[1] for c in importer.calls} == {viking_map.piece_name(FP, 0), viking_map.piece_name(FP, 1)}


def test_a_job_that_hashes_its_pieces_saves_the_map_again_with_the_hashes(engine, tmp_path):
    store = FakeStore()
    run(engine, new_job(engine), files_for(1 * MB), store, tmp_path)
    assert len(store.saved) == 2
    assert store.saved[0][1]["pieces"][0]["sha256"] == ""
    assert len(store.saved[1][1]["pieces"][0]["sha256"]) == 64


def test_a_forgotten_source_comes_back_ready_from_its_viking_folder(engine):
    store = FakeStore(remote_map(500 * MB, 200 * MB), [entry(0, 500 * MB), entry(1, 200 * MB)])
    job_id = asyncio.run(viking_map.restore_from_viking(engine, FP, source_url="magnet:x", store_factory=lambda: store))
    with Session(engine) as session:
        job = svc.get_job(session, job_id)
        manifest = svc.build_manifest(session, job)
        assert job.status == "ready" and job.source_url == "magnet:x" and job.total_bytes == 700 * MB
        assert manifest["files"][1] == {"index": 1, "name": "f1.bin", "size": 200 * MB}
        assert all(p["ready"] for p in manifest["pieces"])
        assert svc.get_ready_piece(session, job_id, 1).viking_hash == "h1"


def test_pieces_missing_or_of_another_size_stay_pending_and_only_they_are_imported_again(engine, tmp_path):
    files = files_for(500 * MB, 200 * MB, 300 * MB)
    store = FakeStore(remote_map(500 * MB, 200 * MB, 300 * MB), [entry(0, 500 * MB), entry(1, 199 * MB)])
    job_id = asyncio.run(viking_map.restore_from_viking(engine, FP, store_factory=lambda: store))
    with Session(engine) as session:
        job = svc.get_job(session, job_id)
        assert (job.status, job.error_code) == ("failed", "restored_incomplete")  # the next request resumes it
        assert [p["ready"] for p in svc.build_manifest(session, job)["pieces"]] == [True, False, False]
    importer = FakeImporter()
    run(engine, job_id, files, FakeStore(), tmp_path, importer)
    assert sorted(c[0] for c in importer.calls) == [1, 2]
    with Session(engine) as session:
        assert svc.get_job(session, job_id).status == "ready"
        assert svc.get_ready_piece(session, job_id, 0).viking_hash == "h0"


def test_a_split_piece_without_its_hash_is_not_trusted(engine):
    document = remote_map(500 * MB)
    document["files"][0]["size"] = 900 * MB  # piece 0 is only part of the file: the player needs its hash
    store = FakeStore(document, [entry(0, 500 * MB)])
    job_id = asyncio.run(viking_map.restore_from_viking(engine, FP, store_factory=lambda: store))
    with Session(engine) as session:
        assert svc.get_ready_piece(session, job_id, 0) is None


def test_an_empty_folder_is_listed_once_and_a_viking_failure_is_not_remembered(engine):
    empty = FakeStore(None, [])
    assert asyncio.run(viking_map.restore_from_viking(engine, FP, store_factory=lambda: empty)) is None
    assert asyncio.run(viking_map.restore_from_viking(engine, FP, store_factory=lambda: empty)) is None
    assert empty.loads == 1
    down = FakeStore(fail=True)
    other = "e" * 64
    for _ in range(2):
        assert asyncio.run(viking_map.restore_from_viking(engine, other, store_factory=lambda: down)) is None
    assert down.loads == 2


def test_requests_at_the_same_time_restore_the_source_once(engine):
    store = FakeStore(remote_map(500 * MB), [entry(0, 500 * MB)])

    async def both():
        return await asyncio.gather(*(viking_map.restore_from_viking(engine, FP, store_factory=lambda: store) for _ in range(3)))

    ids = asyncio.run(both())
    assert len(set(ids)) == 1 and store.loads == 1
    with Session(engine) as session:
        assert len(session.exec(select(VikingChunkJob)).all()) == 1


def test_a_broken_map_is_ignored(engine):
    store = FakeStore({"v": 99}, [entry(0, 1)])
    assert asyncio.run(viking_map.restore_from_viking(engine, FP, store_factory=lambda: store)) is None


def test_the_viking_store_lists_every_page_reads_the_newest_map_and_drops_older_ones(tmp_path):
    calls: list[tuple[str, dict]] = []
    pages = {
        1: [{"hash": "m-old", "name": "ga-map.json", "size": 10, "created": "2026-10-20 10:00"}],
        2: [{"hash": "m-new", "name": "ga-map.json", "size": 10, "created": "2026-10-21 10:00"},
            {"hash": "p0", "name": "ga-ffffffff.p0000", "size": "5", "created": "2026-10-21 10:00"}],
    }

    def handler(request: httpx.Request) -> httpx.Response:
        form = dict(httpx.QueryParams(request.content.decode())) if request.method == "POST" and b"=" in request.content else {}
        calls.append((request.url.path, form))
        if request.url.path == "/api/list-files":
            page = int(form["page"])
            return httpx.Response(200, json={"currentPage": page, "maxPages": 2, "files": pages[page]})
        if request.url.path == "/api/delete-file":
            return httpx.Response(200, json={"error": "success"})
        if request.url.path == "/api/get-server":
            return httpx.Response(200, json={"server": "https://upload.vikingfile.com/"})
        if request.url.host == "upload.vikingfile.com":
            return httpx.Response(200, json={"name": "ga-map.json", "size": "10", "hash": "m-new", "url": "https://vikingfile.com/f/m-new"})
        if request.url.path == "/direct/m-new":
            return httpx.Response(200, json=remote_map(5))
        raise AssertionError(request.url)

    provider = TorBoxVikingProvider(viking_user_hash="user", transport=httpx.MockTransport(handler))

    async def direct(file_hash):
        return f"https://cdn.vikingfile.com/direct/{file_hash}"

    provider.resolve_viking_direct_link = direct
    store = viking_map.VikingMapStore(provider)
    document, listing = asyncio.run(store.load("GameAccess/x"))
    assert document == remote_map(5) and listing[-1]["size"] == 5
    assert all(form.get("path") == "GameAccess/x" and form.get("user") == "user" for path, form in calls if path == "/api/list-files")
    calls.clear()
    asyncio.run(store.save("GameAccess/x", remote_map(5)))
    assert [form["hash"] for path, form in calls if path == "/api/delete-file"] == ["m-old"]
