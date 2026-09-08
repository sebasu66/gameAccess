from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PARTS = ROOT / "apps" / "desktop" / "src" / "LibraryRoomParts.tsx"
ROOM = ROOT / "apps" / "desktop" / "src" / "LibraryRoom.tsx"
CSS = ROOT / "apps" / "desktop" / "src" / "library-room.css"
LAYOUT = ROOT / "apps" / "desktop" / "public" / "library-room-layout.css"
LAYOUT_TEST = ROOT / "apps" / "desktop" / "src" / "libraryLayoutContract.test.ts"
VISUAL_TEST = ROOT / "apps" / "desktop" / "src" / "stage2DetailVisualContract.test.ts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"{label}: expected source not found")
    return text.replace(old, new, 1)


parts = PARTS.read_text(encoding="utf-8")

hero_anchor = '''export function selectedHero(details: GameDetails | null, game?: CatalogGame) {
  return firstPresent(
    details?.steam?.screenshots?.[0]?.full,
    details?.steam?.background,
    details?.steam?.hero_image,
    game?.header_image,
    game?.hero_image,
    game?.capsule_image,
  );
}
'''
hero_replacement = hero_anchor + '''
export function selectedPortraitHero(game?: CatalogGame) {
  const appId = game?.app_id;
  return firstPresent(
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg` : undefined,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg` : undefined,
    game?.capsule_image,
    game?.hero_image,
    game?.header_image,
  );
}

export function selectedWideArtworkSlides(details: GameDetails | null, game?: CatalogGame) {
  const appId = game?.app_id;
  const screenshots = details?.steam?.screenshots?.flatMap((shot) => shot.full || shot.thumbnail ? [shot.full ?? shot.thumbnail ?? ""] : []) ?? [];
  const candidates = [
    details?.steam?.hero_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_hero.jpg` : undefined,
    details?.steam?.background,
    game?.hero_image,
    game?.header_image,
    ...screenshots,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}
'''
parts = replace_once(parts, hero_anchor, hero_replacement, "Steam artwork helpers")

old_controls = '''          <div className="library-room-actions glass-actions-row">
            {props.actions.map((action, index) => (
              <button type="button" key={`${action.kind}-${action.label}`} ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} data-action={action.kind} title={action.reason ?? undefined} className={`glass-action ${action.kind === "play" ? "play" : action.kind === "cancel" ? "cancel" : "download"} ${props.focusZone === "actions" && props.actionIndex === index ? "is-selected" : ""}`} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} onClick={() => props.onAction(index)} disabled={action.disabled}>
                <span className="glass-action-icon">{action.icon}</span><span className="glass-action-label">{action.label}</span>
              </button>
            ))}
          </div>
          <div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>
            <span>¿Te gusta?</span>
            <button type="button" className={props.preference === 1 ? "selected" : ""} onClick={() => props.onPreference(1)} aria-label="Me gusta"><ThumbsUp size={18} /></button>
            <button type="button" className={props.preference === -1 ? "selected negative" : ""} onClick={() => props.onPreference(-1)} aria-label="No me gusta"><ThumbsDown size={18} /></button>
          </div>
        </header>

        <div className="library-room-unified-facts">'''
new_controls = '''        </header>

        <div className="library-room-control-row">
          <div className="library-room-actions glass-actions-row">
            {props.actions.map((action, index) => (
              <button type="button" key={`${action.kind}-${action.label}`} ref={(node) => { if (props.actionRefs.current) props.actionRefs.current[index] = node; }} data-action={action.kind} title={action.reason ?? undefined} className={`glass-action ${action.kind === "play" ? "play" : action.kind === "cancel" ? "cancel" : "download"} ${props.focusZone === "actions" && props.actionIndex === index ? "is-selected" : ""}`} onFocus={() => { props.setFocusZone("actions"); props.setActionIndex(index); }} onClick={() => props.onAction(index)} disabled={action.disabled}>
                <span className="glass-action-icon">{action.icon}</span><span className="glass-action-label">{action.label}</span>
              </button>
            ))}
          </div>
          <div className="library-room-preferences" aria-label={`Preferencia para ${props.game.name}`}>
            <span>¿Te gusta?</span>
            <button type="button" className={props.preference === 1 ? "selected" : ""} onClick={() => props.onPreference(1)} aria-label="Me gusta"><ThumbsUp size={15} /></button>
            <button type="button" className={props.preference === -1 ? "selected negative" : ""} onClick={() => props.onPreference(-1)} aria-label="No me gusta"><ThumbsDown size={15} /></button>
          </div>
        </div>

        <div className="library-room-unified-facts">'''
