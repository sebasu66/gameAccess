import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Loader2, Play, Snowflake } from "lucide-react";

import { downloadManager } from "./downloadManager";
import { gameStateManager } from "./GameStateManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import GameStorageContextMenu from "./GameStorageContextMenu";
import type { GameStorageContextMenuRequest } from "./GameStorageContextMenu";
import SteamCover from "./SteamCover";
import { calculateSelectionScrollTop, selectionItemTopInScrollContainer } from "./libraryNavigation";
import type { DownloadMap } from "./LibraryRoomParts";
import type { CatalogGame } from "./types";

function StorageBadge({ frozen }: { frozen: boolean }) {
  if (frozen) {
    return <span className="library-install-state ready frozen" title="Juego congelado · compactado para ahorrar espacio. Se descomprime automáticamente al presionar Jugar."><Snowflake size={13} /></span>;
  }
  return <span className="library-install-state ready" title="Listo para presionar Jugar"><Play size={12} fill="currentColor" /></span>;
}

function statusLabel(status: ManagedDownloadStatus | undefined, progress: number) {
  switch (status?.state) {
    case "requested": return "Pendiente";
    case "preparing": return "Preparando";
    case "paused": return "Pausado";
    case "cancelling": return "Cancelando";
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

type ContextMenuRequest = GameStorageContextMenuRequest;

interface DownloadGameCardProps {
  game: CatalogGame;
  index: number;
  selected: boolean;
  status?: ManagedDownloadStatus;
  pinned: boolean;
  onSelect: (index: number) => void;
  onContextMenu: (request: ContextMenuRequest) => void;
}

function DownloadGameCard({ game, index, selected, status, pinned, onSelect, onContextMenu }: DownloadGameCardProps) {
  const state = gameStateManager.resolve(status);
  const active = state.transferActive;
  const progress = downloadManager.progress(status);
  const label = statusLabel(status, progress);
  const style = { "--download-progress": `${progress}%` } as CSSProperties;
  const accessibilityState = active
    ? ` · descarga ${label}`
    : state.frozen
      ? " · juego congelado"
      : state.playButtonReady
        ? " · listo para Jugar"
        : "";

  const showContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onSelect(index);
    onContextMenu({ game, x: event.clientX, y: event.clientY, status });
  };

  return (
    <div className="library-room-card-shell">
      <button
        type="button"
        className={cardClass(selected, active, pinned)}
        style={style}
        data-library-game-id={game.id}
        data-install-folder-available={state.canOpenInstallFolder ? "true" : "false"}
        onClick={() => onSelect(index)}
        onContextMenu={showContextMenu}
        aria-current={selected ? "true" : undefined}
        aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}${accessibilityState}`}
        tabIndex={-1}
      >
        <span className="library-room-card-art">
          <span className="library-room-card-cover-base"><SteamCover game={game} /></span>
          {active ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
          {state.playButtonReady ? <StorageBadge frozen={state.frozen} /> : null}
          {active ? <span className="library-download-state"><Loader2 className={status?.state === "paused" ? "" : "spin"} size={12} /> {label}</span> : null}
        </span>
      </button>
    </div>
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
  onPlay?: (game: CatalogGame) => void | Promise<void>;
}

type OpenContextMenu = ContextMenuRequest | null;

export default function DownloadCatalogPanel(props: DownloadCatalogPanelProps) {
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>(null);

  useEffect(() => {
    const grid = props.gridRef.current;
    const card = grid?.querySelector<HTMLElement>(".library-room-card.is-selected");
    if (!grid || !card || props.selectedIndex < 0) return;
    const gridRect = grid.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const itemTop = selectionItemTopInScrollContainer({
      scrollTop: grid.scrollTop,
      viewportTop: gridRect.top,
      itemTop: cardRect.top,
    });
    const nextTop = calculateSelectionScrollTop({
      scrollTop: grid.scrollTop,
      viewportHeight: grid.clientHeight,
      itemTop,
      itemHeight: cardRect.height,
      padding: 8,
    });
    if (Math.abs(nextTop - grid.scrollTop) > 1) grid.scrollTo({ top: nextTop, behavior: "auto" });
  }, [props.gridRef, props.selectedIndex]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", keydown);
    };
  }, [contextMenu]);


  return (
    <section className="library-room-catalog">
      <header className="library-room-heading"><small>{props.games.length} juegos</small></header>
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
            onContextMenu={setContextMenu}
          />
        ))}
      </div>
      {contextMenu ? <GameStorageContextMenu request={contextMenu} onClose={() => setContextMenu(null)} /> : null}
    </section>
  );
}
