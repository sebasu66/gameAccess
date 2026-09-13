from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


pool = ROOT / "apps/api/app/pool_routes.py"
replace_once(
    pool,
    "import json\nfrom collections import Counter\nfrom typing import Any\n\nfrom fastapi import APIRouter, Depends, HTTPException\n",
    "import json\nimport time\nfrom collections import Counter\nfrom threading import Lock\nfrom typing import Any\n\nfrom fastapi import APIRouter, BackgroundTasks, Depends, HTTPException\n",
)
replace_once(
    pool,
    "from .account_roster import load_account_roster, replace_runtime_roster\n\nrouter = APIRouter(prefix=\"/admin/pool\", tags=[\"pool\"])\n",
    "from .account_roster import load_account_roster, replace_runtime_roster\nfrom .provider_app_registration import is_placeholder_name, placeholder_name\n\nrouter = APIRouter(prefix=\"/admin/pool\", tags=[\"pool\"])\n\n_METADATA_FETCH_LOCK = Lock()\n_METADATA_MIN_INTERVAL_SECONDS = 1.0\n_METADATA_LAST_FETCH_STARTED = 0.0\n",
)
replace_once(
    pool,
    "def sync_runtime_account_roster(session: Session) -> int:\n",
    '''def _register_provider_app(session: Session, app_id: int) -> tuple[core.Game, bool]:
    app_id = int(app_id)
    game = session.exec(select(core.Game).where(core.Game.app_id == app_id)).first()
    if game is not None:
        return game, False
    name = placeholder_name(app_id)
    game = core.Game(
        slug=_unique_slug(session, name, app_id),
        name=name,
        app_id=app_id,
        credit_cost_per_hour=10,
        active=False,
    )
    session.add(game)
    session.commit()
    session.refresh(game)
    return game, True


def _fetch_metadata_throttled(app_id: int) -> dict[str, Any]:
    global _METADATA_LAST_FETCH_STARTED
    with _METADATA_FETCH_LOCK:
        elapsed = time.monotonic() - _METADATA_LAST_FETCH_STARTED
        if elapsed < _METADATA_MIN_INTERVAL_SECONDS:
            time.sleep(_METADATA_MIN_INTERVAL_SECONDS - elapsed)
        _METADATA_LAST_FETCH_STARTED = time.monotonic()
        return core.steam_catalog.fetch(app_id)


def _enrich_provider_app(app_id: int) -> None:
    metadata = None
    for attempt in range(3):
        try:
            metadata = _fetch_metadata_throttled(app_id)
            break
        except core.SteamCatalogError:
            if attempt < 2:
                time.sleep(5.0 * (2 ** attempt))
    if metadata is None:
        return
    with Session(core.engine) as session:
        game = session.exec(select(core.Game).where(core.Game.app_id == app_id)).first()
        if game is None:
            return
        game.name = str(metadata.get("name") or placeholder_name(app_id)).strip()
        game.active = (
            str(metadata.get("type") or "").casefold() == "game"
            and bool(metadata.get("windows"))
        )
        session.add(game)
        session.commit()


def sync_runtime_account_roster(session: Session) -> int:
''',
)
replace_once(
    pool,
    "@router.get(\"/roster-status\")\ndef roster_status(session: Session = Depends(core.get_session)) -> dict:\n    count = sync_runtime_account_roster(session)\n    return {\"ok\": True, \"accounts\": count}\n\n\n",
    '''@router.get("/roster-status")
def roster_status(session: Session = Depends(core.get_session)) -> dict:
    count = sync_runtime_account_roster(session)
    return {"ok": True, "accounts": count}


@router.post("/games/register-steam/{app_id}")
def register_steam_app(
    app_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(core.get_session),
) -> dict:
    if app_id <= 0:
        raise HTTPException(400, "invalid Steam AppID")
    game, created = _register_provider_app(session, app_id)
    pending = is_placeholder_name(app_id, game.name)
    if pending:
        background_tasks.add_task(_enrich_provider_app, app_id)
    metadata_state = "pending" if pending else ("ready" if game.active else "filtered")
    return {
        "ok": True,
        "created": created,
        "metadata_state": metadata_state,
        "game": {
            "id": game.id,
            "app_id": game.app_id,
            "name": game.name,
            "active": game.active,
        },
    }


''',
)

