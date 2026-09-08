from pathlib import Path

R = Path(__file__).resolve().parents[2]


def load(path: str) -> str:
    return (R / path).read_text(encoding="utf-8")


def save(path: str, text: str) -> None:
    (R / path).write_text(text, encoding="utf-8")


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"missing anchor: {label}")
    return text.replace(old, new, 1)


# Persist per-seat launch entitlements from licenses_print separately from original ownership.
path = "apps/launcher/steam_verified_inventory.py"
text = load(path)
text = replace_once(
    text,
    "    owner_apps_raw: dict[int, set[int]] = {}\n    scanned_seats: list[dict[str, Any]] = []\n",
    "    owner_apps_raw: dict[int, set[int]] = {}\n    seat_apps_raw: dict[int, set[int]] = {}\n    scanned_seats: list[dict[str, Any]] = []\n",
    "seat app map",
)
text = replace_once(
    text,
    '            owner_ids_seen: set[int] = set()\n            for record in scan.pop("records"):\n                owner = record.original_owner_user_id32 if record.borrowed else user_id\n                if owner is None:\n                    continue\n                owner_ids_seen.add(owner)\n                owner_apps_raw.setdefault(owner, set()).update(record.apps)\n            scan["owners_seen"] = sorted(owner_ids_seen)\n            scan["ok"] = True\n            scanned_seats.append(scan)\n',
    '            records = scan.pop("records")\n            seat_apps_raw.setdefault(user_id, set()).update(\n                app_id for record in records for app_id in record.apps\n            )\n            owner_ids_seen: set[int] = set()\n            for record in records:\n                owner = record.original_owner_user_id32 if record.borrowed else user_id\n                if owner is None:\n                    continue\n                owner_ids_seen.add(owner)\n                owner_apps_raw.setdefault(owner, set()).update(record.apps)\n            scan["owners_seen"] = sorted(owner_ids_seen)\n            scan["ok"] = True\n            scanned_seats.append(scan)\n',
    "retain seat records",
)
text = replace_once(
    text,
    '    all_app_ids = {app_id for apps in owner_apps_raw.values() for app_id in apps}\n    catalog = _windows_game_catalog(all_app_ids)\n    windows_ids = set(catalog)\n    owner_apps = {\n        owner: {app_id for app_id in apps if app_id in windows_ids}\n        for owner, apps in owner_apps_raw.items()\n    }\n\n    owners: list[dict[str, Any]] = []\n',
    '    all_app_ids = (\n        {app_id for apps in owner_apps_raw.values() for app_id in apps}\n        | {app_id for apps in seat_apps_raw.values() for app_id in apps}\n    )\n    catalog = _windows_game_catalog(all_app_ids)\n    windows_ids = set(catalog)\n    owner_apps = {\n        owner: {app_id for app_id in apps if app_id in windows_ids}\n        for owner, apps in owner_apps_raw.items()\n    }\n    seat_apps = {\n        seat: {app_id for app_id in apps if app_id in windows_ids}\n        for seat, apps in seat_apps_raw.items()\n    }\n    for scan in scanned_seats:\n        user_id = int(scan["seat_user_id32"])\n        runnable = sorted(seat_apps.get(user_id, set()))\n        scan["runnable_app_ids"] = runnable\n        scan["runnable_game_count"] = len(runnable)\n\n    owners: list[dict[str, Any]] = []\n',
    "filter runnable games",
)
save(path, text)


