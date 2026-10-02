import json
from datetime import datetime, timezone
from uuid import uuid4

from sqlmodel import Session, SQLModel, create_engine

from app import access_overrides


def _write_keys_file(path, key: str = "GA-COURTESY-TEST-1234") -> None:
    path.write_text(
        json.dumps(
            {
                "keys": [
                    {
                        "name": "courtesy",
                        "key": key,
                        "duration_months": 1,
                    }
                ]
            }
        ),
        encoding="utf-8",
    )


def test_render_variable_points_to_courtesy_json_file(monkeypatch, tmp_path) -> None:
    path = tmp_path / "courtesy-keys.json"
    _write_keys_file(path)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    keys = access_overrides._configured_keys()

    assert len(keys) == 1
    assert keys[0].name == "courtesy"
    assert keys[0].value == "GA-COURTESY-TEST-1234"
    assert keys[0].duration_months == 1


def test_configured_path_takes_priority_over_default_local_file(monkeypatch, tmp_path) -> None:
    configured_path = tmp_path / "render-courtesy.json"
    local_path = tmp_path / "local-courtesy.json"
    _write_keys_file(configured_path, "GA-RENDER-COURTESY-1234")
    _write_keys_file(local_path, "GA-LOCAL-COURTESY-1234")
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(configured_path))
    monkeypatch.setattr(access_overrides, "_default_config_path", lambda: local_path)

    keys = access_overrides._configured_keys()

    assert [key.value for key in keys] == ["GA-RENDER-COURTESY-1234"]


def test_default_local_file_is_used_only_when_variable_is_missing(monkeypatch, tmp_path) -> None:
    path = tmp_path / "courtesy-keys.json"
    _write_keys_file(path, "GA-LOCAL-COURTESY-1234")
    monkeypatch.delenv("GAMEACCESS_COURTESY_KEYS_FILE", raising=False)
    monkeypatch.setattr(access_overrides, "_default_config_path", lambda: path)

    keys = access_overrides._configured_keys()

    assert [key.value for key in keys] == ["GA-LOCAL-COURTESY-1234"]


def test_missing_configured_file_means_no_courtesy_access(monkeypatch, tmp_path) -> None:
    path = tmp_path / "missing-courtesy-keys.json"
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    assert access_overrides._configured_keys() == []
    assert access_overrides.courtesy_access_configured() is False


def test_invalid_configured_json_is_not_reported_as_healthy(monkeypatch, tmp_path) -> None:
    path = tmp_path / "courtesy-keys.json"
    path.write_text("{not-json", encoding="utf-8")
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    assert access_overrides.courtesy_access_configured() is False


def test_courtesy_key_from_configured_file_redeems_and_session_validates(
    monkeypatch, tmp_path
) -> None:
    key = "GA-COURTESY-REDEEM-1234"
    path = tmp_path / "courtesy-keys.json"
    _write_keys_file(path, key)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    installation_id = str(uuid4())

    with Session(engine) as session:
        redeemed = access_overrides.redeem_courtesy_key(session, key, installation_id)
        assert redeemed is not None
        token, expires_at = redeemed
        assert expires_at > datetime.now(timezone.utc)
        assert access_overrides.valid_courtesy_session(
            session, token, installation_id
        ) is not None


def test_same_courtesy_key_file_is_reusable_across_installations(
    monkeypatch, tmp_path
) -> None:
    key = "GA-COURTESY-REUSE-1234"
    path = tmp_path / "courtesy-keys.json"
    _write_keys_file(path, key)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)
    first_installation = str(uuid4())
    second_installation = str(uuid4())

    with Session(engine) as session:
        first = access_overrides.redeem_courtesy_key(session, key, first_installation)
        second = access_overrides.redeem_courtesy_key(session, key, second_installation)

        assert first is not None
        assert second is not None
        assert first[0] != second[0]
        assert access_overrides.valid_courtesy_session(
            session, first[0], first_installation
        ) is not None
        assert access_overrides.valid_courtesy_session(
            session, second[0], second_installation
        ) is not None


def test_wrong_courtesy_key_is_rejected(monkeypatch, tmp_path) -> None:
    path = tmp_path / "courtesy-keys.json"
    _write_keys_file(path, "GA-CORRECT-COURTESY-1234")
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        assert access_overrides.redeem_courtesy_key(
            session, "GA-WRONG-COURTESY-1234", str(uuid4())
        ) is None
