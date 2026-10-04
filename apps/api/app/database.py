from __future__ import annotations

import os
from pathlib import Path

from sqlmodel import create_engine

DB_PATH = Path(__file__).resolve().parent.parent / "gameaccess.db"


def normalize_database_url(value: str | None) -> str:
    """Return a SQLAlchemy URL, defaulting to the local SQLite development DB."""
    raw = (value or "").strip()
    if not raw:
        return f"sqlite:///{DB_PATH}"
    if raw.startswith("postgres://"):
        raw = "postgresql+psycopg://" + raw[len("postgres://"):]
    elif raw.startswith("postgresql://"):
        raw = "postgresql+psycopg://" + raw[len("postgresql://"):]
    if "supabase.com" in raw and "sslmode=" not in raw:
        separator = "&" if "?" in raw else "?"
        raw = f"{raw}{separator}sslmode=require"
    return raw


def configured_database_url() -> str:
    return normalize_database_url(
        os.environ.get("GAMEACCESS_DATABASE_URL") or os.environ.get("DATABASE_URL")
    )


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


engine = create_app_engine()
