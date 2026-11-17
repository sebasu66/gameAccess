import base64
from datetime import timedelta
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Session, SQLModel, create_engine, select

from app import main as core
from app.access_keys import AccessKey, digest


def _activated_request(token: str, installation_id: str) -> Request:
    return Request(
        {
            "type": "http",
            "client": ("192.0.2.50", 1234),
            "headers": [
                (b"authorization", f"Bearer {token}".encode("ascii")),
                (b"x-gameaccess-installation", installation_id.encode("ascii")),
                (b"user-agent", b"GameAccess-Test"),
            ],
        }
    )


def _admin_request(token: str) -> Request:
    encoded = base64.b64encode(f"admin:{token}".encode("utf-8"))
    return Request(
        {
            "type": "http",
            "client": ("192.0.2.50", 1234),
            "headers": [(b"authorization", b"Basic " + encoded)],
        }
    )


def test_client_error_report_is_sanitized_and_persisted(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'client-errors.db'}")
    SQLModel.metadata.create_all(engine)
    now = core.now_utc()
    installation_id = str(uuid4())
    session_token = "client-error-session-token"

    with Session(engine) as session:
        session.add(
            AccessKey(
                key_hash=digest("unused-client-error-key"),
                duration_hours=1,
                created_at=now,
                key_expires_at=now + timedelta(hours=1),
                activated_at=now,
                expires_at=now + timedelta(hours=1),
                installation_id=installation_id,
                session_hash=digest(session_token),
            )
        )
        session.commit()

        result = core.report_client_error(
            core.ClientErrorReportRequest(
                area="DOWNLOAD",
                message=(
                    r"Download AppID 620 failed for lease 38: "
                    r"password=hunter2 Bearer abc.def C:\Users\Sebastian\secret.txt"
                ),
                app_id=620,
                lease_id=38,
                client_build="test-build",
            ),
            _activated_request(session_token, installation_id),
            session,
        )

        assert result["ok"] is True
        row = session.exec(select(core.ClientErrorReport)).one()
        assert row.installation_id == installation_id
        assert row.area == "DOWNLOAD"
        assert row.app_id == 620
        assert row.lease_id == 38
        assert row.client_build == "test-build"
        assert "hunter2" not in row.message
        assert "abc.def" not in row.message
        assert "Sebastian" not in row.message
        assert "[redacted]" in row.message
        assert r"C:\Users\[user]" in row.message


def test_client_error_view_uses_admin_basic_auth(tmp_path, monkeypatch) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'client-error-view.db'}")
    SQLModel.metadata.create_all(engine)
    admin_token = "a" * 40
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", admin_token)

    with Session(engine) as session:
        session.add(
            core.ClientErrorReport(
                installation_id=str(uuid4()),
                area="DOWNLOAD",
                message="Depot download failed",
                app_id=620,
                lease_id=38,
                client_build="test-build",
                created_at=core.now_utc(),
            )
        )
        session.commit()

        response = core.admin_client_errors_view(
            _admin_request(admin_token),
            limit=200,
            area=None,
            session=session,
        )
        body = response.body.decode("utf-8")
        assert response.status_code == 200
        assert "Depot download failed" in body
        assert "DOWNLOAD" in body

        with pytest.raises(HTTPException) as exc:
            core._admin_browser_access(_admin_request("wrong-token"))
        assert exc.value.status_code == 401
