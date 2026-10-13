from datetime import datetime, timedelta, timezone

from sqlmodel import Session, SQLModel, create_engine

from app import viking_cache_routes as routes
from app.models import VikingDownloadRequest


def _row(request_id: str, status: str, kind: str, minutes_ago: int) -> VikingDownloadRequest:
    return VikingDownloadRequest(
        request_id=request_id,
        installation_id="a" * 32,
        item_name=f"Juego {request_id}",
        requested_at=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        source_kind=kind,
        source_host="example.com",
        source_fingerprint=request_id * 8,
        status=status,
    )


def test_lists_only_running_tasks_and_counts_by_kind(monkeypatch):
    monkeypatch.setattr(routes, "_admin_activation_access", lambda request: None)
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine, tables=[VikingDownloadRequest.__table__])
    with Session(engine) as session:
        session.add_all([
            _row("r1", "processing", "direct", 2),
            _row("r2", "processing", "torrent", 120),
            _row("r3", "completed", "direct", 5),
            _row("r4", "failed", "torrent", 5),
        ])
        session.commit()
        data = routes.get_viking_running_tasks(request=None, session=session)

    assert data["running_total"] == 2
    assert data["running_direct"] == 1 and data["running_torrents"] == 1
    assert data["last_24h"]["completed"] == 1 and data["last_24h"]["failed"] == 1
    by_id = {task["request_id"]: task for task in data["tasks"]}
    assert by_id["r1"]["possibly_stuck"] is False
    assert by_id["r2"]["possibly_stuck"] is True
    assert "r3" not in by_id
