from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "desktop" / "src"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f"{label}: expected source not found")
    return text.replace(old, new, 1)


def sub_once(text: str, pattern: str, replacement: str, label: str) -> str:
    result, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, got {count}")
    return result


# 1. Remove the superseded detail implementation from LibraryRoomParts.
parts_path = SRC / "LibraryRoomParts.tsx"
parts = parts_path.read_text(encoding="utf-8")
parts = replace_once(parts, 'import { useEffect, useRef, useState } from "react";\n', 'import { useState } from "react";\n', "parts hooks")
parts = replace_once(parts, 'import { Download, Gamepad2, Loader2, Play, ThumbsDown, ThumbsUp, Volume2, VolumeX, XCircle } from "lucide-react";\n', 'import { Download, Gamepad2, Loader2, Play, XCircle } from "lucide-react";\n', "parts icons")
parts = replace_once(parts, 'import { downloadProgress, formatDownloadBytes, formatDownloadEta, formatDownloadSpeed, isTrackedDownload } from "./downloadManager";\n', 'import { isTrackedDownload } from "./downloadManager";\n', "parts download imports")
parts = replace_once(parts, 'import type { CatalogGame, GameDetails, SteamMovie } from "./types";\n', 'import type { CatalogGame } from "./types";\n', "parts game types")
parts = sub_once(parts, r'\nexport interface ArtworkState \{.*?\n\}\n', '\n', "remove ArtworkState")
parts = sub_once(parts, r'\nexport function firstPresent<T>\(.*?\n\}\n\nfunction artworkCandidates', '\nfunction artworkCandidates', "remove firstPresent")
parts = sub_once(parts, r'\nexport function useCrossfadeArtwork\(.*?\n\}\n\nexport function selectedDownload', '\nexport function selectedDownload', "remove old crossfade")
parts = sub_once(parts, r'\nexport function selectedHero\(.*?\nexport function libraryRoomClass', '\nexport function libraryRoomClass', "remove old detail selectors")
parts = sub_once(parts, r'\ninterface MediaPanelProps \{.*?\ninterface CatalogPanelProps', '\ninterface CatalogPanelProps', "remove old detail panel")
parts_path.write_text(parts, encoding="utf-8")


# 2. Use the dedicated selected-detail hook + bounded DetailPanel from LibraryRoom.
room_path = SRC / "LibraryRoom.tsx"
room = room_path.read_text(encoding="utf-8")
room = room.replace('import { getCurrentWindow } from "@tauri-apps/api/window";\n', '')
room = room.replace('import { loadDetails } from "./api";\n', '')
room = room.replace('  FeaturePanel,\n', '')
for name in [
    '  selectedHero,\n',
    '  selectedPortraitHero,\n',
    '  selectedWideArtworkSlides,\n',
    '  selectedMovie,\n',
    '  selectedSummary,\n',
    '  selectedVideo,\n',
    '  useCrossfadeArtwork,\n',
]:
    room = room.replace(name, '')
room = replace_once(room, 'import DownloadCompleteDialog from "./DownloadCompleteDialog";\n', 'import DownloadCompleteDialog from "./DownloadCompleteDialog";\nimport { FeaturePanel } from "./LibraryDetailPanel";\n', "detail panel import")
room = replace_once(room, 'import type { CatalogGame, GameDetails } from "./types";\n', 'import type { CatalogGame } from "./types";\nimport { useSelectedGameDetails } from "./useSelectedGameDetails";\n', "selected detail hook import")
room = room.replace('  const videoRef = useRef<HTMLVideoElement>(null);\n', '')
for state_line in [
    '  const [details, setDetails] = useState<GameDetails | null>(null);\n',
    '  const [detailsGameId, setDetailsGameId] = useState<number | null>(null);\n',
    '  const [loadingDetails, setLoadingDetails] = useState(false);\n',
    '  const [readyVideoSrc, setReadyVideoSrc] = useState<string | null>(null);\n',
    '  const [videoMuted, setVideoMuted] = useState(true);\n',
    '  const [videoVolume, setVideoVolume] = useState(0.68);\n',
    '  const [isWindowMaximized, setIsWindowMaximized] = useState(false);\n',
    '  const [artworkSlideIndex, setArtworkSlideIndex] = useState(0);\n',
]:
    room = room.replace(state_line, '')

