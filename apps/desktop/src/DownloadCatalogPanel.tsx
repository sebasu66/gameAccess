import { useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { Eye, Gamepad2, Loader2, Play } from "lucide-react";

import { isTrackedDownload } from "./downloadManager";
import type { DownloadMap } from "./LibraryRoomParts";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

function artworkCandidates(game: CatalogGame) {
  const appId = game.app_id;
  const candidates = [
    game.capsule_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900_2x.jpg` : null,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/library_600x900.jpg` : null,
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg` : null,
    game.header_image,
    appId ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg` : null,
    appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg` : null,
  ].filter((value): value is string => Boolean(value));
  return [...new Set(candidates)];
}

function SteamCover({ game }: { game: CatalogGame }) {
  const sources = artworkCandidates(game);
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  if (!source) return <span className="library-cover-fallback"><Gamepad2 size={34} /></span>;
  return <img key={source} src={source} alt="" draggable={false} loading="lazy" onError={() => setSourceIndex((current) => current + 1)} />;
}

function ReadyBadge() {
  return <span className="library-install-state ready" title="Instalado · listo para jugar"><Play size={12} fill="currentColor" /></span>;
}

function statusLabel(status: SteamDownloadStatus | undefined, progress: number) {
  switch (status?.state) {
    case "requested": return "Pendiente";
    case "preparing": return "Preparando";
    case "paused": return "Pausado";
    default: return `${Math.round(progress)}%`;
  }
}

function cardClass(selected: boolean, active: boolean, pinned: boolean) {
  return [
    "library-room-card",
    selected ? "is-selected" : "",
    active ? "is-download-active" : "",
    pinned ? "is-download-pinned" : "",
  ].filter(Boolean).join(" ");
}

interface DownloadGameCardProps {
  game: CatalogGame;
  index: number;
  selected: boolean;
  status?: SteamDownloadStatus;
  pinned: boolean;
  onSelect: (index: number) => void;
}

function DownloadGameCard({ game, index, selected, status, pinned, onSelect }: DownloadGameCardProps) {
  const active = isTrackedDownload(status);
  const ready = Boolean(status?.installed || status?.state === "installed");
  const progress = Math.max(0, Math.min(100, status?.progress ?? 0));
  const label = statusLabel(status, progress);
  const style = { "--download-progress": `${progress}%` } as CSSProperties;
  const accessibilityState = active ? ` · descarga ${label}` : "";

  return (
    <button
      type="button"
      className={cardClass(selected, active, pinned)}
      style={style}
      onClick={() => onSelect(index)}
      aria-current={selected ? "true" : undefined}
      aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}${accessibilityState}`}
      tabIndex={-1}
    >
      <span className="library-room-card-art">
        <span className="library-room-card-cover-base"><SteamCover game={game} /></span>
        {active ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
        {ready && game.copies_available > 0 ? <ReadyBadge /> : null}
        {active ? <span className="library-download-state"><Loader2 className={status?.state === "paused" ? "" : "spin"} size={12} /> {label}</span> : null}
      </span>
    </button>
  );
}

interface DownloadCatalogPanelProps {
  games: CatalogGame[];
  downloads: DownloadMap;
  accountCount: number;
  selectedIndex: number;
  gridRef: RefObject<HTMLDivElement>;
  pinnedAppIds: Set<number>;
  hiddenCount?: number;
  onRestoreHidden?: () => void;
  onSelect: (index: number) => void;
}

export default function DownloadCatalogPanel(props: DownloadCatalogPanelProps) {
  const accountLabel = props.accountCount === 1 ? "cuenta" : "cuentas";
  const accounts = props.accountCount ? ` · ${props.accountCount} ${accountLabel}` : "";

  return (
    <section className="library-room-catalog">
      <header className="library-room-heading">
        <small>{props.games.length} juegos{accounts} · WASD / FLECHAS</small>
        {props.hiddenCount && props.onRestoreHidden ? <button type="button" className="library-hidden-restore" onClick={props.onRestoreHidden}><Eye size={12} /> {props.hiddenCount} oculto{props.hiddenCount === 1 ? "" : "s"} · mostrar</button> : null}
      </header>
      <div ref={props.gridRef} className="library-room-grid">
        {props.games.map((game, index) => (
          <DownloadGameCard
            key={game.id}
            game={game}
            index={index}
            selected={index === props.selectedIndex}
            status={game.app_id ? props.downloads[game.app_id] : undefined}
            pinned={Boolean(game.app_id && props.pinnedAppIds.has(game.app_id))}
            onSelect={props.onSelect}
          />
        ))}
      </div>
    </section>
  );
}
