from pathlib import Path

ROOT = Path(r"C:\DEV\gameAccess")


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


def write(path, text):
    (ROOT / path).write_text(text, encoding="utf-8", newline="\n")


path = "apps/launcher/pool_sync.py"
text = read(path)
old_import = """from provider_license_scan import (
    DEFAULT_DIAGNOSTIC_OUTPUT,
    DEFAULT_OUTPUT as LICENSE_OUTPUT,
    load_provider_license_inventory,
    persist_scan_result,
    scan_provider_licenses,
)
"""
new_import = """from provider_license_scan import persist_scan_result, scan_provider_licenses
from provider_ownership_store import ProviderOwnershipStore
"""
if old_import not in text:
    raise RuntimeError("pool_sync ownership import block not found")
text = text.replace(old_import, new_import, 1)
start = text.index("def _account_rows(")
end = text.index("def build_game_pool", start)
helper = """def _ownership_state_by_provider() -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    # Read durable per-provider ownership and latest scan health.
    state = ProviderOwnershipStore().states()
    verified_at = max(
        (
            str(row.get("ownership_verified_at") or "")
            for row in state.values()
            if row.get("ownership_verified_at")
        ),
        default="",
    ) or None
    errors = [
        {
            "provider_id": provider_id,
            "status": row.get("scan_status"),
            "error": row.get("scan_error") or row.get("scan_status"),
        }
        for provider_id, row in state.items()
        if str(row.get("scan_status") or "") not in {"", "ok", "not_scanned", "unknown"}
    ]
    return state, {
        "source": "per-provider-steamkit-ownership",
        "verified_at": verified_at,
        "verification_errors": errors,
        "latest_inventory_complete": bool(state)
        and all(bool(row.get("inventory_complete")) for row in state.values()),
    }


"""
text = text[:start] + helper + text[end:]
old_refresh = """    if refresh_licenses:
        refreshed = scan_provider_licenses(provider_ids=None)
        persist_scan_result(refreshed)
"""
new_refresh = """    if refresh_licenses:
        refreshed = scan_provider_licenses(provider_ids=None)
        ProviderOwnershipStore().record_scan(refreshed)
        persist_scan_result(refreshed)
"""
if old_refresh not in text:
    raise RuntimeError("pool_sync refresh block not found")
text = text.replace(old_refresh, new_refresh, 1)
write(path, text)

path = "apps/launcher/family_refresh.py"
text = read(path)
old = """from provider_license_scan import (
    DEFAULT_OUTPUT,
    compact_inventory,
    load_provider_license_inventory,
    persist_scan_result,
    scan_provider_licenses,
)
"""
new = """from provider_license_scan import compact_inventory, persist_scan_result, scan_provider_licenses
from provider_ownership_store import DEFAULT_STORE, ProviderOwnershipStore
"""
if old not in text:
    raise RuntimeError("family_refresh import block not found")
text = text.replace(old, new, 1)
old = """    persistence = persist_scan_result(inventory)

    # Per-account sync still updates every successful provider and disables failed
"""
new = """    ownership = ProviderOwnershipStore().record_scan(inventory)
    persistence = persist_scan_result(inventory)

    # Per-account sync still updates every successful provider and disables failed
"""
if old not in text:
    raise RuntimeError("family_refresh persistence block not found")
text = text.replace(old, new, 1)
old = """    baseline = load_provider_license_inventory(DEFAULT_OUTPUT, require_complete=True)
    cumulative = merge_family_evidence(
        baseline or {},
        inventory,
        DEFAULT_OUTPUT.with_name("provider_family_evidence.db"),
    )
"""
new = """    cumulative = merge_family_evidence(
        {},
        inventory,
        DEFAULT_STORE.with_name("provider_family_evidence.db"),
    )
"""
if old not in text:
    raise RuntimeError("family_refresh family baseline block not found")
text = text.replace(old, new, 1)
old = """        "inventory": compact_inventory(inventory),
        "persistence": persistence,
"""
new = """        "inventory": compact_inventory(inventory),
        "ownership": ownership,
        "persistence": persistence,
"""
if old not in text:
    raise RuntimeError("family_refresh return block not found")
text = text.replace(old, new, 1)
write(path, text)

path = "apps/launcher/provider_account_onboard.py"
text = read(path)
old = """from provider_license_scan import (
    DEFAULT_OUTPUT,
    load_provider_license_inventory,
    persist_scan_result,
    scan_provider_licenses,
)
"""
new = """from provider_license_scan import persist_scan_result, scan_provider_licenses
from provider_ownership_store import DEFAULT_STORE, ProviderOwnershipStore
"""
if old not in text:
    raise RuntimeError("provider_account_onboard import block not found")
text = text.replace(old, new, 1)
old = """    authoritative = load_provider_license_inventory(
        DEFAULT_OUTPUT, require_complete=True
    )
    return merge_family_evidence(
        authoritative or {},
        partial,
        DEFAULT_OUTPUT.with_name("provider_family_evidence.db"),
        selected={provider_id},
    )
"""
new = """    return merge_family_evidence(
        {},
        partial,
        DEFAULT_STORE.with_name("provider_family_evidence.db"),
        selected={provider_id},
    )
"""
if old not in text:
    raise RuntimeError("provider_account_onboard family merge block not found")
