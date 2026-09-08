from __future__ import annotations

import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps" / "desktop" / "src"


def head_bytes(path: str) -> bytes:
    return subprocess.check_output(["git", "show", f"HEAD:{path}"], cwd=ROOT)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        if new in text:
            return text
        raise SystemExit(f"{label}: expected source not found")
    return text.replace(old, new, 1)


# Preserve the LibraryRoom that was already on main when this completion pass began.
# It contains the desktop/tablet keyboard autoscroll contract and other fixes that are
# unrelated to the detail handoff. The handoff is composed below without rewriting it.
room_rel = "apps/desktop/src/LibraryRoom.tsx"
(SRC / "LibraryRoom.tsx").write_bytes(head_bytes(room_rel))

# Preserve all current LibraryRoom helpers/selectors, including the normal/maximized
# artwork helpers used by LibraryRoom, but replace only the legacy in-file detail
# renderer with the focused bounded implementation.
parts_rel = "apps/desktop/src/LibraryRoomParts.tsx"
parts = head_bytes(parts_rel).decode("utf-8")
parts = parts.replace(
    'import { Download, Gamepad2, Loader2, Play, ThumbsDown, ThumbsUp, Volume2, VolumeX, XCircle } from "lucide-react";',
    'import { Download, Gamepad2, Loader2, Play, XCircle } from "lucide-react";',
)
parts = parts.replace(
    'import { downloadProgress, formatDownloadBytes, formatDownloadEta, formatDownloadSpeed, isTrackedDownload } from "./downloadManager";',
    'import { isTrackedDownload } from "./downloadManager";',
)
pattern = r'\ninterface MediaPanelProps \{.*?\ninterface CatalogPanelProps'
replacement = '\nexport { FeaturePanel } from "./LibraryDetailPanel";\n\ninterface CatalogPanelProps'
parts, count = re.subn(pattern, replacement, parts, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f"LibraryRoomParts detail extraction: expected one match, got {count}")
(SRC / "LibraryRoomParts.tsx").write_text(parts, encoding="utf-8")

# LibraryRoom intentionally keeps its established prop contract. The focused panel
# accepts those legacy media props for compatibility, but owns the selected-detail
# request itself so the first desktop game gets metadata without requiring a click.
panel_path = SRC / "LibraryDetailPanel.tsx"
panel = panel_path.read_text(encoding="utf-8")
panel = replace_once(
    panel,
    'import type { CatalogGame, GameDetails, SteamMovie } from "./types";\n',
    'import type { CatalogGame, GameDetails, SteamMovie } from "./types";\nimport { useSelectedGameDetails } from "./useSelectedGameDetails";\n',
    "selected-detail hook import",
)
legacy_props = '''  displaySurface?: boolean;\n  summary?: string;\n  artwork?: unknown;\n  movie?: unknown;\n  videoSrc?: string;\n  readyVideoSrc?: string | null;\n  videoMuted?: boolean;\n  videoVolume?: number;\n  videoRef?: unknown;\n  onVideoMetadata?: (video: HTMLVideoElement) => void;\n  onVideoReady?: (video: HTMLVideoElement) => void;\n  onToggleSound?: () => void;\n  onVolumeChange?: (value: number) => void;'''
panel = replace_once(
    panel,
    '  displaySurface?: boolean;',
    legacy_props,
    "legacy FeaturePanel compatibility props",
)
old_feature_start = '''export function FeaturePanel(props: FeaturePanelProps) {\n  const steam = props.details?.steam;\n  const description = plainText(steam?.short_description);\n  const summary = description || (props.loadingDetails ? "Cargando descripción de Steam…" : "Descripción no disponible");'''
new_feature_start = '''export function FeaturePanel(props: FeaturePanelProps) {\n  const surfaceMode = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("surface");\n  const resolvedDisplaySurface = props.displaySurface ?? (surfaceMode === "display");\n  const selectedDetail = useSelectedGameDetails({\n    surface: resolvedDisplaySurface ? "display" : "desktop",\n    selectedGameId: props.game.id,\n    detailRequestedGameId: props.game.id,\n    tabletDetailsOpen: false,\n  });\n  const resolvedDetails = props.details ?? selectedDetail.details;\n  const resolvedLoadingDetails = props.loadingDetails || (props.details == null && selectedDetail.loading);\n  const resolvedDetailsError = props.detailsError ?? selectedDetail.error;\n  const steam = resolvedDetails?.steam;\n  const description = plainText(steam?.short_description);\n  const summary = description || (resolvedLoadingDetails ? "Cargando descripción de Steam…" : "Descripción no disponible");'''
panel = replace_once(panel, old_feature_start, new_feature_start, "FeaturePanel selected detail ownership")
panel = replace_once(
    panel,
    'details={props.details} displaySurface={Boolean(props.displaySurface)}',
    'details={resolvedDetails} displaySurface={resolvedDisplaySurface}',
    "resolved detail media",
)
panel = panel.replace(
    '{props.loadingDetails ? <span className="library-room-loading">',
    '{resolvedLoadingDetails ? <span className="library-room-loading">',
)
panel = panel.replace(
    '{!props.loadingDetails && props.detailsError ? <span className="library-room-loading">',
    '{!resolvedLoadingDetails && resolvedDetailsError ? <span className="library-room-loading">',
)
panel = panel.replace('platforms(props.details)', 'platforms(resolvedDetails)')
panel = panel.replace(
    '${props.displaySurface ? "library-room-feature-copy" : ""}',
    '${resolvedDisplaySurface ? "library-room-feature-copy" : ""}',
)
panel = panel.replace('{!props.displaySurface ? <section', '{!resolvedDisplaySurface ? <section')
panel = panel.replace('{!props.displaySurface ? <div', '{!resolvedDisplaySurface ? <div')
panel_path.write_text(panel, encoding="utf-8")

print("Preserved current LibraryRoom navigation contract and composed the bounded detail panel.")
