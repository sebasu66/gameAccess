from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
api = ROOT / "apps/desktop/src/api.ts"
text = api.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global text
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    text = text.replace(old, new, 1)


replace_once(
    'import { AsyncResourceCache } from "./asyncResourceCache";\n',
    'import { AsyncResourceCache } from "./asyncResourceCache";\nimport { applyBundledCatalogArtwork, applyBundledDetails } from "./bundledArtwork";\n',
    "bundled artwork import",
)
replace_once(
    '  localCatalog = personalCatalogBuilder.build(pool);\n',
    '  localCatalog = await applyBundledCatalogArtwork(personalCatalogBuilder.build(pool));\n',
    "local catalog artwork",
)
replace_once(
    '    if (steam) return { ...game, steam, metadata_state: "steam-store" };\n',
    '    if (steam) return applyBundledDetails({ ...game, steam, metadata_state: "steam-store" });\n',
    "local detail artwork",
)
replace_once(
    '''  const [games, user] = await Promise.all([\n    gameAccessCatalog.load(),\n    request<UserSummary>("/users/1").catch(() => ({ id: 1, username: "gameaccess", credits: 0 })),\n  ]);\n''',
    '''  const [backendGames, user] = await Promise.all([\n    gameAccessCatalog.load(),\n    request<UserSummary>("/users/1").catch(() => ({ id: 1, username: "gameaccess", credits: 0 })),\n  ]);\n  const games = await applyBundledCatalogArtwork(backendGames);\n''',
    "GameAccess catalog artwork",
)
replace_once(
    '      return await request<GameDetails>(`/games/${gameId}/details`);\n',
    '      return await applyBundledDetails(await request<GameDetails>(`/games/${gameId}/details`));\n',
    "GameAccess detail artwork",
)

api.write_text(text, encoding="utf-8")
