"""Persistent API models. No application startup or transport dependencies."""
from datetime import datetime
from typing import Optional
from sqlalchemy import BigInteger, Column
from sqlmodel import Field as SQLField, SQLModel

class User(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    username: str = SQLField(index=True, unique=True)
    credits: int = 0


class Game(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    slug: str = SQLField(index=True, unique=True)
    name: str
    app_id: Optional[int] = SQLField(default=None, index=True)
    credit_cost_per_hour: int = 100
    active: bool = True


class AccessEvent(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    created_at: datetime = SQLField(index=True)
    installation_id: str = SQLField(index=True)
    action: str = SQLField(index=True)
    outcome: str = SQLField(index=True)
    reason: str
    game_id: Optional[int] = SQLField(default=None, index=True)
    app_id: Optional[int] = SQLField(default=None, index=True)
    lease_id: Optional[int] = SQLField(default=None, index=True)
    account_id: Optional[int] = SQLField(default=None, index=True)


class ClientErrorReport(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    installation_id: str = SQLField(index=True)
    area: str = SQLField(index=True)
    message: str
    app_id: Optional[int] = SQLField(default=None, index=True)
    lease_id: Optional[int] = SQLField(default=None, index=True)
    client_build: str = ""
    user_agent: str = ""
    created_at: datetime = SQLField(index=True)


class VikingSourceCache(SQLModel, table=True):
    """Durable source fingerprint -> ViKiNG file mapping; file existence is rechecked."""

    __tablename__ = "viking_source_cache"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    source_fingerprint: str = SQLField(index=True, unique=True, max_length=64)
    source_kind: str = SQLField(index=True, max_length=24)
    source_host: str = SQLField(default="", max_length=255)
    item_name: str = SQLField(default="", max_length=300)
    viking_hash: Optional[str] = SQLField(default=None, index=True, max_length=120)
    viking_url: Optional[str] = None
    viking_name: str = SQLField(default="", max_length=300)
    # Games are larger than 2 GB, which a 32-bit INTEGER column cannot hold.
    file_size_bytes: Optional[int] = SQLField(default=None, sa_column=Column(BigInteger))
    status: str = SQLField(default="processing", index=True, max_length=24)
    created_at: datetime = SQLField(index=True)
    updated_at: datetime = SQLField(index=True)
    last_checked_at: Optional[datetime] = None
    last_error_code: str = SQLField(default="", max_length=80)


class VikingDownloadRequest(SQLModel, table=True):
    """One auditable server-side resolve request per GameAccess installation."""

    __tablename__ = "viking_download_request"

    id: Optional[int] = SQLField(default=None, primary_key=True)
    request_id: str = SQLField(index=True, unique=True, max_length=40)
    installation_id: str = SQLField(index=True, max_length=36)
    app_id: Optional[int] = SQLField(default=None, index=True)
    client_build: str = SQLField(default="", max_length=120)
    source_fingerprint: str = SQLField(index=True, max_length=64)
    source_kind: str = SQLField(index=True, max_length=24)
    source_host: str = SQLField(default="", max_length=255)
    item_name: str = SQLField(default="", max_length=300)
    requested_at: datetime = SQLField(index=True)
    completed_at: Optional[datetime] = None
    status: str = SQLField(default="processing", index=True, max_length=24)
    cache_hit: bool = False
    result_name: str = SQLField(default="", max_length=300)
    result_hash: str = SQLField(default="", index=True, max_length=120)
    result_url: str = SQLField(default="")
    # Games are larger than 2 GB, which a 32-bit INTEGER column cannot hold.
    file_size_bytes: Optional[int] = SQLField(default=None, sa_column=Column(BigInteger))
    torbox_item_id: Optional[int] = None
    duration_ms: Optional[int] = None
    error_code: str = SQLField(default="", max_length=80)
