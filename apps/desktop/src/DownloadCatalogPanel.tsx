import { useState } from "react";
import type { CSSProperties, RefObject } from "react";
import { Gamepad2, Loader2, Play } from "lucide-react";

import { isTrackedDownload } from "./downloadManager";
import type { DownloadMap } from "./LibraryRoomParts";
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
        {props.games.map((game, index) => {
          const status = game.app_id ? props.downloads[game.app_id] : undefined;
          const active = isTrackedDownload(status);
          const ready = Boolean(status?.installed || status?.state === "installed");
          const progress = Math.max(0, Math.min(100, status?.progress ?? 0));
          const pinned = Boolean(game.app_id && props.pinnedAppIds.has(game.app_id));
          const stateLabel = status?.state === "requested"
            ? "Pendiente"
            : status?.state === "preparing"
              ? "Preparando"
              : status?.state === "paused"
                ? "Pausado"
                : `${Math.round(progress)}%`;
          const style = { "--download-progress": `${progress}%` } as CSSProperties;

          return (
            <button
              type="button"
              key={game.id}
              className={`library-room-card ${index === props.selectedIndex ? "is-selected" : ""} ${active ? "is-download-active" : ""} ${pinned ? "is-download-pinned" : ""}`}
              style={style}
              onClick={() => props.onSelect(index)}
              aria-current={index === props.selectedIndex ? "true" : undefined}
              aria-label={`${index === props.selectedIndex ? "Seleccionado: " : "Seleccionar "}${game.name}${active ? ` · descarga ${stateLabel}` : ""}`}
              tabIndex={-1}
            >
              <span className="library-room-card-art">
                <span className="library-room-card-cover-base"><SteamCover game={game} /></span>
                {active ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
                {ready && game.copies_available > 0 ? <ReadyBadge /> : null}
                {active ? <span className="library-download-state"><Loader2 className={status?.state === "paused" ? "" : "spin"} size={12} /> {stateLabel}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
