from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Optional

from sqlalchemy import text
from sqlmodel import Field as SQLField
from sqlmodel import Session, SQLModel, select

from . import main as core

DEMAND_START = 1.0
DEMAND_INCREMENT = 0.1
DEMAND_MAX = 5.0


class ProviderFamily(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    external_key: str = SQLField(index=True, unique=True)
    provider: str = "steam"


class FamilyMember(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    family_id: int = SQLField(foreign_key="providerfamily.id", index=True)
    account_id: int = SQLField(foreign_key="provideraccount.id", index=True)


class FamilyGameLicenseCopy(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    family_id: int = SQLField(foreign_key="providerfamily.id", index=True)
    game_id: int = SQLField(foreign_key="game.id", index=True)
    owner_account_id: Optional[int] = SQLField(
        default=None, foreign_key="provideraccount.id", index=True
    )


class LeaseAllocation(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    lease_id: int = SQLField(foreign_key="lease.id", index=True)
    family_id: int = SQLField(foreign_key="providerfamily.id", index=True)
    license_copy_id: Optional[int] = SQLField(
        default=None, foreign_key="familygamelicensecopy.id", index=True
    )


class GameDemand(SQLModel, table=True):
    id: Optional[int] = SQLField(default=None, primary_key=True)
    game_id: int = SQLField(foreign_key="game.id", index=True, unique=True)
    request_count_total: int = 0
    successful_leases: int = 0
    demand_value: float = DEMAND_START
    price_factor: float = 1.0
    updated_at: str = ""


def _family_inventory_present(session: Session) -> bool:
    return session.exec(select(ProviderFamily)).first() is not None


def _accessible_app_ids(account: core.ProviderAccount) -> set[int] | None:
    try:
        notes = json.loads(account.notes or "{}")
    except Exception:
        return None
    if not isinstance(notes, dict) or "accessible_app_ids" not in notes:
        return None
    raw = notes.get("accessible_app_ids")
    if not isinstance(raw, list):
        return None
    result: set[int] = set()
    for value in raw:
        try:
            result.add(int(value))
        except (TypeError, ValueError):
            continue
    return result


def _account_notes(account: core.ProviderAccount) -> dict[str, Any]:
    try:
        notes = json.loads(account.notes or "{}")
    except Exception:
        return {}
    return notes if isinstance(notes, dict) else {}


def account_identity(account: core.ProviderAccount) -> str:
    """Stable Steam-account identity used to collapse stale duplicate rows."""
    notes = _account_notes(account)
    raw = (
        notes.get("provider_id")
        or notes.get("account_name")
        or str(account.label or "").split("#", 1)[0]
    )
    return str(raw or "").strip().casefold()


def account_credential_usable(account: core.ProviderAccount) -> bool:
    """Only an explicit Steam InvalidPassword result makes a provider unusable."""
    status = str(_account_notes(account).get("credential_status") or "").strip().casefold()
    return status != "invalid_password"


def _simple_access_snapshot(
    session: Session, game_ids: set[int] | None = None
) -> dict[int, dict[str, int]]:
    """Count real provider identities with known access; Family is diagnostic only."""
    game_statement = select(core.Game)
    if game_ids is None:
        game_statement = game_statement.where(
            core.Game.active == True,  # noqa: E712
            core.CATALOG_PRODUCT_FILTER,
        )
    else:
        game_statement = game_statement.where(core.Game.id.in_(game_ids))
    games = session.exec(game_statement).all()
    if not games:
        return {}

    game_by_id = {int(game.id): game for game in games if game.id is not None}
    game_id_by_app = {
        int(game.app_id): int(game.id)
        for game in games
        if game.id is not None and game.app_id is not None
    }

    accounts = session.exec(
        select(core.ProviderAccount).order_by(core.ProviderAccount.id)
    ).all()
    account_by_id = {int(a.id): a for a in accounts if a.id is not None}

    mapping_statement = select(core.AccountGame)
    if game_ids is not None:
        mapping_statement = mapping_statement.where(core.AccountGame.game_id.in_(game_ids))
    mapped_game_ids_by_account: dict[int, set[int]] = defaultdict(set)
    for mapping in session.exec(mapping_statement).all():
        if int(mapping.game_id) in game_by_id:
            mapped_game_ids_by_account[int(mapping.account_id)].add(int(mapping.game_id))

    active_leased_account_ids = {
        int(lease.account_id)
        for lease in session.exec(
            select(core.Lease).where(core.Lease.status == core.LeaseStatus.active)
        ).all()
    }

    by_identity: dict[str, dict[str, Any]] = {}
    for account_id, account in account_by_id.items():
        if not account_credential_usable(account):
            continue
        identity = account_identity(account) or f"account:{account_id}"
        row = by_identity.setdefault(
            identity,
            {"game_ids": set(), "busy": False},
        )
        row["busy"] = bool(row["busy"] or account_id in active_leased_account_ids)
        row["game_ids"].update(mapped_game_ids_by_account.get(account_id, set()))
        accessible = _accessible_app_ids(account)
        if accessible:
            row["game_ids"].update(
                game_id_by_app[app_id]
                for app_id in accessible
                if app_id in game_id_by_app
            )

    snapshot = {game_id: {"total": 0, "available": 0} for game_id in game_by_id}
    for row in by_identity.values():
        for game_id in row["game_ids"]:
            if game_id not in snapshot:
                continue
            snapshot[game_id]["total"] += 1
            if not row["busy"]:
                snapshot[game_id]["available"] += 1
    return snapshot


def _account_can_launch_family_game(
    state: dict[str, Any], family_id: int, game_id: int, account_id: int
) -> bool:
    # License ownership determines family copy inventory, but it does not prove
    # that this exact Steam seat can launch the app right now. Session assignment
    # therefore fails closed unless the latest per-account access scan includes it.
    account = state["account_by_id"].get(account_id)
    game = state["game_by_id"].get(game_id)
    if not account or not game or not game.app_id:
        return False
    accessible = state["accessible_by_account"].get(account_id)
    return accessible is not None and int(game.app_id) in accessible


def _state(
    session: Session,
    game_ids: set[int] | None = None,
    *,
    include_inactive_game_ids: set[int] | None = None,
) -> dict[str, Any]:
    families = session.exec(select(ProviderFamily)).all()
    members = session.exec(select(FamilyMember)).all()
    copy_statement = select(FamilyGameLicenseCopy)
    game_statement = select(core.Game).where(core.CATALOG_PRODUCT_FILTER)
    if game_ids is not None:
        copy_statement = copy_statement.where(FamilyGameLicenseCopy.game_id.in_(game_ids))
        game_statement = game_statement.where(core.Game.id.in_(game_ids))
    elif include_inactive_game_ids:
        game_statement = game_statement.where(
            (core.Game.active == True)  # noqa: E712
            | core.Game.id.in_(include_inactive_game_ids)
        )
    else:
        game_statement = game_statement.where(core.Game.active == True)  # noqa: E712
    copies = session.exec(copy_statement).all()
    owner_statement = select(core.AccountGame)
    if game_ids is not None:
        owner_statement = owner_statement.where(
            core.AccountGame.game_id.in_(game_ids)
        )
    owned_mappings = session.exec(owner_statement).all()
    accounts = session.exec(select(core.ProviderAccount)).all()
    games = session.exec(game_statement).all()
    active_leases = session.exec(
        select(core.Lease).where(core.Lease.status == core.LeaseStatus.active)
    ).all()
    allocations = session.exec(select(LeaseAllocation)).all()
    demand_statement = select(GameDemand)
    if game_ids is not None:
        demand_statement = demand_statement.where(GameDemand.game_id.in_(game_ids))
    demands = session.exec(demand_statement).all()

    account_by_id = {int(a.id): a for a in accounts if a.id is not None}
    accessible_by_account = {
        account_id: _accessible_app_ids(account)
        for account_id, account in account_by_id.items()
    }
    owned_account_ids_by_game: dict[int, set[int]] = defaultdict(set)
    for mapping in owned_mappings:
        owned_account_ids_by_game[int(mapping.game_id)].add(int(mapping.account_id))
    family_by_id = {int(f.id): f for f in families if f.id is not None}
    members_by_family: dict[int, list[int]] = defaultdict(list)
    family_by_account: dict[int, int] = {}
    for row in members:
        members_by_family[int(row.family_id)].append(int(row.account_id))
        family_by_account[int(row.account_id)] = int(row.family_id)

    copies_by_family_game: dict[tuple[int, int], list[FamilyGameLicenseCopy]] = (
        defaultdict(list)
    )
    for copy in copies:
        copies_by_family_game[(int(copy.family_id), int(copy.game_id))].append(copy)

    allocation_by_lease = {int(a.lease_id): a for a in allocations}
    usage_by_family_game: dict[tuple[int, int], int] = defaultdict(int)
    used_copy_ids: set[int] = set()
    for lease in active_leases:
        allocation = allocation_by_lease.get(int(lease.id or 0))
        family_id = (
            int(allocation.family_id)
            if allocation
            else family_by_account.get(int(lease.account_id))
        )
        if family_id is None:
            continue
        usage_by_family_game[(family_id, int(lease.game_id))] += 1
        if allocation and allocation.license_copy_id:
            used_copy_ids.add(int(allocation.license_copy_id))

    demand_by_game = {int(d.game_id): d for d in demands}
    game_by_id = {int(game.id): game for game in games if game.id is not None}
    return {
        "family_by_id": family_by_id,
        "account_by_id": account_by_id,
        "accessible_by_account": accessible_by_account,
        "owned_account_ids_by_game": owned_account_ids_by_game,
        "game_by_id": game_by_id,
        "members_by_family": members_by_family,
        "family_by_account": family_by_account,
        "copies_by_family_game": copies_by_family_game,
        "usage_by_family_game": usage_by_family_game,
        "used_copy_ids": used_copy_ids,
        "games": games,
        "demand_by_game": demand_by_game,
    }


def _family_counts(
    state,
    family_id,
    game_id,
    copies,
    *,
    simulated_busy_account_id=None,
    simulated_game_id=None,
):
    members = [
        state["account_by_id"][aid]
        for aid in set(state["members_by_family"].get(family_id, []))
        if aid in state["account_by_id"]
    ]
    enabled = [a for a in members if a.status != core.AccountStatus.disabled]
    free = [
        a
        for a in enabled
        if a.status == core.AccountStatus.free and a.id != simulated_busy_account_id
    ]
    eligible = [
        a
        for a in free
        if _account_can_launch_family_game(state, family_id, game_id, int(a.id))
    ]
    used = int(state["usage_by_family_game"].get((family_id, game_id), 0))
    if simulated_game_id == game_id:
        used += 1
    return {
        "total": min(len(copies), len(enabled)),
        "available": min(max(len(copies) - used, 0), len(eligible)),
        "free_members": len(free),
        "eligible_free_members": len(eligible),
        "used_copies": used,
    }


def _direct_account_capacity(state: dict[str, Any], game_id: int) -> dict[str, int]:
    owner_ids = state["owned_account_ids_by_game"].get(game_id, set())
    available = sum(
        1
        for account_id in owner_ids
        if account_id in state["account_by_id"]
        and state["account_by_id"][account_id].status == core.AccountStatus.free
    )
    return {"total": len(owner_ids), "available": available}


def _snapshot(
    state: dict[str, Any],
    *,
    simulated_busy_account_id: int | None = None,
    simulated_family_id: int | None = None,
    simulated_game_id: int | None = None,
) -> dict[int, dict[str, int]]:
    totals = {int(g.id): {"total": 0, "available": 0} for g in state["games"]}
    for (family_id, game_id), copies in state["copies_by_family_game"].items():
        if game_id not in totals:
            continue
        counts = _family_counts(
            state,
            family_id,
            game_id,
            copies,
            simulated_busy_account_id=simulated_busy_account_id,
            simulated_game_id=(
                simulated_game_id if simulated_family_id == family_id else None
            ),
        )
        for key in ("total", "available"):
            totals[game_id][key] += counts[key]

    # Family inventory is synchronized independently from verified ownership.
    # Use account ownership for this title when the family graph has no copy rows.
    family_game_ids = {game_id for _, game_id in state["copies_by_family_game"]}
    for game in state["games"]:
        game_id = int(game.id or 0)
        if game_id not in family_game_ids:
            totals[game_id] = _direct_account_capacity(state, game_id)
    return totals


def fast_catalog_availability(session: Session) -> list[dict[str, Any]] | None:
    """Family/capacity SQL simulation is retired; use the simple allocator metrics."""
    return None


def catalog_metrics(
    session: Session, game_ids: set[int] | None = None
) -> dict[int, dict[str, float | int]]:
    """Availability mirrors the allocator: known access, usable credential, not leased."""
    snapshot = _simple_access_snapshot(session, game_ids)
    demand_statement = select(GameDemand)
    if game_ids is not None:
        demand_statement = demand_statement.where(GameDemand.game_id.in_(game_ids))
    demand_by_game = {
        int(row.game_id): row for row in session.exec(demand_statement).all()
    }

    result: dict[int, dict[str, float | int]] = {}
    for game_id, capacity in snapshot.items():
        demand = demand_by_game.get(game_id)
        demand_value = float(demand.demand_value) if demand else DEMAND_START
        price_factor = float(demand.price_factor) if demand else 1.0
        result[game_id] = {
            "total": int(capacity["total"]),
            "available": int(capacity["available"]),
            "request_count_total": int(demand.request_count_total) if demand else 0,
            "successful_leases": int(demand.successful_leases) if demand else 0,
            "demand_value": round(demand_value, 4),
            "price_factor": round(price_factor, 4),
            "pool_value": round(demand_value * price_factor, 4),
        }
    return result


def game_capacity(session: Session, game: core.Game) -> tuple[int, int]:
    game_id = int(game.id or 0)
    row = _simple_access_snapshot(session, {game_id}).get(
        game_id, {"total": 0, "available": 0}
    )
    return int(row["total"]), int(row["available"])


def demand_fields(session: Session, game_id: int) -> dict[str, float | int]:
    row = session.exec(select(GameDemand).where(GameDemand.game_id == game_id)).first()
    if not row:
        return {
            "request_count_total": 0,
            "successful_leases": 0,
            "demand_value": DEMAND_START,
            "price_factor": 1.0,
            "pool_value": DEMAND_START,
        }
    return {
        "request_count_total": row.request_count_total,
        "successful_leases": row.successful_leases,
        "demand_value": round(float(row.demand_value), 4),
        "price_factor": round(float(row.price_factor), 4),
        "pool_value": round(float(row.demand_value) * float(row.price_factor), 4),
    }


def record_successful_lease(session: Session, game_id: int) -> GameDemand:
    row = session.exec(select(GameDemand).where(GameDemand.game_id == game_id)).first()
    if row is None:
        row = GameDemand(game_id=game_id)
    row.request_count_total += 1
    row.successful_leases += 1
    row.demand_value = min(
        DEMAND_MAX, round(float(row.demand_value) + DEMAND_INCREMENT, 4)
    )
    row.updated_at = core.now_utc().isoformat()
    session.add(row)
    return row


def _weighted_damage(
    state: dict[str, Any],
    before: dict[int, dict[str, int]],
    after: dict[int, dict[str, int]],
) -> tuple[float, int, int]:
    damage = 0.0
    newly_unavailable = 0
    total_after = 0
    demand_by_game: dict[int, GameDemand] = state["demand_by_game"]
    for game_id, before_row in before.items():
        before_available = int(before_row["available"])
        after_available = int(after.get(game_id, {}).get("available", 0))
        total_after += after_available
        lost = max(before_available - after_available, 0)
        if lost <= 0:
            continue
        demand = demand_by_game.get(game_id)
        value = (
            float(demand.demand_value) * float(demand.price_factor)
            if demand
            else DEMAND_START
        )
        marginal_value = value / max(before_available, 1)
        damage += lost * marginal_value
        if before_available > 0 and after_available == 0:
            newly_unavailable += 1
    return round(damage, 8), newly_unavailable, total_after


def account_can_access_game(
    session: Session, account: core.ProviderAccount, game: core.Game
) -> bool:
    """Use only verified GameAccess inventory evidence to decide account access."""
    if game.app_id:
        accessible = _accessible_app_ids(account)
        if accessible is not None and int(game.app_id) in accessible:
            return True
    if not account.id or not game.id:
        return False
    return session.exec(
        select(core.AccountGame).where(
            core.AccountGame.account_id == int(account.id),
            core.AccountGame.game_id == int(game.id),
        )
    ).first() is not None


def _verified_access_selection(session: Session, game: core.Game) -> dict[str, Any] | None:
    active_accounts = {
        int(lease.account_id)
        for lease in session.exec(
            select(core.Lease).where(core.Lease.status == core.LeaseStatus.active)
        ).all()
    }
    accounts = session.exec(
        select(core.ProviderAccount).order_by(core.ProviderAccount.id)
    ).all()
    busy_identities = {
        account_identity(account)
        for account in accounts
        if account.id is not None and int(account.id) in active_accounts
    }
    seen: set[str] = set()
    for account in accounts:
        if account.id is None or not account_credential_usable(account):
            continue
        identity = account_identity(account) or f"account:{account.id}"
        if identity in seen:
            continue
        seen.add(identity)
        if identity in busy_identities:
            continue
        if not account_can_access_game(session, account, game):
            continue
        return {
            "account": account,
            "family_id": None,
            "license_copy_id": None,
            "pool_damage": None,
            "newly_unavailable_games": None,
            "remaining_seats": None,
            "mode": "verified-access",
        }
    return None


def select_best_account(session: Session, game: core.Game) -> dict[str, Any] | None:
    """Choose any known-access provider; Steam is the final authority."""
    return _verified_access_selection(session, game)


def register_lease_allocation(
    session: Session, lease_id: int, family_id: int | None, license_copy_id: int | None
) -> None:
    if family_id is None:
        return
    session.add(
        LeaseAllocation(
            lease_id=lease_id,
            family_id=family_id,
            license_copy_id=license_copy_id,
        )
    )


def family_breakdowns_by_game(session: Session) -> dict[int, list[dict[str, Any]]]:
    if not _family_inventory_present(session):
        return {}
    state = _state(session)
    result: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for (family_id, game_id), copies in state["copies_by_family_game"].items():
        if game_id not in state["game_by_id"]:
            continue
        member_ids = state["members_by_family"].get(family_id, [])
        members = [state["account_by_id"].get(account_id) for account_id in member_ids]
        counts = _family_counts(state, family_id, game_id, copies)
        owners = []
        for copy in copies:
            owner = state["account_by_id"].get(int(copy.owner_account_id or 0))
            if owner:
                owners.append(owner.label)
        family = state["family_by_id"].get(family_id)
        result[game_id].append(
            {
                "family_id": family_id,
                "family_key": family.external_key if family else f"family:{family_id}",
                "members": [m.label for m in members if m],
                "free_members": counts["free_members"],
                "eligible_free_members": counts["eligible_free_members"],
                "total_seats": counts["total"],
                "license_copies": len(copies),
                "used_copies": counts["used_copies"],
                "available_seats": counts["available"],
                "owners": owners,
            }
        )
    for rows in result.values():
        rows.sort(key=lambda item: item["family_key"])
    return dict(result)


def family_breakdown_for_game(session: Session, game_id: int) -> list[dict[str, Any]]:
    return family_breakdowns_by_game(session).get(game_id, [])


def replace_family_graph(
    session: Session, families: list[dict[str, Any]]
) -> dict[str, int]:
    from .family_graph_write import replace_family_graph as replace

    return replace(session, families)
