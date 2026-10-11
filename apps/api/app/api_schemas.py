"""Validated request contracts for activation and client diagnostics."""
from datetime import datetime
from typing import Literal, Optional
from pydantic import BaseModel, Field

class ClientErrorReportRequest(BaseModel):
    area: str = Field(default="APP", min_length=1, max_length=80)
    message: str = Field(min_length=1, max_length=8000)
    app_id: Optional[int] = Field(default=None, ge=1)
    lease_id: Optional[int] = Field(default=None, ge=1)
    client_build: str = Field(default="", max_length=120)


class AccessKeyIssueRequest(BaseModel):
    expires_at: Optional[datetime] = None
    access_tier: Optional[Literal["base", "plus"]] = None
    duration_hours: Optional[int] = Field(default=None, ge=1, le=24 * 365 * 5)
    duration_months: Optional[int] = Field(default=None, ge=1, le=60)
    key_ttl_hours: int = Field(default=24, ge=1, le=24 * 30)
    count: int = Field(default=1, ge=1, le=100)


class AccessKeyRenewRequest(BaseModel):
    expires_at: datetime


class AccessKeyRedeemRequest(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    installation_id: str = Field(min_length=36, max_length=36)
