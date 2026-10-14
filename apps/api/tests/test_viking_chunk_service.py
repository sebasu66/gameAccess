import asyncio
import hashlib
from pathlib import Path

import pytest
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import viking_chunk_service as svc
from app.viking_cache_service import ProviderFailure
from app.viking_chunk_models import VikingChunkJob, VikingChunkPiece
from app.viking_chunk_plan import MB, PlannedPiece

DATA = bytes(range(256)) * 4096  # 1 MiB


@pytest.fixture()
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[VikingChunkJob.__table__, VikingChunkPiece.__table__])
    return eng


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch):
    async def fast(_seconds):
        return None

    monkeypatch.setattr(svc, "_sleep", fast)


def new_job(engine) -> str:
    with Session(engine) as session:
        return svc.create_job(session, fingerprint="fp1", kind="torrent", item_name="Game").job_id


class FakeSource:
    def __init__(self, fail_first: dict[int, int] | None = None):
        self.calls: list[int] = []
        self.fail_first = dict(fail_first or {})
        self.on_disk = 0
        self.peak = 0

    async def fetch(self, piece: PlannedPiece, dest: Path) -> str:
        self.calls.append(piece.index)
        if self.fail_first.get(piece.index, 0) > 0:
            self.fail_first[piece.index] -= 1
            raise RuntimeError("boom")
        dest.write_bytes(DATA[: min(piece.size, len(DATA))])
        return hashlib.sha256(dest.read_bytes()).hexdigest()


class FakeSink:
    def __init__(self, fail_names: set[str] | None = None, work_dir: Path | None = None):
        self.names: list[str] = []
        self.folders: set[str] = set()
        self.fail_names = fail_names or set()
        self.work_dir = work_dir
        self.peak_files = 0

    async def upload(self, path: Path, name: str, folder: str = "") -> str:
        self.folders.add(folder)
        if self.work_dir is not None:
            self.peak_files = max(self.peak_files, len(list(self.work_dir.glob("*.part"))))
        await asyncio.sleep(0)
        if name in self.fail_names:
            raise RuntimeError("upload failed")
        self.names.append(name)
        return f"hash-{name}"


def files_for(*sizes: int) -> list[dict]:
    return [{"id": i, "name": f"f{i}.bin", "size": s} for i, s in enumerate(sizes)]


def run(engine, job_id, source, sink, files, work_dir):
    async def prepare():
        return source, files

    asyncio.run(svc.run_chunk_job(engine, job_id, prepare=prepare, sink=sink, work_dir=work_dir))


def test_job_uploads_every_piece_and_builds_the_manifest(engine, tmp_path):
    job_id = new_job(engine)
    source, sink = FakeSource(), FakeSink(work_dir=tmp_path)
    run(engine, job_id, source, sink, files_for(300 * MB), tmp_path)

    with Session(engine) as session:
        job = svc.get_job(session, job_id)
        manifest = svc.build_manifest(session, job)
        assert job.status == "ready" and job.completed_at is not None
        assert manifest["total_bytes"] == 300 * MB
        assert manifest["piece_count"] == manifest["ready_count"] == len(sink.names)
        assert all(p["ready"] and p["sha256"] for p in manifest["pieces"])
        sizes = [p["size"] for p in manifest["pieces"]]
        assert sum(sizes) == 300 * MB
        assert sizes[0] == 100 * MB
        assert svc.get_ready_piece(session, job_id, 0).viking_hash.startswith("hash-ga-")
        assert svc.get_ready_piece(session, job_id, 999) is None
    assert not list(tmp_path.glob("*.part"))
    assert sink.peak_files <= svc.MAX_PIECES_ON_DISK
    assert sink.folders == {f"GameAccess/{job_id[:8]}"}


def test_at_most_two_pieces_sit_on_disk(engine, tmp_path):
    job_id = new_job(engine)
    run(engine, job_id, FakeSource(), FakeSink(work_dir=tmp_path), files_for(3000 * MB), tmp_path)
    # the sink peeks at the disk on every upload
    sink = FakeSink(work_dir=tmp_path)
    job2 = new_job(engine)
    run(engine, job2, FakeSource(), sink, files_for(3000 * MB), tmp_path)
    assert 0 < sink.peak_files <= svc.UPLOADS_IN_PARALLEL + 1


def test_a_failed_piece_is_retried(engine, tmp_path):
    job_id = new_job(engine)
    source = FakeSource(fail_first={0: 2})
    run(engine, job_id, source, FakeSink(), files_for(50 * MB), tmp_path)
    with Session(engine) as session:
        assert svc.get_job(session, job_id).status == "ready"
    assert source.calls.count(0) == 3