parts = replace_once(parts, old_controls, new_controls, "detail control row")
PARTS.write_text(parts, encoding="utf-8")

room = ROOM.read_text(encoding="utf-8")
room = replace_once(
    room,
    'import type { KeyboardEvent } from "react";\n',
    'import type { KeyboardEvent } from "react";\nimport { getCurrentWindow } from "@tauri-apps/api/window";\n',
    "Tauri window import",
)
room = replace_once(
    room,
    '  selectedHero,\n  selectedMovie,',
    '  selectedHero,\n  selectedPortraitHero,\n  selectedWideArtworkSlides,\n  selectedMovie,',
    "artwork helper imports",
)
room = replace_once(
    room,
    '  const [displayPinned, setDisplayPinned] = useState(false);\n',
    '  const [displayPinned, setDisplayPinned] = useState(false);\n  const [isWindowMaximized, setIsWindowMaximized] = useState(false);\n  const [artworkSlideIndex, setArtworkSlideIndex] = useState(0);\n',
    "visual experiment state",
)

old_hero = '''  const hero = isTabletSurface ? undefined : selectedHero(currentDetails, selectedGame);
  const movie = isTabletSurface ? undefined : selectedMovie(currentDetails);
  const videoSrc = isTabletSurface ? undefined : selectedVideo(movie);
  const artwork = useCrossfadeArtwork(hero);'''
new_hero = '''  const fallbackHero = isTabletSurface ? undefined : selectedHero(currentDetails, selectedGame);
  const portraitHero = isTabletSurface ? undefined : selectedPortraitHero(selectedGame);
  const wideArtworkSlides = isTabletSurface ? [] : selectedWideArtworkSlides(currentDetails, selectedGame);
  const wideHero = wideArtworkSlides.length ? wideArtworkSlides[artworkSlideIndex % wideArtworkSlides.length] : undefined;
  const hero = isTabletSurface ? undefined : (isWindowMaximized ? (wideHero ?? fallbackHero) : (portraitHero ?? fallbackHero));
  const movie = isTabletSurface ? undefined : selectedMovie(currentDetails);
  const videoSrc = isTabletSurface ? undefined : selectedVideo(movie);
  const artwork = useCrossfadeArtwork(hero);'''
room = replace_once(room, old_hero, new_hero, "adaptive hero selection")

