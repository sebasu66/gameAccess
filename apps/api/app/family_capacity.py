from __future__ import annotations

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

    copies_by_family_game: dict[tuple[int, int], list[FamilyGameLicenseCopy]] = defaultdict(list)
    for copy in copies:
        copies_by_family_game[(int(copy.family_id), int(copy.game_id))].append(copy)

    allocation_by_lease = {int(a.lease_id): a for a in allocations}
    usage_by_family_game: dict[tuple[int, int], int] = defaultdict(int)
    used_copy_ids: set[int] = set()
    for lease in active_leases:
        allocation = allocation_by_lease.get(int(lease.id or 0))
        family_id = int(allocation.family_id) if allocation else family_by_account.get(int(lease.account_id))
        if family_id is None:
            continue
        usage_by_family_game[(family_id, int(lease.game_id))] += 1
        if allocation and allocation.license_copy_id:
            used_copy_ids.add(int(allocation.license_copy_id))

    demand_by_game = {int(d.game_id): d for d in demands}
    return {
        "family_by_id": family_by_id,
        "account_by_id": account_by_id,
        "members_by_family": members_by_family,
        "family_by_account": family_by_account,
        "copies_by_family_game": copies_by_family_game,
        "usage_by_family_game": usage_by_family_game,
        "used_copy_ids": used_copy_ids,
        "games": games,
        "demand_by_game": demand_by_game,
    }


def _snapshot(
    state: dict[str, Any],
    *,
    simulated_busy_account_id: int | None = None,
    simulated_family_id: int | None = None,
    simulated_game_id: int | None = None,
) -> dict[int, dict[str, int]]:
    total_by_game: dict[int, int] = defaultdict(int)
    available_by_game: dict[int, int] = defaultdict(int)

    account_by_id: dict[int, core.ProviderAccount] = state["account_by_id"]
    members_by_family: dict[int, list[int]] = state["members_by_family"]
    copies_by_family_game: dict[tuple[int, int], list[FamilyGameLicenseCopy]] = state[
        "copies_by_family_game"
    ]
    usage_by_family_game: dict[tuple[int, int], int] = state["usage_by_family_game"]

    enabled_members: dict[int, int] = {}
    free_members: dict[int, int] = {}
    for family_id, member_ids in members_by_family.items():
        enabled = 0
        free = 0
        for account_id in member_ids:
            account = account_by_id.get(account_id)
            if not account or account.status == core.AccountStatus.disabled:
                continue
            enabled += 1
            is_free = account.status == core.AccountStatus.free
            if simulated_busy_account_id == account_id:
                is_free = False
            if is_free:
                free += 1
        enabled_members[family_id] = enabled
        free_members[family_id] = free

    for (family_id, game_id), copies in copies_by_family_game.items():
        quantity = len(copies)
        used = int(usage_by_family_game.get((family_id, game_id), 0))
        if simulated_family_id == family_id and simulated_game_id == game_id:
            used += 1
        total_by_game[game_id] += min(quantity, enabled_members.get(family_id, 0))
        available_by_game[game_id] += min(
            max(quantity - used, 0), free_members.get(family_id, 0)
        )

    game_ids = {int(game.id) for game in state["games"] if game.id is not None}
    return {
        game_id: {
            "total": int(total_by_game.get(game_id, 0)),
            "available": int(available_by_game.get(game_id, 0)),
        }
        for game_id in game_ids
    }


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
    row.demand_value = min(DEMAND_MAX, round(float(row.demand_value) + DEMAND_INCREMENT, 4))
    row.updated_at = core.now_utc().isoformat()
    session.add(row)
    return row


