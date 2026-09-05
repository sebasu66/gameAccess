import { useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { Gamepad2, Loader2, Play } from "lucide-react";

import { downloadProgress, isTrackedDownload } from "./downloadManager";
import { libraryArtworkCandidates } from "./libraryArtwork";
import type { DownloadMap } from "./LibraryRoomParts";
import type { SteamDownloadStatus } from "./native";
import type { CatalogGame } from "./types";

function SteamCover({ game }: { game: CatalogGame }) {
  const sources = libraryArtworkCandidates(game);
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
  const progress = downloadProgress(status);
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
  onSelect: (index: number) => void;
}

export default function DownloadCatalogPanel(props: DownloadCatalogPanelProps) {
  const accountLabel = props.accountCount === 1 ? "cuenta" : "cuentas";
  const accounts = props.accountCount ? ` · ${props.accountCount} ${accountLabel}` : "";

  return (
    <section className="library-room-catalog">
      <header className="library-room-heading"><small>{props.games.length} juegos{accounts} · WASD / FLECHAS</small></header>
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