# Local pool keeps physical/original ownership and verified runnable seats separate.
path = "apps/launcher/steam_pool.py"
text = load(path)
text = replace_once(
    text,
    "    app_ids: list[int]\n    accessible_app_ids: list[int]\n",
    "    app_ids: list[int]\n    runnable_app_ids: list[int]\n    runnable_verified: bool\n    runnable_verified_at: str | None\n    accessible_app_ids: list[int]\n",
    "pool account runnable fields",
)
text = replace_once(
    text,
    '        "owner_apps": {},\n        "scanned_user_ids": set(),\n        "error": None,\n',
    '        "owner_apps": {},\n        "scanned_user_ids": set(),\n        "runnable_apps": {},\n        "runnable_user_ids": set(),\n        "error": None,\n',
    "cache runnable defaults",
)
text = replace_once(
    text,
    '    owner_apps: dict[int, set[int]] = {}\n    scanned_user_ids: set[int] = set()\n    for seat in data.get("scanned_seats") or []:\n        if not isinstance(seat, dict) or not seat.get("ok"):\n            continue\n        raw_user = seat.get("seat_user_id32")\n        try:\n            user_id = int(raw_user)\n        except (TypeError, ValueError):\n            continue\n        if user_id > 0:\n            scanned_user_ids.add(user_id)\n',
    '    owner_apps: dict[int, set[int]] = {}\n    scanned_user_ids: set[int] = set()\n    runnable_apps: dict[int, set[int]] = {}\n    runnable_user_ids: set[int] = set()\n    for seat in data.get("scanned_seats") or []:\n        if not isinstance(seat, dict) or not seat.get("ok"):\n            continue\n        try:\n            user_id = int(seat.get("seat_user_id32"))\n        except (TypeError, ValueError):\n            continue\n        if user_id <= 0:\n            continue\n        scanned_user_ids.add(user_id)\n        if "runnable_app_ids" in seat:\n            runnable_apps[user_id] = {\n                int(app_id)\n                for app_id in seat.get("runnable_app_ids") or []\n                if str(app_id).isdigit() and int(app_id) > 0\n            }\n            runnable_user_ids.add(user_id)\n',
    "parse seat runnable cache",
)
text = replace_once(
    text,
    '            "owner_apps": owner_apps,\n            "scanned_user_ids": scanned_user_ids,\n        }\n',
    '            "owner_apps": owner_apps,\n            "scanned_user_ids": scanned_user_ids,\n            "runnable_apps": runnable_apps,\n            "runnable_user_ids": runnable_user_ids,\n        }\n',
    "cache runnable result",
)
text = replace_once(
    text,
    '    owner_apps: dict[int, set[int]] = verified["owner_apps"]\n    verified_users: set[int] = verified["scanned_user_ids"]\n    scanned: list[SteamPoolAccount] = []\n',
    '    owner_apps: dict[int, set[int]] = verified["owner_apps"]\n    verified_users: set[int] = verified["scanned_user_ids"]\n    runnable_apps: dict[int, set[int]] = verified.get("runnable_apps") or {}\n    runnable_users: set[int] = verified.get("runnable_user_ids") or set()\n    scanned: list[SteamPoolAccount] = []\n',
    "scan runnable maps",
)
text = replace_once(
    text,
    '        ownership_verified = isinstance(user_id, int) and user_id in verified_users\n        owned_ids = sorted(owner_apps.get(user_id, set())) if ownership_verified else []\n        ok = bool(user_id) and bool(accessible_ids or owned_ids)\n',
    '        ownership_verified = isinstance(user_id, int) and user_id in verified_users\n        owned_ids = sorted(owner_apps.get(user_id, set())) if ownership_verified else []\n        runnable_verified = isinstance(user_id, int) and user_id in runnable_users\n        runnable_set = set(runnable_apps.get(user_id, set())) if runnable_verified else set()\n        # Backward-compatible safe fallback: a verified original owner can run its own license.\n        if ownership_verified:\n            runnable_set.update(owned_ids)\n        runnable_ids = sorted(runnable_set)\n        runnable_verified = runnable_verified or bool(ownership_verified and owned_ids)\n        ok = bool(user_id) and bool(accessible_ids or owned_ids or runnable_ids)\n',
    "compute runnable seats",
)
text = replace_once(
    text,
    '                app_ids=owned_ids,\n                accessible_app_ids=accessible_ids,\n',
    '                app_ids=owned_ids,\n                runnable_app_ids=runnable_ids,\n                runnable_verified=runnable_verified,\n                runnable_verified_at=verified["verified_at"] if runnable_verified else None,\n                accessible_app_ids=accessible_ids,\n',
    "emit runnable fields",
)
text = replace_once(
    text,
    '    verified_account_count = sum(1 for item in scanned if item.ownership_verified)\n    return {\n',
    '    verified_account_count = sum(1 for item in scanned if item.ownership_verified)\n    runnable_account_count = sum(1 for item in scanned if item.runnable_verified)\n    return {\n',
    "runnable account count",
)
text = replace_once(
    text,
    '        "verified_account_count": verified_account_count,\n    }\n',
    '        "verified_account_count": verified_account_count,\n        "runnable_account_count": runnable_account_count,\n    }\n',
    "return runnable count",
)
text = replace_once(
    text,
    '                "owned_app_count": len(item.get("app_ids") or []),\n                "accessible_app_count": len(item.get("accessible_app_ids") or []),\n',
    '                "owned_app_count": len(item.get("app_ids") or []),\n                "runnable_app_count": len(item.get("runnable_app_ids") or []),\n                "runnable_verified": item.get("runnable_verified", False),\n                "accessible_app_count": len(item.get("accessible_app_ids") or []),\n',
    "compact runnable fields",
)
save(path, text)


