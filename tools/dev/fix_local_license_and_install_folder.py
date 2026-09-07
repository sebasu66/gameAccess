from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _variant(text: str, newline: bytes) -> bytes:
    if newline == b"\r\n":
        text = text.replace("\n", "\r\n")
    return text.encode("utf-8")


def replace_once(relative: str, old: str, new: str) -> bool:
    path = ROOT / relative
    raw = path.read_bytes()
    newline = b"\r\n" if raw.count(b"\r\n") > 0 else b"\n"
    old_bytes = _variant(old, newline)
    new_bytes = _variant(new, newline)
    old_count = raw.count(old_bytes)
    new_count = raw.count(new_bytes)
    if old_count == 0 and new_count >= 1:
        return False
    if old_count != 1:
        raise RuntimeError(f"Expected exactly one match in {relative}, found {old_count}")
    path.write_bytes(raw.replace(old_bytes, new_bytes, 1))
    return True


def apply() -> list[str]:
    changed: list[str] = []

    def patch(relative: str, old: str, new: str) -> None:
        if replace_once(relative, old, new):
            changed.append(relative)

    patch(
        "apps/desktop/src/catalog.ts",
        """    const launchAccounts = owners.length ? owners : accessible;\n    if (!launchAccounts.length) return [];\n""",
        """    if (!owners.length && !accessible.length) return [];\n""",
    )
    patch(
        "apps/desktop/src/catalog.ts",
        '      availability_state: "ready",',
        '      availability_state: owners.length ? "ready" : "unavailable",',
    )
    patch(
        "apps/desktop/src/catalog.ts",
        "      local_primary_account_label: launchAccounts[0].account_name || launchAccounts[0].label,",
        "      local_primary_account_label: owners[0]?.account_name || owners[0]?.label,",
    )

    patch(
        "apps/desktop/src/LibraryRoomParts.tsx",
        """function InstallStateBadge({ status }: { status?: ManagedDownloadStatus }) {\n  if (!isInstalled(status)) return null;\n  return <span className=\"library-install-state ready\" title=\"Listo para jugar\"><Play size={12} fill=\"currentColor\" /></span>;\n}\n""",
        """function InstallStateBadge({ game, status }: { game: CatalogGame; status?: ManagedDownloadStatus }) {\n  if (!isInstalled(status)) return null;\n  const availability = playAvailability(game);\n  if (!availability.licensed) {\n    return <span className=\"library-install-state no-license\" title=\"Instalado · sin licencia disponible\"><XCircle size={13} /></span>;\n  }\n  return <span className=\"library-install-state ready\" title=\"Listo para jugar\"><Play size={12} fill=\"currentColor\" /></span>;\n}\n""",
    )
    patch(
        "apps/desktop/src/LibraryRoomParts.tsx",
        "<InstallStateBadge status={game.app_id ? props.downloads[game.app_id] : undefined} />",
        "<InstallStateBadge game={game} status={game.app_id ? props.downloads[game.app_id] : undefined} />",
    )

    patch(
        "apps/desktop/src/DownloadCatalogPanel.tsx",
        'import { Archive, FolderOpen, Gamepad2, Loader2, Play, Trash2 } from "lucide-react";',
        'import { Archive, FolderOpen, Gamepad2, Loader2, Play, Trash2, XCircle } from "lucide-react";',
    )
    patch(
        "apps/desktop/src/DownloadCatalogPanel.tsx",
        'import { downloadProgress, isTrackedDownload } from "./downloadManager";\n',
        'import { downloadProgress, isTrackedDownload } from "./downloadManager";\nimport { playAvailability } from "./gameAvailability";\n',
    )
    patch(
        "apps/desktop/src/DownloadCatalogPanel.tsx",
        """function ReadyBadge() {\n  return <span className=\"library-install-state ready\" title=\"Instalado\"><Play size={12} fill=\"currentColor\" /></span>;\n}\n""",
        """function ReadyBadge({ licensed }: { licensed: boolean }) {\n  if (!licensed) {\n    return <span className=\"library-install-state no-license\" title=\"Instalado · sin licencia disponible\"><XCircle size={13} /></span>;\n  }\n  return <span className=\"library-install-state ready\" title=\"Listo para jugar\"><Play size={12} fill=\"currentColor\" /></span>;\n}\n""",
    )
    patch(
        "apps/desktop/src/DownloadCatalogPanel.tsx",
        """  const active = isTrackedDownload(status);\n  const ready = Boolean(status?.installed || status?.state === \"installed\");\n  const progress = downloadProgress(status);\n""",
        """  const active = isTrackedDownload(status);\n  const ready = Boolean(status?.installed || status?.state === \"installed\");\n  const licensed = playAvailability(game).licensed;\n  const progress = downloadProgress(status);\n""",
    )
    patch(
        "apps/desktop/src/DownloadCatalogPanel.tsx",
        "{ready ? <ReadyBadge /> : null}",
        "{ready ? <ReadyBadge licensed={licensed} /> : null}",
    )

    patch(
        "apps/desktop/src/library-room.css",
        ".library-install-state.ready { color: #071405; background: rgba(57,255,20,.94); box-shadow: 0 0 16px rgba(57,255,20,.42), 0 5px 15px rgba(0,0,0,.42); }",
        ".library-install-state.ready { color: #071405; background: rgba(57,255,20,.94); box-shadow: 0 0 16px rgba(57,255,20,.42), 0 5px 15px rgba(0,0,0,.42); }\n.library-install-state.no-license { color: #fff4d6; background: rgba(164,92,12,.94); border-color: rgba(255,200,92,.62); box-shadow: 0 0 14px rgba(255,151,38,.24), 0 5px 15px rgba(0,0,0,.42); }",
    )

    patch(
        "apps/desktop/src/catalog.test.ts",
        """    expect(game).toMatchObject({ copies_total: 0, copies_available: 0, local_primary_account_label: \"owner\" });\n    expect(game?.local_account_labels).toEqual([]);\n    expect(game?.local_access_labels).toEqual([\"owner\", \"second\"]);\n""",
        """    expect(game).toMatchObject({ copies_total: 0, copies_available: 0, availability_state: \"unavailable\" });\n    expect(game?.local_account_labels).toEqual([]);\n    expect(game?.local_access_labels).toEqual([\"owner\", \"second\"]);\n    expect(game?.local_primary_account_label).toBeUndefined();\n""",
    )
    patch(
        "apps/desktop/src/LibraryRoom.test.tsx",
        """  it(\"shows the green installation marker whenever the game is installed\", () => {\n    expect(render({ 10: installed })).toContain(\"library-install-state ready\");\n    expect(render({ 10: installed }, 0)).toContain(\"library-install-state ready\");\n  });\n""",
        """  it(\"distinguishes installed games with and without a playable license\", () => {\n    expect(render({ 10: installed })).toContain(\"library-install-state ready\");\n    const withoutLicense = render({ 10: installed }, 0);\n    expect(withoutLicense).toContain(\"library-install-state no-license\");\n    expect(withoutLicense).toContain(\"sin licencia disponible\");\n    expect(withoutLicense).not.toContain(\"library-install-state ready\");\n  });\n""",
    )
    patch(
        "apps/desktop/src/DownloadCatalogPanel.test.tsx",
        """  it(\"keeps the card as a selection target so Enter can transfer focus to the existing detail panel\", () => {\n""",
        """  it(\"marks an installed game without a license as unavailable instead of ready\", () => {\n    const markup = renderToStaticMarkup(\n      <DownloadCatalogPanel\n        games={[{ ...game, copies_total: 0, copies_available: 0 }]}\n        downloads={{ 42: installed }}\n        accountCount={1}\n        selectedIndex={0}\n        gridRef={createRef<HTMLDivElement>()}\n        pinnedAppIds={new Set()}\n        onSelect={() => undefined}\n      />,\n    );\n    expect(markup).toContain(\"library-install-state no-license\");\n    expect(markup).toContain(\"sin licencia disponible\");\n    expect(markup).not.toContain(\"library-install-state ready\");\n  });\n\n  it(\"keeps the card as a selection target so Enter can transfer focus to the existing detail panel\", () => {\n""",
    )

    patch(
        "apps/desktop/src/App.tsx",
        """    if ((game.local_access_labels?.length || game.local_account_labels?.length) && game.app_id) {\n      const trace = [`Requested AppID = ${game.app_id}`, `Searching verified license-owner mapping for AppID ${game.app_id}`];\n      try {\n""",
        """    if ((game.local_access_labels?.length || game.local_account_labels?.length) && game.app_id) {\n      const trace = [`Requested AppID = ${game.app_id}`, `Searching verified license-owner mapping for AppID ${game.app_id}`];\n      if (!game.local_account_labels?.length || !game.local_primary_account_label) {\n        trace.push(`No verified owner is available for AppID ${game.app_id}`);\n        setSession({ game, phase: \"error\", title: \"Sin licencia disponible\", detail: \"El juego está instalado o visible en Steam, pero ninguna cuenta local verificada posee una licencia utilizable.\", log: trace });\n        setLeaseBusy(false);\n        return;\n      }\n      try {\n""",
    )

    patch(
        "apps/desktop/src-tauri/src/main.rs",
        """fn installed_game_folder(app_id: u32) -> Result<PathBuf, String> {\n    for root in steam_library_roots_for_folder_open()? {\n""",
        """fn provider_prepared_game_folder(app_id: u32) -> Option<PathBuf> {\n    let status = provider_download::provider_download_status(app_id).ok().flatten()?;\n    if !(status.installed || matches!(status.state.as_str(), \"installed\" | \"prepared\")) {\n        return None;\n    }\n    let target = PathBuf::from(status.prepared_target?);\n    if !target.is_dir() {\n        return None;\n    }\n    Some(fs::canonicalize(&target).unwrap_or(target))\n}\n\nfn installed_game_folder(app_id: u32) -> Result<PathBuf, String> {\n    if let Some(folder) = provider_prepared_game_folder(app_id) {\n        return Ok(folder);\n    }\n    for root in steam_library_roots_for_folder_open()? {\n""",
    )
    patch(
        "apps/desktop/src-tauri/src/main.rs",
        """        if folder.is_dir() {\n            return Ok(folder);\n        }\n    }\n    Err(format!(\n        \"Steam no informa una carpeta de instalación lista para AppID {app_id}.\"\n    ))\n}\n""",
        """        if folder.is_dir() {\n            return Ok(fs::canonicalize(&folder).unwrap_or(folder));\n        }\n    }\n    Err(format!(\n        \"GameAccess y Steam no informan una carpeta de instalación lista para AppID {app_id}.\"\n    ))\n}\n""",
    )

    return changed


if __name__ == "__main__":
    for item in apply():
        print(item)
