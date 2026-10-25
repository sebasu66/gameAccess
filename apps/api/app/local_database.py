"""A local SQLite engine for per-instance operational data.

The ViKiNG chunk-download jobs/pieces and the telemetry/event tables are written and read at high
frequency by every download in progress. Keeping them in the shared Supabase pool (session mode, a
handful of connections total) starved it and crashed jobs mid-transfer (EMAXCONNSESSION). None of
this data needs to be shared between server instances, so it lives in its own file here instead;
only license/activation data (AccessKey, AccessEvent) stays on the shared database.
"""
from __future__ import annotations

from pathlib import Path

from sqlmodel import SQLModel, Session, create_engine

from .database import API_ROOT
from .download_events import DownloadEvent
from .telemetry import ChunkTransfer, ClientPresence, ServerSample
from .viking_chunk_models import VikingChunkJob, VikingChunkPiece

LOCAL_DB_PATH = API_ROOT / "viking_local.db"

LOCAL_TABLES = [
    VikingChunkJob.__table__,
    VikingChunkPiece.__table__,
    ChunkTransfer.__table__,
    ClientPresence.__table__,
    ServerSample.__table__,
    DownloadEvent.__table__,
]
LOCAL_TABLE_NAMES = {t.name for t in LOCAL_TABLES}

local_engine = create_engine(f"sqlite:///{LOCAL_DB_PATH}", connect_args={"check_same_thread": False})


def create_local_tables() -> None:
    SQLModel.metadata.create_all(local_engine, tables=LOCAL_TABLES)


def get_local_session():
    with Session(local_engine) as session:
        yield session