# Native bridge passes verified runnable candidates to the desktop.
path = "apps/desktop/src-tauri/src/native_core.rs"
text = load(path)
text = replace_once(
    text,
    "p=scan_pool(); ids=set(); [ids.update(a.get('accessible_app_ids') or []) or ids.update(a.get('app_ids') or []) for a in p.get('accounts',[])];",
    "p=scan_pool(); ids=set(); [ids.update(a.get('accessible_app_ids') or []) or ids.update(a.get('runnable_app_ids') or []) or ids.update(a.get('app_ids') or []) for a in p.get('accounts',[])];",
    "native catalog ids",
)
text = replace_once(
    text,
    "'app_ids':[x for x in (a.get('app_ids') or []) if x in valid],'accessible_app_ids':",
    "'app_ids':[x for x in (a.get('app_ids') or []) if x in valid],'runnable_app_ids':[x for x in (a.get('runnable_app_ids') or []) if x in valid],'runnable_verified':bool(a.get('runnable_verified')),'runnable_verified_at':a.get('runnable_verified_at'),'accessible_app_ids':",
    "native runnable fields",
)
text = replace_once(
    text,
    "'verified_account_count':int(p.get('verified_account_count') or 0),'accounts':accounts",
    "'verified_account_count':int(p.get('verified_account_count') or 0),'runnable_account_count':int(p.get('runnable_account_count') or 0),'accounts':accounts",
    "native runnable count",
)
save(path, text)


path = "apps/desktop/src/native.ts"
text = load(path)
text = replace_once(
    text,
    "  app_ids: number[];\n  accessible_app_ids: number[];\n",
    "  app_ids: number[];\n  runnable_app_ids?: number[];\n  runnable_verified?: boolean;\n  runnable_verified_at?: string | null;\n  accessible_app_ids: number[];\n",
    "typescript runnable account fields",
)
text = replace_once(
    text,
    "  verified_account_count?: number;\n  accounts: LocalSteamAccount[];\n",
    "  verified_account_count?: number;\n  runnable_account_count?: number;\n  accounts: LocalSteamAccount[];\n",
    "typescript runnable count",
)
save(path, text)


