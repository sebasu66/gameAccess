from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Field as SQLField, Session, SQLModel, create_engine, select

DB_PATH = Path(__file__).resolve().parent.parent / "gameaccess.db"
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})


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
    """Upsert one provider account and replace its declared local inventory.

    The label is an operator-side identifier. For the Steam desktop prototype it
    can be the account name that Steam itself visibly exposes in its remembered-
    account chooser. The API never needs a password or Steam Guard secret.
    """

    label: str = Field(min_length=1, max_length=200)
    provider: str = "steam"
    game_ids: list[int] = []
    notes: str = ""


class SeedGameRequest(BaseModel):
    slug: str
    name: str
    app_id: Optional[int] = None
    credit_cost_per_hour: int = Field(default=100, ge=0)


app = FastAPI(title="gameAccess API", version="0.1.0")


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
        if lease.expires_at <= now:
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
        session.add(Game(slug="no-mans-sky", name="No Man's Sky", app_id=275850, credit_cost_per_hour=100))
        session.add(Game(slug="cyberpunk-2077", name="Cyberpunk 2077", app_id=1091500, credit_cost_per_hour=150))
        session.add(Game(slug="fc", name="EA Sports FC", app_id=None, credit_cost_per_hour=180))
    session.commit()


@app.on_event("startup")
def startup() -> None:
    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        seed_defaults(session)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "time": now_utc()}


@app.get("/catalog")
def catalog(session: Session = Depends(get_session)) -> list[dict]:
    expire_old_leases(session)
    games = session.exec(select(Game).where(Game.active == True)).all()  # noqa: E712
    result = []
    for game in games:
        owned = session.exec(select(AccountGame).where(AccountGame.game_id == game.id)).all()
        account_ids = [row.account_id for row in owned]
        available = 0
        for account_id in account_ids:
            account = session.get(ProviderAccount, account_id)
            if account and account.status == AccountStatus.free:
                available += 1
        result.append({
            "id": game.id,
            "slug": game.slug,
            "name": game.name,
            "app_id": game.app_id,
            "credit_cost_per_hour": game.credit_cost_per_hour,
            "copies_total": len(account_ids),
            "copies_available": available,
        })
    return result


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
    session.add(CreditLedger(user_id=user.id, amount=req.amount, reason=req.reason, created_at=now_utc()))
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
def add_account(req: SeedAccountRequest, session: Session = Depends(get_session)) -> ProviderAccount:
    existing = session.exec(select(ProviderAccount).where(ProviderAccount.label == req.label)).first()
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
def sync_account(req: SyncAccountRequest, session: Session = Depends(get_session)) -> dict:
    """Upsert a local account and replace its account->game mappings.

    This is intentionally an operator/admin prototype endpoint. It stores only
    the account label supplied by the launcher and declared ownership mappings;
    it does not accept provider passwords or authentication tokens.
    """
    label = req.label.strip()
    if not label:
        raise HTTPException(400, "account label is required")

    normalized_game_ids = list(dict.fromkeys(req.game_ids))
    for game_id in normalized_game_ids:
        if not session.get(Game, game_id):
            raise HTTPException(400, f"unknown game_id {game_id}")

    account = session.exec(select(ProviderAccount).where(ProviderAccount.label == label)).first()
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

    existing_mappings = session.exec(select(AccountGame).where(AccountGame.account_id == account.id)).all()
    existing_by_game = {row.game_id: row for row in existing_mappings}
    desired = set(normalized_game_ids)

    for game_id, row in existing_by_game.items():
        if game_id not in desired:
            session.delete(row)
    for game_id in normalized_game_ids:
        if game_id not in existing_by_game:
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
        rows = session.exec(select(AccountGame).where(AccountGame.account_id == account.id)).all()
        games = [session.get(Game, row.game_id) for row in rows]
        result.append({
            "id": account.id,
            "label": account.label,
            "provider": account.provider,
            "status": account.status,
            "games": [{"id": g.id, "name": g.name} for g in games if g],
            "notes": account.notes,
        })
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
        select(Lease).where(Lease.user_id == user.id, Lease.status == LeaseStatus.active)
    ).first()
    if active_for_user:
        raise HTTPException(409, "user already has an active lease")

    mappings = session.exec(select(AccountGame).where(AccountGame.game_id == game.id)).all()
    selected = None
    for mapping in mappings:
        account = session.get(ProviderAccount, mapping.account_id)
        if account and account.status == AccountStatus.free:
            selected = account
            break
    if not selected:
        raise HTTPException(409, "no account currently available for this game")

    cost = max(1, round(game.credit_cost_per_hour * (req.minutes / 60)))
    if user.credits < cost:
        raise HTTPException(402, f"insufficient credits: need {cost}, have {user.credits}")

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
    session.add(CreditLedger(user_id=user.id, amount=-cost, reason=f"lease:{game.slug}:{req.minutes}m", created_at=starts))
    session.commit()
    session.refresh(lease)
    return {
        "lease_id": lease.id,
        "user_id": user.id,
        "game": {"id": game.id, "name": game.name, "app_id": game.app_id},
        "account": {"id": selected.id, "label": selected.label, "provider": selected.provider},
        "starts_at": starts,
        "expires_at": expires,
        "credits_spent": cost,
        "credits_remaining": user.credits,
        "session_action": "provider_adapter_required",
    }


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
