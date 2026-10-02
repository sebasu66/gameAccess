import json
from uuid import uuid4

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Session, SQLModel, create_engine

from app import main as core


def _activation_request(token: str, installation_id: str) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [
                (b"authorization", f"Bearer {token}".encode("ascii")),
                (b"x-gameaccess-installation", installation_id.encode("ascii")),
            ],
        }
    )


def test_core_activation_round_trip_with_courtesy_key_file(
    monkeypatch, tmp_path
) -> None:
    courtesy_key = "GA-SMOKE-COURTESY-1234"
    courtesy_file = tmp_path / "courtesy-keys.json"
    courtesy_file.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "name": "smoke",
                        "key": courtesy_key,
                        "duration_months": 1,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(courtesy_file))

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    installation_id = str(uuid4())

    with Session(engine) as session:
        redeemed = core.redeem_access_key(
            core.AccessKeyRedeemRequest(
                key=courtesy_key,
                installation_id=installation_id,
            ),
            session,
        )

        assert redeemed["installation_id"] == installation_id
        assert redeemed["session_token"]
        assert redeemed["expires_at"] is not None

        status = core.activation_status(
            _activation_request(redeemed["session_token"], installation_id),
            session,
        )
        assert status["active"] is True
        assert status["expires_at"] == redeemed["expires_at"]

        with pytest.raises(HTTPException) as exc:
            core.activation_status(
                _activation_request(redeemed["session_token"], str(uuid4())),
                session,
            )
        assert exc.value.status_code == 401


def test_health_reports_courtesy_configuration_without_exposing_key(
    monkeypatch, tmp_path
) -> None:
    courtesy_key = "GA-HEALTH-COURTESY-1234"
    courtesy_file = tmp_path / "courtesy-keys.json"
    courtesy_file.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "name": "health",
                        "key": courtesy_key,
                        "duration_months": 1,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(courtesy_file))

    payload = core.health()

    assert payload["ok"] is True
    assert payload["courtesy_access_configured"] is True
    assert courtesy_key not in repr(payload)
