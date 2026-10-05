from pathlib import Path

import pytest
from fastapi import HTTPException, Request

from app import access_overrides
from app import main as core
from app.account_roster import configured_accounts_path, load_account_roster
from app.database import configured_database_url


def _request_with_admin_token(token: str) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(b"x-gameaccess-admin-token", token.encode("utf-8"))],
        }
    )


def test_gameaccess_accounts_file_is_a_path_to_csv(monkeypatch, tmp_path: Path) -> None:
    path = tmp_path / "accounts.csv"
    path.write_text("alice,password-one\nbob,password-two\n", encoding="utf-8")
    monkeypatch.setenv("GAMEACCESS_ACCOUNTS_FILE", str(path))

    assert configured_accounts_path() == path
    records = load_account_roster()
    assert [(row.login, row.password) for row in records] == [
        ("alice", "password-one"),
        ("bob", "password-two"),
    ]


def test_gameaccess_admin_token_reads_exact_environment_variable(monkeypatch) -> None:
    token = "a" * 40
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", token)

    core._admin_activation_access(_request_with_admin_token(token))

    with pytest.raises(HTTPException) as exc:
        core._admin_activation_access(_request_with_admin_token("wrong-token"))
    assert exc.value.status_code == 403


def test_gameaccess_database_url_takes_precedence_over_generic_database_url(
    monkeypatch,
) -> None:
    monkeypatch.setenv(
        "GAMEACCESS_DATABASE_URL",
        "postgresql://gameaccess:secret@example.com/gameaccess",
    )
    monkeypatch.setenv(
        "DATABASE_URL",
        "postgresql://wrong:wrong@example.com/wrong",
    )

    result = configured_database_url()

    assert result == "postgresql+psycopg://gameaccess:secret@example.com/gameaccess"


def test_steam_web_api_key_reads_exact_environment_variable(monkeypatch) -> None:
    monkeypatch.setenv("STEAM_WEB_API_KEY", "  steam-web-api-secret  ")

    assert core._configured_steam_web_api_key() == "steam-web-api-secret"


def test_gameaccess_courtesy_keys_file_is_a_path_to_json(
    monkeypatch, tmp_path: Path
) -> None:
    path = tmp_path / "courtesy-keys.json"
    path.write_text(
        '{"keys":[{"name":"courtesy","key":"GA-CONTRACT-COURTESY-1234","duration_months":1}]}',
        encoding="utf-8",
    )
    monkeypatch.setenv("GAMEACCESS_COURTESY_KEYS_FILE", str(path))

    keys = access_overrides._configured_keys()

    assert len(keys) == 1
    assert keys[0].value == "GA-CONTRACT-COURTESY-1234"
    assert access_overrides.courtesy_access_configured() is True