old_derived = '''  const detailDownload = download;\n  const currentDetails = detailsGameId === selectedGameIdResolved ? details : null;\n  const fallbackHero = isTabletSurface ? undefined : selectedHero(currentDetails, selectedGame);\n  const portraitHero = isTabletSurface ? undefined : selectedPortraitHero(selectedGame);\n  const wideArtworkSlides = isTabletSurface ? [] : selectedWideArtworkSlides(currentDetails, selectedGame);\n  const wideHero = wideArtworkSlides.length ? wideArtworkSlides[artworkSlideIndex % wideArtworkSlides.length] : undefined;\n  const hero = isTabletSurface ? undefined : (isWindowMaximized ? (wideHero ?? fallbackHero) : (portraitHero ?? fallbackHero));\n  const movie = isTabletSurface ? undefined : selectedMovie(currentDetails);\n  const videoSrc = isDisplaySurface ? selectedVideo(movie) : undefined;\n  const artwork = useCrossfadeArtwork(hero);\n  const summary = selectedSummary(currentDetails);\n  const actions = useMemo(() => buildActions(selectedGame, download, busy), [selectedGame, download, busy]);'''
new_derived = '''  const detailDownload = download;\n  const detailSurface = isTabletSurface ? "tablet" : isDisplaySurface ? "display" : "desktop";\n  const detailState = useSelectedGameDetails({\n    surface: detailSurface,\n    selectedGameId: selectedGameIdResolved,\n    detailRequestedGameId,\n    tabletDetailsOpen,\n  });\n  const currentDetails = detailState.details;\n  const loadingDetails = detailState.loading;\n  const detailsError = detailState.error;\n  const hasSelectedMovie = Boolean(currentDetails?.steam?.movies?.length);\n  const actions = useMemo(() => buildActions(selectedGame, download, busy), [selectedGame, download, busy]);'''
room = replace_once(room, old_derived, new_derived, "detail derived state")
room = room.replace('    const holdMs = videoSrc ? 45_000 : 18_000;', '    const holdMs = hasSelectedMovie ? 45_000 : 18_000;')
room = room.replace('  }, [isDisplaySurface, displayPinned, displayGames, selectedGameIdResolved, videoSrc]);', '  }, [isDisplaySurface, displayPinned, displayGames, selectedGameIdResolved, hasSelectedMovie]);')
room = sub_once(
    room,
    r'\n  useEffect\(\(\) => \{\n    if \(isTabletSurface \|\| isDisplaySurface\) \{\n      setIsWindowMaximized\(false\);.*?\n  \}, \[isWindowMaximized, isTabletSurface, isDisplaySurface, selectedGameIdResolved, wideArtworkSlides\.length\]\);\n',
    '\n',
    "remove maximize-driven media effects",
)
room = sub_once(
    room,
    r'\n  useEffect\(\(\) => \{\n    const video = videoRef\.current;\n    if \(!video\) return;\n    video\.volume = videoVolume;.*?\n  \}, \[videoVolume, videoMuted\]\);\n',
    '\n',
    "remove room video volume effect",
)
room = room.replace('    const holdMs = videoSrc ? 110_000 : 90_000;', '    const holdMs = hasSelectedMovie ? 110_000 : 90_000;')
room = room.replace('  }, [showcaseMode, displayGames, selectedGameIdResolved, selectedIndex, videoSrc]);', '  }, [showcaseMode, displayGames, selectedGameIdResolved, selectedIndex, hasSelectedMovie]);')
room = sub_once(
    room,
    r'\n  useEffect\(\(\) => \{\n    const shouldLoadDetails = .*?\n  \}, \[selectedGameIdResolved, isTabletSurface, tabletDetailsOpen, detailRequestedGameId\]\);\n',
    '\n',
    "remove inline detail loader",
)
room = sub_once(
    room,
    r'\n  const startVideoPastIntro = \(video: HTMLVideoElement\) => \{.*?\n  const onAction = \(index: number\) => \{',
    '\n  const onAction = (index: number) => {',
    "remove room media handlers",
)
room = replace_once(
    room,
    '  const surfaceClass = isTabletSurface ? "surface-tablet" : isDisplaySurface ? "surface-display" : "";\n  const windowLayoutClass = !isTabletSurface && !isDisplaySurface && isWindowMaximized ? "is-maximized" : "";\n  const rootClass = `${libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame))} ${surfaceClass} ${windowLayoutClass}`.trim();',
    '  const surfaceClass = isTabletSurface ? "surface-tablet" : isDisplaySurface ? "surface-display" : "";\n  const rootClass = `${libraryRoomClass(focusZone, showcaseMode, Boolean(selectedGame))} ${surfaceClass}`.trim();',
    "remove maximize layout class",
)
room = sub_once(
    room,
    r'  const detailPanel = selectedGame \? \(\n    <FeaturePanel.*?\n  \) : null;',
    '''  const detailPanel = selectedGame ? (\n    <FeaturePanel\n      key={selectedGame.id}\n      game={selectedGame}\n      showcaseMode={isDisplaySurface ? !displayPinned : showcaseMode}\n      loadingDetails={loadingDetails}\n      detailsError={detailsError}\n      details={currentDetails}\n      download={detailDownload}\n      preference={preferences[selectedGame.id]}\n      onPreference={(value) => onPreference(selectedGame.id, value)}\n      actions={actions}\n      focusZone={isDisplaySurface ? "grid" : focusZone}\n      actionIndex={actionIndex}\n      actionRefs={actionRefs}\n      setFocusZone={setFocusZone}\n      setActionIndex={setActionIndex}\n      onAction={onAction}\n      displaySurface={isDisplaySurface}\n    />\n  ) : null;''',
    "replace detail panel props",
)
room = room.replace('              {details?.steam?.short_description ? <p className="library-phone-description">{details.steam.short_description}</p> : null}\n              {details?.steam?.developers?.length ? <p className="library-phone-meta"><strong>Desarrollador</strong>{details.steam.developers.join(", ")}</p> : null}\n              {details?.steam?.publishers?.length ? <p className="library-phone-meta"><strong>Publisher</strong>{details.steam.publishers.join(", ")}</p> : null}\n              {details?.steam?.genres?.length ? <p className="library-phone-meta"><strong>Géneros</strong>{details.steam.genres.join(" · ")}</p> : null}\n              {details?.steam?.screenshots?.length ? <div className="library-phone-screenshots">{details.steam.screenshots.slice(0, 6).map((shot, index) => shot.thumbnail || shot.full ? <img key={shot.id ?? index} src={shot.thumbnail ?? shot.full} alt="" loading="lazy" draggable={false} /> : null)}</div> : null}', '              {currentDetails?.steam?.short_description ? <p className="library-phone-description">{currentDetails.steam.short_description}</p> : null}\n              {currentDetails?.steam?.developers?.length ? <p className="library-phone-meta"><strong>Desarrollador</strong>{currentDetails.steam.developers.join(", ")}</p> : null}\n              {currentDetails?.steam?.publishers?.length ? <p className="library-phone-meta"><strong>Publisher</strong>{currentDetails.steam.publishers.join(", ")}</p> : null}\n              {currentDetails?.steam?.genres?.length ? <p className="library-phone-meta"><strong>Géneros</strong>{currentDetails.steam.genres.join(" · ")}</p> : null}\n              {currentDetails?.steam?.screenshots?.length ? <div className="library-phone-screenshots">{currentDetails.steam.screenshots.slice(0, 6).map((shot, index) => shot.thumbnail || shot.full ? <img key={shot.id ?? index} src={shot.thumbnail ?? shot.full} alt="" loading="lazy" draggable={false} /> : null)}</div> : null}')
room_path.write_text(room, encoding="utf-8")