# Build local availability from verified run entitlement, not original ownership.
path = "apps/desktop/src/catalog.ts"
text = load(path)
start = text.index("export function buildLocalCatalog")
end = text.index("export function mergeCatalog", start)
block = '''export function buildLocalCatalog(pool: LocalSteamPool): CatalogGame[] {
  const accounts = pool.accounts ?? [];
  const decisions: string[] = [];
  const catalog = (pool.games ?? []).flatMap((item): CatalogGame[] => {
    const owners = accounts
      .filter((account) => account.ownership_verified === true && account.app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const runnable = accounts
      .filter((account) =>
        (account.runnable_verified === true && (account.runnable_app_ids ?? []).includes(item.app_id))
        || (account.ownership_verified === true && account.app_ids.includes(item.app_id)))
      .sort((left, right) => Number(right.active) - Number(left.active));
    const visible = accounts
      .filter((account) => account.accessible_app_ids.includes(item.app_id))
      .sort((left, right) => Number(right.active) - Number(left.active));

    if (!owners.length && !runnable.length && !visible.length) return [];

    const ownerLabels = owners.map((account) => account.account_name || account.label);
    const runnableLabels = runnable.map((account) => account.account_name || account.label);
    const visibleLabels = visible.map((account) => account.account_name || account.label);
    decisions.push(
      `${item.name} (Steam AppID ${item.app_id}). Visible accounts: ${visibleLabels.join(", ") || "none"}. Original owners: ${ownerLabels.join(", ") || "none"}. Verified runnable accounts (owned or Family-borrowed): ${runnableLabels.join(", ") || "none"}. Decision: ${runnable.length ? "AVAILABLE locally." : "NOT AVAILABLE locally; visibility alone is not enough."}`,
    );

    // Runnable seats can share one physical Family license, so local availability
    // is binary unless we also know multiple original-owner copies.
    const copiesTotal = Math.max(owners.length, runnable.length ? 1 : 0);
    const copiesAvailable = runnable.length ? Math.max(owners.length, 1) : 0;
    return [{
      id: item.app_id,
      slug: `steam-${item.app_id}`,
      name: item.name,
      app_id: item.app_id,
      credit_cost_per_hour: 0,
      copies_total: copiesTotal,
      copies_available: copiesAvailable,
      availability_state: runnable.length ? "ready" : "unavailable",
      local_account_labels: runnableLabels,
      local_access_labels: visibleLabels,
      local_primary_account_label: runnable[0]?.account_name || runnable[0]?.label,
      local_owner_steam_ids: owners.map((account) => account.steam_id64).filter((value): value is string => Boolean(value)),
      local_inventory_verified: runnable.length > 0,
      local_inventory_verified_at: pool.verified_at,
      ...steamAssets(item.app_id),
    }];
  });

  void narrateBatch(decisions, { area: "AVAILABILITY" });
  return catalog;
}

export function mergeLocalWithBackendCatalog(local: CatalogGame[], remote: CatalogGame[]): CatalogGame[] {
  const byApp = new Map<number, CatalogGame>();
  for (const game of remote) if (game.app_id) byApp.set(game.app_id, game);
  return local.map((localGame) => {
    const server = localGame.app_id ? byApp.get(localGame.app_id) : undefined;
    if (!server) return localGame;
    const localRunnable = Boolean(localGame.local_primary_account_label) && localGame.copies_available > 0;
    return {
      ...localGame,
      id: server.id,
      backend_game_id: server.id,
      remote_copies_total: server.copies_total,
      remote_copies_available: server.copies_available,
      credit_cost_per_hour: localRunnable ? localGame.credit_cost_per_hour : server.credit_cost_per_hour,
      copies_total: localRunnable ? localGame.copies_total : server.copies_total,
      copies_available: localRunnable ? localGame.copies_available : server.copies_available,
      availability_state: localRunnable
        ? "ready"
        : (server.availability_state ?? (server.copies_available > 0 ? "ready" : server.copies_total > 0 ? "owned-busy" : "unavailable")),
    };
  });
}

'''
text = text[:start] + block + text[end:]
save(path, text)


path = "apps/desktop/src/types.ts"
text = load(path)
text = replace_once(
    text,
    "  local_inventory_verified_at?: string | null;\n}\n",
    "  local_inventory_verified_at?: string | null;\n  backend_game_id?: number;\n  remote_copies_total?: number;\n  remote_copies_available?: number;\n}\n",
    "backend route metadata",
)
save(path, text)


