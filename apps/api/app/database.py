from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlmodel import create_engine

API_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = API_ROOT / "gameaccess.db"
SHARED_PROJECT_REF = "etfcjercdwwschwdhzek"
# Private local configuration is ignored by Git; deployed environment values win.
load_dotenv(API_ROOT / ".env", override=False)


def normalize_database_url(value: str | None) -> str:
    """Return a SQLAlchemy URL, defaulting to the local SQLite development DB."""
    raw = (value or "").strip()
    if not raw:
        return f"sqlite:///{DB_PATH}"
    if raw.startswith("postgres://"):
        raw = "postgresql+psycopg://" + raw[len("postgres://"):]
    elif raw.startswith("postgresql://"):
        raw = "postgresql+psycopg://" + raw[len("postgresql://"):]
    if ("supabase.com" in raw or "supabase.co" in raw) and "sslmode=" not in raw:
        separator = "&" if "?" in raw else "?"
        raw = f"{raw}{separator}sslmode=require"
    return raw


def configured_database_url() -> str:
    value = os.environ.get("GAMEACCESS_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not value or not value.strip():
        raise RuntimeError("Configure GAMEACCESS_DATABASE_URL with the shared GameAccess Supabase connection in apps/api/.env or the server environment.")
    url = normalize_database_url(value)
    if url.startswith("sqlite:") and os.environ.get("GAMEACCESS_ALLOW_SQLITE_FOR_TESTS") != "1":
        raise RuntimeError("The GameAccess server requires the shared Supabase database; SQLite is only allowed in isolated tests.")
    return url


def create_app_engine(database_url: str | None = None):
    url = normalize_database_url(database_url) if database_url is not None else configured_database_url()
    if url.startswith("sqlite:"):
        return create_engine(url, connect_args={"check_same_thread": False})
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=max(1, int(os.environ.get("GAMEACCESS_DB_POOL_SIZE", "5"))),
        max_overflow=max(0, int(os.environ.get("GAMEACCESS_DB_MAX_OVERFLOW", "5"))),
        pool_recycle=max(60, int(os.environ.get("GAMEACCESS_DB_POOL_RECYCLE_SECONDS", "1800"))),
    )


def database_project_ref(database_url: str) -> str:
    """Identify direct/pooler Supabase connections without exposing credentials."""
    try:
        url = make_url(database_url)
    except Exception:
        return ""
    if url.get_backend_name() != "postgresql":
        return ""
    host = (url.host or "").lower()
    if host.startswith("db.") and host.endswith(".supabase.co"):
        return host.split(".")[1]
    if host.endswith(".pooler.supabase.com"):
        user = url.username or ""
        return user.rsplit(".", 1)[-1] if "." in user else ""
    return ""


def verify_shared_database(db_engine) -> str:
    if database_project_ref(str(db_engine.url)) != SHARED_PROJECT_REF:
        raise RuntimeError("The server connection must target the shared GameAccess Supabase project.")
    try:
        with db_engine.connect() as connection:
            connection.execute(text("SELECT 1")).scalar_one()
    except Exception:
        raise RuntimeError("Cannot connect to the shared GameAccess Supabase database. Check the private connection configuration and network.") from None
    return SHARED_PROJECT_REF


engine = create_app_engine()


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify-shared", action="store_true", required=True)
    parser.parse_args()
    print("Shared Supabase connection verified: " + verify_shared_database(engine))
