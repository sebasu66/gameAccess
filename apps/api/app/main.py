from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, create_engine, select

from .steam_catalog import SteamCatalogAdapter, SteamCatalogError, steam_assets

DB_PATH = Path(__file__).resolve().parent.parent / "gameaccess.db"
STEAM_CACHE = DB_PATH.parent / ".steam_cache"
engine = create_engine(
    f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False}
)
steam_catalog = SteamCatalogAdapter(STEAM_CACHE)


class AccountStatus(str, Enum):
    free = "free"
    leased = "leased"
    disabled = "disabled"


class LeaseStatus(str, Enum):
    active = "active"
    expired = "expired"
    released = "released"


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


class ProviderAccount(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    label: str = SQLField(index=True, unique=True)
    provider: str = "steam"
    status: AccountStatus = AccountStatus.free
    notes: str = ""


class AccountGame(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    account_id: int = SQLField(foreign_key="provideraccount.id", index=True)
    game_id: int = SQLField(foreign_key="game.id", index=True)


class Lease(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    user_id: int = SQLField(foreign_key="user.id", index=True)
    game_id: int = SQLField(foreign_key="game.id", index=True)
    account_id: int = SQLField(foreign_key="provideraccount.id", index=True)
    status: LeaseStatus = LeaseStatus.active
    starts_at: datetime
    expires_at: datetime
    credits_spent: int


class CreditLedger(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    user_id: int = SQLField(foreign_key="user.id", index=True)
    amount: int
    reason: str
    created_at: datetime


class LeaseRequest(BaseModel):
    user_id: int
    game_id: int
    minutes: int = Field(ge=5, le=24 * 60)
    replace_existing: bool = False


class CreditRequest(BaseModel):
    user_id: int
    amount: int
    reason: str = "manual"


class SeedAccountRequest(BaseModel):
    label: str
    provider: str = "steam"
    game_ids: list[int] = []
    notes: str = ""


class SyncAccountRequest(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    provider: str = "steam"
    game_ids: list[int] = []
    notes: str = ""


class SeedGameRequest(BaseModel):
    slug: str
    name: str
    app_id: Optional[int] = None
    credit_cost_per_hour: int = Field(default=100, ge=0)


app = FastAPI(title="gameAccess API", version="0.3.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "http://localhost:38148",
        "http://127.0.0.1:38148",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


def get_session():
    with Session(engine) as session:
        yield session


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def expire_old_leases(session: Session) -> None:
    now = now_utc()
    leases = session.exec(select(Lease).where(Lease.status == LeaseStatus.active)).all()
    changed = False
    for lease in leases:
        expires = lease.expires_at.replace(tzinfo=timezone.utc) if lease.expires_at.tzinfo is None else lease.expires_at
        if expires <= now:
            lease.status = LeaseStatus.expired
            account = session.get(ProviderAccount, lease.account_id)
            if account and account.status == AccountStatus.leased:
                account.status = AccountStatus.free
                session.add(account)
            session.add(lease)
            changed = True
    if changed:
        session.commit()


def seed_defaults(session: Session) -> None:
    if not session.exec(select(User)).first():
        session.add(User(username="demo", credits=1500))
    if not session.exec(select(Game)).first():
        session.add(
            Game(
                slug="no-mans-sky",
                name="No Man's Sky",
                app_id=275850,
                credit_cost_per_hour=100,
            )
        )
        session.add(
            Game(
                slug="cyberpunk-2077",
                name="Cyberpunk 2077",
                app_id=1091500,
                credit_cost_per_hour=150,
            )
        )
        session.add(
            Game(slug="fc", name="EA Sports FC", app_id=None, credit_cost_per_hour=180)
        )
    session.commit()


def game_capacity(session: Session, game: Game) -> tuple[int, int]:
    from . import family_capacity

    return family_capacity.game_capacity(session, game)


def game_summary(session: Session, game: Game, metrics: dict[int, dict] | None = None) -> dict:
    from . import family_capacity

    game_id = int(game.id or 0)
    metric = (metrics or {}).get(game_id)
    if metric is None:
        total, available = game_capacity(session, game)
        demand = family_capacity.demand_fields(session, game_id)
    else:
        total = int(metric.get("total", 0))
        available = int(metric.get("available", 0))
        demand = {
            "request_count_total": int(metric.get("request_count_total", 0)),
            "successful_leases": int(metric.get("successful_leases", 0)),
            "demand_value": float(metric.get("demand_value", 1.0)),
            "price_factor": float(metric.get("price_factor", 1.0)),
            "pool_value": float(metric.get("pool_value", 1.0)),
        }
    assets = steam_assets(game.app_id)
    return {
        "id": game.id,
        "slug": game.slug,
        "name": game.name,
        "app_id": game.app_id,
        "credit_cost_per_hour": game.credit_cost_per_hour,
        "copies_total": total,
        "copies_available": available,
        "availability_state": "ready"
        if available > 0
        else ("owned-busy" if total > 0 else "unavailable"),
        **demand,
        **assets,
    }


def slugify(value: str, app_id: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return slug or f"steam-{app_id}"


@app.on_event("startup")
def startup() -> None:
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_defaults(session)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "time": now_utc(), "version": app.version}


@app.get("/catalog")
def catalog(session: Session = Depends(get_session)) -> list[dict]:
    expire_old_leases(session)
    games = session.exec(select(Game).where(Game.active == True)).all()  # noqa: E712
    from . import family_capacity
    metrics = family_capacity.catalog_metrics(session)
    return [game_summary(session, game, metrics) for game in games]


@app.get("/games/{game_id}/details")
def game_details(game_id: int, session: Session = Depends(get_session)) -> dict:
    game = session.get(Game, game_id)
    if not game or not game.active:
        raise HTTPException(404, "game not found")
    summary = game_summary(session, game)
    if not game.app_id:
        return {**summary, "steam": None, "metadata_state": "no-steam-appid"}
    try:
        steam = steam_catalog.fetch(game.app_id)
        return {**summary, "steam": steam, "metadata_state": "ready"}
    except SteamCatalogError as exc:
        return {
            **summary,
            "steam": None,
            "metadata_state": "temporarily-unavailable",
            "metadata_error": str(exc),
        }


@app.get("/steam/apps/{app_id}")
def steam_app(app_id: int, force: bool = False) -> dict:
    try:
        return steam_catalog.fetch(app_id, force=force)
    except SteamCatalogError as exc:
        raise HTTPException(502, str(exc)) from exc


@app.post("/admin/games/import-steam/{app_id}")
def import_steam_game(app_id: int, session: Session = Depends(get_session)) -> dict:
    try:
        metadata = steam_catalog.fetch(app_id)
    except SteamCatalogError as exc:
        raise HTTPException(502, str(exc)) from exc

    name = str(metadata.get("name") or f"Steam {app_id}").strip()
    existing = session.exec(select(Game).where(Game.app_id == app_id)).first()
    created = existing is None
    if existing is None:
        base_slug = slugify(name, app_id)
        slug = base_slug
        suffix = 2
        while session.exec(select(Game).where(Game.slug == slug)).first():
            slug = f"{base_slug}-{suffix}"
            suffix += 1
        existing = Game(slug=slug, name=name, app_id=app_id, credit_cost_per_hour=100)
    else:
        existing.name = name
        existing.active = True
    session.add(existing)
    session.commit()
    session.refresh(existing)
    return {
        "created": created,
        "game": game_summary(session, existing),
        "steam": metadata,
    }


@app.get("/users/{user_id}")
def get_user(user_id: int, session: Session = Depends(get_session)) -> User:
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(404, "user not found")
    return user


@app.post("/credits")
def add_credits(req: CreditRequest, session: Session = Depends(get_session)) -> dict:
    user = session.get(User, req.user_id)
    if not user:
        raise HTTPException(404, "user not found")
    user.credits += req.amount
    session.add(user)
    session.add(
        CreditLedger(
            user_id=user.id, amount=req.amount, reason=req.reason, created_at=now_utc()
        )
    )
    session.commit()
    session.refresh(user)
    return {"user_id": user.id, "credits": user.credits}


@app.post("/admin/games")
def add_game(req: SeedGameRequest, session: Session = Depends(get_session)) -> Game:
    existing = session.exec(select(Game).where(Game.slug == req.slug)).first()
    if existing:
        raise HTTPException(409, "game slug already exists")
    game = Game(**req.model_dump())
    session.add(game)
    session.commit()
    session.refresh(game)
    return game


@app.post("/admin/accounts")
def add_account(
    req: SeedAccountRequest, session: Session = Depends(get_session)
) -> ProviderAccount:
    existing = session.exec(
        select(ProviderAccount).where(ProviderAccount.label == req.label)
    ).first()
    if existing:
        raise HTTPException(409, "account label already exists")
    account = ProviderAccount(label=req.label, provider=req.provider, notes=req.notes)
    session.add(account)
    session.commit()
    session.refresh(account)
    for game_id in req.game_ids:
        if not session.get(Game, game_id):
            raise HTTPException(400, f"unknown game_id {game_id}")
        session.add(AccountGame(account_id=account.id, game_id=game_id))
    session.commit()
    return account


@app.post("/admin/accounts/sync")
def sync_account(
    req: SyncAccountRequest, session: Session = Depends(get_session)
) -> dict:
    label = req.label.strip()
    normalized_game_ids = list(dict.fromkeys(req.game_ids))
    for game_id in normalized_game_ids:
        if not session.get(Game, game_id):
            raise HTTPException(400, f"unknown game_id {game_id}")

    account = session.exec(
        select(ProviderAccount).where(ProviderAccount.label == label)
    ).first()
    created = account is None
    if account is None:
        account = ProviderAccount(label=label, provider=req.provider, notes=req.notes)
        session.add(account)
        session.commit()
        session.refresh(account)
    else:
        account.provider = req.provider
        account.notes = req.notes
        session.add(account)

    mappings = session.exec(
        select(AccountGame).where(AccountGame.account_id == account.id)
    ).all()
    by_game = {row.game_id: row for row in mappings}
    desired = set(normalized_game_ids)
    for game_id, row in by_game.items():
        if game_id not in desired:
            session.delete(row)
    for game_id in normalized_game_ids:
        if game_id not in by_game:
            session.add(AccountGame(account_id=account.id, game_id=game_id))
    session.commit()
    return {
        "ok": True,
        "created": created,
        "account": {
            "id": account.id,
            "label": account.label,
            "provider": account.provider,
            "status": account.status,
            "game_ids": normalized_game_ids,
        },
    }


@app.get("/admin/accounts")
def list_accounts(session: Session = Depends(get_session)) -> list[dict]:
    expire_old_leases(session)
    accounts = session.exec(select(ProviderAccount)).all()
    result = []
    for account in accounts:
        rows = session.exec(
            select(AccountGame).where(AccountGame.account_id == account.id)
        ).all()
        games = [session.get(Game, row.game_id) for row in rows]
        result.append(
            {
                "id": account.id,
                "label": account.label,
                "provider": account.provider,
                "status": account.status,
                "games": [{"id": g.id, "name": g.name} for g in games if g],
                "notes": account.notes,
            }
        )
    return result


@app.post("/leases")
def create_lease(req: LeaseRequest, session: Session = Depends(get_session)) -> dict:
    expire_old_leases(session)
    user = session.get(User, req.user_id)
    game = session.get(Game, req.game_id)
    if not user:
        raise HTTPException(404, "user not found")
    if not game or not game.active:
        raise HTTPException(404, "game not found")

    active_for_user = session.exec(
        select(Lease).where(
            Lease.user_id == user.id, Lease.status == LeaseStatus.active
        )
    ).first()
    if active_for_user:
        if not req.replace_existing:
            raise HTTPException(409, "user already has an active lease")
        active_for_user.status = LeaseStatus.released
        stale_account = session.get(ProviderAccount, active_for_user.account_id)
        if stale_account and stale_account.status == AccountStatus.leased:
            stale_account.status = AccountStatus.free
            session.add(stale_account)
        session.add(active_for_user)
        session.commit()

    from . import family_capacity

    selection = family_capacity.select_best_account(session, game)
    if not selection:
        raise HTTPException(409, "no account currently available for this game")
    selected = selection["account"]

    # Prototype phase: Game Access sessions are free. Keep the accounting
    # fields in the API so monetization can be re-enabled later without changing
    # the client contract.
    cost = 0

    starts = now_utc()
    expires = starts + timedelta(minutes=req.minutes)
    lease = Lease(
        user_id=user.id,
        game_id=game.id,
        account_id=selected.id,
        starts_at=starts,
        expires_at=expires,
        credits_spent=cost,
    )
    selected.status = AccountStatus.leased
    user.credits -= cost
    session.add(selected)
    session.add(user)
    session.add(lease)
    session.add(
        CreditLedger(
            user_id=user.id,
            amount=-cost,
            reason=f"lease:{game.slug}:{req.minutes}m",
            created_at=starts,
        )
    )
    session.commit()
    session.refresh(lease)
    family_capacity.register_lease_allocation(
        session,
        int(lease.id),
        selection.get("family_id"),
        selection.get("license_copy_id"),
    )
    demand = family_capacity.record_successful_lease(session, int(game.id))
    session.commit()
    return {
        "lease_id": lease.id,
        "user_id": user.id,
        "game": {"id": game.id, "name": game.name, "app_id": game.app_id},
        "account": {
            "id": selected.id,
            "label": selected.label,
            "provider": selected.provider,
        },
        "family_id": selection.get("family_id"),
        "allocation": {
            "mode": selection.get("mode"),
            "pool_damage": selection.get("pool_damage"),
            "newly_unavailable_games": selection.get("newly_unavailable_games"),
            "remaining_seats": selection.get("remaining_seats"),
        },
        "demand": {
            "request_count_total": demand.request_count_total,
            "successful_leases": demand.successful_leases,
            "demand_value": demand.demand_value,
            "price_factor": demand.price_factor,
            "pool_value": round(demand.demand_value * demand.price_factor, 4),
        },
        "starts_at": starts,
        "expires_at": expires,
        "credits_spent": cost,
        "credits_remaining": user.credits,
        "session_action": "provider_adapter_required",
    }


@app.post("/leases/{lease_id}/steam-login")
def lease_steam_login(lease_id: int, request: Request, session: Session = Depends(get_session)) -> dict:
    # Development transport: never expose provider credentials to remote callers.
    if not request.client or request.client.host not in {"127.0.0.1", "::1"}:
        raise HTTPException(403, "Steam login transport is local-only")
    lease = session.get(Lease, lease_id)
    if not lease or lease.status != LeaseStatus.active:
        raise HTTPException(409, "An active reservation is required")
    expires = lease.expires_at.replace(tzinfo=timezone.utc) if lease.expires_at.tzinfo is None else lease.expires_at
    if expires <= now_utc():
        raise HTTPException(409, "Reservation expired")
    account = session.get(ProviderAccount, lease.account_id)
    from .account_roster import credential_for_label
    import json
    credential = credential_for_label(account.label) if account else None
    if not credential:
        raise HTTPException(409, "Assigned provider credentials unavailable")
    notes = json.loads(account.notes or "{}")
    expected = notes.get("user_id32")
    if not expected and notes.get("steam_id64"):
        expected = int(notes["steam_id64"]) - 76561197960265728
    if not expected:
        raise HTTPException(409, "Assigned Steam identity is not verified")
    return {"accountName": credential.login, "password": credential.password, "expectedUserId32": int(expected)}


@app.get("/leases/{lease_id}")
def get_lease(lease_id: int, session: Session = Depends(get_session)) -> dict:
    expire_old_leases(session)
    lease = session.get(Lease, lease_id)
    if not lease:
        raise HTTPException(404, "lease not found")
    game = session.get(Game, lease.game_id)
    account = session.get(ProviderAccount, lease.account_id)
    return {
        "id": lease.id,
        "status": lease.status,
        "user_id": lease.user_id,
        "game": game.name if game else None,
        "account_label": account.label if account else None,
        "starts_at": lease.starts_at,
        "expires_at": lease.expires_at,
        "credits_spent": lease.credits_spent,
    }


@app.post("/leases/{lease_id}/release")
def release_lease(lease_id: int, session: Session = Depends(get_session)) -> dict:
    lease = session.get(Lease, lease_id)
    if not lease:
        raise HTTPException(404, "lease not found")
    if lease.status != LeaseStatus.active:
        return {"ok": True, "status": lease.status}
    lease.status = LeaseStatus.released
    account = session.get(ProviderAccount, lease.account_id)
    if account:
        account.status = AccountStatus.free
        session.add(account)
    session.add(lease)
    session.commit()
    return {"ok": True, "status": lease.status}


from .pool_routes import (  # noqa: E402 - routes import initialized app
    router as pool_router,
)

app.include_router(pool_router)

from .steam_search_routes import (  # noqa: E402 - routes import initialized app
    router as steam_search_router,
)

app.include_router(steam_search_router)

from .admin_console_routes import (  # noqa: E402 - routes import initialized app
    router as admin_console_router,
)

app.include_router(admin_console_router)
