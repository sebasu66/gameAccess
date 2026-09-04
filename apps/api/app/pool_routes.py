from __future__ import annotations

import json
from collections import Counter
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import main as core
from .account_roster import load_account_roster, replace_runtime_roster

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
    # Verified owner AppIDs only. Family-visible apps never enter this field.
    app_ids: list[int] = []
    # Apps this seat can currently see/use, including Steam Family sharing.
    accessible_app_ids: list[int] = []
    ownership_source: str = "unverified"
    ownership_verified_at: str | None = None
    # This is deliberately per-account. One failed provider must not block the
    # other verified providers from updating their authoritative mappings.
    inventory_complete: bool = False
    scan_status: str = "unknown"
    scan_error: str | None = None
    active: bool = False


class PoolSyncInput(BaseModel):
    source: str = "unverified"
    verification_complete: bool = False
    verified_at: str | None = None
    verification_errors: list[dict[str, Any]] = []
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


def sync_runtime_account_roster(session: Session) -> int:
    records = load_account_roster()
    replace_runtime_roster(records)
    for record in records:
        account = session.exec(
            select(core.ProviderAccount).where(
                core.ProviderAccount.label == record.label
            )
        ).first()
        if account is None:
            account = core.ProviderAccount(
                label=record.label, provider="steam", status=core.AccountStatus.free
            )
        notes: dict[str, Any] = {}
        try:
            decoded = json.loads(account.notes or "{}")
            if isinstance(decoded, dict):
                notes = decoded
        except Exception:
            notes = {}
        notes.update({"source": "local-account-roster", "account_name": record.login})
        account.provider = "steam"
        account.notes = json.dumps(notes, ensure_ascii=False, separators=(",", ":"))
        session.add(account)
    session.commit()
    return len(records)


@core.app.on_event("startup")
def sync_runtime_account_roster_on_startup() -> None:
    with Session(core.engine) as session:
        sync_runtime_account_roster(session)


@router.get("/roster-status")
def roster_status(session: Session = Depends(core.get_session)) -> dict:
    count = sync_runtime_account_roster(session)
    return {"ok": True, "accounts": count}


def _validate_pool_sync(req: PoolSyncInput) -> None:
    if not req.accounts:
        raise HTTPException(400, "pool must contain at least one Steam account")
    if not req.games:
        raise HTTPException(400, "pool must contain at least one game")


def _sync_games(req: PoolSyncInput, session: Session) -> dict[int, core.Game]:
    incoming_app_ids = {item.app_id for item in req.games}
    for existing in session.exec(select(core.Game)).all():
        existing.active = bool(existing.app_id and existing.app_id in incoming_app_ids)
        session.add(existing)
    session.commit()

    for incoming in req.games:
        game = session.exec(
            select(core.Game).where(core.Game.app_id == incoming.app_id)
        ).first()
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
            if game.credit_cost_per_hour >= 50:
                game.credit_cost_per_hour = max(
                    1, round(game.credit_cost_per_hour / 10)
                )
        session.add(game)
    session.commit()

    games_by_app: dict[int, core.Game] = {}
    for incoming in req.games:
        game = session.exec(
            select(core.Game).where(core.Game.app_id == incoming.app_id)
        ).first()
        if game is not None:
            games_by_app[incoming.app_id] = game
    return games_by_app


def _decode_notes(account: core.ProviderAccount) -> dict[str, Any]:
    try:
        decoded = json.loads(account.notes or "{}")
        return decoded if isinstance(decoded, dict) else {}
    except Exception:
        return {}