maximized_effect_anchor = '''  useEffect(() => {
    if (!isDisplaySurface || displayPinned || displayGames.length < 2 || selectedGameIdResolved == null) return;
    const holdMs = videoSrc ? 45_000 : 18_000;
    const timer = window.setTimeout(() => {
      const current = Math.max(0, displayGames.findIndex((game) => game.id === selectedGameIdResolved));
      const next = (current + 1) % displayGames.length;
      setSelectedGameId(displayGames[next]?.id ?? displayGames[0]?.id ?? null);
    }, holdMs);
    return () => window.clearTimeout(timer);
  }, [isDisplaySurface, displayPinned, displayGames, selectedGameIdResolved, videoSrc]);
'''
maximized_effect = maximized_effect_anchor + '''
  useEffect(() => {
    if (isTabletSurface || isDisplaySurface) {
      setIsWindowMaximized(false);
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const apply = (value: boolean) => { if (!cancelled) setIsWindowMaximized(value); };

    if ("__TAURI_INTERNALS__" in window) {
      const appWindow = getCurrentWindow();
      const refresh = () => { void appWindow.isMaximized().then(apply).catch(() => undefined); };
      refresh();
      void appWindow.onResized(() => refresh()).then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
      }).catch(() => undefined);
    } else {
      const refresh = () => apply(window.innerWidth >= 1500 && window.innerWidth / Math.max(1, window.innerHeight) >= 1.45);
      refresh();
      window.addEventListener("resize", refresh);
      unlisten = () => window.removeEventListener("resize", refresh);
    }

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [isTabletSurface, isDisplaySurface]);

  useEffect(() => {
    setArtworkSlideIndex(0);
  }, [selectedGameIdResolved, isWindowMaximized]);

  useEffect(() => {
    if (!isWindowMaximized || isTabletSurface || isDisplaySurface || wideArtworkSlides.length < 2) return;
    const timer = window.setInterval(() => {
      setArtworkSlideIndex((current) => (current + 1) % wideArtworkSlides.length);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [isWindowMaximized, isTabletSurface, isDisplaySurface, selectedGameIdResolved, wideArtworkSlides.length]);
'''
room = replace_once(room, maximized_effect_anchor, maximized_effect, "maximized and slideshow effects")
room = replace_once(
    room,
    '  const rootClass = `${libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame))} ${surfaceClass}`.trim();',
    '  const windowLayoutClass = !isTabletSurface && !isDisplaySurface && isWindowMaximized ? "is-maximized" : "";\n  const rootClass = `${libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame))} ${surfaceClass} ${windowLayoutClass}`.trim();',
    "maximized root class",
)
ROOM.write_text(room, encoding="utf-8")

layout = LAYOUT.read_text(encoding="utf-8")
layout = layout.replace(
    "/* Desktop library layout contract: detail and game grid share the workspace 50/50.\n   Tablet and display surfaces keep their dedicated layouts. */",
    "/* Desktop library layout contract: normal windows stay 50/50. A maximized desktop window gives the detail panel roughly 70% and the game grid 30%. Tablet and display surfaces keep their dedicated layouts. */",
)
max_rule = '''

  .library-room.is-maximized:not(.surface-tablet):not(.surface-display) {
    grid-template-columns: minmax(0, 7fr) minmax(0, 3fr) !important;
  }
'''
if max_rule.strip() not in layout:
    marker = '''  .library-room:not(.surface-tablet):not(.surface-display) > * {
    min-width: 0;
  }
'''
    if marker not in layout:
        raise SystemExit("adaptive layout insertion point not found")
    layout = layout.replace(marker, marker + max_rule, 1)
LAYOUT.write_text(layout, encoding="utf-8")