# In Local mode, overlay a matching backend route. At play time, local is first,
# then backend; only fail when neither route exists.
path = "apps/desktop/src/api.ts"
text = load(path)
text = replace_once(
    text,
    'import { buildLocalCatalog } from "./catalog";',
    'import { buildLocalCatalog, mergeLocalWithBackendCatalog } from "./catalog";',
    "catalog import",
)
text = replace_once(
    text,
    '    const games = await loadLocalCatalog();\n    let user: UserSummary = { id: 1, username: "local", credits: 0 };\n    if (api) {\n      try { user = await request<UserSummary>("/users/1"); }\n      catch { await narrate("The server user profile could not be loaded, but the private/local library can continue independently.", { area: "BACKEND", level: "WARN" }); }\n    }\n    return { games, user, offlineDemo: false };\n',
    '    let games = await loadLocalCatalog();\n    let user: UserSummary = { id: 1, username: "local", credits: 0 };\n    if (api) {\n      try {\n        const [remoteGames, remoteUser] = await Promise.all([\n          request<CatalogGame[]>("/catalog"),\n          request<UserSummary>("/users/1").catch(() => user),\n        ]);\n        games = mergeLocalWithBackendCatalog(games, remoteGames);\n        localCatalog = games;\n        user = remoteUser;\n        await narrate("Availability uses a verified local runnable route first, then a matching backend provider route.", { area: "AVAILABILITY" });\n      } catch {\n        await narrate("Backend catalog unavailable; keeping local routes only.", { area: "BACKEND", level: "WARN" });\n      }\n    }\n    return { games, user, offlineDemo: false };\n',
    "local backend overlay",
)
old = '''  const game = getCatalogMode() === "local"
    ? localCatalog.find((item) => item.id === gameId)
    : undefined;

  if (game) {
    const configured = game.local_primary_account_label ?? game.local_account_labels?.[0];
    if (!configured) {
      await narrate(
        `${game.name}: local play was refused because no local owner candidate is configured. Being visible through Steam access is not enough.`,
        { area: "AVAILABILITY", level: "WARN" },
      );
      throw new Error("No hay una cuenta Steam local verificada que pueda abrir este juego.");
    }
    await narrate(`${game.name}: local rule selected remembered Steam account '${configured}'. Switching to that account before launch.`, { area: "ACCOUNT" });
    await switchSteamAccount(configured);
    const now = Date.now();
    await narrate(`${game.name}: local account switch completed. The local launch route is ready.`, { area: "LAUNCH" });
    return {
      lease_id: now,
      game: { id: game.id, name: game.name, app_id: game.app_id },
      account: { id: 0, label: "local", provider: "steam" },
      credits_spent: 0,
      credits_remaining: 0,
      starts_at: new Date(now).toISOString(),
      expires_at: new Date(now + minutes * 60_000).toISOString(),
      session_action: "launch_ready",
    };
  }

'''
new = '''  const game = getCatalogMode() === "local"
    ? localCatalog.find((item) => item.id === gameId)
    : undefined;
  let backendGameId = gameId;

  if (game) {
    const configured = game.local_primary_account_label ?? game.local_account_labels?.[0];
    if (configured) {
      try {
        await narrate(`${game.name}: trying verified local runnable account '${configured}'.`, { area: "ACCOUNT" });
        await switchSteamAccount(configured);
        const now = Date.now();
        return {
          lease_id: now,
          game: { id: game.id, name: game.name, app_id: game.app_id },
          account: { id: 0, label: configured, provider: "steam" },
          credits_spent: 0,
          credits_remaining: 0,
          starts_at: new Date(now).toISOString(),
          expires_at: new Date(now + minutes * 60_000).toISOString(),
          session_action: "launch_ready",
        };
      } catch (error) {
        if (!game.backend_game_id) throw error;
        await narrate(`${game.name}: local route failed; trying the backend route.`, { area: "AVAILABILITY", level: "WARN" });
      }
    }
    if (!game.backend_game_id) {
      await narrate(`${game.name}: no local runnable account and no backend route.`, { area: "AVAILABILITY", level: "WARN" });
      throw new Error("No hay ninguna cuenta local ni remota que pueda ejecutar este juego.");
    }
    backendGameId = game.backend_game_id;
  }

'''
text = replace_once(text, old, new, "local play fallback")
text = replace_once(
    text,
    "body: JSON.stringify({ user_id: 1, game_id: gameId, minutes, replace_existing: true }),",
    "body: JSON.stringify({ user_id: 1, game_id: backendGameId, minutes, replace_existing: true }),",
    "backend game id",
)
save(path, text)