text = text.replace(old, new, 1)
old = """    inventory = scan_provider_licenses(
        provider_ids={credential.provider_id},
        timeout_seconds=timeout_seconds,
    )
    persist_scan_result(inventory)
"""
new = """    inventory = scan_provider_licenses(
        provider_ids={credential.provider_id},
        timeout_seconds=timeout_seconds,
    )
    ownership_update = ProviderOwnershipStore().record_scan(inventory)
    persist_scan_result(inventory)
"""
if old not in text:
    raise RuntimeError("provider_account_onboard scan block not found")
text = text.replace(old, new, 1)
old = """        "catalog_game_count": len(game_ids),
        "unresolved_app_count": len(unresolved_app_ids),
"""
new = """        "catalog_game_count": len(game_ids),
        "ownership_promoted": ownership_update["promoted"],
        "unresolved_app_count": len(unresolved_app_ids),
"""
if old not in text:
    raise RuntimeError("provider_account_onboard result block not found")
text = text.replace(old, new, 1)
write(path, text)

path = "apps/launcher/provider_incremental_sync.py"
text = read(path)
old = """from provider_license_scan import (
    DEFAULT_DIAGNOSTIC_OUTPUT,
    DEFAULT_OUTPUT,
    load_provider_license_inventory,
)
"""
new = """from provider_license_scan import DEFAULT_DIAGNOSTIC_OUTPUT, load_provider_license_inventory
from provider_ownership_store import DEFAULT_STORE, ProviderOwnershipStore
"""
if old not in text:
    raise RuntimeError("provider_incremental_sync import block not found")
text = text.replace(old, new, 1)
old = """    if not fresh:
        raise RuntimeError("No recent partial provider scan is available")

    fresh_accounts = _rows(fresh)
"""
new = """    if not fresh:
        raise RuntimeError("No recent partial provider scan is available")

    ownership_update = ProviderOwnershipStore().record_scan(fresh)
    fresh_accounts = _rows(fresh)
"""
if old not in text:
    raise RuntimeError("provider_incremental_sync fresh block not found")
text = text.replace(old, new, 1)
old = """    authoritative = (
        load_provider_license_inventory(DEFAULT_OUTPUT, require_complete=True) or {}
    )
    cumulative = merge_family_evidence(
        authoritative,
        fresh,
        DEFAULT_OUTPUT.with_name("provider_family_evidence.db"),
        selected={row["provider_id"] for row in providers},
    )
"""
new = """    cumulative = merge_family_evidence(
        {},
        fresh,
        DEFAULT_STORE.with_name("provider_family_evidence.db"),
        selected={row["provider_id"] for row in providers},
    )
"""
if old not in text:
    raise RuntimeError("provider_incremental_sync family block not found")
text = text.replace(old, new, 1)
old = """        "ok": True,
        "synced_provider_count": len(providers),
"""
new = """        "ok": True,
        "ownership_promoted": ownership_update["promoted"],
        "synced_provider_count": len(providers),
"""
if old not in text:
    raise RuntimeError("provider_incremental_sync return block not found")
text = text.replace(old, new, 1)
write(path, text)

test_path = ROOT / "apps/launcher/tests/test_provider_ownership_store.py"
test_path.write_text('''from __future__ import annotations

from provider_ownership_store import ProviderOwnershipStore


def snapshot(provider_id: str, app_ids: list[int], *, verified_at: str, status: str = "ok", complete: bool = True):
    return {
        "source": "steamkit-license-list-pics",
        "verified_at": verified_at,
        "accounts": [{"provider_id": provider_id, "owned_app_ids": app_ids, "scan_status": status}],
        "scans": [{"provider_id": provider_id, "status": status, "complete": complete}],
        "errors": [] if status == "ok" else [{"provider_id": provider_id, "error": status}],
    }


def test_success_replaces_only_that_provider_ownership(tmp_path) -> None:
    store = ProviderOwnershipStore(tmp_path / "ownership.db")
    store.record_scan(snapshot("provider-001", [10, 20], verified_at="2026-09-08T10:00:00+00:00"))
    store.record_scan(snapshot("provider-001", [20, 30], verified_at="2026-09-08T11:00:00+00:00"))
    state = store.states()["provider-001"]
    assert state["owned_app_ids"] == {20, 30}
    assert state["inventory_complete"] is True
    assert state["scan_status"] == "ok"


def test_failed_scan_preserves_last_verified_ownership(tmp_path) -> None:
    store = ProviderOwnershipStore(tmp_path / "ownership.db")
    store.record_scan(snapshot("provider-001", [10, 20], verified_at="2026-09-08T10:00:00+00:00"))
    store.record_scan(snapshot("provider-001", [], verified_at="2026-09-08T11:00:00+00:00", status="timeout", complete=False))
    state = store.states()["provider-001"]
    assert state["owned_app_ids"] == {10, 20}
    assert state["inventory_complete"] is True
    assert state["scan_status"] == "timeout"
    assert state["scan_error"] == "timeout"


def test_partial_batch_updates_success_without_erasing_other_provider(tmp_path) -> None:
    store = ProviderOwnershipStore(tmp_path / "ownership.db")
    store.record_scan(snapshot("provider-001", [10], verified_at="2026-09-08T10:00:00+00:00"))
    store.record_scan(snapshot("provider-002", [20, 30], verified_at="2026-09-08T11:00:00+00:00"))
    states = store.states()
    assert states["provider-001"]["owned_app_ids"] == {10}
    assert states["provider-002"]["owned_app_ids"] == {20, 30}
''', encoding="utf-8", newline="\n")

print("PATCH_OK")
