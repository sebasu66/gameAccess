from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIBRARY_ROOM = ROOT / "apps" / "desktop" / "src" / "LibraryRoom.tsx"
CONTRACT_TEST = ROOT / "apps" / "desktop" / "src" / "libraryGridScrollContract.test.ts"

old_import = 'import { calculateSelectionScrollTop } from "./libraryNavigation";'
new_import = (
    'import { calculateSelectionScrollTop, selectionItemTopInScrollContainer } '
    'from "./libraryNavigation";'
)

old_effect = '''  useEffect(() => {\n    if (!isTabletSurface || selectedIndex < 0) return;\n    const grid = gridRef.current;\n    const card = grid?.querySelector<HTMLElement>(".library-room-card.is-selected");\n    if (!grid || !card) return;\n    const nextTop = calculateSelectionScrollTop({ scrollTop: grid.scrollTop, viewportHeight: grid.clientHeight, itemTop: card.offsetTop, itemHeight: card.offsetHeight, padding: 8 });\n    if (Math.abs(nextTop - grid.scrollTop) > 1) grid.scrollTo({ top: nextTop, behavior: "auto" });\n  }, [isTabletSurface, selectedIndex]);'''

new_effect = '''  useEffect(() => {\n    if (selectedIndex < 0 || isDisplaySurface) return;\n    const grid = gridRef.current;\n    const card = grid?.querySelector<HTMLElement>(".library-room-card.is-selected");\n    if (!grid || !card) return;\n\n    const gridRect = grid.getBoundingClientRect();\n    const cardRect = card.getBoundingClientRect();\n    const itemTop = selectionItemTopInScrollContainer({\n      scrollTop: grid.scrollTop,\n      viewportTop: gridRect.top,\n      itemTop: cardRect.top,\n    });\n    const nextTop = calculateSelectionScrollTop({\n      scrollTop: grid.scrollTop,\n      viewportHeight: grid.clientHeight,\n      itemTop,\n      itemHeight: cardRect.height,\n      padding: 8,\n    });\n    if (Math.abs(nextTop - grid.scrollTop) > 1) {\n      grid.scrollTo({ top: nextTop, behavior: "auto" });\n    }\n  }, [isDisplaySurface, selectedIndex]);'''

text = LIBRARY_ROOM.read_text(encoding="utf-8")

if old_import in text:
    text = text.replace(old_import, new_import, 1)
elif new_import not in text:
    raise SystemExit("libraryNavigation import did not match expected source")

if old_effect in text:
    text = text.replace(old_effect, new_effect, 1)
elif new_effect not in text:
    raise SystemExit("selection autoscroll effect did not match expected source")

LIBRARY_ROOM.write_text(text, encoding="utf-8")

CONTRACT_TEST.write_text(
    '''import { describe, expect, it } from "vitest";\nimport libraryRoomSource from "./LibraryRoom.tsx?raw";\n\ndescribe("desktop library keyboard autoscroll contract", () => {\n  it("keeps desktop and tablet keyboard selection visible without affecting display mode", () => {\n    expect(libraryRoomSource).toContain("if (selectedIndex < 0 || isDisplaySurface) return;");\n    expect(libraryRoomSource).toContain("selectionItemTopInScrollContainer");\n    expect(libraryRoomSource).toContain("getBoundingClientRect()");\n    expect(libraryRoomSource).not.toContain("if (!isTabletSurface || selectedIndex < 0) return;");\n  });\n});\n''',
    encoding="utf-8",
)
