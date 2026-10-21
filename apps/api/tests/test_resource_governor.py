import asyncio
import hashlib

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app import notify as notify_module
from app import resource_governor as rg
from app import viking_chunk_service as svc
from app.viking_cache_service import ProviderFailure

GB = 1024 ** 3


@pytest.fixture()
def engine():
    eng = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    SQLModel.metadata.create_all(eng, tables=[rg.ResourceUsage.__table__])
    return eng


class Alerts:
    def __init__(self):
        self.sent = []

    def __call__(self, key, title, message, priority=4, cooldown=3600):
        self.sent.append((key, title))


def make(engine, budget=10 * GB, month="2026-10", alerts=None, clock=None):
    box = {"month": month}
    g = rg.Governor(engine, budget_bytes=budget, cpu_limit=85, cores=.1, month=lambda: box["month"],
                    alert=alerts or Alerts(), clock=clock or (lambda: 0.0))
    return g, box


def test_work_is_approved_until_the_stop_line_and_traffic_survives_a_restart(engine):
    alerts = Alerts()
    g, _ = make(engine, budget=100, alerts=alerts)
    assert g.approve(60) and not g.approve(31)      # stop line: 90 of 100
    g.release(60, sent=True)
    g.count_out(25)                                  # 85 sent: past the 80 % warning
    assert [k for k, _ in alerts.sent] == ["traffic-stop:2026-10", "traffic-warn:2026-10"]
    g.flush()
    again, _ = make(engine, budget=100)
    assert again.used() == 85 and not again.approve(10)


def test_an_unsent_piece_gives_its_room_back(engine):
    g, _ = make(engine, budget=100)
    assert g.approve(80)
    g.release(80, sent=False)
    assert g.used() == 0 and g.approve(80)


def test_a_new_month_starts_from_zero(engine):
    g, box = make(engine, budget=100)
    g.count_out(85)
    g.flush()
    box["month"] = "2026-11"
    assert g.approve(80) and g.used() == 0


def test_cpu_is_measured_against_the_share_render_gives_the_container(tmp_path):
    (tmp_path / "cpu.max").write_text("10000 100000\n")
    assert rg.allowed_cores(tmp_path) == pytest.approx(.1)
    (tmp_path / "cpu.max").write_text("max 100000\n")
    assert rg.allowed_cores(tmp_path) >= 1


def test_cpu_above_the_limit_holds_work_and_alerts_after_five_minutes(engine):
    alerts, now = Alerts(), {"t": 0.0}
    g, _ = make(engine, alerts=alerts, clock=lambda: now["t"])
    g.record_cpu(95)
    assert not g.cpu_ok() and alerts.sent == []
    now["t"] = 301
    g.record_cpu(95)
    assert alerts.sent == [("cpu-high", "Servidor: CPU alta")]
    g.record_cpu(20)
    assert g.cpu_ok()


def test_every_response_is_counted(engine, monkeypatch):
    g, _ = make(engine)
    monkeypatch.setattr(rg, "_governor", g)
    app = FastAPI()
    app.add_middleware(rg.TrafficCounter)
    app.get("/x")(lambda: {"data": "a" * 1000})
    TestClient(app).get("/x")
    assert 1000 < g.used() < 1000 + 2 * rg.HEADER_BYTES


class Source:
    async def fetch(self, piece, dest):
        dest.write_bytes(b"x" * 10)
        return hashlib.sha256(b"x" * 10).hexdigest()


class Sink:
    def __init__(self):
        self.uploaded = 0

    async def upload(self, path, name, folder=""):
        self.uploaded += 1
        return "hash-" + name


def test_the_piece_route_stops_when_the_budget_would_be_passed(engine, tmp_path, monkeypatch):
    g, _ = make(engine, budget=int(250 * 1024 ** 2 / rg.STOP_SHARE))  # room for 250 MB of pieces
    monkeypatch.setattr(rg, "_governor", g)
    monkeypatch.setattr(svc, "_mark_piece_ready", lambda *args: None)
    plan = [svc.PlannedPiece(i, 0, i * 100 * 1024 ** 2, (i + 1) * 100 * 1024 ** 2 - 1) for i in range(4)]
    sink = Sink()
    with pytest.raises(ProviderFailure) as stopped:
        asyncio.run(svc._transfer(None, "job", plan, Source(), sink, tmp_path, lambda p: f"p{p.index}", uploads=1, fetches=1))
    assert stopped.value.code == "server_budget_exhausted"
    assert g.reserved == 0 and g.used() == sink.uploaded * 100 * 1024 ** 2


def test_alerts_go_to_the_topic_once_per_cooldown(monkeypatch):
    posted = []
    monkeypatch.setenv("GAMEACCESS_NTFY_TOPIC", "secret-topic")
    monkeypatch.setattr(notify_module, "_last_sent", {})

    class Ok:
        status_code = 200

    post = lambda url, json, timeout: posted.append(json) or Ok()  # noqa: E731
    clock = {"t": 0.0}
    assert notify_module.notify("k", "Título", "Mensaje", post=post, clock=lambda: clock["t"])
    assert not notify_module.notify("k", "Título", "Mensaje", post=post, clock=lambda: clock["t"])
    clock["t"] = 3601
    assert notify_module.notify("k", "Título", "Mensaje", post=post, clock=lambda: clock["t"])
    assert len(posted) == 2 and posted[0]["topic"] == "secret-topic" and posted[0]["title"] == "Título"


def test_without_a_topic_alerts_are_only_logged(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_NTFY_TOPIC", raising=False)
    assert notify_module.notify("k2", "t", "m", post=lambda *a, **k: pytest.fail("must not post")) is False