# 3. Refine the new detail panel for desktop sequence while preserving display looping.
detail_path = SRC / "LibraryDetailPanel.tsx"
detail = detail_path.read_text(encoding="utf-8")
detail = replace_once(detail, '  const images = useMemo(() => screenshotImages(details), [details]);', '  const images = useMemo(() => displaySurface ? [] : screenshotImages(details), [details, displaySurface]);', "display media isolation")
detail = replace_once(detail, '<div className="library-detail-media" aria-hidden="true">', '<div className="library-detail-media">', "media controls accessibility")
detail = replace_once(
    detail,
    '            onEnded={() => setState((current) => afterDetailVideo(current))}',
    '            onEnded={(event) => {\n              if (displaySurface) { event.currentTarget.currentTime = 0; void event.currentTarget.play().catch(() => undefined); }\n              else setState((current) => afterDetailVideo(current));\n            }}',
    "display trailer loop",
)
insert_marker = 'export function FeaturePanel(props: FeaturePanelProps) {\n  const steam = props.details?.steam;'
display_branch = '''export function FeaturePanel(props: FeaturePanelProps) {\n  const steam = props.details?.steam;'''
detail = replace_once(detail, insert_marker, display_branch, "feature marker")
# Mark the first row with the legacy feature-copy class only on display so existing display CSS remains authoritative.
detail = replace_once(
    detail,
    '<section className="library-room-first-row" aria-label="First row">',
    '<section className={`library-room-first-row ${props.displaySurface ? "library-room-feature-copy" : ""}`.trim()} aria-label="First row">',
    "display feature copy compatibility",
)
detail = replace_once(
    detail,
    '        <section className="library-room-second-row" aria-label="Second row">',
    '        {!props.displaySurface ? <section className="library-room-second-row" aria-label="Second row">',
    "hide desktop facts on display start",
)
detail = replace_once(
    detail,
    '        </section>\n      </section>\n\n      <div className="library-detail-extended" tabIndex={0} aria-label="Detalles extendidos del juego">',
    '        </section> : null}\n      </section>\n\n      {!props.displaySurface ? <div className="library-detail-extended" tabIndex={0} aria-label="Detalles extendidos del juego">',
    "hide desktop facts on display end",
)
detail = replace_once(
    detail,
    '      </div>\n    </aside>\n  );\n}',
    '      </div> : null}\n    </aside>\n  );\n}',
    "hide extended content on display",
)
detail_path.write_text(detail, encoding="utf-8")


