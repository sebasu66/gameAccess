"""Persistent API models. No application startup or transport dependencies."""
from datetime import datetime
from typing import Optional
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
