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


def _verified_access_capacity(state: dict[str, Any], game_id: int) -> dict[str, int]:
    game = state["game_by_id"].get(game_id)
    if not game or not game.app_id:
        return {"total": 0, "available": 0}
    app_id = int(game.app_id)
    eligible = [
        account
        for account_id, account in state["account_by_id"].items()
        if account.status != core.AccountStatus.disabled
        and app_id in (state["accessible_by_account"].get(account_id) or set())
    ]
    available = sum(1 for account in eligible if account.status == core.AccountStatus.free)
    return {"total": len(eligible), "available": available}


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

    # If Steam Family copy metadata is absent for a title, use the current
    # per-account Steam access scan instead of reconstructing access from older mappings.
    family_game_ids = {game_id for _, game_id in state["copies_by_family_game"]}
    for game in state["games"]:
        game_id = int(game.id or 0)
        if game_id not in family_game_ids:
            totals[game_id] = _verified_access_capacity(state, game_id)
    return totals


def catalog_metrics(
    session: Session, game_ids: set[int] | None = None
) -> dict[int, dict[str, float | int]]:
    """Build capacity and demand from current Steam access evidence."""
    state = _state(session, game_ids)
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

def fast_catalog_availability(session: Session) -> list[dict[str, Any]] | None:
    """Return the complete live catalog overlay in one PostgreSQL query.

    The regular Python implementation remains the source-of-truth fallback for
    SQLite/tests and for any unexpected PostgreSQL data that cannot be parsed.
    """
    connection = session.connection()
    if connection.dialect.name != "postgresql":
        return None

    statement = text("""
    WITH visible_games AS (
      SELECT g.id, g.app_id, g.credit_cost_per_hour
      FROM game g
      JOIN game_metadata m ON m.game_id = g.id
      WHERE g.active = true
        AND lower(coalesce(m.product_type,'')) = 'game'
        AND lower(trim(coalesce(g.name,''))) <> ('steam ' || g.app_id::text)
    ),
    family_copy_counts AS (
      SELECT family_id, game_id, count(*)::int AS copies
      FROM familygamelicensecopy
      GROUP BY family_id, game_id
    ),
    enabled_members AS (
      SELECT fm.family_id,
             count(*) FILTER (WHERE pa.status::text <> 'disabled')::int AS enabled
      FROM familymember fm
      JOIN provideraccount pa ON pa.id = fm.account_id
      GROUP BY fm.family_id
    ),
    account_accessible AS (
      SELECT pa.id AS account_id, access.value::int AS app_id
      FROM provideraccount pa
      CROSS JOIN LATERAL jsonb_array_elements_text(
        coalesce((nullif(pa.notes,'')::jsonb)->'accessible_app_ids','[]'::jsonb)
      ) AS access(value)
      WHERE pa.status::text = 'free'
        AND access.value ~ '^[0-9]+$'
    ),
    eligible_counts AS (
      SELECT fm.family_id, vg.id AS game_id,
             count(DISTINCT fm.account_id)::int AS eligible
      FROM account_accessible aa
      JOIN familymember fm ON fm.account_id = aa.account_id
      JOIN visible_games vg ON vg.app_id = aa.app_id
      GROUP BY fm.family_id, vg.id
    ),
    usage_counts AS (
      SELECT coalesce(la.family_id, fm.family_id) AS family_id,
             l.game_id,
             count(*)::int AS used
      FROM lease l
      LEFT JOIN leaseallocation la ON la.lease_id = l.id
      LEFT JOIN familymember fm ON fm.account_id = l.account_id
      WHERE l.status::text = 'active'
        AND coalesce(la.family_id, fm.family_id) IS NOT NULL
      GROUP BY coalesce(la.family_id, fm.family_id), l.game_id
    ),
    family_capacity AS (
      SELECT fcc.game_id,
             sum(least(fcc.copies, coalesce(em.enabled,0)))::int AS total,
             sum(least(
               greatest(fcc.copies - coalesce(uc.used,0), 0),
               coalesce(ec.eligible,0)
             ))::int AS available
      FROM family_copy_counts fcc
      LEFT JOIN enabled_members em ON em.family_id = fcc.family_id
      LEFT JOIN eligible_counts ec
        ON ec.family_id = fcc.family_id AND ec.game_id = fcc.game_id
      LEFT JOIN usage_counts uc
        ON uc.family_id = fcc.family_id AND uc.game_id = fcc.game_id
      GROUP BY fcc.game_id
    ),
    verified_access_capacity AS (
      SELECT vg.id AS game_id,
             count(DISTINCT pa.id)
               FILTER (WHERE pa.status::text <> 'disabled')::int AS total,
             count(DISTINCT pa.id)
               FILTER (WHERE pa.status::text = 'free')::int AS available
      FROM visible_games vg
      JOIN provideraccount pa ON true
      CROSS JOIN LATERAL jsonb_array_elements_text(
        coalesce((nullif(pa.notes,'')::jsonb)->'accessible_app_ids','[]'::jsonb)
      ) AS access(value)
      WHERE access.value ~ '^[0-9]+    SELECT
      vg.id,
      vg.app_id,
      vg.credit_cost_per_hour,
      coalesce(fc.total, vac.total, 0)::int AS copies_total,
      coalesce(fc.available, vac.available, 0)::int AS copies_available,
      coalesce(gd.request_count_total, 0)::int AS request_count_total,
      coalesce(gd.successful_leases, 0)::int AS successful_leases,
      coalesce(gd.demand_value, 1.0)::float AS demand_value,
      coalesce(gd.price_factor, 1.0)::float AS price_factor
    FROM visible_games vg
    LEFT JOIN family_capacity fc ON fc.game_id = vg.id
    LEFT JOIN verified_access_capacity vac ON vac.game_id = vg.id
    LEFT JOIN gamedemand gd ON gd.game_id = vg.id
    ORDER BY vg.id
    """)

    rows = connection.execute(statement).mappings().all()
    result: list[dict[str, Any]] = []
    for row in rows:
        total = int(row["copies_total"] or 0)
        available = int(row["copies_available"] or 0)
        demand_value = float(row["demand_value"] or 1.0)
        price_factor = float(row["price_factor"] or 1.0)
        result.append({
            "id": int(row["id"]),
            "app_id": int(row["app_id"]) if row["app_id"] is not None else None,
            "credit_cost_per_hour": int(row["credit_cost_per_hour"] or 0),
            "copies_total": total,
            "copies_available": available,
            "availability_state": (
                "ready" if available > 0 else ("owned-busy" if total > 0 else "unavailable")
            ),
            "request_count_total": int(row["request_count_total"] or 0),
            "successful_leases": int(row["successful_leases"] or 0),
            "demand_value": round(demand_value, 4),
            "price_factor": round(price_factor, 4),
            "pool_value": round(demand_value * price_factor, 4),
        })
    return result


