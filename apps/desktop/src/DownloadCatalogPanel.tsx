import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from "react";
import { Archive, FolderOpen, Gamepad2, Loader2, Play, Trash2 } from "lucide-react";

import { downloadProgress, isTrackedDownload } from "./downloadManager";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { libraryArtworkCandidates } from "./libraryArtwork";
import type { DownloadMap } from "./LibraryRoomParts";
import type { CatalogGame } from "./types";

function SteamCover({ game }: { game: CatalogGame }) {
  const sources = libraryArtworkCandidates(game);
  const [sourceIndex, setSourceIndex] = useState(0);
  const source = sources[sourceIndex];
  if (!source) return <span className="library-cover-fallback"><Gamepad2 size={34} /></span>;
  return <img key={source} src={source} alt="" draggable={false} loading="lazy" onError={() => setSourceIndex((current) => current + 1)} />;
}

function ReadyBadge() {
  return <span className="library-install-state ready" title="Instalado"><Play size={12} fill="currentColor" /></span>;
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

type ContextMenuRequest = {
  game: CatalogGame;
  x: number;
  y: number;
  installed: boolean;
};

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
  const active = isTrackedDownload(status);
  const ready = Boolean(status?.installed || status?.state === "installed");
  const progress = downloadProgress(status);
  const label = statusLabel(status, progress);
  const style = { "--download-progress": `${progress}%` } as CSSProperties;
  const accessibilityState = active ? ` · descarga ${label}` : ready ? " · instalado" : "";

  const showContextMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onSelect(index);
    onContextMenu({ game, x: event.clientX, y: event.clientY, installed: ready });
  };

  return (
    <div className="library-room-card-shell">
      <button
        type="button"
        className={cardClass(selected, active, pinned)}
        style={style}
        data-library-game-id={game.id}
        data-install-folder-available={ready ? "true" : "false"}
        onClick={() => onSelect(index)}
        onContextMenu={showContextMenu}
        aria-current={selected ? "true" : undefined}
        aria-label={`${selected ? "Seleccionado: " : "Seleccionar "}${game.name}${accessibilityState}`}
        tabIndex={-1}
      >
        <span className="library-room-card-art">
          <span className="library-room-card-cover-base"><SteamCover game={game} /></span>
          {active ? <span className="library-room-card-color-fill" aria-hidden="true"><SteamCover game={game} /></span> : null}
          {ready ? <ReadyBadge /> : null}
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

const contextMenuStyle = (x: number, y: number): CSSProperties => ({
  position: "fixed",
  left: Math.min(x, Math.max(8, window.innerWidth - 250)),
  top: Math.min(y, Math.max(8, window.innerHeight - 150)),
  zIndex: 10000,
  minWidth: 230,
  padding: 6,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.15)",
  background: "rgba(16,18,24,.98)",
  boxShadow: "0 14px 40px rgba(0,0,0,.45)",
});

const contextItemStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 9,
  padding: "9px 10px",
  border: 0,
  borderRadius: 6,
  background: "transparent",
  color: "inherit",
  textAlign: "left",
  font: "inherit",
};

export default function DownloadCatalogPanel(props: DownloadCatalogPanelProps) {
  const accountLabel = props.accountCount === 1 ? "cuenta" : "cuentas";
  const accounts = props.accountCount ? ` · ${props.accountCount} ${accountLabel}` : "";
  const [contextMenu, setContextMenu] = useState<OpenContextMenu>(null);

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

  const openInstallFolder = async () => {
    const request = contextMenu;
    setContextMenu(null);
    if (!request?.installed || !request.game.app_id) return;
    try {
      await invoke<string>("open_game_install_folder", { appId: request.game.app_id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      window.alert(`No pudimos abrir la carpeta de instalación.\n\n${message}`);
    }
  };

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
            onContextMenu={setContextMenu}
          />
        ))}
      </div>
      {contextMenu ? (
        <div
          role="menu"
          aria-label={`Opciones de ${contextMenu.game.name}`}
          style={contextMenuStyle(contextMenu.x, contextMenu.y)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            style={{ ...contextItemStyle, opacity: contextMenu.installed ? 1 : 0.5 }}
            disabled={!contextMenu.installed || !contextMenu.game.app_id}
            onClick={() => void openInstallFolder()}
          >
            <FolderOpen size={16} /> Abrir carpeta de instalación
          </button>
          <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: 0.42 }} disabled>
            <Trash2 size={16} /> Desinstalar · próximamente
          </button>
          <button type="button" role="menuitem" style={{ ...contextItemStyle, opacity: 0.42 }} disabled>
            <Archive size={16} /> Comprimir · próximamente
          </button>
        </div>
      ) : null}
    </section>
  );
}
