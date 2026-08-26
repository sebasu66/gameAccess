from __future__ import annotations

import json
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import main as core

router = APIRouter(prefix="/admin/pool", tags=["pool"])


class PoolGameInput(BaseModel):
    app_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=300)
    developer: str = ""
    publisher: str = ""


class PoolAccountInput(BaseModel):
    label: str = Field(min_length=1, max_length=200)
    account_name: str = ""
    steam_id64: str = ""
    user_id32: int | None = None
    app_ids: list[int] = []
    active: bool = False


class PoolSyncInput(BaseModel):
    source: str = "steam-local-metadata"
    accounts: list[PoolAccountInput]
    games: list[PoolGameInput]


def _unique_slug(session: Session, name: str, app_id: int) -> str:
    base = core.slugify(name, app_id)
    slug = base
    suffix = 2
    while session.exec(select(core.Game).where(core.Game.slug == slug)).first():
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


@router.post("/sync")
def sync_pool(req: PoolSyncInput, session: Session = Depends(core.get_session)) -> dict:
    if not req.accounts:
        raise HTTPException(400, "pool must contain at least one Steam account")
    if not req.games:
        raise HTTPException(400, "pool must contain at least one game")

    # 1) Upsert the discovered Windows game catalog by AppID. The local Steam
    # appinfo cache already supplied the public display names, so this endpoint
    # does not need one network call per game.
    games_by_app: dict[int, core.Game] = {}
    for incoming in req.games:
        game = session.exec(select(core.Game).where(core.Game.app_id == incoming.app_id)).first()
        if game is None:
            game = core.Game(
                slug=_unique_slug(session, incoming.name, incoming.app_id),
                name=incoming.name.strip(),
                app_id=incoming.app_id,
                credit_cost_per_hour=10,
                active=True,
            )
        else:
            game.name = incoming.name.strip() or game.name
            game.active = True
            # Migrate the early prototype's 100/150/180 scale to the agreed
            # compact 10/15/18 scale without disturbing already-small prices.
            if game.credit_cost_per_hour >= 50:
                game.credit_cost_per_hour = max(1, round(game.credit_cost_per_hour / 10))
        session.add(game)
    session.commit()

    for incoming in req.games:
        game = session.exec(select(core.Game).where(core.Game.app_id == incoming.app_id)).first()
        if game is not None:
            games_by_app[incoming.app_id] = game

    # 2) Upsert provider accounts. label intentionally remains the visible
    # remembered-account name because the current local switch adapter targets
    # that visible chooser label. Stable identity values stay in internal notes.
    synced_accounts: list[core.ProviderAccount] = []
    for incoming in req.accounts:
        label = incoming.label.strip()
        account = session.exec(select(core.ProviderAccount).where(core.ProviderAccount.label == label)).first()
        if account is None:
            account = core.ProviderAccount(label=label, provider="steam", status=core.AccountStatus.free)
        account.provider = "steam"
        account.notes = json.dumps(
            {
                "source": req.source,
                "account_name": incoming.account_name,
                "steam_id64": incoming.steam_id64,
                "user_id32": incoming.user_id32,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )
        session.add(account)
        session.commit()
        session.refresh(account)
        synced_accounts.append(account)

        desired_game_ids = {
            games_by_app[app_id].id
            for app_id in dict.fromkeys(incoming.app_ids)
            if app_id in games_by_app and games_by_app[app_id].id is not None
        }
        existing = session.exec(select(core.AccountGame).where(core.AccountGame.account_id == account.id)).all()
        existing_by_game = {row.game_id: row for row in existing}
        for game_id, row in existing_by_game.items():
            if game_id not in desired_game_ids:
                session.delete(row)
        for game_id in desired_game_ids:
            if game_id not in existing_by_game:
                session.add(core.AccountGame(account_id=account.id, game_id=game_id))
        session.commit()

    license_counts: Counter[int] = Counter()
    for account in synced_accounts:
        mappings = session.exec(select(core.AccountGame).where(core.AccountGame.account_id == account.id)).all()
        for mapping in mappings:
            license_counts[mapping.game_id] += 1

    duplicate_games = sum(1 for count in license_counts.values() if count > 1)
    total_licenses = sum(license_counts.values())
    return {
        "ok": True,
        "source": req.source,
        "account_count": len(synced_accounts),
        "game_count": len(games_by_app),
        "total_license_mappings": total_licenses,
        "duplicate_game_count": duplicate_games,
        "accounts": [
            {
                "id": account.id,
                "label": account.label,
                "status": account.status,
                "game_count": len(
                    session.exec(select(core.AccountGame).where(core.AccountGame.account_id == account.id)).all()
                ),
            }
            for account in synced_accounts
        ],
    }
