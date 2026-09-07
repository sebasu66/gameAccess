from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def text(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def main() -> None:
    catalog = text("apps/desktop/src/catalog.ts")
    assert "const launchAccounts = owners.length ? owners : accessible;" not in catalog
    assert 'availability_state: owners.length ? "ready" : "unavailable"' in catalog
    assert "local_primary_account_label: owners[0]?.account_name || owners[0]?.label" in catalog

    parts = text("apps/desktop/src/LibraryRoomParts.tsx")
    assert "InstallStateBadge({ game, status }" in parts
    assert "library-install-state no-license" in parts
    assert "Instalado · sin licencia disponible" in parts

    app = text("apps/desktop/src/App.tsx")
    assert "No verified owner is available for AppID" in app
    assert 'title: "Sin licencia disponible"' in app

    native = text("apps/desktop/src-tauri/src/main.rs")
    assert "fn provider_prepared_game_folder(app_id: u32) -> Option<PathBuf>" in native
    assert "provider_download::provider_download_status(app_id)" in native
    assert "fs::canonicalize(&target).unwrap_or(target)" in native

    catalog_test = text("apps/desktop/src/catalog.test.ts")
    assert "expect(game?.local_primary_account_label).toBeUndefined()" in catalog_test

    room_test = text("apps/desktop/src/LibraryRoom.test.tsx")
    assert "distinguishes installed games with and without a playable license" in room_test
    assert "library-install-state no-license" in room_test


if __name__ == "__main__":
    main()
    print("local license/folder repair checks passed")