# 4. Replace old desktop experiment CSS with the bounded essential+extended contract.
css_path = SRC / "library-room.css"
css = css_path.read_text(encoding="utf-8")
marker = "/* Stage 2 visual experiment: adaptive desktop detail hero."
if marker not in css:
    raise SystemExit("desktop experiment CSS marker missing")
css = css.split(marker, 1)[0].rstrip() + "\n\n" + r'''/* Desktop detail layout contract — 2026-09-08 handoff. */
@media (min-width: 761px) {
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: #070a0f;
    isolation: isolate;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature::after { display: none; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-essential {
    position: relative;
    z-index: 0;
    flex: 0 1 62%;
    min-height: 360px;
    max-height: 520px;
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    overflow: hidden;
    border-bottom: 1px solid rgba(255,255,255,.12);
    background: #071019;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-media,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-ambient,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-media {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-ambient { display: block; z-index: 0; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-media { z-index: 1; background: #0a1018; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-hero-layer,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-video {
    object-fit: cover;
    object-position: center;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-hero-layer { transition: opacity .72s ease, transform .9s ease; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-feature-shade,
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-essential-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background:
      linear-gradient(180deg, rgba(2,5,9,.22) 0%, rgba(2,5,9,.30) 30%, rgba(2,5,9,.72) 68%, rgba(2,5,9,.94) 100%),
      linear-gradient(90deg, rgba(2,5,9,.46), rgba(2,5,9,.12) 60%, rgba(2,5,9,.30));
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-media-controls {
    top: 12px;
    right: 12px;
    bottom: auto;
    z-index: 7;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-media-controls button {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: #fff;
    background: rgba(4,8,12,.58);
    cursor: pointer;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row {
    position: relative;
    z-index: 4;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: clamp(18px, 2.2vh, 28px) clamp(18px, 2vw, 28px) 14px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview {
    min-width: 0;
    padding-right: 84px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview h1 {
    max-width: 100%;
    margin: 0 0 7px;
    color: #fff;
    font-size: clamp(28px, 3vw, 48px);
    line-height: 1;
    letter-spacing: -.035em;
    text-shadow: 0 3px 18px rgba(0,0,0,.96), 0 10px 34px rgba(0,0,0,.68);
    overflow-wrap: anywhere;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-lead {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
    overflow: hidden;
    max-width: 72ch;
    margin: 0;
    color: rgba(244,248,252,.91);
    font-size: clamp(12px, 1.05vw, 14px);
    line-height: 1.45;
    text-shadow: 0 2px 12px rgba(0,0,0,.98);
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-loading {
    margin: 7px 0 0;
    font-size: 11px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-control-row {
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-top: 12px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-actions {
    min-width: 0;
    min-height: 0;
    margin: 0;
    flex-wrap: nowrap;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .glass-action {
    width: auto;
    min-width: 136px;
    height: 48px;
    padding: 0 17px;
    gap: 9px;
    justify-content: center;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .glass-action:hover:not(:disabled),
  .library-room:not(.surface-display):not(.surface-tablet) .glass-action:focus-visible:not(:disabled) { width: auto; }
  .library-room:not(.surface-display):not(.surface-tablet) .glass-action-icon {
    position: static;
    transform: none;
    opacity: 1;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .glass-action:hover .glass-action-icon,
  .library-room:not(.surface-display):not(.surface-tablet) .glass-action:focus-visible .glass-action-icon {
    transform: none;
    opacity: 1;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .glass-action-label {
    opacity: 1;
    transform: none;
    font-size: 12px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-preferences {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-preferences button {
    width: 40px;
    height: 40px;
    border-radius: 10px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-preferences button:focus-visible {
    outline: 2px solid #9effe3;
    outline-offset: 2px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-second-row {
    position: relative;
    z-index: 4;
    min-width: 0;
    padding: 12px clamp(18px, 2vw, 28px) 16px;
    border-top: 1px solid rgba(255,255,255,.13);
    background: rgba(3,7,11,.54);
    backdrop-filter: blur(10px);
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 18px;
    margin: 0;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts > div { min-width: 0; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts dt,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-active-download span,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-availability-fact span {
    color: #8d9aaa;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .055em;
    text-transform: uppercase;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts dd {
    margin: 2px 0 0;
    color: #eef3f8;
    font-size: 12px;
    line-height: 1.3;
    overflow-wrap: anywhere;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-availability-fact,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-active-download {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 16px;
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid rgba(255,255,255,.09);
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-availability-fact strong,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-active-download strong {
    color: #eef4f8;
    font-size: 12px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-active-download > div {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-progress-inline {
    flex: 1 1 150px;
    min-width: 120px;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-extended {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 22px clamp(18px, 2vw, 28px) 34px;
    background: #070a0f;
    scrollbar-width: auto;
    scrollbar-color: rgba(255,255,255,.42) rgba(255,255,255,.06);
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-extended::-webkit-scrollbar { width: 12px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-extended::-webkit-scrollbar-track { background: rgba(255,255,255,.055); }
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-extended::-webkit-scrollbar-thumb { background: rgba(255,255,255,.36); border: 3px solid transparent; background-clip: padding-box; border-radius: 999px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-copy-block,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-requirements-block,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-gallery-block {
    margin: 0;
    padding: 0 0 22px;
    border: 0;
    background: transparent;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-copy-block + .library-room-copy-block,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-requirements-block,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-gallery-block {
    padding-top: 22px;
    border-top: 1px solid rgba(255,255,255,.10);
  }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-copy-block h3,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-requirements-block h3,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-gallery-block h3 {
    margin: 0 0 12px;
    color: #f5f8fb;
    font-size: 13px;
    letter-spacing: .06em;
    text-transform: uppercase;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-copy-block p {
    color: #c7d0da;
    font-size: 14px;
    line-height: 1.68;
    overflow-wrap: anywhere;
  }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text p,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text div { margin: 0 0 14px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text ul,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text ol { margin: 10px 0 16px; padding-left: 24px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text li { margin: 6px 0; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h1,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h2,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h3,
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h4 { margin: 20px 0 10px; color: #f2f6fa; line-height: 1.2; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h1 { font-size: 22px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h2 { font-size: 19px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h3 { font-size: 17px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text h4 { font-size: 15px; }
  .library-room:not(.surface-display):not(.surface-tablet) .steam-rich-text img { display: block; max-width: 100%; height: auto; margin: 18px auto; border-radius: 10px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-requirements-block { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 24px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-screenshots { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 10px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-screenshots img { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 8px; }
}

@media (min-width: 761px) and (max-width: 1180px) {
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview { padding-right: 66px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-overview h1 { font-size: clamp(26px, 4vw, 40px); }
}

@media (min-width: 761px) and (max-height: 760px) {
  .library-room:not(.surface-display):not(.surface-tablet) .library-detail-essential { min-height: 350px; flex-basis: 68%; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-first-row { padding-top: 14px; padding-bottom: 10px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-lead { -webkit-line-clamp: 2; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-second-row { padding-top: 9px; padding-bottom: 11px; }
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-game-facts { gap: 5px 14px; }
}

@media (prefers-reduced-motion: reduce) {
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-hero-layer,
  .library-room:not(.surface-display):not(.surface-tablet) .library-room-video { transition: none; }
}
'''
css_path.write_text(css, encoding="utf-8")


