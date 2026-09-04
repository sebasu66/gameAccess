from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise RuntimeError(f"expected block not found in {path}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


program = ROOT / "tools" / "steamkit-license-scanner" / "Program.cs"
replace_once(
    program,
    "using SteamKit2.Authentication;\n",
    "using SteamKit2.Authentication;\nusing SteamKit2.Internal;\n",
)
replace_once(
    program,
    '        var steamApps = steamClient.GetHandler<SteamApps>() ?? throw new InvalidOperationException("SteamApps handler unavailable");\n',
    '        var steamApps = steamClient.GetHandler<SteamApps>() ?? throw new InvalidOperationException("SteamApps handler unavailable");\n        var unifiedMessages = steamClient.GetHandler<SteamUnifiedMessages>() ?? throw new InvalidOperationException("SteamUnifiedMessages handler unavailable");\n        var familyGroups = unifiedMessages.CreateService<FamilyGroups>();\n',
)
replace_once(
    program,
    '''            var licenses = licenseCallback.LicenseList\n                .Where(license => license.PackageID > 0)\n''',
    '''            var steamId64 = steamClient.SteamID?.ConvertToUInt64() ?? 0UL;\n            ulong familyGroupId = 0;\n            var isNotMemberOfAnyGroup = true;\n            ulong[] familyMemberSteamIds = steamId64 > 0 ? new[] { steamId64 } : Array.Empty<ulong>();\n            string? familyError = null;\n            try\n            {\n                var familyResponse = await familyGroups.GetFamilyGroupForUser(\n                    new CFamilyGroups_GetFamilyGroupForUser_Request\n                    {\n                        steamid = steamId64,\n                        include_family_group_response = true,\n                    }\n                );\n                if (familyResponse.Result == EResult.OK)\n                {\n                    var body = familyResponse.Body;\n                    familyGroupId = body.family_groupid;\n                    isNotMemberOfAnyGroup = body.is_not_member_of_any_group || familyGroupId == 0;\n                    if (!isNotMemberOfAnyGroup && body.family_group is not null)\n                    {\n                        familyMemberSteamIds = body.family_group.members\n                            .Select(member => member.steamid)\n                            .Where(id => id > 0)\n                            .Distinct()\n                            .Order()\n                            .ToArray();\n                    }\n                }\n                else\n                {\n                    familyError = familyResponse.Result.ToString();\n                }\n            }\n            catch (Exception familyException) when (!operationToken.IsCancellationRequested)\n            {\n                familyError = $"{familyException.GetType().Name}: {familyException.Message}";\n            }\n\n            var licenses = licenseCallback.LicenseList\n                .Where(license => license.PackageID > 0)\n''',
)
replace_once(
    program,
    '''                status = "ok",\n                login_id = loginId,\n                license_count = packageResults.Length,\n''',
    '''                status = "ok",\n                login_id = loginId,\n                steam_id64 = steamId64,\n                family_group_id = familyGroupId,\n                is_not_member_of_any_group = isNotMemberOfAnyGroup,\n                family_member_steam_ids = familyMemberSteamIds,\n                family_error = familyError,\n                license_count = packageResults.Length,\n''',
)

provider_scan = ROOT / "apps" / "launcher" / "provider_license_scan.py"
replace_once(provider_scan, "import argparse\n", "import argparse\nimport hashlib\n")
replace_once(
    provider_scan,
    '''    owner_provider_by_user32 = {\n        int(item["user_id32"]): item["provider_id"]\n        for item in mapping.get("accounts", [])\n        if isinstance(item.get("user_id32"), int)\n    }\n''',
    '''    owner_provider_by_user32 = {\n        int(item["user_id32"]): item["provider_id"]\n        for item in mapping.get("accounts", [])\n        if isinstance(item.get("user_id32"), int)\n    }\n    provider_by_steam64 = {\n        str(item["steam_id64"]): item["provider_id"]\n        for item in mapping.get("accounts", [])\n        if str(item.get("steam_id64") or "").isdigit()\n    }\n''',
)
replace_once(
    provider_scan,
    '''    unmapped_owner_ids: set[int] = set()\n\n    for credential in selected:\n''',
    '''    unmapped_owner_ids: set[int] = set()\n    family_key_by_provider: dict[str, str] = {}\n    family_members_by_provider: dict[str, list[str]] = {}\n\n    for credential in selected:\n''',
)
replace_once(
    provider_scan,
    '''        status = str(result.get("status") or "error")\n        packages = result.get("packages") if isinstance(result.get("packages"), list) else []\n        scan_summary = {\n''',
    '''        status = str(result.get("status") or "error")\n        packages = result.get("packages") if isinstance(result.get("packages"), list) else []\n        family_key = ""\n        family_member_provider_ids: list[str] = []\n        if status == "ok":\n            scanner_steam64 = str(result.get("steam_id64") or "")\n            if scanner_steam64.isdigit():\n                provider_by_steam64[scanner_steam64] = credential.provider_id\n            raw_family_id = result.get("family_group_id")\n            try:\n                family_group_id = int(raw_family_id or 0)\n            except (TypeError, ValueError):\n                family_group_id = 0\n            is_standalone = bool(result.get("is_not_member_of_any_group")) or family_group_id <= 0\n            if is_standalone:\n                family_key = f"standalone:{credential.provider_id}"\n                family_member_provider_ids = [credential.provider_id]\n            else:\n                digest = hashlib.sha256(f"steam-family:{family_group_id}".encode("utf-8")).hexdigest()[:24]\n                family_key = f"steam-family:{digest}"\n                family_member_provider_ids = sorted(\n                    {\n                        provider_by_steam64[str(steam_id)]\n                        for steam_id in result.get("family_member_steam_ids") or []\n                        if str(steam_id) in provider_by_steam64\n                    }\n                    | {credential.provider_id}\n                )\n            family_key_by_provider[credential.provider_id] = family_key\n            family_members_by_provider[credential.provider_id] = family_member_provider_ids\n\n        scan_summary = {\n''',
)
replace_once(
    provider_scan,
    '''            "unknown_package_count": len(result.get("unknown_package_ids") or []),\n        }\n''',
    '''            "unknown_package_count": len(result.get("unknown_package_ids") or []),\n            "family_grouped": bool(family_key and family_key.startswith("steam-family:")),\n            "family_member_count": len(family_member_provider_ids),\n            "family_error": str(result.get("family_error") or "")[:500] or None,\n        }\n''',
)
replace_once(
    provider_scan,
    '''            "scan_status": next(\n                (\n                    scan["status"]\n                    for scan in scans\n                    if scan["provider_id"] == credential.provider_id\n                ),\n                "not_scanned",\n            ),\n        }\n''',
    '''            "scan_status": next(\n                (\n                    scan["status"]\n                    for scan in scans\n                    if scan["provider_id"] == credential.provider_id\n                ),\n                "not_scanned",\n            ),\n            "family_key": family_key_by_provider.get(credential.provider_id, ""),\n            "family_member_provider_ids": family_members_by_provider.get(credential.provider_id, []),\n        }\n''',
)
replace_once(
    provider_scan,
    '''                "owned_game_count": len(account.get("owned_app_ids") or []),\n                "scan_status": account.get("scan_status"),\n''',
    '''                "owned_game_count": len(account.get("owned_app_ids") or []),\n                "scan_status": account.get("scan_status"),\n                "family_key": account.get("family_key"),\n                "family_member_count": len(account.get("family_member_provider_ids") or []),\n''',
)

family_refresh = ROOT / "apps" / "launcher" / "family_refresh.py"
family_refresh.write_text('''"""Full GameAccess provider refresh: SteamKit licenses + family graph + backend sync."""\nfrom __future__ import annotations\n\nimport argparse\nimport json\nfrom collections import defaultdict\nfrom typing import Any\n\nimport requests\n\nfrom pool_sync import build_game_pool, compact_pool, sync_backend\nfrom provider_license_scan import compact_inventory, persist_scan_result, scan_provider_licenses\nfrom provider_roster import load_provider_credentials\n\n\ndef build_family_graph(inventory: dict[str, Any]) -> list[dict[str, Any]]:\n    credentials = load_provider_credentials()\n    label_by_provider = {row.provider_id: row.label for row in credentials}\n    account_by_provider = {\n        str(row.get("provider_id")): row\n        for row in inventory.get("accounts") or []\n        if isinstance(row, dict)\n    }\n\n    discovered_members: dict[str, set[str]] = defaultdict(set)\n    family_by_provider: dict[str, str] = {}\n    for provider_id, row in account_by_provider.items():\n        family_key = str(row.get("family_key") or "").strip()\n        if not family_key:\n            continue\n        family_by_provider[provider_id] = family_key\n        discovered_members[family_key].add(provider_id)\n        discovered_members[family_key].update(\n            str(member) for member in row.get("family_member_provider_ids") or []\n            if str(member) in label_by_provider\n        )\n\n    # If one family member failed its own scan but another family member identified\n    # it, assign it to the discovered family. Its missing/disabled ownership does not\n    # create capacity until a later successful scan.\n    for family_key, members in list(discovered_members.items()):\n        for provider_id in members:\n            family_by_provider.setdefault(provider_id, family_key)\n\n    licenses_by_family: dict[str, dict[int, list[str]]] = defaultdict(lambda: defaultdict(list))\n    for provider_id, row in account_by_provider.items():\n        family_key = family_by_provider.get(provider_id)\n        if not family_key or str(row.get("scan_status") or "") != "ok":\n            continue\n        owner_label = label_by_provider.get(provider_id)\n        if not owner_label:\n            continue\n        for raw_app_id in set(row.get("owned_app_ids") or []):\n            try:\n                app_id = int(raw_app_id)\n            except (TypeError, ValueError):\n                continue\n            if app_id > 0:\n                licenses_by_family[family_key][app_id].append(owner_label)\n\n    result: list[dict[str, Any]] = []\n    for family_key in sorted(discovered_members):\n        members = sorted(\n            label_by_provider[provider_id]\n            for provider_id in discovered_members[family_key]\n            if provider_id in label_by_provider\n        )\n        licenses = [\n            {"app_id": app_id, "quantity": len(owner_labels), "owner_labels": sorted(owner_labels)}\n            for app_id, owner_labels in sorted(licenses_by_family.get(family_key, {}).items())\n        ]\n        result.append({"family_key": family_key, "members": members, "licenses": licenses})\n    return result\n\n\ndef refresh(*, api: str, timeout_seconds: int = 70) -> dict[str, Any]:\n    inventory = scan_provider_licenses(provider_ids=None, timeout_seconds=timeout_seconds)\n    persistence = persist_scan_result(inventory)\n\n    # Per-account sync still updates every successful provider and disables failed\n    # scans without erasing their prior ownership rows.\n    pool = build_game_pool(refresh_licenses=False)\n    backend = sync_backend(pool, api)\n\n    families = build_family_graph(inventory)\n    family_response = requests.post(\n        f"{api.rstrip('/')}/admin/pool/families/sync",\n        json={"families": families},\n        timeout=60,\n    )\n    family_response.raise_for_status()\n\n    return {\n        "ok": bool(inventory.get("successful_scan_count")),\n        "inventory": compact_inventory(inventory),\n        "persistence": persistence,\n        "pool": compact_pool(pool),\n        "backend": backend,\n        "families": {\n            "discovered": len(families),\n            "members": sum(len(family.get("members") or []) for family in families),\n            "license_copies": sum(\n                int(license_row.get("quantity") or 0)\n                for family in families\n                for license_row in family.get("licenses") or []\n            ),\n            "sync": family_response.json(),\n        },\n    }\n\n\ndef main() -> int:\n    parser = argparse.ArgumentParser(description="Refresh GameAccess Steam provider family/license graph")\n    parser.add_argument("--api", default="http://127.0.0.1:8000")\n    parser.add_argument("--timeout-seconds", type=int, default=70)\n    parser.add_argument("--compact", action="store_true")\n    args = parser.parse_args()\n    result = refresh(api=args.api, timeout_seconds=args.timeout_seconds)\n    if args.compact:\n        result["families"].pop("sync", None)\n    print(json.dumps(result, ensure_ascii=False))\n    inventory = result.get("inventory") or {}\n    if inventory.get("complete"):\n        return 0\n    return 2 if inventory.get("successful_scan_count") else 3\n\n\nif __name__ == "__main__":\n    raise SystemExit(main())\n''', encoding="utf-8")

admin_routes = ROOT / "apps" / "api" / "app" / "admin_console_routes.py"
replace_once(
    admin_routes,
    '''@router.post("/tools/pool-sync/start")\ndef start_pool_sync() -> dict:\n    script = LAUNCHER_ROOT / "pool_sync.py"\n    if not script.is_file():\n        raise HTTPException(500, "pool_sync.py not found")\n    argv = [str(launcher_python()), str(script), "--api", "http://127.0.0.1:8000", "--compact"]\n    try:\n        task = start_task("pool_sync", "Sincronizar pool Steam local", argv)\n    except Exception as exc:\n        raise HTTPException(500, f"No se pudo iniciar pool_sync: {exc}") from exc\n    return {"ok": True, "task": task}\n''',
    '''@router.post("/tools/pool-sync/start")\ndef start_pool_sync() -> dict:\n    script = LAUNCHER_ROOT / "family_refresh.py"\n    if not script.is_file():\n        raise HTTPException(500, "family_refresh.py not found")\n    argv = [str(launcher_python()), str(script), "--api", "http://127.0.0.1:8000", "--compact"]\n    try:\n        task = start_task("pool_sync", "Re-escanear Steam y reconstruir familias/licencias", argv)\n    except Exception as exc:\n        raise HTTPException(500, f"No se pudo iniciar family_refresh: {exc}") from exc\n    return {"ok": True, "task": task, "steamkit_rescan": True}\n''',
)

admin_html = ROOT / "apps" / "api" / "admin" / "index.html"
replace_once(
    admin_html,
    'onclick="refresh(true)">Actualizar</button>',
    'onclick="startFullUpdate()">Actualizar pool</button>',
)
replace_once(
    admin_html,
    '''  async function startPoolSync(){try{await api('/tools/pool-sync/start',{method:'POST',body:'{}'});toast('Sincronización iniciada');go('tools');await refresh()}catch(err){toast(err.message,true)}}\n''',
    '''  async function startFullUpdate(){try{await api('/tools/pool-sync/start',{method:'POST',body:'{}'});toast('Re-scan SteamKit iniciado · familias y licencias se actualizarán al terminar');go('tools');await refresh()}catch(err){toast(err.message,true)}}\n  async function startPoolSync(){return startFullUpdate()}\n''',
)

print("family rescan integration patch applied")