def game_capacity(session: Session, game: core.Game) -> tuple[int, int]:
    game_id = int(game.id or 0)
    state = _state(session, {game_id})
    row = _snapshot(state).get(game_id, {"total": 0, "available": 0})
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


def _verified_access_selection(session: Session, game: core.Game) -> dict[str, Any] | None:
    if not game.app_id:
        return None
    app_id = int(game.app_id)
    for account in session.exec(select(core.ProviderAccount).order_by(core.ProviderAccount.id)).all():
        if account.status != core.AccountStatus.free:
            continue
        accessible = _accessible_app_ids(account)
        if accessible is not None and app_id in accessible:
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
    game_id = int(game.id or 0)
    state = _state(session, include_inactive_game_ids={game_id})
    family_game_ids = {candidate_game_id for _, candidate_game_id in state["copies_by_family_game"]}
    if game_id not in family_game_ids:
        return _verified_access_selection(session, game)

    before = _snapshot(state)
    candidates: list[tuple[tuple[float, int, int, int], dict[str, Any]]] = []
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

        AND access.value::int = vg.app_id
      GROUP BY vg.id
    )
    SELECT
      vg.id,
      vg.app_id,
      vg.credit_cost_per_hour,
      coalesce(fc.total, lc.total, 0)::int AS copies_total,
      coalesce(fc.available, lc.available, 0)::int AS copies_available,
      coalesce(gd.request_count_total, 0)::int AS request_count_total,
      coalesce(gd.successful_leases, 0)::int AS successful_leases,
      coalesce(gd.demand_value, 1.0)::float AS demand_value,
      coalesce(gd.price_factor, 1.0)::float AS price_factor
    FROM visible_games vg
    LEFT JOIN family_capacity fc ON fc.game_id = vg.id
    LEFT JOIN legacy_capacity lc ON lc.game_id = vg.id
    LEFT JOIN gamedemand gd ON gd.game_id = vg.id
    ORDER BY vg.id
    """)

    rows = connection.execute(statement).mappings().all()
    result: list[dict[str, Any]] = []
    for row in rows:
        total = int(row["copies_total"] or 0)
        available = int(row["copies_available"] or 0)
        demand_value = float(row["demand_value"] or 1.0)
        price_factor = float(row["price_factor"] or 1.0)
        result.append({
            "id": int(row["id"]),
            "app_id": int(row["app_id"]) if row["app_id"] is not None else None,
            "credit_cost_per_hour": int(row["credit_cost_per_hour"] or 0),
            "copies_total": total,
            "copies_available": available,
            "availability_state": (
                "ready" if available > 0 else ("owned-busy" if total > 0 else "unavailable")
            ),
            "request_count_total": int(row["request_count_total"] or 0),
            "successful_leases": int(row["successful_leases"] or 0),
            "demand_value": round(demand_value, 4),
            "price_factor": round(price_factor, 4),
            "pool_value": round(demand_value * price_factor, 4),
        })
    return result


def game_capacity(session: Session, game: core.Game) -> tuple[int, int]:
    game_id = int(game.id or 0)
    state = _state(session, {game_id})
    row = _snapshot(state).get(game_id, {"total": 0, "available": 0})
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


def _verified_access_selection(session: Session, game: core.Game) -> dict[str, Any] | None:
    if not game.app_id:
        return None
    app_id = int(game.app_id)
    for account in session.exec(select(core.ProviderAccount).order_by(core.ProviderAccount.id)).all():
        if account.status != core.AccountStatus.free:
            continue
        accessible = _accessible_app_ids(account)
        if accessible is not None and app_id in accessible:
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
    game_id = int(game.id or 0)
    state = _state(session, include_inactive_game_ids={game_id})
    family_game_ids = {candidate_game_id for _, candidate_game_id in state["copies_by_family_game"]}
    if game_id not in family_game_ids:
        return _verified_access_selection(session, game)

    before = _snapshot(state)
    candidates: list[tuple[tuple[float, int, int, int], dict[str, Any]]] = []
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