# 5. Replace maximize-dependent desktop split with bounded detail width.
layout_path = ROOT / "apps" / "desktop" / "public" / "library-room-layout.css"
layout_path.write_text(r'''/* Desktop library layout contract: bounded detail panel + flexible catalog. */
@media (min-width: 761px) {
  .library-room:not(.surface-tablet):not(.surface-display) {
    grid-template-columns: clamp(420px, 48vw, 980px) minmax(0, 1fr) !important;
    gap: clamp(14px, 1.4vw, 22px) !important;
  }

  .library-room:not(.surface-tablet):not(.surface-display) > * {
    min-width: 0;
    min-height: 0;
  }

  .library-room:not(.surface-tablet):not(.surface-display) .library-room-feature,
  .library-room:not(.surface-tablet):not(.surface-display) .library-room-catalog {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .library-room:not(.surface-tablet):not(.surface-display) .library-room-grid {
    grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)) !important;
  }
}
''', encoding="utf-8")


# 6. Replace obsolete visual tests with behavior-oriented handoff checks.
visual_test = SRC / "stage2DetailVisualContract.test.ts"
visual_test.write_text('''import { describe, expect, it } from "vitest";\n\nimport { afterDetailImage, afterDetailVideo, createDetailMediaSequence } from "./detailMediaSequence";\nimport { shouldLoadSelectedDetails } from "./useSelectedGameDetails";\n\ndescribe("Stage 2 desktop detail handoff", () => {\n  it("loads the game already displayed on desktop startup", () => {\n    expect(shouldLoadSelectedDetails({ surface: "desktop", selectedGameId: 7, detailRequestedGameId: null, tabletDetailsOpen: false })).toBe(true);\n  });\n\n  it("cycles trailer to screenshots and back without a maximize condition", () => {\n    let state = createDetailMediaSequence({ videoSrc: "movie.mp4", images: ["a.jpg", "b.jpg"] });\n    state = afterDetailVideo(state);\n    expect(state).toMatchObject({ phase: "image", imageIndex: 0 });\n    state = afterDetailImage(afterDetailImage(state));\n    expect(state.phase).toBe("video");\n  });\n});\n''', encoding="utf-8")

