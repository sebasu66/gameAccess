from datetime import datetime, timedelta, timezone

from sqlmodel import Session, SQLModel, create_engine

from app.download_events import DownloadEvent, events_for_jobs, log_event, recent_errors, requesting_client


def _engine():
    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine, tables=[DownloadEvent.__table__])
    return engine


def test_events_come_back_oldest_first_and_grouped_by_job():
    engine = _engine()
    log_event(engine, "a", "request", "pidió", installation_id="cli-1", item_name="Portal 2")
    log_event(engine, "a", "torbox", "paso 1")
    log_event(engine, "b", "request", "otro")
    with Session(engine) as session:
        result = events_for_jobs(session, ["a", "b", "c"])
    assert [e["step"] for e in result["a"]] == ["request", "torbox"]
    assert result["c"] == []
    assert requesting_client(result["a"]) == "cli-1"


def test_errors_are_listed_and_a_missing_table_never_breaks_a_download():
    engine = _engine()
    log_event(engine, "a", "error", "Torbox no terminó", status="error", installation_id="cli-1")
    log_event(engine, "a", "ready", "listo", status="ok")
    with Session(engine) as session:
        errors = recent_errors(session, datetime.now(timezone.utc) - timedelta(hours=1))
    assert [e["message"] for e in errors] == ["Torbox no terminó"]
    log_event(create_engine("sqlite://"), "x", "request", "sin tabla")  # must not raise