def _weighted_damage(
    state: dict[str, Any], before: dict[int, dict[str, int]], after: dict[int, dict[str, int]]
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


def select_best_account(session: Session, game: core.Game) -> dict[str, Any] | None:
    if not _family_inventory_present(session):
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

    state = _state(session)
    before = _snapshot(state)
    candidates: list[tuple[tuple[float, int, int, int], dict[str, Any]]] = []
    game_id = int(game.id or 0)
    for (family_id, candidate_game_id), copies in state["copies_by_family_game"].items():
        if candidate_game_id != game_id:
            continue
        used = int(state["usage_by_family_game"].get((family_id, game_id), 0))
        if used >= len(copies):
            continue
        free_copy = next(
            (copy for copy in copies if int(copy.id or 0) not in state["used_copy_ids"]),
            None,
        )
        if free_copy is None:
            continue
        for account_id in state["members_by_family"].get(family_id, []):
            account = state["account_by_id"].get(account_id)
            if not account or account.status != core.AccountStatus.free:
                continue
            after = _snapshot(
                state,
                simulated_busy_account_id=account_id,
                simulated_family_id=family_id,
                simulated_game_id=game_id,
            )
            damage, newly_unavailable, remaining = _weighted_damage(state, before, after)
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


def family_breakdown_for_game(session: Session, game_id: int) -> list[dict[str, Any]]:
    if not _family_inventory_present(session):
        return []
    state = _state(session)
    current = _snapshot(state)
    result: list[dict[str, Any]] = []
    for (family_id, candidate_game_id), copies in state["copies_by_family_game"].items():
        if candidate_game_id != game_id:
            continue
        member_ids = state["members_by_family"].get(family_id, [])
        members = [state["account_by_id"].get(account_id) for account_id in member_ids]
        enabled = [m for m in members if m and m.status != core.AccountStatus.disabled]
        free = [m for m in enabled if m.status == core.AccountStatus.free]
        used = int(state["usage_by_family_game"].get((family_id, game_id), 0))
        owners = []
        for copy in copies:
            owner = state["account_by_id"].get(int(copy.owner_account_id or 0))
            if owner:
                owners.append(owner.label)
        family = state["family_by_id"].get(family_id)
        result.append(
            {
                "family_id": family_id,
                "family_key": family.external_key if family else f"family:{family_id}",
                "members": [m.label for m in members if m],
                "free_members": len(free),
                "license_copies": len(copies),
                "used_copies": used,
                "available_seats": min(max(len(copies) - used, 0), len(free)),
                "owners": owners,
            }
        )
    result.sort(key=lambda item: item["family_key"])
    return result


def replace_family_graph(session: Session, families: list[dict[str, Any]]) -> dict[str, int]:
    """Replace the family graph from an authoritative provider-family snapshot.

    family_key must already be opaque/safe for backend storage. Accounts omitted
    from the provider family list are materialized as one-member synthetic families.
    """
    account_by_label = {
        account.label: account for account in session.exec(select(core.ProviderAccount)).all()
    }
    game_by_app = {
        int(game.app_id): game
        for game in session.exec(select(core.Game)).all()
        if game.app_id and game.id is not None
    }

    for row in session.exec(select(FamilyGameLicenseCopy)).all():
        session.delete(row)
    for row in session.exec(select(FamilyMember)).all():
        session.delete(row)
    session.commit()

    seen_accounts: set[int] = set()
    family_count = 0
    copy_count = 0
    for incoming in families:
        key = str(incoming.get("family_key") or "").strip()
        if not key:
            continue
        family = session.exec(
            select(ProviderFamily).where(ProviderFamily.external_key == key)
        ).first()
        if family is None:
            family = ProviderFamily(external_key=key, provider="steam")
            session.add(family)
            session.commit()
            session.refresh(family)
        family_count += 1
        for label in incoming.get("members") or []:
            account = account_by_label.get(str(label))
            if not account or account.id is None:
                continue
            seen_accounts.add(int(account.id))
            session.add(FamilyMember(family_id=int(family.id), account_id=int(account.id)))
        for license_row in incoming.get("licenses") or []:
            app_id = int(license_row.get("app_id") or 0)
            game = game_by_app.get(app_id)
            if not game or game.id is None:
                continue
            owner_labels = [str(x) for x in license_row.get("owner_labels") or []]
            quantity = max(int(license_row.get("quantity") or len(owner_labels) or 0), 0)
            for index in range(quantity):
                owner = account_by_label.get(owner_labels[index]) if index < len(owner_labels) else None
                session.add(
                    FamilyGameLicenseCopy(
                        family_id=int(family.id),
                        game_id=int(game.id),
                        owner_account_id=int(owner.id) if owner and owner.id is not None else None,
                    )
                )
                copy_count += 1

    # Every non-family provider account is still a valid one-member license domain.
    for account in account_by_label.values():
        if account.id is None or int(account.id) in seen_accounts:
            continue
        key = f"account:{int(account.id)}"
        family = session.exec(
            select(ProviderFamily).where(ProviderFamily.external_key == key)
        ).first()
        if family is None:
            family = ProviderFamily(external_key=key, provider=account.provider)
            session.add(family)
            session.commit()
            session.refresh(family)
        family_count += 1
        session.add(FamilyMember(family_id=int(family.id), account_id=int(account.id)))
        mappings = session.exec(
            select(core.AccountGame).where(core.AccountGame.account_id == account.id)
        ).all()
        for mapping in mappings:
            session.add(
                FamilyGameLicenseCopy(
                    family_id=int(family.id),
                    game_id=int(mapping.game_id),
                    owner_account_id=int(account.id),
                )
            )
            copy_count += 1
    session.commit()
    return {"families": family_count, "license_copies": copy_count}