def test_a_piece_that_keeps_failing_fails_the_job_and_keeps_ready_pieces(engine, tmp_path):
    job_id = new_job(engine)
    sink = FakeSink(fail_names={f"ga-{job_id[:8]}.p0001"})
    run(engine, job_id, FakeSource(), sink, files_for(300 * MB), tmp_path)
    with Session(engine) as session:
        job = svc.get_job(session, job_id)
        assert job.status == "failed" and job.error_code == "unexpected_error"
        assert svc.get_ready_piece(session, job_id, 0) is not None
    assert not list(tmp_path.glob("*.part"))


def test_resume_skips_pieces_that_are_already_ready(engine, tmp_path):
    job_id = new_job(engine)
    sink = FakeSink(fail_names={f"ga-{job_id[:8]}.p0001"})
    run(engine, job_id, FakeSource(), sink, files_for(300 * MB), tmp_path)

    source = FakeSource()
    run(engine, job_id, source, FakeSink(), files_for(300 * MB), tmp_path)
    assert 0 not in source.calls
    with Session(engine) as session:
        job = svc.get_job(session, job_id)
        assert job.status == "ready" and job.error_code == ""
        assert svc.build_manifest(session, job)["ready_count"] == svc.build_manifest(session, job)["piece_count"]


def test_a_changed_plan_discards_old_pieces(engine, tmp_path):
    job_id = new_job(engine)
    run(engine, job_id, FakeSource(), FakeSink(), files_for(50 * MB), tmp_path)
    source = FakeSource()
    run(engine, job_id, source, FakeSink(), files_for(60 * MB), tmp_path)
    assert source.calls == [0]


def test_source_without_files_fails_cleanly(engine, tmp_path):
    job_id = new_job(engine)
    run(engine, job_id, FakeSource(), FakeSink(), files_for(0), tmp_path)
    with Session(engine) as session:
        assert svc.get_job(session, job_id).error_code == "torbox_no_files"


def test_too_many_files_is_refused(engine, tmp_path):
    job_id = new_job(engine)
    run(engine, job_id, FakeSource(), FakeSink(), files_for(*([MB] * (svc.MAX_FILES + 1))), tmp_path)
    with Session(engine) as session:
        assert svc.get_job(session, job_id).error_code == "too_many_files"


def test_provider_failure_while_preparing_marks_the_job_failed(engine, tmp_path):
    job_id = new_job(engine)

    async def prepare():
        raise ProviderFailure("torbox_not_configured", 503, "x")

    asyncio.run(svc.run_chunk_job(engine, job_id, prepare=prepare, sink=FakeSink(), work_dir=tmp_path))
    with Session(engine) as session:
        job = svc.get_job(session, job_id)
        assert job.status == "failed" and job.error_code == "torbox_not_configured"


def test_recovery_fails_active_jobs_only(engine):
    with Session(engine) as session:
        a = svc.create_job(session, fingerprint="a", kind="torrent", item_name="a")
        b = svc.create_job(session, fingerprint="b", kind="torrent", item_name="b")
        b.status = "ready"
        session.add(b)
        session.commit()
        a_id, b_id = a.job_id, b.job_id
    assert svc.recover_interrupted_chunk_jobs(engine) == 1
    with Session(engine) as session:
        assert svc.get_job(session, a_id).error_code == "server_restarted"
        assert svc.get_job(session, b_id).status == "ready"


def test_find_job_for_source_returns_the_newest(engine):
    with Session(engine) as session:
        svc.create_job(session, fingerprint="x", kind="torrent", item_name="old")
        newest = svc.create_job(session, fingerprint="x", kind="torrent", item_name="new")
        assert svc.find_job_for_source(session, "x").job_id == newest.job_id
        assert svc.find_job_for_source(session, "nope") is None


def test_uploads_run_in_parallel_and_pieces_may_finish_out_of_order(engine, tmp_path):
    class SlowFirst(FakeSink):
        def __init__(self):
            super().__init__()
            self.active = 0
            self.peak_active = 0

        async def upload(self, path, name, folder=""):
            self.active += 1
            self.peak_active = max(self.peak_active, self.active)
            await asyncio.sleep(0.05 if name.endswith("p0000") else 0.01)
            self.active -= 1
            return await super().upload(path, name, folder)

    job_id = new_job(engine)
    sink = SlowFirst()
    run(engine, job_id, FakeSource(), sink, files_for(1500 * MB), tmp_path)
    assert sink.peak_active >= 2
    with Session(engine) as session:
        job = svc.get_job(session, job_id)
        manifest = svc.build_manifest(session, job)
        assert job.status == "ready" and manifest["ready_count"] == manifest["piece_count"]