onboard = ROOT / "apps/launcher/provider_account_onboard.py"
start = onboard.read_text(encoding="utf-8")
old_func_start = start.index("def _import_verified_games(")
old_func_end = start.index("\n\ndef _merge_family_inventory", old_func_start)
new_func = '''def _register_verified_apps(
    api: str, app_ids: list[int]
) -> tuple[list[int], list[int], list[int], list[int]]:
    """Register ownership immediately; metadata enrichment happens in the API."""
    registered_game_ids: list[int] = []
    unresolved_app_ids: list[int] = []
    pending_app_ids: list[int] = []
    ready_game_ids: list[int] = []
    base = api.rstrip("/")
    for app_id in sorted(set(app_ids)):
        try:
            registered = _api_json(
                "POST", f"{base}/admin/pool/games/register-steam/{app_id}", timeout=20.0
            )
        except Exception:
            unresolved_app_ids.append(app_id)
            continue
        game = registered.get("game") if isinstance(registered, dict) else None
        game_id = game.get("id") if isinstance(game, dict) else None
        if not isinstance(game_id, int) or game_id <= 0:
            unresolved_app_ids.append(app_id)
            continue
        registered_game_ids.append(game_id)
        state = str(registered.get("metadata_state") or "pending")
        if state == "pending":
            pending_app_ids.append(app_id)
        elif state == "ready":
            ready_game_ids.append(game_id)
    return registered_game_ids, unresolved_app_ids, pending_app_ids, ready_game_ids
'''
start = start[:old_func_start] + new_func + start[old_func_end:]
old_block = '''    print(f"STATE=metadata:{len(owned_app_ids)}", flush=True)
    game_ids, unresolved_app_ids = _import_verified_games(base, owned_app_ids)
    # AccountGame records which provider can access a game. Steam Family copy
    # counts continue to come from the separate license inventory.
    shared_game_ids, shared_unresolved = _import_verified_games(
        base, sorted(set(accessible_app_ids) - set(owned_app_ids))
    )
    unresolved_app_ids = sorted(set(unresolved_app_ids + shared_unresolved))
    game_ids = sorted(set(game_ids + shared_game_ids))
'''
new_block = '''    print(f"STATE=registering:{len(accessible_app_ids)}", flush=True)
    game_ids, unresolved_app_ids, pending_app_ids, ready_game_ids = _register_verified_apps(
        base, owned_app_ids
    )
    shared_game_ids, shared_unresolved, shared_pending, shared_ready = _register_verified_apps(
        base, sorted(set(accessible_app_ids) - set(owned_app_ids))
    )
    unresolved_app_ids = sorted(set(unresolved_app_ids + shared_unresolved))
    pending_app_ids = sorted(set(pending_app_ids + shared_pending))
    game_ids = sorted(set(game_ids + shared_game_ids))
    ready_game_ids = sorted(set(ready_game_ids + shared_ready))
'''
if old_block not in start:
    raise SystemExit("onboard metadata block anchor not found")
start = start.replace(old_block, new_block, 1)
start = start.replace(
    '            "imported_game_count": len(game_ids),\n            "imported_accessible_game_count": len(set(game_ids + shared_game_ids)),\n            "unresolved_app_count": len(unresolved_app_ids),\n',
    '            "registered_app_count": len(game_ids),\n            "metadata_ready_game_count": len(ready_game_ids),\n            "metadata_pending_count": len(pending_app_ids),\n            "metadata_enrichment": "server-background",\n            "unresolved_app_count": len(unresolved_app_ids),\n',
    1,
)
start = start.replace(
    '        "catalog_game_count": len(game_ids),\n        "accessible_catalog_game_count": len(set(game_ids + shared_game_ids)),\n',
    '        "registered_app_count": len(game_ids),\n        "catalog_game_count": len(ready_game_ids),\n        "accessible_catalog_game_count": len(ready_game_ids),\n        "metadata_pending_count": len(pending_app_ids),\n',
    1,
)
onboard.write_text(start, encoding="utf-8")

print("provider metadata split applied")
