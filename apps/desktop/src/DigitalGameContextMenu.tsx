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
  const [dialog, setDialog] = useState<{ title: string; message: string; tone: "warning" | "error" } | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const appId = request.game.app_id;
  const state = gameStateManager.resolve(request.status);
  const canInstalledAction = Boolean(appId) && state.canOpenInstallFolder;
  // Cleanup is valid for incomplete/missing installations too, after transfer stops.
  const canUninstall = Boolean(appId) && !state.transferActive;
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
    if (!state.canUninstall) return;
    setDialog({
      title: `¿Desinstalar ${request.game.name}?`,
      message: "Se administrará la eliminación de los archivos del juego en este equipo.",
      tone: "warning",
    });
  };

  const confirmUninstall = async () => {
    setUninstalling(true);
    try {
      await service.uninstall(request.game);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDialog({ title: "No se pudo iniciar la desinstalación", message, tone: "error" });
    } finally {
      setUninstalling(false);
    }
  };

  return (
    <>
      {!dialog ? (
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
      {dialog ? (
        <AppDialog
          title={dialog.title}
          message={dialog.message}
          tone={dialog.tone}
          onClose={onClose}
          onConfirm={dialog.title.startsWith("¿Desinstalar") ? () => void confirmUninstall() : undefined}
          confirmDisabled={uninstalling}
          confirmLabel="Desinstalar"
          cancelLabel="No, volver"
        />
      ) : null}
    </>
  );
}
