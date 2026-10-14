"""Tables for the piece-by-piece TorBox -> ViKiNG transfer (no application startup dependencies)."""
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, UniqueConstraint
from sqlmodel import Field as SQLField, SQLModel


class VikingChunkJob(SQLModel, table=True):
    """One transfer of a source, shared by every player that asks for the same source."""

    __tablename__ = "viking_chunk_job"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    job_id: str = SQLField(index=True, unique=True, max_length=40)
    source_fingerprint: str = SQLField(index=True, max_length=64)
    # The link the player originally asked for; with the pieces below it is the "dictionary" original link -> ViKiNG pieces.
    source_url: str = SQLField(default="", max_length=2000)
    source_kind: str = SQLField(default="", max_length=24)
    item_name: str = SQLField(default="", max_length=300)
    # preparing (TorBox is still downloading) -> running (pieces are going up) -> ready | failed
    status: str = SQLField(default="preparing", index=True, max_length=16)
    total_bytes: Optional[int] = SQLField(default=None, sa_column=Column(BigInteger))
    files_json: str = "[]"
    error_code: str = SQLField(default="", max_length=80)
    # Which server instance runs the job (several instances can share one database, e.g. local and Render).
    owner: str = SQLField(default="", index=True, max_length=80)
    created_at: datetime = SQLField(index=True)
    updated_at: datetime = SQLField(index=True)
    completed_at: Optional[datetime] = None


class VikingChunkPiece(SQLModel, table=True):
    """One planned piece of a job; it is ready once its bytes sit in ViKiNG."""

    __tablename__ = "viking_chunk_piece"
    __table_args__ = (UniqueConstraint("job_id", "piece_index", name="uq_viking_chunk_piece"),)

    id: Optional[int] = SQLField(default=None, primary_key=True)
    job_id: str = SQLField(index=True, max_length=40)
    piece_index: int
    file_index: int
    start_byte: int = SQLField(sa_column=Column(BigInteger))
    size_bytes: int = SQLField(sa_column=Column(BigInteger))
    sha256: str = SQLField(default="", max_length=64)
    viking_hash: Optional[str] = SQLField(default=None, index=True, max_length=120)
    status: str = SQLField(default="pending", index=True, max_length=12)
    updated_at: datetime
