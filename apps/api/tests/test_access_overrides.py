from datetime import datetime, timezone
from uuid import uuid4

from sqlmodel import Session, SQLModel, create_engine

from app import access_overrides


def _clear_env(monkeypatch) -> None:
    monkeypatch.delenv("GAMEACCESS_COURTESY_KEYS_FILE", raising=False)


def test_reads_exact_production_secret_variable(monkeypatch) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", "GA-COURTESY-TEST-1234")

    keys = access_overrides._configured_keys()

    assert len(keys) == 1
    assert keys[0].name == "courtesy"
    assert keys[0].value == "GA-COURTESY-TEST-1234"
    assert keys[0].duration_months == 1


def test_secret_variable_takes_priority_over_local_file(monkeypatch, tmp_path) -> None:
    _clear_env(monkeypatch)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", "GA-PRODUCTION-SECRET-1234")
    monkeypatch.setattr(
        access_overrides,
        "_default_config_path",
        lambda: tmp_path / "courtesy-keys.json",
    )

    keys = access_overrides._configured_keys()

    assert [key.value for key in keys] == ["GA-PRODUCTION-SECRET-1234"]


def test_local_file_remains_development_fallback(monkeypatch, tmp_path) -> None:
    _clear_env(monkeypatch)
    path = tmp_path / "courtesy-keys.json"
    path.write_text(
        '{"keys":[{"name":"local","key":"GA-LOCAL-COURTESY-1234","duration_months":1}]}',
        encoding="utf-8",
    )
    monkeypatch.setattr(access_overrides, "_default_config_path", lambda: path)

    keys = access_overrides._configured_keys()

    assert len(keys) == 1
    assert keys[0].name == "local"
    assert keys[0].value == "GA-LOCAL-COURTESY-1234"


def test_courtesy_key_redeems_and_session_validates(monkeypatch, tmp_path) -> None:
    _clear_env(monkeypatch)
    key = "GA-COURTESY-REDEEM-1234"
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", key)
    monkeypatch.setattr(
        access_overrides,
        "_default_config_path",
        lambda: tmp_path / "unused.json",
    )

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


def test_same_courtesy_key_is_reusable_across_installations(monkeypatch, tmp_path) -> None:
    _clear_env(monkeypatch)
    key = "GA-COURTESY-REUSE-1234"
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", key)
    monkeypatch.setattr(
        access_overrides,
        "_default_config_path",
        lambda: tmp_path / "unused.json",
    )

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
    _clear_env(monkeypatch)
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", "GA-CORRECT-COURTESY-1234")
    monkeypatch.setattr(
        access_overrides,
        "_default_config_path",
        lambda: tmp_path / "unused.json",
    )

    engine = create_engine("sqlite://")
    SQLModel.metadata.create_all(engine)

    with Session(engine) as session:
        assert access_overrides.redeem_courtesy_key(
            session, "GA-WRONG-COURTESY-1234", str(uuid4())
        ) is None