def _sync_account(
    req: PoolSyncInput,
    incoming: PoolAccountInput,
    games_by_app: dict[int, core.Game],
    session: Session,
) -> core.ProviderAccount:
    label = incoming.label.strip()
    account = session.exec(
        select(core.ProviderAccount).where(core.ProviderAccount.label == label)
    ).first()
    if account is None:
        account = core.ProviderAccount(
            label=label, provider="steam", status=core.AccountStatus.free
        )
    account.provider = "steam"
    session.add(account)
    session.commit()
    session.refresh(account)

    notes = _decode_notes(account)
    existing = session.exec(
        select(core.AccountGame).where(core.AccountGame.account_id == account.id)
    ).all()
    existing_by_game = {row.game_id: row for row in existing}

    # Ownership authority is per provider. A global partial scan can contain 45
    # fully verified accounts and one unavailable account; the 45 must update.
    authoritative_ownership = bool(incoming.inventory_complete)
    if authoritative_ownership:
        desired_game_ids = {
            games_by_app[app_id].id
            for app_id in dict.fromkeys(incoming.app_ids)
            if app_id in games_by_app and games_by_app[app_id].id is not None
        }
        for game_id, row in existing_by_game.items():
            if game_id not in desired_game_ids:
                session.delete(row)
        for game_id in desired_game_ids:
            if game_id not in existing_by_game:
                session.add(core.AccountGame(account_id=account.id, game_id=game_id))
        session.commit()

    # Steam login failures are operational availability failures, not proof of
    # zero ownership. Preserve mappings but remove the seat from availability.
    scan_status = (incoming.scan_status or "unknown").strip()
    scan_failed = scan_status not in {"", "unknown", "not_scanned", "ok"}
    disabled_by_scan = bool(notes.get("disabled_by_inventory_scan"))
    if scan_failed:
        if account.status == core.AccountStatus.free:
            account.status = core.AccountStatus.disabled
            disabled_by_scan = True
    elif authoritative_ownership and scan_status == "ok":
        if account.status == core.AccountStatus.disabled and disabled_by_scan:
            account.status = core.AccountStatus.free
        disabled_by_scan = False

    current_mappings = session.exec(
        select(core.AccountGame).where(core.AccountGame.account_id == account.id)
    ).all()

    notes.update(
        {
            "catalog_source": req.source,
            "account_name": incoming.account_name,
            "steam_id64": incoming.steam_id64,
            "user_id32": incoming.user_id32,
            "accessible_app_count": len(set(incoming.accessible_app_ids)),
            "accessible_app_ids": sorted(set(incoming.accessible_app_ids)),
            "owned_app_count": len(current_mappings),
            "last_catalog_verification_complete": req.verification_complete,
            "ownership_scan_status": scan_status,
            "ownership_scan_error": incoming.scan_error,
            "disabled_by_inventory_scan": disabled_by_scan,
        }
    )
    if authoritative_ownership:
        notes.update(
            {
                "ownership_source": incoming.ownership_source,
                "ownership_verified_at": incoming.ownership_verified_at or req.verified_at,
                "inventory_complete": True,
            }
        )
    else:
        # A failed/unscanned provider must not delete its last known mappings or
        # downgrade its last authoritative ownership metadata.
        notes.setdefault("ownership_source", "unverified")
        notes.setdefault("ownership_verified_at", None)
        notes.setdefault("inventory_complete", False)

    account.notes = json.dumps(notes, ensure_ascii=False, separators=(",", ":"))
    session.add(account)
    session.commit()
    session.refresh(account)
    return account


def _license_counts(
    session: Session, accounts: list[core.ProviderAccount]
) -> Counter[int]:
    counts: Counter[int] = Counter()
    for account in accounts:
        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == account.id)
        ).all()
        for mapping in mappings:
            counts[mapping.game_id] += 1
    return counts


def _account_summary(session: Session, account: core.ProviderAccount) -> dict[str, Any]:
    mappings = session.exec(
        select(core.AccountGame).where(core.AccountGame.account_id == account.id)
    ).all()
    notes = json.loads(account.notes or "{}")
    return {
        "id": account.id,
        "label": account.label,
        "status": account.status,
        "owned_game_count": len(mappings),
        "accessible_game_count": len(set(notes.get("accessible_app_ids") or [])),
        "scan_status": notes.get("ownership_scan_status"),
    }


@router.post("/sync")
def sync_pool(req: PoolSyncInput, session: Session = Depends(core.get_session)) -> dict:
    _validate_pool_sync(req)
    games_by_app = _sync_games(req, session)
    synced_accounts = [
        _sync_account(req, incoming, games_by_app, session) for incoming in req.accounts
    ]
    license_counts = _license_counts(session, synced_accounts)
    verified_accounts = sum(1 for incoming in req.accounts if incoming.inventory_complete)
    return {
        "ok": True,
        "source": req.source,
        "verification_complete": req.verification_complete,
        "verified_at": req.verified_at,
        "verification_errors": req.verification_errors,
        "verified_account_count": verified_accounts,
        "unverified_account_count": len(req.accounts) - verified_accounts,
        "account_count": len(synced_accounts),
        "game_count": len(games_by_app),
        "total_license_mappings": sum(license_counts.values()),
        "duplicate_game_count": sum(
            1 for count in license_counts.values() if count > 1
        ),
        "license_semantics": "per-account-authoritative-preserve-failed-provider",
        "accounts": [_account_summary(session, account) for account in synced_accounts],
    }
