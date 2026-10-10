import DigitalGameOptions from "./DigitalGameOptions";
import { useI18n } from "./i18n";
import { libraryMembership, useLibraryBusy, useLibraryGames } from "./libraryMembership";
import { removeLibraryGame } from "./libraryActions";
import type { CSSProperties } from "react";
import { useState } from "react";
import { Download, FolderOpen, Play, Trash2 } from "lucide-react";

import AppDialog from "./AppDialog";
import { digitalCatalogService, type DigitalCatalog } from "./catalog/DigitalCatalog";
import type { ManagedDownloadStatus } from "./downloadTypes";
import { gameStateManager } from "./GameStateManager";
import type { CatalogGame } from "./types";

export interface DigitalContextMenuRequest {
  game: CatalogGame;
  x: number;
  y: number;
  status?: ManagedDownloadStatus;
}

const contextMenuStyle = (x: number, y: number): CSSProperties => ({
  position: "fixed",
  left: Math.min(x, Math.max(8, (typeof window !== "undefined" ? window.innerWidth : 1920) - 250)),
  top: Math.min(y, Math.max(8, (typeof window !== "undefined" ? window.innerHeight : 1080) - 150)),
});

interface Props {
  request: DigitalContextMenuRequest;
  onClose: () => void;
  service?: DigitalCatalog;
  onInstall?: (game: CatalogGame) => void | Promise<void>;
  onPlay?: (game: CatalogGame) => void | Promise<void>;
}

export default function DigitalGameContextMenu({
  request,
  onClose,
  service = digitalCatalogService,
  onInstall,
  onPlay,
}: Props) {
  const {locale} = useI18n();
  useLibraryGames();
  const libraryBusy = useLibraryBusy();
  const inLibrary = libraryMembership.has(request.game);
  const [configuring, setConfiguring] = useState(false);
  const [removing, setRemoving] = useState(false);
  const label = locale === "es" ? {add:"Añadir a biblioteca",remove:"Quitar de biblioteca",options:"Idioma y ejecución",confirm:"¿Quitar de biblioteca?",warning:"También se desinstalarán los archivos locales del juego.",removed:"No se pudo quitar el juego",back:"Volver"} : {add:"Add to library",remove:"Remove from library",options:"Language and launch",confirm:"Remove from library?",warning:"The game's local files will also be uninstalled.",removed:"Could not remove game",back:"Back"};
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: "warning" | "error" } | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const appId = request.game.app_id ?? request.game.id;
  const state = gameStateManager.resolve(request.status);
  const canInstalledAction = Boolean(appId) && state.canOpenInstallFolder;
  // Cleanup is valid for incomplete/missing installations too, after transfer stops.
  const canUninstall = Boolean(appId) && !state.transferActive && !libraryBusy;
  const canPlay = Boolean(appId) && state.playButtonReady;
  const canInstall = Boolean(appId) && !state.playButtonReady;

  const install = async () => {
    onClose();
    if (onInstall) {
      void onInstall(request.game);
    } else {
      await service.download(request.game);
    }
  };

  const play = async () => {
    onClose();
    if (onPlay) {
      void onPlay(request.game);
    } else {
      await service.play(request.game);
    }
  };

  const openInstallFolder = async () => {
    if (!canInstalledAction) return;
    try {
      await service.openInstallFolder(request.game);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDialog({ title: "No se pudo abrir la carpeta", message, tone: "error" });
    }
  };

  const uninstallSelected = () => {
    if (!canUninstall) return;
    setRemoving(false);
    setDialog({
      title: `¿Desinstalar ${request.game.name}?`,
      message: "Se administrará la eliminación de los archivos del juego en este equipo.",
      tone: "warning",
    });
  };

  const confirmUninstall = async () => {
    setUninstalling(true);
    try {
      if (removing) await removeLibraryGame(request.game);
      else await service.uninstall(request.game);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDialog({ title: removing ? label.removed : "No se pudo iniciar la desinstalación", message, tone: "error" });
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <div className="ga-digital-menu-root" style={{display:"contents"}} onPointerDown={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key==="Escape"&&!uninstalling)onClose();event.stopPropagation();}}>
      {!dialog && !configuring ? (
        <div
          className="ga-game-options"
          role="menu"
          aria-label={`Opciones de ${request.game.name}`}
          style={contextMenuStyle(request.x, request.y)}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            disabled={!canInstall}
            onClick={() => void install()}
          >
            <Download size={16} /> Instalar
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canPlay}
            onClick={() => void play()}
          >
            <Play size={16} /> Jugar
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!canInstalledAction}
            onClick={() => void openInstallFolder()}
          >
            <FolderOpen size={16} /> Abrir carpeta de instalación
          </button>
          <button type="button" role="menuitem" disabled={!canUninstall} onClick={() => setConfiguring(true)}>{label.options}</button>
          {inLibrary ? <button type="button" role="menuitem" className="ga-danger-option" disabled={!canUninstall} onClick={() => { setRemoving(true); setDialog({title:label.confirm+" "+request.game.name,message:label.warning,tone:"warning"}); }}>{label.remove}</button>
            : <button type="button" role="menuitem" disabled={libraryBusy} onClick={() => { libraryMembership.add(request.game); onClose(); }}>{label.add}</button>}
          <button
            type="button"
            role="menuitem"
            disabled={!canUninstall}
            onClick={uninstallSelected}
          >
            <Trash2 size={16} /> Desinstalar
          </button>
        </div>
      ) : null}
      {configuring ? <DigitalGameOptions game={request.game} onClose={onClose} disabled={!canUninstall} /> : null}
      {dialog ? (
        <AppDialog
          title={dialog.title}
          message={dialog.message}
          tone={dialog.tone}
          onClose={onClose}
          onConfirm={dialog.tone === "warning" ? () => void confirmUninstall() : undefined}
          confirmDisabled={uninstalling}
          confirmLabel={removing ? label.remove : "Desinstalar"}
          cancelLabel="No, volver"
        />
      ) : null}
    </div>
  );
}