# Regression coverage: Family-runnable does not imply original ownership.
path = "apps/launcher/tests/test_steam_pool_verified_ownership.py"
text = load(path)
if "test_verified_family_runnable_access_is_not_counted_as_owned" not in text:
    text += '''


def test_verified_family_runnable_access_is_not_counted_as_owned(monkeypatch) -> None:
    app_id = 244210
    monkeypatch.setattr(pool, "active_user_id32", lambda: 202)
    monkeypatch.setattr(pool, "remembered_account_identities", lambda: [_identity(202, "family")])
    monkeypatch.setattr(pool, "local_library_apps", lambda user_id: {app_id: {}})
    monkeypatch.setattr(pool, "local_ticketed_apps", lambda user_id: set())
    monkeypatch.setattr(
        pool,
        "load_verified_owner_cache",
        lambda: {
            "available": True,
            "complete": True,
            "verified_at": "2026-09-08T00:00:00Z",
            "source": "steam-console-licenses-print-cache",
            "owner_apps": {},
            "scanned_user_ids": {202},
            "runnable_apps": {202: {app_id}},
            "runnable_user_ids": {202},
            "error": None,
        },
    )

    account = pool.scan_pool()["accounts"][0]
    assert account["app_ids"] == []
    assert account["runnable_app_ids"] == [app_id]
    assert account["runnable_verified"] is True
'''
save(path, text)


path = "apps/desktop/src/catalog.test.ts"
text = load(path)
text = text.replace(
    'import { buildLocalCatalog, mergeCatalog } from "./catalog";',
    'import { buildLocalCatalog, mergeCatalog, mergeLocalWithBackendCatalog } from "./catalog";',
    1,
)
if "uses a verified Family runnable seat" not in text:
    marker = '\n});\n\ndescribe("mergeCatalog",'
    addition = '''

  it("uses a verified Family runnable seat without requiring original ownership", () => {
    const familyPool: LocalSteamPool = {
      source: "steam-console-licenses-print",
      verification_complete: true,
      verified_at: "now",
      games: [{ app_id: 244210, name: "Assetto Corsa" }],
      accounts: [{
        label: "family",
        account_name: "family",
        app_ids: [],
        runnable_app_ids: [244210],
        runnable_verified: true,
        accessible_app_ids: [244210],
        active: false,
      }],
    };
    expect(buildLocalCatalog(familyPool)[0]).toMatchObject({
      copies_available: 1,
      availability_state: "ready",
      local_primary_account_label: "family",
    });
  });
'''
    if marker not in text:
        raise RuntimeError("missing catalog test describe marker")
    text = text.replace(marker, addition + marker, 1)
if 'describe("mergeLocalWithBackendCatalog"' not in text:
    text += '''


describe("mergeLocalWithBackendCatalog", () => {
  it("uses backend availability when local has no runnable route", () => {
    const remote: CatalogGame[] = [{ id: 77, slug: "remote", name: "Family Game", app_id: 20, credit_cost_per_hour: 1, copies_total: 2, copies_available: 1, availability_state: "ready" }];
    const game = mergeLocalWithBackendCatalog(buildLocalCatalog(pool), remote).find((item) => item.app_id === 20);
    expect(game).toMatchObject({ id: 77, backend_game_id: 77, copies_available: 1, availability_state: "ready" });
  });
});
'''
save(path, text)

print("PATCH_OK")
