from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "apps" / "desktop" / "src" / "App.tsx"
PROVIDER_LAUNCH = ROOT / "apps" / "desktop" / "src" / "providerLaunch.ts"
TEST = ROOT / "apps" / "desktop" / "src" / "providerLaunch.test.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    source = APP.read_text(encoding="utf-8")

    source = replace_once(
        source,
        'import { DetailPanel } from "./AppDetailPanel";\n',
        'import { DetailPanel } from "./AppDetailPanel";\nimport { openProviderSteamRun } from "./providerLaunch";\n',
        "provider launch import",
    )

    source = replace_once(
        source,
        '        await openSteamRun(lease.game.app_id);\n        recordPlayed(lease.game.app_id);\n',
        '        await openProviderSteamRun(lease.game.app_id, lease.account.label);\n        recordPlayed(lease.game.app_id);\n',
        "GameAccess provider launch call",
    )

    source = replace_once(
        source,
        '  const heroMovie = heroDetails?.steam?.movies?.find((movie) => movie.highlight) || heroDetails?.steam?.movies?.[0];\n',
        '  const heroMovie = heroDetails?.steam?.movies?.find((movie) => movie.highlight) || heroDetails?.steam?.movies?.[0];\n  const featuredPlayReady = Boolean(featured?.app_id && gameStateManager.isPlayButtonReady(downloads[featured.app_id]));\n',
        "featured play state",
    )

    source = replace_once(
        source,
        'disabled={featured.copies_available <= 0 || leaseBusy}',
        'disabled={!featuredPlayReady || leaseBusy}',
        "hero Play gate",
    )

    APP.write_text(source, encoding="utf-8")

    PROVIDER_LAUNCH.write_text(
        '''import { invoke } from "@tauri-apps/api/core";\n\nimport { prepareFrozenGameForPlay } from "./gameStorage";\nimport { narrate } from "./narrationLog";\nimport { hasTauriRuntime, type SteamSessionStatus } from "./native";\n\n/**\n * Launch a GameAccess lease after the assigned provider account has already\n * been authenticated by leaseGame(). This path must never resolve or switch to\n * one of the customer's remembered/personal Steam accounts.\n */\nexport async function openProviderSteamRun(appId: number, providerLabel: string): Promise<void> {\n  if (!appId) throw new Error("Este juego todavía no tiene Steam AppID configurado.");\n  if (!providerLabel.trim()) throw new Error("La reserva no tiene una cuenta proveedora asociada.");\n  if (!hasTauriRuntime()) throw new Error("Las sesiones proveedoras de GameAccess requieren la aplicación de escritorio.");\n\n  await prepareFrozenGameForPlay(appId);\n  await narrate(\n    `Launching GameAccess Steam AppID ${appId} with the provider session that the lease already authenticated. Personal remembered-account resolution is intentionally skipped.`,\n    { area: "LAUNCH" },\n  );\n\n  await invoke<SteamSessionStatus>("start_steam_game_session", {\n    request: {\n      appId,\n      accountName: providerLabel,\n      expectedUserId32: null,\n      restoreMode: "leave",\n      mainAccountName: null,\n      mainUserId32: null,\n      previousAccountName: null,\n      previousUserId32: null,\n    },\n  });\n\n  await narrate(\n    `Steam accepted the tracked GameAccess provider launch for AppID ${appId}.`,\n    { area: "LAUNCH" },\n  );\n}\n''',
        encoding="utf-8",
    )

    TEST.write_text(
        '''import { describe, expect, it } from "vitest";\n\nimport appSource from "./App.tsx?raw";\nimport providerLaunchSource from "./providerLaunch.ts?raw";\nimport type { ManagedDownloadStatus } from "./downloadTypes";\nimport { gameStateManager } from "./GameStateManager";\n\nconst driftersTalesPrepared: ManagedDownloadStatus = {\n  app_id: 1935960,\n  state: "prepared",\n  progress: 100,\n  bytes_downloaded: 2152951695,\n  bytes_total: 2152951695,\n  installed: false,\n  prepared_target: "C:/Program Files (x86)/Steam/steamapps/common/Drifter's Tales",\n};\n\ndescribe("GameAccess provider launch route", () => {\n  it("keeps prepared Drifter's Tales Play-ready even when catalog availability is stale", () => {\n    expect(gameStateManager.isPlayButtonReady(driftersTalesPrepared)).toBe(true);\n    expect(appSource).toContain("gameStateManager.isPlayButtonReady(downloads[featured.app_id])");\n    expect(appSource).toContain("disabled={!featuredPlayReady || leaseBusy}");\n    expect(appSource).not.toContain("disabled={featured.copies_available <= 0 || leaseBusy}");\n  });\n\n  it("launches a GameAccess lease through the already-authenticated provider session", () => {\n    expect(appSource).toContain("await openProviderSteamRun(lease.game.app_id, lease.account.label);");\n    expect(providerLaunchSource).toContain('invoke<SteamSessionStatus>("start_steam_game_session"');\n    expect(providerLaunchSource).toContain('restoreMode: "leave"');\n    expect(providerLaunchSource).not.toContain("getLocalSteamPool");\n    expect(providerLaunchSource).not.toContain("switchSteamAccount");\n  });\n\n  it("leaves the personal/local launch route separate", () => {\n    expect(appSource).toContain("await openSteamRun(game.app_id);");\n  });\n});\n''',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
