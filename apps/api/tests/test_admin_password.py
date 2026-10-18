"""La clave de administración es una clave común: mínimo 8 caracteres, no un token largo."""
from fastapi import Request

from app.admin_auth import MIN_ADMIN_PASSWORD_LENGTH, admin_authenticated, admin_password


def _remote_request(password: str | None = None) -> Request:
    headers = [(b"host", b"gameaccess-api.onrender.com"), (b"x-forwarded-for", b"203.0.113.5")]
    if password is not None:
        headers.append((b"x-gameaccess-admin-token", password.encode()))
    return Request({"type": "http", "headers": headers, "client": ("203.0.113.5", 12345), "server": ("gameaccess-api.onrender.com", 443), "scheme": "https", "path": "/admin/"})


def test_minimum_length_is_eight():
    assert MIN_ADMIN_PASSWORD_LENGTH == 8


def test_eight_character_password_is_accepted(monkeypatch):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "clave123")
    assert admin_password() == "clave123"
    assert admin_authenticated(_remote_request("clave123")) is True


def test_wrong_password_is_rejected(monkeypatch):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "clave123")
    assert admin_authenticated(_remote_request("otraclave")) is False
    assert admin_authenticated(_remote_request()) is False


def test_password_shorter_than_eight_disables_remote_admin(monkeypatch):
    monkeypatch.setenv("GAMEACCESS_ADMIN_TOKEN", "corta12")
    assert admin_password() == ""
    assert admin_authenticated(_remote_request("corta12")) is False


def test_missing_password_disables_remote_admin(monkeypatch):
    monkeypatch.delenv("GAMEACCESS_ADMIN_TOKEN", raising=False)
    assert admin_authenticated(_remote_request("")) is False
