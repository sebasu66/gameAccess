from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"Expected patch target not found in {relative}: {old[:120]!r}")
    text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")


replace_once(
    "apps/api/app/main.py",
    '''def game_capacity(session: Session, game: Game) -> tuple[int, int]:
    owned = session.exec(
        select(AccountGame).where(AccountGame.game_id == game.id)
    ).all()
    account_ids = [row.account_id for row in owned]
    available = 0
    for account_id in account_ids:
        account = session.get(ProviderAccount, account_id)
        if account and account.status == AccountStatus.free:
            available += 1
    return len(account_ids), available
''',
    '''def game_capacity(session: Session, game: Game) -> tuple[int, int]:
    from . import family_capacity

    return family_capacity.game_capacity(session, game)
''',
)

replace_once(
    "apps/api/app/main.py",
    '''def game_summary(session: Session, game: Game) -> dict:
    total, available = game_capacity(session, game)
    assets = steam_assets(game.app_id)
    return {
''',
    '''def game_summary(session: Session, game: Game) -> dict:
    from . import family_capacity

    total, available = game_capacity(session, game)
    demand = family_capacity.demand_fields(session, int(game.id or 0))
    assets = steam_assets(game.app_id)
    return {
''',
)

replace_once(
    "apps/api/app/main.py",
    '''        "availability_state": "ready"
        if available > 0
        else ("owned-busy" if total > 0 else "unavailable"),
        **assets,
''',
    '''        "availability_state": "ready"
        if available > 0
        else ("owned-busy" if total > 0 else "unavailable"),
        **demand,
        **assets,
''',
)

replace_once(
    "apps/api/app/main.py",
    '''    mappings = session.exec(
        select(AccountGame).where(AccountGame.game_id == game.id)
    ).all()
    selected = None
    for mapping in mappings:
        account = session.get(ProviderAccount, mapping.account_id)
        if account and account.status == AccountStatus.free:
            selected = account
            break
    if not selected:
        raise HTTPException(409, "no account currently available for this game")
''',
    '''    from . import family_capacity

    selection = family_capacity.select_best_account(session, game)
    if not selection:
        raise HTTPException(409, "no account currently available for this game")
    selected = selection["account"]
''',
)

replace_once(
    "apps/api/app/main.py",
    '''    session.commit()
    session.refresh(lease)
    return {
        "lease_id": lease.id,
''',
    '''    session.commit()
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
''',
)

replace_once(
    "apps/api/app/main.py",
    '''        "account": {
            "id": selected.id,
            "label": selected.label,
            "provider": selected.provider,
        },
        "starts_at": starts,
''',
    '''        "account": {
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
''',
)

replace_once(
    "apps/api/app/pool_routes.py",
    '''from . import main as core
from .account_roster import load_account_roster, replace_runtime_roster
''',
    '''from . import main as core
from . import family_capacity
from .account_roster import load_account_roster, replace_runtime_roster
''',
)

replace_once(
    "apps/api/app/pool_routes.py",
    '''class PoolSyncInput(BaseModel):
    source: str = "unverified"
    verification_complete: bool = False
    verified_at: str | None = None
    verification_errors: list[dict[str, Any]] = []
    accounts: list[PoolAccountInput]
    games: list[PoolGameInput]
''',
    '''class PoolSyncInput(BaseModel):
    source: str = "unverified"
    verification_complete: bool = False
    verified_at: str | None = None
    verification_errors: list[dict[str, Any]] = []
    accounts: list[PoolAccountInput]
    games: list[PoolGameInput]


class FamilyLicenseInput(BaseModel):
    app_id: int = Field(gt=0)
    quantity: int = Field(ge=0)
    owner_labels: list[str] = []


class FamilyInput(BaseModel):
    family_key: str = Field(min_length=1, max_length=200)
    members: list[str] = []
    licenses: list[FamilyLicenseInput] = []


class FamilyGraphSyncInput(BaseModel):
    families: list[FamilyInput]
''',
)

append_pool = '''\n\n@router.post("/families/sync")\ndef sync_family_graph(req: FamilyGraphSyncInput, session: Session = Depends(core.get_session)) -> dict:\n    result = family_capacity.replace_family_graph(\n        session, [family.model_dump() for family in req.families]\n    )\n    return {\n        "ok": True,\n        **result,\n        "capacity_semantics": "family-license-copies-x-free-members",\n        "allocation_semantics": "simulate-each-candidate-minimize-weighted-pool-damage",\n    }\n'''
pool_path = ROOT / "apps/api/app/pool_routes.py"
pool_text = pool_path.read_text(encoding="utf-8")
if '@router.post("/families/sync")' not in pool_text:
    pool_path.write_text(pool_text.rstrip() + append_pool + "\n", encoding="utf-8")

replace_once(
    "apps/api/app/admin_console_routes.py",
    '''from . import main as core
''',
    '''from . import main as core
from . import family_capacity
''',
)

replace_once(
    "apps/api/app/admin_console_routes.py",
    '''    license_rows = []
    for game in games:
        owners = []
        available = 0
        for mapping in mappings_by_game.get(game.id or -1, []):
            account = session.get(core.ProviderAccount, mapping.account_id)
            if not account:
                continue
            owners.append({"id": account.id, "label": account.label, "status": account.status})
            if account.status == core.AccountStatus.free:
                available += 1
        if owners or game.active:
            license_rows.append(
                {
                    "game_id": game.id,
                    "app_id": game.app_id,
                    "name": game.name,
                    "active": game.active,
                    "cost_per_hour": game.credit_cost_per_hour,
                    "copies_total": len(owners),
                    "copies_available": available,
                    "owners": owners,
                }
            )
''',
    '''    license_rows = []
    for game in games:
        owners = []
        for mapping in mappings_by_game.get(game.id or -1, []):
            account = session.get(core.ProviderAccount, mapping.account_id)
            if not account:
                continue
            owners.append({"id": account.id, "label": account.label, "status": account.status})
        total, available = core.game_capacity(session, game)
        demand = family_capacity.demand_fields(session, int(game.id or 0))
        if total or owners or game.active:
            license_rows.append(
                {
                    "game_id": game.id,
                    "app_id": game.app_id,
                    "name": game.name,
                    "active": game.active,
                    "cost_per_hour": game.credit_cost_per_hour,
                    "copies_total": total,
                    "copies_available": available,
                    "owners": owners,
                    "families": family_capacity.family_breakdown_for_game(session, int(game.id or 0)),
                    **demand,
                }
            )
''',
)

replace_once(
    "apps/api/app/admin_console_routes.py",
    '''            "license_mappings": len(mappings),
            "distinct_licensed_games": len(mappings_by_game),
''',
    '''            "license_mappings": sum(row["copies_total"] for row in license_rows),
            "account_game_mappings": len(mappings),
            "distinct_licensed_games": sum(1 for row in license_rows if row["copies_total"] > 0),
''',
)

replace_once(
    "apps/api/app/admin_console_routes.py",
    '''        "seat_model": "Cada ProviderAccount cuenta hoy como un asiento operativo. Steam Families se modelará como capa separada sin cambiar el inventario de licencias.",
''',
    '''        "seat_model": "Los asientos se derivan por familia: min(copias libres del juego, miembros libres). La asignación simula cada candidato y elige el menor daño ponderado al pool.",
''',
)

print("family backend integration patch applied")
