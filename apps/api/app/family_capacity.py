from __future__ import annotations

import json
from collections import defaultdict
from typing import Any, Optional

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
    accessible = _accessible_app_ids(account)
    return accessible is not None and int(game.app_id) in accessible


def _state(session: Session) -> dict[str, Any]:
    families = session.exec(select(ProviderFamily)).all()
    members = session.exec(select(FamilyMember)).all()
    copies = session.exec(select(FamilyGameLicenseCopy)).all()
    accounts = session.exec(select(core.ProviderAccount)).all()
    games = session.exec(select(core.Game).where(core.Game.active == True)).all()  # noqa: E712
    active_leases = session.exec(
        select(core.Lease).where(core.Lease.status == core.LeaseStatus.active)
    ).all()
    allocations = session.exec(select(LeaseAllocation)).all()
    demands = session.exec(select(GameDemand)).all()

    account_by_id = {int(a.id): a for a in accounts if a.id is not None}
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
    return totals


def catalog_metrics(session: Session) -> dict[int, dict[str, float | int]]:
    """Build capacity + demand metrics for every game from one database snapshot."""
    if _family_inventory_present(session):
        state = _state(session)
        snapshot = _snapshot(state)
        demand_by_game: dict[int, GameDemand] = state["demand_by_game"]
        result: dict[int, dict[str, float | int]] = {}
        for game in state["games"]:
            game_id = int(game.id or 0)
            capacity = snapshot.get(game_id, {"total": 0, "available": 0})
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

    accounts = session.exec(select(core.ProviderAccount)).all()
    mappings = session.exec(select(core.AccountGame)).all()
    demands = session.exec(select(GameDemand)).all()
    demand_by_game = {int(row.game_id): row for row in demands}
    status_by_account = {int(a.id): a.status for a in accounts if a.id is not None}
    total_by_game: dict[int, int] = defaultdict(int)
    available_by_game: dict[int, int] = defaultdict(int)
    for mapping in mappings:
        game_id = int(mapping.game_id)
        total_by_game[game_id] += 1
        if status_by_account.get(int(mapping.account_id)) == core.AccountStatus.free:
            available_by_game[game_id] += 1
    result: dict[int, dict[str, float | int]] = {}
    for game in session.exec(select(core.Game).where(core.Game.active == True)).all():  # noqa: E712
        game_id = int(game.id or 0)
        demand = demand_by_game.get(game_id)
        demand_value = float(demand.demand_value) if demand else DEMAND_START
        price_factor = float(demand.price_factor) if demand else 1.0
        result[game_id] = {
            "total": int(total_by_game.get(game_id, 0)),
            "available": int(available_by_game.get(game_id, 0)),
            "request_count_total": int(demand.request_count_total) if demand else 0,
            "successful_leases": int(demand.successful_leases) if demand else 0,
            "demand_value": round(demand_value, 4),
            "price_factor": round(price_factor, 4),
            "pool_value": round(demand_value * price_factor, 4),
        }
    return result


def game_capacity(session: Session, game: core.Game) -> tuple[int, int]:
    if not _family_inventory_present(session):
        owned = session.exec(
            select(core.AccountGame).where(core.AccountGame.game_id == game.id)
        ).all()
        account_ids = [row.account_id for row in owned]
        available = 0
        for account_id in account_ids:
            account = session.get(core.ProviderAccount, account_id)
            if account and account.status == core.AccountStatus.free:
                available += 1
        return len(account_ids), available

    state = _state(session)
    row = _snapshot(state).get(int(game.id or 0), {"total": 0, "available": 0})
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


def _legacy_selection(session, game):
    mappings = session.exec(
        select(core.AccountGame).where(core.AccountGame.game_id == game.id)
    ).all()
    for mapping in mappings:
        account = session.get(core.ProviderAccount, mapping.account_id)
        if account and account.status == core.AccountStatus.free:
            return {
                "account": account,
                "family_id": None,
                "license_copy_id": None,
                "pool_damage": None,
                "newly_unavailable_games": None,
                "remaining_seats": None,
                "mode": "legacy-account-fallback",
            }
    return None


def select_best_account(session: Session, game: core.Game) -> dict[str, Any] | None:
    if not _family_inventory_present(session):
        return _legacy_selection(session, game)

    state = _state(session)
    before = _snapshot(state)
    candidates: list[tuple[tuple[float, int, int, int], dict[str, Any]]] = []
    game_id = int(game.id or 0)
    for (family_id, candidate_game_id), copies in state[
        "copies_by_family_game"
    ].items():
        if candidate_game_id != game_id:
            continue
        used = int(state["usage_by_family_game"].get((family_id, game_id), 0))
        if used >= len(copies):
            continue
        free_copy = next(
            (
                copy
                for copy in copies
                if int(copy.id or 0) not in state["used_copy_ids"]
            ),
            None,
        )
        if free_copy is None:
            continue
        for account_id in state["members_by_family"].get(family_id, []):
            account = state["account_by_id"].get(account_id)
            if not account or account.status != core.AccountStatus.free:
                continue
            if not _account_can_launch_family_game(
                state, family_id, game_id, account_id
            ):
                continue
            after = _snapshot(
                state,
                simulated_busy_account_id=account_id,
                simulated_family_id=family_id,
                simulated_game_id=game_id,
            )
            damage, newly_unavailable, remaining = _weighted_damage(
                state, before, after
            )
            key = (damage, newly_unavailable, -remaining, int(account.id or 0))
            candidates.append(
                (
                    key,
                    {
                        "account": account,
                        "family_id": family_id,
                        "license_copy_id": int(free_copy.id or 0) or None,
                        "pool_damage": damage,
                        "newly_unavailable_games": newly_unavailable,
                        "remaining_seats": remaining,
                        "mode": "family-simulation",
                    },
                )
            )
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


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