layout_test = SRC / "libraryLayoutContract.test.ts"
layout_test.write_text('''import { describe, expect, it } from "vitest";\n\nimport css from "../public/library-room-layout.css?raw";\n\ndescribe("desktop library layout contract", () => {\n  it("bounds the detail panel while leaving the catalog flexible", () => {\n    expect(css).toContain("clamp(420px, 48vw, 980px) minmax(0, 1fr)");\n    expect(css).not.toContain(".library-room.is-maximized");\n    expect(css).not.toContain("minmax(0, 7fr)");\n  });\n\n  it("excludes tablet and display surfaces and protects shrinkable children", () => {\n    expect(css).toContain(":not(.surface-tablet):not(.surface-display)");\n    expect(css).toContain("min-width: 0");\n    expect(css).toContain("min-height: 0");\n  });\n});\n''', encoding="utf-8")


# 7. Update the project contracts that the handoff explicitly supersedes.
ui_contract = ROOT / "docs" / "UI_THREAD_CONTRACT.md"
ui = ui_contract.read_text(encoding="utf-8")
ui = replace_once(
    ui,
    '6. On desktop, the library detail document and game grid share the available workspace 50/50 using two `minmax(0, 1fr)` columns. Neither side may regain a fixed-width override. Tablet and display surfaces are separate contracts and must not inherit this split.',
    '6. On desktop, the detail panel is bounded by the available content viewport: roughly 45–50% at ordinary widths and capped around 900–1000 CSS px on ultrawide screens, while the catalog uses the remaining space. The First row and compact Second row remain visible; only Third row / extended detail content scrolls. Maximization does not select a different content contract. Tablet and display surfaces remain separate contracts.',
    "UI thread layout contract",
)
ui_contract.write_text(ui, encoding="utf-8")