css = CSS.read_text(encoding="utf-8")
visual_css = r'''

/* Stage 2 visual experiment: adaptive desktop detail hero.
   Normal desktop windows remain portrait-friendly; maximized windows become detail-first. */
@media (min-width: 761px) {
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-media {
    height: clamp(410px, 56vh, 610px) !important;
    min-height: 410px !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet):not(.is-maximized) .library-room-hero-layer {
    object-fit: contain !important;
    object-position: center center !important;
    background: radial-gradient(circle at 50% 40%, #162130, #080c12 70%) !important;
  }
  .library-room.is-maximized:not(.surface-display):not(.surface-tablet) .library-room-feature-media {
    height: clamp(430px, 60vh, 680px) !important;
    min-height: 430px !important;
  }
  .library-room.is-maximized:not(.surface-display):not(.surface-tablet) .library-room-hero-layer {
    object-fit: cover !important;
    object-position: center center !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-shade {
    background:
      linear-gradient(180deg, rgba(2,4,7,.03) 0%, rgba(2,4,7,.06) 45%, rgba(2,4,7,.58) 78%, rgba(2,4,7,.94) 100%),
      linear-gradient(90deg, rgba(2,4,7,.10), transparent 48%, rgba(2,4,7,.10)) !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-copy {
    margin-top: -190px !important;
    padding: 0 26px 44px !important;
    background: transparent !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview {
    position: relative;
    z-index: 4;
    box-sizing: border-box;
    min-height: 190px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 36px 2px 24px !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview::before {
    content: "";
    position: absolute;
    z-index: -1;
    inset: -95px -26px 0;
    pointer-events: none;
    background: linear-gradient(180deg, transparent 0%, rgba(3,5,8,.28) 40%, rgba(3,5,8,.92) 100%);
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview .eyebrow {
    display: none !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview h1 {
    margin: 0 0 10px !important;
    max-width: 18ch !important;
    color: #fff;
    font-size: clamp(38px, 3.5vw, 62px) !important;
    line-height: .94 !important;
    text-shadow: 0 3px 18px rgba(0,0,0,.92), 0 12px 42px rgba(0,0,0,.68) !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-lead {
    max-width: 72ch !important;
    margin: 0 !important;
    color: rgba(240,245,250,.88) !important;
    text-shadow: 0 2px 12px rgba(0,0,0,.95) !important;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-loading {
    margin-top: 10px;
    margin-bottom: 0;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-control-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    min-height: 70px;
    padding: 16px 0 18px;
    border-bottom: 1px solid rgba(255,255,255,.10);
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-control-row .library-room-actions {
    margin: 0 !important;
    min-height: 0;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-control-row .library-room-preferences {
    flex: 0 0 auto;
    margin: 0;
    gap: 7px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-control-row .library-room-preferences > span {
    display: none;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-control-row .library-room-preferences button {
    width: 32px;
    height: 32px;
    border-radius: 9px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-unified-facts {
    padding-top: 20px;
    border-top: 0;
  }
  .library-room.is-maximized:not(.surface-display):not(.surface-tablet) .library-room-overview h1 {
    font-size: clamp(48px, 4vw, 76px) !important;
  }
}
'''
if "Stage 2 visual experiment: adaptive desktop detail hero" not in css:
    css += visual_css
CSS.write_text(css, encoding="utf-8")

LAYOUT_TEST.write_text(
    '''import { describe, expect, it } from "vitest";\n\nimport css from "../public/library-room-layout.css?raw";\n\ndescribe("desktop library layout contract", () => {\n  it("keeps normal desktop windows 50/50 and makes maximized windows detail-first", () => {\n    expect(css).toContain("grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)");\n    expect(css).toContain(".library-room.is-maximized");\n    expect(css).toContain("grid-template-columns: minmax(0, 7fr) minmax(0, 3fr)");\n    expect(css).not.toContain("440px");\n    expect(css).not.toContain("31vw");\n  });\n\n  it("excludes tablet and display surfaces and protects shrinkable children", () => {\n    expect(css).toContain(":not(.surface-tablet):not(.surface-display)");\n    expect(css).toContain("min-width: 0");\n  });\n});\n''',
    encoding="utf-8",
)

VISUAL_TEST.write_text(
    '''import { describe, expect, it } from "vitest";\n\nimport roomSource from "./LibraryRoom.tsx?raw";\nimport partsSource from "./LibraryRoomParts.tsx?raw";\nimport css from "./library-room.css?raw";\n\ndescribe("Stage 2 adaptive detail visual experiment", () => {\n  it("uses exact maximized-window state and a wide Steam artwork slideshow", () => {\n    expect(roomSource).toContain("appWindow.isMaximized()");\n    expect(roomSource).toContain("selectedWideArtworkSlides");\n    expect(roomSource).toContain("setInterval");\n    expect(roomSource).toContain('"is-maximized"');\n  });\n\n  it("uses portrait Steam artwork in the normal desktop layout", () => {\n    expect(roomSource).toContain("selectedPortraitHero");\n    expect(partsSource).toContain("library_600x900_2x.jpg");\n    expect(css).toContain("object-fit: contain !important");\n  });\n\n  it("keeps the title over the hero and separates the primary and preference controls", () => {\n    expect(partsSource).toContain("library-room-control-row");\n    expect(css).toContain("margin-top: -190px !important");\n    expect(css).toContain("justify-content: space-between");\n    expect(css).toContain("library-room-overview::before");\n  });\n});\n''',
    encoding="utf-8",
)