readme = ROOT / "README.md"
readme_text = readme.read_text(encoding="utf-8")
readme_marker = "## Desktop detail layout contract (2026-09-08)"
if readme_marker not in readme_text:
    readme_text += '''\n\n## Desktop detail layout contract (2026-09-08)\n\nThe normal desktop library detail has three named regions. **First row** is the essential summary (title, real Steam short description, existing Play/Download state action, and like/dislike). **Second row** is a compact factual Steam summary plus separately labelled GameAccess availability and active-download measurements when they actually exist. First and Second rows remain visible together inside the supported desktop viewport. **Third row** and later About/requirements/gallery content form the scrollable extended-detail region.\n\nSelected-game Steam details load lazily and asynchronously, including for the game already displayed at desktop startup, and use the existing AppID/game detail cache. Rapid selection changes must never paint stale details under a newer game. Desktop background media follows a deterministic trailer -> screenshots -> repeat sequence, starts muted, falls back safely on media errors, and does not change its contract merely because the window is maximized. Tablet and presentation/display surfaces keep their separate behavior.\n\nSee `docs/DESKTOP_DETAIL_LAYOUT_CONTRACT.md` for the acceptance contract and viewport matrix.\n'''
readme.write_text(readme_text, encoding="utf-8")

stage2 = ROOT / "docs" / "STAGE2_FIXES_2026-09-08.md"
if stage2.exists():
    stage2_text = stage2.read_text(encoding="utf-8")
    note = "\n> Desktop detail visual rules are superseded by `DESKTOP_DETAIL_LAYOUT_CONTRACT.md`. The remaining unrelated Stage 2 items stay queued.\n"
    if note.strip() not in stage2_text:
        stage2_text = note + stage2_text
        stage2.write_text(stage2_text, encoding="utf-8")
